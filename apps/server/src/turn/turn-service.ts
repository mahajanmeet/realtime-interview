import { createHmac } from 'node:crypto';

export type TurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
};

const TURN_TTL_SECONDS = 60 * 60;

export class TurnService {
  constructor(
    private readonly secret: string,
    private readonly urls: string[],
  ) {}

  createCredentials(identity: string): TurnCredentials {
    const expiresAt = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
    const username = `${expiresAt}:${identity}`;
    const credential = createHmac('sha1', this.secret).update(username).digest('base64');

    return {
      urls: this.urls,
      username,
      credential,
    };
  }
}
