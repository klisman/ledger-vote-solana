export function concatBytes(
  ...parts: Array<Uint8Array | ArrayLike<number>>
): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part instanceof Uint8Array ? part : Uint8Array.from(part), offset);
    offset += part.length;
  }
  return out;
}

export function u8(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff);
}

export function u32le(n: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
}

export function u64le(n: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, n, true);
  return bytes;
}

export function i64le(n: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, n, true);
  return bytes;
}

export function readU64le(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(
    0,
    true,
  );
}

export function readI64le(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigInt64(
    0,
    true,
  );
}

export function encodeAnchorString(value: string): Uint8Array {
  const utf8 = new TextEncoder().encode(value);
  return concatBytes(u32le(utf8.length), utf8);
}

export function encodeAnchorVecString(items: string[]): Uint8Array {
  return concatBytes(u32le(items.length), ...items.map(encodeAnchorString));
}

export function cstr(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.subarray(0, end);
  return new TextDecoder().decode(slice).trim();
}
