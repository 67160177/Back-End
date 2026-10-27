// รัน API หลัก และ notification-service พร้อมกันด้วยคำสั่งเดียว (npm start / npm run dev)
// แต่ละ service ยังเป็นคนละ process กัน ปิดตัวหนึ่งได้โดยอีกตัวยังทำงาน
// --watch: รีสตาร์ทอัตโนมัติเมื่อแก้โค้ด (ใช้ node --watch ที่มีใน Node.js 18+)

const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const watch = process.argv.includes("--watch");

const services = [
  { name: "notification", file: "services/notification-service/index.js" },
  { name: "api", file: "src/index.js" },
];

const children = services.map(({ name, file }) => {
  const args = [...(watch ? ["--watch"] : []), path.join(root, file)];
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });

  child.on("exit", (code, signal) => {
    if (signal !== "SIGTERM") {
      console.log(`[start-all] ${name} หยุดทำงาน (exit code ${code})`);
    }
  });

  return child;
});

const stopAll = () => {
  children.forEach((child) => child.kill("SIGTERM"));
  process.exit(0);
};

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
