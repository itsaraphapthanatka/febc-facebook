import { env } from './env';
import { pool } from './db/client';
import { startScheduler, stopScheduler } from './scheduler/scheduler';
import { buildServer } from './server';

async function main() {
  const app = await buildServer();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  await startScheduler(app.log);
  app.log.info({ baseUrl: env.BASE_URL }, 'febc-facebook middleware ready');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopScheduler();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
