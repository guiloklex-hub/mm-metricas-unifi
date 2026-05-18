import { HeatmapChart, type HeatmapSeriesOption } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export interface HeatmapCell {
  ts: number; // epoch seconds
  value: number | null;
}

export interface HourlyHeatmapProps {
  cells: HeatmapCell[];
  title?: string;
  /** Função para formatar o valor no tooltip e na barra (ex.: % retransmissão). */
  formatValue?: (v: number) => string;
  height?: number;
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

/**
 * Heatmap hora-do-dia × dia-da-semana. Resume a janela em uma matriz 7×24.
 * Útil para enxergar padrões diurnos (ex.: pico de retransmissão entre 14h-16h).
 */
export function HourlyHeatmap({ cells, title, formatValue, height = 280 }: HourlyHeatmapProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Agrupa em matriz 7×24 calculando MEDIA de cells por (dow, hour).
    const buckets: Array<{ count: number; sum: number }> = Array.from({ length: 7 * 24 }, () => ({
      count: 0,
      sum: 0,
    }));
    for (const c of cells) {
      if (c.value == null || !Number.isFinite(c.value)) continue;
      const d = new Date(c.ts * 1000);
      const dow = d.getDay();
      const hour = d.getHours();
      const idx = dow * 24 + hour;
      const cell = buckets[idx];
      if (!cell) continue;
      cell.count += 1;
      cell.sum += c.value;
    }

    const data: Array<[number, number, number | null]> = [];
    let max = 0;
    for (let dow = 0; dow < 7; dow += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const b = buckets[dow * 24 + hour];
        const v = b && b.count > 0 ? b.sum / b.count : null;
        if (v != null && v > max) max = v;
        data.push([hour, dow, v]);
      }
    }

    const series: HeatmapSeriesOption = {
      type: 'heatmap',
      data,
      progressive: 1000,
      animation: false,
      emphasis: { itemStyle: { borderColor: '#0f172a', borderWidth: 1 } },
    };

    chart.setOption(
      {
        title: title
          ? { text: title, left: 'center', top: 0, textStyle: { fontSize: 13 } }
          : undefined,
        grid: { left: 50, right: 20, top: title ? 36 : 10, bottom: 50 },
        tooltip: {
          position: 'top',
          formatter: (p: unknown) => {
            const params = p as { value: [number, number, number | null] };
            const [hour, dow, v] = params.value;
            const hh = HOUR_LABELS[hour as number];
            const dd = DAY_LABELS[dow as number];
            const vv = v == null ? '—' : formatValue ? formatValue(v) : String(v);
            return `<b>${dd}</b> · ${hh}:00 → ${vv}`;
          },
        },
        xAxis: { type: 'category', data: HOUR_LABELS, splitArea: { show: true } },
        yAxis: { type: 'category', data: DAY_LABELS, splitArea: { show: true } },
        visualMap: {
          min: 0,
          max: max > 0 ? max : 1,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          formatter: formatValue ? (v: number) => formatValue(v) : undefined,
        },
        series: [series],
      },
      { notMerge: true },
    );
  }, [cells, title, formatValue]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
