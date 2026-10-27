// Swagger/Code Match: ตรวจอัตโนมัติว่า openapi.yaml ตรงกับ route ที่มีจริงในโค้ด
// - ทุก route ใน Express ต้องมีใน openapi.yaml
// - ทุก operation ใน openapi.yaml ต้องมี route จริง
// - ทุก $ref ใน openapi.yaml ต้องชี้ไปที่ของที่มีอยู่
jest.mock("../db", () => ({ query: jest.fn() }));

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const apiApp = require("../src/index");
const notificationApp = require("../services/notification-service");

const spec = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8"),
);

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

// ดึง route ทั้งหมดจาก Express app เป็นรูปแบบ "GET /api/v1/boardgames/{id}"
function routesOf(app) {
  return app.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .filter((m) => HTTP_METHODS.includes(m))
        .map(
          (m) =>
            `${m.toUpperCase()} ${layer.route.path.replace(/:(\w+)/g, "{$1}")}`,
        ),
    )
    .sort();
}

// ดึง operation จาก openapi.yaml แยกตาม port ของ server (3000 = API, 3001 = notification)
function operationsOf(port) {
  const defaultPort = new URL(spec.servers[0].url).port;

  return Object.entries(spec.paths)
    .filter(([, item]) => {
      const serverUrl = item.servers?.[0]?.url;
      return (serverUrl ? new URL(serverUrl).port : defaultPort) === port;
    })
    .flatMap(([p, item]) =>
      Object.keys(item)
        .filter((m) => HTTP_METHODS.includes(m))
        .map((m) => `${m.toUpperCase()} ${p}`),
    )
    .sort();
}

describe("OpenAPI matches code", () => {
  test("Board Game API routes == openapi operations (port 3000)", () => {
    expect(operationsOf("3000")).toEqual(routesOf(apiApp));
  });

  test("Notification Service routes == openapi operations (port 3001)", () => {
    expect(operationsOf("3001")).toEqual(routesOf(notificationApp));
  });

  test("every operation has operationId, summary and responses", () => {
    for (const [p, item] of Object.entries(spec.paths)) {
      for (const m of HTTP_METHODS.filter((x) => item[x])) {
        const op = item[m];
        expect({ op: `${m} ${p}`, ok: Boolean(op.operationId && op.summary && op.responses) })
          .toEqual({ op: `${m} ${p}`, ok: true });
      }
    }
  });

  test("operationIds are unique", () => {
    const ids = Object.values(spec.paths).flatMap((item) =>
      HTTP_METHODS.filter((m) => item[m]).map((m) => item[m].operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("all $ref targets exist", () => {
    const broken = [];
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref") {
          const target = value
            .slice(2)
            .split("/")
            .reduce((obj, part) => obj?.[part], spec);
          if (!target) broken.push(value);
        } else {
          walk(value);
        }
      }
    })(spec);

    expect(broken).toEqual([]);
  });
});
