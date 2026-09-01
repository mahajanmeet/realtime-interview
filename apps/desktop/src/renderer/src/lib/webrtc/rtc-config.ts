import { getApiUrl } from '../api';

type RtcConfigError = {
  message?: string;
};

export const getRtcConfiguration = async (
  sessionId: string,
  peerToken: string,
): Promise<RTCConfiguration> => {
  const response = await fetch(`${getApiUrl()}/api/rtc-config`, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
    },

    body: JSON.stringify({
      sessionId,
      peerToken,
    }),
  });

  if (!response.ok) {
    let message = 'Could not load realtime network configuration.';

    try {
      const body = (await response.json()) as RtcConfigError;

      message = body.message ?? message;
    } catch {
      // Keep the safe default message when the response is not JSON.
    }

    throw new Error(message);
  }

  return response.json() as Promise<RTCConfiguration>;
};
