// ==========================================
// สร้างบัญชี admin (รันบนเครื่องเซิร์ฟเวอร์เท่านั้น ไม่มี API ให้สมัครเป็น admin)
//
//   npm run create-admin -- <username>              ถามรหัสผ่าน (พิมพ์แล้วไม่แสดงบนจอ)
//   npm run create-admin -- <username> <password>   ใส่รหัสในคำสั่งเลย (สะดวกแต่ค้างในประวัติคำสั่ง)
//
// - ยังไม่มีผู้ใช้ชื่อนี้: สร้างใหม่เป็น admin
// - มีผู้ใช้ชื่อนี้แล้ว: เลื่อนเป็น admin โดยไม่เปลี่ยนรหัสผ่าน (ไม่ต้องใส่รหัส)
// ผู้ใช้ที่เข้าสู่ระบบอยู่ต้องเข้าสู่ระบบใหม่ จึงจะได้สิทธิ์ admin (role อยู่ใน token)
// (บัญชี admin หลักตั้งใน .env ได้ด้วย ADMIN_USERNAME / ADMIN_PASSWORD ดู services/auth-service/admin.js)
// ==========================================

require("dotenv").config({ quiet: true });

const readline = require("readline");
const { createAdmin } = require("../services/auth-service/admin");

const log = (message) => console.log(`[create-admin] ${message}`);

// ถามรหัสผ่านโดยไม่แสดงตัวอักษรที่พิมพ์
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) rl.output.write(question);
    };
  });
}

const MESSAGES = {
  created: (u) => `สร้างบัญชี admin "${u}" แล้ว เข้าสู่ระบบที่หน้าเว็บได้เลย`,
  promoted: (u) => `เลื่อน "${u}" เป็น admin แล้ว (รหัสผ่านเดิม) ถ้าเข้าสู่ระบบอยู่ให้ออกแล้วเข้าใหม่`,
  unchanged: (u) => `"${u}" เป็น admin อยู่แล้ว`,
};

if (require.main === module) {
  const pool = require("../db");
  const [username, password] = process.argv.slice(2);

  createAdmin({ pool, username, password, askPassword: askHidden })
    .then(({ action }) => log(MESSAGES[action](username)))
    .catch((err) => {
      log(`ไม่สำเร็จ: ${err.message}`);
      if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR") {
        log("ยังไม่มีตาราง users หรือคอลัมน์ role ให้รัน npm run migrate ก่อน");
      }
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { createAdmin };
