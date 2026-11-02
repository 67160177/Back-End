// ตั้งค่าก่อนรันทุกไฟล์ test (jest.setupFiles ใน package.json)
// ปิด cache ของ boardgame-service: แต่ละ test mock ฐานข้อมูลคนละแบบ ถ้าเปิด cache ผลจาก test ก่อนจะค้างมา
// การทำงานของ cache ทดสอบแยกใน tests/cache.test.js
process.env.CACHE_TTL_MS = "0";
