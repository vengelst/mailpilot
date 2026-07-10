/**
 * @module auth/password
 *
 * Bcrypt-based password hashing and verification.
 * Uses a cost factor of 12 salt rounds for a balance between
 * security and server-side latency.
 */

import bcrypt from "bcryptjs";

/** Bcrypt cost factor — 2^12 iterations. */
const SALT_ROUNDS = 12;

/**
 * Hashes a plain-text password using bcrypt.
 *
 * @param password - The plain-text password to hash.
 * @returns A promise resolving to the bcrypt hash string.
 */
export function hashPassword(password: string) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compares a plain-text password against a stored bcrypt hash.
 *
 * @param password - The plain-text password to check.
 * @param hash - The stored bcrypt hash to compare against.
 * @returns A promise resolving to `true` if the password matches.
 */
export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
