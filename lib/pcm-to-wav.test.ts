import { describe, expect, test } from "bun:test";

import {
  parsePcmSampleRate,
  pcmToWav,
  WAV_HEADER_BYTES,
} from "./pcm-to-wav";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("pcmToWav", () => {
  test("writes a canonical mono 16-bit WAV header", () => {
    const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f]);
    const wav = pcmToWav(pcm, { sampleRate: 24_000 });
    const header = new DataView(wav.buffer, wav.byteOffset, WAV_HEADER_BYTES);

    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(header.getUint32(4, true)).toBe(40);
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(header.getUint32(16, true)).toBe(16);
    expect(header.getUint16(20, true)).toBe(1);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(24, true)).toBe(24_000);
    expect(header.getUint32(28, true)).toBe(48_000);
    expect(header.getUint16(32, true)).toBe(2);
    expect(header.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(header.getUint32(40, true)).toBe(pcm.byteLength);
  });

  test("preserves the PCM payload exactly", () => {
    const pcm = new Uint8Array([0x34, 0x12, 0xcc, 0xed]);
    const wav = pcmToWav(pcm, 16_000);

    expect(wav.slice(WAV_HEADER_BYTES)).toEqual(pcm);
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + pcm.byteLength);
  });

  test("honors the byte offset and length of a typed array view", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 4, 8, 8]);
    const pcm = new Uint8Array(backing.buffer, 2, 4);
    const wav = pcmToWav(pcm, { sampleRate: 8_000, bitsPerSample: 8 });

    expect(wav.slice(WAV_HEADER_BYTES)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  test("accepts an ArrayBuffer input", () => {
    const pcm = new Uint8Array([1, 0, 2, 0]);
    const wav = pcmToWav(pcm.buffer, { sampleRate: 22_050 });

    expect(wav.slice(WAV_HEADER_BYTES)).toEqual(pcm);
  });

  test("calculates stereo format fields", () => {
    const pcm = new Uint8Array(8);
    const wav = pcmToWav(pcm, {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    });
    const header = new DataView(wav.buffer, wav.byteOffset, WAV_HEADER_BYTES);

    expect(header.getUint16(22, true)).toBe(2);
    expect(header.getUint32(28, true)).toBe(192_000);
    expect(header.getUint16(32, true)).toBe(4);
  });

  test("wraps empty PCM data", () => {
    const wav = pcmToWav(new Uint8Array(), { sampleRate: 24_000 });
    const header = new DataView(wav.buffer, wav.byteOffset, WAV_HEADER_BYTES);

    expect(wav.byteLength).toBe(WAV_HEADER_BYTES);
    expect(header.getUint32(4, true)).toBe(36);
    expect(header.getUint32(40, true)).toBe(0);
  });

  test.each([
    [{ sampleRate: 0 }, "sampleRate"],
    [{ sampleRate: 24_000, channels: -1 }, "channels"],
    [{ sampleRate: 24_000, bitsPerSample: 0 }, "bitsPerSample"],
    [{ sampleRate: 24_000.5 }, "sampleRate"],
  ] as const)("rejects invalid numeric options %#", (options, field) => {
    expect(() => pcmToWav(new Uint8Array(), options)).toThrow(field);
  });

  test("rejects bit depths that do not use whole bytes", () => {
    expect(() =>
      pcmToWav(new Uint8Array(), { sampleRate: 24_000, bitsPerSample: 12 }),
    ).toThrow("divisible by 8");
  });

  test("rejects incomplete sample frames", () => {
    expect(() =>
      pcmToWav(new Uint8Array(3), { sampleRate: 24_000 }),
    ).toThrow("complete sample frames");
  });
});

describe("parsePcmSampleRate", () => {
  test.each([
    ["audio/pcm;rate=24000", 24_000],
    ["audio/pcm; rate = 16000", 16_000],
    ["audio/pcm;channels=1;rate=48000;encoding=s16le", 48_000],
    ["AUDIO/PCM;RATE=22050", 22_050],
  ])("parses %s", (header, expected) => {
    expect(parsePcmSampleRate(header)).toBe(expected);
  });

  test.each([null, "audio/pcm", "audio/pcm;rate=fast", "audio/pcm;rate=0"])(
    "rejects missing or invalid rate in %p",
    (header) => {
      expect(() => parsePcmSampleRate(header)).toThrow();
    },
  );
});
