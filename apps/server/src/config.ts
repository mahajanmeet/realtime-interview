const parseUrls = (value: string | undefined, fallback: string[]): string[] => {
  const urls = value
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  return urls && urls.length > 0 ? urls : fallback;
};

const turnSharedSecret = process.env.TURN_SHARED_SECRET?.trim() || null;
const turnUrls = parseUrls(process.env.TURN_URLS, []);

if ((turnSharedSecret === null) !== (turnUrls.length === 0)) {
  throw new Error('TURN_SHARED_SECRET and TURN_URLS must be configured together.');
}

const iceTransportPolicy = process.env.RTC_ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all';

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8787),
  stunUrls: parseUrls(process.env.STUN_URLS, ['stun:stun.l.google.com:19302']),
  turnSharedSecret,
  turnUrls,
  iceTransportPolicy,
};
