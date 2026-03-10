const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const API         = 'https://api.telegram.org/bot';

let cfg          = null;
let lastUpdateId = 0;
let _onMessage   = null;

function loadConfig() {
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { cfg = null; }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

async function send(text) {
  loadConfig();
  if (!cfg?.telegramBotToken || !cfg?.telegramChatId) return;
  await fetch(`${API}${cfg.telegramBotToken}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: cfg.telegramChatId, text }),
  }).catch(() => {});
}

function onMessage(cb) { _onMessage = cb; }

async function poll() {
  loadConfig();
  if (!cfg?.telegramBotToken) return;

  const res = await fetch(
    `${API}${cfg.telegramBotToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`,
    { signal: AbortSignal.timeout(30_000) }
  );
  const { result = [] } = await res.json();

  for (const u of result) {
    lastUpdateId = u.update_id;
    const msg = u.message;
    if (!msg?.text) continue;

    // Auto-register chat ID on /start
    if (msg.text.startsWith('/start') && !cfg.telegramChatId) {
      cfg.telegramChatId = String(msg.chat.id);
      saveConfig();
      await send('✅ הבוט מחובר! תקבל הודעה כשנדרש OTP.');
      continue;
    }

    // Only handle messages from the registered chat
    if (String(msg.chat.id) !== String(cfg.telegramChatId)) continue;
    if (_onMessage) _onMessage(msg.text.trim());
  }
}

function start() {
  loadConfig();
  if (!cfg?.telegramBotToken) {
    console.error('[Telegram] No bot token in config.json — run setup.ps1 first.');
    return false;
  }
  (async function loop() {
    try { await poll(); } catch (e) {}
    setImmediate(loop);
  })();
  console.log(`[Telegram] Bot ready — chat ID: ${cfg.telegramChatId || '(send /start to register)'}`);
  return true;
}

module.exports = { start, send, onMessage, saveConfig, loadConfig: () => { loadConfig(); return cfg; } };
