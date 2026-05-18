# ADR 0001 — SQLite (não Postgres) para armazenamento

**Data:** 2026-05
**Status:** Aceito

## Contexto

Precisamos guardar séries temporais de métricas UniFi: ~26M linhas em 30 dias (50 APs × 6 rádios × 12 amostras/h × 30d) na tabela mais quente, com leitura recorrente para dashboards e exportações.

Opções consideradas:

1. **SQLite (better-sqlite3)** — embedded, file-based.
2. **PostgreSQL com TimescaleDB** — engine de séries temporais robusto.
3. **DuckDB** — embedded analítico colunar.
4. **InfluxDB / VictoriaMetrics** — TSDBs especializados.

## Decisão

**SQLite WAL** via `better-sqlite3`.

## Consequências

### Vantagens

- **Zero dependência operacional.** Self-hosters rodam um container e pronto — sem subir Postgres + admin + tuning.
- **Backup trivial:** copiar 1 arquivo.
- **Performance suficiente:** WAL + mmap + índices compostos sustentam 26M linhas com queries < 200ms.
- **Migrações simples:** SQL declarativo via Drizzle Kit.
- **Modo `:memory:` para testes** — Vitest roda integration sem container.

### Limitações aceitas

- Concorrência de escrita serializada (1 writer). Aceitável porque escrita é só do worker — não há múltiplos.
- Sem replicação nativa (mas existe `litestream` se alguém precisar).
- Queries analíticas pesadas (ex.: percentil entre filiais) podem ficar lentas em escala muito grande — mitigamos com `metrics_1d` pré-agregado.

### Quando reconsiderar

- Operação com > 500 APs ativos ou > 50 controllers — abrir ADR de migração para Postgres+Timescale.
- Necessidade de replicação multi-master.
- Equipes com SQLite proibido por compliance corporativo.

## Notas

DuckDB foi considerado para a tabela `_1d` (analítico colunar) mas acoplar duas engines aumenta complexidade sem benefício claro na escala atual. Roadmap mantém porta aberta para export para Parquet + DuckDB read-only no futuro.
