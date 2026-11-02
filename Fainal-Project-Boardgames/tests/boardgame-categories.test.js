jest.mock("../db", () => ({ query: jest.fn() }));
jest.mock("../src/services/external-api", () => ({
  notifyBoardgameCreated: jest.fn(),
}));

const pool = require("../db");
const request = require("supertest");
const app = require("../src/index");

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/v1/boardgames/:id/categories", () => {
  test("should return categories of boardgame", async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, name: "Strategy" }]]);

    const response = await request(app).get("/api/v1/boardgames/1/categories");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 1, name: "Strategy" }]);
  });

  test("boardgame not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app).get("/api/v1/boardgames/999/categories");

    expect(response.status).toBe(404);
  });

  test("invalid id should return 400", async () => {
    const response = await request(app).get("/api/v1/boardgames/abc/categories");

    expect(response.status).toBe(400);
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).get("/api/v1/boardgames/1/categories");

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("POST /api/v1/boardgames/:id/categories", () => {
  test("should link category to boardgame", async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([[{ id: 3, name: "Party Game" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .post("/api/v1/boardgames/1/categories")
      .send({ category_id: 3 });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      boardgame_id: 1,
      category: { id: 3, name: "Party Game" },
    });
  });

  test("missing category_id should return 400", async () => {
    const response = await request(app)
      .post("/api/v1/boardgames/1/categories")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MISSING_FIELDS");
  });

  test.each([["2"], [0], [1.5]])("invalid category_id %p should return 400", async (value) => {
    const response = await request(app)
      .post("/api/v1/boardgames/1/categories")
      .send({ category_id: value });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ID");
  });

  test("invalid boardgame id should return 400", async () => {
    const response = await request(app)
      .post("/api/v1/boardgames/abc/categories")
      .send({ category_id: 1 });

    expect(response.status).toBe(400);
  });

  test("boardgame not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .post("/api/v1/boardgames/999/categories")
      .send({ category_id: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  test("category not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1 }]]).mockResolvedValueOnce([[]]);

    const response = await request(app)
      .post("/api/v1/boardgames/1/categories")
      .send({ category_id: 999 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("CATEGORY_NOT_FOUND");
  });

  test("already linked should return 409", async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, name: "Strategy" }]])
      .mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });

    const response = await request(app)
      .post("/api/v1/boardgames/1/categories")
      .send({ category_id: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALREADY_LINKED");
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app)
      .post("/api/v1/boardgames/1/categories")
      .send({ category_id: 1 });

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});

describe("DELETE /api/v1/boardgames/:id/categories/:categoryId", () => {
  test("should unlink category", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).delete("/api/v1/boardgames/1/categories/3");

    expect(response.status).toBe(200);
  });

  test("link not found should return 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const response = await request(app).delete("/api/v1/boardgames/1/categories/3");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("LINK_NOT_FOUND");
  });

  test("invalid ids should return 400", async () => {
    const r1 = await request(app).delete("/api/v1/boardgames/abc/categories/3");
    const r2 = await request(app).delete("/api/v1/boardgames/1/categories/abc");

    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(r2.body.error.message).toContain("categoryId");
  });

  test("database error should return 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("Database error"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(app).delete("/api/v1/boardgames/1/categories/3");

    expect(response.status).toBe(500);
    console.error.mockRestore();
  });
});
