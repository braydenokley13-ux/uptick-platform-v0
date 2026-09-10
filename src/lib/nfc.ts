import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { RequestError } from "./http";

// NTAG 424 DNA AES SDM, encrypted PICCData + zero-length MAC input profile.
// NXP AN12196 rev. 2.0, sections 3.3 and 3.4.2–3.4.4.
// This adapter deliberately rejects other provisioning profiles.
export const NFC_PROFILE = "ntag424-encrypted-picc-empty-mac-v1";

function aesBlock(key: Buffer, input: Buffer) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(input), cipher.final()]);
}
function xor(left: Buffer, right: Buffer) {
  return Buffer.from(left.map((value, i) => value ^ right[i]));
}
function double(block: Buffer) {
  const result = Buffer.alloc(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    result[i] = ((block[i] << 1) | carry) & 255;
    carry = block[i] >>> 7;
  }
  if (carry) result[15] ^= 0x87;
  return result;
}

/** NIST SP 800-38B AES-CMAC. Never expose tag keys through a client import. */
export function aesCmac(key: Buffer, message: Buffer) {
  if (key.length !== 16) throw Error("AES-CMAC requires a 128-bit key.");
  const k1 = double(aesBlock(key, Buffer.alloc(16))),
    k2 = double(k1);
  const blocks = Math.max(1, Math.ceil(message.length / 16));
  const complete = message.length > 0 && message.length % 16 === 0;
  const last = Buffer.alloc(16);
  message.copy(last, 0, (blocks - 1) * 16);
  if (!complete) last[message.length % 16] = 0x80;
  let state: Buffer = Buffer.alloc(16);
  for (let i = 0; i < blocks - 1; i++)
    state = aesBlock(key, xor(state, message.subarray(i * 16, (i + 1) * 16)));
  return aesBlock(key, xor(state, xor(last, complete ? k1 : k2)));
}

export type NfcProof = { encryptedPicc: string; mac: string };
function invalid(): never {
  throw new RequestError(
    "This secure Tap could not be verified. Tap the sign again or use its QR fallback.",
  );
}
function hex(value: string, length: number) {
  if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(value)) invalid();
  return Buffer.from(value, "hex");
}

/** Pure verifier; replay protection MUST be applied atomically by the caller. */
export function verifyNtag424(
  proof: NfcProof,
  configuration: {
    uid: string;
    metaKey: Buffer;
    fileKey: Buffer;
    profile: string;
  },
) {
  if (
    configuration.profile !== NFC_PROFILE ||
    configuration.metaKey.length !== 16 ||
    configuration.fileKey.length !== 16
  )
    invalid();
  const encrypted = hex(proof.encryptedPicc, 16),
    received = hex(proof.mac, 8),
    expectedUid = hex(configuration.uid, 7);
  const decipher = createDecipheriv(
    "aes-128-cbc",
    configuration.metaKey,
    Buffer.alloc(16),
  );
  decipher.setAutoPadding(false);
  const picc = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  // C7: seven-byte UID and three-byte SDMReadCtr are both mirrored.
  if (picc[0] !== 0xc7 || !timingSafeEqual(picc.subarray(1, 8), expectedUid))
    invalid();
  const vector = Buffer.concat([
    Buffer.from("3cc300010080", "hex"),
    picc.subarray(1, 11),
  ]);
  const sessionKey = aesCmac(configuration.fileKey, vector);
  const fullMac = aesCmac(sessionKey, Buffer.alloc(0));
  const truncated = Buffer.from(
    Array.from({ length: 8 }, (_, i) => fullMac[i * 2 + 1]),
  );
  if (!timingSafeEqual(truncated, received)) invalid();
  return {
    uid: expectedUid.toString("hex").toUpperCase(),
    counter: picc.readUIntLE(8, 3),
  };
}

/** Keys are resolved only from server configuration, never accepted in HTTP input. */
export function nfcKey(reference: string) {
  if (!/^UPTICK_NFC_KEY_[A-Z0-9_]{1,80}$/.test(reference))
    throw new RequestError(
      "This Tap is awaiting secure-key configuration.",
      503,
    );
  const value = process.env[reference];
  // No factory/default keys, including on a sample point connected to this API.
  if (!value || !/^[a-fA-F0-9]{32}$/.test(value) || /^0{32}$/.test(value))
    throw new RequestError(
      "This Tap is awaiting secure-key configuration.",
      503,
    );
  return Buffer.from(value, "hex");
}
