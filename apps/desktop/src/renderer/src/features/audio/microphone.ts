const getMicrophoneErrorMessage = (error: unknown): string => {
  const mediaError =
    typeof error === 'object' && error !== null
      ? (error as { name?: unknown; message?: unknown })
      : undefined;

  const name = typeof mediaError?.name === 'string' ? mediaError.name : '';

  const message = typeof mediaError?.message === 'string' ? mediaError.message : '';

  switch (name) {
    case 'NotFoundError':
      return 'No microphone was found. Connect or enable a microphone ' + 'and try again.';

    case 'NotAllowedError':
      return (
        'Microphone access was denied. Enable microphone permission ' +
        'for Realtime Interview in your system settings.'
      );

    case 'NotReadableError':
      return (
        'The microphone exists but could not be opened. ' + 'Another application may be using it.'
      );

    case 'OverconstrainedError':
      return 'The selected microphone does not support the requested audio settings.';

    case 'AbortError':
      return 'Microphone initialization was interrupted. Please try again.';

    default:
      return message
        ? `Could not access the microphone: ${message}`
        : 'Could not access the microphone.';
  }
};

export const getMicrophoneStream = async (): Promise<MediaStream> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not supported on this device.');
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: false,

      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    const name =
      typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string'
        ? (error as { name: string }).name
        : '';

    if (name === 'OverconstrainedError') {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });
      } catch (fallbackError) {
        throw new Error(getMicrophoneErrorMessage(fallbackError));
      }
    }

    throw new Error(getMicrophoneErrorMessage(error));
  }
};

export const stopMediaStream = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

export type AudioInputDevice = {
  deviceId: string;
  label: string;
};

export const getMicrophones = async (): Promise<AudioInputDevice[]> => {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId,

      label: device.label || `Microphone ${index + 1}`,
    }));
};
