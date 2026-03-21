# 🥡 10bis Bot

Automatically loads your [10bis](https://www.10bis.co.il) daily allowance into credit before it expires — controlled entirely via Telegram.

---

## What it does

- Runs silently in the background on your Windows PC
- At a scheduled time (default: 16:00 Mon–Fri), checks your 10bis balance and loads it into credit automatically
- Sends you a Telegram message with the result after every load
- If your session has expired, it opens a browser, navigates to 10bis, and sends you the OTP via Telegram
- You reply with the code → it logs in and loads the credit → sends you a confirmation
- Control everything from Telegram — no need to touch the PC
- **Note:** your PC needs to be on (not asleep) at the scheduled time for auto-load to work

---

## Requirements

- Windows 10 or 11
- Node.js (the installer can install it for you automatically)
- A Telegram account

---

## Installation

1. Extract the **`10bis-bot.zip`** file to any folder on your PC (e.g. `C:\10bis-bot`)
2. Open the extracted folder and double-click **`install.bat`**
3. Click **Yes** on the UAC (admin) prompt
4. Follow the setup wizard:
   - Enter your **10bis email address**
   - Create a Telegram bot (see below) and paste the **bot token**
   - Choose which days to run (Sun–Thu / Mon–Fri / Sun–Fri)
   - Choose what time (default: 16:00)
5. Open Telegram → find your new bot → send **`/start`**
6. Send **`/balance`** to verify the connection works
7. Done — the bot is running and will auto-start on every Windows login

### How to create a Telegram bot

1. Open Telegram and search for **@BotFather** (the official bot for creating bots)
2. Send him `/newbot`
3. He'll ask for a **display name** — type anything you like (e.g. "My 10bis Bot")
4. He'll ask for a **username** — must end with `bot` (e.g. `my_10bis_bot`)
5. You'll get a message with your **bot token** — it looks like `123456789:ABCdef...`
6. Copy the token and paste it in the setup wizard

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

## Troubleshooting

| Problem | Solution |
|---|---|
| Bot doesn't respond in Telegram | Make sure `node.exe` is running (check Task Manager). If not, double-click `launch.vbs` |
| Credit wasn't loaded at 16:00 | Your PC was probably asleep or off. Send `/load` manually, or check the log in `autoload.log` |
| "Session expired" messages | This is normal — the bot will ask you for an OTP code via Telegram. Just reply with the code from your email |
| Setup wizard fails on "npm install" | Make sure you have internet access. Try running `install.bat` again |
| Wrong email address | Send `/mail newaddress@example.com` to your bot in Telegram |

---

## Uninstall

1. Open **Task Scheduler** → find **"10bis Bot"** → delete it
2. Delete the app folder
