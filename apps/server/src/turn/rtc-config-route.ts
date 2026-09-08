import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config';
import type { SessionService } from '../sessions/session-service';
import { TurnService } from './turn-service';

const RtcConfigBodySchema = z.object({
  sessionId: z.string().uuid(),
  peerToken: z.string().min(20),
});

export const registerRtcConfigRoute = async (
  app: FastifyInstance,
  sessions: SessionService,
): Promise<void> => {
  const turnService =
    config.turnSharedSecret && config.turnUrls.length > 0
      ? new TurnService(config.turnSharedSecret, config.turnUrls)
      : null;
  const staticTurnCredentials =
    config.turnUsername && config.turnCredential && config.turnUrls.length > 0
      ? {
          urls: config.turnUrls,
          username: config.turnUsername,
          credential: config.turnCredential,
        }
      : null;

  app.post('/api/rtc-config', async (request, reply) => {
    const body = RtcConfigBodySchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        message: 'Invalid realtime configuration request.',
      });
    }

    try {
      const identity = sessions.authenticatePeer(body.data.sessionId, body.data.peerToken);
      const iceServers: Array<{
        urls: string[];
        username?: string;
        credential?: string;
      }> = [
        {
          urls: config.stunUrls,
        },
      ];

      if (turnService) {
        const credentials = turnService.createCredentials(`${identity.sessionId}:${identity.role}`);

        iceServers.push(credentials);
      } else if (staticTurnCredentials) {
        iceServers.push(staticTurnCredentials);
      }

      return {
        iceServers,
        iceTransportPolicy: config.iceTransportPolicy,
      };
    } catch {
      return reply.status(401).send({
        message: 'Invalid session credentials.',
      });
    }
  });
};
