# Arquitetura

> Referência viva. Quando algo muda em produção, atualize aqui no mesmo PR.

## Visão geral

Aplicação **single-process** Node.js que combina:

1. **Scheduler in-process** (croner) enfileirando jobs na tabela `jobs` do Postgres.
2. **Worker** que claima jobs atomicamente (`FOR UPDATE SKIP LOCKED`) e executa coleta/rollup/retenção.
3. **Cliente HTTP UniFi** desacoplado (suporta UniFi OS Console e Network App self-hosted).
4. **API HTTP** (Fastify 5) que serve dados para a SPA.
5. **Web UI** (Vite + React 19) servida estaticamente pelo Fastify.

Persistência em **PostgreSQL 16 + TimescaleDB 2.17+**. Em deploy Docker padrão,
o `docker-compose.yml` sobe 2 containers (app + timescaledb). Em deploy
bare-metal, o app aponta `DATABASE_URL` para um Postgres em host separado
(ver [timescaledb-debian.md](timescaledb-debian.md)). Volume `/app/data` no
container da app carrega apenas PDFs gerados sob demanda.

## Diagrama lógico

```
                   +-------- SINGLE PROCESS ----------+
                   |                                   |
   cron triggers ──► Scheduler ─► jobs (SQLite) ◄─ Worker ─► UnifiClient ──► UniFi controller
                   |                                  │
                   |                                  ▼
                   |                              metrics_5m
                   |                                  │
                   |                          Rollup 1h / 1d
                   |                                  │
                   |                              metrics_1h
                   |                              metrics_1d
                   |                                  │
                   |                              Fastify API ──► Vite SPA (browser)
                   +-----------------------------------+
```

## Pastas

```
src/
├── shared/       schemas Zod e tipos importáveis em server e web
├── server/
│   ├── env.ts    validação Zod de process.env
│   ├── logger.ts wrapper Pino
│   ├── db/       Drizzle: schema, cliente, migrate, queries
│   ├── unifi/    HTTP client UniFi (OS + Classic), detect, endpoints, parser
│   ├── collector/ scheduler, worker, jobs (collect, rollup, retention), delta
│   ├── http/     Fastify factory, plugins, rotas, auth
│   ├── reports/  CSV e PDF
│   └── utils/    time, rate, retry
└── web/          SPA Vite (React 19, TanStack Router/Query, ECharts)
```

## Componentes-chave

### Scheduler + Worker (Postgres-backed queue)

Pattern: tabela `jobs (id, kind, run_at, payload_json, status, attempts, locked_until, last_error)`. Scheduler usa `croner` para INSERT em horários cron. Worker faz `UPDATE jobs SET status='running', locked_until=now+5min WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_at<=now AND (locked_until IS NULL OR locked_until<now) ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` — claim atômico que suporta múltiplos workers paralelos sem dupla reclamação.

Retries com backoff exponencial. Idempotência via UPSERT (`INSERT ... ON CONFLICT DO UPDATE`) nas tabelas de métricas (re-execução de job parcial não duplica linhas).

### UnifiClient

Generaliza o padrão de `unifi-captiveportal/src/lib/unifi.ts` (login mutex, CSRF rotativo, circuit breaker, detecção OS-vs-Classic) para **multi-controller**: cache `Map<controllerId, UnifiClient>` com instâncias isoladas (cookie jar próprio, agente undici próprio com cert config opcional).

Auth dupla: API Key oficial (preferida quando disponível, stateless) ou login local com cookie + CSRF rotativo. Detecção runtime via probe na raiz.

### Modelo de dados

Time-series **long-format** em várias tabelas, todas convertidas em **hypertables**
do TimescaleDB no boot (via `runBootstrapSql`):

- `metrics_5m`, `metrics_1h`, `metrics_1d` — agregado por device/rádio/cliente.
- `metrics_vap_5m`, `_1h`, `_1d` — SSID × rádio (VAP).
- `metrics_radio_5m`, `_1h`, `_1d` — canal/util/power por rádio.
- `metrics_client_5m`, `_1h` — cobertura por cliente WiFi.
- `metrics_port_5m`, `_1h`, `_1d` — portas de switch.

Chave composta `(ts, controller_id, site_id, device_id, radio, client_mac)`
(dimensões nullable usam sentinela `''`). `chunk_time_interval` em segundos:
604800 (7d) para tabelas 5m, 2.592.000 (30d) para 1h, 31.536.000 (1ano) para 1d.

Colunas: snapshot absoluto (`tx_bytes`, `tx_packets`, etc), deltas calculados
(`d_tx_bytes`...) e taxas pré-computadas (`retry_rate`, `error_rate`,
`drop_rate`).

Tabelas operacionais **não-hypertable**: `jobs`, `app_config`, `audit_log`,
`counter_state`, `events` (volume baixo ou estado dimensional).

Detalhes em [metrics-reference.md](metrics-reference.md).

### Rollup

Cron `2 * * * *` agrega últimas 12 amostras de `metrics_5m` em `metrics_1h` via
`INSERT ... GROUP BY (ts/3600)*3600 ... ON CONFLICT DO UPDATE`. Cron
`10 0 * * *` faz o mesmo de `_1h` → `_1d`.

Idempotente — se o worker reiniciar no meio, re-execução não corrompe.

> Continuous Aggregates do Timescale foram avaliadas e descartadas por
> incompatibilidade com o `backfill` job (que grava direto em `metrics_1h/1d`).

### Retenção

Duas camadas, ambas idempotentes:

1. **Retention policies do Timescale** (`add_retention_policy`) — declaradas
   em `runBootstrapSql` no boot, executadas pelo background worker do
   Timescale. Drop de chunk inteiro (rápido, sem fragmentar).
2. **Job `retention`** (`cron 0 3 * * *`) — fallback que faz `DELETE` por
   timestamp. Mantido durante a transição da v1.x; pode ser removido em
   versões futuras após validar policies em produção.

### Counter reset

`stat/device` retorna contadores acumulados desde o último reset do AP. Algoritmo em `src/server/collector/delta.ts`:

```
delta = current >= last_value ? current - last_value : current
```

Quando `current < last_value`, assume reboot e usa o valor atual como delta da janela. UI marca a janela com badge "reboot detected".

## Segurança

- Senhas dos controllers: AES-GCM com `MASTER_KEY` (32 bytes em base64 no env).
- Senha admin: argon2id.
- JWT HS256 com `JWT_SECRET`, cookie httpOnly + SameSite=Lax.
- Comparação de secrets: `crypto.timingSafeEqual`.
- TLS auto-assinado opt-in por controller (default valida cert).
- Audit log em `audit_log` para login, criação de controller, geração de relatório.

## Performance

- WAL + mmap_size 256MB + busy_timeout 5s.
- Índices compostos cobrindo queries do dashboard: `(device_id, ts)`, `(site_id, ts)`, `(client_mac, ts)`.
- Dashboard prefere `metrics_1h` quando janela > 2 dias.
- CSV e PDF usam queries com granularidade adaptativa.
- Cap de 50 APs × 6 rádios × 12 amostras/h × 30d ≈ 26M linhas — comportável em SQLite WAL.

## Decisões registradas

- [ADR 0001: SQLite (não Postgres)](adr/0001-sqlite-not-postgres.md)
- [ADR 0002: Drizzle (não Prisma)](adr/0002-drizzle-over-prisma.md)
- [ADR 0003: Fila em SQLite (não Redis/BullMQ)](adr/0003-jobs-in-sqlite.md)
