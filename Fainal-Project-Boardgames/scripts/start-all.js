// รันทุก service พร้อมกันด้วยคำสั่งเดียว (npm start / npm run dev)
// แต่ละ service ยังเป็นคนละ process กัน ปิดตัวหนึ่งได้โดยตัวอื่นยังทำงาน
// --watch: รีสตาร์ทอัตโนมัติเมื่อแก้โค้ด (ใช้ node --watch ที่มีใน Node.js 18+)

const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const watch = process.argv.includes("--watch");

// เปิดตามลำดับนี้ (Gateway สุดท้าย) แต่ไม่ได้รอกัน: Gateway เรียก service ตอนมีคำขอเท่านั้น
// ถ้า service ไหนยังไม่พร้อม คำขอนั้นได้ 503 แล้วใช้ได้เองเมื่อ service พร้อม
const services = [
  { name: "notification-service", file: "services/notification-service/index.js" },
  { name: "auth-service", file: "services/auth-service/index.js" },
  { name: "boardgame-service", file: "src/index.js" },
  { name: "gateway", file: "gateway/index.js" },
];

// spawn = เปิด node อีก process ต่อ service (process.execPath คือ node ตัวเดียวกับที่รันสคริปต์นี้)
// stdio: "inherit" ให้ log ของทุก service ออกมาใน terminal เดียวกันนี้
const children = services.map(({ name, file }) => {
  const args = [...(watch ? ["--watch"] : []), path.join(root, file)];
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });

  // แจ้งเมื่อ service หยุดเอง (เช่น พอร์ตไม่ว่าง) แต่ไม่แจ้งตอนเราสั่งปิดเอง (SIGTERM)
  child.on("exit", (code, signal) => {
    if (signal !== "SIGTERM") {
      console.log(`[start-all] ${name} หยุดทำงาน (exit code ${code})`);
    }
  });

  return child;
});

// กด Ctrl+C (SIGINT) ปิดทุก service ด้วย ไม่ให้ค้างจองพอร์ตไว้
const stopAll = () => {
  children.forEach((child) => child.kill("SIGTERM"));
  process.exit(0);
};

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
