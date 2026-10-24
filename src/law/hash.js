/** SHA-256 hex digest with Web Crypto (Node.js 20+, Bun, Deno, browsers). */
export async function sha256Hex(bytes) {
  const data =
    typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
