/** AES-GCM envelope with record-bound AAD. Credentials never leave the Worker. */
export class VaultError extends Error {
  constructor(message = "Credential encryption is not configured. Set COLLABORATION_ENCRYPTION_KEY to a base64-encoded 32-byte key.") {
    super(message);
    this.name = "VaultError";
  }
}

function encode(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
function decode(value: string): Uint8Array {
  try { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
  catch { throw new VaultError(); }
}
async function key(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(secret.trim())) throw new VaultError();
  const bytes = decode(secret.trim());
  if (bytes.byteLength !== 32) throw new VaultError();
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealCredential(value: string, secret: string | undefined, context: string): Promise<string> {
  const cryptoKey = await key(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    cryptoKey,
    new TextEncoder().encode(value),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
export async function openCredential(envelope: string, secret: string | undefined, context: string): Promise<string> {
  const cryptoKey = await key(secret);
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new VaultError("Stored credential is invalid; reconnect the integration.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(parts[1]!), additionalData: new TextEncoder().encode(context) },
      cryptoKey,
      decode(parts[2]!),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new VaultError("Stored credential cannot be decrypted; check the encryption key or reconnect the integration.");
  }
}
