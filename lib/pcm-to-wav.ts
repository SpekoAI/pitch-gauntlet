export const WAV_HEADER_BYTES = 44;

export interface PcmToWavOptions {
  sampleRate: number;
  channels?: number;
  bitsPerSample?: number;
}

type PcmInput = ArrayBuffer | ArrayBufferView;

const PCM_RATE_PATTERN = /(?:^|;)\s*rate\s*=\s*([0-9]+)\s*(?:;|$)/i;

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function toByteView(pcm: PcmInput): Uint8Array {
  if (pcm instanceof ArrayBuffer) {
    return new Uint8Array(pcm);
  }

  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/**
 * Extracts the sample rate from headers such as audio/pcm;rate=24000.
 */
export function parsePcmSampleRate(formatHeader: string | null): number {
  if (formatHeader === null) {
    throw new TypeError("x-speko-audio-format header is required");
  }

  const match = PCM_RATE_PATTERN.exec(formatHeader);
  if (!match) {
    throw new TypeError("x-speko-audio-format header has no valid rate");
  }

  const sampleRate = Number(match[1]);
  assertPositiveInteger(sampleRate, "sampleRate");
  return sampleRate;
}

/**
 * Wraps headerless PCM samples in a standard RIFF/WAVE container.
 *
 * Speko currently returns mono, signed 16-bit PCM. The options stay explicit so
 * callers must use the sample rate advertised by x-speko-audio-format.
 */
export function pcmToWav(pcm: PcmInput, sampleRate: number): Uint8Array;
export function pcmToWav(pcm: PcmInput, options: PcmToWavOptions): Uint8Array;
export function pcmToWav(
  pcm: PcmInput,
  sampleRateOrOptions: number | PcmToWavOptions,
): Uint8Array {
  const options =
    typeof sampleRateOrOptions === "number"
      ? { sampleRate: sampleRateOrOptions }
      : sampleRateOrOptions;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;

  assertPositiveInteger(options.sampleRate, "sampleRate");
  assertPositiveInteger(channels, "channels");
  assertPositiveInteger(bitsPerSample, "bitsPerSample");

  if (bitsPerSample % 8 !== 0) {
    throw new RangeError("bitsPerSample must be divisible by 8");
  }

  const blockAlign = channels * (bitsPerSample / 8);
  if (blockAlign > 0xffff) {
    throw new RangeError("block alignment exceeds the WAV header limit");
  }

  const byteRate = options.sampleRate * blockAlign;
  if (byteRate > 0xffffffff) {
    throw new RangeError("byte rate exceeds the WAV header limit");
  }

  const pcmBytes = toByteView(pcm);
  if (pcmBytes.byteLength % blockAlign !== 0) {
    throw new RangeError("PCM byte length must contain complete sample frames");
  }

  const riffChunkSize = 36 + pcmBytes.byteLength;
  if (riffChunkSize > 0xffffffff) {
    throw new RangeError("PCM data is too large for a RIFF/WAVE container");
  }

  const wav = new Uint8Array(WAV_HEADER_BYTES + pcmBytes.byteLength);
  const header = new DataView(wav.buffer, wav.byteOffset, WAV_HEADER_BYTES);

  writeAscii(header, 0, "RIFF");
  header.setUint32(4, riffChunkSize, true);
  writeAscii(header, 8, "WAVE");
  writeAscii(header, 12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels, true);
  header.setUint32(24, options.sampleRate, true);
  header.setUint32(28, byteRate, true);
  header.setUint16(32, blockAlign, true);
  header.setUint16(34, bitsPerSample, true);
  writeAscii(header, 36, "data");
  header.setUint32(40, pcmBytes.byteLength, true);
  wav.set(pcmBytes, WAV_HEADER_BYTES);

  return wav;
}
