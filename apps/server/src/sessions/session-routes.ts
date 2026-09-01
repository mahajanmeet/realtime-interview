import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SessionService } from './session-service';

const JoinSessionBodySchema = z.object({
  code: z.string().min(6).max(10),
});

const TicketBodySchema = z.object({
  peerToken: z.string().min(20),
});

export const registerSessionRoutes = async (
  app: FastifyInstance,
  sessions: SessionService,
): Promise<void> => {
  app.post('/api/sessions', async () => {
    return sessions.createSession();
  });

  app.post('/api/sessions/join', async (request, reply) => {
    const parsed = JoinSessionBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid interview code.',
      });
    }

    try {
      return sessions.joinSession(parsed.data.code);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not join session.';

      return reply.status(400).send({
        message,
      });
    }
  });

  app.post('/api/sessions/:sessionId/signal-ticket', async (request, reply) => {
    const params = z
      .object({
        sessionId: z.string().uuid(),
      })
      .safeParse(request.params);

    const body = TicketBodySchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.status(400).send({
        message: 'Invalid request.',
      });
    }

    try {
      const signalTicket = sessions.issueSignalTicket(params.data.sessionId, body.data.peerToken);

      return {
        signalTicket,
      };
    } catch {
      return reply.status(401).send({
        message: 'Invalid session credentials.',
      });
    }
  });
};
