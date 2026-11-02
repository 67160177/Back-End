-- ย้อน 006: ลบคอลัมน์ role (admin ทุกคนกลายเป็นผู้ใช้ธรรมดา)
SET @has_column := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'role'
);

SET @ddl := IF(@has_column = 1, 'ALTER TABLE users DROP COLUMN role', 'DO 0');

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
