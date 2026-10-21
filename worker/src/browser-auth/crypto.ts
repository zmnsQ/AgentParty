/** RFC 6238-compatible TOTP. All seeds stay inside encrypted server records. */
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function randomHex(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(seed: string): Uint8Array {
  if (!/^[A-Z2-7]{32}$/.test(seed)) throw new Error('Invalid authenticator seed');
  const out: number[] = []; let bits = 0, value = 0;
  for (const c of seed) {
    value = (value << 5) | alphabet.indexOf(c); bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); }
  }
  return new Uint8Array(out);
}
export function newTotpSeed(): string { return base32(crypto.getRandomValues(new Uint8Array(20))); }
export function equal(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function totp(seed: string, step: number, digits = 6): Promise<string> {
  const counter = new Uint8Array(8); new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const key = await crypto.subtle.importKey('raw', unbase32(seed), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = bytes[bytes.length - 1]! & 15;
  const n = new DataView(bytes.buffer).getUint32(offset) & 0x7fffffff;
  return String(n % (10 ** digits)).padStart(digits, '0');
}
export async function validTotpStep(seed: string, code: string, lastStep: number, now = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (step >= 0 && step > lastStep && equal(await totp(seed, step), code)) return step;
  }
  return null;
}
export function recoveryValue(value: string): string | null {
  const normalized = value.replace(/[ -]/g, '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(normalized) ? normalized : null;
}
export async function recoveryHash(account: string, value: string): Promise<string> {
  return digest(`commons-recovery:${account}:${value}`);
}
export async function newRecoveryCodes(account: string): Promise<{ codes: string[]; hashes: string[] }> {
  const raw = Array.from({ length: 10 }, () => randomHex(16));
  return { codes: raw.map(v => v.match(/.{8}/g)!.join('-')), hashes: await Promise.all(raw.map(v => recoveryHash(account, v))) };
}
