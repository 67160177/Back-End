-- 002: ตารางสมาชิก (ระยะที่ 3) - เจ้าของคือ auth-service
-- ผู้ดูแลระบบกำหนดใน .env ไม่อยู่ในตารางนี้

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(30) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('member') NOT NULL DEFAULT 'member',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
