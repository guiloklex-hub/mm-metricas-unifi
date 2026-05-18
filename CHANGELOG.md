# Changelog

Todas as mudanças notáveis aqui. Formato [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versionamento [SemVer](https://semver.org).

## [Unreleased]

### Added
- Scaffolding inicial do projeto (M0 — Foundation).
- Configuração de build: TypeScript, Vite, Biome, Vitest, Drizzle Kit.
- Schema SQLite inicial (controllers, sites, devices, metrics_5m/1h/1d, jobs, app_config, audit_log, counter_state).
- Fastify factory com healthz e estrutura de plugins.
- Bootstrap (env validado por Zod, logger Pino, migrate, listen).
- Docker multi-stage e docker-compose de exemplo.
- CI: lint + typecheck + test + build (GitHub Actions).
- Documentos open-source: README, LICENSE (MIT), CONTRIBUTING, SECURITY, CODE_OF_CONDUCT.
