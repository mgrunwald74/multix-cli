/**
 * Duration of a PCM WAV file from its header (runtime-neutral). Decoders
 * derive the length of PCM from sampleRate × blockAlign, not from the header's
 * byteRate field, so a header is trusted only when its fields agree with each
 * other. Compressed WAV (ADPCM, MP3-in-WAV, ...) and every other format need a
 * decoder, so they return undefined and are priced from their size instead.
 */

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

/** WAVE_FORMAT_PCM, WAVE_FORMAT_IEEE_FLOAT, WAVE_FORMAT_EXTENSIBLE. */
const PCM_FORMATS = new Set([0x0001, 0x0003, 0xfffe]);
/** PCM and IEEE float sub-format GUIDs of WAVE_FORMAT_EXTENSIBLE share these 14 bytes. */
const EXTENSIBLE_GUID_TAIL = [
  0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
];

/** Bytes per second of an uncompressed `fmt ` chunk, or undefined when it is not one. */
function pcmBytesPerSecond(header: Uint8Array, view: DataView, at: number, size: number) {
  if (size < 16 || at + 8 + size > header.length) return undefined;
  const format = view.getUint16(at + 8, true);
  const channels = view.getUint16(at + 10, true);
  const sampleRate = view.getUint32(at + 12, true);
  const byteRate = view.getUint32(at + 16, true);
  const blockAlign = view.getUint16(at + 20, true);
  const bits = view.getUint16(at + 22, true);
  if (!PCM_FORMATS.has(format) || channels === 0 || sampleRate === 0 || bits === 0) {
    return undefined;
  }
  if (format === 0xfffe) {
    // cbSize(2) validBits(2) channelMask(4) subFormat(16): only PCM or float sub-formats.
    if (size < 40) return undefined;
    const sub = view.getUint16(at + 32, true);
    if (sub !== 0x0001 && sub !== 0x0003) return undefined;
    if (EXTENSIBLE_GUID_TAIL.some((b, i) => header[at + 34 + i] !== b)) return undefined;
  }
  if (blockAlign !== channels * Math.ceil(bits / 8)) return undefined;
  if (byteRate !== sampleRate * blockAlign) return undefined;
  return sampleRate * blockAlign;
}

/**
 * Seconds of audio in a PCM RIFF/WAVE file, or undefined when `header` is not
 * one, is compressed, is inconsistent, or ends before the `data` chunk. With
 * the file size, the payload is taken as the larger of the declared size and
 * the bytes after the chunk header, so a streamed WAV (size unset) or a header
 * that understates its data is not priced short; trailing chunks only make the
 * result longer.
 */
export function wavDurationSeconds(header: Uint8Array, fileBytes?: number): number | undefined {
  if (header.length < 12 || ascii(header, 0) !== "RIFF" || ascii(header, 8) !== "WAVE") {
    return undefined;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let bytesPerSecond: number | undefined;
  let seenFmt = false;
  for (let at = 12; at + 8 <= header.length; ) {
    const id = ascii(header, at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      // Which of two format chunks a decoder honours is not defined: trust neither.
      if (seenFmt) return undefined;
      seenFmt = true;
      bytesPerSecond = pcmBytesPerSecond(header, view, at, size);
      if (bytesPerSecond === undefined) return undefined;
    }
    if (id === "data") {
      if (!bytesPerSecond) return undefined;
      const declared = size === 0xffffffff ? 0 : size;
      const payload = Math.max(declared, fileBytes === undefined ? 0 : fileBytes - (at + 8));
      return payload > 0 ? payload / bytesPerSecond : undefined;
    }
    at += 8 + size + (size % 2);
  }
  return undefined;
}
