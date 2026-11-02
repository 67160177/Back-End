-- 003: เพิ่มเวลาที่เพิ่มบอร์ดเกม ใช้กับ GET /api/v1/boardgames?sort=createdAt&order=desc (เกมใหม่ล่าสุดก่อน)
-- MySQL ไม่มี ADD COLUMN IF NOT EXISTS จึงตรวจจาก information_schema ก่อน
-- (ฐานข้อมูลที่สร้างจาก schema.sql ล่าสุดมีคอลัมน์นี้อยู่แล้ว)

SET @has_column := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'boardgames'
      AND COLUMN_NAME = 'created_at'
);

SET @ddl := IF(
    @has_column = 0,
    'ALTER TABLE boardgames ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
