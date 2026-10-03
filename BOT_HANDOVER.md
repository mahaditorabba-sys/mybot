# Mahadi Tools Assistant — Handover Guide

## Purpose
This file is the non-secret handover for continuing development of the Mahadi Tools Assistant Telegram bot from a new ChatGPT account or a different developer environment.

Do **not** put BOT_TOKEN, database passwords, API keys, or other secrets in this repository.

---

## Main Repository
- GitHub repo: `mahaditorabba-sys/mybot`
- Default branch: `main`
- Runtime: Node.js 20+
- Package manager: npm
- Entry file: `index.js`

## Railway
- Project name: `Mahadi Tools Assistant`
- Project ID: `3a112b08-f207-4c3a-bc96-c006032fed75`
- Environment: `production`
- Environment ID: `541cb692-9404-4aec-8f76-d4652dff4f6b`
- Bot service name: `mahadi-tools-assistant`
- Bot service ID: `da269daa-6d40-4400-b833-b6d78076ad9e`
- PostgreSQL service ID: `ef39b1a2-a1b6-4f8d-8664-d9c5f0aff8ea`
- PostgreSQL volume is persistent.

### Important Railway environment variables
Values must stay only in Railway, never in GitHub:
- `BOT_TOKEN`
- `OWNER_USERNAME`
- `CHANNEL_USERNAME`
- `DATABASE_URL`
- `NODE_ENV`

There may also be older/legacy variables. Do not remove them unless the code is checked first.

---

## Telegram
- Bot name: `Mahadi Tools Assistant`
- Owner username: `@Mahadihasanrony11`
- Channel username: `@MahadiToolsOfficial`
- Channel title currently seen by the bot: `Mahadi Tools Community`
- Channel chat ID: `-1003969839257`
- Group is not yet permanently set; the owner can bind a group later with `/bindgroup`.

The bot must use Telegram numeric User ID as the stable identity key. Username/name changes are tracked historically.

---

## File Structure

### `index.js`
Core bot:
- Telegram polling
- Express health server
- PostgreSQL connection
- Main premium panel
- Channel posting
- Drafts
- Scheduling
- Post history
- Inline buttons
- Auto pin
- Settings
- Custom commands
- User identity tracking
- Channel status
- Activity logs
- Wires the feature modules below

### `group_features.js`
Group/support/sales-contact features:
- Group binding
- Link filter
- Flood guard
- Welcome messages
- Group lockdown
- Smart support
- Support tickets
- Premium plan editor
- WhatsApp / Telegram sales routing
- Customer plan choice flow
- FAQ support lookup
- Optional NSFW/18+ media scanning pipeline
- Analytics
- Telegram bot command metadata

### `business_features.js`
Business controls:
- Orders
- Order status: Pending / Paid / Activated / Cancelled
- Device change requests
- Approve / Reject device requests
- Payment information
- Broadcast
- Sales summary

### `admin_plus_features.js`
Premium Admin Pack:
- Payment proof upload/review
- Payment proof Approve / Reject
- Subscription tracking
- 3-day / 1-day expiry reminders
- User search by Telegram ID or username
- User profile with orders/tickets/moderation/subscription
- Warn / Mute / Ban / Unban
- Private admin notes
- FAQ manager
- Backup / Restore
- Manual subscription creation/extension

---

## Main Owner Panel
The owner opens it with:

`/panel`

Expected sections include:
- New Post
- Quick Post
- Schedule
- Drafts
- Inline Buttons
- Auto Pin
- Post Tools
- History
- Custom Commands
- Support Setup
- Group Security
- Premium Plans
- Support Tickets
- Analytics
- Business Tools
- Admin Pack
- User Tracker
- Owner Identity
- Settings
- Channel Status
- Activity Logs
- Help

---

## Premium Plans
Plans are stored in PostgreSQL and editable from the bot panel.

Current intended pricing:
- 15 Days Premium — 50৳
- 1 Month Premium — 100৳
- 2 Months Premium — 190৳
- 1 Year Premium — 1000৳

Do not hard-reset prices on every startup. Manual owner edits must remain persistent.

Customer flow:
1. User selects a plan.
2. User chooses WhatsApp or Telegram.
3. Order is created in PostgreSQL.
4. Owner receives an alert.
5. Customer can submit payment proof with:
   `/proof <OrderID>`
6. Owner can Approve/Reject payment proof.
7. Order can later be marked Activated.
8. Activated orders are tracked for subscription expiry.

WhatsApp and Telegram contact destinations must remain editable from the bot.

---

## User Identity Tracking
Use Telegram numeric ID as the primary identity.

Track:
- Telegram ID
- first username
- current username
- first name
- last name
- first seen
- last seen
- username/name change history
- last chat context

Important limitation:
Telegram does not push every username change globally. A change is detected when the user interacts with the bot/group again.

---

## Group Mode
When the owner creates a group:
1. Add the bot as admin.
2. Give delete/restrict/ban permissions as needed.
3. Run:
   `/bindgroup`
4. Open:
   `/groupsettings`

Group features:
- anti-link
- anti-flood
- welcome
- lockdown
- smart support
- warning system
- mute/ban controls
- support tickets
- FAQ replies
- optional NSFW guard

### 18+ / NSFW scanning
Telegram Bot API alone cannot classify explicit media.

The code supports an external moderation scanner using environment variables such as:
- `NSFW_API_URL`
- `NSFW_API_KEY`

Do not claim real AI NSFW detection is active unless a working moderation service is actually connected and tested.

---

## Support / FAQ
FAQ entries are editable in the Admin Pack.

Support behavior should prefer:
1. FAQ match
2. keyword reply
3. support/help fallback

Support tickets are stored in PostgreSQL and owner can reply/close them from Telegram.

---

## Backup / Restore
Admin Pack can export a JSON configuration backup.

Backup should include:
- non-secret settings
- custom commands
- premium plans
- keyword replies
- FAQs
- subscription information

Backup must exclude:
- bot token
- API keys
- database password/URL secrets
- passwords
- secret keys

Restore should validate the backup format before applying changes.

---

## Important Security Rules
- Never commit `BOT_TOKEN`.
- Never commit API keys.
- Never paste Railway secret values into GitHub.
- Keep owner controls restricted to the real owner.
- Prefer numeric owner ID after it has been learned/stored.
- Public repo means source is visible; secrets must stay in Railway.
- Before changing database schema, preserve existing data.

---

## Deployment Workflow
When modifying the bot:

1. Edit files in `mahaditorabba-sys/mybot`.
2. Commit to `main`.
3. Deploy the exact latest commit to Railway service:
   `mahadi-tools-assistant`
4. Preserve existing environment variables and PostgreSQL wiring.
5. Check Railway deployment status.
6. If failed, inspect build/runtime logs.
7. Only tell the owner it is live after status is SUCCESS and runtime logs look healthy.

Expected healthy logs usually include:
- health server listening
- database ready
- group/support module ready
- business tools module ready
- admin plus module ready
- bot boot message

---

## Health
The bot exposes a small health server.

Typical endpoints:
- `/`
- `/health`

Do not expose secrets through health endpoints.

---

## Useful Owner Commands
- `/panel` — Main owner panel
- `/post` — New channel post
- `/status` — Service status
- `/plans` — Premium plans
- `/ticket <message>` — Support ticket
- `/business` — Business tools
- `/orders` — Recent orders
- `/devicechange <details>` — Device change request
- `/adminpack` — Premium Admin Pack
- `/usersearch <ID or @username>` — Search tracked user
- `/bindgroup` — Bind a Telegram group
- `/groupsettings` — Group security settings
- `/analytics` — Analytics
- `/backup` — Older/basic backup command

---

## New ChatGPT Account Handover Prompt
If continuing this project from a new ChatGPT/Gmail account, tell ChatGPT:

> Open my GitHub repo `mahaditorabba-sys/mybot` and read `BOT_HANDOVER.md` first. This is my live Mahadi Tools Assistant Telegram bot on Railway. Do not expose or move secrets. Check the current Railway deployment before changing anything, preserve PostgreSQL data, and deploy only after testing the exact commit.

Then connect the same GitHub and Railway accounts.

---

## Current Development Direction
Keep the bot focused on:
- Telegram channel management
- Telegram group moderation/support
- premium plan sales
- orders
- payment proof
- subscriptions
- device requests
- FAQ/support
- user identity history
- backups

The website is intentionally separate. Do not add website integration unless the owner explicitly asks again.
