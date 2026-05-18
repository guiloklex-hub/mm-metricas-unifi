# Notas — APIs UniFi (mai/2026)

> Atualize aqui sempre que descobrir uma divergência entre firmwares. Esta página é o ponto canônico do projeto.

## Alvos suportados

| Alvo | Hosts típicos | Porta | Prefixo |
|---|---|---|---|
| **UniFi OS Console** | UDM/UDM Pro/UDM SE, UCK G2+, UDR, UDW, Dream Machine | 443 | `/proxy/network/api/...` |
| **Network Application self-hosted** | Linux server, Docker `linuxserver/unifi-network-application` | 8443 | `/api/...` direto |

Não testado oficialmente, mas próximo: **UniFi Site Manager** (cloud em `api.ui.com`) — pode ser adicionado via adapter no futuro.

## Detecção runtime

O probe usa duas heurísticas:

1. `GET /` na raiz: se a resposta traz header `x-csrf-token`, é UniFi OS.
2. `GET /proxy/network/api/self` retorna 200/401 em UniFi OS; 404 em Classic.

Resultado persistido em `controllers.variant`. Em qualquer erro 404 no login subsequente, re-roda a detecção (corrige drift).

## Autenticação

### 1) API Key oficial (preferida quando disponível)

Disponível em Network Application 9.3+ (GA mar/2025). Gerada na UI:
**Control Plane → Integrations → Create API Key**.

```http
GET /proxy/network/integration/v1/sites HTTP/1.1
Host: udm.local
X-API-KEY: abc123...
```

- Stateless. Sem CSRF, sem cookie, sem 2FA.
- Não expira (revogada manualmente).
- Network Application < 9.x **não suporta** — usar login local.

### 2) Login local + cookie + CSRF

**UniFi OS:**

```
POST /api/auth/login
Body: {"username":"admin","password":"...","remember":true}
Headers de resposta:
  Set-Cookie: TOKEN=<jwt>; HttpOnly
  X-CSRF-Token: <hex>   (rotativo — re-ler em cada resposta)
```

**Self-hosted (porta 8443):**

```
POST /api/login
Body: {"username":"admin","password":"..."}
Headers de resposta:
  Set-Cookie: unifises=...
  Set-Cookie: csrf_token=...
```

Em ambos, mutations (POST/PUT/DELETE) exigem header `X-CSRF-Token` (em versões 9.x do self-hosted também). Re-ler header em cada resposta e atualizar antes do próximo request.

**Logout:** `POST /api/logout` (self-hosted) ou `POST /api/auth/logout` (OS).

### 3) 2FA

- Login local em conta com 2FA retorna **HTTP 499** + `meta.msg = "api.err.Ubic2faTokenRequired"`. Reenvie POST com `"token":"123456"`.
- Contas **local-only** em UniFi OS são isentas de MFA — use uma conta de serviço dedicada.
- API Key bypassa 2FA totalmente.

### 4) Expiração

Cookie de sessão dura ~2h (varia por versão). Wrapper de cliente detecta 401, re-loga sob mutex e re-tenta uma vez. Mais de uma falha consecutiva = backoff exponencial.

## Endpoints de estatística (API privada)

Resposta padrão: `{"data":[...], "meta":{"rc":"ok"}}`.

| Função | Path | Notas |
|---|---|---|
| Sites visíveis | `GET /api/self/sites` | Filtra por permissão do usuário. |
| Info site | `GET /api/s/{site}/stat/sites` | `health`, `num_user`, `num_ap`. |
| Devices completos | `GET /api/s/{site}/stat/device` | Inclui `radio_table_stats[]`. **Endpoint principal de coleta.** |
| 1 device por MAC | `GET /api/s/{site}/stat/device/{mac}` | Útil para troubleshooting pontual. |
| Clientes ativos | `GET /api/s/{site}/stat/sta` | Snapshot atual. |
| Hist. cliente | `GET /api/s/{site}/stat/user/{mac}` | Sessões + bytes. |
| Todos clientes hist. | `GET /api/s/{site}/stat/alluser` | Param `within=<horas>` (default 24h). |
| Health site | `GET /api/s/{site}/stat/health` | Estado WAN, www, lan. |
| Reports agregados | `POST /api/s/{site}/stat/report/{interval}.{subject}` | Ver tabela abaixo. |

### Intervals de `stat/report`

| Interval | Subjects | Retenção interna do controller |
|---|---|---|
| `5minutes` | site, ap, user, gw | ~12h |
| `hourly` | site, ap, user, gw | ~7 dias |
| `daily` | site, ap, user, gw | ~52 semanas |
| `monthly` | site, ap, user, gw | ~52 meses |

Body do POST: `{"start":<unix_ms>, "end":<unix_ms>, "attrs":["bytes","tx_bytes","rx_bytes","num_sta","time"]}`. `time` em **ms** (não segundos).

## Schema de `stat/device` (campos relevantes)

```jsonc
{
  "_id": "...",
  "mac": "...",
  "name": "AP-CWB-01",
  "model": "U6-Pro",
  "type": "uap",
  "site_id": "...",
  "uptime": 123456,
  "tx_bytes": 1234567890,        // device-level acumulado
  "rx_bytes": 987654321,
  "tx_packets": 1000000,
  "rx_packets": 800000,
  "tx_dropped": 12,
  "tx_errors": 3,
  "tx_retries": 4567,
  "num_sta": 24,
  "user-num_sta": 22,
  "guest-num_sta": 2,
  "radio_table_stats": [
    {
      "name": "wifi0",
      "radio": "ng",             // ng=2.4GHz, na=5GHz, 6e=6GHz
      "channel": 6,
      "tx_power": 17,
      "state": "RUN",
      "num_sta": 8,
      "user-num_sta": 7,
      "guest-num_sta": 1,
      "tx_packets": 234567,
      "tx_retries": 1234,
      "tx_bytes": 89012345,
      "cu_self_rx": 12,
      "cu_self_tx": 8,
      "cu_total": 35            // channel utilization %
    },
    { "name": "wifi1", "radio": "na", "...": "..." },
    { "name": "wifi2", "radio": "6e", "...": "..." }
  ]
}
```

### Cuidados

- `tx_dropped`, `tx_errors` ficam **no nível do device** (não por rádio) em UAPs. Em switches estão em `port_table[]`.
- `rx_*` por rádio nem sempre existe em firmwares < 8.x — coletar com fallback null.
- `radio` muda nome entre firmwares; manter tabela de aliases no parser.
- Contadores são **acumulados desde o último reset do device**. Algoritmo de delta em [`src/server/collector/delta.ts`](../src/server/collector/delta.ts) trata reboot.

## Limites e pegadinhas

- **Paginação:** `_limit`, `_start`, `_sort` (prefixo `-` desc), `_attrs`. Sem param = resposta gigante.
- **`stat/report`** rejeita ranges longos demais por interval — respeite a retenção interna.
- **Rate limit:** não documentado na API privada. Observado: > ~10 req/s por sessão causa erros transitórios. API Cloud Site Manager: 10k/min com 429 + `Retry-After`.
- **TLS auto-assinado** é padrão. `undici.Agent({ connect: { rejectUnauthorized: false } })` é necessário a menos que o operador instale CA válida (Caddy/LE). Oferecemos pinning SHA-256 opcional.
- **Versão do controller** pode renomear campos silenciosamente. Snapshot tests no `parser.ts` detectam regressões.

## Fontes

- [Ubiquiti Community Wiki — Controller API](https://ubntwiki.com/products/software/unifi-controller/api)
- [Help UI — Official UniFi API](https://help.ui.com/hc/en-us/articles/30076656117655)
- [Art of WiFi — UniFi APIs Practical Guide](https://artofwifi.net/unifi-api)
- [unpoller/unpoller (Go reference)](https://github.com/unpoller/unpoller) — schemas mais completos em código aberto
- [jens-maus/node-unifi](https://github.com/jens-maus/node-unifi) — referência Node
- [thib3113/unifi-client](https://www.npmjs.com/package/unifi-client) — referência TS
