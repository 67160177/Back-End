// student-service/index.js
const express = require("express");
const app = express();
app.use(express.json());

// log ทุก request ที่เข้ามา เพื่อใช้ยืนยันในจุดตรวจสอบที่ 2
// ว่า request ที่ไม่มี token ถูก Gateway ปฏิเสธโดยไม่ถูกส่งต่อมาที่ service นี้
app.use((req, res, next) => {
  console.log(`[student-service] ${req.method} ${req.originalUrl}`);
  next();
});

// ข้อมูลจำลอง แทนการเชื่อมต่อ MySQL จริง เพื่อให้ทดลองได้รวดเร็วในห้องปฏิบัติการ
const students = [
  { id: 1, name: "สมชาย ใจดี", major: "Computer Science" },
  { id: 2, name: "สมหญิง รักเรียน", major: "Information Technology" },
];

app.get("/students", (req, res) => {
  res.status(200).json({ data: students });
});

app.get("/students/:id", (req, res) => {
  const student = students.find((s) => s.id === Number(req.params.id));
  if (!student) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Student not found" },
    });
  }
  res.status(200).json({ data: student });
});

app.listen(4001, () => console.log("Student Service running on port 4001"));
