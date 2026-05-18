# Changelog

Todas as mudanças notáveis aqui. Formato [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versionamento [SemVer](https://semver.org).

## [Unreleased]

## [1.0.3] — 2026-05-18

### Added
- **Backfill de histórico do controller** (`POST /api/v1/controllers/:id/backfill`
  + UI em "Controllers → Importar histórico"). Importa séries pré-agregadas
  do endpoint `/stat/report/{5minutes|hourly|daily}.{site|ap}` do próprio
  controller, populando `metrics_5m`/`metrics_1h`/`metrics_1d` retroativamente
  (até a retenção do controller, tipicamente 5min ~7d, hourly ~30d,
  daily ~12-24m). Insere com `ON CONFLICT DO NOTHING` para nunca sobrescrever
  amostras "reais" capturadas pelo coletor em tempo real. Não toca em
  `counter_state` (não interfere no delta-calc do live).
- Novo job kind `backfill` na fila (idempotente por `controllerId`).
- Endpoint `GET /api/v1/controllers/:id/backfill/status` para acompanhar
  progresso (polling a cada 3s na UI enquanto em `pending`/`running`).
- 13 testes novos cobrindo parser (`stat/report` → samples) e persistência
  (DO NOTHING, três tabelas, sem mutação de `counter_state`).

## [1.0.2] — 2026-05-18

### Fixed
- **Exportação de relatórios** (`/api/v1/export/metrics.csv` e
  `/api/v1/reports/pdf`): downloads chegavam ao navegador como `.txt`
  porque os handlers escreviam direto em `reply.raw` sem `reply.hijack()`,
  o que fazia o Node emitir headers padrão antes dos `reply.header()`
  do Fastify. Agora os handlers fazem `reply.hijack()` + definem
  `Content-Type` e `Content-Disposition` via `reply.raw.setHeader()`,
  garantindo que o navegador receba o nome correto (`mm-metricas_*.csv`
  / `.pdf`) e o MIME type adequado.

### Operations
- **Docker volume com SELinux**: `docker-compose.yml` agora monta
  `./data:/app/data:Z` para que o Fedora/RHEL relabele o bind mount
  com `container_file_t`. Sem isso, SELinux enforcing bloqueia a
  escrita em `/app/data/app.db` e o container entra em loop de restart
  com `SqliteError: unable to open database file`.

## [1.0.1] — 2026-05-18

### Changed
- **Rename do projeto**: `mm-metricas-unifi` → `metricas-unifi` (prefixo
  organizacional removido). Repositório, container, imagem GHCR e todas as
  referências internas atualizados. Imagem 1.0.0 antiga continua disponível
  em `ghcr.io/guiloklex-hub/mm-metricas-unifi:1.0.0` mas não recebe mais
  atualizações — migre para `ghcr.io/guiloklex-hub/metricas-unifi:latest`.
  GitHub mantém redirect automático do path antigo (`mm-metricas-unifi`)
  para o novo nos clones/links externos.
- **Dependabot hardened**: ignora permanentemente bumps de major do Node
  base image (manter Node 22 LTS) e `fastify-type-provider-zod` major
  (bloqueado até migração Zod 3→4).

### Dependencies (rodada pós-1.0.0)
- Mergeado 16 PRs do Dependabot incluindo majors: argon2 0.41→0.44,
  ulid 2→3, pino 9→10, vitest 2→4, drizzle-orm 0.36→0.45,
  @fastify/jwt 9→10, @fastify/static 8→9, @fastify/cookie 10→11,
  fast-jwt 5→6, croner 9→10, @types/node 22→25 + 5 actions GHA.
- 90 testes + E2E 24 checks validados em cada major. Sem regressões.

## [1.0.0] — 2026-05-18

Primeira release estável. Pipeline completo de coleta, armazenamento, BI e
relatórios para múltiplos controllers UniFi (OS + Network App self-hosted).

Inclui todas as funcionalidades dos milestones M0–M4 abaixo. Imagem Docker
multi-arch publicada em `ghcr.io/guiloklex-hub/mm-metricas-unifi:1.0.0` e
`:latest` via release pipeline automático.

Testes: 90 (unit + integração) + smoke E2E de 24 checks validando o caminho
completo. CI verde com lint (Biome 2) + typecheck (TS 5.6) + tests +
docker build + CodeQL semanal.

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
