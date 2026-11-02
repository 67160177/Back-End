// ==========================================
// จัดการบัญชี admin ใช้ร่วมกันระหว่าง
// - auth-service ตอนเปิด: syncEnvAdmin() ทำให้บัญชีใน ADMIN_USERNAME / ADMIN_PASSWORD (.env) เป็น admin เสมอ
// - scripts/create-admin.js: createAdmin() สร้าง admin เพิ่ม หรือเลื่อนผู้ใช้เดิมเป็น admin
// รับ pool จากข้างนอก เพื่อให้ test ได้โดยไม่ต้องมี MySQL
// ==========================================

const {
  hashPassword,
  verifyPassword,
  USERNAME_PATTERN,
  PASSWORD_MIN,
  PASSWORD_MAX,
} = require("./password");

function checkUsername(username) {
  if (!username || !USERNAME_PATTERN.test(username)) {
    throw new Error("username ต้องยาว 3-30 ตัวอักษร ใช้ได้เฉพาะ a-z, A-Z, 0-9 และ _");
  }
}

function checkPassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error(`password ต้องยาว ${PASSWORD_MIN}-${PASSWORD_MAX} ตัวอักษร`);
  }
}

// สร้าง admin ใหม่ / ผู้ใช้เดิม -> เลื่อนเป็น admin โดยไม่แตะรหัสผ่าน
async function createAdmin({ pool, username, password, askPassword }) {
  checkUsername(username);

  const [rows] = await pool.query("SELECT id, role FROM users WHERE username = ?", [username]);

  if (rows.length > 0) {
    const user = rows[0];
    if (user.role === "admin") return { action: "unchanged", id: user.id };
    await pool.query("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);
    return { action: "promoted", id: user.id };
  }

  const finalPassword = password ?? (await askPassword(`รหัสผ่านของ ${username}: `));
  checkPassword(finalPassword);

  const [result] = await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
    [username, await hashPassword(finalPassword)],
  );
  return { action: "created", id: result.insertId };
}

// บัญชี admin จาก .env: .env เป็นตัวกำหนด ทั้ง role และรหัสผ่าน
// - ยังไม่มี -> สร้างเป็น admin
// - มีแล้ว -> ตั้ง role = admin และเปลี่ยนรหัสผ่านให้ตรงกับ .env (ถ้าไม่ตรง)
async function syncEnvAdmin({ pool, username, password }) {
  checkUsername(username);
  checkPassword(password);

  const [rows] = await pool.query(
    "SELECT id, role, password_hash FROM users WHERE username = ?",
    [username],
  );

  if (rows.length === 0) {
    const [result] = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
      [username, await hashPassword(password)],
    );
    return { action: "created", id: result.insertId };
  }

  const user = rows[0];
  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (user.role === "admin" && passwordMatches) return { action: "unchanged", id: user.id };

  const newHash = passwordMatches ? user.password_hash : await hashPassword(password);
  await pool.query("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?", [newHash, user.id]);
  return {
    action: "updated",
    id: user.id,
    roleChanged: user.role !== "admin",
    passwordChanged: !passwordMatches,
  };
}

module.exports = { createAdmin, syncEnvAdmin };
