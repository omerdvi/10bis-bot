# 🥡 10bis Bot

Automatically loads your [10bis](https://www.10bis.co.il) daily allowance into credit before it expires — controlled entirely via Telegram.

---

## What it does

- Runs silently in the background on your Windows PC
- At a scheduled time (e.g. 16:00 Sun–Thu), checks your 10bis balance and loads it into credit automatically
- If your session has expired, it opens a browser, navigates to 10bis, and sends you the OTP via Telegram
- You reply with the code → it logs in and loads the credit → sends you a confirmation
- Control everything from Telegram — no need to touch the PC

---

## Requirements

- Windows 10 or 11
- Node.js (the installer can install it for you automatically)
- A Telegram account

---

## Installation

1. Download this repo as a ZIP → extract it anywhere
2. Double-click **`install.bat`**
3. Click **Yes** on the UAC (admin) prompt
4. Follow the setup wizard:
   - Enter your 10bis email
   - Create a Telegram bot via [@BotFather](https://t.me/BotFather) and paste the token
   - Choose which days to run (Sun–Thu / Mon–Fri / Sun–Fri)
   - Choose what time (default: 16:00)
5. Open Telegram → send **`/start`** to your new bot
6. Done — the bot is running and will auto-start on every Windows login

---

## Telegram Commands

| Command | Description |
|---|---|
| `/balance` | Check your current daily allowance and accumulated credit |
| `/load` | Manually trigger a credit load right now |
| `/mail user@example.com` | Change your 10bis email address |
| `/schedule` | Change the scheduled days and time (guided flow) |
| `/help` | Show all commands and current settings |
| `5–6 digit code` | Submit OTP during login |

---

## How the OTP flow works

When 10bis requires a login (session expired):

1. Bot automatically navigates to 10bis and requests an OTP
2. You receive a Telegram message: *"OTP sent — paste the code here"*
3. Check your email (or SMS) for the code from 10bis
4. Reply to the bot with the code
5. Bot logs in and resumes the credit load

---

## Changing the schedule

Send `/schedule` to your bot and follow the prompts:

```
📅 Which days?
1 — Sunday–Thursday
2 — Monday–Friday
3 — Sunday–Friday

🕓 At what time? (e.g. 16:00)
```

The change takes effect immediately — no restart needed.

---

## Uninstall

1. Open **Task Scheduler** → find **"10bis Bot"** → delete it
2. Delete the app folder
