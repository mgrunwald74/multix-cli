/**
 * Duration of a WAV file from its header (runtime-neutral): the `fmt `
 * chunk's average byte rate and the length of the `data` chunk. Other formats
 * need a decoder, so they return undefined and are priced from their size.
 */

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

/**
 * Seconds of audio in a RIFF/WAVE file, or undefined when `header` is not one
 * or ends before the `data` chunk. With the file size, the payload is taken as
 * the larger of the declared size and the bytes after the chunk header, so a
 * streamed WAV (size unset) or a header that understates its data is not
 * priced short; trailing chunks only make the result longer.
 */
export function wavDurationSeconds(header: Uint8Array, fileBytes?: number): number | undefined {
  if (header.length < 12 || ascii(header, 0) !== "RIFF" || ascii(header, 8) !== "WAVE") {
    return undefined;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let byteRate: number | undefined;
  for (let at = 12; at + 8 <= header.length; ) {
    const id = ascii(header, at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 20 <= header.length) byteRate = view.getUint32(at + 16, true);
    if (id === "data") {
      if (!byteRate) return undefined;
      const declared = size === 0xffffffff ? 0 : size;
      const payload = Math.max(declared, fileBytes === undefined ? 0 : fileBytes - (at + 8));
      return payload > 0 ? payload / byteRate : undefined;
    }
    at += 8 + size + (size % 2);
  }
  return undefined;
}
