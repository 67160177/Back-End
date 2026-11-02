// gateway/generate-test-token.js (สคริปต์ชั่วคราวสำหรับทดสอบเท่านั้น)
require("dotenv").config({ quiet: true }); // quiet: dotenv v17 พิมพ์ log ปนกับ token ถ้าไม่ปิด
const jwt = require("jsonwebtoken");

// payload ใช้คีย์ id/email/role เช่นเดียวกับ generateToken ในสัปดาห์ที่ 6
// เพื่อให้ req.user ที่ได้จาก Gateway มีโครงสร้างเดียวกับที่ route อื่นในระบบคาดหวัง
const token = jwt.sign(
  { id: 1, email: "test@example.com", role: "student" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" },
);

console.log(token);
