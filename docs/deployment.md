# Deploy

A partir da versão `2.x`, o `metricas-unifi` usa **PostgreSQL 16 + TimescaleDB
2.17+** como banco. Veja [docs/timescaledb-debian.md](timescaledb-debian.md)
para detalhes operacionais de Postgres em Debian.

## Topologia

Há dois cenários de deploy suportados:

- **Cenário A — tudo no Docker compose (recomendado para 1–10 controllers):**
  o `docker-compose.yml` sobe os 2 serviços (`metricas-unifi` + `timescaledb`)
  na mesma rede interna.
- **Cenário B — banco em host Debian dedicado:** a app aponta `DATABASE_URL`
  para um Postgres externo. Detalhes em
  [timescaledb-debian.md](timescaledb-debian.md).

## Docker (Cenário A — recomendado)

```bash
git clone https://github.com/guiloklex-hub/metricas-unifi.git
cd metricas-unifi
cp .env.example .env

# Senha do Postgres (usuário 'metricas_app').
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" >> .env

# Chaves de cifra/sessão da app.
echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env

# Ajustar DATABASE_URL no .env para usar a senha gerada acima.
# Default já aponta para o serviço `timescaledb` da rede interna.

docker compose up -d
```

Volumes:

- `pgdata` (named volume) — dados do PostgreSQL/TimescaleDB.
- `./data:/app/data` — relatórios PDF gerados sob demanda.

Portas:

- `3002` — API + Web UI.
- `5432` — Postgres, **NÃO** exposto ao host por default (rede interna).
  Para inspecionar via `psql` em dev, use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`.

### Variante dev (psql local)

`docker-compose.dev.yml` expõe `127.0.0.1:5432:5432` para permitir conexão
local com `psql -U metricas_app -h 127.0.0.1 metricas_unifi`.

### Atrás de reverse proxy (Caddy)

```caddyfile
metricas.empresa.com {
    reverse_proxy localhost:3002
}
```

Caddy emite cert Let's Encrypt automaticamente; o app não precisa lidar com TLS.

### Atrás de Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name metricas.empresa.com;
    ssl_certificate ...;
    ssl_certificate_key ...;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## Bare metal (Cenário B — sem Docker)

Pré-requisito: TimescaleDB instalado e o banco `metricas_unifi` criado. Siga
[docs/timescaledb-debian.md](timescaledb-debian.md) antes deste passo.

```bash
nvm install 22
nvm use 22

# Clone e instale dependências.
git clone https://github.com/guiloklex-hub/metricas-unifi.git
cd metricas-unifi

# Build precisa das devDependencies (vite, tailwind, plugins). Instale tudo,
# builde o front-end e só então pode dropar dev deps.
#
# ATENÇÃO em redeploy: se `NODE_ENV=production` já está exportado no shell
# (caso típico depois de `source .env`), o npm pula devDeps automaticamente
# e o build falha com `sh: 1: vite: not found`. Rode numa subshell limpa:
( unset NODE_ENV; npm ci && npm run build )
npm prune --omit=dev   # opcional: reduz node_modules após o build

# Configure .env (DATABASE_URL aponta para o Postgres do passo anterior;
# ajuste o host para `127.0.0.1` se o Postgres estiver no mesmo servidor,
# ou para o FQDN do banco remoto).
cp .env.example .env
$EDITOR .env

# ATENÇÃO: o processo lê variáveis de `process.env`; não carrega `.env`
# automaticamente. Para rodar à mão no shell, exporte antes:
#   set -a; source .env; set +a
#   NODE_ENV=production npm run start
# Em produção, prefira systemd com `EnvironmentFile=` (exemplo abaixo).
```

Recomendado: rodar sob um supervisor que (1) garanta auto-start no boot,
(2) reinicie em caso de crash e (3) carregue o `.env` para o processo. Há duas
opções suportadas — **systemd** (padrão em Debian, sem dependência extra) e
**PM2** (familiar para times que já operam outros serviços Node).

### Opção 1 — `systemd`

`/etc/systemd/system/metricas-unifi.service`:

```ini
[Unit]
Description=metricas-unifi
After=network-online.target postgresql@16-main.service
Wants=network-online.target postgresql@16-main.service

[Service]
Type=simple
User=metricas
WorkingDirectory=/opt/metricas-unifi
EnvironmentFile=/opt/metricas-unifi/.env
ExecStart=/usr/bin/npx tsx src/server/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> **Nota:** Em Cenário A (banco no mesmo host), o `Wants/After=postgresql@16-main.service`
> garante a ordem de boot. Em Cenário B (banco remoto), basta
> `After=network-online.target`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now metricas-unifi
sudo journalctl -u metricas-unifi -f
```

### Opção 2 — PM2

O arquivo [`ecosystem.config.cjs`](../ecosystem.config.cjs) na raiz do repositório
está pré-configurado para o cenário típico. Ele usa `node --env-file=.env --import tsx`
(Node ≥ 20.6 carrega `.env` nativamente), `instances: 1` (cluster mode causa
coleta duplicada — o collector e os cronjobs não são idempotentes entre
processos) e `max_memory_restart: '500M'`.

```bash
# Instalar PM2 globalmente (uma vez por servidor).
npm install -g pm2

# Subir o app.
cd /opt/metricas-unifi
chmod 600 .env
pm2 start ecosystem.config.cjs

# Acompanhar boot/migrations/coleta.
pm2 logs metricas-unifi

# Persistir entre reboots (PM2 gera um unit do systemd embaixo dos panos).
pm2 save
pm2 startup    # imprime um comando — rode-o como root.
```

Comandos do dia-a-dia:

```bash
pm2 ls
pm2 restart metricas-unifi              # reinício rápido
pm2 restart ecosystem.config.cjs        # reload pegando alterações no .env
pm2 stop metricas-unifi
pm2 monit                               # CPU/mem em tempo real
pm2 logs metricas-unifi --lines 200
```

> **Por que não cluster mode?** O collector (`startCollector`) mantém estado
> em memória sobre janelas de coleta e o `croner` agenda cronjobs internos
> (retention, downsampling). Múltiplas réplicas fariam o mesmo poll N vezes
> contra os controllers UniFi. Mantenha `instances: 1`.

## Primeiro acesso

1. Acesse `http://<host>:3002`.
2. Setup wizard pede para definir senha do admin.
3. Adicione o primeiro controller UniFi (URL, usuário, senha — ou API Key).
4. Primeira coleta acontece em até 5 min; até lá, dashboard mostra estado "aguardando dados".

## Backup

### Via Docker

```bash
docker compose exec timescaledb pg_dump -Fc -U metricas_app metricas_unifi \
  > backup-$(date +%F).dump
```

### Bare metal / Cenário B

Veja [docs/timescaledb-debian.md#15-backup](timescaledb-debian.md#15-backup)
para backup automatizado via systemd timer e rotação.

## Restore

```bash
# 1. Parar a app.
docker compose stop metricas-unifi
# 2. Dropar e recriar o banco (CUIDADO — apaga tudo).
docker compose exec timescaledb dropdb -U postgres metricas_unifi
docker compose exec timescaledb createdb -U postgres -O metricas_app metricas_unifi
# 3. CRÍTICO: criar extensão antes do restore.
docker compose exec timescaledb psql -U postgres -d metricas_unifi -c 'CREATE EXTENSION timescaledb;'
# 4. Restore.
docker compose exec -T timescaledb pg_restore --no-owner --role=metricas_app -d metricas_unifi < backup-2026-01-01.dump
# 5. Subir a app.
docker compose start metricas-unifi
```

## Upgrade

### Da v1.x (SQLite) para v2.x (TimescaleDB)

Mudança breaking — não há migração automática. Veja
[docs/timescaledb-debian.md#19-migração-de-dados-desde-a-versão-sqlite](timescaledb-debian.md#19-migração-de-dados-desde-a-versão-sqlite).

### Entre versões 2.x

```bash
docker compose pull
docker compose up -d
```

Migrations Drizzle rodam automaticamente no boot. Bootstrap do Timescale
(hypertables, retention policies) é idempotente — `if_not_exists` em tudo.

> **Sempre faça backup antes de upgrade major.**

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| Container `metricas-unifi` reinicia em loop | `MASTER_KEY`/`JWT_SECRET`/`POSTGRES_PASSWORD` vazios | Setar no `.env`. |
| `Configuração inválida em variáveis de ambiente: MASTER_KEY/JWT_SECRET: Required` rodando bare metal à mão | `npm run start` direto **não carrega `.env`** (não há dotenv embutido) | Use `set -a; source .env; set +a; npm run start`, ou `node --env-file=.env --import tsx src/server/index.ts`, ou suba via systemd / PM2 (que carregam o `.env`). |
| `sh: 1: vite: not found` no `npm run build` em bare metal | Instalou só com `--omit=dev`; `vite` é dev-dependency. **Causa comum em redeploys:** `NODE_ENV=production` exportado no shell faz o npm pular devDeps automaticamente, mesmo sem `--omit=dev`. | Rode em subshell limpa: `( unset NODE_ENV; npm ci && npm run build )`. Ou force: `npm ci --include=dev && npm run build`. Depois opcional: `npm prune --omit=dev`. |
| App falha com `ECONNREFUSED 5432` | Postgres ainda subindo, `DATABASE_URL` aponta para hostname inexistente (`timescaledb` em deploy bare metal), ou firewall bloqueando | Em Docker: ver `docker compose logs timescaledb`. Em bare metal: trocar host para `127.0.0.1` (ou IP/FQDN real) ou usar socket Unix com `?host=/var/run/postgresql`. |
| `pg_hba.conf rejects connection for host "X.X.X.X", user "metricas_app", database "metricas_unifi", no encryption` | Falta linha em `pg_hba.conf` que case (TYPE, DATABASE, USER, ADDRESS); ou linha existe mas é `hostssl` enquanto o cliente conectou sem TLS | (a) Confirme que o **USER** nas regras é `metricas_app` (nome do role), **não** `metricas_unifi` (nome do banco). (b) Para conexão sem TLS na rede interna, use `host` em vez de `hostssl`. (c) Para socket Unix, use linha `local`. Aplique com `SELECT pg_reload_conf()`. |
| `Error: self-signed certificate` (`DEPTH_ZERO_SELF_SIGNED_CERT`) | Postgres com cert autoassinado + cliente `pg` v9 valida cadeia por padrão | (a) **Preferível:** use socket Unix (`?host=/var/run/postgresql`) e contorne TLS. (b) Distribua o `server.crt` para o host da app e use `?sslmode=verify-full&sslrootcert=/caminho/server.crt`. (c) Apenas em rede interna confiável: `?uselibpqcompat=true&sslmode=require` (cifra sem verificar cert). |
| `DATABASE_URL` perdeu metade do valor (`[1]+ Done DATABASE_URL=...`) | O `&` da query string foi interpretado pelo bash como background job | Envolva o valor inteiro em aspas simples no `.env`: `DATABASE_URL='postgresql://...?a=1&b=2'`. |
| `relation "metrics_5m" does not exist` | Migrations não rodaram | Conferir logs de boot da app por "migrations aplicadas". |
| `must be loaded via shared_preload_libraries` | Imagem Postgres errada (sem timescaledb) | Confirmar `image: timescale/timescaledb:latest-pg16` no compose. |
| Controller fica em "falha de login" | TLS auto-assinado sem flag `insecure_tls` | Ativar o checkbox na UI ou instalar CA válida. |
| Coleta para de funcionar após upgrade do UniFi | Schema mudou no firmware | Verificar logs por `parse warn`; abrir issue colando o payload anonimizado. |
| Dashboard lento em janela > 1 mês | Estatísticas desatualizadas após import grande | Rodar `ANALYZE` no Postgres: `docker compose exec timescaledb psql -U metricas_app -d metricas_unifi -c 'ANALYZE'`. |
