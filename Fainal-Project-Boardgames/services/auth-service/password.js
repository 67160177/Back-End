// ==========================================
// รหัสผ่านและกฎของบัญชีผู้ใช้ ใช้ร่วมกันระหว่าง auth-service และ scripts/create-admin.js
// เก็บรหัสผ่านเป็น "scrypt$<salt hex>$<hash hex>" ไม่เก็บรหัสผ่านจริง
// ==========================================

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/; // ตรงกับ VARCHAR(30) ใน schema.sql
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  // timingSafeEqual: เทียบใช้เวลาเท่ากันเสมอ กันการเดารหัสจากเวลาตอบ
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  hashPassword,
  verifyPassword,
  USERNAME_PATTERN,
  PASSWORD_MIN,
  PASSWORD_MAX,
};
