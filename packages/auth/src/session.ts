import { createHmac, timingSafeEqual } from "node:crypto";

type SessionPayload = {
  sub: string;
  tenantId: string;
  email: string;
};

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "unsafe-dev-secret-change-me",
);

function encode(payload: SessionPayload & { exp: number }) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decode(token: string) {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as SessionPayload & {
    exp: number;
  };
}

function sign(value: string) {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

export async function signAccessToken(payload: SessionPayload) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 15;
  const encoded = encode({ ...payload, exp });
  return `${encoded}.${sign(encoded)}`;
}

export async function verifyAccessToken(token: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    throw new Error("Invalid token");
  }
  const expected = sign(encoded);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid signature");
  }
  const payload = decode(encoded);
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload;
}
