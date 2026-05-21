/**
 * PM2 ecosystem para metricas-unifi (alternativa ao systemd).
 *
 * Uso:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup    # auto-start no boot (rode o comando que `pm2 startup` imprimir)
 *   pm2 logs metricas-unifi
 *
 * Pré-requisitos:
 *   - Node.js >= 22 (usa `--env-file` nativo).
 *   - `npm ci && npm run build` já executados no diretório.
 *   - `.env` preenchido (DATABASE_URL, MASTER_KEY, JWT_SECRET, POSTGRES_PASSWORD).
 *   - `chmod 600 .env`.
 *
 * Notas:
 *   - `instances: 1` é obrigatório. O collector e os cronjobs (croner) não
 *     suportam múltiplas réplicas de processo — cluster mode causa coleta
 *     duplicada. Para paralelizar a coleta entre controllers, ajuste
 *     `COLLECTOR_WORKERS=N` no `.env` (workers internos compartilham a fila
 *     via `FOR UPDATE SKIP LOCKED`, sem duplicação).
 *   - `--env-file=.env` é resolvido relativo ao `cwd`.
 *   - `--import tsx` habilita TypeScript em runtime sem build de servidor.
 */
module.exports = {
  apps: [
    {
      name: 'metricas-unifi',
      cwd: __dirname,
      script: 'src/server/index.ts',
      interpreter: 'node',
      interpreter_args: '--env-file=.env --import tsx',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      kill_timeout: 10000,
      wait_ready: false,
      merge_logs: true,
      time: true,
    },
  ],
};
