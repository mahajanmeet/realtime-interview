import { ClientSignalMessageSchema, type AppRole } from '@interview/shared';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SessionService } from '../sessions/session-service';

type PeerSocket = {
  readyState: number;
  bufferedAmount: number;
  terminate(): void;
  send(data: string): void;
};

type ConnectedPeers = Partial<Record<AppRole, PeerSocket>>;

const OPEN = 1;

export const registerSignalingRoutes = async (
  app: FastifyInstance,
  sessions: SessionService,
): Promise<void> => {
  const connections = new Map<string, ConnectedPeers>();

  app.get(
    '/ws',
    {
      websocket: true,
    },
    (socket, request) => {
      const query = z
        .object({
          ticket: z.string().min(20),
        })
        .safeParse(request.query);

      if (!query.success) {
        socket.close(1008, 'Missing signaling ticket.');
        return;
      }

      const identity = sessions.consumeSignalTicket(query.data.ticket);

      if (!identity) {
        socket.close(1008, 'Invalid or expired signaling ticket.');
        return;
      }

      const { sessionId, role } = identity;

      let peers = connections.get(sessionId);

      if (!peers) {
        peers = {};
        connections.set(sessionId, peers);
      }

      const existingSocket = peers[role];

      if (existingSocket && existingSocket.readyState === OPEN) {
        socket.close(1008, 'This role is already connected.');

        return;
      }

      peers[role] = socket;
      let alive = true;
      socket.on('pong', () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        if (socket.readyState === OPEN) socket.ping();
      }, 15_000);
      heartbeat.unref();
      socket.on('error', () => socket.terminate());

      const otherRole: AppRole = role === 'interviewer' ? 'candidate' : 'interviewer';

      const otherPeer = peers[otherRole];

      if (otherPeer && otherPeer.readyState === OPEN) {
        otherPeer.send(
          JSON.stringify({
            type: 'peer-connected',
            role,
          }),
        );

        socket.send(
          JSON.stringify({
            type: 'peer-connected',
            role: otherRole,
          }),
        );
      }

      socket.on('message', (raw) => {
        let decoded: unknown;

        try {
          decoded = JSON.parse(raw.toString());
        } catch {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'Invalid JSON message.',
            }),
          );

          return;
        }

        const message = ClientSignalMessageSchema.safeParse(decoded);

        if (!message.success) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'Invalid signaling message.',
            }),
          );

          return;
        }

        const destination = peers?.[otherRole];

        if (destination && destination.readyState === OPEN) {
          // Disconnect a stalled reader instead of buffering seconds of stale
          // text indefinitely. Recent snapshots replay after reconnect.
          if (destination.bufferedAmount > 128 * 1024) {
            destination.terminate();
            return;
          }
          if (message.data.type === 'transcript-segment') {
            // The server derives the speaker from the authenticated, single-use
            // signaling ticket. A client cannot label a segment as the other peer.
            destination.send(
              JSON.stringify({
                ...message.data,
                speaker: role,
              }),
            );
            return;
          }

          destination.send(JSON.stringify(message.data));
        }
      });

      socket.on('close', () => {
        clearInterval(heartbeat);
        const current = connections.get(sessionId);

        if (!current) {
          return;
        }

        // A late close from the previous connection must not mark its
        // replacement as disconnected.
        if (current[role] !== socket) return;
        delete current[role];

        const remaining = current[otherRole];

        if (remaining && remaining.readyState === OPEN) {
          remaining.send(
            JSON.stringify({
              type: 'peer-disconnected',
              role,
            }),
          );
        }

        if (!current.interviewer && !current.candidate) {
          connections.delete(sessionId);
        }
      });
    },
  );
};
