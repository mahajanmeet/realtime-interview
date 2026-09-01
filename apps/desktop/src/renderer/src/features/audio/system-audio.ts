export type SystemAudioResult = {
  stream: MediaStream;
  track: MediaStreamTrack;
};

type ExtendedDisplayMediaStreamOptions = {
  video: boolean;
  audio:
    | boolean
    | {
        restrictOwnAudio?: boolean;
      };
};

const getSystemAudioError = (error: unknown): string => {
  const mediaError =
    typeof error === 'object' && error !== null
      ? (error as { name?: unknown; message?: unknown })
      : undefined;
  const name = typeof mediaError?.name === 'string' ? mediaError.name : '';
  const message = typeof mediaError?.message === 'string' ? mediaError.message : '';

  switch (name) {
    case 'NotAllowedError':
      return (
        'System audio permission was denied. ' +
        'Enable system audio or screen recording permission and try again.'
      );

    case 'NotFoundError':
      return 'No system audio source was available.';

    case 'NotReadableError':
      return (
        'System audio could not be opened. ' +
        'Another application or operating system restriction may be blocking it.'
      );

    case 'AbortError':
      return 'System audio capture was cancelled.';

    default:
      return message
        ? `Could not capture system audio: ${message}`
        : 'Could not capture system audio.';
  }
};

export const getSystemAudioStream = async (): Promise<SystemAudioResult> => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('System audio capture is not supported.');
  }

  const constraints: ExtendedDisplayMediaStreamOptions = {
    video: true,
    audio: {
      restrictOwnAudio: true,
    },
  };

  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getDisplayMedia(constraints as DisplayMediaStreamOptions);
  } catch (error) {
    throw new Error(getSystemAudioError(error));
  }

  for (const videoTrack of stream.getVideoTracks()) {
    videoTrack.stop();
    stream.removeTrack(videoTrack);
  }

  const audioTrack = stream.getAudioTracks()[0];

  if (!audioTrack) {
    for (const track of stream.getTracks()) {
      track.stop();
    }

    throw new Error('No system audio track was provided by the operating system.');
  }

  return {
    stream,
    track: audioTrack,
  };
};
