# Referência de Métricas

## Métricas coletadas

Por linha em `metrics_5m` / `metrics_1h` / `metrics_1d`:

| Coluna | Tipo | Unidade | Descrição |
|---|---|---|---|
| `ts` | INTEGER | epoch s (UTC) | Início do bucket (alinhado a múltiplo de 300/3600/86400). |
| `controller_id` | TEXT | — | FK para `controllers`. |
| `site_id` | TEXT | — | FK para `sites`. |
| `device_id` | TEXT (nullable) | — | FK para `devices`. NULL = linha agregada de site. |
| `radio` | TEXT (nullable) | `ng`\|`na`\|`6e` | NULL = agregado de device. |
| `client_mac` | TEXT (nullable) | — | NULL = não é linha de cliente. Apenas em `_5m` e `_1h`. |
| `client_count` | INTEGER | clientes | Snapshot do `num_sta` do controller. |
| `tx_bytes` | INTEGER | bytes | Acumulado do device. |
| `tx_packets` | INTEGER | pacotes | Acumulado. |
| `tx_dropped` | INTEGER | pacotes | Acumulado. |
| `tx_errors` | INTEGER | pacotes | Acumulado. |
| `tx_retries` | INTEGER | pacotes | Acumulado. |
| `d_tx_bytes` | INTEGER | bytes | Delta da janela (tratado contra reboot). |
| `d_tx_packets` | INTEGER | pacotes | Delta da janela. |
| `d_tx_dropped` | INTEGER | pacotes | Delta da janela. |
| `d_tx_errors` | INTEGER | pacotes | Delta da janela. |
| `d_tx_retries` | INTEGER | pacotes | Delta da janela. |
| `retry_rate` | REAL | 0..1 | `d_tx_retries / NULLIF(d_tx_packets, 0)`. |
| `error_rate` | REAL | 0..1 | `d_tx_errors / NULLIF(d_tx_packets, 0)`. |
| `drop_rate` | REAL | 0..1 | `d_tx_dropped / NULLIF(d_tx_packets, 0)`. |

## Dimensão e agregação

Para cada coleta de site, produzimos N linhas em `metrics_5m`:

- **Por rádio em cada AP:** `device_id != NULL`, `radio != NULL`, `client_mac = NULL`. Granularidade mais fina.
- **Agregado por AP:** `device_id != NULL`, `radio = NULL`, `client_mac = NULL`. Soma dos rádios.
- **Agregado por site:** `device_id = NULL`, `radio = NULL`, `client_mac = NULL`. Soma dos devices.
- **Por cliente:** `client_mac != NULL`. Linha única por cliente ativo no momento.

## Rollup

`metrics_1h` agrega 12 buckets de `_5m`:

```sql
INSERT INTO metrics_1h
SELECT
  (ts / 3600) * 3600 AS ts,
  controller_id, site_id, device_id, radio, NULL AS client_mac,
  AVG(client_count) AS client_count,
  MAX(tx_bytes) AS tx_bytes,       -- snapshot: pegamos o último
  ...
  SUM(d_tx_bytes) AS d_tx_bytes,
  SUM(d_tx_packets) AS d_tx_packets,
  ...
  1.0 * SUM(d_tx_retries) / NULLIF(SUM(d_tx_packets), 0) AS retry_rate,
  ...
FROM metrics_5m
WHERE ts >= ? AND ts < ?
GROUP BY (ts / 3600) * 3600, controller_id, site_id, device_id, radio
ON CONFLICT (...) DO UPDATE SET ...;
```

`metrics_1d` segue o mesmo pattern de `_1h`, agregando 24 buckets horários. `_1d` não tem dimensão `client_mac` (cardinalidade explode em séries longas).

## Counter reset

`stat/device` retorna contadores acumulados desde o último reboot do AP. Para extrair delta:

```typescript
delta = current >= last_value ? current - last_value : current
```

Quando `current < last_value` (rollback), assumimos reboot e tratamos `current` como delta da janela (perdemos parte da janela mas evitamos negativos). Estado em `counter_state (controller_id, site_id, device_id, radio, client_mac, metric, last_value, last_ts)`.

UI marca janelas com counter reset com badge "reboot detected".

## Granularidade adaptativa nas queries

Dashboard e exportações escolhem a granularidade conforme o tamanho da janela:

| Janela | Tabela |
|---|---|
| ≤ 2 dias | `metrics_5m` |
| 2-60 dias | `metrics_1h` |
| > 60 dias | `metrics_1d` |

Garante respostas < 1s na maioria dos painéis.
