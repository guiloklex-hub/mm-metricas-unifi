# Contribuindo com mm-metricas-unifi

Obrigado pelo interesse. Este projeto resolve um problema real (BI de Wi-Fi UniFi multi-filial) e cada melhoria importa.

## Como ajudar

- **Reporte bugs** abrindo uma issue com passos de reprodução, versão do controller UniFi e versão do projeto.
- **Sugira features** via issue marcada como `enhancement`. Para mudanças grandes, discuta antes de codar.
- **Envie PRs** seguindo o fluxo abaixo.
- **Compartilhe payloads UniFi** (anonimizados) de firmwares diferentes — ajuda o parser a cobrir mais variantes.

## Pré-requisitos

- Node.js 22 (use `nvm use`)
- npm (ou pnpm — o lockfile mestre é npm)
- SQLite 3 (já vem via better-sqlite3)
- Docker (opcional, para testes de empacotamento)

## Setup local

```bash
git clone <fork>
cd mm-metricas-unifi
nvm use
npm install
cp .env.example .env
# Gerar MASTER_KEY e JWT_SECRET

npm run db:generate
npm run db:migrate
npm run dev
```

## Fluxo de PR

1. Crie um branch a partir de `main`: `git checkout -b feat/descritivo` ou `fix/descritivo`.
2. Faça alterações pequenas e focadas — um PR, um tema.
3. Mantenha `npm run lint`, `npm run typecheck` e `npm run test` verdes.
4. Adicione testes — unit para utilidades, integration para fluxos.
5. Atualize documentação: `docs/`, README ou ADR se aplicável.
6. Commit com mensagens claras descrevendo **o quê** e **por quê**. Sem mensagens genéricas tipo "fix", "update".
7. Abra PR contra `main` com checklist preenchido.

### Estilo de commit

```
feat(collector): suportar campo radio_table em firmwares 7.x
fix(unifi): tratar 401 ao renovar sessão em UniFi OS
docs(adr): registrar decisão de SQLite vs Postgres
chore(deps): bump fastify 5.1 → 5.2
```

Tipos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`.

## Padrões de código

- TypeScript strict. `noUncheckedIndexedAccess` ativo.
- Biome formata + lint (`npm run lint:fix`).
- Sem `any` em código novo (exceto adaptadores de API UniFi onde o schema é incerto — sempre com comentário explicando).
- Use o logger Pino, nunca `console.log`. Erros através do `logger.error({ err }, 'msg')`.
- Toda nova query SQL passa em pelo menos 1 teste de integração.
- Toda função de cálculo (delta, taxa, rollup) tem teste unitário cobrindo edge cases.

## Estrutura do projeto

Veja [docs/architecture.md](docs/architecture.md). Resumo: `src/server/` (Fastify + collector + DB), `src/web/` (Vite SPA), `src/shared/` (Zod schemas comuns), `tests/` (Vitest + Playwright).

## Antes de submeter

- [ ] `npm run lint` verde
- [ ] `npm run typecheck` verde
- [ ] `npm run test` verde
- [ ] Cobertura não regrediu (`npm run test:coverage`)
- [ ] Documentação atualizada (se aplicável)
- [ ] Changelog (se mudança visível ao usuário)
- [ ] Sem `console.log` ou `TODO` sem dono

## Segurança

Bugs com impacto de segurança não vão em issue público — veja [SECURITY.md](SECURITY.md).

## Código de conduta

Veja [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Resumo: seja decente.
