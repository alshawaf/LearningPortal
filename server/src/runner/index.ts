import { config } from '../config.js';
import { buildRunnerApp } from './app.js';

const app = await buildRunnerApp();
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down runner');
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
await app.listen({ host: config.runnerHost, port: config.runnerPort });
