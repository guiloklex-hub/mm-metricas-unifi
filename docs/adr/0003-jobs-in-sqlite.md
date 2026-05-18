# ADR 0003 — Fila de jobs em SQLite (não Redis/BullMQ)

**Data:** 2026-05
**Status:** Aceito

## Contexto

Coleta UniFi, rollup 5m→1h→1d e retenção rodam como jobs cronometrados. Precisamos de:

- Disparo cron preciso
- Idempotência em re-execução
- Persistência atravessando restart
- Retry com backoff

Opções:

1. **BullMQ + Redis** — padrão Node, robusto, mas exige Redis.
2. **agenda.js** — usa MongoDB.
3. **node-cron / croner in-process** — só disparo, sem persistência.
4. **Fila custom em SQLite + croner para disparo** — ~150 linhas.

## Decisão

**`croner` para disparo cron** + **fila própria em SQLite** (~150 linhas):

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_until INTEGER,
  last_error TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE INDEX idx_jobs_claim ON jobs(status, run_at, locked_until);
```

Claim atômico:

```sql
UPDATE jobs SET status='running', locked_until=now+5min
WHERE id = (
  SELECT id FROM jobs
  WHERE status='pending'
    AND run_at <= now
    AND (locked_until IS NULL OR locked_until < now)
  ORDER BY run_at LIMIT 1
)
RETURNING *;
```

Idempotência via UPSERT (`ON CONFLICT DO UPDATE`) nas tabelas de métricas — re-execução de job parcial não duplica.

## Consequências

### Vantagens

- **Zero serviço extra.** Self-hosters não precisam subir Redis.
- **Debuggável:** `sqlite3 data/app.db 'SELECT * FROM jobs WHERE status=\"failed\"'`.
- **Backup atômico junto com os dados.**
- **Atravessa restart sem perda.**

### Limitações aceitas

- Throughput modesto (centenas de jobs/min, não milhares). Suficiente — temos ~poucas dezenas de jobs/hora.
- Polling do worker (1s) ≠ event-driven. Aceitável para latência alvo.
- Não há UI de gerenciamento de fila — substituída por painel admin custom + audit log.

### Quando reconsiderar

- Se features futuras exigirem alta concorrência de jobs (notificações, alertas com fan-out).
- Se quisermos rodar worker fora do processo principal (escalar horizontalmente).
