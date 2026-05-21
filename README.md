# metricas-unifi

Coleta, armazenamento e BI de métricas UniFi — self-hosted, multi-controller, multi-site. Open-source.

Construído para resolver um problema concreto: a interface nova do UniFi Network não mostra mais, por antena, contadores de pacotes/descartes/erros/retransmissão que a diretoria pedia em relatório. Esta ferramenta poll-eia controllers UniFi periodicamente (OS Console + Network Application self-hosted), guarda séries temporais em **PostgreSQL + TimescaleDB** e oferece dashboards, relatórios CSV/PDF e comparativos entre filiais.

> **Status:** v2.0 — migração para TimescaleDB para destravar escala (10+ controllers, backups quentes, replicação). Imagem Docker em `ghcr.io/guiloklex-hub/metricas-unifi:latest`.

## Funcionalidades planejadas

- Coleta a cada 5 minutos por controller UniFi (OS ou self-hosted)
- Granularidade: por site, AP, rádio (2.4/5/6 GHz) e cliente
- Métricas: client count, tx bytes, tx packets, tx dropped, tx errors, tx retries + taxas calculadas (`retry_rate`, `error_rate`, `drop_rate`)
- Armazenamento em PostgreSQL 16 + TimescaleDB com **hypertables** e downsampling: 5min × 30d → hourly × 1 ano → daily indefinido (retention policies declarativas via `add_retention_policy`)
- **Backfill de histórico**: importa séries já existentes no controller (endpoint `stat/report`) — não é preciso esperar o sistema captar do zero
- Dashboard BI com gráficos interativos (timeseries, heatmap, comparativos)
- Exportação CSV (streaming) e PDF (relatório executivo). Suporta ZIP com um CSV por nível (site / antena / rádio / cliente) — colunas legíveis com nome do controller, do site e label "Nome (MAC)" da antena
- Cadastro de **apelidos** por antena (edição inline ou import em massa via CSV `mac,alias`)
- Multi-localidade — cadastre quantos controllers quiser
- Auth single-admin com argon2id, JWT em cookie httpOnly
- Deploy em Docker compose (2 containers: app + timescaledb) ou app bare-metal contra um Postgres dedicado em Debian

## Stack

Node.js 22 · TypeScript · Fastify 5 · Drizzle ORM (Postgres) · **PostgreSQL 16 + TimescaleDB 2.17+** · Vite + React 19 · TanStack Router/Query · ECharts · PDFKit · undici · Pino · Zod · argon2 · Vitest · Biome.

## Quick start (Docker)

O `docker-compose.yml` sobe 2 containers: `metricas-unifi` (app) e
`timescaledb` (Postgres + TimescaleDB).

```bash
git clone https://github.com/guiloklex-hub/metricas-unifi.git
cd metricas-unifi
cp .env.example .env

# Senha do role 'metricas_app' no Postgres.
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" >> .env

# Chaves da app.
echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env

# Ajuste DATABASE_URL no .env para usar o POSTGRES_PASSWORD gerado.

docker compose up -d
```

Acesse `http://localhost:3002` e siga o setup wizard para definir a senha de admin e cadastrar o primeiro controller.

> **Postgres em host dedicado?** Veja
> [docs/timescaledb-debian.md](docs/timescaledb-debian.md) para instalação,
> firewall, TLS e backup em Debian 12.

## Desenvolvimento local

```bash
nvm use            # Node 22
npm install
cp .env.example .env
# Gerar POSTGRES_PASSWORD, MASTER_KEY e JWT_SECRET no .env

# Sobe só o Postgres em container (mais simples que instalar local).
docker compose -f docker-compose.yml -f docker-compose.dev.yml up timescaledb -d

npm run db:generate     # gera migrations Drizzle (apenas se mudou schema.ts)
npm run dev             # API + scheduler em http://localhost:3002
                        # (migrations aplicadas automaticamente no boot)
npm run dev:web         # Vite SPA em http://localhost:5173 (proxy para 3002)
```

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Server em watch (tsx) |
| `npm run dev:web` | Vite SPA com hot reload |
| `npm run build` | Build de server e web para `dist/` |
| `npm run start` | Roda o build de produção |
| `npm run lint` | Biome check |
| `npm run lint:fix` | Biome auto-fix |
| `npm run typecheck` | tsc sem emitir |
| `npm run test` | Vitest run |
| `npm run test:coverage` | Vitest + coverage v8 |
| `npm run test:e2e` | Playwright E2E |
| `npm run db:generate` | Drizzle Kit — gerar migration |
| `npm run db:migrate` | Drizzle Kit — aplicar migration |
| `npm run db:studio` | Drizzle Studio (GUI) |

## Configuração

Todas as variáveis estão em [`.env.example`](.env.example). Obrigatórias:

- `DATABASE_URL` — connection string Postgres. Em Docker compose, aponta para o serviço `timescaledb` interno. Em bare-metal, aponta para o Postgres real.
- `POSTGRES_PASSWORD` — usado pelo docker-compose para criar o role `metricas_app` no Postgres e referenciado em `DATABASE_URL`.
- `MASTER_KEY` — 32 bytes em base64. Cifra credenciais dos controllers no banco. Trocar invalida senhas guardadas.
- `JWT_SECRET` — segredo para assinar sessões.

## Backfill de histórico

Por padrão, o coletor começa a registrar **a partir do momento em que o controller é cadastrado** (ele lê o snapshot cumulativo do `/stat/device` e calcula deltas em janelas de 5 minutos). Para evitar perder os dados que o próprio UniFi já possui, há uma rotina de **backfill** que consome o endpoint histórico `/stat/report/{interval}.{subject}`.

Na tela **Controllers**, cada controller cadastrado expõe um botão **"Importar histórico"**. Ao clicar, você escolhe:

- **Janela em dias** (1–365). O quanto recuar a partir de agora. A retenção do próprio controller manda — tipicamente 5min ~7d, hourly ~30d, daily ~12-24m.
- **Incluir granularidade diária**: marque se quiser cobertura de longo prazo (popula `metrics_1d`).

Comportamento:

- Para cada site habilitado, busca a série agregada do site e a série por AP em cada granularidade (`5minutes`, `hourly` e opcionalmente `daily`).
- Insere com `INSERT ... ON CONFLICT DO NOTHING` — **nunca sobrescreve** uma amostra "real" já capturada pelo coletor em tempo real.
- Os counters cumulativos (`tx_bytes`) ficam `NULL` para amostras históricas, mas os **deltas da janela** (`d_tx_bytes`, base para todos os relatórios e gráficos) são preenchidos.
- O job roda em background na fila de jobs. Status aparece ao lado do botão (`pending`/`running`/`done`/`failed`).
- Idempotente por `controllerId`: chamar duas vezes seguidas não duplica jobs.

> **Limitação do UniFi.** O endpoint `stat/report` do controller retém apenas
> `bytes`/`tx_bytes`/`rx_bytes`, `num_sta` e — dependendo do firmware —
> `wifi_tx_attempts` (proxy de packets) e `wifi_tx_dropped`. Counters de erro
> e retransmissão (`tx_errors`, `tx_retries`) são lidos do `/stat/device` em
> tempo real e **não persistem no histórico do controller**. Portanto, no
> backfill os campos `d_tx_errors`/`d_tx_retries`/`retry_rate`/`error_rate`
> ficam `NULL` para janelas anteriores ao cadastro do controller; o coletor
> ao vivo passa a preencher tudo a cada 5min daqui pra frente. `d_tx_packets`
> e `d_tx_dropped` vêm preenchidos somente em firmwares que expõem
> `wifi_tx_attempts`/`wifi_tx_dropped` em `stat/report`.

API equivalente:

```bash
# disparar backfill (precisa de sessão admin)
curl -X POST http://localhost:3002/api/v1/controllers/{controllerId}/backfill \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"days": 30, "includeDaily": false}'

# consultar status
curl http://localhost:3002/api/v1/controllers/{controllerId}/backfill/status -b cookies.txt
```

## Documentação

| Tópico | Documento |
|---|---|
| Arquitetura | [docs/architecture.md](docs/architecture.md) |
| Notas das APIs UniFi | [docs/unifi-api-notes.md](docs/unifi-api-notes.md) |
| Referência de métricas | [docs/metrics-reference.md](docs/metrics-reference.md) |
| Deploy | [docs/deployment.md](docs/deployment.md) |
| **TimescaleDB self-hosted em Debian** | [docs/timescaledb-debian.md](docs/timescaledb-debian.md) |
| ADRs | [docs/adr/](docs/adr/) |

## Roadmap

- [x] **M0 — Foundation** — scaffolding, CI, schema, login admin
- [x] **M1 — MVP coleta** — UnifiClient OS+Classic, CRUD controllers, scheduler, dashboard timeseries
- [x] **M2 — Rollup + multi-controller** — downsampling 5m→1h→1d, retenção, heatmap
- [x] **M3 — Relatórios** — CSV streaming, PDF, comparativos
- [x] **M4 — Beta hardening** — audit log, top talkers, edit/pause controllers, troca de senha
- [x] **M5 — v1.0** — release pipeline + GHCR estável
- [x] **M6 — TimescaleDB migration** — escala para 10+ controllers, backups quentes, replicação

Detalhes em [`docs/architecture.md`](docs/architecture.md).

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md). PRs, issues e discussões são bem-vindos.

## Segurança

Reporte vulnerabilidades de acordo com [SECURITY.md](SECURITY.md) — não abra issue público.

## Licença

[MIT](LICENSE).
