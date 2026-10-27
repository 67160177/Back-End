require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");

const pool = require("./db");
const { notifyBoardgameCreated } = require("./services/external-api");

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
// HELPERS (validation และ error response ที่ใช้ร่วมกัน)
// ==========================================

const NAME_MAX_LENGTH = 100; // ตรงกับ VARCHAR(100) ใน schema.sql
const MAX_PLAYERS = 2147483647; // ค่าสูงสุดของคอลัมน์ INT ใน MySQL

// จำนวนผู้เล่นต้องอยู่ในช่วง 1..MAX_PLAYERS และ max >= min
const isValidPlayerRange = (minPlayers, maxPlayers) =>
  minPlayers >= 1 && maxPlayers >= minPlayers && maxPlayers <= MAX_PLAYERS;

// ตรวจสอบว่าเป็นเลขจำนวนเต็มบวกหรือไม่
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;

const isValidName = (name) =>
  typeof name === "string" &&
  name.trim() !== "" &&
  name.trim().length <= NAME_MAX_LENGTH;

const badRequest = (res, code, message) =>
  res.status(400).json({
    error: { code, message },
  });

const invalidId = (res, field = "id") =>
  badRequest(res, "INVALID_ID", `${field} ต้องเป็นตัวเลขจำนวนเต็มบวก`);

const invalidName = (res) =>
  badRequest(
    res,
    "INVALID_NAME",
    `name ต้องเป็นข้อความที่ไม่ว่างเปล่าและยาวไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร`,
  );

const invalidPlayerRange = (res) =>
  badRequest(
    res,
    "INVALID_PLAYER_RANGE",
    `จำนวนผู้เล่นต้องอยู่ระหว่าง 1 ถึง ${MAX_PLAYERS} และ maxPlayers ต้องมากกว่าหรือเท่ากับ minPlayers`,
  );

const boardgameNotFound = (res) =>
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "ไม่พบบอร์ดเกม",
    },
  });

const categoryNotFound = (res) =>
  res.status(404).json({
    error: {
      code: "CATEGORY_NOT_FOUND",
      message: "ไม่พบหมวดหมู่",
    },
  });

const duplicateName = (res) =>
  res.status(409).json({
    error: {
      code: "DUPLICATE_NAME",
      message: "มีชื่อบอร์ดเกมนี้อยู่ในระบบแล้ว",
    },
  });

const duplicateCategory = (res) =>
  res.status(409).json({
    error: {
      code: "DUPLICATE_CATEGORY",
      message: "มีชื่อหมวดหมู่นี้อยู่ในระบบแล้ว",
    },
  });

// ตรวจ body ของ POST/PUT boardgames (ต้องส่งครบทุกฟิลด์)
// คืนค่า true ถ้าผ่าน ถ้าไม่ผ่านจะตอบ 400 ให้แล้วคืน false
const validateBoardgameBody = ({ name, minPlayers, maxPlayers }, res) => {
  if (
    name === undefined ||
    name === null ||
    name === "" ||
    minPlayers === undefined ||
    minPlayers === null ||
    maxPlayers === undefined ||
    maxPlayers === null
  ) {
    badRequest(
      res,
      "MISSING_FIELDS",
      "กรุณาระบุ name, minPlayers และ maxPlayers ให้ครบถ้วน",
    );
    return false;
  }

  if (!isValidName(name)) {
    invalidName(res);
    return false;
  }

  if (!Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers)) {
    badRequest(
      res,
      "INVALID_PLAYERS",
      "minPlayers และ maxPlayers ต้องเป็นตัวเลขจำนวนเต็ม",
    );
    return false;
  }

  if (!isValidPlayerRange(minPlayers, maxPlayers)) {
    invalidPlayerRange(res);
    return false;
  }

  return true;
};

const validateCategoryName = (name, res) => {
  if (name === undefined || name === null || name === "") {
    badRequest(res, "MISSING_FIELDS", "กรุณาระบุ name");
    return false;
  }

  if (!isValidName(name)) {
    invalidName(res);
    return false;
  }

  return true;
};

// ==========================================
// ROOT ENDPOINT
// ==========================================

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Board Game API พร้อมใช้งาน",
  });
});

// ==========================================
// SWAGGER UI (เอกสาร API จาก openapi.yaml)
// ==========================================

const openapiDocument = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8"),
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

// ==========================================
// BOARDGAMES API ROUTES
// ==========================================

// 1. GET: ดึงรายการบอร์ดเกมทั้งหมด
// รองรับ ?category=... หรือ ?category_id=...
app.get("/api/v1/boardgames", async (req, res, next) => {
  try {
    const { category, category_id } = req.query;

    // ส่ง query ซ้ำ (เช่น ?category=a&category=b) จะได้ array ซึ่งไม่รองรับ
    if (category !== undefined && typeof category !== "string") {
      return badRequest(
        res,
        "INVALID_QUERY",
        "category ต้องเป็นข้อความและระบุได้เพียงค่าเดียว",
      );
    }

    if (
      category_id !== undefined &&
      category_id !== "" &&
      !isPositiveInt(Number(category_id))
    ) {
      return invalidId(res, "category_id");
    }

    let query = `
      SELECT
        b.id,
        b.name,
        b.minPlayers,
        b.maxPlayers,
        GROUP_CONCAT(c.name ORDER BY c.id) AS categories
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

      params.push(Number(category_id));
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

    if (!isPositiveInt(id)) return invalidId(res);

    const query = `
      SELECT
        b.id,
        b.name,
        b.minPlayers,
        b.maxPlayers,
        GROUP_CONCAT(c.name ORDER BY c.id) AS categories
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

    if (rows.length === 0) return boardgameNotFound(res);

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
  const body = req.body || {};

  if (!validateBoardgameBody(body, res)) return;

  const name = body.name.trim();
  const { minPlayers, maxPlayers } = body;

  try {
    const [result] = await pool.query(
      `
      INSERT INTO boardgames
        (name, minPlayers, maxPlayers)
      VALUES (?, ?, ?)
      `,
      [name, minPlayers, maxPlayers],
    );

    const created = {
      id: result.insertId,
      name,
      minPlayers,
      maxPlayers,
    };

    // แจ้งเตือนผ่านบริการภายนอก (Discord Webhook)
    // มี timeout + retry + fallback ถ้าแจ้งเตือนไม่ได้ ระบบยังตอบ 201 ตามปกติ
    const notification = await notifyBoardgameCreated(created);

    res.status(201).json({
      message: "เพิ่มบอร์ดเกมสำเร็จ",
      data: created,
      notification,
    });
  } catch (err) {
    // ชื่อบอร์ดเกมซ้ำ
    if (err.code === "ER_DUP_ENTRY") return duplicateName(res);

    next(err);
  }
});

// 4. PUT: แก้ไขข้อมูลบอร์ดเกมทั้งระเบียน
app.put("/api/v1/boardgames/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  const body = req.body || {};

  // ตรวจสอบ ID
  if (!isPositiveInt(id)) return invalidId(res);

  if (!validateBoardgameBody(body, res)) return;

  const name = body.name.trim();
  const { minPlayers, maxPlayers } = body;

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
      [name, minPlayers, maxPlayers, id],
    );

    if (result.affectedRows === 0) return boardgameNotFound(res);

    res.status(200).json({
      message: "แก้ไขข้อมูลบอร์ดเกมสำเร็จ",
      data: { id, name, minPlayers, maxPlayers },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return duplicateName(res);

    next(err);
  }
});

// 4.1 PATCH: แก้ไขข้อมูลบอร์ดเกมบางฟิลด์
app.patch("/api/v1/boardgames/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  const updates = req.body || {};

  if (!isPositiveInt(id)) return invalidId(res);

  if (Object.keys(updates).length === 0) {
    return badRequest(res, "NO_UPDATES", "กรุณาระบุข้อมูลที่ต้องการแก้ไข");
  }

  // อนุญาตเฉพาะ field ที่กำหนด
  const allowedFields = ["name", "minPlayers", "maxPlayers"];

  for (const key of Object.keys(updates)) {
    if (!allowedFields.includes(key)) {
      return badRequest(
        res,
        "INVALID_FIELD",
        `ไม่อนุญาตให้แก้ไข field: ${key}`,
      );
    }
  }

  // Validation ชื่อ
  if (updates.name !== undefined && !isValidName(updates.name)) {
    return invalidName(res);
  }

  // Validation จำนวนผู้เล่น (ชนิดข้อมูล)
  for (const key of ["minPlayers", "maxPlayers"]) {
    if (updates[key] !== undefined && !Number.isInteger(updates[key])) {
      return badRequest(
        res,
        "INVALID_PLAYERS",
        `${key} ต้องเป็นตัวเลขจำนวนเต็ม`,
      );
    }
  }

  try {
    const [existing] = await pool.query(
      "SELECT * FROM boardgames WHERE id = ?",
      [id],
    );

    if (existing.length === 0) return boardgameNotFound(res);

    // รวมค่าใหม่กับค่าเดิม แล้วตรวจช่วงจำนวนผู้เล่นจากค่ารวม
    const merged = {
      name: updates.name !== undefined ? updates.name.trim() : existing[0].name,
      minPlayers:
        updates.minPlayers !== undefined
          ? updates.minPlayers
          : existing[0].minPlayers,
      maxPlayers:
        updates.maxPlayers !== undefined
          ? updates.maxPlayers
          : existing[0].maxPlayers,
    };

    if (!isValidPlayerRange(merged.minPlayers, merged.maxPlayers)) {
      return invalidPlayerRange(res);
    }

    await pool.query(
      `
      UPDATE boardgames
      SET name = ?, minPlayers = ?, maxPlayers = ?
      WHERE id = ?
      `,
      [merged.name, merged.minPlayers, merged.maxPlayers, id],
    );

    res.status(200).json({
      message: "แก้ไขข้อมูลบอร์ดเกมสำเร็จ",
      data: { id, ...merged },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return duplicateName(res);

    next(err);
  }
});

// 5. DELETE: ลบบอร์ดเกม
app.delete("/api/v1/boardgames/:id", async (req, res, next) => {
  const id = Number(req.params.id);

  if (!isPositiveInt(id)) return invalidId(res);

  try {
    const [result] = await pool.query("DELETE FROM boardgames WHERE id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) return boardgameNotFound(res);

    res.status(200).json({
      message: "ลบบอร์ดเกมสำเร็จ",
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// CATEGORIES API ROUTES
// ==========================================

// 6. GET: ดึงรายการหมวดหมู่ทั้งหมด (พร้อมจำนวนบอร์ดเกมในแต่ละหมวด)
app.get("/api/v1/categories", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        c.id,
        c.name,
        COUNT(bc.boardgame_id) AS boardgameCount
      FROM categories c
      LEFT JOIN boardgame_categories bc
        ON c.id = bc.category_id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `);

    res.status(200).json({
      message: "สำเร็จ",
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

// 7. GET: ดึงข้อมูลหมวดหมู่ตาม ID
app.get("/api/v1/categories/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInt(id)) return invalidId(res);

    const [rows] = await pool.query(
      `
      SELECT
        c.id,
        c.name,
        COUNT(bc.boardgame_id) AS boardgameCount
      FROM categories c
      LEFT JOIN boardgame_categories bc
        ON c.id = bc.category_id
      WHERE c.id = ?
      GROUP BY c.id, c.name
      `,
      [id],
    );

    if (rows.length === 0) return categoryNotFound(res);

    res.status(200).json({
      message: "สำเร็จ",
      data: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// 8. POST: เพิ่มหมวดหมู่ใหม่
app.post("/api/v1/categories", async (req, res, next) => {
  const { name } = req.body || {};

  if (!validateCategoryName(name, res)) return;

  try {
    const trimmed = name.trim();

    const [result] = await pool.query(
      "INSERT INTO categories (name) VALUES (?)",
      [trimmed],
    );

    res.status(201).json({
      message: "เพิ่มหมวดหมู่สำเร็จ",
      data: { id: result.insertId, name: trimmed },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return duplicateCategory(res);

    next(err);
  }
});

// 9. PUT: แก้ไขชื่อหมวดหมู่
app.put("/api/v1/categories/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  const { name } = req.body || {};

  if (!isPositiveInt(id)) return invalidId(res);

  if (!validateCategoryName(name, res)) return;

  try {
    const trimmed = name.trim();

    const [result] = await pool.query(
      "UPDATE categories SET name = ? WHERE id = ?",
      [trimmed, id],
    );

    if (result.affectedRows === 0) return categoryNotFound(res);

    res.status(200).json({
      message: "แก้ไขหมวดหมู่สำเร็จ",
      data: { id, name: trimmed },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return duplicateCategory(res);

    next(err);
  }
});

// 10. DELETE: ลบหมวดหมู่ (ความสัมพันธ์ใน boardgame_categories ถูกลบตามด้วย ON DELETE CASCADE)
app.delete("/api/v1/categories/:id", async (req, res, next) => {
  const id = Number(req.params.id);

  if (!isPositiveInt(id)) return invalidId(res);

  try {
    const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) return categoryNotFound(res);

    res.status(200).json({
      message: "ลบหมวดหมู่สำเร็จ",
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// BOARDGAME <-> CATEGORY RELATION ROUTES
// ==========================================

// 11. GET: ดึงหมวดหมู่ทั้งหมดของบอร์ดเกมหนึ่งรายการ
app.get("/api/v1/boardgames/:id/categories", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInt(id)) return invalidId(res);

    const [games] = await pool.query("SELECT id FROM boardgames WHERE id = ?", [
      id,
    ]);

    if (games.length === 0) return boardgameNotFound(res);

    const [rows] = await pool.query(
      `
      SELECT c.id, c.name
      FROM categories c
      INNER JOIN boardgame_categories bc
        ON c.id = bc.category_id
      WHERE bc.boardgame_id = ?
      ORDER BY c.id
      `,
      [id],
    );

    res.status(200).json({
      message: "สำเร็จ",
      data: rows,
    });
  } catch (err) {
    next(err);
  }
});

// 12. POST: ผูกหมวดหมู่กับบอร์ดเกม  body: { "category_id": 1 }
app.post("/api/v1/boardgames/:id/categories", async (req, res, next) => {
  const id = Number(req.params.id);
  const { category_id } = req.body || {};

  if (!isPositiveInt(id)) return invalidId(res);

  if (category_id === undefined || category_id === null) {
    return badRequest(res, "MISSING_FIELDS", "กรุณาระบุ category_id");
  }

  if (!isPositiveInt(category_id)) return invalidId(res, "category_id");

  try {
    const [games] = await pool.query("SELECT id FROM boardgames WHERE id = ?", [
      id,
    ]);

    if (games.length === 0) return boardgameNotFound(res);

    const [categories] = await pool.query(
      "SELECT id, name FROM categories WHERE id = ?",
      [category_id],
    );

    if (categories.length === 0) return categoryNotFound(res);

    await pool.query(
      "INSERT INTO boardgame_categories (boardgame_id, category_id) VALUES (?, ?)",
      [id, category_id],
    );

    res.status(201).json({
      message: "เพิ่มหมวดหมู่ให้บอร์ดเกมสำเร็จ",
      data: {
        boardgame_id: id,
        category: categories[0],
      },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: {
          code: "ALREADY_LINKED",
          message: "บอร์ดเกมนี้อยู่ในหมวดหมู่นี้อยู่แล้ว",
        },
      });
    }

    next(err);
  }
});

// 13. DELETE: ถอดหมวดหมู่ออกจากบอร์ดเกม
app.delete(
  "/api/v1/boardgames/:id/categories/:categoryId",
  async (req, res, next) => {
    const id = Number(req.params.id);
    const categoryId = Number(req.params.categoryId);

    if (!isPositiveInt(id)) return invalidId(res);
    if (!isPositiveInt(categoryId)) return invalidId(res, "categoryId");

    try {
      const [result] = await pool.query(
        "DELETE FROM boardgame_categories WHERE boardgame_id = ? AND category_id = ?",
        [id, categoryId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: {
            code: "LINK_NOT_FOUND",
            message: "ไม่พบความสัมพันธ์ระหว่างบอร์ดเกมกับหมวดหมู่นี้",
          },
        });
      }

      res.status(200).json({
        message: "ถอดหมวดหมู่ออกจากบอร์ดเกมสำเร็จ",
      });
    } catch (err) {
      next(err);
    }
  },
);

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
