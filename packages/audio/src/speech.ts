import { wordTimingSchema, type WordTiming } from '@scenewirejs/schema';
export interface TTSRequest {
  text: string;
  voice?: string;
}
export interface TTSResult {
  audio: Blob | ArrayBuffer;
  durationMs: number;
  words?: WordTiming[];
}
export interface TTSProvider {
  synthesize(request: TTSRequest): Promise<TTSResult>;
}
export interface SpeechAlignmentResult {
  words: WordTiming[];
  phrases?: WordTiming[];
}
export interface SpeechAlignmentProvider {
  align(
    audio: Blob | ArrayBuffer,
    transcript: string,
  ): Promise<SpeechAlignmentResult>;
}
export function validateSpeechTimings(
  words: readonly WordTiming[],
  durationMs: number,
): WordTiming[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('Invalid narration duration');
  return words.map((word, i) => {
    const w = wordTimingSchema.parse(word);
    if (
      !w.text.trim() ||
      w.endMs > durationMs ||
      (i > 0 && w.startMs < words[i - 1]!.endMs)
    )
      throw new Error(
        'Speech timings overlap, are unordered, or exceed narration duration',
      );
    return w;
  });
}
export async function synthesizeAligned(
  provider: TTSProvider,
  request: TTSRequest,
  alignment?: SpeechAlignmentProvider,
): Promise<TTSResult & SpeechAlignmentResult> {
  const result = await provider.synthesize(request);
  if (!Number.isFinite(result.durationMs) || result.durationMs <= 0)
    throw new Error('Invalid TTS duration');
  if (result.words?.length)
    return {
      ...result,
      words: validateSpeechTimings(result.words, result.durationMs),
    };
  if (!alignment)
    throw new Error('TTS returned no word timing; alignment provider required');
  const aligned = await alignment.align(result.audio, request.text);
  if (!aligned.words.length) throw new Error('Alignment returned no words');
  return {
    ...result,
    words: validateSpeechTimings(aligned.words, result.durationMs),
    ...(aligned.phrases
      ? { phrases: validateSpeechTimings(aligned.phrases, result.durationMs) }
      : {}),
  };
}
// Deliberately synthetic PCM for contract tests, never labelled as speech evidence.
export class MockTTSProvider implements TTSProvider {
  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const tokens = request.text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error('Text required');
    const durationMs = tokens.length * 300,
      sampleRate = 16000,
      length = Math.round((durationMs * sampleRate) / 1000);
    const bytes = new ArrayBuffer(44 + length * 2),
      view = new DataView(bytes);
    const str = (offset: number, text: string) =>
      [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++)
      view.setInt16(
        44 + i * 2,
        Math.round(1000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
        true,
      );
    return {
      audio: bytes,
      durationMs,
      words: tokens.map((text, i) => ({
        text,
        startMs: i * 300,
        endMs: (i + 1) * 300,
      })),
    };
  }
}
// Azure's REST speech adapter. Credentials are injected by a trusted host, never persisted.
// Browser deployments should supply a short-lived speech token; no automatic calls.
export class AzureTTSProvider implements TTSProvider {
  constructor(
    private readonly options: {
      region: string;
      token: () => Promise<string>;
      voice?: string;
      fetch?: typeof fetch;
    },
  ) {
    if (!/^[a-z0-9-]+$/.test(options.region))
      throw new Error('Invalid speech region');
  }
  async synthesize(request: TTSRequest): Promise<TTSResult> {
    if (!request.text.trim()) throw new Error('Text required');
    const escape = (s: string) =>
      s.replace(
        /[<>&"']/g,
        (c) =>
          ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&apos;',
          })[c]!,
      );
    const voice = request.voice ?? this.options.voice ?? 'en-US-JennyNeural';
    const response = await (this.options.fetch ?? fetch)(
      `https://${this.options.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.options.token()}`,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
        },
        body: `<speak version="1.0" xml:lang="en-US"><voice name="${escape(voice)}">${escape(request.text)}</voice></speak>`,
      },
    );
    if (!response.ok)
      throw new Error(`Speech synthesis failed (${response.status})`);
    const audio = await response.arrayBuffer();
    const view = new DataView(audio);
    let durationMs: number | undefined, byteRate: number | undefined;
    if (
      audio.byteLength < 12 ||
      String.fromCharCode(...new Uint8Array(audio, 0, 4)) !== 'RIFF'
    )
      throw new Error('Expected PCM WAVE');
    for (let offset = 12; offset + 8 <= audio.byteLength;) {
      const tag = String.fromCharCode(...new Uint8Array(audio, offset, 4)),
        size = view.getUint32(offset + 4, true);
      if (offset + 8 + size > audio.byteLength)
        throw new Error('Truncated PCM WAVE');
      if (tag === 'fmt ' && size >= 16)
        byteRate = view.getUint32(offset + 16, true);
      if (tag === 'data' && byteRate) durationMs = (size / byteRate) * 1000;
      offset += 8 + size + (size % 2);
    }
    if (!durationMs) throw new Error('No PCM audio data');
    return { audio, durationMs };
  }
}
