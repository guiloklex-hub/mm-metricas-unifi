import { buildCollector, startCollector, stopCollector } from './collector/index.ts';
import { createDb } from './db/client.ts';
import { runBootstrapSql, runMigrations } from './db/migrate.ts';
import { loadEnv } from './env.ts';
import { buildApp } from './http/app.ts';
import { createLogger } from './logger.ts';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  logger.info({ env: env.NODE_ENV }, 'iniciando metricas-unifi');

  const db = createDb({ url: env.DATABASE_URL });
  await runMigrations(db);
  logger.info('migrations aplicadas');

  await runBootstrapSql(db.$pool, {
    retention5mDays: env.RETENTION_5M_DAYS,
    retention1hDays: env.RETENTION_1H_DAYS,
  });
  logger.info('bootstrap timescale aplicado (extensão, hypertables, retention)');

  const collector = buildCollector({
    db,
    logger,
    masterKey: env.MASTER_KEY,
    retention5mDays: env.RETENTION_5M_DAYS,
    retention1hDays: env.RETENTION_1H_DAYS,
    workers: env.COLLECTOR_WORKERS,
  });
  await startCollector(collector);

  const app = await buildApp({
    db,
    queue: collector.queue,
    pool: collector.pool,
    logger,
    jwtSecret: env.JWT_SECRET,
    masterKey: env.MASTER_KEY,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown solicitado');
    try {
      await app.close();
      await stopCollector(collector);
      await db.$pool.end();
      logger.info('shutdown concluído');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'erro durante shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'servidor escutando');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
