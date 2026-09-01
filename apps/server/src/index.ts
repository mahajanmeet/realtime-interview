import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { config } from './config';
import { SessionService } from './sessions/session-service';
import { registerSessionRoutes } from './sessions/session-routes';
import { registerSignalingRoutes } from './signaling/signaling-handler';
import { registerRtcConfigRoute } from './turn/rtc-config-route';

const app = Fastify({
  logger: true,
});

const sessions = new SessionService();

await app.register(cors, {
  origin: true,
});

await app.register(websocket);

await registerSessionRoutes(app, sessions);

await registerSignalingRoutes(app, sessions);

await registerRtcConfigRoute(app, sessions);

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
