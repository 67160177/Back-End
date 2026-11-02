// ทดสอบ notification-service (microservice) โดยจำลอง Discord ด้วย mock fetch
const request = require("supertest");
const app = require("../services/notification-service");

const game = { name: "Azul", minPlayers: 2, maxPlayers: 4 };
const validBody = { type: "boardgame.created", boardgame: game };

let originalFetch;

beforeAll(() => {
  originalFetch = global.fetch;
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  global.fetch = originalFetch;
  console.log.mockRestore();
});

beforeEach(() => {
  global.fetch = jest.fn();
  process.env.DISCORD_WEBHOOK_URL = "http://discord.test/webhook";
  process.env.DISCORD_TIMEOUT_MS = "50";
});

afterEach(() => {
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.DISCORD_TIMEOUT_MS;
});

describe("GET /health", () => {
  test("should report service status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "notification-service",
      discordConfigured: true,
    });
  });
});

describe("POST /notifications", () => {
  test("should send message to Discord", async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await request(app).post("/notifications").send(validBody);

    expect(response.status).toBe(200);
    expect(response.body.data.sent).toBe(true);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://discord.test/webhook");
    expect(JSON.parse(options.body)).toEqual({
      content: "🎲 เพิ่มบอร์ดเกมใหม่: Azul (2-4 ผู้เล่น)",
      allowed_mentions: { parse: [] },
    });
  });

  test("webhook not configured should answer 200 with sent: false", async () => {
    delete process.env.DISCORD_WEBHOOK_URL;

    const response = await request(app).post("/notifications").send(validBody);

    expect(response.status).toBe(200);
    expect(response.body.data.sent).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("Discord 5xx should return 502 so caller can retry", async () => {
    fetch.mockResolvedValueOnce(new Response("", { status: 503 }));

    const response = await request(app).post("/notifications").send(validBody);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("DISCORD_ERROR");
  });

  test("Discord unreachable should return 502", async () => {
    fetch.mockRejectedValueOnce(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ENOTFOUND" },
      }),
    );

    const response = await request(app).post("/notifications").send(validBody);

    expect(response.status).toBe(502);
    expect(response.body.error.message).toContain("ENOTFOUND");
  });

  test("Discord timeout should return 504", async () => {
    fetch.mockImplementationOnce(
      (url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );

    const response = await request(app).post("/notifications").send(validBody);

    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe("DISCORD_TIMEOUT");
  });

  test.each([
    ["wrong type", { type: "other", boardgame: game }],
    ["missing boardgame", { type: "boardgame.created" }],
    ["invalid players", { type: "boardgame.created", boardgame: { ...game, minPlayers: "2" } }],
  ])("%s should return 400", async (_, payload) => {
    const response = await request(app).post("/notifications").send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_NOTIFICATION");
  });

  test("malformed JSON should return 400", async () => {
    const response = await request(app)
      .post("/notifications")
      .set("Content-Type", "application/json")
      .send("{bad");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("entity.parse.failed");
  });
});

describe("GET /notifications", () => {
  test("should list history newest first with status", async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await request(app)
      .post("/notifications")
      .send({ ...validBody, boardgame: { ...game, name: "Newest" } });

    const response = await request(app).get("/notifications");

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      type: "boardgame.created",
      status: "sent",
      message: "🎲 เพิ่มบอร์ดเกมใหม่: Newest (2-4 ผู้เล่น)",
    });
    expect(response.body.data[0]).toHaveProperty("createdAt");
    const statuses = response.body.data.map((n) => n.status);
    expect(statuses).toEqual(expect.arrayContaining(["sent", "skipped", "failed"]));
  });
});

describe("unknown route", () => {
  test("should return 404", async () => {
    const response = await request(app).get("/nope");

    expect(response.status).toBe(404);
  });
});
