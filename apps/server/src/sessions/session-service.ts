import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';

import type { AppRole } from '@interview/shared';

type Peer = {
  tokenHash: string;
};

type Session = {
  id: string;
  code: string;

  createdAt: number;
  expiresAt: number;

  interviewer: Peer;
  candidate?: Peer;
};

type SignalTicket = {
  sessionId: string;
  role: AppRole;
  expiresAt: number;
};

export type PeerIdentity = {
  sessionId: string;
  role: AppRole;
};

export type SessionCredentials = {
  sessionId: string;
  code: string;
  peerToken: string;
  signalTicket: string;
};

export type JoinedSession = {
  sessionId: string;
  peerToken: string;
  signalTicket: string;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const SIGNAL_TICKET_TTL_MS = 120 * 1000;

export class SessionService {
  private readonly sessions = new Map<string, Session>();

  private readonly sessionIdsByCode = new Map<string, string>();

  private readonly signalTickets = new Map<string, SignalTicket>();

  createSession(): SessionCredentials {
    this.cleanup();

    const id = randomUUID();
    const code = this.generateUniqueCode();

    const peerToken = this.generateToken();

    const session: Session = {
      id,
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,

      interviewer: {
        tokenHash: this.hash(peerToken),
      },
    };

    this.sessions.set(id, session);
    this.sessionIdsByCode.set(code, id);

    const signalTicket = this.createSignalTicket(id, 'interviewer');

    return {
      sessionId: id,
      code,
      peerToken,
      signalTicket,
    };
  }

  joinSession(code: string): JoinedSession {
    this.cleanup();

    const normalizedCode = code.replace(/\D/g, '');

    const sessionId = this.sessionIdsByCode.get(normalizedCode);

    if (!sessionId) {
      throw new Error('Interview code is invalid or expired.');
    }

    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error('Interview session no longer exists.');
    }

    if (Date.now() >= session.expiresAt) {
      this.deleteSession(session);
      throw new Error('Interview code has expired.');
    }

    if (session.candidate) {
      throw new Error('A candidate has already joined this interview.');
    }

    const peerToken = this.generateToken();

    session.candidate = {
      tokenHash: this.hash(peerToken),
    };
    // Keep the invitation short-lived, but allow a full working-day call and
    // authenticated reconnects after the candidate has joined.
    session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;

    const signalTicket = this.createSignalTicket(session.id, 'candidate');

    return {
      sessionId: session.id,
      peerToken,
      signalTicket,
    };
  }

  issueSignalTicket(sessionId: string, peerToken: string): string {
    const { role } = this.authenticatePeer(sessionId, peerToken);

    return this.createSignalTicket(sessionId, role);
  }

  authenticatePeer(sessionId: string, peerToken: string): PeerIdentity {
    this.cleanup();

    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error('Session not found.');
    }

    const tokenHash = this.hash(peerToken);

    if (session.interviewer.tokenHash === tokenHash) {
      return {
        sessionId,
        role: 'interviewer',
      };
    }

    if (session.candidate?.tokenHash === tokenHash) {
      return {
        sessionId,
        role: 'candidate',
      };
    }

    throw new Error('Invalid session credentials.');
  }

  consumeSignalTicket(ticket: string): {
    sessionId: string;
    role: AppRole;
  } | null {
    this.cleanup();

    const ticketHash = this.hash(ticket);

    const record = this.signalTickets.get(ticketHash);

    if (!record) {
      return null;
    }

    this.signalTickets.delete(ticketHash);

    if (Date.now() >= record.expiresAt) {
      return null;
    }

    return {
      sessionId: record.sessionId,
      role: record.role,
    };
  }

  private createSignalTicket(sessionId: string, role: AppRole): string {
    const ticket = this.generateToken();

    this.signalTickets.set(this.hash(ticket), {
      sessionId,
      role,
      expiresAt: Date.now() + SIGNAL_TICKET_TTL_MS,
    });

    return ticket;
  }

  private generateUniqueCode(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

      if (!this.sessionIdsByCode.has(code)) {
        return code;
      }
    }

    throw new Error('Could not generate an interview code.');
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private cleanup(): void {
    const now = Date.now();

    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) {
        this.deleteSession(session);
      }
    }

    for (const [ticketHash, ticket] of this.signalTickets) {
      if (ticket.expiresAt <= now) {
        this.signalTickets.delete(ticketHash);
      }
    }
  }

  private deleteSession(session: Session): void {
    this.sessions.delete(session.id);

    this.sessionIdsByCode.delete(session.code);
  }
}
