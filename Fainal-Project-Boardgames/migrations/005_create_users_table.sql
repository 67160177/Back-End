-- 005: ตารางผู้ใช้สำหรับระบบเข้าสู่ระบบ - เจ้าของคือ auth-service (service อื่นไม่อ่าน/เขียนตารางนี้)
-- password_hash เก็บรูปแบบ "scrypt$<salt>$<hash>" ไม่เก็บรหัสผ่านจริง

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(30) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
