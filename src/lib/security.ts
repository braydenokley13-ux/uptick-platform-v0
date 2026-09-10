import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { key } from "./config";
export const id = () => randomBytes(12).toString("hex");
export const token = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function normalizePhone(input: string) {
  const p = parsePhoneNumberFromString(input, "US");
  if (!p || !p.isValid() || p.country !== "US")
    throw Error("Enter a valid US mobile number, including area code.");
  return p.number;
}
export const maskPhone = (phone: string) => `••• ••• ${phone.slice(-4)}`;
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(hash(key("PASS_ENCRYPTION_KEY")), "hex"),
    iv,
  );
  return Buffer.concat([
    iv,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url");
}
export function decrypt(value: string) {
  const data = Buffer.from(value, "base64url");
  if (data.length < 28) throw Error("Encrypted credential is invalid.");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(hash(key("PASS_ENCRYPTION_KEY")), "hex"),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    cipher.update(data.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
export function sign(value: string) {
  return createHmac("sha256", key("SESSION_SECRET"))
    .update(value)
    .digest("base64url");
}
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
