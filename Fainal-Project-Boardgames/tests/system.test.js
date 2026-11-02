// endpoint ระดับ service ของ boardgame-service: /health, Swagger UI และ 404
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

describe("GET /health (boardgame-service)", () => {
  test("database up should return 200", async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]);

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "boardgame-service",
      database: "up",
    });
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  test("database down should return 503", async () => {
    pool.query.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const response = await request(app).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: "down", database: "down" });
  });
});

describe("Swagger UI and 404", () => {
  test("GET /api-docs/ should serve Swagger UI", async () => {
    const response = await request(app).get("/api-docs/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger-ui");
  });

  test("unknown route should return 404", async () => {
    const response = await request(app).get("/api/v1/unknown");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
