# Arquitetura

> Referência viva. Quando algo muda em produção, atualize aqui no mesmo PR.

## Visão geral

Aplicação **single-process** Node.js que combina:

1. **Scheduler in-process** (croner) enfileirando jobs em SQLite.
2. **Worker** que claima jobs atomicamente e executa coleta/rollup/retenção.
3. **Cliente HTTP UniFi** desacoplado (suporta UniFi OS Console e Network App self-hosted).
4. **API HTTP** (Fastify 5) que serve dados para a SPA.
5. **Web UI** (Vite + React 19) servida estaticamente pelo Fastify.

Tudo em um único container Docker. Volume `/data` carrega o SQLite e os PDFs gerados.

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

### Scheduler + Worker (SQLite-backed queue)

Pattern: tabela `jobs (id, kind, run_at, payload_json, status, attempts, locked_until, last_error)`. Scheduler usa `croner` para INSERT em horários cron. Worker faz `UPDATE jobs SET status='running', locked_until=now+5min WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_at<=now AND (locked_until IS NULL OR locked_until<now) ORDER BY run_at LIMIT 1) RETURNING *` — claim atômico sem Redis.

Retries com backoff exponencial. Idempotência via UPSERT nas tabelas de métricas (re-execução de job parcial não duplica linhas).

### UnifiClient

Generaliza o padrão de `unifi-captiveportal/src/lib/unifi.ts` (login mutex, CSRF rotativo, circuit breaker, detecção OS-vs-Classic) para **multi-controller**: cache `Map<controllerId, UnifiClient>` com instâncias isoladas (cookie jar próprio, agente undici próprio com cert config opcional).

Auth dupla: API Key oficial (preferida quando disponível, stateless) ou login local com cookie + CSRF rotativo. Detecção runtime via probe na raiz.

### Modelo de dados

Time-series **long-format** em três tabelas: `metrics_5m`, `metrics_1h`, `metrics_1d`. Chave composta `(ts, controller_id, site_id, COALESCE(device_id,''), COALESCE(radio,''), COALESCE(client_mac,''))` com `WITHOUT ROWID` (economia de disco e índice secundário evitado).

Colunas: snapshot absoluto (`tx_bytes`, `tx_packets`, etc), deltas calculados (`d_tx_bytes`...) e taxas pré-computadas (`retry_rate`, `error_rate`, `drop_rate`).

Tabelas operacionais: `jobs`, `app_config`, `audit_log`, `counter_state`.

Detalhes em [metrics-reference.md](metrics-reference.md).

### Rollup

Cron `2 * * * *` agrega últimas 12 amostras de `metrics_5m` em `metrics_1h` via `INSERT ... GROUP BY (ts/3600)*3600 ... ON CONFLICT DO UPDATE`. Cron `10 0 * * *` faz o mesmo de `_1h` → `_1d`.

Idempotente — se o worker reiniciar no meio, re-execução não corrompe.

### Retenção

Cron `0 3 * * *` faz `DELETE` de `metrics_5m` > 30 dias e `metrics_1h` > 365 dias. `metrics_1d` permanente. `PRAGMA optimize` ao final.

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
