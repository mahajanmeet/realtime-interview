const parseUrls = (value: string | undefined, fallback: string[]): string[] => {
  const urls = value
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  return urls && urls.length > 0 ? urls : fallback;
};

const turnSharedSecret = process.env.TURN_SHARED_SECRET?.trim() || null;
const turnUrls = parseUrls(process.env.TURN_URLS, []);
const turnUsername = process.env.TURN_USERNAME?.trim() || null;
const turnCredential = process.env.TURN_CREDENTIAL?.trim() || null;

if ((turnUsername === null) !== (turnCredential === null)) {
  throw new Error('TURN_USERNAME and TURN_CREDENTIAL must be configured together.');
}

if (turnUrls.length === 0 && (turnSharedSecret !== null || turnUsername !== null)) {
  throw new Error('TURN_URLS must be configured when TURN credentials are configured.');
}

if (turnUrls.length > 0 && turnSharedSecret === null && turnUsername === null) {
  throw new Error('Configure TURN_SHARED_SECRET or TURN_USERNAME and TURN_CREDENTIAL with TURN_URLS.');
}

if (turnSharedSecret !== null && turnUsername !== null) {
  throw new Error('Use either TURN_SHARED_SECRET or TURN_USERNAME and TURN_CREDENTIAL, not both.');
}

const iceTransportPolicy = process.env.RTC_ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all';

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8787),
  stunUrls: parseUrls(process.env.STUN_URLS, ['stun:stun.l.google.com:19302']),
  turnSharedSecret,
  turnUrls,
  turnUsername,
  turnCredential,
  iceTransportPolicy,
};
