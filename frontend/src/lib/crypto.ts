export function generateSecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
}

export async function hashVote(vote: number, secret: Uint8Array): Promise<Uint8Array> {
  const voteBytes = new Uint8Array(4);
  const dataView = new DataView(voteBytes.buffer);
  // false for big-endian, which matches Rust's to_be_bytes()
  dataView.setUint32(0, vote, false);

  const payload = new Uint8Array(4 + 32);
  payload.set(voteBytes, 0);
  payload.set(secret, 4);

  const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
  return new Uint8Array(hashBuffer);
}

export function buf2hex(buffer: Uint8Array): string {
  return Array.prototype.map.call(buffer, (x) => ("00" + x.toString(16)).slice(-2)).join("");
}

export function hex2buf(hexString: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(hexString.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
