// Server-only SSO handoff helpers. Never import from client code.
const ALLOWED_SID = "national-lab";
const MAX_TOKEN_AGE_SECONDS = 60;

export interface SsoPayload {
  sid: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

function base64urlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

/** Verifies base64url(payload).base64url(HMAC-SHA256(payload, key)) and its claims. */
export async function verifySsoToken(token: string, signingKey: string): Promise<SsoPayload> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Malformed token");
  const [payloadPart, signaturePart] = parts as [string, string];

  const expected = await hmacSha256(signingKey, payloadPart);
  let provided: Uint8Array;
  try {
    provided = base64urlDecode(signaturePart);
  } catch {
    throw new Error("Malformed signature");
  }
  if (!timingSafeEqual(expected, provided)) throw new Error("Invalid signature");

  let payload: SsoPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart))) as SsoPayload;
  } catch {
    throw new Error("Malformed payload");
  }

  if (payload.sid !== ALLOWED_SID) throw new Error("Unknown issuing system");
  if (typeof payload.sub !== "string" || !payload.sub.includes("@")) throw new Error("Invalid subject");
  if (typeof payload.jti !== "string" || payload.jti.length === 0) throw new Error("Missing jti");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("Token expired");
  if (typeof payload.iat !== "number" || payload.iat > now + 30) throw new Error("Token not yet valid");
  if (payload.exp - payload.iat > MAX_TOKEN_AGE_SECONDS) throw new Error("Token TTL too long");

  return payload;
}
