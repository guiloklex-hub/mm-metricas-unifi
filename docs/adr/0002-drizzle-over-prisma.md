# ADR 0002 — Drizzle ORM (não Prisma)

**Data:** 2026-05
**Status:** Aceito

## Contexto

Precisamos de uma camada de acesso a SQLite com:

- Migrations versionadas
- Tipagem forte em TypeScript
- Suporte a queries de agregação (rollup) com `GROUP BY`, janelas, `ON CONFLICT`
- Sem schema engine externo pesando no container

Opções:

1. **Drizzle ORM 0.36+** — TS-first, gera SQL legível, migrations TS puras.
2. **Prisma 7** — popular na org, mas mais pesado, gera schema engine binário.
3. **better-sqlite3 cru** — máxima performance, mas DDL e migrations viram trabalho manual.

## Decisão

**Drizzle ORM 0.36+** com `better-sqlite3` 12 como driver. Migrations geradas com `drizzle-kit` no diretório `drizzle/`. Queries de rollup escritas em SQL cru via `db.run(sql\`...\`)`.

## Consequências

### Vantagens

- **Bundle menor:** Drizzle ~200KB vs Prisma ~80MB (engine binário).
- **SQL legível** em todas as queries — fica óbvio o que vai para o banco.
- **CTEs e janelas:** Drizzle suporta nativamente. Prisma só recentemente.
- **Migrations em TS:** sem schema custom DSL, sem `prisma generate` antes de cada build.
- **Testes mais rápidos:** sem engine binário para inicializar em `:memory:`.

### Limitações aceitas

- DX menos polida que Prisma Studio (mas `drizzle-kit studio` existe).
- Comunidade menor — mais issues a resolver lendo código fonte.
- Mais boilerplate em CRUDs simples vs Prisma.

### Quando reconsiderar

- Se complexidade de queries CRUD virar maior que de agregação (improvável aqui — somos majoritariamente leitura analítica).
- Se a org padronizar Prisma em todos projetos com tooling compartilhado.
