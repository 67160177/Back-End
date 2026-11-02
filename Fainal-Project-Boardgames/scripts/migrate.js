// ==========================================
// Migration Script (สัปดาห์ที่ 14)
//
//   npm run migrate          รัน migration ที่ยังไม่เคยรันทั้งหมด ตามลำดับเลขไฟล์
//   npm run migrate:status   ดูว่าไฟล์ไหนรันแล้ว/ยังไม่รัน
//   npm run migrate:down     ย้อน migration ล่าสุด 1 ไฟล์ (ใช้ไฟล์ .down.sql คู่กัน)
//
// - ไฟล์อยู่ใน migrations/ ชื่อ NNN_ชื่อ.sql (ขาขึ้น) และ NNN_ชื่อ.down.sql (ขาย้อน)
// - เก็บประวัติในตาราง schema_migrations ไฟล์ที่รันแล้วจะไม่ถูกรันซ้ำ
// - ถ้ายังไม่มีฐานข้อมูล DB_NAME จะสร้างให้
// - ห้ามแก้ไฟล์ migration ที่รันไปแล้ว ถ้าต้องเปลี่ยนโครงสร้างให้เพิ่มไฟล์เลขถัดไป
//
// ข้อควรรู้: MySQL commit คำสั่ง DDL (CREATE/ALTER/DROP) ทันที ครอบด้วย transaction ไม่ได้
// ถ้าไฟล์ล้มกลางทาง จะไม่ถูกบันทึกว่ารันแล้ว ให้แก้ปัญหาแล้วรันใหม่ (ไฟล์ในโปรเจกต์นี้เขียนให้รันซ้ำได้)
// ==========================================

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const UP_FILE = /^(\d+)_[\w-]+\.sql$/;

const log = (message) => console.log(`[migrate] ${message}`);

// ไฟล์ขาขึ้นทั้งหมด เรียงตามเลข (ไม่รวม .down.sql)
function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => UP_FILE.test(file) && !file.endsWith(".down.sql"))
    .sort((a, b) => Number(a.match(UP_FILE)[1]) - Number(b.match(UP_FILE)[1]));
}

async function connect() {
  const database = process.env.DB_NAME || "boardgame_db";

  // ชื่อฐานข้อมูลถูกนำไปต่อใน SQL จึงยอมรับเฉพาะตัวอักษร ตัวเลข และ _
  if (!/^\w+$/.test(database)) throw new Error(`DB_NAME ไม่ถูกต้อง: ${database}`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true, // 1 ไฟล์มีหลายคำสั่ง
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  await connection.query(`USE \`${database}\``);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return { connection, database };
}

async function appliedVersions(connection) {
  const [rows] = await connection.query(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version",
  );
  return new Map(rows.map((r) => [r.version, r.applied_at]));
}

const readSql = (file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

async function up(connection) {
  const applied = await appliedVersions(connection);
  const pending = migrationFiles().filter((file) => !applied.has(file));

  if (pending.length === 0) return log("ฐานข้อมูลเป็นเวอร์ชันล่าสุดแล้ว ไม่มี migration ที่ต้องรัน");

  for (const file of pending) {
    log(`กำลังรัน ${file}`);
    await connection.query(readSql(file));
    await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
  }
  log(`รันสำเร็จ ${pending.length} ไฟล์`);
}

async function down(connection) {
  const applied = [...(await appliedVersions(connection)).keys()].sort();
  const last = applied.at(-1);

  if (!last) return log("ยังไม่มี migration ที่รันไว้ ไม่มีอะไรให้ย้อน");

  const downFile = last.replace(/\.sql$/, ".down.sql");
  if (!fs.existsSync(path.join(MIGRATIONS_DIR, downFile))) {
    throw new Error(`ไม่พบไฟล์ ${downFile} จึงย้อน ${last} ไม่ได้`);
  }

  log(`กำลังย้อน ${last} ด้วย ${downFile}`);
  await connection.query(readSql(downFile));
  await connection.query("DELETE FROM schema_migrations WHERE version = ?", [last]);
  log("ย้อนสำเร็จ");
}

async function status(connection, database) {
  const applied = await appliedVersions(connection);
  log(`ฐานข้อมูล ${database}`);
  for (const file of migrationFiles()) {
    const at = applied.get(file);
    console.log(`  ${at ? "✔ รันแล้ว  " : "✘ ยังไม่รัน"}  ${file}${at ? `  (${new Date(at).toLocaleString("th-TH")})` : ""}`);
  }
}

async function main() {
  const command = process.argv[2] || "up";
  const actions = { up, down, status };

  if (!actions[command]) {
    console.error(`[migrate] ไม่รู้จักคำสั่ง "${command}" (ใช้ได้: up, down, status)`);
    process.exit(1);
  }

  let connection;
  try {
    const db = await connect();
    connection = db.connection;
    await actions[command](connection, db.database);
  } catch (err) {
    console.error(`[migrate] ล้มเหลว: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}

main();
