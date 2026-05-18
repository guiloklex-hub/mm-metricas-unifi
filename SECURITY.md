# Política de Segurança

## Reportando vulnerabilidades

Encontrou uma vulnerabilidade que afeta confidencialidade, integridade ou disponibilidade do sistema?

**Não abra issue público.** Em vez disso:

1. Mande email para `security@<dominio-do-mantenedor>` (substituir pelo email oficial quando definido) com:
   - Descrição do problema
   - Passos para reproduzir
   - Versão afetada
   - Impacto estimado
   - Proof of concept (se houver)
2. Use a opção de **GitHub Security Advisory** no repositório (botão "Report a vulnerability" na aba Security).

Esperamos responder dentro de **72h úteis** com uma confirmação. Patches e disclosure coordenado seguem após investigação.

## Escopo

Cobre o código deste repositório. Não cobre:

- Vulnerabilidades em dependências (reporte ao upstream — citamos no relatório quando ajuda)
- Configurações inseguras feitas pelo operador (ex: expor a porta sem reverse proxy, deixar `MASTER_KEY` no git)
- Vulnerabilidades no próprio UniFi Network — reporte à Ubiquiti

## Práticas internas

- Senhas dos controllers são cifradas com AES-GCM (`MASTER_KEY`).
- Senhas de admin: argon2id.
- JWTs assinados HS256 com `JWT_SECRET`, cookie `httpOnly; SameSite=Lax`.
- Comparação de secrets em código com `timingSafeEqual`.
- TLS auto-assinado dos controllers é opt-in por controller; default valida cert.
- CI roda CodeQL no PR.

## Sem hall of fame por enquanto

Reconheço quem reporta no changelog quando confirmado. Sem programa de bug bounty.
