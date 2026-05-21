# TimescaleDB em Debian — guia operacional

Guia completo para instalar e operar o **PostgreSQL 16 + TimescaleDB 2.17+** em
servidor **Debian 12 (bookworm)** como banco do `metricas-unifi`.

> Outras distros: a maioria dos passos (apt, systemd, ufw, pg_hba) funciona
> também em Debian 11/13 e derivados como Ubuntu 22.04/24.04, com pequenas
> diferenças no nome do pacote ou na versão do Postgres disponível. Para
> derivados não-Debian (RHEL/Alpine), consulte a documentação oficial do
> Timescale.

---

## 1. Visão geral

**TimescaleDB** é uma extensão do PostgreSQL que adiciona suporte nativo a
séries temporais via **hypertables** (particionamento transparente por tempo)
e provê primitivas como `time_bucket()`, `add_retention_policy()` e compressão
por chunk.

O `metricas-unifi` usa Postgres + Timescale a partir da versão `2.x`. A versão
anterior usava SQLite. As principais mudanças operacionais:

| Aspecto | v1.x (SQLite) | v2.x (TimescaleDB) |
|---|---|---|
| Persistência | arquivo `app.db` no volume | banco Postgres no host/container |
| Configuração | `DATABASE_PATH=./data/app.db` | `DATABASE_URL=postgresql://...` |
| Backup | `sqlite3 .backup` | `pg_dump -Fc` |
| Migrations | aplicadas pelo app | aplicadas pelo app + bootstrap Timescale |
| HA / replicação | inexistente | streaming replication nativa |

O contrato HTTP da app, o coletor e o frontend permanecem idênticos. Mudou só
a camada de persistência.

---

## 2. Pré-requisitos do servidor

- **Sistema**: Debian 12 bookworm com `sudo` configurado e usuário não-root.
- **Sincronização de horário**: `chrony` ou `systemd-timesyncd` ativo. Séries
  temporais sensíveis a drift de relógio.
- **Locale**: `en_US.UTF-8` ou `pt_BR.UTF-8` (gerado via `dpkg-reconfigure
  locales`). Necessário para `LC_COLLATE` do banco.
- **Recursos mínimos sugeridos** (por porte):

  | Controllers | vCPU | RAM | Disco (SSD) |
  |---|---|---|---|
  | 1–3 | 1 | 2 GB | 20 GB |
  | 4–10 | 2 | 4 GB | 50 GB |
  | 11–50 | 4 | 8 GB | 200 GB |
  | 50+ | 8+ | 16+ GB | 500+ GB |

- **Filesystem**: `ext4` ou `xfs`. ZFS funciona, mas requer tuning extra
  (`recordsize=8K`, `compression=lz4`) para Postgres.

---

## 3. Topologia: app + DB no mesmo host vs DB dedicado

```
Cenário A — tudo no mesmo host (1–10 controllers)

    ┌──────────────────────────────────────┐
    │            Debian 12 host            │
    │                                       │
    │   ┌────────────┐    ┌──────────────┐ │
    │   │  app Node  │───▶│  Postgres 16 │ │
    │   │  :3000     │    │  +Timescale  │ │
    │   └────────────┘    └──────────────┘ │
    │      ▲  socket Unix em /var/run/postgresql
    │      │
    └──────┼───────────────────────────────┘
           ▼
       Web UI / clientes


Cenário B — DB em host dedicado (10+ controllers, HA)

    ┌─────────────┐                  ┌─────────────────────┐
    │  app host   │   TCP + TLS      │   Postgres host     │
    │  Node :3000 │ ─────────────▶   │   :5432 (firewall)  │
    └─────────────┘  sslmode=        └─────────────────────┘
                     verify-full
```

- **Cenário A — mesmo host**: Recomendado para 1 a 10 controllers, equipe
  pequena, sem requisito de HA. Vantagem: latência zero, sem TLS obrigatório
  (socket Unix). Desvantagem: scaling vertical apenas; backup compete por I/O.
- **Cenário B — host dedicado**: 10+ controllers, separação de domínios de
  falha, manutenção independente. TLS obrigatório, firewall mais estrito.
  Permite read-replicas, snapshots independentes do app.

---

## 4. Instalar PostgreSQL 16 via repositório oficial PGDG

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release

# Chave GPG do PGDG.
sudo install -d /etc/apt/keyrings
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg

# Repositório APT.
echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list

sudo apt update
sudo apt install -y postgresql-16 postgresql-client-16
```

Verificar:
```bash
systemctl status postgresql@16-main
sudo -u postgres psql -c 'SELECT version();'
```

---

## 5. Instalar a extensão TimescaleDB

```bash
# Chave GPG do Timescale.
curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
  | sudo gpg --dearmor -o /etc/apt/keyrings/timescaledb.gpg

# Repositório APT.
echo "deb [signed-by=/etc/apt/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/debian/ $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/timescaledb.list

sudo apt update
sudo apt install -y timescaledb-2-postgresql-16 timescaledb-tools
```

Verificar pacote:
```bash
dpkg -l | grep timescaledb
```

---

## 6. Tuning inicial com `timescaledb-tune`

A ferramenta ajusta `postgresql.conf` em função de RAM/CPU disponíveis e ativa
o `shared_preload_libraries`.

```bash
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql@16-main
```

O que o tune faz (resumido):
- `shared_preload_libraries = 'timescaledb'`
- `shared_buffers` ≈ 25% da RAM
- `effective_cache_size` ≈ 75% da RAM
- `work_mem`, `maintenance_work_mem` em função de RAM/conexões
- `max_worker_processes`, `timescaledb.max_background_workers`
- `wal_buffers`, `max_wal_size`

Ajustes manuais que recomendamos adicionar em
`/etc/postgresql/16/main/postgresql.conf`:

```conf
# Compressão de WAL — ~30% menos I/O em workloads de escrita.
wal_compression = on

# Log queries lentas (1s) — útil para diagnosticar relatórios pesados.
log_min_duration_statement = 1000
log_lock_waits = on
log_checkpoints = on
log_connections = on
log_disconnections = on

# Segurança: encerra transações idle que travam VACUUM/migrations.
idle_in_transaction_session_timeout = '5min'
```

Recarregar:
```bash
sudo -u postgres psql -c 'SELECT pg_reload_conf();'
```

> **Aviso:** rever tuning sempre que mudar RAM/CPU do host. `timescaledb-tune`
> pode ser rodado novamente sem perda de dados (faz backup do conf).

---

## 7. Configurar `pg_hba.conf` (autenticação)

Editar `/etc/postgresql/16/main/pg_hba.conf`. Substitua `peer`/`md5` por
`scram-sha-256` e restrinja por IP/CIDR.

**Cenário A — banco e app no mesmo host (socket Unix, recomendado):**
```
# TYPE   DATABASE         USER          ADDRESS           METHOD
local    metricas_unifi   metricas_app                    scram-sha-256
```

**Cenário B — app em host remoto (TCP + TLS):**
```
# TYPE      DATABASE         USER          ADDRESS              METHOD
hostssl     metricas_unifi   metricas_app  10.0.0.0/24          scram-sha-256
```
(substitua `10.0.0.0/24` pelo CIDR ou IP `/32` do host da app)

Em `postgresql.conf`, garantir:
```conf
password_encryption = scram-sha-256
```

Aplicar:
```bash
sudo -u postgres psql -c 'SELECT pg_reload_conf();'
# ou, se mudou listen_addresses, reiniciar:
sudo systemctl restart postgresql@16-main
```

> **Aviso:** nunca use `trust` ou `md5` em produção. `scram-sha-256` é o padrão
> seguro atual.

---

## 8. Criar banco e role least-privilege

```bash
sudo -u postgres psql
```

Dentro do psql:
```sql
-- Senha forte: openssl rand -base64 32  (no shell antes).
CREATE ROLE metricas_app LOGIN
  PASSWORD 'COLE_AQUI_A_SENHA_GERADA'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE DATABASE metricas_unifi
  OWNER metricas_app
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.UTF-8'
  LC_CTYPE   'en_US.UTF-8'
  TEMPLATE   template0;

-- Reduz permissões padrão de PUBLIC para evitar exposição acidental.
REVOKE ALL ON DATABASE metricas_unifi FROM PUBLIC;
REVOKE ALL ON SCHEMA public           FROM PUBLIC;
GRANT CONNECT ON DATABASE metricas_unifi TO metricas_app;

-- Conectar no banco para conceder no schema public.
\c metricas_unifi
GRANT USAGE, CREATE ON SCHEMA public TO metricas_app;
```

> **Aviso:** `metricas_app` não é superuser. Isso impede a aplicação de
> habilitar extensões — fazemos isso uma única vez na próxima seção.

---

## 9. Habilitar a extensão TimescaleDB no banco da app

```bash
sudo -u postgres psql -d metricas_unifi -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;'
```

Verificar:
```bash
sudo -u postgres psql -d metricas_unifi -c "SELECT default_version, installed_version FROM pg_available_extensions WHERE name='timescaledb';"
```

---

## 10. Configurar `DATABASE_URL` na app

Formato:
```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=MODE
```

**Cenário A — socket Unix:**
```bash
DATABASE_URL='postgresql://metricas_app:senha@/metricas_unifi?host=/var/run/postgresql'
```

**Cenário B — TCP + TLS obrigatório:**
```bash
DATABASE_URL='postgresql://metricas_app:senha@db.exemplo.com:5432/metricas_unifi?sslmode=verify-full&sslrootcert=/etc/ssl/certs/db-ca.crt'
```

URL-encode caracteres especiais na senha (`@`, `:`, `/`, `?`, `#` etc.). Em
Python: `urllib.parse.quote(senha)`.

Proteger o `.env`:
```bash
chmod 600 .env
chown <usuario-app>:<usuario-app> .env
```

---

## 11. `listen_addresses` em `postgresql.conf`

- **Cenário A (recomendado):** `listen_addresses = 'localhost'`
- **Cenário B:** `listen_addresses = '10.0.0.5'` (IP da NIC interna específica)
- **Desencorajado:** `listen_addresses = '*'` — só se firewall garantir bloqueio
  de tudo que não seja o IP da app.

Aplicar:
```bash
sudo systemctl restart postgresql@16-main
```

---

## 12. Firewall — liberar a porta 5432

### ufw (padrão Debian)

```bash
# Status atual
sudo ufw status verbose

# Cenário B: libera só o IP/CIDR do host da app.
sudo ufw allow proto tcp from 10.0.0.20 to any port 5432 \
  comment 'metricas-unifi app'
# Para IPv6:
sudo ufw allow proto tcp from 2001:db8::20/128 to any port 5432

# Garante default deny.
sudo ufw default deny incoming
sudo ufw reload
sudo ufw status verbose
```

**Cenário A** (banco local): NÃO precisa abrir nada. Para travar explicitamente:
```bash
sudo ufw deny 5432
```

### nftables (alternativa moderna)

Em `/etc/nftables.conf`, dentro da chain de input:
```
table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        iif "lo" accept
        # Libera Postgres só do IP da app.
        tcp dport 5432 ip saddr 10.0.0.20 accept
        # Postgres bloqueado para o resto.
        tcp dport 5432 drop
        # ... outras regras (SSH, app web, etc) ...
    }
}
```
```bash
sudo systemctl reload nftables
```

### iptables (legado)

```bash
sudo iptables -A INPUT -p tcp -s 10.0.0.20 --dport 5432 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 5432 -j DROP
# Persistir entre reboots:
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

### Teste do cliente

Do host da app:
```bash
nc -zv db.host 5432
# Connection to db.host port 5432 [tcp/postgresql] succeeded!
```

E confirmar que IPs não autorizados são bloqueados (de outro host):
```bash
nc -zv db.host 5432
# nc: connect to db.host port 5432 (tcp) failed: Connection refused
```

> **Aviso:** NUNCA exponha 5432 à internet pública sem TLS obrigatório,
> autenticação forte e IP allow-list. Postgres aberto = compromisso garantido.

---

## 13. SSL/TLS para conexões remotas (Cenário B)

### Opção A — certificado auto-assinado (válido por 2 anos)

```bash
sudo -u postgres bash <<'EOF'
cd /etc/postgresql/16/main
openssl req -new -x509 -days 825 -nodes -text \
  -out server.crt -keyout server.key \
  -subj '/CN=db.exemplo.com'
chmod 600 server.key
EOF
```

Em `postgresql.conf`:
```conf
ssl = on
ssl_cert_file = '/etc/postgresql/16/main/server.crt'
ssl_key_file  = '/etc/postgresql/16/main/server.key'
```

Distribuir `server.crt` para o host da app e usar `sslmode=verify-ca` ou
`verify-full` no `DATABASE_URL` (`sslrootcert=/caminho/server.crt`).

### Opção B — Let's Encrypt (FQDN público com porta 80 acessível)

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d db.exemplo.com
```

Apontar `ssl_cert_file`/`ssl_key_file` para `/etc/letsencrypt/live/db.exemplo.com/{fullchain,privkey}.pem`
e configurar hook `certbot renew --post-hook 'systemctl reload postgresql@16-main'`.

Reiniciar:
```bash
sudo systemctl restart postgresql@16-main
```

---

## 14. systemd — boot e operação

```bash
# Garantir que sobe no boot (já vem habilitado pelo pacote).
sudo systemctl enable postgresql@16-main
sudo systemctl is-enabled postgresql@16-main
sudo systemctl status postgresql@16-main

# Inspecionar clusters Postgres (útil em hosts com múltiplas versões).
pg_lsclusters

# Logs em tempo real.
sudo journalctl -u postgresql@16-main -f
# Arquivo histórico.
sudo tail -f /var/log/postgresql/postgresql-16-main.log
```

---

## 15. Backup

### `pg_dump` (lógico, recomendado para a maioria dos casos)

Backup manual:
```bash
sudo -u postgres pg_dump -Fc -d metricas_unifi \
  -f /var/backups/postgres/metricas-$(date +%F).dump
```

`-Fc` é formato custom (comprimido). Bom para volumes até ~50 GB.

### Backup automatizado via systemd timer

`/etc/systemd/system/metricas-backup.service`:
```ini
[Unit]
Description=Backup pg_dump do metricas_unifi
After=postgresql@16-main.service

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/pg_dump -Fc -d metricas_unifi -f /var/backups/postgres/metricas-%i.dump
```

`/etc/systemd/system/metricas-backup.timer`:
```ini
[Unit]
Description=Backup diário do metricas_unifi às 02:30

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
Unit=metricas-backup.service

[Install]
WantedBy=timers.target
```

Ativar:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now metricas-backup.timer
```

### Rotação (manter 14 dias)

Adicionar em `/etc/cron.d/metricas-backup-rotate`:
```
0 3 * * * postgres find /var/backups/postgres -name 'metricas-*.dump' -mtime +14 -delete
```

### Backups off-site

Recomendamos criptografar antes de enviar para object storage:
```bash
gpg --symmetric --cipher-algo AES256 /var/backups/postgres/metricas-2026-01-01.dump
rclone copy metricas-2026-01-01.dump.gpg remote:backup-bucket
```

### `pg_basebackup` (físico, para grandes volumes ou PITR)

Cria role de replicação:
```sql
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'senha-repl';
```

E configura `pg_hba.conf` para `replication`. Depois:
```bash
sudo -u postgres pg_basebackup -D /var/backups/postgres/base \
  -Ft -z -P -U replicator -h localhost
```

> **Aviso:** teste o restore mensalmente. Backup que nunca foi restaurado é
> backup que provavelmente não funciona.

---

## 16. Restore

### A partir de `pg_dump -Fc`

```bash
# 1. Parar a app.
sudo systemctl stop metricas-unifi  # ou: docker compose stop metricas-unifi

# 2. Recriar o banco vazio.
sudo -u postgres dropdb metricas_unifi
sudo -u postgres createdb -O metricas_app metricas_unifi

# 3. CRÍTICO: criar a extensão TimescaleDB ANTES do restore.
sudo -u postgres psql -d metricas_unifi -c 'CREATE EXTENSION timescaledb;'

# 4. Restore.
sudo -u postgres pg_restore --no-owner --role=metricas_app \
  -d metricas_unifi /var/backups/postgres/metricas-2026-01-01.dump

# 5. Subir a app.
sudo systemctl start metricas-unifi
```

> **Aviso:** TimescaleDB **exige** que a extensão exista antes do `pg_restore`,
> senão os comandos `create_hypertable` no dump falham.

---

## 17. Monitoramento

### Extensões úteis

```sql
-- Já vem com Timescale (configurado pelo timescaledb-tune).
SELECT * FROM pg_extension WHERE extname IN ('pg_stat_statements', 'timescaledb');
```

### Queries de inspeção

```sql
-- Tamanho do banco.
SELECT pg_size_pretty(pg_database_size('metricas_unifi'));

-- Tabelas maiores.
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;

-- Hypertables e número de chunks.
SELECT * FROM timescaledb_information.hypertables;

-- Jobs de retenção em ação.
SELECT * FROM timescaledb_information.jobs;

-- Chunks de uma tabela específica.
SELECT show_chunks('metrics_5m');

-- Top queries por tempo de execução.
SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

---

## 18. Upgrade

### Extensão TimescaleDB

```bash
sudo apt update
sudo apt install --only-upgrade timescaledb-2-postgresql-16
sudo systemctl restart postgresql@16-main
sudo -u postgres psql -d metricas_unifi -c 'ALTER EXTENSION timescaledb UPDATE;'
```

### Major do Postgres (ex.: 16 → 17)

> **Aviso:** SEMPRE faça um backup `pg_dump -Fc` completo antes de major
> upgrade. E verifique a matriz de compatibilidade do Timescale para a versão
> do Postgres alvo.

```bash
# Instalar novo major.
sudo apt install -y postgresql-17 timescaledb-2-postgresql-17

# Upgrade in-place (ferramenta Debian).
sudo pg_upgradecluster 16 main

# Validar e remover cluster antigo.
sudo pg_lsclusters
sudo pg_dropcluster 16 main --stop
```

---

## 19. Migração de dados desde a versão SQLite

A v2.x do `metricas-unifi` quebra compatibilidade com `app.db` (SQLite). Se
você está vindo da v1.x, há dois caminhos:

### 19.1 Recomendado: subir limpo + backfill

1. Subir a v2.x apontando para um Postgres novo (`DATABASE_URL=...`).
2. Após criar os controllers via Web UI, a app irá enfileirar coletas e o
   endpoint `/api/v1/controllers/:id/backfill` puxa o histórico disponível
   no controller UniFi.
3. O histórico recuperável depende do que o controller retém em `stat/report`
   (tipicamente: 5 minutos = ~3 dias, hourly = ~7 dias, daily = ~1 ano).

### 19.2 Alternativa: importação manual via `\copy`

Para preservar dados que não estão mais disponíveis no controller:

```bash
# 1. No host com o app.db da v1.x, exporta cada tabela como CSV.
sqlite3 /caminho/app.db <<EOF
.headers on
.mode csv
.output controllers.csv
SELECT * FROM controllers;
.output sites.csv
SELECT * FROM sites;
.output devices.csv
SELECT * FROM devices;
.output clients.csv
SELECT * FROM clients;
.output metrics_5m.csv
SELECT * FROM metrics_5m;
-- ... e assim por diante
EOF

# 2. No host do Postgres novo, importa via \copy.
sudo -u postgres psql -d metricas_unifi <<EOF
\copy controllers FROM 'controllers.csv' CSV HEADER
\copy sites FROM 'sites.csv' CSV HEADER
-- ...
EOF
```

> **Atenção:** SQLite armazena booleans como `0/1` mas o schema novo usa
> `boolean` real. Os campos `enabled`, `insecure_tls`, `is_guest`, `is_wired`,
> `enable`, `up`, `full_duplex`, `poe_enable` precisam ser convertidos via
> `CASE WHEN col = 1 THEN true ELSE false END` no SQL de import. Os campos
> `bytea` (`password_enc`, `api_key_enc`) precisam de tratamento especial —
> exporte como hex e importe com `\\x` prefix.

Migração manual é trabalhosa. **Recomendamos subir limpo na v2.x** salvo se
você tem dados históricos críticos.

---

## 20. Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `FATAL: role "metricas_app" does not exist` | Role não foi criada | Repita a seção 8. |
| `FATAL: no pg_hba.conf entry for host ...` | Falta entry para o IP da app | Adicione linha em `pg_hba.conf` (seção 7) e `SELECT pg_reload_conf()`. |
| `connection refused` | `listen_addresses` errado ou firewall fechado | Verifique seção 11 + seção 12 + `systemctl status postgresql@16-main`. |
| `could not load library ".../timescaledb.so"` | `shared_preload_libraries` não inclui timescaledb | Rode `timescaledb-tune --quiet --yes` e reinicie. |
| `ERROR: extension "timescaledb" must be loaded via shared_preload_libraries` | Idem acima | Idem. |
| `out of shared memory` em queries com muitos chunks | `max_locks_per_transaction` baixo | Aumente para 256+ em `postgresql.conf` e reinicie. |
| `relation "metrics_5m" does not exist` | Migrations não rodaram | `npm run db:migrate` no host da app, ou conferir logs de boot da app. |
| `permission denied for schema public` | Faltaram GRANTs | Conceder USAGE/CREATE (seção 8). |
| `SSL connection required` | `pg_hba.conf` exige `hostssl` mas cliente usa `host` | Ajuste `sslmode` na URL (`sslmode=require`+). |

---

## 21. Checklist de produção

- [ ] `pg_hba.conf` revisado: zero `trust`, zero `md5`, só `scram-sha-256`/`peer` local.
- [ ] `listen_addresses` é o mínimo necessário (`localhost` ou IP da NIC interna).
- [ ] Firewall fechado por default; só IP da app autorizado em 5432.
- [ ] SSL/TLS ligado no Cenário B; cliente com `sslmode=verify-full` e CA distribuído.
- [ ] Senha forte da role da app, armazenada em cofre de segredos, rotacionada anualmente.
- [ ] `MASTER_KEY` e `JWT_SECRET` regenerados se eram de dev.
- [ ] Backup automatizado via systemd timer + retenção 14d + cópia off-site criptografada.
- [ ] Restore testado nos últimos 30 dias.
- [ ] `pg_stat_statements` habilitado.
- [ ] `log_min_duration_statement` ligado para detectar queries lentas.
- [ ] Monitoramento de disco com alerta > 80% (Prometheus node_exporter, Netdata, etc).
- [ ] Plano de upgrade documentado e testado em staging.
- [ ] (Opcional) Read replica via streaming replication para dashboards pesados.

---

## 22. Segurança — resumo das obrigações

- **Nunca exponha 5432 à internet pública.** Use VPN/wireguard se a app
  estiver em outra rede.
- **`scram-sha-256` é obrigatório.** `md5` foi quebrado em 2017; `trust` é
  porta aberta.
- **TLS é obrigatório quando o tráfego sai do host.** `sslmode=require` é o
  piso; `verify-full` é o correto.
- **Backups em repouso devem ser criptografados.** Use `gpg --symmetric` ou
  bucket com SSE-KMS.
- **Princípio de menor privilégio.** A app NÃO precisa ser superuser. Conceda
  só `CONNECT` + `USAGE`/`CREATE` no schema. Superuser é só para o operador
  humano via socket local.
- **`DATABASE_URL` contém credenciais.** Permissão `chmod 600` no `.env` e
  garanta que logs do Pino redactam essa variável (não logamos `process.env`
  diretamente).

---

## 23. Caveats de versão do Debian

- **Debian 11 (bullseye):** suportado, mas PGDG só oferece até Postgres 16.
- **Debian 13 (trixie):** quando lançado, validar versionamento de pacotes
  Timescale antes de adotar.
- **Ubuntu 22.04/24.04:** os passos são idênticos (mesmo `apt`, mesma stack).
  Substitua `bookworm` por `jammy`/`noble` nas linhas do APT.
