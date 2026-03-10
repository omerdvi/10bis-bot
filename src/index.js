const fs       = require('fs');
const path     = require('path');
const cron     = require('node-cron');
const { chromium } = require('playwright');
const { checkBalance, loadCredit, sessionExists } = require('./browser');
const telegram = require('./telegram');

const CONFIG_FILE  = path.join(__dirname, '..', 'config.json');
const SESSION_FILE = path.join(__dirname, '..', 'session.json');
const LOG_FILE     = path.join(__dirname, '..', 'autoload.log');

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

// ── State ─────────────────────────────────────────────────────────────────────
let loginSession         = null;  // { browser, context, page, otpInput, attempts, expiresAt }
let loginExpireTimer     = null;
let loginStartInProgress = false;
let pendingLoad          = false;
let loadInProgress       = false;
let cronJob              = null;

// ── Schedule helpers ──────────────────────────────────────────────────────────
const DAY_LABELS = { '0-4': 'ראשון–חמישי', '1-5': 'שני–שישי', '0-5': 'ראשון–שישי' };

function buildCronExpression(cfg) {
  const [hour, minute] = cfg.scheduleTime.split(':');
  const days = cfg.scheduleDays; // e.g. "0-4"
  return `${minute} ${hour} * * ${days}`;
}

function dayLabel(days) {
  return DAY_LABELS[days] || days;
}

// ── Cron job ──────────────────────────────────────────────────────────────────
function startCron() {
  if (cronJob) { cronJob.stop(); cronJob = null; }
  const cfg  = loadConfig();
  const expr = buildCronExpression(cfg);
  cronJob = cron.schedule(expr, () => {
    if (loadInProgress) return;
    loadInProgress = true;
    runCreditLoad('scheduler').finally(() => { loadInProgress = false; });
  }, { timezone: 'Asia/Jerusalem' });
  log(`Cron scheduled: ${expr} (${dayLabel(cfg.scheduleDays)} ${cfg.scheduleTime})`);
}

// ── Login session management ───────────────────────────────────────────────────
const LOGIN_TTL = 10 * 60 * 1000;

function clearLoginSession(reason = '') {
  if (loginExpireTimer) { clearTimeout(loginExpireTimer); loginExpireTimer = null; }
  if (loginSession)     { loginSession.browser.close().catch(() => {}); loginSession = null; }
  if (reason) log(`Login session cleared: ${reason}`);
}

function resetLoginExpiry() {
  if (loginExpireTimer) clearTimeout(loginExpireTimer);
  loginExpireTimer = setTimeout(() => clearLoginSession('10-min timeout'), LOGIN_TTL);
  if (loginSession) loginSession.expiresAt = Date.now() + LOGIN_TTL;
}

// ── Start login flow ──────────────────────────────────────────────────────────
async function startLoginFlow() {
  clearLoginSession('restarting login');
  const cfg = loadConfig();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'he-IL',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    log('Login: navigating to 10bis homepage...');
    await page.goto('https://www.10bis.co.il', { waitUntil: 'networkidle', timeout: 30_000 });

    const loginBtn  = page.getByRole('button', { name: /התחבר|כניסה|login|sign in/i }).first();
    const loginLink = page.getByRole('link',   { name: /התחבר|כניסה|login|sign in/i }).first();
    if      (await loginBtn.isVisible({ timeout: 5_000 }).catch(() => false))  await loginBtn.click();
    else if (await loginLink.isVisible({ timeout: 3_000 }).catch(() => false)) await loginLink.click();
    log('Login: clicked login button');

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i], input[placeholder*="אימייל"]').first();
    await emailInput.waitFor({ timeout: 10_000 });
    await emailInput.fill(cfg.email);
    await emailInput.press('Enter');
    log(`Login: submitted email ${cfg.email}`);

    const otpInput = page.locator([
      'input[type="number"]',
      'input[inputmode="numeric"]',
      'input[name*="otp" i]',
      'input[name*="code" i]',
      'input[placeholder*="קוד"]',
      'input[maxlength="5"]',
      'input[maxlength="6"]',
    ].join(', ')).first();

    await otpInput.waitFor({ timeout: 20_000 });
    log('Login: OTP screen reached — waiting for code via Telegram');

    loginSession = { browser, context, page, otpInput, attempts: 0, expiresAt: 0 };
    resetLoginExpiry();
    await telegram.send(`🔐 10bis — OTP נשלח לאימייל ${cfg.email}!\nהעתק את הקוד ושלח אותו כאן:`);
    return { ok: true };
  } catch (err) {
    await browser.close().catch(() => {});
    loginSession = null;
    log(`Login start error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Submit OTP ────────────────────────────────────────────────────────────────
async function submitLoginOtp(otp) {
  if (!loginSession) return { ok: false, error: 'אין תהליך התחברות פעיל — התחל מחדש.', noSession: true };

  const MAX_ATTEMPTS = 5;
  loginSession.attempts += 1;
  resetLoginExpiry();

  const { page, otpInput } = loginSession;
  const attempt = loginSession.attempts;

  log(`Login OTP attempt ${attempt}/${MAX_ATTEMPTS}`);
  await otpInput.click({ timeout: 5_000 });
  await page.keyboard.type(String(otp), { delay: 150 });
  await page.waitForTimeout(300);

  const startUrl = page.url();
  let loginOk   = false;
  let wrongCode = false;
  const ERROR_TEXT = /קוד שגוי|קוד לא נכון|invalid code|incorrect code|code expired/i;
  let submittedManually = false;

  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const currentUrl = page.url();
    const inputGone  = !(await otpInput.isVisible().catch(() => false));
    const urlChanged = currentUrl !== startUrl;
    if (inputGone || urlChanged) { loginOk = true; break; }

    if (i === 10 && !submittedManually) {
      const submitBtn = page.locator('button').filter({ hasText: /אישור|אשר|שלח|המשך|כניסה|confirm|submit|verify/i }).first();
      if (await submitBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await submitBtn.click();
        submittedManually = true;
      }
    }

    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (ERROR_TEXT.test(pageText) && i > 2) { wrongCode = true; break; }
  }

  log(`Login OTP attempt ${attempt}: loginOk=${loginOk} wrongCode=${wrongCode}`);

  if (!loginOk) {
    const attemptsLeft = MAX_ATTEMPTS - attempt;
    if (attemptsLeft <= 0) {
      clearLoginSession('max OTP attempts');
      return { ok: false, error: `קוד שגוי ${MAX_ATTEMPTS} פעמים — שלח /start להתחלה מחדש.`, noSession: true };
    }
    return {
      ok: false,
      error: wrongCode ? 'קוד שגוי — נסה שוב' : 'הדף לא עבר — ייתכן שהקוד לא התקבל',
      attemptsLeft,
    };
  }

  // Save session
  const { context } = loginSession;
  let authCookie = null;
  let state;
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(2000);
    state = await context.storageState();
    authCookie = state.cookies?.find(c =>
      c.name.toLowerCase() === 'authorization' || c.name.toLowerCase() === 'refreshtoken'
    );
    if (authCookie) break;
  }

  log(`Login: cookies=${state.cookies?.length ?? 0} hasAuth=${!!authCookie}`);

  if (!authCookie) {
    clearLoginSession('no auth cookie');
    return { ok: false, error: 'לא נמצא Authorization cookie — נסה שוב.' };
  }

  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
  clearLoginSession('login completed successfully');
  log('Login completed successfully.');
  return { ok: true };
}

// ── Credit load ───────────────────────────────────────────────────────────────
async function runCreditLoad(source = 'scheduler') {
  log(`--- credit load triggered (${source}) ---`);
  try {
    const balance = await checkBalance();

    if (!balance.loggedIn) {
      log('Session expired — starting login flow');
      pendingLoad = true;
      if (!loginSession && !loginStartInProgress) {
        loginStartInProgress = true;
        startLoginFlow()
          .then(({ ok, error }) => { if (!ok) telegram.send(`❌ שגיאה בפתיחת דפדפן: ${error}`); })
          .catch(e => telegram.send(`❌ ${e.message}`))
          .finally(() => { loginStartInProgress = false; });
      }
      return { success: false, needsLogin: true };
    }

    if (!balance.canLoad) {
      log('No balance to load.');
      return { success: false, message: 'אין יתרה לטעינה.' };
    }

    log(`Balance: ₪${balance.remaining} — loading...`);
    const result = await loadCredit();

    if (result.needsLogin) {
      pendingLoad = true;
      if (!loginSession && !loginStartInProgress) {
        loginStartInProgress = true;
        startLoginFlow()
          .then(({ ok, error }) => { if (!ok) telegram.send(`❌ שגיאה בפתיחת דפדפן: ${error}`); })
          .catch(e => telegram.send(`❌ ${e.message}`))
          .finally(() => { loginStartInProgress = false; });
      }
      return { success: false, needsLogin: true };
    }

    log(result.success ? `SUCCESS: ${result.message}` : `FAILED: ${result.message}`);
    return result;
  } catch (err) {
    log(`ERROR: ${err.message}`);
    return { success: false, message: err.message };
  } finally {
    log('--- done ---\n');
  }
}

// ── After successful login ────────────────────────────────────────────────────
async function handleLoginSuccess() {
  if (pendingLoad && !loadInProgress) {
    pendingLoad    = false;
    loadInProgress = true;
    log('Resuming pending credit load after login...');
    runCreditLoad('scheduler-resumed')
      .then(async result => {
        if (result.success) {
          await telegram.send(`✅ ${result.message}`);
        } else if (result.message?.includes('אין יתרה')) {
          const b = await checkBalance().catch(() => null);
          await telegram.send(`💰 יתרה: ₪${b?.remaining ?? '?'} | קרדיט: ₪${b?.credit ?? '?'}`);
        } else if (!result.needsLogin) {
          await telegram.send(`❌ טעינה נכשלה: ${result.message}`);
        }
      })
      .catch(async err => telegram.send(`❌ שגיאה: ${err.message}`))
      .finally(() => { loadInProgress = false; });
  } else {
    const b = await checkBalance().catch(() => null);
    if (b) await telegram.send(`💰 יתרה: ₪${b.remaining ?? '?'} | קרדיט: ₪${b.credit ?? '?'}`);
  }
}

// ── /schedule state machine ───────────────────────────────────────────────────
let scheduleState = null; // null | 'awaiting-days' | 'awaiting-time'
let schedulePick  = null; // chosen days while awaiting time

async function handleScheduleFlow(text) {
  if (scheduleState === 'awaiting-days') {
    const map = { '1': '0-4', '2': '1-5', '3': '0-5' };
    if (!map[text]) {
      await telegram.send('שלח 1, 2 או 3 בלבד.');
      return true;
    }
    schedulePick  = map[text];
    scheduleState = 'awaiting-time';
    await telegram.send('🕓 באיזו שעה? (לדוגמה: 16:00)');
    return true;
  }

  if (scheduleState === 'awaiting-time') {
    const m = text.match(/^(\d{1,2}):(\d{2})$/);
    const h = m ? parseInt(m[1]) : -1;
    const mn = m ? parseInt(m[2]) : -1;
    if (!m || h < 0 || h > 23 || mn < 0 || mn > 59) {
      await telegram.send('❌ פורמט שגוי. שלח שעה כך: 16:00');
      return true;
    }
    const time = `${String(h).padStart(2, '0')}:${m[2]}`;
    const cfg  = loadConfig();
    cfg.scheduleDays = schedulePick;
    cfg.scheduleTime = time;
    saveConfig(cfg);
    startCron(); // restart with new schedule
    scheduleState = null;
    schedulePick  = null;
    await telegram.send(`✅ עודכן: ${dayLabel(cfg.scheduleDays)} בשעה ${time}`);
    return true;
  }

  return false;
}

// ── Telegram message handler ──────────────────────────────────────────────────
telegram.onMessage(async text => {
  // Schedule flow takes priority
  if (scheduleState && await handleScheduleFlow(text)) return;

  // /balance
  if (text === '/balance' || text === 'יתרה') {
    try {
      const b = await checkBalance();
      if (!b.loggedIn) {
        if (!loginSession && !loginStartInProgress) {
          loginStartInProgress = true;
          startLoginFlow()
            .then(({ ok, error }) => { if (!ok) telegram.send(`❌ שגיאה: ${error}`); })
            .catch(e => telegram.send(`❌ ${e.message}`))
            .finally(() => { loginStartInProgress = false; });
        } else {
          await telegram.send('🔐 תהליך התחברות כבר פעיל — שלח את הקוד כשיגיע.');
        }
      } else {
        await telegram.send(`💰 יתרה יומית: ₪${b.remaining ?? '?'} | קרדיט צבור: ₪${b.credit ?? '?'}`);
      }
    } catch (e) {
      await telegram.send(`❌ שגיאה: ${e.message}`);
    }
    return;
  }

  // /load
  if (text === '/load') {
    if (loadInProgress) { await telegram.send('⏳ טעינה כבר פעילה...'); return; }
    loadInProgress = true;
    await telegram.send('⏳ טוען קרדיט...');
    runCreditLoad('manual')
      .then(async result => {
        if (result.success)        await telegram.send(`✅ ${result.message}`);
        else if (result.needsLogin) {} // login flow already started inside runCreditLoad
        else                       await telegram.send(`⚠️ ${result.message}`);
      })
      .catch(async e => telegram.send(`❌ ${e.message}`))
      .finally(() => { loadInProgress = false; });
    return;
  }

  // /schedule
  if (text === '/schedule') {
    scheduleState = 'awaiting-days';
    await telegram.send('📅 איזה ימים?\n1 — ראשון–חמישי\n2 — שני–שישי\n3 — ראשון–שישי\n\nשלח מספר:');
    return;
  }

  // /mail
  if (text.startsWith('/mail')) {
    const email = text.replace('/mail', '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await telegram.send('❌ כתובת מייל לא תקינה.\nשימוש: /mail user@example.com');
      return;
    }
    const cfg = loadConfig();
    cfg.email = email;
    saveConfig(cfg);
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    await telegram.send(`✅ מייל עודכן ל-${email}\n🔐 מתחיל תהליך התחברות...`);
    if (!loginSession && !loginStartInProgress) {
      loginStartInProgress = true;
      startLoginFlow()
        .then(({ ok, error }) => { if (!ok) telegram.send(`❌ שגיאה: ${error}`); })
        .catch(e => telegram.send(`❌ ${e.message}`))
        .finally(() => { loginStartInProgress = false; });
    }
    return;
  }

  // /help
  if (text === '/help') {
    const cfg = loadConfig();
    await telegram.send(
      `🥡 10bis Bot — פקודות:\n\n` +
      `/balance — יתרה נוכחית\n` +
      `/load — טען קרדיט עכשיו\n` +
      `/mail user@example.com — שנה כתובת מייל\n` +
      `/schedule — שנה זמן ולוח ימים\n` +
      `/help — הצג עזרה זו\n\n` +
      `⚙️ הגדרות נוכחיות:\n` +
      `📧 מייל: ${cfg.email}\n` +
      `🕓 זמן טעינה: ${cfg.scheduleTime}\n` +
      `📅 ימים: ${dayLabel(cfg.scheduleDays)}`
    );
    return;
  }

  // OTP submission
  if (loginSession) {
    const otp = text.replace(/\D/g, '');
    if (otp.length < 5 || otp.length > 6) {
      await telegram.send('שלח קוד בן 5–6 ספרות, או /balance לבדיקת יתרה.');
      return;
    }
    await telegram.send('⏳ מאמת קוד...');
    let result;
    try { result = await submitLoginOtp(otp); }
    catch (e) { result = { ok: false, error: e.message }; }

    if (!result.ok) {
      const left = result.attemptsLeft ? ` (${result.attemptsLeft} נסיונות נותרו)` : '';
      await telegram.send(`❌ ${result.error}${left}`);
    } else {
      await telegram.send('✅ התחברות הצליחה!');
      handleLoginSuccess();
    }
    return;
  }

  await telegram.send('אין תהליך התחברות פעיל.\nשלח /balance לבדיקת יתרה או /help לעזרה.');
});

// ── Startup ───────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('config.json not found — run setup.ps1 first.');
    process.exit(1);
  }

  const cfg = loadConfig();
  log(`10bis-bot started | email: ${cfg.email} | schedule: ${cfg.scheduleDays} ${cfg.scheduleTime}`);

  telegram.start();
  startCron();

  // Startup session check
  if (sessionExists()) {
    checkBalance().then(async data => {
      if (data.loggedIn) {
        log(`Startup: session OK (remaining=₪${data.remaining} credit=₪${data.credit})`);
      } else if (!data.reason?.includes('520')) {
        log(`Startup: session expired (${data.reason}) — starting login`);
        pendingLoad = true;
        if (!loginStartInProgress) {
          loginStartInProgress = true;
          startLoginFlow()
            .then(({ ok, error }) => { if (!ok) telegram.send(`❌ שגיאה בהתחברות: ${error}`); })
            .catch(e => telegram.send(`❌ ${e.message}`))
            .finally(() => { loginStartInProgress = false; });
        }
      }
    }).catch(err => log(`Startup session check error: ${err.message}`));
  } else {
    log('Startup: no session.json — waiting for /start and first login');
    telegram.send('👋 הבוט פועל! אין session שמור.\nשלח /balance כדי להתחבר.');
  }
}

main();
