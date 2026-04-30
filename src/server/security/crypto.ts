import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const value = process.env.APP_ENCRYPTION_KEY;
  if (!value) {
    throw new Error("APP_ENCRYPTION_KEY is not configured");
  }

  const key = Buffer.from(value, "hex");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 64 hex chars");
  }

  return key;
}

export function encryptSecret(input: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(input, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  try {
    const [ivBase64, tagBase64, encryptedBase64] = payload.split(".");
    const iv = Buffer.from(ivBase64, "base64");
    const tag = Buffer.from(tagBase64, "base64");
    const encrypted = Buffer.from(encryptedBase64, "base64");

    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("Unable to decrypt secret");
  }
}
