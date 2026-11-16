// Web Crypto helpers used by the UI's API, the ingest Worker, the scripts and the tests.
// Nothing here depends on Nuxt, Nitro or Node: it runs wherever `crypto.subtle` exists.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Web Crypto wants a view over a plain ArrayBuffer; everything here allocates its own
type Bytes = Uint8Array<ArrayBuffer>

export function utf8(text: string): Bytes {
  const encoded = encoder.encode(text)
  const out = new Uint8Array(encoded.length)
  out.set(encoded)
  return out
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let out = ''
  for (const byte of view) out += byte.toString(16).padStart(2, '0')
  return out
}

/** null when the text is not an even number of hex digits */
export function fromHex(hex: string): Bytes | null {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The same alphabet with - and _ and no padding: safe in a cookie or a URL */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** null when the text is not base64 */
export function fromBase64(text: string): Bytes | null {
  try {
    const binary = atob(text)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? utf8(data) : copy(data)
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}

/** Compares every byte whatever the result, so the time taken does not say where two values differ */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function copy(bytes: Uint8Array): Bytes {
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out
}

// ---------------------------------------------------------------- httpdog's signature
//
// X-Httpdog-Signature is "sha256=" and the lowercase hex of HMAC-SHA256(secret, "<timestamp>.<body>"),
// where the body is the bytes that were sent (httpdog: docs/webhook.md, src/notify.rs).

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

function signedBytes(timestamp: string, body: Uint8Array): Bytes {
  const head = utf8(`${timestamp}.`)
  const out = new Uint8Array(head.length + body.length)
  out.set(head)
  out.set(body, head.length)
  return out
}

/** The hex part of the signature httpdog would send for this body */
export async function signAlert(secret: string, timestamp: string | number, body: Uint8Array): Promise<string> {
  const key = await hmacKey(secret, 'sign')
  return toHex(await crypto.subtle.sign('HMAC', key, signedBytes(String(timestamp), body)))
}

/** True when `signatureHex` is the signature of this timestamp and body under `secret`. Constant-time */
export async function verifyAlert(secret: string, timestamp: string, body: Uint8Array, signatureHex: string): Promise<boolean> {
  const signature = fromHex(signatureHex)
  if (!signature || signature.length !== 32) return false
  const key = await hmacKey(secret, 'verify')
  return crypto.subtle.verify('HMAC', key, signature, signedBytes(timestamp, body))
}

/** What the UI shows next to a key, to compare with a host: the first 8 hex digits of SHA-256(secret) */
export async function secretFingerprint(secret: string): Promise<string> {
  return (await sha256Hex(secret)).slice(0, 8)
}

/** A new signing secret, the same shape as `openssl rand -hex 32` */
export function generateSecret(): string {
  return toHex(randomBytes(32))
}

// ---------------------------------------------------------------- secrets at rest
//
// Verifying an HMAC needs the secret itself, so it cannot be stored as a hash. It is stored
// encrypted (AES-256-GCM) with SECRETS_KEY, which both Workers hold as a Cloudflare secret and
// the database never sees: a copy of the database alone does not give away the signing secrets.
//
// Stored form: "v1.<base64 nonce>.<base64 ciphertext and tag>"

async function masterKey(secretsKey: string | undefined, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const raw = fromBase64((secretsKey ?? '').trim())
  if (!raw || raw.length !== 32) {
    throw new Error('SECRETS_KEY must be 32 random bytes in base64 (openssl rand -base64 32)')
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage])
}

export async function sealSecret(secretsKey: string | undefined, plaintext: string): Promise<string> {
  const key = await masterKey(secretsKey, 'encrypt')
  const nonce = randomBytes(12)
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, utf8(plaintext))
  return `v1.${toBase64(nonce)}.${toBase64(sealed)}`
}

/** Throws when the value was sealed with another SECRETS_KEY or has been changed */
export async function openSecret(secretsKey: string | undefined, sealed: string): Promise<string> {
  const key = await masterKey(secretsKey, 'decrypt')
  const [version, nonceText, dataText] = sealed.split('.')
  const nonce = fromBase64(nonceText ?? '')
  const data = fromBase64(dataText ?? '')
  if (version !== 'v1' || !nonce || !data) throw new Error('not a sealed secret')
  try {
    return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, data))
  } catch {
    throw new Error('cannot decrypt: SECRETS_KEY is not the one this secret was stored with')
  }
}
