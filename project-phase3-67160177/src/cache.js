// ==========================================
// Cache ในหน่วยความจำสำหรับคำขอ GET (สัปดาห์ที่ 7)
//
// - เก็บผลของ GET /api/v1/* ที่ตอบ 200 ตาม URL (รวม query string) ไว้ CACHE_TTL_MS (ค่าเริ่มต้น 30 วินาที)
// - คำขอที่เปลี่ยนแปลงข้อมูล (POST/PUT/PATCH/DELETE) สำเร็จเมื่อไร ล้าง cache ทั้งหมดทันที
//   ผู้ใช้จึงไม่เห็นข้อมูลเก่าหลังแก้ไข (ข้อมูลในระบบน้อย ล้างทั้งหมดง่ายและปลอดภัยกว่าไล่ล้างทีละ key)
// - ตอบ header X-Cache: HIT / MISS ให้เห็นว่ามาจาก cache หรือไม่
// - CACHE_TTL_MS=0 = ปิด cache
//
// ข้อจำกัด: cache อยู่ใน process เดียว ถ้ารัน boardgame-service หลาย instance ควรย้ายไป Redis (ดู scalability-design.md)
// ==========================================

const MAX_ENTRIES = 100; // กัน cache โตไม่จำกัดจาก query string ที่ต่างกัน

const store = new Map(); // key: URL -> { body, expiresAt }

// เลขรุ่นของข้อมูล เพิ่มทุกครั้งที่ล้าง cache
// คำขอ GET ที่อ่านฐานข้อมูลก่อนมีการแก้ไข จะไม่ถูกเก็บลง cache หลังการแก้ไข (กันข้อมูลเก่าค้าง)
let generation = 0;

// อ่านค่าตอนใช้งาน (ไม่ใช่ตอนโหลดไฟล์) เพื่อให้ test เปลี่ยนค่าได้
const ttlMs = () => {
  const value = Number(process.env.CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0 ? value : 30000;
};

function clearCache() {
  store.clear();
  generation++;
}

function cacheResponses(req, res, next) {
  const ttl = ttlMs();

  if (req.method !== "GET") {
    res.on("finish", () => {
      if (res.statusCode < 400) clearCache();
    });
    return next();
  }

  if (ttl === 0) return next();

  const key = req.originalUrl;
  const hit = store.get(key);

  if (hit && hit.expiresAt > Date.now()) {
    res.set("X-Cache", "HIT");
    return res.status(200).json(hit.body);
  }

  store.delete(key);
  res.set("X-Cache", "MISS");

  const startedAt = generation;
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200 && startedAt === generation) {
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // ทิ้งตัวที่เก่าที่สุด
      store.set(key, { body, expiresAt: Date.now() + ttl });
    }
    return json(body);
  };

  next();
}

module.exports = { cacheResponses, clearCache };
