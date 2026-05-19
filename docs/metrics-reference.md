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

## Exportação de relatórios

| Endpoint | O quê |
|---|---|
| `GET /api/v1/export/metrics.csv` | CSV puro. Sem `?level` → formato unificado legado (mistura de granularidades, só ULIDs). Com `?level=site\|device\|radio\|client` → CSV daquela granularidade com colunas legíveis (`controller_name`, `site_name`, `device_label`, `device_mac`, `device_name`, `device_alias`). Múltiplos `?levels=...` no mesmo endpoint disparam fallback para ZIP. |
| `GET /api/v1/export/metrics.zip` | ZIP com um CSV por nível (`por-site.csv`, `por-antena.csv`, `por-radio.csv`, `por-cliente.csv`). Default: todos os 4 níveis. Aceita `?levels=site,device` (subset). |
| `POST /api/v1/reports/pdf` | Resumo executivo. Lista antenas com label `Nome (MAC)` mesmo sem filtro de site. Janela máxima de 90 dias. |

Filtros comuns aceitos em `.csv`/`.zip`: `from`, `to` (epoch segundos), `granularity`, `controllerId`, `siteId`, `deviceId`, `radio`, `clientMac`.

### Label de antena nos relatórios

A coluna `device_label` (e a legenda do PDF e do Dashboard) segue esta ordem de preferência:

1. `displayAlias` — apelido custom cadastrado pelo operador (em `/devices` ou via import CSV).
2. `name` — nome reportado pelo controller UniFi (descoberto via coleta).
3. `mac` — MAC normalizado (`lowercase`, separado por `:`).

Nunca cai em ULID — se o operador não conhece o nome, vê pelo menos o MAC.
