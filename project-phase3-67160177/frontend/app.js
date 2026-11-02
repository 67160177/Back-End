// ==========================================
// Board Game Manager - Frontend (HTML/CSS/JavaScript ล้วน)
// ทุกคำขอส่งไปที่ API Gateway (พอร์ต 3000) ด้วย fetch
// ดูข้อมูลได้ทุกคน / เพิ่มและแก้ไขต้องเข้าสู่ระบบ (แนบ JWT ใน header Authorization) / ลบบอร์ดเกมและหมวดหมู่เฉพาะ admin
//
// ปุ่ม/ส่วนบนหน้าเว็บ           -> ฟังก์ชัน              -> endpoint ที่เรียก
// -------------------------------------------------------------------------------------
// ฟอร์ม "เข้าสู่ระบบ"            -> login()               -> POST   /api/v1/auth/login
// ฟอร์ม "สมัครสมาชิก"           -> register()            -> POST   /api/v1/auth/register
// เปิดหน้า (มี token เดิม)        -> restoreSession()      -> GET    /api/v1/auth/me
// ป้ายสถานะมุมขวาบน             -> loadHealth()          -> GET    /api/v1/health
// รายการบอร์ดเกม (เรียง/หน้า)     -> loadGames()           -> GET    /api/v1/boardgames?page=&limit=&sort=&order=
// ฟอร์ม "เพิ่มบอร์ดเกม"           -> addGame()             -> POST   /api/v1/boardgames
// ปุ่ม "แก้ไข" แล้วกดบันทึก        -> updateGame()          -> PUT    /api/v1/boardgames/:id
// ปุ่ม "ลบ"                     -> deleteGame()          -> DELETE /api/v1/boardgames/:id (admin)
// ตัวเลือกในหน้าต่างหมวดหมู่       -> loadCategories()      -> GET    /api/v1/categories
// ฟอร์ม "เพิ่มหมวดหมู่"           -> addCategory()         -> POST   /api/v1/categories
// กดชื่อหมวดหมู่ แล้วกดบันทึก       -> updateCategory()      -> PUT    /api/v1/categories/:id
// ปุ่ม "✕" ในหมวดหมู่ทั้งหมด       -> deleteCategory()      -> DELETE /api/v1/categories/:id (admin)
// ปุ่ม "หมวดหมู่" ของแต่ละเกม     -> loadGameCategories()  -> GET    /api/v1/boardgames/:id/categories
// ปุ่ม "เพิ่ม" ในหน้าต่างหมวดหมู่   -> linkCategory()        -> POST   /api/v1/boardgames/:id/categories
// ปุ่ม "✕" ที่หมวดหมู่ของเกม       -> unlinkCategory()      -> DELETE /api/v1/boardgames/:id/categories/:categoryId
// "การแจ้งเตือนล่าสุด"            -> loadNotifications()   -> GET    /api/v1/notifications
// ==========================================

// เปิดผ่าน Gateway (http://localhost:3000/app) ใช้ origin เดียวกัน
// ถ้าเปิดไฟล์จากที่อื่น (เช่น Live Server) ให้ชี้ไปที่ Gateway ตรงๆ
const API_BASE = window.location.pathname.startsWith("/app")
  ? ""
  : "http://localhost:3000";

// ==========================================
// ฟังก์ชันกลางสำหรับเรียก API
// ==========================================

// เรียก API แล้วคืน JSON ที่ได้ ถ้า API ตอบ error (4xx/5xx) จะ throw Error พร้อมข้อความจาก API
// ถ้าเข้าสู่ระบบอยู่ แนบ token ไปทุกคำขอ / ถ้า Gateway ตอบ 401 (token หมดอายุ) ออกจากระบบให้อัตโนมัติ
async function callApi(method, path, body) {
  const options = { method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  if (session) options.headers.Authorization = `Bearer ${session.token}`;

  let response;
  try {
    response = await fetch(API_BASE + path, options);
  } catch {
    throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่ารัน npm start แล้ว");
  }

  const data = await response.json().catch(() => null);
  if (response.status === 401 && session && !path.startsWith("/api/v1/auth/login")) {
    clearSession();
    toast("การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่", "warn");
    openAuthDialog("login");
  }
  if (!response.ok) {
    // API ตอบ error รูปแบบ { error: { code, message } }
    throw new Error(
      data?.error?.message || `เกิดข้อผิดพลาด (HTTP ${response.status})`,
    );
  }
  return data;
}

// ==========================================
// ตัวช่วยเล็กๆ
// ==========================================

const $ = (id) => document.getElementById(id);

// แปลงอักขระพิเศษก่อนใส่ใน innerHTML กันชื่อเกมอย่าง <img onerror=...> ถูกรันเป็นโค้ด (XSS)
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ข้อความแจ้งผลมุมขวาล่าง หายไปเองใน 4 วินาที
function toast(message, type = "ok") {
  const box = document.createElement("div");
  box.className = type === "ok" ? "toast" : `toast is-${type}`;
  box.textContent = message;
  $("toasts").append(box);
  setTimeout(() => box.remove(), 4000);
}

// ระหว่างรอ API: ปิดปุ่มและเปลี่ยนข้อความ กันกดซ้ำ แล้วคืนค่าเดิมเมื่อเสร็จ (สำเร็จหรือไม่ก็ตาม)
async function withBusyButton(button, busyText, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ==========================================
// ตรวจข้อมูลฟอร์มฝั่ง Frontend ก่อนส่ง (กฎเดียวกับ API ใน src/index.js)
// ถ้าไม่ผ่าน จะไม่ส่งคำขอไป API เลย และแสดงข้อความใต้ช่องที่ผิด
// ==========================================

const NAME_MAX_LENGTH = 100; // ตรงกับ VARCHAR(100) ใน schema.sql

// คืน object { ชื่อช่อง: ข้อความ error } ถ้าว่าง = ผ่าน
function validateGame({ name, minPlayers, maxPlayers }) {
  const errors = {};
  if (name === "") errors.name = "กรุณากรอกชื่อบอร์ดเกม";
  else if (name.length > NAME_MAX_LENGTH)
    errors.name = `ชื่อยาวได้ไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร`;

  if (!Number.isInteger(minPlayers) || minPlayers < 1)
    errors.min = "ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป";
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1)
    errors.max = "ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป";
  else if (!errors.min && maxPlayers < minPlayers)
    errors.max = "ต้องมากกว่าหรือเท่ากับผู้เล่นขั้นต่ำ";
  return errors;
}

function validateCategory(name) {
  if (name === "") return { name: "กรุณากรอกชื่อหมวดหมู่" };
  if (name.length > NAME_MAX_LENGTH)
    return { name: `ชื่อยาวได้ไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร` };
  return {};
}

// แสดง error ใต้แต่ละช่อง + ทำกรอบแดง (aria-invalid) แล้วเลื่อนเคอร์เซอร์ไปช่องแรกที่ผิด
// fields = { ชื่อช่อง: id ของ input } เช่น { name: "game-name" }
function showFieldErrors(fields, errors) {
  let firstInvalid = null;
  for (const [key, inputId] of Object.entries(fields)) {
    const message = errors[key] || "";
    $(`${inputId}-error`).textContent = message;
    $(inputId).setAttribute("aria-invalid", message ? "true" : "false");
    if (message && !firstInvalid) firstInvalid = $(inputId);
  }
  firstInvalid?.focus();
  return firstInvalid === null;
}

// กฎเดียวกับ auth-service
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

// ตอนเข้าสู่ระบบตรวจแค่ว่ากรอกครบ ตอนสมัครตรวจรูปแบบและยืนยันรหัสผ่านด้วย
function validateAuth({ username, password, confirm }, mode) {
  const errors = {};
  if (username === "") errors.username = "กรุณากรอกชื่อผู้ใช้";
  else if (mode === "register" && !USERNAME_PATTERN.test(username))
    errors.username = "ยาว 3-30 ตัว ใช้ได้เฉพาะ a-z, A-Z, 0-9 และ _";

  if (password === "") errors.password = "กรุณากรอกรหัสผ่าน";
  else if (
    mode === "register" &&
    (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)
  )
    errors.password = `ยาว ${PASSWORD_MIN}-${PASSWORD_MAX} ตัวอักษร`;

  if (mode === "register" && !errors.password && confirm !== password)
    errors.confirm = "รหัสผ่านไม่ตรงกัน";
  return errors;
}

const GAME_FIELDS = { name: "game-name", min: "game-min", max: "game-max" };
const CATEGORY_FIELDS = { name: "category-name" };
const AUTH_FIELDS = {
  username: "auth-username",
  password: "auth-password",
  confirm: "auth-confirm",
};

// ==========================================
// ข้อมูลที่หน้าเว็บจำไว้
// ==========================================

let games = []; // บอร์ดเกมในหน้าปัจจุบัน
let categories = []; // หมวดหมู่ทั้งหมด
let currentPage = 1;
let editingId = null; // id ของเกมที่กำลังแก้ไข (null = โหมดเพิ่ม)
let editingCategoryId = null; // id ของหมวดหมู่ที่กำลังแก้ไข (null = โหมดเพิ่ม)
let dialogGame = null; // เกมที่เปิดหน้าต่างหมวดหมู่อยู่
let authMode = "login"; // หน้าต่างเข้าสู่ระบบอยู่โหมดไหน: "login" หรือ "register"

// ==========================================
// การเข้าสู่ระบบ: เก็บ { token, user } ไว้ใน localStorage ให้รีเฟรชหน้าแล้วยังอยู่
// ==========================================

const SESSION_KEY = "boardgame-session";

function loadStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

let session = loadStoredSession(); // null = ยังไม่ได้เข้าสู่ระบบ

function saveSession(value) {
  session = value;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    // เบราว์เซอร์ไม่ให้เก็บ (เช่นโหมดส่วนตัว) ก็ยังใช้ได้จนกว่าจะรีเฟรชหน้า
  }
  renderAuth();
}

function clearSession() {
  session = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
  if (editingId !== null) resetGameForm();
  if (editingCategoryId !== null) resetCategoryForm();
  renderAuth();
}

// ลบบอร์ดเกม/หมวดหมู่ได้เฉพาะ admin (Gateway ตรวจซ้ำอีกชั้น ตอบ 403 ถ้าไม่ใช่)
const isAdmin = () => session?.user.role === "admin";

// สลับหน้าจอตามสถานะ: <body class="is-guest"> ซ่อนทุกอย่างที่มี class requires-auth (ดู style.css)
// แล้ววาดรายการใหม่ ให้ปุ่มแก้ไข/ลบโผล่หรือหายตาม
function renderAuth() {
  document.body.classList.toggle("is-guest", !session);
  $("user-name").innerHTML = session
    ? `👤 ${escapeHtml(session.user.username)}${isAdmin() ? ' <span class="role-badge">admin</span>' : ""}`
    : "";
  $("category-hint").textContent = isAdmin()
    ? " (กดชื่อเพื่อแก้ไข, กด ✕ เพื่อลบ)"
    : " (กดชื่อเพื่อแก้ไข)";
  renderGames();
  renderCategories();
  if ($("categories-dialog").open) loadGameCategories();
}

// ==========================================
// GET /api/v1/health - สถานะระบบ
// ==========================================

async function loadHealth() {
  const pill = $("health-pill");
  try {
    const result = await callApi("GET", "/api/v1/health");
    if (result.status === "ok") {
      pill.className = "pill pill-ok";
      pill.textContent = "● ระบบพร้อมใช้งาน";
    } else {
      pill.className = "pill pill-warn";
      pill.textContent = "● บางบริการใช้งานไม่ได้";
    }
  } catch {
    pill.className = "pill pill-error";
    pill.textContent = "● เชื่อมต่อระบบไม่ได้";
  }
}

// ==========================================
// GET /api/v1/categories - หมวดหมู่ทั้งหมด
// เก็บไว้ในตัวแปร categories ให้หน้าต่างหมวดหมู่ของเกมใช้ทำตัวเลือก "เพิ่ม"
// ==========================================

async function loadCategories() {
  try {
    const result = await callApi("GET", "/api/v1/categories");
    categories = result.data;
    renderCategories();
  } catch (err) {
    toast(`โหลดหมวดหมู่ไม่สำเร็จ: ${err.message}`, "error");
  }
}

// รายการหมวดหมู่ทั้งหมด: กดชื่อเพื่อแก้ไข กด ✕ เพื่อลบ (✕ เฉพาะ admin / ยังไม่เข้าสู่ระบบ = แสดงชื่ออย่างเดียว)
function renderCategories() {
  $("categories-status").textContent =
    categories.length === 0 ? "ยังไม่มีหมวดหมู่" : "";
  if (!session) {
    $("category-list").innerHTML = categories
      .map((c) => `<li class="chip">${escapeHtml(c.name)}</li>`)
      .join("");
    return;
  }
  $("category-list").innerHTML = categories
    .map(
      (
        c,
      ) => `<li class="chip ${c.id === editingCategoryId ? "is-editing" : ""}">
        <button type="button" data-action="edit" data-id="${c.id}" aria-label="แก้ไขหมวดหมู่ ${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>
        ${isAdmin() ? `<button type="button" data-action="delete" data-id="${c.id}" aria-label="ลบหมวดหมู่ ${escapeHtml(c.name)}">✕</button>` : ""}</li>`,
    )
    .join("");
}

// ==========================================
// ฟอร์มหมวดหมู่: ใช้ทั้งเพิ่ม (POST) และแก้ไข (PUT)
// ==========================================

async function submitCategoryForm(event) {
  event.preventDefault();
  const name = $("category-name").value.trim();
  $("category-form-error").textContent = "";
  if (!showFieldErrors(CATEGORY_FIELDS, validateCategory(name))) return;

  try {
    await withBusyButton($("category-submit"), "กำลังบันทึก...", () =>
      editingCategoryId
        ? updateCategory(editingCategoryId, name)
        : addCategory(name),
    );
    resetCategoryForm();
    loadCategories();
  } catch (err) {
    $("category-form-error").textContent = err.message;
  }
}

// POST /api/v1/categories - เพิ่มหมวดหมู่
async function addCategory(name) {
  await callApi("POST", "/api/v1/categories", { name });
  toast(`เพิ่มหมวดหมู่ "${name}" แล้ว`);
}

// PUT /api/v1/categories/:id - แก้ไขชื่อหมวดหมู่
// โหลดรายการเกมใหม่ด้วย เพื่อให้ชื่อหมวดหมู่บนการ์ดเกมเปลี่ยนตาม
async function updateCategory(id, name) {
  await callApi("PUT", `/api/v1/categories/${id}`, { name });
  toast(`แก้ไขหมวดหมู่เป็น "${name}" แล้ว`);
  loadGames();
}

// กดชื่อหมวดหมู่: นำชื่อเดิมใส่ฟอร์ม แล้วเปลี่ยนเป็นโหมดแก้ไข
function startEditCategory(id) {
  const category = categories.find((c) => c.id === id);
  editingCategoryId = id;
  $("category-name").value = category.name;
  $("category-form-title").textContent = `แก้ไขหมวดหมู่: ${category.name}`;
  $("category-submit").textContent = "บันทึกการแก้ไข";
  $("category-cancel").hidden = false;
  $("category-form-error").textContent = "";
  renderCategories();
  $("category-name").focus();
}

function resetCategoryForm() {
  editingCategoryId = null;
  $("category-form").reset();
  $("category-form-title").textContent = "เพิ่มหมวดหมู่";
  $("category-submit").textContent = "เพิ่มหมวดหมู่";
  $("category-cancel").hidden = true;
  $("category-form-error").textContent = "";
  showFieldErrors(CATEGORY_FIELDS, {});
  renderCategories();
}

// ==========================================
// DELETE /api/v1/categories/:id - ลบหมวดหมู่
// เกมที่มีหมวดหมู่นี้จะถูกถอดออกตามอัตโนมัติ (ON DELETE CASCADE)
// ==========================================

async function deleteCategory(id) {
  const category = categories.find((c) => c.id === id);
  if (
    !confirm(
      `ลบหมวดหมู่ "${category.name}" ใช่หรือไม่?\nเกมที่อยู่ในหมวดหมู่นี้จะถูกถอดออกด้วย`,
    )
  )
    return;

  try {
    await callApi("DELETE", `/api/v1/categories/${id}`);
    toast(`ลบหมวดหมู่ "${category.name}" แล้ว`);
    if (editingCategoryId === id) resetCategoryForm();
    loadCategories();
    loadGames();
  } catch (err) {
    toast(`ลบหมวดหมู่ไม่สำเร็จ: ${err.message}`, "error");
  }
}

// ==========================================
// GET /api/v1/boardgames - รายการบอร์ดเกม (เรียง + แบ่งหน้า)
// ==========================================

async function loadGames() {
  const status = $("games-status");
  status.className = "status";
  status.innerHTML = '<span class="spinner" aria-hidden="true"></span>กำลังโหลด...';

  // ค่าจากช่องเรียงลำดับเป็นรูปแบบ "sort:order" เช่น "name:asc"
  const [sort, order] = $("sort-games").value.split(":");
  const params = new URLSearchParams({
    page: currentPage,
    limit: $("page-size").value,
    sort,
    order,
  });

  try {
    const result = await callApi("GET", `/api/v1/boardgames?${params}`);
    games = result.data;
    renderPager(result.pagination);
    renderGames();
    status.textContent = games.length === 0 ? "ยังไม่มีบอร์ดเกม" : "";
  } catch (err) {
    status.className = "status is-error";
    status.textContent = `โหลดรายการไม่สำเร็จ: ${err.message}`;
    $("games-list").innerHTML = "";
  }
}

function renderGames() {
  let html = "";
  for (const game of games) {
    // API ส่งหมวดหมู่มาเป็นข้อความคั่นด้วย , เช่น "Strategy,Family"
    const names = game.categories ? game.categories.split(",") : [];
    const chips = names.length
      ? names.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join("")
      : '<span class="chip chip-muted">ยังไม่มีหมวดหมู่</span>';

    html += `
      <li class="game ${game.id === editingId ? "is-editing" : ""}">
        <div>
          <p class="game-name">${escapeHtml(game.name)}</p>
          <p class="game-meta">ผู้เล่น ${game.minPlayers}–${game.maxPlayers} คน</p>
          <div class="chips">${chips}</div>
        </div>
        <div class="game-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="categories" data-id="${game.id}">หมวดหมู่</button>
          ${
            session
              ? `<button type="button" class="btn btn-ghost btn-small" data-action="edit" data-id="${game.id}">แก้ไข</button>`
              : ""
          }
          ${
            isAdmin()
              ? `<button type="button" class="btn btn-danger btn-small" data-action="delete" data-id="${game.id}">ลบ</button>`
              : ""
          }
        </div>
      </li>`;
  }
  $("games-list").innerHTML = html;
}

function renderPager(pagination) {
  const { page, totalPages, total } = pagination;
  $("games-pager").hidden = total === 0;
  $("page-info").textContent =
    `หน้า ${page} / ${totalPages} · ทั้งหมด ${total} เกม`;
  $("page-prev").disabled = page <= 1;
  $("page-next").disabled = page >= totalPages;
}

// ==========================================
// ฟอร์มบอร์ดเกม: ใช้ฟอร์มเดียวทั้ง "เพิ่ม" และ "แก้ไข"
// editingId = null -> addGame() (POST) / มีค่า -> updateGame() (PUT)
// ==========================================

// ช่องว่างแปลงเป็น NaN (Number("") ได้ 0 ซึ่งจะผ่านเป็นตัวเลขโดยไม่ตั้งใจ)
const toNumber = (value) => (value.trim() === "" ? NaN : Number(value));

function readGameForm() {
  return {
    name: $("game-name").value.trim(),
    minPlayers: toNumber($("game-min").value),
    maxPlayers: toNumber($("game-max").value),
  };
}

async function submitGameForm(event) {
  event.preventDefault();
  $("game-form-error").textContent = "";
  const body = readGameForm();

  // ตรวจฝั่ง Frontend ก่อน ไม่ผ่านก็ไม่ต้องส่งไป API
  if (!showFieldErrors(GAME_FIELDS, validateGame(body))) return;

  try {
    await withBusyButton($("game-submit"), "กำลังบันทึก...", () =>
      editingId === null ? addGame(body) : updateGame(editingId, body),
    );
    resetGameForm();
    loadGames();
  } catch (err) {
    // error ที่ Frontend ตรวจไม่ได้ เช่น ชื่อซ้ำ (409) หรือ service ล่ม (503) แสดงข้อความจาก API
    $("game-form-error").textContent = err.message;
  }
}

// POST /api/v1/boardgames - เพิ่มบอร์ดเกม (boardgame-service จะเรียก notification-service ต่อ)
async function addGame(body) {
  const result = await callApi("POST", "/api/v1/boardgames", body);
  if (result.notification?.sent) {
    toast(`เพิ่ม "${body.name}" แล้ว และแจ้งเตือนไปที่ Discord`);
  } else {
    toast(`เพิ่ม "${body.name}" แล้ว แต่ส่งแจ้งเตือนไม่สำเร็จ`, "warn");
  }
  loadNotifications();
}

// PUT /api/v1/boardgames/:id - แก้ไขบอร์ดเกม
async function updateGame(id, body) {
  await callApi("PUT", `/api/v1/boardgames/${id}`, body);
  toast(`แก้ไข "${body.name}" แล้ว`);
}

// กดปุ่ม "แก้ไข": นำข้อมูลเกมใส่ฟอร์ม แล้วเปลี่ยนเป็นโหมดแก้ไข
function startEdit(id) {
  const game = games.find((g) => g.id === id);
  editingId = id;
  $("game-name").value = game.name;
  $("game-min").value = game.minPlayers;
  $("game-max").value = game.maxPlayers;
  $("game-form-title").textContent = `แก้ไข: ${game.name}`;
  $("game-submit").textContent = "บันทึกการแก้ไข";
  $("game-cancel").hidden = false;
  renderGames();
  $("game-name").focus();
}

function resetGameForm() {
  editingId = null;
  $("game-form").reset();
  $("game-form-title").textContent = "เพิ่มบอร์ดเกม";
  $("game-submit").textContent = "เพิ่มบอร์ดเกม";
  $("game-cancel").hidden = true;
  $("game-form-error").textContent = "";
  showFieldErrors(GAME_FIELDS, {});
  renderGames();
}

// ==========================================
// DELETE /api/v1/boardgames/:id - ลบบอร์ดเกม
// ==========================================

async function deleteGame(id) {
  const game = games.find((g) => g.id === id);
  if (!confirm(`ลบ "${game.name}" ใช่หรือไม่?`)) return;

  try {
    await callApi("DELETE", `/api/v1/boardgames/${id}`);
    toast(`ลบ "${game.name}" แล้ว`);
    if (editingId === id) resetGameForm();
    loadGames();
  } catch (err) {
    toast(`ลบไม่สำเร็จ: ${err.message}`, "error");
  }
}

// ==========================================
// หน้าต่างจัดการหมวดหมู่ของเกม (ความสัมพันธ์ Many-to-Many)
// ==========================================

function openCategoriesDialog(id) {
  dialogGame = games.find((g) => g.id === id);
  $("dialog-title").textContent = `หมวดหมู่ของ ${dialogGame.name}`;
  $("link-form-error").textContent = "";
  $("categories-dialog").showModal();
  loadGameCategories();
}

// GET /api/v1/boardgames/:id/categories - หมวดหมู่ที่เกมนี้มีอยู่
async function loadGameCategories() {
  try {
    const result = await callApi(
      "GET",
      `/api/v1/boardgames/${dialogGame.id}/categories`,
    );
    const linked = result.data;

    // หมวดหมู่ที่เกมมีแล้ว พร้อมปุ่ม ✕ สำหรับถอดออก
    $("dialog-status").textContent =
      linked.length === 0 ? "เกมนี้ยังไม่มีหมวดหมู่" : "";
    // ปุ่ม ✕ มีเฉพาะตอนเข้าสู่ระบบ
    $("dialog-list").innerHTML = linked
      .map(
        (c) => `<li class="chip">${escapeHtml(c.name)}${
          session
            ? `<button type="button" data-id="${c.id}" aria-label="ถอดหมวดหมู่">✕</button>`
            : ""
        }</li>`,
      )
      .join("");

    // ตัวเลือกที่เพิ่มได้ = หมวดหมู่ทั้งหมดที่เกมนี้ยังไม่มี
    const linkedIds = linked.map((c) => c.id);
    const available = categories.filter((c) => !linkedIds.includes(c.id));
    $("link-category").innerHTML = available
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");
    $("link-submit").disabled = available.length === 0;
  } catch (err) {
    $("dialog-status").textContent = err.message;
  }
}

// POST /api/v1/boardgames/:id/categories - ผูกหมวดหมู่เข้ากับเกม
async function linkCategory(event) {
  event.preventDefault();
  $("link-form-error").textContent = "";
  const categoryId = Number($("link-category").value);

  try {
    await callApi("POST", `/api/v1/boardgames/${dialogGame.id}/categories`, {
      category_id: categoryId,
    });
    loadGameCategories();
    loadGames();
  } catch (err) {
    $("link-form-error").textContent = err.message;
  }
}

// DELETE /api/v1/boardgames/:id/categories/:categoryId - ถอดหมวดหมู่ออกจากเกม
async function unlinkCategory(categoryId) {
  $("link-form-error").textContent = "";
  try {
    await callApi(
      "DELETE",
      `/api/v1/boardgames/${dialogGame.id}/categories/${categoryId}`,
    );
    loadGameCategories();
    loadGames();
  } catch (err) {
    $("link-form-error").textContent = err.message;
  }
}

// ==========================================
// หน้าต่างเข้าสู่ระบบ / สมัครสมาชิก (auth-service ผ่าน Gateway)
// ==========================================

function openAuthDialog(mode) {
  setAuthMode(mode);
  $("auth-form").reset();
  showFieldErrors(AUTH_FIELDS, {});
  $("auth-form-error").textContent = "";
  if (!$("auth-dialog").open) $("auth-dialog").showModal();
  $("auth-username").focus();
}

function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";
  $("auth-title").textContent = register ? "สมัครสมาชิก" : "เข้าสู่ระบบ";
  $("auth-submit").textContent = register ? "สมัครสมาชิก" : "เข้าสู่ระบบ";
  $("auth-confirm-field").hidden = !register;
  $("auth-password").autocomplete = register ? "new-password" : "current-password";
  $("auth-switch-text").textContent = register ? "มีบัญชีแล้ว?" : "ยังไม่มีบัญชี?";
  $("auth-switch").textContent = register ? "เข้าสู่ระบบ" : "สมัครสมาชิก";
  showFieldErrors(AUTH_FIELDS, {});
  $("auth-form-error").textContent = "";
}

async function submitAuthForm(event) {
  event.preventDefault();
  $("auth-form-error").textContent = "";
  const values = {
    username: $("auth-username").value.trim(),
    password: $("auth-password").value,
    confirm: $("auth-confirm").value,
  };

  // ตรวจฝั่ง Frontend ก่อน ไม่ผ่านก็ไม่ต้องส่งไป API
  if (!showFieldErrors(AUTH_FIELDS, validateAuth(values, authMode))) return;

  try {
    await withBusyButton($("auth-submit"), "กำลังดำเนินการ...", async () => {
      if (authMode === "register") await register(values.username, values.password);
      await login(values.username, values.password);
    });
    $("auth-dialog").close();
  } catch (err) {
    // เช่น ชื่อหรือรหัสผิด (401), ชื่อถูกใช้แล้ว (409), auth-service ล่ม (503)
    $("auth-form-error").textContent = err.message;
  }
}

// POST /api/v1/auth/register - สมัครสมาชิก (สำเร็จแล้วเข้าสู่ระบบต่อให้ทันที)
async function register(username, password) {
  await callApi("POST", "/api/v1/auth/register", { username, password });
  toast(`สมัครสมาชิก "${username}" แล้ว`);
}

// POST /api/v1/auth/login - เข้าสู่ระบบ ได้ token กลับมาเก็บไว้แนบกับคำขอเพิ่ม/แก้ไข/ลบ
async function login(username, password) {
  const result = await callApi("POST", "/api/v1/auth/login", { username, password });
  saveSession({ token: result.data.token, user: result.data.user });
  toast(`ยินดีต้อนรับ ${result.data.user.username}`);
}

function logout() {
  clearSession();
  toast("ออกจากระบบแล้ว");
}

// GET /api/v1/auth/me - เปิดหน้ามาแล้วมี token เดิม: ตรวจว่ายังใช้ได้ (หมดอายุ -> callApi ออกจากระบบให้)
async function restoreSession() {
  if (!session) return;
  try {
    const result = await callApi("GET", "/api/v1/auth/me");
    // role ใช้ของเดิมใน token (Gateway ตรวจสิทธิ์จาก token) ถ้าเพิ่งถูกเลื่อนเป็น admin ต้องเข้าสู่ระบบใหม่
    saveSession({ ...session, user: { ...result.data, role: session.user.role } });
  } catch {
    // 401 ถูกจัดการใน callApi แล้ว / auth-service ล่ม: ใช้ข้อมูลเดิมไปก่อน (Gateway ยังตรวจ token เองได้)
  }
}

// ==========================================
// GET /api/v1/notifications - ประวัติการแจ้งเตือน (notification-service)
// ถ้า notification-service ล่ม Gateway ตอบ 503 ส่วนอื่นของหน้าเว็บยังใช้ได้ตามปกติ
// ==========================================

const NOTIFICATION_LABELS = {
  sent: ["ส่งแล้ว", "chip-ok"],
  failed: ["ส่งไม่สำเร็จ", "chip-error"],
  skipped: ["ข้าม (ไม่ได้ตั้งค่า)", "chip-muted"],
};

async function loadNotifications() {
  const status = $("notifications-status");
  status.className = "status";
  status.innerHTML = '<span class="spinner" aria-hidden="true"></span>กำลังโหลด...';

  try {
    const result = await callApi("GET", "/api/v1/notifications");
    const items = result.data.slice(0, 5);
    status.textContent = items.length === 0 ? "ยังไม่มีการแจ้งเตือน" : "";
    $("notification-list").innerHTML = items
      .map((n) => {
        const [label, cls] = NOTIFICATION_LABELS[n.status] || [n.status, ""];
        const time = new Date(n.createdAt).toLocaleTimeString("th-TH");
        return `<li class="notification">
          <span class="chip ${cls}">${escapeHtml(label)}</span>
          <span class="notification-text">${escapeHtml(n.message)}</span>
          <time class="notification-time">${time}</time></li>`;
      })
      .join("");
  } catch (err) {
    status.className = "status is-error";
    status.textContent = `โหลดการแจ้งเตือนไม่สำเร็จ: ${err.message}`;
    $("notification-list").innerHTML = "";
  }
}

// ==========================================
// ผูกปุ่มกับฟังก์ชัน แล้วโหลดข้อมูลครั้งแรก
// ==========================================

$("game-form").addEventListener("submit", submitGameForm);
$("game-cancel").addEventListener("click", resetGameForm);
$("category-form").addEventListener("submit", submitCategoryForm);
$("category-cancel").addEventListener("click", resetCategoryForm);
$("link-form").addEventListener("submit", linkCategory);
$("dialog-close").addEventListener("click", () =>
  $("categories-dialog").close(),
);
// ปุ่มในรายการบอร์ดเกมถูกสร้างใหม่ทุกครั้งที่โหลด จึงดักคลิกที่ <ul> ตัวเดียว แล้วดูว่ากดปุ่มไหน
// (Helmet ของ Gateway ไม่อนุญาต onclick="..." ใน HTML)
$("games-list").addEventListener("click", (event) => {
  const { action, id } = event.target.dataset;
  if (action === "categories") openCategoriesDialog(Number(id));
  if (action === "edit") startEdit(Number(id));
  if (action === "delete") deleteGame(Number(id));
});
$("category-list").addEventListener("click", (event) => {
  const { action, id } = event.target.dataset;
  if (action === "edit") startEditCategory(Number(id));
  if (action === "delete") deleteCategory(Number(id));
});
$("dialog-list").addEventListener("click", (event) => {
  if (event.target.dataset.id) unlinkCategory(Number(event.target.dataset.id));
});
$("health-pill").addEventListener("click", loadHealth);
$("notifications-refresh").addEventListener("click", loadNotifications);
$("auth-form").addEventListener("submit", submitAuthForm);
$("auth-switch").addEventListener("click", () =>
  setAuthMode(authMode === "login" ? "register" : "login"),
);
$("auth-close").addEventListener("click", () => $("auth-dialog").close());
$("login-open").addEventListener("click", () => openAuthDialog("login"));
$("guest-login").addEventListener("click", () => openAuthDialog("login"));
$("guest-register").addEventListener("click", () => openAuthDialog("register"));
$("logout").addEventListener("click", logout);

// เปลี่ยนการเรียง / จำนวนต่อหน้า = กลับไปหน้า 1 แล้วโหลดใหม่
for (const id of ["sort-games", "page-size"]) {
  $(id).addEventListener("change", () => {
    currentPage = 1;
    loadGames();
  });
}
$("page-prev").addEventListener("click", () => {
  currentPage--;
  loadGames();
});
$("page-next").addEventListener("click", () => {
  currentPage++;
  loadGames();
});

renderAuth();
restoreSession();
loadHealth();
loadCategories();
loadGames();
loadNotifications();
