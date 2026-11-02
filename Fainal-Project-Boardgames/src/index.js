// ==========================================
// Boardgame Service (พอร์ต 4001)
// บริการหลักของ Bounded Context "แคตตาล็อกบอร์ดเกม": บอร์ดเกม หมวดหมู่ และความสัมพันธ์ N:M
// client ไม่เรียก service นี้ตรง แต่เรียกผ่าน API Gateway (gateway/index.js พอร์ต 3000)
// ซึ่งส่งต่อคำขอทุกแบบ (รวมเพิ่ม/แก้ไข/ลบ) มาโดยไม่ตรวจ token
// ==========================================

require("dotenv").config({ quiet: true });

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");

const pool = require("../db");
const { cacheResponses } = require("./cache");
const { notifyBoardgameCreated } = require("./services/external-api");

const app = express();
const PORT = process.env.BOARDGAME_PORT || 4001;

// ==========================================
// MIDDLEWARE (ทำงานตามลำดับที่ app.use ทุกคำขอ)
// ==========================================

// ตั้ง HTTP header ด้านความปลอดภัย (กัน clickjacking, MIME sniffing ฯลฯ)
app.use(helmet());

// อนุญาตให้เว็บจาก origin อื่นเรียก API ได้ (ตั้งให้แคบลงได้ด้วย ALLOWED_ORIGIN)
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);

// log ทุกคำขอ (ปิดตอน test ไม่ให้ผล test รก)
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));

// แปลง body ที่เป็น JSON ให้อยู่ใน req.body จำกัดขนาด 10 KB กันการส่ง body ใหญ่มาให้ server ทำงานหนัก
// (เกินจะได้ 413 ส่วน JSON ผิดรูปแบบได้ 400 จาก error handler ท้ายไฟล์)
app.use(express.json({ limit: "10kb" }));

// cache ผลของ GET และล้างเมื่อมีการเปลี่ยนแปลงข้อมูล (src/cache.js)
app.use("/api/v1", cacheResponses);

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
// SWAGGER UI (เอกสาร API จาก openapi.yaml)
// เปิดได้ทั้งที่ service นี้ (พอร์ต 4001) และที่ Gateway (http://localhost:3000/api-docs)
// ==========================================

const openapiDocument = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8"),
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

// ==========================================
// HEALTH (ให้ Gateway เรียกตรวจสถานะ)
// ==========================================

// service ใช้งานได้ก็ต่อเมื่อฐานข้อมูลตอบได้ ถ้าฐานข้อมูลล่มตอบ 503
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      service: "boardgame-service",
      database: "up",
    });
  } catch {
    res.status(503).json({
      status: "down",
      service: "boardgame-service",
      database: "down",
    });
  }
});

// ==========================================
// BOARDGAMES API ROUTES
// ==========================================

// Pagination / Sorting ของรายการบอร์ดเกม (สัปดาห์ที่ 7)
// คอลัมน์ที่เรียงได้ต้องอยู่ในรายการนี้เท่านั้น (ห้ามนำค่าจาก query ไปต่อ SQL ตรงๆ กัน SQL Injection)
const SORT_COLUMNS = {
  id: "g.id",
  name: "g.name",
  minPlayers: "g.minPlayers",
  maxPlayers: "g.maxPlayers",
  createdAt: "g.created_at",
};
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// อ่าน ?page=&limit=&sort=&order= คืน { error } ถ้าไม่ถูกต้อง
function parseListQuery(query) {
  for (const key of ["page", "limit", "sort", "order"]) {
    if (query[key] !== undefined && typeof query[key] !== "string") {
      return { error: `${key} ระบุได้เพียงค่าเดียว` };
    }
  }

  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  const sort = query.sort ?? "id";
  const order = (query.order ?? "asc").toLowerCase();

  if (!isPositiveInt(page)) {
    return { error: "page ต้องเป็นตัวเลขจำนวนเต็มบวก" };
  }
  if (!isPositiveInt(limit) || limit > MAX_LIMIT) {
    return { error: `limit ต้องเป็นตัวเลขจำนวนเต็มระหว่าง 1 ถึง ${MAX_LIMIT}` };
  }
  if (!Object.hasOwn(SORT_COLUMNS, sort)) {
    return {
      error: `sort ต้องเป็นหนึ่งใน ${Object.keys(SORT_COLUMNS).join(", ")}`,
    };
  }
  if (order !== "asc" && order !== "desc") {
    return { error: "order ต้องเป็น asc หรือ desc" };
  }

  return { page, limit, sort, order };
}

// 1. GET: ดึงรายการบอร์ดเกม
// รองรับ ?category=... หรือ ?category_id=... และ ?page=&limit=&sort=&order=
app.get("/api/v1/boardgames", async (req, res, next) => {
  try {
    const { category, category_id } = req.query;
    const list = parseListQuery(req.query);

    if (list.error) return badRequest(res, "INVALID_QUERY", list.error);

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

    const from = `
      FROM boardgames b
      LEFT JOIN boardgame_categories bc
        ON b.id = bc.boardgame_id
      LEFT JOIN categories c
        ON bc.category_id = c.id
    `;

    let where = "";
    const params = [];

    if (category) {
      where = "WHERE LOWER(c.name) = LOWER(?)";
      params.push(category);
    } else if (category_id) {
      where = "WHERE c.id = ?";
      params.push(Number(category_id));
    }

    const { page, limit, sort, order } = list;
    const direction = order.toUpperCase();
    // เรียงตาม id เป็นลำดับรองเสมอ ให้ผลแต่ละหน้าคงที่เมื่อค่าที่เรียงซ้ำกัน
    const orderBy =
      sort === "id"
        ? `g.id ${direction}`
        : `${SORT_COLUMNS[sort]} ${direction}, g.id ASC`;

    // จัดกลุ่มใน subquery ก่อน แล้วค่อยนับ/เรียง/แบ่งหน้าข้างนอก
    // (MySQL 8.0 ไม่สน ORDER BY เมื่อใช้ GROUP_CONCAT(... ORDER BY) คู่กับ window function ใน SELECT เดียวกัน)
    // COUNT(*) OVER() = จำนวนเกมทั้งหมดที่ตรงเงื่อนไข (ก่อน LIMIT) ได้มาใน query เดียว
    const query = `
      SELECT
        g.id,
        g.name,
        g.minPlayers,
        g.maxPlayers,
        g.categories,
        COUNT(*) OVER() AS total
      FROM (
        SELECT
          b.id,
          b.name,
          b.minPlayers,
          b.maxPlayers,
          b.created_at,
          GROUP_CONCAT(c.name ORDER BY c.id) AS categories
        ${from}
        ${where}
        GROUP BY
          b.id,
          b.name,
          b.minPlayers,
          b.maxPlayers,
          b.created_at
      ) g
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?;
    `;

    const [rows] = await pool.query(query, [
      ...params,
      limit,
      (page - 1) * limit,
    ]);

    let total = rows.length > 0 ? Number(rows[0].total) : 0;

    // ขอหน้าที่เกินจำนวนจริง: ไม่มีแถวให้อ่าน total จึงนับแยก
    if (rows.length === 0 && page > 1) {
      const [[count]] = await pool.query(
        `SELECT COUNT(DISTINCT b.id) AS total ${from} ${where};`,
        params,
      );
      total = Number(count.total);
    }

    res.status(200).json({
      message: "สำเร็จ",
      data: rows.map(({ total: _total, ...game }) => game),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
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

    // LEFT JOIN: เกมที่ยังไม่มีหมวดหมู่ก็ยังได้ผลลัพธ์ (categories เป็น null)
    // GROUP_CONCAT: รวมชื่อหมวดหมู่หลายแถวเป็นข้อความเดียว เช่น "Strategy,Party Game"
    // ใช้ ? (placeholder) เสมอ mysql2 จะ escape ค่าให้ กัน SQL Injection
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

  // ตรวจครบทุกฟิลด์ก่อนแตะฐานข้อมูล ถ้าไม่ผ่านจะตอบ 400 ไปแล้ว
  if (!validateBoardgameBody(body, res)) return;

  const name = body.name.trim(); // " Catan " กับ "Catan" ต้องนับเป็นชื่อเดียวกัน
  const { minPlayers, maxPlayers } = body;

  try {
    // ไม่เช็คชื่อซ้ำด้วย SELECT ก่อน แต่ให้ UNIQUE ของฐานข้อมูลตัดสิน (ER_DUP_ENTRY ด้านล่าง)
    // เพราะถ้าสองคำขอเข้ามาพร้อมกัน SELECT อาจไม่เห็นกันและได้ชื่อซ้ำ
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

    // ไม่มีแถวที่ id ตรง = ไม่พบเกม (ไม่ต้อง SELECT ตรวจก่อน ประหยัด 1 query)
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
    // PATCH ต้องอ่านค่าเดิมก่อน: เช่นส่งมาแค่ minPlayers = 5 ต้องรู้ maxPlayers เดิม
    // จึงจะตรวจได้ว่า max >= min ยังเป็นจริง
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
// แถวใน boardgame_categories ของเกมนี้ถูกลบตามอัตโนมัติ (FK ON DELETE CASCADE ใน schema)
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
// COUNT(bc.boardgame_id) นับเฉพาะแถวที่ไม่เป็น NULL หมวดที่ยังไม่มีเกม (LEFT JOIN ไม่เจอ) จึงได้ 0
// หน้าเว็บใช้ค่านี้แสดงในตัวกรอง เช่น "Strategy (3)"
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
    // ตรวจทีละฝั่งก่อน INSERT เพื่อบอกได้ชัดว่าไม่พบ "เกม" หรือ "หมวดหมู่" (404 คนละ code)
    // ถ้าปล่อยให้ FK ของฐานข้อมูลปฏิเสธ จะได้ error เดียวที่แยกไม่ออกว่าฝั่งไหนผิด
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
    // ผูกซ้ำ: ชน PRIMARY KEY (boardgame_id, category_id) ของตารางกลาง
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

// Error-handling middleware: รับทุก error ที่ route ส่งมาด้วย next(err) หรือที่ express.json โยนมา
// - error ที่รู้สถานะ (เช่น JSON ผิดรูปแบบ 400 / body ใหญ่เกิน 413) ตอบตามนั้นพร้อม err.type
// - error ที่ไม่คาดคิด (เช่นฐานข้อมูลล่ม) ตอบ 500 ข้อความกลางๆ ไม่ส่งรายละเอียดภายในให้ client
//   แต่ log stack ไว้ฝั่ง server ให้ผู้พัฒนาตามแก้ได้
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;

  if (statusCode === 500) console.error(err.stack);

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

// เริ่ม server เมื่อรันไฟล์นี้โดยตรงเท่านั้น (ตอน test จะ require ไปใช้กับ supertest)
if (require.main === module) {
  app.listen(PORT, (err) => {
    // Express 5 ส่ง error (เช่น EADDRINUSE) มาที่ callback แทนการ throw
    if (err) {
      console.error(
        `[boardgame-service] พอร์ต ${PORT} ถูกใช้งานอยู่หรือเปิดไม่ได้: ${err.message}`,
      );
      process.exit(1);
    }
    console.log(`[boardgame-service] กำลังทำงานที่ http://localhost:${PORT}`);
  });
}

module.exports = app;
