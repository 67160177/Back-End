-- ย้อน 004: สร้างตาราง users กลับมา (โครงสร้างเดียวกับ 002 ข้อมูลสมาชิกเดิมไม่กลับมา)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(30) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('member') NOT NULL DEFAULT 'member',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
