const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const SESSION_FILE      = path.join(__dirname, '..', 'session.json');
const LOG_FILE          = path.join(__dirname, '..', 'autoload.log');
const PERSONAL_AREA_URL = 'https://www.10bis.co.il/next/personal-area?section=my-orders&dateBias=0';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

function sessionExists() {
  return fs.existsSync(SESSION_FILE);
}

function getCookieHeader(hostname) {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  return session.cookies
    .filter(c => hostname.endsWith(c.domain.replace(/^\./, '')))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

async function checkBalance() {
  if (!sessionExists()) return { loggedIn: false, reason: 'no-session' };

  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const cookieHeader = getCookieHeader('api.10bis.co.il');
    res = await fetch('https://api.10bis.co.il/api/v1/Payments/Moneycards', {
      headers: {
        'Cookie':     cookieHeader,
        'Accept':     'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer':    'https://www.10bis.co.il/',
      },
    });
    if (res.ok) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
  }

  if (!res.ok) return { loggedIn: false, reason: `HTTP ${res.status}` };

  const cards      = await res.json();
  const regularCard = cards.find(c => !c.isTenbisCredit);
  const creditCard  = cards.find(c => c.isTenbisCredit);

  const remaining   = regularCard?.tenbisCreditConversion?.availableAmount ?? 0;
  const credit      = creditCard?.balance ?? null;
  const moneycardId = regularCard?.moneycardId ?? null;

  return { loggedIn: true, remaining, credit, canLoad: remaining > 0, moneycardId };
}

async function loadCredit() {
  if (!sessionExists()) return { success: false, needsLogin: true };

  const balance = await checkBalance();
  if (!balance.loggedIn) return { success: false, needsLogin: true };
  if (!balance.canLoad)  return { success: false, message: 'אין יתרה לטעינה.' };

  const { remaining, moneycardId } = balance;

  if (!moneycardId) {
    log('moneycardId missing — falling back to browser');
    return loadCreditViaBrowser();
  }

  const cookieHeader = getCookieHeader('api.10bis.co.il');
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch('https://api.10bis.co.il/api/v1/Payments/LoadTenbisCredit', {
      method: 'POST',
      headers: {
        'Cookie':       cookieHeader,
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer':      'https://www.10bis.co.il/',
        'Origin':       'https://www.10bis.co.il',
      },
      body: JSON.stringify({ amount: remaining, moneycardIdToCharge: moneycardId }),
    });
    if (res.ok) break;
    if (res.status === 401 || res.status === 403) return { success: false, needsLogin: true };
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
  }

  if (!res.ok) {
    log(`Direct API failed (HTTP ${res.status}) — falling back to browser`);
    return loadCreditViaBrowser();
  }

  await new Promise(r => setTimeout(r, 2000));
  const after = await checkBalance().catch(() => null);

  return {
    success: true,
    message: `טעינה הצליחה ₪${remaining} | יתרה: ₪${after?.remaining ?? '?'} | קרדיט: ₪${after?.credit ?? '?'}`,
  };
}

async function loadCreditViaBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    locale: 'he-IL',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  try {
    const page = await context.newPage();
    await page.goto(PERSONAL_AREA_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    if (page.url().includes('/login')) return { success: false, needsLogin: true };

    await page.waitForTimeout(2000);

    const TRACKING = /\b(collect|analytics|ga|gtm|pixel|beacon)\b/i;
    let resolveLoadApi;
    const loadApiPromise = new Promise(resolve => { resolveLoadApi = resolve; });
    page.on('response', res => {
      const url = res.url();
      if (!url.includes('10bis')) return;
      if (!['POST', 'PUT', 'PATCH'].includes(res.request().method())) return;
      if (TRACKING.test(url)) return;
      res.json()
        .then(body => resolveLoadApi({ url, status: res.status(), body }))
        .catch(() => resolveLoadApi({ url, status: res.status(), body: null }));
    });

    const loadBtn = page.locator('button').filter({ hasText: /הטענת/ }).first();
    await loadBtn.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    if (await loadBtn.count() === 0) return { success: false, message: 'כפתור הטענה לא נמצא בדף.' };

    await loadBtn.scrollIntoViewIfNeeded();
    await loadBtn.click({ timeout: 8_000 });

    const step1Btn = page.getByRole('button', { name: /^המשך$/ }).first();
    if (await step1Btn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await step1Btn.click();
    } else {
      return { success: false, message: 'חלון אישור (המשך) לא נמצא.' };
    }

    await page.waitForTimeout(1500);

    const step2Btn = page.getByRole('button', { name: /^הטענת קרדיט$/ }).first();
    if (await step2Btn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await step2Btn.click();
    } else {
      return { success: false, message: 'חלון אישור סופי לא נמצא.' };
    }

    const loadApiSeen = await Promise.race([
      loadApiPromise,
      new Promise(resolve => setTimeout(() => resolve(null), 10_000)),
    ]);

    if (!loadApiSeen) return { success: false, message: 'לא התקבלה תשובה מ-10bis אחרי האישור.' };
    if (loadApiSeen.status >= 400) return { success: false, message: `שגיאת API: HTTP ${loadApiSeen.status}` };

    await page.waitForTimeout(3000);
    const after = await checkBalance().catch(() => null);

    return {
      success: true,
      message: `טעינה הצליחה | יתרה: ₪${after?.remaining ?? '?'} | קרדיט: ₪${after?.credit ?? '?'}`,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { checkBalance, loadCredit, sessionExists };
