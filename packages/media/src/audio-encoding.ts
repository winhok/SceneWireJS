import { EncodedPacket } from 'mediabunny';
interface AudioPacket {
  packet: EncodedPacket;
  meta?: EncodedAudioChunkMetadata;
}
async function encodePCM(
  buffer: AudioBuffer,
  config: AudioEncoderConfig,
  signal?: AbortSignal,
): Promise<AudioPacket[]> {
  const packets: AudioPacket[] = [];
  let failure: DOMException | undefined;
  const encoder = new AudioEncoder({
    output: (chunk, meta) =>
      packets.push({ packet: EncodedPacket.fromEncodedChunk(chunk), meta }),
    error: (error) => {
      failure = error;
    },
  });
  try {
    encoder.configure(config);
    for (let offset = 0; offset < buffer.length; offset += 2048) {
      signal?.throwIfAborted();
      if (failure) throw failure;
      const frames = Math.min(2048, buffer.length - offset),
        data = new Float32Array(frames * buffer.numberOfChannels);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++)
        data.set(
          buffer.getChannelData(channel).subarray(offset, offset + frames),
          channel * frames,
        );
      const sample = new AudioData({
        format: 'f32-planar',
        sampleRate: buffer.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: buffer.numberOfChannels,
        timestamp: Math.round((offset / buffer.sampleRate) * 1e6),
        data,
      });
      try {
        encoder.encode(sample);
      } finally {
        sample.close();
      }
      if (encoder.encodeQueueSize >= 4)
        await new Promise<void>((resolve) =>
          encoder.addEventListener('dequeue', () => resolve(), { once: true }),
        );
    }
    await encoder.flush();
    if (failure) throw failure;
    return packets;
  } finally {
    encoder.close();
  }
}
// Measure the local codec's impulse delay rather than guessing a platform-specific AAC priming constant.
async function measureEncoderDelay(
  config: AudioEncoderConfig,
  signal?: AbortSignal,
): Promise<number> {
  const sampleRate = config.sampleRate,
    impulseFrame = Math.round(sampleRate * 0.1);
  const buffer = new AudioBuffer({
    length: sampleRate,
    sampleRate,
    numberOfChannels: config.numberOfChannels,
  });
  for (let c = 0; c < buffer.numberOfChannels; c++)
    buffer.getChannelData(c)[impulseFrame] = 0.8;
  const packets = await encodePCM(buffer, config, signal),
    decoderConfig = packets.find((p) => p.meta?.decoderConfig)?.meta
      ?.decoderConfig;
  if (!decoderConfig)
    throw new Error('Audio encoder returned no decoder configuration');
  let peak = 0,
    peakTime = 0,
    failure: DOMException | undefined;
  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        const samples = new Float32Array(data.numberOfFrames);
        data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
        for (let i = 0; i < samples.length; i++)
          if (Math.abs(samples[i]!) > peak) {
            peak = Math.abs(samples[i]!);
            peakTime = data.timestamp / 1e6 + i / data.sampleRate;
          }
      } finally {
        data.close();
      }
    },
    error: (error) => {
      failure = error;
    },
  });
  try {
    decoder.configure(decoderConfig);
    for (const { packet } of packets)
      decoder.decode(packet.toEncodedAudioChunk());
    await decoder.flush();
    if (failure) throw failure;
  } finally {
    decoder.close();
  }
  if (peak < 0.01) throw new Error('Cannot calibrate audio codec delay');
  const delay =
    Math.round((peakTime - impulseFrame / sampleRate) * sampleRate) /
    sampleRate;
  if (delay < 0 || delay > 0.25)
    throw new Error('Unexpected audio encoder delay');
  return delay;
}
export async function encodeMixedAudio(
  buffer: AudioBuffer,
  codec: 'aac' | 'opus',
  signal?: AbortSignal,
): Promise<{
  packets: AudioPacket[];
  delaySeconds: number;
  endSeconds: number;
}> {
  const config: AudioEncoderConfig = {
    codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    bitrate: 128000,
  };
  const delaySeconds = await measureEncoderDelay(config, signal);
  const raw = await encodePCM(buffer, config, signal),
    duration = buffer.duration;
  const packets = raw
    .filter(({ packet }) => packet.timestamp - delaySeconds < duration)
    .map(({ packet, meta }) => ({
      packet: packet.clone({
        timestamp: packet.timestamp - delaySeconds,
        duration: Math.min(
          packet.duration,
          duration - (packet.timestamp - delaySeconds),
        ),
      }),
      meta,
    }));
  const endSeconds = Math.max(
    ...packets.map((p) => p.packet.timestamp + p.packet.duration),
  );
  return { packets, delaySeconds, endSeconds };
}
