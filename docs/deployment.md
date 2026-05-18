# Deploy

## Docker (recomendado)

```bash
git clone https://github.com/guiloklex-hub/metricas-unifi.git
cd metricas-unifi
cp .env.example .env

echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env

docker compose up -d
```

Volumes:

- `./data:/app/data` — SQLite + relatórios PDF gerados.

Portas:

- `3000` — API + Web UI.

### Atrás de reverse proxy (Caddy)

```caddyfile
metricas.empresa.com {
    reverse_proxy localhost:3000
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
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## Bare metal (sem Docker)

```bash
nvm install 22
nvm use 22

npm ci --omit=dev
npm run build
NODE_ENV=production npm run start
```

Recomendado: rodar sob `systemd` ou `pm2`.

### Exemplo `systemd`

`/etc/systemd/system/metricas-unifi.service`:

```ini
[Unit]
Description=metricas-unifi
After=network.target

[Service]
Type=simple
User=metricas
WorkingDirectory=/opt/metricas-unifi
EnvironmentFile=/opt/metricas-unifi/.env
ExecStart=/usr/bin/node --enable-source-maps dist/server/src/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now metricas-unifi
sudo journalctl -u metricas-unifi -f
```

## Primeiro acesso

1. Acesse `http://<host>:3000`.
2. Setup wizard pede para definir senha do admin.
3. Adicione o primeiro controller UniFi (URL, usuário, senha — ou API Key).
4. Primeira coleta acontece em até 5 min; até lá, dashboard mostra estado "aguardando dados".

## Backup

Single-process, single-file. Para backup:

```bash
docker compose exec metricas-unifi sqlite3 /app/data/app.db ".backup /app/data/backup-$(date +%F).db"
```

Ou copie a pasta `data/` quando o serviço estiver parado.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Migrations rodam automaticamente no boot (sem ação manual). Sempre faça backup antes de atualizar versão major.

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| Container reinicia em loop | `MASTER_KEY` ou `JWT_SECRET` vazios | Setar no `.env`. |
| Controller fica em "falha de login" | TLS auto-assinado sem flag `insecure_tls` | Ativar o checkbox na UI ou instalar CA válida. |
| Coleta para de funcionar após upgrade do UniFi | Schema mudou no firmware | Verificar logs por `parse warn`; abrir issue colando o payload anonimizado. |
| Dashboard lento em janela > 1 mês | Falta de índice ou granularidade errada | Confirmar índices via `sqlite3 data/app.db .indexes`; verificar logs de query. |
