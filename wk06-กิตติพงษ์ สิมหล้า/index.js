require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const { graphqlHTTP } = require("express-graphql");

const pool = require("./db");
const schema = require("./schema");
const root = require("./resolvers");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);

app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" }));

const {
  hashPassword,
  verifyPassword,
  generateToken,
} = require("./auth-helpers");

// routes เริ่มหลังจากตรงนี้
// =========================
// GET: ผู้ใช้ทั้งหมด
// =========================
app.get("/api/v1/users", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, email, role, created_at FROM users",
    );

    res.status(200).json({
      message: "สำเร็จ",
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/v1/auth/register", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุ email และ password",
      },
    });
  }

  try {
    const passwordHash = await hashPassword(password);
    const [result] = await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'student')",
      [email, passwordHash],
    );

    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      data: { id: result.insertId, email, role: "student" },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: { code: "DUPLICATE_EMAIL", message: "อีเมลนี้มีอยู่ในระบบแล้ว" },
      });
    }
    next(err);
  }
});

app.post("/api/v1/auth/login", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุ email และ password",
      },
    });
  }

  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);

    if (rows.length === 0) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
        },
      });
    }

    const user = rows[0];
    const isPasswordValid = await verifyPassword(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
        },
      });
    }

    const token = generateToken(user);
    res.status(200).json({ message: "เข้าสู่ระบบสำเร็จ", token });
  } catch (err) {
    next(err);
  }
});

app.use(morgan("dev"));

// =========================
// GraphQL
// =========================
app.use(
  "/graphql",
  graphqlHTTP({
    schema: schema,
    rootValue: root,
    graphiql: true,
  }),
);

// =========================
// Home
// =========================
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Student API พร้อมใช้งาน",
  });
});

// =========================
// GET: นักศึกษาทั้งหมด
// =========================
app.get("/api/v1/students", async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT * FROM students");

    res.status(200).json({
      message: "สำเร็จ",
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

// =========================
// GET: นักศึกษารายบุคคล + courses
// ต้องอยู่ก่อน /students/:id
// =========================
app.get("/api/v1/students/:id/full", async (req, res, next) => {
  try {
    const [studentRows] = await pool.query(
      "SELECT * FROM students WHERE id = ?",
      [req.params.id],
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบข้อมูลนักศึกษา",
        },
      });
    }

    const [courseRows] = await pool.query(
      `
      SELECT c.*
      FROM courses c
      INNER JOIN student_courses sc ON c.id = sc.course_id
      WHERE sc.student_id = ?
      `,
      [req.params.id],
    );

    res.status(200).json({
      message: "สำเร็จ",
      data: {
        ...studentRows[0],
        courses: courseRows,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/v1/students/:id/enrollments", async (req, res, next) => {
  const studentId = req.params.id;
  const { courseId } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [courseRows] = await connection.query(
      "SELECT * FROM courses WHERE id = ? FOR UPDATE",
      [courseId],
    );

    if (courseRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: { code: "COURSE_NOT_FOUND", message: "ไม่พบรายวิชาที่ระบุ" },
      });
    }

    if (courseRows[0].seat_available <= 0) {
      await connection.rollback();
      return res.status(409).json({
        error: { code: "SEAT_FULL", message: "ที่นั่งเต็มแล้ว" },
      });
    }

    await connection.query(
      "INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)",
      [studentId, courseId],
    );

    await connection.query(
      "UPDATE courses SET seat_available = seat_available - 1 WHERE id = ?",
      [courseId],
    );

    await connection.commit();
    res.status(201).json({ message: "ลงทะเบียนสำเร็จ" });
  } catch (err) {
    await connection.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "ALREADY_ENROLLED",
          message: "นิสิตลงทะเบียนรายวิชานี้ไปแล้ว",
        },
      });
    }
    next(err);
  } finally {
    connection.release();
  }
});

// =========================
// GET: นักศึกษารายบุคคล
// =========================
app.get("/api/v1/students/:id", async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT * FROM students WHERE id = ?", [
      req.params.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบข้อมูลนักศึกษา",
        },
      });
    }

    res.status(200).json({
      message: "สำเร็จ",
      data: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// =========================
// POST: เพิ่มนักศึกษา
// =========================
app.post("/api/v1/students", async (req, res, next) => {
  const { name, major, email } = req.body;

  if (!name || !major || !email) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุข้อมูลให้ครบถ้วน",
      },
    });
  }

  try {
    const [result] = await pool.query(
      `
      INSERT INTO students (name, major, email)
      VALUES (?, ?, ?)
      `,
      [name, major, email],
    );

    res.status(201).json({
      message: "เพิ่มข้อมูลสำเร็จ",
      data: {
        id: result.insertId,
        name,
        major,
        email,
      },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_EMAIL",
          message: "อีเมลนี้มีอยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// =========================
// PUT: แก้ไขข้อมูลทั้งระเบียน
// =========================
app.put("/api/v1/students/:id", async (req, res, next) => {
  const { name, major, email } = req.body;

  if (!name || !major || !email) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุ name, major และ email ให้ครบถ้วน",
      },
    });
  }

  try {
    const [result] = await pool.query(
      `
      UPDATE students
      SET name = ?, major = ?, email = ?
      WHERE id = ?
      `,
      [name, major, email, req.params.id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบข้อมูลนักศึกษา",
        },
      });
    }

    const [rows] = await pool.query("SELECT * FROM students WHERE id = ?", [
      req.params.id,
    ]);

    res.status(200).json({
      message: "แก้ไขข้อมูลสำเร็จ",
      data: rows[0],
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_EMAIL",
          message: "อีเมลนี้มีอยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// =========================
// PATCH: แก้ไขบางฟิลด์
// =========================
app.patch("/api/v1/students/:id", async (req, res, next) => {
  const { name, major, email } = req.body;

  if (name === undefined && major === undefined && email === undefined) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุข้อมูลที่ต้องการแก้ไข",
      },
    });
  }

  try {
    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }

    if (major !== undefined) {
      fields.push("major = ?");
      values.push(major);
    }

    if (email !== undefined) {
      fields.push("email = ?");
      values.push(email);
    }

    values.push(req.params.id);

    const [result] = await pool.query(
      `UPDATE students SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบข้อมูลนักศึกษา",
        },
      });
    }

    const [rows] = await pool.query("SELECT * FROM students WHERE id = ?", [
      req.params.id,
    ]);

    res.status(200).json({
      message: "แก้ไขข้อมูลสำเร็จ",
      data: rows[0],
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_EMAIL",
          message: "อีเมลนี้มีอยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// =========================
// DELETE: ลบนักศึกษา
// =========================
const { authenticateToken, authorizeRole } = require("./middlewares/auth");

app.delete(
  "/api/v1/students/:id",
  authenticateToken,
  authorizeRole("admin"),
  async (req, res, next) => {
    try {
      const [result] = await pool.query("DELETE FROM students WHERE id = ?", [
        req.params.id,
      ]);
      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "ไม่พบข้อมูลนิสิต" },
        });
      }
      res.status(200).json({ message: "ลบข้อมูลสำเร็จ" });
    } catch (err) {
      next(err);
    }
  },
);

// เพิ่ม route ใหม่: เฉพาะผู้ที่ล็อกอินแล้วเท่านั้นที่ดูข้อมูลของตนเองได้
app.get("/api/v1/auth/me", authenticateToken, (req, res) => {
  res.status(200).json({ message: "สำเร็จ", data: req.user });
});

// =========================
// GET: รายวิชา
// =========================
app.get("/api/v1/courses/:id", async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT * FROM courses WHERE id = ?", [
      req.params.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบข้อมูลรายวิชา",
        },
      });
    }

    res.status(200).json({
      message: "สำเร็จ",
      data: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// =========================
// 404
// ต้องอยู่หลัง route ทั้งหมด
// =========================
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "ไม่พบเส้นทางที่ร้องขอ",
    },
  });
});

// =========================
// Error Handler
// =========================
app.use((err, req, res, next) => {
  console.error(err.stack);

  const statusCode = err.status || err.statusCode || 500;

  res.status(statusCode).json({
    error: {
      code: statusCode === 500 ? "INTERNAL_SERVER_ERROR" : err.type || "ERROR",

      message:
        statusCode === 500
          ? "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ"
          : err.message,
    },
  });
});

// =========================
// Start Server
// =========================
app.listen(PORT, () => {
  console.log(
    `Server กำลังทำงานที่ http://localhost:${PORT} (${process.env.NODE_ENV})`,
  );
});
