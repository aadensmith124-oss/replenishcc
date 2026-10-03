import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured.");
  }
  return createHash("sha256")
    .update("replenishcc-license-encryption:")
    .update(secret)
    .digest();
}

export function hashLicenseKey(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured.");
  }
  return createHmac("sha256", secret)
    .update("replenishcc-license-deduplication:")
    .update(value)
    .digest("hex");
}

export function encryptLicenseKey(value: string): {
  keyCiphertext: string;
  keyIv: string;
  keyTag: string;
  keyHash: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const keyCiphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]).toString("base64");

  return {
    keyCiphertext,
    keyIv: iv.toString("base64"),
    keyTag: cipher.getAuthTag().toString("base64"),
    keyHash: hashLicenseKey(value),
  };
}

export function decryptLicenseKey(item: {
  keyCiphertext: string;
  keyIv: string;
  keyTag: string;
}): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(item.keyIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(item.keyTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(item.keyCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}