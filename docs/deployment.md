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
npm ci --omit=dev
npm run build

# Configure .env (DATABASE_URL aponta para o Postgres do passo anterior).
cp .env.example .env
$EDITOR .env

NODE_ENV=production npm run start
```

Recomendado: rodar sob `systemd`.

### Exemplo `systemd`

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
| App falha com `ECONNREFUSED 5432` | Postgres ainda subindo, ou `DATABASE_URL` errada | Verificar `docker compose logs timescaledb` e `depends_on` healthcheck. |
| `relation "metrics_5m" does not exist` | Migrations não rodaram | Conferir logs de boot da app por "migrations aplicadas". |
| `must be loaded via shared_preload_libraries` | Imagem Postgres errada (sem timescaledb) | Confirmar `image: timescale/timescaledb:latest-pg16` no compose. |
| Controller fica em "falha de login" | TLS auto-assinado sem flag `insecure_tls` | Ativar o checkbox na UI ou instalar CA válida. |
| Coleta para de funcionar após upgrade do UniFi | Schema mudou no firmware | Verificar logs por `parse warn`; abrir issue colando o payload anonimizado. |
| Dashboard lento em janela > 1 mês | Estatísticas desatualizadas após import grande | Rodar `ANALYZE` no Postgres: `docker compose exec timescaledb psql -U metricas_app -d metricas_unifi -c 'ANALYZE'`. |
