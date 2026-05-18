import { LineChart, type LineSeriesOption } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export interface TimeSeriesPoint {
  ts: number; // epoch s
  value: number | null;
}

export interface TimeSeriesSeries {
  name: string;
  data: TimeSeriesPoint[];
}

export interface TimeSeriesChartProps {
  series: TimeSeriesSeries[];
  yLabel?: string;
  formatY?: (value: number) => string;
  height?: number;
}

export function TimeSeriesChart({ series, yLabel, formatY, height = 320 }: TimeSeriesChartProps) {
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

    const seriesOptions: LineSeriesOption[] = series.map((s) => ({
      type: 'line',
      name: s.name,
      data: s.data.map((p) => [p.ts * 1000, p.value]),
      showSymbol: false,
      smooth: 0.2,
      sampling: 'lttb',
      emphasis: { focus: 'series' },
    }));

    chart.setOption(
      {
        grid: { left: 56, right: 16, top: 28, bottom: 56 },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v: unknown) => {
            if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
            return formatY ? formatY(v) : String(v);
          },
        },
        legend: { top: 0, type: 'scroll' },
        xAxis: { type: 'time' },
        yAxis: {
          type: 'value',
          name: yLabel,
          axisLabel: formatY ? { formatter: (v: number) => formatY(v) } : undefined,
        },
        dataZoom: [
          { type: 'inside', start: 0, end: 100 },
          { type: 'slider', start: 0, end: 100, height: 18, bottom: 8 },
        ],
        series: seriesOptions,
      },
      { notMerge: true },
    );
  }, [series, yLabel, formatY]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
