// endpoint ระดับระบบ: root, health, notifications (proxy ไป notification-service),
// Swagger UI, Frontend และ 404
jest.mock("../db", () => ({ query: jest.fn() }));
jest.mock("../src/services/external-api", () => ({
  notifyBoardgameCreated: jest.fn(),
  fetchNotifications: jest.fn(),
  checkNotificationService: jest.fn(),
}));

const pool = require("../db");
const {
  fetchNotifications,
  checkNotificationService,
} = require("../src/services/external-api");
const request = require("supertest");
const app = require("../src/index");

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /", () => {
  test("should return status message", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Board Game API พร้อมใช้งาน");
  });
});

describe("GET /api/v1/health", () => {
  test("all services up should return ok", async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]);
    checkNotificationService.mockResolvedValueOnce(true);

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      services: { api: "up", database: "up", notificationService: "up" },
    });
  });

  test("notification-service down should return degraded (200)", async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]);
    checkNotificationService.mockResolvedValueOnce(false);

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("degraded");
    expect(response.body.services.notificationService).toBe("down");
  });

  test("database down should return 503", async () => {
    pool.query.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    checkNotificationService.mockResolvedValueOnce(true);

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("down");
    expect(response.body.services.database).toBe("down");
  });
});

describe("GET /api/v1/notifications", () => {
  test("should return history from notification-service", async () => {
    const history = [
      {
        id: 1,
        type: "boardgame.created",
        message: "🎲 เพิ่มบอร์ดเกมใหม่: Azul (2-4 ผู้เล่น)",
        status: "sent",
        createdAt: "2026-10-27T10:00:00.000Z",
      },
    ];
    fetchNotifications.mockResolvedValueOnce({
      ok: true,
      attempts: 1,
      data: { message: "สำเร็จ", data: history },
    });

    const response = await request(app).get("/api/v1/notifications");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(history);
  });

  test("notification-service down should return 503", async () => {
    fetchNotifications.mockResolvedValueOnce({
      ok: false,
      attempts: 1,
      error: "ECONNREFUSED",
    });

    const response = await request(app).get("/api/v1/notifications");

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("NOTIFICATION_SERVICE_UNAVAILABLE");
  });
});

describe("Swagger UI, Frontend and 404", () => {
  test("GET /api-docs/ should serve Swagger UI", async () => {
    const response = await request(app).get("/api-docs/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger-ui");
  });

  test("GET /app/ should serve frontend", async () => {
    const response = await request(app).get("/app/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Board Game Manager");
  });

  test("unknown route should return 404", async () => {
    const response = await request(app).get("/api/v1/unknown");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
