require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(helmet());

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);

app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" }));

// ==========================================
// ROOT ENDPOINT
// ==========================================

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Board Game API พร้อมใช้งาน",
  });
});

// ==========================================
// BOARDGAMES API ROUTES
// ==========================================

// 1. GET: ดึงรายการบอร์ดเกมทั้งหมด
// รองรับ ?category=... หรือ ?category_id=...
app.get("/api/v1/boardgames", async (req, res, next) => {
  try {
    const { category, category_id } = req.query;

    let query = `
      SELECT
        b.id,
        b.name,
        b.minPlayers,
        b.maxPlayers,
        GROUP_CONCAT(c.name) AS categories
      FROM boardgames b
      LEFT JOIN boardgame_categories bc
        ON b.id = bc.boardgame_id
      LEFT JOIN categories c
        ON bc.category_id = c.id
    `;

    const params = [];

    if (category) {
      query += `
        WHERE LOWER(c.name) = LOWER(?)
      `;

      params.push(category);
    } else if (category_id) {
      query += `
        WHERE c.id = ?
      `;

      params.push(category_id);
    }

    query += `
      GROUP BY
        b.id,
        b.name,
        b.minPlayers,
        b.maxPlayers
      ORDER BY b.id;
    `;

    const [rows] = await pool.query(query, params);

    res.status(200).json({
      message: "สำเร็จ",
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

// 2. GET: ดึงข้อมูลบอร์ดเกมตาม ID
app.get("/api/v1/boardgames/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: {
          code: "INVALID_ID",
          message: "id ต้องเป็นตัวเลขจำนวนเต็มบวก",
        },
      });
    }

    const query = `
      SELECT
        b.id,
        b.name,
        b.minPlayers,
        b.maxPlayers,
        GROUP_CONCAT(c.name) AS categories
      FROM boardgames b
      LEFT JOIN boardgame_categories bc
        ON b.id = bc.boardgame_id
      LEFT JOIN categories c
        ON bc.category_id = c.id
      WHERE b.id = ?
      GROUP BY
        b.id,
        b.name,
        b.minPlayers,
        b.maxPlayers;
    `;

    const [rows] = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบบอร์ดเกม",
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

// 3. POST: เพิ่มบอร์ดเกมใหม่
app.post("/api/v1/boardgames", async (req, res, next) => {
  const { name, minPlayers, maxPlayers } = req.body;

  // Validation
  if (!name || minPlayers === undefined || maxPlayers === undefined) {
    return res.status(400).json({
      error: {
        code: "MISSING_FIELDS",
        message: "กรุณาระบุ name, minPlayers และ maxPlayers ให้ครบถ้วน",
      },
    });
  }

  if (
    !Number.isInteger(Number(minPlayers)) ||
    !Number.isInteger(Number(maxPlayers))
  ) {
    return res.status(400).json({
      error: {
        code: "INVALID_PLAYERS",
        message: "minPlayers และ maxPlayers ต้องเป็นตัวเลขจำนวนเต็ม",
      },
    });
  }

  if (Number(minPlayers) < 1 || Number(maxPlayers) < Number(minPlayers)) {
    return res.status(400).json({
      error: {
        code: "INVALID_PLAYER_RANGE",
        message:
          "จำนวนผู้เล่นต้องมีค่าอย่างน้อย 1 และ maxPlayers ต้องมากกว่าหรือเท่ากับ minPlayers",
      },
    });
  }

  try {
    const [result] = await pool.query(
      `
      INSERT INTO boardgames
        (name, minPlayers, maxPlayers)
      VALUES (?, ?, ?)
      `,
      [name, Number(minPlayers), Number(maxPlayers)],
    );

    res.status(201).json({
      message: "เพิ่มบอร์ดเกมสำเร็จ",
      data: {
        id: result.insertId,
        name,
        minPlayers: Number(minPlayers),
        maxPlayers: Number(maxPlayers),
      },
    });
  } catch (err) {
    // ชื่อบอร์ดเกมซ้ำ
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_NAME",
          message: "มีชื่อบอร์ดเกมนี้อยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// 4. PUT: แก้ไขข้อมูลบอร์ดเกมทั้งระเบียน
app.put("/api/v1/boardgames/:id", async (req, res, next) => {
  const id = Number(req.params.id);

  const { name, minPlayers, maxPlayers } = req.body;

  // ตรวจสอบ ID
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: {
        code: "INVALID_ID",
        message: "id ต้องเป็นตัวเลขจำนวนเต็มบวก",
      },
    });
  }

  // Validation
  if (!name || minPlayers === undefined || maxPlayers === undefined) {
    return res.status(400).json({
      error: {
        code: "MISSING_FIELDS",
        message: "กรุณาระบุ name, minPlayers และ maxPlayers ให้ครบถ้วน",
      },
    });
  }

  if (
    !Number.isInteger(Number(minPlayers)) ||
    !Number.isInteger(Number(maxPlayers))
  ) {
    return res.status(400).json({
      error: {
        code: "INVALID_PLAYERS",
        message: "minPlayers และ maxPlayers ต้องเป็นตัวเลขจำนวนเต็ม",
      },
    });
  }

  if (Number(minPlayers) < 1 || Number(maxPlayers) < Number(minPlayers)) {
    return res.status(400).json({
      error: {
        code: "INVALID_PLAYER_RANGE",
        message: "จำนวนผู้เล่นไม่ถูกต้อง",
      },
    });
  }

  try {
    const [result] = await pool.query(
      `
      UPDATE boardgames
      SET
        name = ?,
        minPlayers = ?,
        maxPlayers = ?
      WHERE id = ?
      `,
      [name, Number(minPlayers), Number(maxPlayers), id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบบอร์ดเกม",
        },
      });
    }

    res.status(200).json({
      message: "แก้ไขข้อมูลบอร์ดเกมสำเร็จ",
      data: {
        id,
        name,
        minPlayers: Number(minPlayers),
        maxPlayers: Number(maxPlayers),
      },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_NAME",
          message: "มีชื่อบอร์ดเกมนี้อยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// 4.1 PATCH: แก้ไขข้อมูลบอร์ดเกมบางฟิลด์
app.patch("/api/v1/boardgames/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  const updates = req.body;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: {
        code: "INVALID_ID",
        message: "id ต้องเป็นตัวเลขจำนวนเต็มบวก",
      },
    });
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      error: {
        code: "NO_UPDATES",
        message: "กรุณาระบุข้อมูลที่ต้องการแก้ไข",
      },
    });
  }

  // อนุญาตเฉพาะ field ที่กำหนด
  const allowedFields = ["name", "minPlayers", "maxPlayers"];

  const fields = [];
  const values = [];

  for (const key of Object.keys(updates)) {
    if (!allowedFields.includes(key)) {
      return res.status(400).json({
        error: {
          code: "INVALID_FIELD",
          message: `ไม่อนุญาตให้แก้ไข field: ${key}`,
        },
      });
    }

    fields.push(`${key} = ?`);
    values.push(updates[key]);
  }

  // Validation จำนวนผู้เล่น
  if (updates.minPlayers !== undefined) {
    if (!Number.isInteger(Number(updates.minPlayers))) {
      return res.status(400).json({
        error: {
          code: "INVALID_PLAYERS",
          message: "minPlayers ต้องเป็นตัวเลขจำนวนเต็ม",
        },
      });
    }

    values[fields.findIndex((field) => field.startsWith("minPlayers"))] =
      Number(updates.minPlayers);
  }

  if (updates.maxPlayers !== undefined) {
    if (!Number.isInteger(Number(updates.maxPlayers))) {
      return res.status(400).json({
        error: {
          code: "INVALID_PLAYERS",
          message: "maxPlayers ต้องเป็นตัวเลขจำนวนเต็ม",
        },
      });
    }

    values[fields.findIndex((field) => field.startsWith("maxPlayers"))] =
      Number(updates.maxPlayers);
  }

  try {
    values.push(id);

    const [result] = await pool.query(
      `
      UPDATE boardgames
      SET ${fields.join(", ")}
      WHERE id = ?
      `,
      values,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบบอร์ดเกม",
        },
      });
    }

    const [updatedRows] = await pool.query(
      "SELECT * FROM boardgames WHERE id = ?",
      [id],
    );

    res.status(200).json({
      message: "แก้ไขข้อมูลบอร์ดเกมสำเร็จ",
      data: updatedRows[0],
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "DUPLICATE_NAME",
          message: "มีชื่อบอร์ดเกมนี้อยู่ในระบบแล้ว",
        },
      });
    }

    next(err);
  }
});

// 5. DELETE: ลบบอร์ดเกม
app.delete("/api/v1/boardgames/:id", async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: {
        code: "INVALID_ID",
        message: "id ต้องเป็นตัวเลขจำนวนเต็มบวก",
      },
    });
  }

  try {
    const [result] = await pool.query("DELETE FROM boardgames WHERE id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "ไม่พบบอร์ดเกม",
        },
      });
    }

    res.status(200).json({
      message: "ลบบอร์ดเกมสำเร็จ",
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// MIDDLEWARES
// ==========================================

// 404: ไม่พบ Route
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "ไม่พบเส้นทางที่ร้องขอ",
    },
  });
});

// Error-handling middleware
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

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่ http://localhost:${PORT}`);
});
