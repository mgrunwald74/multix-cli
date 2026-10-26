import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureAudioFile } from "../../../src/agent/cost-preflight.js";
import { wavDurationSeconds } from "../../../src/budget/audio-duration.js";

/** A PCM WAV: `extra` chunk before `data`, `declared` data size (default: the real size). */
function wav(opts: { seconds: number; rate?: number; declared?: number; extra?: boolean }) {
  const rate = opts.rate ?? 16_000;
  const byteRate = rate * 2;
  const data = Math.round(opts.seconds * byteRate);
  const list = opts.extra ? 12 : 0;
  const buf = Buffer.alloc(44 + list + data);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + list + data, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  let at = 36;
  if (opts.extra) {
    buf.write("LIST", at, "ascii");
    buf.writeUInt32LE(4, at + 4);
    buf.write("INFO", at + 8, "ascii");
    at += 12;
  }
  buf.write("data", at, "ascii");
  buf.writeUInt32LE(opts.declared ?? data, at + 4);
  return new Uint8Array(buf);
}

describe("wavDurationSeconds", () => {
  it("reads the duration from the fmt byte rate and the data size, past other chunks", () => {
    expect(wavDurationSeconds(wav({ seconds: 2.5 }))).toBe(2.5);
    expect(wavDurationSeconds(wav({ seconds: 1, extra: true }))).toBe(1);
  });

  it("never prices a WAV shorter than its file: unset or understated sizes use the bytes on disk", () => {
    const streamed = wav({ seconds: 3, declared: 0xffffffff });
    expect(wavDurationSeconds(streamed)).toBeUndefined();
    expect(wavDurationSeconds(streamed, streamed.length)).toBe(3);
    const understated = wav({ seconds: 4, declared: 32_000 });
    expect(wavDurationSeconds(understated, understated.length)).toBe(4);
  });

  it("is undefined for other formats and truncated headers", () => {
    expect(
      wavDurationSeconds(new TextEncoder().encode("ID3\u0004 not a wav file")),
    ).toBeUndefined();
    expect(wavDurationSeconds(wav({ seconds: 1 }).subarray(0, 30))).toBeUndefined();
  });
});

describe("measureAudioFile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "multix-audio-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("gives a WAV's exact duration and any other file's size", () => {
    const w = path.join(tmp, "a.wav");
    fs.writeFileSync(w, wav({ seconds: 2 }));
    expect(measureAudioFile(w)).toEqual({ seconds: 2, bytes: 64_044 });
    const m = path.join(tmp, "a.mp3");
    fs.writeFileSync(m, Buffer.alloc(1000, 1));
    expect(measureAudioFile(m)).toEqual({ bytes: 1000 });
  });

  it("gives nothing for URLs, missing, empty or non-file paths", () => {
    const empty = path.join(tmp, "e.mp3");
    fs.writeFileSync(empty, "");
    for (const input of ["https://x/a.mp3", path.join(tmp, "nope.mp3"), empty, tmp, undefined]) {
      expect(measureAudioFile(input)).toBeUndefined();
    }
  });
});
