jest.mock("../db", () => ({ query: jest.fn() }));
jest.mock("../src/services/external-api", () => ({
  notifyBoardgameCreated: jest.fn(),
  fetchNotifications: jest.fn(),
  checkNotificationService: jest.fn(),
}));

const pool = require("../db");
const request = require("supertest");
const app = require("../src/index");

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/v1/categories", () => {
  test("should return categories with boardgameCount", async () => {
    pool.query.mockResolvedValueOnce([
      [
        { id: 1, name: "Strategy", boardgameCount: 2 },
        { id: 2, name: "Card Game", boardgameCount: 1 },
      ],
    ]);

    const response = await request(app).get("/api/v1/categories");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toHaveProperty("boardgameCount");
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).get("/api/v1/categories");

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("GET /api/v1/categories/:id", () => {
  test("should return category", async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, name: "Strategy", boardgameCount: 2 }]]);

    const response = await request(app).get("/api/v1/categories/1");

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe("Strategy");
  });

  test("not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app).get("/api/v1/categories/999");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("CATEGORY_NOT_FOUND");
  });

  test("invalid id should return 400", async () => {
    const response = await request(app).get("/api/v1/categories/abc");

    expect(response.status).toBe(400);
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).get("/api/v1/categories/1");

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("POST /api/v1/categories", () => {
  test("should create category with trimmed name", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 4 }]);

    const response = await request(app)
      .post("/api/v1/categories")
      .send({ name: "  Co-op " });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ id: 4, name: "Co-op" });
  });

  test.each([
    ["missing name", {}, "MISSING_FIELDS"],
    ["blank name", { name: "  " }, "INVALID_NAME"],
    ["name not string", { name: 123 }, "INVALID_NAME"],
    ["name too long", { name: "x".repeat(101) }, "INVALID_NAME"],
  ])("%s should return 400", async (_, payload, code) => {
    const response = await request(app).post("/api/v1/categories").send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
  });

  test("duplicate should return 409", async () => {
    pool.query.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    const response = await request(app)
      .post("/api/v1/categories")
      .send({ name: "Strategy" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_CATEGORY");
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app)
      .post("/api/v1/categories")
      .send({ name: "Co-op" });

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("PUT /api/v1/categories/:id", () => {
  test("should rename category", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .put("/api/v1/categories/4")
      .send({ name: "Cooperative" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 4, name: "Cooperative" });
  });

  test("not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const response = await request(app)
      .put("/api/v1/categories/999")
      .send({ name: "Ghost" });

    expect(response.status).toBe(404);
  });

  test("invalid id should return 400", async () => {
    const response = await request(app)
      .put("/api/v1/categories/abc")
      .send({ name: "Ghost" });

    expect(response.status).toBe(400);
  });

  test("invalid name should return 400", async () => {
    const response = await request(app).put("/api/v1/categories/4").send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MISSING_FIELDS");
  });

  test("duplicate should return 409", async () => {
    pool.query.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    const response = await request(app)
      .put("/api/v1/categories/4")
      .send({ name: "Strategy" });

    expect(response.status).toBe(409);
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app)
      .put("/api/v1/categories/4")
      .send({ name: "Cooperative" });

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("DELETE /api/v1/categories/:id", () => {
  test("should delete category", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).delete("/api/v1/categories/4");

    expect(response.status).toBe(200);
  });

  test("not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const response = await request(app).delete("/api/v1/categories/999");

    expect(response.status).toBe(404);
  });

  test("invalid id should return 400", async () => {
    const response = await request(app).delete("/api/v1/categories/abc");

    expect(response.status).toBe(400);
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).delete("/api/v1/categories/4");

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});
