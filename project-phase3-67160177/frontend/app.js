// ==========================================
// Board Game Manager - Frontend (HTML/CSS/JavaScript ล้วน)
// เรียกใช้ API จริงของระบบผ่าน fetch
//
// endpoint ที่ใช้:
//   GET    /api/v1/health                       สถานะระบบ (มุมขวาบน)
//   GET    /api/v1/boardgames?category_id=      รายการบอร์ดเกม (+ กรองหมวดหมู่)
//   POST   /api/v1/boardgames                   เพิ่มบอร์ดเกม
//   PUT    /api/v1/boardgames/:id               แก้ไขบอร์ดเกม
//   DELETE /api/v1/boardgames/:id               ลบบอร์ดเกม
//   GET    /api/v1/categories                   รายการหมวดหมู่
//   POST   /api/v1/categories                   เพิ่มหมวดหมู่
//   GET    /api/v1/boardgames/:id/categories    หมวดหมู่ของเกม
//   POST   /api/v1/boardgames/:id/categories    ผูกหมวดหมู่กับเกม
//   DELETE /api/v1/boardgames/:id/categories/:c ถอดหมวดหมู่
//   GET    /api/v1/notifications                ประวัติจาก notification-service
// ==========================================

// เปิดผ่าน API (http://localhost:3000/app) ใช้ origin เดียวกันได้เลย
// ถ้าเปิดไฟล์จากที่อื่น (เช่น Live Server) ให้ชี้ไปที่ API ตรงๆ
const API_BASE = window.location.pathname.startsWith("/app")
  ? ""
  : "http://localhost:3000";

const REQUEST_TIMEOUT_MS = 10000;
const NAME_MAX_LENGTH = 100;
const MAX_PLAYERS = 2147483647;

// ==========================================
// API helper
// ==========================================

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// เรียก API แล้วคืน body (JSON) ถ้าไม่สำเร็จจะ throw ApiError พร้อมข้อความที่แสดงให้ผู้ใช้ได้
async function api(path, { method = "GET", body } = {}) {
  let response;

  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new ApiError("เซิร์ฟเวอร์ตอบช้าเกินไป กรุณาลองใหม่", 0);
    }
    throw new ApiError(
      "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่าเซิร์ฟเวอร์ API ทำงานอยู่",
      0,
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data?.error?.message || `เกิดข้อผิดพลาด (HTTP ${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data;
}

// ==========================================
// DOM helpers (ใช้ textContent เสมอ กันข้อมูลจากผู้ใช้กลายเป็น HTML)
// ==========================================

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

function showLoading(container, text) {
  container.className = "status";
  container.replaceChildren(el("span", { class: "spinner" }), text);
}

function showError(container, message, onRetry) {
  container.className = "status is-error";
  container.replaceChildren(el("span", { text: message }));
  if (onRetry) {
    container.append(
      el("button", {
        type: "button",
        class: "btn btn-ghost btn-small",
        text: "ลองใหม่",
        onclick: onRetry,
      }),
    );
  }
}

function showInfo(container, text) {
  container.className = "status";
  container.textContent = text;
}

function clearStatus(container) {
  container.className = "status";
  container.replaceChildren();
}

const MAX_TOASTS = 3;

function toast(message, type = "ok") {
  const container = $("toasts");
  const node = el("div", {
    class: `toast${type === "ok" ? "" : ` is-${type}`}`,
    role: type === "error" ? "alert" : "status",
    text: message,
  });
  container.append(node);
  // แสดงพร้อมกันไม่เกิน 3 อัน ไม่ให้บังหน้าจอ
  while (container.children.length > MAX_TOASTS) container.firstChild.remove();
  setTimeout(() => node.remove(), 5000);
}

// ปุ่มระหว่างรอ API: กดซ้ำไม่ได้ และเปลี่ยนข้อความให้เห็นว่ากำลังทำงาน
async function withBusyButton(button, busyText, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await task();
  } finally {
    button.disabled = false;
    // คืนข้อความเดิม เว้นแต่ task เปลี่ยนข้อความปุ่มเอง (เช่น ออกจากโหมดแก้ไข)
    if (button.textContent === busyText) button.textContent = original;
  }
}

// ==========================================
// State
// ==========================================

const state = {
  games: [],
  categories: [],
  editingId: null, // id ของเกมที่กำลังแก้ไข (null = โหมดเพิ่ม)
  dialogGame: null, // เกมที่เปิดหน้าต่างจัดการหมวดหมู่อยู่
};

// ==========================================
// Health
// ==========================================

async function loadHealth() {
  const pill = $("health-pill");
  pill.className = "pill pill-muted";
  pill.textContent = "กำลังตรวจสถานะ...";

  try {
    const data = await api("/api/v1/health");
    if (data.status === "ok") {
      pill.className = "pill pill-ok";
      pill.textContent = "● ระบบพร้อมใช้งาน";
    } else {
      pill.className = "pill pill-warn";
      pill.textContent = "● แจ้งเตือนใช้งานไม่ได้ชั่วคราว";
    }
  } catch (err) {
    pill.className = "pill pill-error";
    pill.textContent =
      err.status === 503 ? "● ฐานข้อมูลไม่พร้อม" : "● เชื่อมต่อ API ไม่ได้";
  }
}

// ==========================================
// Categories
// ==========================================

async function loadCategories() {
  try {
    const { data } = await api("/api/v1/categories");
    state.categories = data;
    renderCategoryFilter();
  } catch (err) {
    toast(`โหลดหมวดหมู่ไม่สำเร็จ: ${err.message}`, "error");
  }
}

function renderCategoryFilter() {
  const select = $("filter-category");
  const current = select.value;

  select.replaceChildren(el("option", { value: "", text: "ทุกหมวดหมู่" }));
  for (const c of state.categories) {
    select.append(
      el("option", { value: String(c.id), text: `${c.name} (${c.boardgameCount})` }),
    );
  }

  // ถ้าหมวดที่เลือกไว้ยังอยู่ ให้คงค่าเดิม
  select.value = state.categories.some((c) => String(c.id) === current)
    ? current
    : "";
}

// ==========================================
// Boardgames: list
// ==========================================

async function loadGames() {
  const status = $("games-status");
  const list = $("games-list");
  const categoryId = $("filter-category").value;

  showLoading(status, "กำลังโหลดรายการบอร์ดเกม...");
  list.replaceChildren();

  try {
    const query = categoryId ? `?category_id=${categoryId}` : "";
    const { data } = await api(`/api/v1/boardgames${query}`);
    state.games = data;

    if (data.length === 0) {
      showInfo(
        status,
        categoryId
          ? "ยังไม่มีบอร์ดเกมในหมวดหมู่นี้"
          : "ยังไม่มีบอร์ดเกม เพิ่มเกมแรกได้จากฟอร์มด้านขวา",
      );
      return;
    }

    clearStatus(status);
    renderGames();
  } catch (err) {
    showError(status, `โหลดรายการไม่สำเร็จ: ${err.message}`, loadGames);
  }
}

function renderGames() {
  const filtered = Boolean($("filter-category").value);

  const items = state.games.map((game) => {
    const categoryNames = game.categories ? game.categories.split(",") : [];

    const chips = el(
      "div",
      { class: "chips" },
      categoryNames.length
        ? categoryNames.map((name) => el("span", { class: "chip", text: name }))
        : el("span", { class: "chip chip-muted", text: "ยังไม่มีหมวดหมู่" }),
    );

    const players =
      game.minPlayers === game.maxPlayers
        ? `${game.minPlayers} คน`
        : `${game.minPlayers}–${game.maxPlayers} คน`;

    return el(
      "li",
      { class: `game${state.editingId === game.id ? " is-editing" : ""}` },
      [
        el("div", {}, [
          el("p", { class: "game-name", text: game.name }),
          el("p", {
            class: "game-meta",
            text: `ผู้เล่น ${players}${filtered ? " · แสดงเฉพาะหมวดที่กรอง" : ""}`,
          }),
          chips,
        ]),
        el("div", { class: "game-actions" }, [
          el("button", {
            type: "button",
            class: "btn btn-ghost btn-small",
            text: "หมวดหมู่",
            onclick: () => openCategoriesDialog(game),
          }),
          el("button", {
            type: "button",
            class: "btn btn-ghost btn-small",
            text: "แก้ไข",
            onclick: () => startEdit(game),
          }),
          el("button", {
            type: "button",
            class: "btn btn-danger btn-small",
            text: "ลบ",
            onclick: (event) => deleteGame(game, event.currentTarget),
          }),
        ]),
      ],
    );
  });

  $("games-list").replaceChildren(...items);
}

// ==========================================
// Boardgames: form (เพิ่ม / แก้ไข)
// ==========================================

function setFieldError(inputId, message) {
  const input = $(inputId);
  $(`${inputId}-error`).textContent = message || "";
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

// ตรวจข้อมูลฝั่ง Frontend ก่อนส่ง (กฎเดียวกับ API) คืนค่า body หรือ null ถ้าไม่ผ่าน
function validateGameForm() {
  const name = $("game-name").value.trim();
  const minRaw = $("game-min").value.trim();
  const maxRaw = $("game-max").value.trim();
  const min = Number(minRaw);
  const max = Number(maxRaw);
  let valid = true;

  setFieldError("game-name", "");
  setFieldError("game-min", "");
  setFieldError("game-max", "");

  if (!name) {
    setFieldError("game-name", "กรุณากรอกชื่อบอร์ดเกม");
    valid = false;
  } else if (name.length > NAME_MAX_LENGTH) {
    setFieldError("game-name", `ชื่อยาวได้ไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร`);
    valid = false;
  }

  if (!minRaw) {
    setFieldError("game-min", "กรุณากรอกจำนวน");
    valid = false;
  } else if (!Number.isInteger(min) || min < 1) {
    setFieldError("game-min", "ต้องเป็นจำนวนเต็มตั้งแต่ 1");
    valid = false;
  }

  if (!maxRaw) {
    setFieldError("game-max", "กรุณากรอกจำนวน");
    valid = false;
  } else if (!Number.isInteger(max) || max < 1 || max > MAX_PLAYERS) {
    setFieldError("game-max", "ต้องเป็นจำนวนเต็มตั้งแต่ 1");
    valid = false;
  } else if (Number.isInteger(min) && max < min) {
    setFieldError("game-max", "ต้องมากกว่าหรือเท่ากับผู้เล่นขั้นต่ำ");
    valid = false;
  }

  return valid ? { name, minPlayers: min, maxPlayers: max } : null;
}

async function submitGameForm(event) {
  event.preventDefault();
  $("game-form-error").textContent = "";

  const body = validateGameForm();
  if (!body) return;

  const button = $("game-submit");
  const editing = state.editingId !== null;

  await withBusyButton(button, "กำลังบันทึก...", async () => {
    try {
      if (editing) {
        await api(`/api/v1/boardgames/${state.editingId}`, {
          method: "PUT",
          body,
        });
        toast(`แก้ไข "${body.name}" แล้ว`);
      } else {
        const result = await api("/api/v1/boardgames", { method: "POST", body });
        // แสดงผลการแจ้งเตือนจาก notification-service (sent หรือ fallback)
        if (result.notification?.sent) {
          toast(`เพิ่ม "${body.name}" แล้ว และแจ้งเตือนไปที่ Discord`);
        } else {
          toast(
            `เพิ่ม "${body.name}" แล้ว แต่ส่งแจ้งเตือนไม่สำเร็จ (ข้อมูลถูกบันทึกแล้ว)`,
            "warn",
          );
        }
        loadNotifications();
      }

      resetGameForm();
      loadGames();
    } catch (err) {
      $("game-form-error").textContent = err.message;
    }
  });
}

function startEdit(game) {
  state.editingId = game.id;
  $("game-form-title").textContent = `แก้ไข: ${game.name}`;
  $("game-submit").textContent = "บันทึกการแก้ไข";
  $("game-cancel").hidden = false;
  $("game-name").value = game.name;
  $("game-min").value = game.minPlayers;
  $("game-max").value = game.maxPlayers;
  $("game-form-error").textContent = "";
  renderGames();
  $("game-name").focus();
}

function resetGameForm() {
  state.editingId = null;
  $("game-form").reset();
  $("game-form-title").textContent = "เพิ่มบอร์ดเกม";
  $("game-submit").textContent = "เพิ่มบอร์ดเกม";
  $("game-cancel").hidden = true;
  $("game-form-error").textContent = "";
  ["game-name", "game-min", "game-max"].forEach((id) => setFieldError(id, ""));
  if (state.games.length) renderGames();
}

async function deleteGame(game, button) {
  if (!confirm(`ลบ "${game.name}" ใช่หรือไม่?\nความสัมพันธ์กับหมวดหมู่จะถูกลบไปด้วย`)) {
    return;
  }

  await withBusyButton(button, "กำลังลบ...", async () => {
    try {
      await api(`/api/v1/boardgames/${game.id}`, { method: "DELETE" });
      toast(`ลบ "${game.name}" แล้ว`);
      if (state.editingId === game.id) resetGameForm();
      loadGames();
      loadCategories();
    } catch (err) {
      toast(`ลบไม่สำเร็จ: ${err.message}`, "error");
    }
  });
}

// ==========================================
// Categories: form
// ==========================================

async function submitCategoryForm(event) {
  event.preventDefault();
  $("category-form-error").textContent = "";
  setFieldError("category-name", "");

  const name = $("category-name").value.trim();

  if (!name) {
    setFieldError("category-name", "กรุณากรอกชื่อหมวดหมู่");
    return;
  }
  if (name.length > NAME_MAX_LENGTH) {
    setFieldError("category-name", `ชื่อยาวได้ไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร`);
    return;
  }

  await withBusyButton($("category-submit"), "กำลังบันทึก...", async () => {
    try {
      await api("/api/v1/categories", { method: "POST", body: { name } });
      toast(`เพิ่มหมวดหมู่ "${name}" แล้ว`);
      $("category-form").reset();
      loadCategories();
    } catch (err) {
      $("category-form-error").textContent = err.message;
    }
  });
}

// ==========================================
// Dialog: จัดการหมวดหมู่ของเกม
// ==========================================

async function openCategoriesDialog(game) {
  state.dialogGame = game;
  $("dialog-title").textContent = `หมวดหมู่ของ ${game.name}`;
  $("link-form-error").textContent = "";
  $("categories-dialog").showModal();
  await loadDialogCategories();
}

async function loadDialogCategories() {
  const game = state.dialogGame;
  const status = $("dialog-status");
  const list = $("dialog-list");
  const select = $("link-category");

  showLoading(status, "กำลังโหลด...");
  list.replaceChildren();
  select.replaceChildren();
  $("link-submit").disabled = true;

  try {
    const { data: linked } = await api(`/api/v1/boardgames/${game.id}/categories`);
    clearStatus(status);

    if (linked.length === 0) {
      showInfo(status, "เกมนี้ยังไม่มีหมวดหมู่");
    }

    list.replaceChildren(
      ...linked.map((c) =>
        el("li", { class: "chip" }, [
          c.name,
          el("button", {
            type: "button",
            text: "✕",
            "aria-label": `ถอดหมวดหมู่ ${c.name}`,
            onclick: () => unlinkCategory(c),
          }),
        ]),
      ),
    );

    // ตัวเลือกที่เพิ่มได้ = หมวดหมู่ทั้งหมดที่เกมนี้ยังไม่มี
    const linkedIds = new Set(linked.map((c) => c.id));
    const available = state.categories.filter((c) => !linkedIds.has(c.id));

    if (available.length === 0) {
      select.append(el("option", { value: "", text: "ไม่มีหมวดหมู่ให้เพิ่มแล้ว" }));
    } else {
      available.forEach((c) =>
        select.append(el("option", { value: String(c.id), text: c.name })),
      );
      $("link-submit").disabled = false;
    }
  } catch (err) {
    showError(status, err.message, loadDialogCategories);
  }
}

async function linkCategory(event) {
  event.preventDefault();
  $("link-form-error").textContent = "";

  const categoryId = Number($("link-category").value);
  if (!Number.isInteger(categoryId) || categoryId < 1) {
    $("link-form-error").textContent = "กรุณาเลือกหมวดหมู่";
    return;
  }

  await withBusyButton($("link-submit"), "...", async () => {
    try {
      await api(`/api/v1/boardgames/${state.dialogGame.id}/categories`, {
        method: "POST",
        body: { category_id: categoryId },
      });
      await loadDialogCategories();
      loadGames();
      loadCategories();
    } catch (err) {
      $("link-form-error").textContent = err.message;
    }
  });
}

async function unlinkCategory(category) {
  $("link-form-error").textContent = "";
  try {
    await api(
      `/api/v1/boardgames/${state.dialogGame.id}/categories/${category.id}`,
      { method: "DELETE" },
    );
    await loadDialogCategories();
    loadGames();
    loadCategories();
  } catch (err) {
    $("link-form-error").textContent = err.message;
  }
}

// ==========================================
// Notifications (จาก notification-service)
// ==========================================

const NOTIF_LABELS = {
  sent: { text: "ส่งแล้ว", class: "pill-ok" },
  skipped: { text: "ข้าม", class: "pill-muted" },
  failed: { text: "ล้มเหลว", class: "pill-error" },
};

async function loadNotifications() {
  const status = $("notifs-status");
  const list = $("notifs-list");

  showLoading(status, "กำลังโหลด...");

  try {
    const { data } = await api("/api/v1/notifications");

    if (data.length === 0) {
      list.replaceChildren();
      showInfo(status, "ยังไม่มีการแจ้งเตือน ลองเพิ่มบอร์ดเกมดู");
      return;
    }

    clearStatus(status);
    list.replaceChildren(
      ...data.map((n) => {
        const label = NOTIF_LABELS[n.status] || NOTIF_LABELS.skipped;
        return el("li", { class: "notif" }, [
          el("p", {}, [
            el("span", { class: `badge ${label.class}`, text: label.text }),
            n.message,
          ]),
          n.error ? el("p", { class: "notif-time", text: n.error }) : null,
          el("p", {
            class: "notif-time",
            text: new Date(n.createdAt).toLocaleString("th-TH"),
          }),
        ]);
      }),
    );
  } catch (err) {
    list.replaceChildren();
    showError(status, err.message, loadNotifications);
  }
}

// ==========================================
// Start
// ==========================================

$("game-form").addEventListener("submit", submitGameForm);
$("game-cancel").addEventListener("click", resetGameForm);
$("category-form").addEventListener("submit", submitCategoryForm);
$("link-form").addEventListener("submit", linkCategory);
$("filter-category").addEventListener("change", loadGames);
$("refresh-games").addEventListener("click", () => {
  loadCategories();
  loadGames();
});
$("refresh-notifs").addEventListener("click", loadNotifications);
$("health-pill").addEventListener("click", loadHealth);
$("dialog-close").addEventListener("click", () => $("categories-dialog").close());

loadHealth();
loadCategories();
loadGames();
loadNotifications();
