jest.mock("../db", () => ({ query: jest.fn() }));
jest.mock("../src/services/external-api", () => ({
  notifyBoardgameCreated: jest.fn(),
}));

const pool = require("../db");
const { notifyBoardgameCreated } = require("../src/services/external-api");
const request = require("supertest");
const app = require("../src/index");

const catan = {
  id: 3,
  name: "Catan",
  minPlayers: 3,
  maxPlayers: 4,
  categories: "Strategy,Party Game",
};

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/v1/boardgames", () => {
  // แถวจากฐานข้อมูลมีคอลัมน์ total (COUNT(*) OVER()) ที่ API ตัดออกก่อนตอบ
  const catanRow = { ...catan, total: 1 };

  test("should return all boardgames with default pagination", async () => {
    pool.query.mockResolvedValueOnce([[catanRow]]);

    const response = await request(app).get("/api/v1/boardgames");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([catan]);
    expect(response.body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(pool.query.mock.calls[0][0]).not.toContain("WHERE");
    expect(pool.query.mock.calls[0][0]).toContain("ORDER BY g.id ASC");
    expect(pool.query.mock.calls[0][1]).toEqual([20, 0]);
  });

  test("should filter by category name", async () => {
    pool.query.mockResolvedValueOnce([[catanRow]]);

    const response = await request(app).get(
      "/api/v1/boardgames?category=Strategy",
    );

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toContain("LOWER(c.name) = LOWER(?)");
    expect(pool.query.mock.calls[0][1]).toEqual(["Strategy", 20, 0]);
  });

  test("should filter by category_id", async () => {
    pool.query.mockResolvedValueOnce([[catanRow]]);

    const response = await request(app).get("/api/v1/boardgames?category_id=1");

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toContain("c.id = ?");
    expect(pool.query.mock.calls[0][1]).toEqual([1, 20, 0]);
  });

  test("page and limit -> LIMIT/OFFSET and pagination info", async () => {
    pool.query.mockResolvedValueOnce([[{ ...catan, total: 7 }]]);

    const response = await request(app).get("/api/v1/boardgames?page=3&limit=3");

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual([3, 6]);
    expect(response.body.pagination).toEqual({ page: 3, limit: 3, total: 7, totalPages: 3 });
  });

  test.each([
    ["name", "asc", "ORDER BY g.name ASC, g.id ASC"],
    ["minPlayers", "DESC", "ORDER BY g.minPlayers DESC, g.id ASC"],
    ["maxPlayers", undefined, "ORDER BY g.maxPlayers ASC, g.id ASC"],
    ["createdAt", "desc", "ORDER BY g.created_at DESC, g.id ASC"],
    ["id", "desc", "ORDER BY g.id DESC"],
  ])("sort=%s order=%s -> %s", async (sort, order, expected) => {
    pool.query.mockResolvedValueOnce([[catanRow]]);

    const query = order ? `sort=${sort}&order=${order}` : `sort=${sort}`;
    const response = await request(app).get(`/api/v1/boardgames?${query}`);

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toContain(expected);
  });

  test("page beyond the last page -> empty data with real total", async () => {
    pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 3 }]]);

    const response = await request(app).get("/api/v1/boardgames?page=5&limit=2&category=Strategy");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({ page: 5, limit: 2, total: 3, totalPages: 2 });
    expect(pool.query.mock.calls[1][0]).toContain("COUNT(DISTINCT b.id)");
    expect(pool.query.mock.calls[1][1]).toEqual(["Strategy"]);
  });

  test("no games at all -> empty data, total 0 without extra query", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app).get("/api/v1/boardgames");

    expect(response.body.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["page=0", "page ต้องเป็นตัวเลขจำนวนเต็มบวก"],
    ["page=abc", "page ต้องเป็นตัวเลขจำนวนเต็มบวก"],
    ["limit=0", "limit ต้องเป็นตัวเลขจำนวนเต็มระหว่าง 1 ถึง 100"],
    ["limit=101", "limit ต้องเป็นตัวเลขจำนวนเต็มระหว่าง 1 ถึง 100"],
    ["limit=2.5", "limit ต้องเป็นตัวเลขจำนวนเต็มระหว่าง 1 ถึง 100"],
    ["sort=password", "sort ต้องเป็นหนึ่งใน id, name, minPlayers, maxPlayers, createdAt"],
    ["sort=name;DROP TABLE boardgames", "sort ต้องเป็นหนึ่งใน id, name, minPlayers, maxPlayers, createdAt"],
    ["order=up", "order ต้องเป็น asc หรือ desc"],
    ["page=1&page=2", "page ระบุได้เพียงค่าเดียว"],
  ])("%s -> 400 INVALID_QUERY without touching DB", async (query, message) => {
    const response = await request(app).get(`/api/v1/boardgames?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({ code: "INVALID_QUERY", message });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("invalid category_id should return 400", async () => {
    const response = await request(app).get(
      "/api/v1/boardgames?category_id=abc",
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ID");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("repeated category should return 400", async () => {
    const response = await request(app).get(
      "/api/v1/boardgames?category=a&category=b",
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_QUERY");
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).get("/api/v1/boardgames");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    console.error.mockRestore();
  });
});

describe("GET /api/v1/boardgames/:id", () => {
  test("should return boardgame", async () => {
    pool.query.mockResolvedValueOnce([[catan]]);

    const response = await request(app).get("/api/v1/boardgames/3");

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe("Catan");
  });

  test("not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app).get("/api/v1/boardgames/999");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  test.each(["abc", "0", "-1", "1.5"])("invalid id %s should return 400", async (id) => {
    const response = await request(app).get(`/api/v1/boardgames/${id}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ID");
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).get("/api/v1/boardgames/1");

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("POST /api/v1/boardgames", () => {
  const body = { name: "Carcassonne", minPlayers: 2, maxPlayers: 5 };

  test("should create boardgame and include notification result", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 4 }]);
    notifyBoardgameCreated.mockResolvedValueOnce({
      sent: true,
      attempts: 1,
      message: "ส่งแจ้งเตือนไปที่ Discord แล้ว",
    });

    const response = await request(app).post("/api/v1/boardgames").send(body);

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ id: 4, ...body });
    expect(response.body.notification.sent).toBe(true);
    expect(notifyBoardgameCreated).toHaveBeenCalledWith({ id: 4, ...body });
  });

  test("should still return 201 when notification fails (fallback)", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 5 }]);
    notifyBoardgameCreated.mockResolvedValueOnce({
      sent: false,
      attempts: 3,
      message: "เพิ่มบอร์ดเกมสำเร็จ แต่ส่งแจ้งเตือนไปที่ Discord ไม่สำเร็จ",
    });

    const response = await request(app).post("/api/v1/boardgames").send(body);

    expect(response.status).toBe(201);
    expect(response.body.notification).toMatchObject({ sent: false, attempts: 3 });
  });

  test("should trim name before saving", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 6 }]);
    notifyBoardgameCreated.mockResolvedValueOnce({ sent: false, attempts: 0 });

    const response = await request(app)
      .post("/api/v1/boardgames")
      .send({ ...body, name: "  Azul  " });

    expect(response.status).toBe(201);
    expect(pool.query.mock.calls[0][1][0]).toBe("Azul");
  });

  test.each([
    ["missing fields", { name: "Azul" }, "MISSING_FIELDS"],
    ["blank name", { name: "   ", minPlayers: 1, maxPlayers: 2 }, "INVALID_NAME"],
    ["name too long", { name: "x".repeat(101), minPlayers: 1, maxPlayers: 2 }, "INVALID_NAME"],
    ["name not string", { name: 123, minPlayers: 1, maxPlayers: 2 }, "INVALID_NAME"],
    ["players as string", { name: "Azul", minPlayers: "2", maxPlayers: 4 }, "INVALID_PLAYERS"],
    ["players not integer", { name: "Azul", minPlayers: 1.5, maxPlayers: 4 }, "INVALID_PLAYERS"],
    ["max < min", { name: "Azul", minPlayers: 4, maxPlayers: 2 }, "INVALID_PLAYER_RANGE"],
    ["min < 1", { name: "Azul", minPlayers: 0, maxPlayers: 2 }, "INVALID_PLAYER_RANGE"],
    ["max over INT", { name: "Azul", minPlayers: 1, maxPlayers: 99999999999 }, "INVALID_PLAYER_RANGE"],
  ])("%s should return 400", async (_, payload, code) => {
    const response = await request(app).post("/api/v1/boardgames").send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("malformed JSON should return 400", async () => {
    const response = await request(app)
      .post("/api/v1/boardgames")
      .set("Content-Type", "application/json")
      .send('{"name": "Azul",}');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("entity.parse.failed");
  });

  test("body over 10kb should return 413", async () => {
    const response = await request(app)
      .post("/api/v1/boardgames")
      .send({ name: "x".repeat(11000), minPlayers: 1, maxPlayers: 2 });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("entity.too.large");
  });

  test("duplicate name should return 409", async () => {
    pool.query.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    const response = await request(app).post("/api/v1/boardgames").send(body);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_NAME");
    expect(notifyBoardgameCreated).not.toHaveBeenCalled();
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Connection lost"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).post("/api/v1/boardgames").send(body);

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("PUT /api/v1/boardgames/:id", () => {
  const body = { name: "Carcassonne Big Box", minPlayers: 2, maxPlayers: 6 };

  test("should update boardgame", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).put("/api/v1/boardgames/4").send(body);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 4, ...body });
  });

  test("not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const response = await request(app).put("/api/v1/boardgames/999").send(body);

    expect(response.status).toBe(404);
  });

  test("invalid id should return 400", async () => {
    const response = await request(app).put("/api/v1/boardgames/abc").send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ID");
  });

  test("missing fields should return 400", async () => {
    const response = await request(app)
      .put("/api/v1/boardgames/4")
      .send({ name: "x" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MISSING_FIELDS");
  });

  test("duplicate name should return 409", async () => {
    pool.query.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    const response = await request(app).put("/api/v1/boardgames/4").send(body);

    expect(response.status).toBe(409);
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Connection lost"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).put("/api/v1/boardgames/4").send(body);

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("PATCH /api/v1/boardgames/:id", () => {
  const existing = { id: 4, name: "Carcassonne", minPlayers: 2, maxPlayers: 5 };

  test("should merge partial update with existing values", async () => {
    pool.query
      .mockResolvedValueOnce([[existing]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .patch("/api/v1/boardgames/4")
      .send({ maxPlayers: 8 });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ ...existing, maxPlayers: 8 });
  });

  test("should update and trim name", async () => {
    pool.query
      .mockResolvedValueOnce([[existing]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .patch("/api/v1/boardgames/4")
      .send({ name: "  Carcassonne Deluxe ", minPlayers: 1 });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe("Carcassonne Deluxe");
    expect(response.body.data.minPlayers).toBe(1);
  });

  test.each([
    ["empty body", {}, "NO_UPDATES"],
    ["unknown field", { price: 100 }, "INVALID_FIELD"],
    ["blank name", { name: " " }, "INVALID_NAME"],
    ["null players", { minPlayers: null }, "INVALID_PLAYERS"],
  ])("%s should return 400", async (_, payload, code) => {
    const response = await request(app)
      .patch("/api/v1/boardgames/4")
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
  });

  test("merged range invalid should return 400", async () => {
    pool.query.mockResolvedValueOnce([[existing]]);

    const response = await request(app)
      .patch("/api/v1/boardgames/4")
      .send({ minPlayers: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PLAYER_RANGE");
  });

  test("invalid id should return 400", async () => {
    const response = await request(app)
      .patch("/api/v1/boardgames/0")
      .send({ maxPlayers: 8 });

    expect(response.status).toBe(400);
  });

  test("not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .patch("/api/v1/boardgames/999")
      .send({ maxPlayers: 8 });

    expect(response.status).toBe(404);
  });

  test("duplicate name should return 409", async () => {
    pool.query
      .mockResolvedValueOnce([[existing]])
      .mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    const response = await request(app)
      .patch("/api/v1/boardgames/4")
      .send({ name: "Catan" });

    expect(response.status).toBe(409);
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Connection lost"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app)
      .patch("/api/v1/boardgames/4")
      .send({ maxPlayers: 8 });

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("DELETE /api/v1/boardgames/:id", () => {
  test("should delete boardgame", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).delete("/api/v1/boardgames/4");

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("ลบบอร์ดเกมสำเร็จ");
  });

  test("not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const response = await request(app).delete("/api/v1/boardgames/999");

    expect(response.status).toBe(404);
  });

  test("invalid id should return 400", async () => {
    const response = await request(app).delete("/api/v1/boardgames/abc");

    expect(response.status).toBe(400);
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Connection lost"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).delete("/api/v1/boardgames/4");

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});
