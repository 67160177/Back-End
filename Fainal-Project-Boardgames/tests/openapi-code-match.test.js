// Swagger/Code Match: ตรวจอัตโนมัติว่า openapi.yaml ตรงกับ route ที่มีจริงในโค้ดของทุก service
// - Gateway (3000): ทุก route ต้องมีใน openapi.yaml และกลับกัน
// - service ภายใน (4001-4003): route ต้องตรงกับ operation ที่ server เป็นพอร์ตของ service นั้น
// - boardgame-service: route /api/v1/* ต้องตรงกับ route ที่ Gateway ส่งต่อไปให้ (Gateway ไม่ตกหล่น/ไม่เกิน)
// - route ของ Gateway ที่มี requireAuth ต้องตรงกับ operation ที่มี security: bearerAuth ใน openapi.yaml พอดี
// - route ที่มี requireAdmin ด้วย ต้องตรงกับ operation ที่มี response 403 Forbidden พอดี
// - ทุก $ref ใน openapi.yaml ต้องชี้ไปที่ของที่มีอยู่
jest.mock("../db", () => ({ query: jest.fn() }));

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const gateway = require("../gateway");
const boardgameService = require("../src/index");
const notificationService = require("../services/notification-service");
const authService = require("../services/auth-service");

const spec = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8"),
);

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const toSpecPath = (p) => p.replace(/:(\w+)/g, "{$1}");

// route ทั้งหมดของ Express app: [{ key: "GET /path", guarded: true/false }]
function routesOf(app) {
  return app.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .filter((m) => HTTP_METHODS.includes(m))
        .map((m) => ({
          key: `${m.toUpperCase()} ${toSpecPath(layer.route.path)}`,
          // route ที่มี middleware ก่อน handler = มีการตรวจเพิ่ม (เช่น ตรวจ token)
          guarded: layer.route.stack.length > 1,
          adminOnly: layer.route.stack.some((s) => s.name === "requireAdmin"),
        })),
    );
}
const keysOf = (app) => routesOf(app).map((r) => r.key).sort();

// พอร์ตที่ operation นี้ให้บริการ (ค่า server ระดับ path หรือ global, รองรับ server variable)
function portsOf(pathItem) {
  const server = pathItem.servers?.[0] || spec.servers[0];
  const portVar = server.variables?.port;
  return portVar ? portVar.enum : [new URL(server.url).port];
}

function operationsOn(port) {
  return Object.entries(spec.paths)
    .filter(([, item]) => portsOf(item).includes(port))
    .flatMap(([p, item]) =>
      HTTP_METHODS.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${p}`),
    )
    .sort();
}

describe("OpenAPI matches code", () => {
  test("API Gateway routes == openapi operations (port 3000)", () => {
    expect(operationsOn("3000")).toEqual(keysOf(gateway));
  });

  test("boardgame-service routes == /health (4001) + routes the Gateway forwards to it", () => {
    const forwarded = keysOf(gateway).filter((k) =>
      /\/api\/v1\/(boardgames|categories)/.test(k),
    );
    expect(keysOf(boardgameService)).toEqual(
      [...operationsOn("4001"), ...forwarded].sort(),
    );
  });

  test("notification-service routes == openapi operations (port 4002)", () => {
    expect(operationsOn("4002")).toEqual(keysOf(notificationService));
  });

  test("auth-service routes == openapi operations (port 4003)", () => {
    expect(operationsOn("4003")).toEqual(keysOf(authService));
  });

  test("Gateway routes guarded by requireAuth == operations with bearerAuth security", () => {
    const guarded = routesOf(gateway)
      .filter((r) => r.guarded)
      .map((r) => r.key)
      .sort();

    // เฉพาะ operation ของ Gateway (auth-service /auth/me ตรวจ token เองที่ service)
    const secured = Object.entries(spec.paths)
      .filter(([, item]) => portsOf(item).includes("3000"))
      .flatMap(([p, item]) =>
        HTTP_METHODS.filter((m) => item[m]?.security?.some((s) => "bearerAuth" in s)).map(
          (m) => `${m.toUpperCase()} ${p}`,
        ),
      )
      .sort();

    expect(secured).toEqual(guarded);
    // เพิ่ม/แก้ไข/ลบ 9 endpoint + /api/v1/auth/me
    expect(guarded).toHaveLength(10);
    expect(guarded.filter((k) => k.startsWith("GET "))).toEqual(["GET /api/v1/auth/me"]);
  });

  test("Gateway routes guarded by requireAdmin == operations with 403 Forbidden", () => {
    const adminOnly = routesOf(gateway)
      .filter((r) => r.adminOnly)
      .map((r) => r.key)
      .sort();

    const forbidden = Object.entries(spec.paths)
      .filter(([, item]) => portsOf(item).includes("3000"))
      .flatMap(([p, item]) =>
        HTTP_METHODS.filter(
          (m) => item[m]?.responses?.["403"]?.$ref === "#/components/responses/Forbidden",
        ).map((m) => `${m.toUpperCase()} ${p}`),
      )
      .sort();

    expect(forbidden).toEqual(adminOnly);
    expect(adminOnly).toEqual(["DELETE /api/v1/boardgames/{id}", "DELETE /api/v1/categories/{id}"]);
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
