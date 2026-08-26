import cors from '@fastify/cors';
import Fastify from 'fastify';

import { config } from './config';

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

app.get('/health', async () => {
  return {
    status: 'ok',
  };
});

const start = async (): Promise<void> => {
  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
