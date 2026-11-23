# Sidra Home Healthcare — Lead Management & 6-Month Follow-up CRM

A complete CRM for Sidra Home Healthcare: bulk lead upload, **fair automatic lead distribution by service**, an automatic **six-month follow-up journey** for every client, call notes, WhatsApp and email, bookings and revenue in **AED**, bulk email campaigns, browser notifications, a 9 PM escalation and daily/weekly/monthly reports.

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (`index.html`, `style.css`, `app.js`), hosted on **GitHub Pages** |
| Backend | **Google Apps Script** (`Code.gs`) deployed as a Web App |
| Database | **Google Sheets** (18 sheets, created automatically) |
| Email | Apps Script `MailApp` |
| WhatsApp | `wa.me` click-to-chat (you press *Send* in WhatsApp) |
| Notifications | Browser Notification API (while the CRM is open) |
| Timezone / currency | Asia/Dubai · AED |

---

## 1. Project structure

```
sidra-home-healthcare-crm/
├── index.html              Login, password setup, app shell
├── app.js                  All frontend logic (views, API client, charts, notifications)
├── style.css               Sidra brand theme (from the logo), responsive + print styles
├── Code.gs                 Apps Script backend (API, database, automation, emails, reports)
├── appsscript.json         Apps Script manifest (timezone, scopes, web-app settings)
├── config.example.js       Frontend configuration template
├── config.js               Your configuration (paste the Web App URL here)
├── sample_leads_template.csv
├── README.md
└── assets/
    ├── logo.png            Sidra Healthcare logo (transparent)
    ├── favicon.png
    └── icons/
```

---

## 2. Google Sheets & Apps Script setup (backend)

1. **Create the database.** In Google Drive, create a new Google Sheet named e.g. `Sidra CRM Database`.
   *Do not share it with anyone.* The Web App reads it as you; agents never need Sheet access.
2. **Open Apps Script:** in the Sheet, choose **Extensions → Apps Script**.
3. **Add the code:**
   - Delete the default contents of `Code.gs` and paste the entire `Code.gs` from this project.
   - Click **Project Settings (⚙)** → tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace its contents with this project's `appsscript.json`.
4. **Edit the `SETUP` block** at the top of `Code.gs`:
   ```js
   var SETUP = {
     superAdminName: 'Super Admin',
     superAdminEmail: 'admin@sidra.local',
     superAdminPassword: 'sidra@123',        // temporary
     frontendUrl: 'https://<your-github-username>.github.io/sidra-home-healthcare-crm/'
   };
   ```
5. **Initialise the database.** Choose `setupSystem` in the function dropdown and click **Run**. Approve the permissions prompt (Google shows "unverified app" for personal scripts → *Advanced → Go to project*).
   This creates all 18 sheets with headers, the 6 default services, the default settings, the **Super Admin** account (password hashed, never stored as plain text), and the time-driven triggers. It is safe to re-run.

### Database sheets (created automatically)
`Users, Agents, Admins, Services, Clients, Leads, Assignments, Journeys, FollowUpTasks, CallNotes, Bookings, EmailCampaigns, EmailLogs, ClientRequests, Notifications, ActivityLogs, DailyReports, SystemSettings`

Every record has a unique ID (`CL-000123` for clients, `LD-000123` for leads, prefixed UUIDs for everything else). All cells are stored as plain text. Dates use `yyyy-MM-dd`, timestamps use `yyyy-MM-dd HH:mm:ss`, both in Asia/Dubai. Values starting with `=` are escaped so they cannot run as formulas.

---

## 3. Deploy the Web App (API)

1. In the Apps Script editor click **Deploy → New deployment**.
2. Type: **Web app**. *Execute as:* **Me**. *Who has access:* **Anyone**.
   (Anyone can reach the URL, but every action requires a valid session token and is permission-checked on the server.)
3. Click **Deploy** and copy the **Web app URL** (ends with `/exec`).
4. **After any change to `Code.gs`:** *Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy*. The URL stays the same.

---

## 4. Frontend setup & GitHub Pages deployment

1. Open `config.js` and paste the Web App URL:
   ```js
   window.SIDRA_CONFIG = { API_URL: 'https://script.google.com/macros/s/AKfy.../exec', POLL_SECONDS: 60, PAGE_SIZE: 25, UPLOAD_CHUNK: 150 };
   ```
2. Create a GitHub repository named `sidra-home-healthcare-crm` and upload all project files (you can leave `Code.gs` and `appsscript.json` in the repo for version control; they are not served or executed by GitHub Pages).
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / root → Save**.
4. After about a minute your CRM is live at `https://<username>.github.io/sidra-home-healthcare-crm/`.
5. Make sure the same URL is set in **Settings → CRM URL** inside the app (or in `SETUP.frontendUrl` before running `setupSystem`). It is used for the password-setup links and the buttons in emails.

> **Tip:** the repository can be private on paid GitHub plans with Pages enabled. On free plans the frontend code is public. That is fine because it contains no secrets; all data stays in your private Google Sheet.

---

## 5. First sign-in (Super Admin)

1. Open the CRM and use **Admin sign in**:
   - Email: `admin@sidra.local`
   - Password: `sidra@123`
2. You will be asked to **choose a new password immediately**. The temporary one stops working once you change it.
3. Go to **User Management → Edit** your own account and change the email to a **real mailbox**. Reports and escalations are emailed to Super Admins; `admin@sidra.local` cannot receive mail.
4. Create **Admins** (User Management) and **Agents** (Agents). Each new user receives a welcome email with a secure, single-use **password setup link** (valid 72 h). Passwords are never emailed.
   If an email cannot be delivered, the app shows the one-time link so you can share it securely.
5. Agents sign in with **Team member sign in**; Admins and Super Admins use **Admin sign in**.

---

## 6. Scheduled automation (triggers)

`setupSystem()` installs two triggers (re-create them any time by running `setupTriggers`):

| Trigger | Frequency | What it does |
|---|---|---|
| `scheduler` | Every hour | Runs each job **once per day/period** (dedupe keys in `SystemSettings`); if a run is missed, the next hour catches up |
| `processEmailQueue` | Every 10 min | Sends queued bulk-email batches within the Gmail quota, and starts scheduled campaigns |

Jobs run by `scheduler` (Asia/Dubai, configurable in **Settings**):

| Time | Job |
|---|---|
| ~01:00 | Extend active journeys that reached their end date (+6 months, same agent) and generate the next follow-up tasks |
| 08:00 | In-app "today's follow-ups" notifications for each agent |
| 18:00 | *Reminder – Pending Client Follow-ups Today* email to agents with unfinished tasks |
| **21:00** | **Pending-lead escalation**: emails Admins (their team) and Super Admins with client names, services, assigned dates and overdue status; logged in ActivityLogs |
| 22:00 | Daily performance report |
| Monday 08:00 | Weekly report (previous Mon–Sun) |
| 1st of month 08:00 | Monthly report (previous month) |

Super Admins can run any job manually from **Settings → Run scheduled jobs now**.

---

## 7. How the key features work

**Fair lead distribution.** For each uploaded lead, the system finds the *active* agents who have that service. The lead goes to the eligible agent with the **fewest active leads for that service**. Ties are broken **round-robin** from a pointer saved per service. Result: 100 IV Therapy leads across two IV agents → 50/50; across three → 34/33/33. Agents without the service get 0. Workloads are counted per service, and the whole assignment runs under `LockService`, so simultaneous uploads cannot double-assign. Leads with no eligible agent go to the **Unassigned queue**, and admins are notified. They are distributed automatically as soon as an agent gains that service or is re-activated, or when you click **Auto-assign unassigned**.

**Six-month journey.** Every new lead gets a journey: start = lead entry date, end = start + 6 months − 1 day (1 Jan 2027 → 30 Jun 2027). The default follow-up schedule is days **0, 1, 3, 7, 14, 30**, then **every 30 days** until the end date. Both are configurable in Settings. Active journeys extend automatically by 6 months, keeping the same agent, and the extension is recorded in the journey history. Closed journeys never extend and all their pending tasks are cancelled. If you import an old lead whose dates are in the past, the journey rolls forward to the current period and gets a catch-up task today, instead of flooding the agent with overdue tasks.

**Rescheduling.** A rescheduled task moves to its new date/time; it is never deleted. It leaves today's list, shows up on the new date, triggers a browser notification 15 minutes before a timed callback, and is excluded from the 9 PM escalation.

**Duplicates.** Clients are matched by normalised phone number (UAE formats like `050…`, `+97150…`, `0097150…` are equivalent) or by email. For each duplicate you choose **Skip**, **Update existing client** or **Create a separate lead**. One client profile can hold many service enquiries.

**Bookings & revenue.** Amounts are in AED. Every edit is stored in the booking's change history. Cancelled bookings are excluded from all revenue figures.

**Bulk email.** Filters combine (AND). *Promotional* emails only go to clients with **marketing consent = Yes**. Unsubscribed clients never receive campaign emails. Every email has a signed one-click **unsubscribe** link. Bodies are sanitised (no scripts), and sending happens in batches to respect Gmail quotas (≈100/day on free Gmail, ≈1,500/day on Google Workspace).

**Browser notifications** work while the CRM is open in a tab and permission is granted (profile menu → *Enable browser notifications*). They do not arrive when the browser is fully closed; email reminders cover that case.

---

## 8. Security & privacy

- Passwords are salted and hashed (SHA-256 iterated + server-side pepper); setup/reset tokens are stored only as hashes and are single-use with expiry.
- Sessions are random tokens held server-side in `CacheService`, with a 6-hour sliding expiry. Disabling a user revokes access on their next request.
- **Every permission is enforced in `Code.gs`**, not just hidden in the UI. Agents can only read and act on their own leads. Admins see their team; they cannot edit Super Admins or create Admins.
- Login lockout after 5 failed attempts (15 min); per-token rate limiting; all write operations are serialised with `LockService`.
- API responses never include password hashes, salts or tokens. Errors shown to users are generic.
- All important actions are written to **ActivityLogs** (viewable/exportable in User Management → Activity log).
- **Privacy (UAE PDPL / healthcare data):** the CRM stores contact and sales information only. Do **not** enter diagnoses, lab results or other clinical records in notes. Keep the Google Sheet private, enable 2-Step Verification on the Google account that owns it, and export/delete client data on request. Review your obligations with your compliance adviser.

---

## 9. Testing — acceptance checklist

Run these after deployment (the backend logic has been verified against all of them in an automated harness):

1. Create three agents (Agents → New agent).
2. Give **IV Therapy** to two of them (e.g. A: IV Therapy + Laboratory Tests, B: IV Therapy + Doctor at Home, C: Peptides).
3. Bulk Upload → *Download template* → put 100 IV Therapy rows in it → upload.
4. The import summary shows **A = 50, B = 50, C = 0**.
5. Upload a file with several services.
6. Check Leads: each lead belongs to an agent who has that service; Other Services goes to *Unassigned* if no agent has it.
7. Open any lead → **Journey** tab shows the journey created automatically.
8. Lead entered 1 Jan 2027 → follow-ups on 1, 2, 4, 8, 15, 31 Jan, then 2 Mar, 1 Apr, 1 May, 31 May, 30 Jun; journey end **30 Jun 2027**.
9. Today's Follow-ups → **Reschedule → Tomorrow** with a reason. It disappears from today and appears tomorrow.
10. **Add note** with outcome and interest level. It shows in the profile's Call notes and Activity timeline.
11. **WhatsApp** → edit the message → *Open WhatsApp* opens `wa.me/<number>` with the text.
12. **Email** → edit subject/body → preview → *Send email*. The email is logged in the profile.
13. **Convert to booking** → amount in AED. The lead becomes *Converted*.
14. Bookings & Dashboard show the revenue in AED; cancelled bookings are excluded.
15. Leads → tick several rows → *Reassign selected*; or **Transfer all leads** between agents. Journeys and open tasks move too.
16. Settings → *Run scheduled jobs → Extend due journeys* (or wait for the end date). The journey shows period 2 and new tasks.
17. Close a journey as an agent: an approval request is created. Approve it in Client Requests, and the tasks are cancelled.
18. Settings → *Send 9 PM escalation report* (or wait until 21:00). Admin and Super Admin receive the pending list.
19. Reports → *Email daily/weekly/monthly report now*; also *Export CSV* / *Export PDF*.
20. Sign in as an agent: Agents/Upload/Settings menus are hidden and the API refuses admin actions; other agents' clients cannot be opened.

### Automated backend tests (optional, for developers)
`tests/` runs the real `Code.gs` in Node.js against mocked Google services (Sheets, MailApp, Cache, Lock) and checks 78 acceptance rules, including the 50/50 and 34/33/33 splits, journey dates, extension, closure, escalation, reports, permissions and unsubscribe:
```bash
cd tests && node acceptance.js      # requires Node 18+
```
`tests/` is not used by the live app. You can leave it out of GitHub Pages if you prefer.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| "The API URL is not configured" | Paste the `/exec` Web App URL into `config.js` and redeploy the Pages site. |
| "Network error" / CORS error | The Web App must be deployed with *Who has access: Anyone*. Use the `/exec` URL, not `/dev`. After editing `Code.gs`, deploy a **new version**. |
| "Database sheet … is missing" | Run `setupSystem()` once from the Apps Script editor. |
| Welcome / report emails not arriving | Check the address is real; check **Settings → Email quota remaining**; check *Executions* in Apps Script for errors. |
| Setup link says expired | Admin → Agents → **Reset password** sends a fresh link. |
| Automation not running | Apps Script → **Triggers (⏰)**: `scheduler` (hourly) and `processEmailQueue` (10 min) must exist. Run `setupTriggers()` to recreate them. |
| Very large uploads are slow | Normal: rows are sent in batches of 150 (`UPLOAD_CHUNK`). Keep the tab open until the progress bar completes. |
| Sheet getting very large | After a few years, archive old `FollowUpTasks`/`ActivityLogs` rows (Completed/Cancelled) to a copy of the spreadsheet to keep the API fast. |
| Locked out after failed logins | Wait 15 minutes, or ask an admin to reset the password. |
| Wrong times | Apps Script project timezone must be Asia/Dubai (set in `appsscript.json`). |
