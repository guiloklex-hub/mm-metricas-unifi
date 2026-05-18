# mm-metricas-unifi

Coleta, armazenamento e BI de métricas UniFi — self-hosted, multi-controller, multi-site. Open-source.

Construído para resolver um problema concreto: a interface nova do UniFi Network não mostra mais, por antena, contadores de pacotes/descartes/erros/retransmissão que a diretoria pedia em relatório. Esta ferramenta poll-eia controllers UniFi periodicamente (OS Console + Network Application self-hosted), guarda séries temporais em SQLite e oferece dashboards, relatórios CSV/PDF e comparativos entre filiais.

> **Status:** em desenvolvimento ativo. M0 (foundation) inicial — ainda não usável em produção. Veja o [roadmap](#roadmap).

## Funcionalidades planejadas

- Coleta a cada 5 minutos por controller UniFi (OS ou self-hosted)
- Granularidade: por site, AP, rádio (2.4/5/6 GHz) e cliente
- Métricas: client count, tx bytes, tx packets, tx dropped, tx errors, tx retries + taxas calculadas (`retry_rate`, `error_rate`, `drop_rate`)
- Armazenamento local em SQLite (WAL) com downsampling: 5min × 30d → hourly × 1 ano → daily indefinido
- Dashboard BI com gráficos interativos (timeseries, heatmap, comparativos)
- Exportação CSV (streaming) e PDF (relatório executivo)
- Multi-localidade — cadastre quantos controllers quiser
- Auth single-admin com argon2id, JWT em cookie httpOnly
- Roda como container Docker único, sem dependências externas (sem Redis, sem Postgres)

## Stack

Node.js 22 · TypeScript · Fastify 5 · Drizzle ORM · better-sqlite3 · Vite + React 19 · TanStack Router/Query · ECharts · PDFKit · undici · Pino · Zod · argon2 · Vitest · Biome.

## Quick start (Docker)

```bash
git clone https://github.com/guiloklex-hub/mm-metricas-unifi.git
cd mm-metricas-unifi
cp .env.example .env

# Gere segredos:
echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env

docker compose up -d
```

Acesse `http://localhost:3000` e siga o setup wizard para definir a senha de admin e cadastrar o primeiro controller.

## Desenvolvimento local

```bash
nvm use            # Node 22
npm install
cp .env.example .env
# Gerar MASTER_KEY e JWT_SECRET no .env

npm run db:generate     # gera migrations Drizzle
npm run db:migrate      # aplica no SQLite
npm run dev             # API + scheduler em http://localhost:3000
npm run dev:web         # Vite SPA em http://localhost:5173 (proxy para 3000)
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

- `MASTER_KEY` — 32 bytes em base64. Cifra credenciais dos controllers no banco. Trocar invalida senhas guardadas.
- `JWT_SECRET` — segredo para assinar sessões.

## Documentação

| Tópico | Documento |
|---|---|
| Arquitetura | [docs/architecture.md](docs/architecture.md) |
| Notas das APIs UniFi | [docs/unifi-api-notes.md](docs/unifi-api-notes.md) |
| Referência de métricas | [docs/metrics-reference.md](docs/metrics-reference.md) |
| Deploy | [docs/deployment.md](docs/deployment.md) |
| ADRs | [docs/adr/](docs/adr/) |

## Roadmap

- [x] **M0 — Foundation** — scaffolding, CI, schema, login admin
- [x] **M1 — MVP coleta** — UnifiClient OS+Classic, CRUD controllers, scheduler, dashboard timeseries
- [x] **M2 — Rollup + multi-controller** — downsampling 5m→1h→1d, retenção, heatmap
- [ ] **M3 — Relatórios** — CSV streaming, PDF, comparativos
- [ ] **M4 — Beta** — audit log, métricas por cliente, i18n, docs completas
- [ ] **M5 — v1.0** — coverage 80%, E2E, imagem GHCR estável

Detalhes em [`docs/architecture.md`](docs/architecture.md).

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md). PRs, issues e discussões são bem-vindos.

## Segurança

Reporte vulnerabilidades de acordo com [SECURITY.md](SECURITY.md) — não abra issue público.

## Licença

[MIT](LICENSE).
