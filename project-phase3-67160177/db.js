// ==========================================
// Connection Pool ของ MySQL (สัปดาห์ที่ 5)
// ใช้โดย boardgame-service (src/index.js)
//
// ทำไมใช้ pool: เปิด connection ใหม่ทุกคำขอช้าและเปลืองทรัพยากรฐานข้อมูล
// pool เปิด connection ค้างไว้แล้วหมุนเวียนให้แต่ละคำขอยืมใช้ แล้วคืนเมื่อ query เสร็จ
// ==========================================

const mysql = require("mysql2/promise"); // เวอร์ชัน promise ใช้ await ได้

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "boardgame_db",

  waitForConnections: true, // connection เต็ม: ให้คำขอรอคิว แทนการ error ทันที
  connectionLimit: 10, // เปิดพร้อมกันได้สูงสุด 10 connection ต่อ process
  queueLimit: 0, // ไม่จำกัดจำนวนคำขอที่รอคิว
});

module.exports = pool;
