-- 004: ลบตารางสมาชิก (users) ที่เคยใช้กับ auth-service
-- ตัดระบบสมัครสมาชิก/login ออกทั้งหมดแล้ว ไม่มี service ไหนอ่านหรือเขียนตารางนี้

DROP TABLE IF EXISTS users;
