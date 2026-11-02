// ==========================================
// External API Service
// เรียก API ภายนอกอย่างทนทานต่อความผิดพลาด: Timeout + Retry + Fallback
// ==========================================

// อ่านค่าตั้งต้นจาก env (ปรับได้โดยไม่ต้องแก้โค้ด เช่น ใช้ตอนทดสอบ failure scenario)
const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const readConfig = () => ({
  timeoutMs: numberFromEnv("EXTERNAL_API_TIMEOUT_MS", 2000), // รอได้สูงสุดต่อ 1 ครั้ง
  maxRetries: numberFromEnv("EXTERNAL_API_MAX_RETRIES", 2), // ลองใหม่กี่ครั้ง (ไม่นับครั้งแรก)
  baseDelayMs: numberFromEnv("EXTERNAL_API_RETRY_DELAY_MS", 500), // delay เริ่มต้นของ backoff
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message) => console.log(`[external-api] ${message}`);

/**
 * เรียก URL ภายนอกพร้อม timeout และ retry
 *
 * - Timeout: แต่ละครั้งรอได้ไม่เกิน timeoutMs ถ้าเกินถือว่าล้มเหลว
 * - Retry: ลองใหม่เมื่อ network error, timeout, HTTP 5xx (และ 429)
 *   โดยรอ baseDelayMs * 2^(ครั้งที่ล้มเหลว - 1) ก่อนลองใหม่ (exponential backoff)
 * - ไม่ retry เมื่อเป็น 4xx อื่นๆ เพราะส่งซ้ำก็ผิดเหมือนเดิม
 *
 * ฟังก์ชันนี้ไม่ throw: คืนค่า { ok, attempts, status?, error? } เสมอ
 */
async function fetchWithRetry(url, options = {}, config = {}) {
  const { timeoutMs, maxRetries, baseDelayMs } = {
    ...readConfig(),
    ...config,
  };
  const totalAttempts = maxRetries + 1;

  let host;
  try {
    host = new URL(url).host; // ใช้แสดงใน log เท่านั้น (ไม่แสดง path เพราะ webhook URL เป็นความลับ)
  } catch {
    log("URL ไม่ถูกต้อง ยกเลิกการเรียก");
    return { ok: false, attempts: 0, error: "invalid URL" };
  }

  let lastError = "unknown error";

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    let retryable = true;

    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });

      await response.text().catch(() => ""); // อ่าน body ให้จบเพื่อคืน connection

      if (response.ok) {
        log(
          `${host} สำเร็จ (HTTP ${response.status}) ครั้งที่ ${attempt}/${totalAttempts}`,
        );
        return { ok: true, attempts: attempt, status: response.status };
      }

      lastError = `HTTP ${response.status}`;
      retryable = response.status >= 500 || response.status === 429;
    } catch (err) {
      lastError =
        err.name === "TimeoutError"
          ? `timeout (เกิน ${timeoutMs} ms)`
          : err.cause?.code || err.message;
    }

    log(`${host} ล้มเหลวครั้งที่ ${attempt}/${totalAttempts}: ${lastError}`);

    if (!retryable) {
      log("ข้อผิดพลาดนี้ลองใหม่ไม่ช่วย จึงไม่ retry");
      return { ok: false, attempts: attempt, error: lastError };
    }

    if (attempt < totalAttempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      log(`รอ ${delay} ms แล้วลองใหม่`);
      await sleep(delay);
    }
  }

  log(`ลองครบ ${totalAttempts} ครั้งแล้วยังล้มเหลว (${lastError})`);
  return { ok: false, attempts: totalAttempts, error: lastError };
}

/**
 * ส่งข้อความเข้า Discord ผ่าน Webhook (URL เก็บใน env ชื่อ DISCORD_WEBHOOK_URL)
 */
async function sendDiscordMessage(content) {
  const url = process.env.DISCORD_WEBHOOK_URL;

  if (!url) {
    log("ไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ข้ามการแจ้งเตือน");
    return { ok: false, attempts: 0, error: "DISCORD_WEBHOOK_URL is not set" };
  }

  return fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] }, // กันชื่อเกมที่มี @everyone ไปแท็กคนในห้อง
    }),
  });
}

/**
 * แจ้งเตือนว่ามีบอร์ดเกมใหม่ พร้อม fallback
 * ไม่ throw และไม่ทำให้การเพิ่มเกมล้มเหลว ถ้าแจ้งเตือนไม่ได้ จะคืนข้อความอธิบายแทน
 */
async function notifyBoardgameCreated(game) {
  try {
    const result = await sendDiscordMessage(
      `🎲 เพิ่มบอร์ดเกมใหม่: ${game.name} (${game.minPlayers}-${game.maxPlayers} ผู้เล่น)`,
    );

    if (result.ok) {
      return {
        sent: true,
        attempts: result.attempts,
        message: "ส่งแจ้งเตือนไปที่ Discord แล้ว",
      };
    }

    // Fallback: บอกผู้ใช้ชัดเจนว่าแจ้งเตือนไม่ได้ แต่ข้อมูลหลักบันทึกแล้ว
    return {
      sent: false,
      attempts: result.attempts,
      message: "เพิ่มบอร์ดเกมสำเร็จ แต่ส่งแจ้งเตือนไปที่ Discord ไม่สำเร็จ",
    };
  } catch (err) {
    console.error("[external-api] unexpected error:", err);

    return {
      sent: false,
      attempts: 0,
      message: "เพิ่มบอร์ดเกมสำเร็จ แต่ส่งแจ้งเตือนไปที่ Discord ไม่สำเร็จ",
    };
  }
}

module.exports = { fetchWithRetry, sendDiscordMessage, notifyBoardgameCreated };
