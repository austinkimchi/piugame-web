import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface CryptoPayloadV1 {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export function encryptCredential(plainText: string): CryptoPayloadV1 {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function decryptCredential(payload: CryptoPayloadV1): string {
  if (payload.version !== 1) {
    throw new Error(`Unsupported credential payload version: ${payload.version}`);
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}

function encryptionKey(): Buffer {
  const rawKey = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!rawKey) {
    throw new Error("Missing CREDENTIAL_ENCRYPTION_KEY.");
  }

  if (/^[0-9a-fA-F]+$/.test(rawKey) && rawKey.length >= 64) {
    return Buffer.from(rawKey.slice(0, 64), "hex");
  }

  const asBase64 = Buffer.from(rawKey, "base64");
  if (asBase64.length === KEY_BYTES) {
    return asBase64;
  }

  const asUtf8 = Buffer.from(rawKey, "utf8");
  if (asUtf8.length === KEY_BYTES) {
    return asUtf8;
  }

  throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a 32-byte key encoded as hex, base64, or plain 32-byte UTF-8.");
}
