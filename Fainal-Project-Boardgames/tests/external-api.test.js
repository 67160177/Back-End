// ทดสอบกลไก Retry / Timeout / Fallback โดยจำลอง fetch (ไม่เรียกเครือข่ายจริง)
const {
  fetchWithRetry,
  notifyBoardgameCreated,
} = require("../src/services/external-api");

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// fetch ที่ไม่ตอบจนกว่าจะถูก abort (จำลอง service ที่ค้าง)
const hangingFetch = (url, { signal }) =>
  new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });

const networkError = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });

const fast = { baseDelayMs: 0 };
const game = { id: 4, name: "Azul", minPlayers: 2, maxPlayers: 4 };

let originalFetch;

beforeAll(() => {
  originalFetch = global.fetch;
  process.env.EXTERNAL_API_RETRY_DELAY_MS = "0";
  process.env.NOTIFICATION_SERVICE_URL = "http://notification.test";
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  global.fetch = originalFetch;
  delete process.env.EXTERNAL_API_RETRY_DELAY_MS;
  delete process.env.NOTIFICATION_SERVICE_URL;
  console.log.mockRestore();
});

beforeEach(() => {
  global.fetch = jest.fn();
});

describe("fetchWithRetry", () => {
  test("success on first attempt", async () => {
    fetch.mockResolvedValueOnce(json({ ok: true }));

    const result = await fetchWithRetry("http://x.test/a", {}, fast);

    expect(result).toEqual({ ok: true, attempts: 1, status: 200, data: { ok: true } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("retries on 5xx then succeeds", async () => {
    fetch
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(json({ ok: true }));

    const result = await fetchWithRetry("http://x.test/a", {}, fast);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("retries on network error until attempts exhausted (1 + 2 retries)", async () => {
    fetch.mockRejectedValue(networkError());

    const result = await fetchWithRetry("http://x.test/a", {}, fast);

    expect(result).toEqual({ ok: false, attempts: 3, error: "ECONNREFUSED" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("retries on 429", async () => {
    fetch.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({}));

    const result = await fetchWithRetry("http://x.test/a", {}, fast);

    expect(result.attempts).toBe(2);
  });

  test("does not retry on 4xx", async () => {
    fetch.mockResolvedValue(json({}, 400));

    const result = await fetchWithRetry("http://x.test/a", {}, fast);

    expect(result).toEqual({ ok: false, attempts: 1, error: "HTTP 400" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("timeout aborts each attempt and is retried", async () => {
    fetch.mockImplementation(hangingFetch);

    const started = Date.now();
    const result = await fetchWithRetry(
      "http://x.test/a",
      {},
      { timeoutMs: 50, baseDelayMs: 0 },
    );

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toBe("timeout (เกิน 50 ms)");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("uses exponential backoff between attempts", async () => {
    fetch.mockRejectedValue(networkError());
    const timeoutSpy = jest.spyOn(global, "setTimeout");

    await fetchWithRetry("http://x.test/a", {}, { baseDelayMs: 10 });

    const delays = timeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toEqual(expect.arrayContaining([10, 20]));
    timeoutSpy.mockRestore();
  });

  test("invalid URL returns without calling fetch", async () => {
    const result = await fetchWithRetry("not a url", {}, fast);

    expect(result).toEqual({ ok: false, attempts: 0, error: "invalid URL" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("non-JSON body is returned as null data", async () => {
    fetch.mockResolvedValueOnce(new Response("plain text", { status: 200 }));

    const result = await fetchWithRetry("http://x.test/a", {}, fast);

    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });
});

describe("notifyBoardgameCreated", () => {
  test("calls notification-service and reports sent", async () => {
    fetch.mockResolvedValueOnce(json({ data: { id: 1, sent: true } }));

    const result = await notifyBoardgameCreated(game);

    expect(result).toEqual({
      sent: true,
      attempts: 1,
      message: "ส่งแจ้งเตือนไปที่ Discord แล้ว",
    });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://notification.test/notifications");
    expect(JSON.parse(options.body)).toEqual({
      type: "boardgame.created",
      boardgame: game,
    });
  });

  test("service answers sent: false (webhook not set) -> fallback without retry", async () => {
    fetch.mockResolvedValueOnce(json({ data: { id: 1, sent: false } }));

    const result = await notifyBoardgameCreated(game);

    expect(result.sent).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("service down -> retry 3 times then fallback", async () => {
    fetch.mockRejectedValue(networkError());

    const result = await notifyBoardgameCreated(game);

    expect(result).toEqual({
      sent: false,
      attempts: 3,
      message: "เพิ่มบอร์ดเกมสำเร็จ แต่ส่งแจ้งเตือนไปที่ Discord ไม่สำเร็จ",
    });
  });

  test("unexpected error never throws (fallback)", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const result = await notifyBoardgameCreated(game);

    expect(result).toMatchObject({ sent: false, attempts: 0 });
    console.error.mockRestore();
  });
});

describe("default notification-service URL", () => {
  test("uses http://localhost:4002 when NOTIFICATION_SERVICE_URL is not set", async () => {
    const saved = process.env.NOTIFICATION_SERVICE_URL;
    delete process.env.NOTIFICATION_SERVICE_URL;
    fetch.mockResolvedValueOnce(json({ data: { id: 1, sent: true } }));

    await notifyBoardgameCreated(game);

    expect(fetch.mock.calls[0][0]).toBe("http://localhost:4002/notifications");
    process.env.NOTIFICATION_SERVICE_URL = saved;
  });
});
