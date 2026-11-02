-- 006: เพิ่มบทบาทผู้ใช้ (member / admin)
-- สมัครผ่านหน้าเว็บได้ member เสมอ ส่วน admin สร้างด้วย npm run create-admin เท่านั้น
-- MySQL ไม่มี ADD COLUMN IF NOT EXISTS จึงตรวจจาก information_schema ก่อน (รันซ้ำได้)

SET @has_column := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'role'
);

SET @ddl := IF(
    @has_column = 0,
    'ALTER TABLE users ADD COLUMN role ENUM(''member'', ''admin'') NOT NULL DEFAULT ''member'' AFTER password_hash',
    'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
