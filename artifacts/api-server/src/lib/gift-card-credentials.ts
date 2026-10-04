import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

export type GiftCardCredential = {
  cardNumber: string;
  expiration: string;
  securityCode: string;
  email?: string | null;
  phone?: string | null;
  cardholderName?: string | null;
};

export function getGiftCardBinPrefix(cardNumber: string): string | null {
  const digits = cardNumber.replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(0, 6) : null;
}

export function getGiftCardBinMetadataPrefix(cardNumber: string): string | null {
  const digits = cardNumber.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

export function getGiftCardLastFour(cardNumber: string): string | null {
  const digits = cardNumber.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured.");
  return secret;
}

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update("replenishcc-gift-card-encryption:")
    .update(sessionSecret())
    .digest();
}

export function hashGiftCardCredential(value: GiftCardCredential): string {
  const hashIdentity = {
    cardNumber: value.cardNumber,
    expiration: value.expiration,
    securityCode: value.securityCode,
    email: value.email ?? null,
    phone: value.phone ?? null,
  };
  return createHmac("sha256", sessionSecret())
    .update("replenishcc-gift-card-deduplication:")
    .update(JSON.stringify(hashIdentity))
    .digest("hex");
}

export function encryptGiftCardCredential(value: GiftCardCredential): {
  credentialCiphertext: string;
  credentialIv: string;
  credentialTag: string;
  credentialHash: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return {
    credentialCiphertext: Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]).toString("base64"),
    credentialIv: iv.toString("base64"),
    credentialTag: cipher.getAuthTag().toString("base64"),
    credentialHash: hashGiftCardCredential(value),
  };
}

export function decryptGiftCardCredential(item: {
  credentialCiphertext: string;
  credentialIv: string;
  credentialTag: string;
}): GiftCardCredential {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(item.credentialIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(item.credentialTag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(item.credentialCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as GiftCardCredential;
}