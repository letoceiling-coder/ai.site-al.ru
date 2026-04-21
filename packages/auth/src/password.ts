import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;

export async function hashPassword(rawPassword: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(rawPassword, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(rawPassword: string, storedHash: string) {
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) {
    return false;
  }
  const hashBuffer = Buffer.from(originalHash, "hex");
  const providedBuffer = scryptSync(rawPassword, salt, SCRYPT_KEYLEN);
  if (hashBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(hashBuffer, providedBuffer);
}
