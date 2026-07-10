/**
 * @module security/crypto
 *
 * AES-256-GCM authenticated encryption for storing sensitive data at rest
 * (e.g. IMAP/SMTP passwords, API tokens).
 *
 * Encrypted payloads are stored as a dot-separated string:
 *   `<iv>.<authTag>.<ciphertext>` (all Base64-encoded).
 *
 * The 256-bit key is read from the APP_ENCRYPTION_KEY env var (64 hex chars).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
/** GCM recommended IV length: 96 bits (12 bytes). */
const IV_LENGTH = 12;

/**
 * Reads and validates the 256-bit encryption key from the environment.
 *
 * @returns A 32-byte Buffer suitable for AES-256.
 * @throws If APP_ENCRYPTION_KEY is missing or not exactly 64 hex characters.
 */
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

/**
 * Encrypts a plain-text string using AES-256-GCM.
 *
 * @param input - The plain-text secret to encrypt.
 * @returns A dot-separated string of Base64-encoded IV, auth tag, and ciphertext.
 */
export function encryptSecret(input: string): string {
  // Generate a unique random initialization vector per encryption
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(input, "utf8"), cipher.final()]);
  // GCM auth tag provides integrity verification on decryption
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

/**
 * Decrypts a payload previously produced by {@link encryptSecret}.
 *
 * @param payload - The dot-separated encrypted string (iv.tag.ciphertext).
 * @returns The original plain-text secret.
 * @throws If the payload is malformed, the key is wrong, or the data was tampered with.
 */
export function decryptSecret(payload: string): string {
  try {
    // Split the stored payload back into its three Base64 components
    const [ivBase64, tagBase64, encryptedBase64] = payload.split(".");
    const iv = Buffer.from(ivBase64, "base64");
    const tag = Buffer.from(tagBase64, "base64");
    const encrypted = Buffer.from(encryptedBase64, "base64");

    const decipher = createDecipheriv(ALGO, getKey(), iv);
    // Auth tag must be set before update/final so GCM can verify integrity
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("Unable to decrypt secret");
  }
}
