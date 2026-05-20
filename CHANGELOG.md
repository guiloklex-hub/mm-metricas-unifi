# Changelog

Todas as mudanças notáveis aqui. Formato [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versionamento [SemVer](https://semver.org).

## [Unreleased]

### Added — clientes e tráfego por SSID/banda
- **3 tabelas novas**: `metrics_vap_5m`, `_1h`, `_1d` capturando 1 linha por
  combinação `(device × rádio × SSID)` (VAP/BSSID). Migration 0004 cuida
  da criação + adiciona coluna `ssid` no `counter_state` (rebuild da
  tabela preservando dados antigos).
- **Parser**: `parseVapTable()` filtra VAPs em RUN com `essid` válido,
  captura `num_sta`, `is_guest`, `avg_client_signal`, `tx_bytes`,
  `rx_bytes`, `mac_filter_rejections` por VAP.
- **Pipeline completo**: `insertVapSamples5m`, `queryVapMetrics`,
  `rollupVap5mTo1h`, `rollupVap1hTo1d`, retenção integrada.
- **Endpoints**:
  - `GET /api/v1/metrics/vap` — query histórica com filtros
    (controllerId, siteId, deviceId, radio, ssid).
  - `GET /api/v1/metrics/vap/recent?seconds=N` — Dashboard usa esse.
- **Dashboard**: 2 cards novos antes de "Resumo por AP":
  - "Clientes por banda" — gauge 2.4/5/6 GHz com total destacado.
  - "Por SSID" — tabela: SSID · Tipo (Corp/Guest) · Clientes (pico) ·
    distribuição por banda · Bytes Tx/Rx.
- **CSV/ZIP**: novo nível `vap` (`por-ssid_{from}_{to}.csv`) com colunas
  legíveis (controller_name, site_name, device_label, etc.).
- **PDF**: nova seção "Por SSID" após "Por AP" com tabela: SSID · Banda ·
  Tipo · Clientes pico · Bytes Tx/Rx. Sort por tráfego total desc.
- **ReportsPage**: chip "Por SSID" no seletor de níveis.

Tests: 145 → 148 (parseVapTable, insertVapSamples5m).

### Fixed — taxas matematicamente impossíveis (>100%) corrigidas

Bug duplo descoberto pelo usuário ao auditar o PDF: alguns APs apareciam
com `Erro %: 334.38%` ou `95.36%` quando a aritmética simples
(`errors/packets`) daria 65% e 30% respectivamente.

**Causa raiz 1** — denominador errado em `metrics-write.ts` e `rollup.ts`:
- `error_rate` / `drop_rate` usavam `tx_packets` como denominador.
- Mas no UniFi, `tx_errors` conta também retransmissões e tentativas
  internas que `tx_packets` não conta — `tx_errors > tx_packets` é
  possível em janelas curtas, gerando taxas > 100% (impossível em "%").
- Correção: usar `wifi_tx_attempts` (denominador semanticamente correto,
  conta TODAS as tentativas de envio). Já era usado para `retry_rate`,
  agora estendido para `error_rate` e `drop_rate` também. Fallback para
  `tx_packets` em firmwares antigos. Adicionado `clampRate` no upsert
  pra garantir que taxa nunca passe de 100% mesmo se denominador atrasar.

**Causa raiz 2** — agregação errada no PDF e Dashboard:
- O handler do PDF e o `summarizeDevices` do Dashboard calculavam taxas
  agregadas como **média aritmética dos rates por amostra** (1/N × Σ
  rate_i). Isso é estatisticamente errado para ratios — uma amostra de
  5min com 100 packets e 95 erros (95%) pesava igual a uma de 1M packets
  e 100 erros (0.01%), inflando a média.
- Correção: cálculo como `SUM(N) / SUM(D)` — média ponderada pelo
  tráfego real. Reflete a taxa "verdadeira" do AP no período.

Resultado: taxas no PDF e Dashboard agora consistentes, semanticamente
corretas e nunca > 100%. 2 testes novos cobrem regressão.

### Fixed — bugs visuais e dados desatualizados no PDF
- **Sobreposição de linhas no PDF** corrigida: cada linha da tabela "Por AP"
  agora calcula altura real via `doc.heightOfString`, então labels longos
  (`BUBA-AP-GALPAO FRENTE ADM 01 (f4:92:bf:...)`) podem quebrar em 2-3
  linhas sem sobrescrever a linha seguinte.
- **Overflow horizontal** corrigido: PDF passou a usar A4 landscape (762pt
  útil) — antes tentava encaixar 540pt em 515pt portrait, cortando coluna.

### Added — métricas completas no PDF
- Tabela "Por AP" do PDF agora tem 14 colunas: AP, Amostras, Bytes Tx,
  Bytes Rx, Pacotes, Drop Tx, Drop Rx, Erro Tx, Erro Rx, Retx %, Erro %,
  CPU, Mem, Uptime. Antes tinha só TX.
- Bloco "Totais do período" tem totais Rx (bytes, pacotes, dropped, erros)
  em 2 colunas pra economizar espaço vertical.
- Sort dos APs no PDF passou a usar `totalBytes + totalRxBytes` em vez de
  só TX — top do relatório reflete o tráfego real.
- Header da tabela **repete automaticamente** quando paginates.
- Zebra striping nas linhas (cinza muito claro alternado) — mais legível.

### Improved — CSV
- **BOM UTF-8** prefixado em todos os CSVs (legado, por-nível e dentro do
  ZIP). Excel passa a abrir corretamente sem quebrar acentos.
- **Filenames dentro do ZIP** agora incluem o período:
  `por-antena_2026-04-19_2026-05-19.csv` em vez de só `por-antena.csv`.
  Quem desempacota mantém contexto temporal mesmo se mover os arquivos.

### Improved — ReportsPage
- Mostra a **granularidade** que será usada antes do download
  (`5m`/`1h`/`1d`) ao lado do "Janela: X dias". Usuário sabe se vai puxar
  dados 5min ou hora antes de gerar.

### Added — captura abrangente do payload UniFi (auditoria 100%)

Após inspeção sistemática do payload bruto (`temp/metricas.txt`), 13 colunas
novas em metrics + 3 em devices passam a capturar tudo que aparece na
console UniFi (e mais). Migration `0003_glossy_brood.sql`.

**Saúde do AP (gauges):**
- `cpu_pct`, `mem_pct`, `uptime_sec` no Dashboard "Resumo por AP".
- Permitem detectar APs sobrecarregados, leak de memória e reboots
  inesperados — antes ficava cego para esses problemas.

**Retry rate "real":**
- `wifi_tx_attempts` capturado e usado como denominador do `retry_rate`
  (era proxy retries/packets, agora é retries/attempts — métrica oficial
  do firmware UniFi). Fallback para tx_packets quando attempts não vier.

**Diagnóstico Wi-Fi:**
- `rx_crypts` (decryption failures WPA), `wifi_tx_dropped` (drops
  específicos do Wi-Fi), `mac_filter_rejections` (tentativas bloqueadas),
  `num_roam_events` (eventos de roaming entre APs).
- Disponíveis no CSV/ZIP de exportação (não no Dashboard pra não inflar
  a tabela).

**Inventário em devices:**
- `version` (firmware), `serial`, `state` (online/offline) — cross-reference
  em bugs de firmware e RMA.

**Parser:**
- `intOrNull` agora aceita strings numéricas (alguns campos do `system-stats`
  vêm como string).
- Novo helper `floatOrNull` para gauges (CPU/mem em %).

**Frontend:**
- 3 colunas novas no "Resumo por AP": CPU %, Mem %, Uptime.
- Helpers `formatPercent` (gauges 0-100) e `formatUptime` (segundos →
  "1d 04h"/"45min"/etc).

3 testes novos cobrem CPU/mem/uptime, diag fields e inventory (143 total).

### Added — captura completa de métricas RX
- Novas colunas `rx_bytes`, `rx_packets`, `rx_dropped`, `rx_errors` + deltas
  `d_rx_*` em `metrics_5m`/`1h`/`1d` (migration `0002_amusing_solo.sql`).
- Parser passou a ler `stat.ap.rx_*` do payload UniFi — esses valores
  aparecem na console mas o sistema ignorava antes.
- Dashboard "Resumo por AP" mostra colunas "Bytes Rx" e "Erros (Rx)".
- CSV/ZIP de exportação inclui `d_rx_*` em todos os níveis.
- Counter overflow guard: valores acima de `Number.MAX_SAFE_INTEGER` viram
  null em vez de gerarem deltas absurdos.
- Detecção 6 GHz reconhece aliases novos: `6g`, `ax6`, `be`.
- Index `metrics_*_controller_ts` em 3 tabelas — queries de export por
  controller deixam de fazer scan completo.
- Index `devices_alias_idx` em `display_alias`.

### Security
- Remove `echarts-for-react` (trazia `size-sensor` CRITICAL malware como
  dep transitiva). Charts já usavam `echarts/core` direto.
- `@fastify/helmet`: HSTS, X-Frame-Options, X-Content-Type-Options=nosniff,
  Referrer-Policy. CSP fica off por agora (Vite gera inline scripts).
- SSRF guard em `POST /api/v1/controllers/test`: recusa hostname interno
  (localhost, link-local, RFC1918) por padrão. Opt-in via env
  `ALLOW_LOCAL_CONTROLLER=1`. Adiciona timeouts no undici (5/8/10s) e
  esconde `err.message` cru.
- Login rate-limit: 5/15min → 3/15min.
- Logger Pino redaction estendida: `jwt`, `masterKey`, `jwtSecret`,
  `passwordEnc`, `apiKeyEnc`, `twoFactorSecret` + variantes snake_case.

### Changed — UX e robustez
- Novo componente `<QueryState>` para estados consistentes de loading/
  error/empty. Aplicado em todas as Cards do Dashboard. Antes, queries
  com falha mostravam "Carregando…" pra sempre.
- `ReportsPage.downloadFile` usa `try/finally` para garantir que
  `URL.createObjectURL` seja revogado mesmo em caminho de erro (era
  memory leak ao falhar download repetidas vezes).
- DevicesPage import CSV ganhou botão "Limpar" que reseta arquivo,
  preview, resultado e erros — fim de usuário preso em estado confuso.
- ControllersPage: input de poll seconds com `htmlFor` + `aria-label`.
- Coletor reporta `failedSites` em falha parcial via `log.warn` em vez de
  esconder o problema dentro do counter `errors[]`.

### Added
- **Exportação ZIP por nível** (`GET /api/v1/export/metrics.zip`). Devolve um
  ZIP com até 4 CSVs separados — `por-site.csv`, `por-antena.csv`,
  `por-radio.csv`, `por-cliente.csv` — cada um focado em sua granularidade,
  sem misturar dimensões. Aceita `?levels=site,device,radio,client` (subset).
- **Colunas legíveis nos CSVs**: agora cada CSV inclui `controller_name`,
  `site_name`, `device_label`, `device_mac`, `device_name`, `device_alias`
  (quando aplicável ao nível) — não é mais necessário cruzar ULIDs manualmente.
- **Filtros amigáveis na tela de Relatórios**: dropdown de Site (substitui
  campo livre de ULID), dropdown de Antena opcional (label "Nome (MAC)"),
  e seletor de quais níveis exportar (chips Site/Antena/Rádio/Cliente).
- Endpoint `GET /api/v1/export/metrics.csv?level=device` (singular) retorna
  CSV puro de um único nível com as colunas legíveis. Múltiplos `levels`
  no mesmo endpoint disparam fallback para ZIP automaticamente.

### Changed
- **PDF** agora resolve o nome de toda antena (`Nome (MAC)`) mesmo quando o
  filtro `siteId` não é informado. Antes caía em ULID truncado.
- **Dashboard "Resumo por AP"**: removido o sufixo de 8 chars do ULID; o
  label agora é sempre `Nome (MAC)` (ou só `MAC` se a antena não tem
  alias/nome conhecido). Mesmo formato passou a ser usado nas legendas dos
  gráficos de série temporal.
- Endpoint legado `GET /api/v1/export/metrics.csv` (sem `level`) mantém o
  formato unificado antigo para retrocompat de scripts externos.

### Documentation
- README: nova seção sobre exportação em ZIP, filtros amigáveis e o
  comportamento "Nome (MAC)" no Dashboard.

## [1.0.4] — 2026-05-18

### Changed
- **Backfill: mais campos populados quando o firmware expõe**. Ampliamos
  `STAT_REPORT_ATTRS` (`wlan_bytes`, `wifi_tx_attempts`, `wifi_tx_dropped`),
  e o parser histórico agora mapeia:
  - `wifi_tx_attempts` → `d_tx_packets` (proxy de packets ao vivo)
  - `wifi_tx_dropped` → `d_tx_dropped`
  - `wlan_bytes` → `d_tx_bytes` (fallback adicional)
  Quando `d_tx_dropped` e `d_tx_packets` ambos presentes, o `drop_rate`
  agora é calculado para amostras históricas também.

### Documentation
- README ganhou nota explícita sobre a limitação do `stat/report` do UniFi:
  `tx_errors`/`tx_retries` são counters por rádio em tempo real e **não
  persistem no histórico do controller** — daí ficarem `NULL` em janelas
  pré-cadastro. O coletor ao vivo preenche tudo daqui pra frente.

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
