-- ย้อน 003: ลบคอลัมน์ created_at ของ boardgames
SET @has_column := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'boardgames'
      AND COLUMN_NAME = 'created_at'
);

SET @ddl := IF(@has_column = 1, 'ALTER TABLE boardgames DROP COLUMN created_at', 'DO 0');

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
