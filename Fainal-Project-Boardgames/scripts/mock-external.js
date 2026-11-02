// Mock server สำหรับจำลอง API ภายนอกที่ล้มเหลว (ใช้ทดสอบ failure scenario และสาธิตตอน Defense)
//
// วิธีใช้: npm run mock:external -- <mode> [port]
//   ok    ตอบ 204 ทันที (เหมือน Discord ปกติ)
//   fail  ตอบ 503 ทุกครั้ง
//   slow  รอ 10 วินาทีก่อนตอบ (ทดสอบ timeout)
//
// แล้วตั้ง DISCORD_WEBHOOK_URL=http://localhost:<port>/webhook ให้ notification-service
// หรือ NOTIFICATION_SERVICE_URL=http://localhost:<port> ให้ API หลัก

const http = require("http");

const mode = process.argv[2] || "ok";
const port = Number(process.argv[3]) || 4000;

if (!["ok", "fail", "slow"].includes(mode)) {
  console.error('mode ต้องเป็น "ok", "fail" หรือ "slow"');
  process.exit(1);
}

let count = 0;

http
  .createServer((req, res) => {
    count++;
    console.log(`[mock-external:${mode}] คำขอที่ ${count}: ${req.method} ${req.url}`);

    if (mode === "ok") {
      res.writeHead(204).end();
    } else if (mode === "fail") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "service unavailable" }));
    } else {
      setTimeout(() => res.writeHead(204).end(), 10000);
    }
  })
  .listen(port, () => {
    console.log(`[mock-external] mode=${mode} ทำงานที่ http://localhost:${port}`);
  });
