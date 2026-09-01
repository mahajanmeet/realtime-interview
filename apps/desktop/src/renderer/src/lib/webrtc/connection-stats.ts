export type NetworkQuality = 'excellent' | 'good' | 'poor' | 'critical' | 'unknown';

export type ConnectionStats = {
  roundTripTimeMs: number | null;
  jitterMs: number | null;
  packetsLost: number;
  packetsReceived: number;
  inboundBitrateKbps: number | null;
  candidateType: string | null;
  protocol: string | null;
  codec: string | null;
  quality: NetworkQuality;
};

type PreviousSample = {
  timestamp: number;
  bytesReceived: number;
};

export class ConnectionStatsCollector {
  private readonly previousSamples = new Map<string, PreviousSample>();

  constructor(private readonly peerConnection: RTCPeerConnection) {}

  async collect(): Promise<ConnectionStats> {
    const reports = await this.peerConnection.getStats();

    let roundTripTimeMs: number | null = null;
    let jitterMs: number | null = null;
    let packetsLost = 0;
    let packetsReceived = 0;
    let inboundBitrateKbps: number | null = null;
    let candidateType: string | null = null;
    let protocol: string | null = null;
    let codec: string | null = null;
    let codecId: string | null = null;

    reports.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        const inboundAudio = report as RTCInboundRtpStreamStats;

        packetsLost += inboundAudio.packetsLost ?? 0;
        packetsReceived += inboundAudio.packetsReceived ?? 0;

        if (typeof inboundAudio.jitter === 'number') {
          jitterMs = Math.max(jitterMs ?? 0, inboundAudio.jitter * 1000);
        }

        codecId ??= inboundAudio.codecId ?? null;

        const trackBitrate = this.calculateBitrate(inboundAudio);

        if (trackBitrate !== null) {
          inboundBitrateKbps = (inboundBitrateKbps ?? 0) + trackBitrate;
        }
      }

      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
        const pair = report as RTCIceCandidatePairStats;

        if (typeof pair.currentRoundTripTime === 'number') {
          roundTripTimeMs = pair.currentRoundTripTime * 1000;
        }

        const remoteCandidate = reports.get(pair.remoteCandidateId);

        if (remoteCandidate) {
          candidateType = remoteCandidate.candidateType ?? null;
          protocol = remoteCandidate.protocol ?? null;
        }
      }
    });

    if (codecId) {
      const codecReport = reports.get(codecId);

      if (codecReport && codecReport.type === 'codec') {
        codec = codecReport.mimeType ?? null;
      }
    }

    return {
      roundTripTimeMs,
      jitterMs,
      packetsLost,
      packetsReceived,
      inboundBitrateKbps,
      candidateType,
      protocol,
      codec,
      quality: calculateQuality({
        roundTripTimeMs,
        jitterMs,
        packetsLost,
        packetsReceived,
      }),
    };
  }

  private calculateBitrate(report: RTCInboundRtpStreamStats): number | null {
    const bytesReceived = report.bytesReceived;
    const timestamp = report.timestamp;

    if (typeof bytesReceived !== 'number' || typeof timestamp !== 'number') {
      return null;
    }

    const previous = this.previousSamples.get(report.id);

    this.previousSamples.set(report.id, {
      timestamp,
      bytesReceived,
    });

    if (!previous) {
      return null;
    }

    const elapsedMs = timestamp - previous.timestamp;
    const bytes = bytesReceived - previous.bytesReceived;

    if (elapsedMs <= 0 || bytes < 0) {
      return null;
    }

    return (bytes * 8) / elapsedMs;
  }
}

type QualityInput = {
  roundTripTimeMs: number | null;
  jitterMs: number | null;
  packetsLost: number;
  packetsReceived: number;
};

const calculateQuality = ({
  roundTripTimeMs,
  jitterMs,
  packetsLost,
  packetsReceived,
}: QualityInput): NetworkQuality => {
  if (roundTripTimeMs === null || jitterMs === null) {
    return 'unknown';
  }

  const totalPackets = packetsLost + packetsReceived;
  const lossPercentage = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

  if (roundTripTimeMs < 120 && jitterMs < 20 && lossPercentage < 1) {
    return 'excellent';
  }

  if (roundTripTimeMs < 250 && jitterMs < 40 && lossPercentage < 3) {
    return 'good';
  }

  if (roundTripTimeMs < 400 && jitterMs < 80 && lossPercentage < 8) {
    return 'poor';
  }

  return 'critical';
};
