# Changelog

Todas as mudanças notáveis aqui. Formato [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versionamento [SemVer](https://semver.org).

## [Unreleased]

### Added — M4 (Beta hardening)
- **Audit log**: tabela `audit_log` recebe writes em todos os eventos críticos
  (setup, login success/failed, logout, password change, controller
  created/updated/deleted). Endpoint `GET /api/v1/audit?limit=N&beforeTs=ts`
  e seção dedicada em Configurações na UI exibindo histórico com
  formato relativo de tempo.
- **Top talkers**: `GET /api/v1/metrics/top-talkers?from=&to=&...` lista os
  clientes (MACs) com maior consumo de bytes na janela. Card no dashboard
  mostra top 10 com auto-refresh.
- **Edit controller**: `PATCH /api/v1/controllers/:id` aceita
  `{ name, enabled, pollSeconds, insecureTls }`. UI permite pausar/reativar
  com badge "pausado" e edição inline do intervalo de coleta.
- **Trocar senha admin**: `POST /api/v1/auth/change-password` com validação
  da senha atual + nova senha mínima 8 chars. UI em Settings com confirmação.
- **Smoke E2E expandido para 24 checks** validando todo o pipeline incluindo
  audit log, PATCH controller, top talkers e change-password com re-login.

### Added — M3 (Relatórios CSV + PDF)
- **Export CSV streaming** via `GET /api/v1/export/metrics.csv?from=&to=&...`
  com RFC 4180 (escape de aspas, vírgulas, newlines), Content-Disposition
  attachment com filename e janela máxima de 1 ano. Stream linha-a-linha
  sem materializar em memória.
- **Geração de PDF** via `POST /api/v1/reports/pdf` com PDFKit: capa com
  metadados (período, controller, site, granularidade, geração),
  totais agregados (bytes/pacotes/dropped/errors/retries + taxas), tabela
  ordenada por uso por AP. Janela máxima 90 dias.
- **UI: aba Relatórios** com seletor de período (24h/7d/30d/90d/custom),
  filtros por controller e site, download direto de CSV e PDF.
- 10 testes do gerador CSV (escape, null/undefined, ISO timestamp).
- Smoke E2E estendido valida CSV (22 linhas + cabeçalho) e PDF (magic bytes
  `%PDF`, 2966 bytes) — total **90 testes verdes**.

### Added — M2 (Rollup + retention + heatmap)
- **Rollup 5min → 1h e 1h → 1d** com `INSERT ... ON CONFLICT DO UPDATE`
  (idempotente). Agregação: AVG no client_count, MAX nos snapshots acumulados,
  SUM nos deltas, recálculo de taxas a partir dos somatórios para preservar
  peso por tráfego.
- **Job `rollup_1h`** cobre os últimos 3 buckets horários (recuperação caso
  execuções anteriores tenham falhado).
- **Job `rollup_1d`** roda às 00:10 UTC cobrindo os 2 dias anteriores.
- **Job `retention`** purga `metrics_5m` > 30d e `metrics_1h` > 365d com
  `PRAGMA optimize` no final. Configurável via `RETENTION_5M_DAYS` e
  `RETENTION_1H_DAYS`.
- **Heatmap calendar hora × dia-da-semana** no dashboard mostrando taxa de
  retransmissão média por slot (ECharts heatmap + visualMap).
- 5 testes integração de rollup (agregação, idempotência, janela exclusiva,
  rollup diário, purge) — total **80 testes verdes**.

### Changed — M2
- `buildCollector` agora aceita `retention5mDays` e `retention1hDays`.
- Handlers `rollup_1h`, `rollup_1d` e `retention` deixam de ser stubs e
  fazem o trabalho real.

### Added — M1 (MVP de coleta)
- **Coletor UniFi end-to-end**: parser de payloads (`stat/device`, `stat/sta`,
  `self/sites`) produzindo amostras por site, AP, rádio (ng/na/6e) e cliente.
- **Fila de jobs em SQLite** com claim atômico (`UPDATE ... RETURNING`), retry
  exponencial até `max_attempts`, idempotência por chave, recuperação de
  workers travados via `locked_until` expirado.
- **Scheduler `croner`** com tick de 1 min para enfileirar `collect` por
  controller respeitando `pollSeconds`; cron pré-configurado para rollup e
  retention (handlers chegam no M2).
- **Worker single-thread** processando jobs com `register(kind, handler)` e
  `tickOnce()` (para testes).
- **Job `collect`**: sincroniza catálogo de sites, coleta devices + clientes,
  computa agregado de site, persiste `metrics_5m` em transação com lookup de
  `counter_state` para cálculo de delta (tolerante a counter reset).
- **Pool de UnifiClient por controller** com detecção automática de variant
  (OS vs Classic) persistida no banco.
- **AES-GCM** para cifrar senhas e API keys dos controllers em disco usando
  `MASTER_KEY` (32 bytes).
- **Rotas REST**:
  - `GET/POST/DELETE /api/v1/controllers` + `POST /api/v1/controllers/test`.
  - `GET /api/v1/sites` + `GET /api/v1/sites/:id/devices`.
  - `GET /api/v1/metrics` com granularidade adaptativa, filtros e `groupBy`.
  - `GET /api/v1/metrics/recent` para janelas relativas.
  - `GET /api/v1/metrics/status` (contadores + jobs).
- **Web UI completa do M1**: setup wizard de senha, login, lista/cadastro de
  controllers, dashboard com gráfico timeseries (ECharts + brushing/zoom) e
  resumo tabular por AP. Roteamento state-driven, TanStack Query para fetch.
- **Schema 5m/1h/1d** com sentinela `''` em dimensões nullable + índice único
  composto para `ON CONFLICT DO UPDATE`.
- **5 testes de integração com mock UniFi local** (HTTP real, não MSW):
  pipeline end-to-end, primeira coleta, delta zero, last_seen_at, reboot
  detection — totalizando **75 testes verdes**.
- **Snapshot tests** dos payloads parseados (detecta drift entre firmwares).
- **Smoke E2E**: `scripts/e2e-smoke.mjs` sobe mock UniFi, cadastra como
  controller e valida coleta + leitura via HTTP real.

### Changed
- `metrics_5m/1h/1d.deviceId/radio/clientMac` agora são `NOT NULL DEFAULT ''`
  (sentinela) para permitir `UNIQUE INDEX` composto + `ON CONFLICT`.
- `JobQueue.claimNext()` agora recupera jobs `running` com `locked_until`
  expirado (worker travado).
- `JobRow` mapeia explicitamente snake_case → camelCase (corrigido bug onde
  `attempts/maxAttempts` viam undefined).
- Bootstrap (`src/server/index.ts`) inicia o collector (worker + scheduler)
  no boot e encerra graciosamente no SIGTERM/SIGINT.

### Added
- Scaffolding inicial do projeto (M0 — Foundation).
- Configuração de build: TypeScript, Vite, Biome, Vitest, Drizzle Kit.
- Schema SQLite inicial (controllers, sites, devices, metrics_5m/1h/1d, jobs, app_config, audit_log, counter_state).
- Fastify factory com healthz e estrutura de plugins.
- Bootstrap (env validado por Zod, logger Pino, migrate, listen).
- Docker multi-stage e docker-compose de exemplo.
- CI: lint + typecheck + test + build (GitHub Actions).
- Documentos open-source: README, LICENSE (MIT), CONTRIBUTING, SECURITY, CODE_OF_CONDUCT.
