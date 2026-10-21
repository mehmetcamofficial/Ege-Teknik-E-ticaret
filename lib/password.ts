import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/** Produces the exact "scrypt$salt$hex" shape verifyPassword expects. A fresh random salt every call. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  let expectedBuffer: Buffer;
  try {
    expectedBuffer = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  if (!expectedBuffer.length) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}
