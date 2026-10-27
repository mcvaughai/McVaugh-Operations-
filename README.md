# McVaugh Operations World

A persistent, interactive isometric workspace for McVaugh Custom Homes: the human team, operating functions, tasks, proposed AI agents and the project neighborhood in one picture — backed by a real saved registry so it shows where Brittany stopped, what is complete, what is blocked, and the next small step.

Stage 1 + Stage 2 build. See `docs/ARCHITECTURE.md` for the architecture, store and reuse decisions, and what was (and was not) inspected.

## Run it (Windows, Mac or Linux)

Requires Node.js 22.13 or newer (`node -v`). No `npm install` needed.

```
node server/server.js
```
Open http://localhost:8787. On first run the server creates:

* `data/mcvaugh-world.sqlite` — the canonical store, seeded from the assessment handoff
* `data/credentials.json` — one passphrase per role (`admin`, `accounting`, `construction`, `design_sales`, `viewer`). Open it, give Brittany/Jim the admin one, and change the values whenever you like.

Optional environment variables:

| Variable | Purpose |
|---|---|
| `MOW_PORT` | Port (default 8787) |
| `MOW_DATA_DIR` | Where the sqlite file and credentials live (default `./data`) — point it at a backed-up drive |
| `MOW_N8N_SECRET` | Shared secret n8n must send in `X-MOW-Secret`; webhook refuses everything until set |
| `MOW_IMPORT_DIR` | Default folder for Option 3 bulk import (e.g. your Obsidian vault) |
| `MOW_OPSHUB_PATH` | Path of the old `mch-ops-hub.html`; when set, the file is rewritten from the world's data after every change |
| `MOW_PUBLIC_URL` | The address Teams links should point at (default `http://localhost:<port>`); set this before turning on the work-order approval workflow |
| `MOW_MCHDB_URL` | Page used for the read-only reachability check (default `http://db.mcvaugh.com/buildconnect/NewStuff/wotracking.html`) |

Windows example: `set MOW_DATA_DIR=L:\AI Tools Shared\mcvaugh-world-data && node server\server.js`

## What's in it

* **World** — isometric campus with ten labeled departments, people (colored, labeled *Person*), proposed agents (gray dashed until reviewed, labeled *Agent (proposed)*), and a neighborhood of job sites. Drag to pan, scroll to zoom, *Focus department…*, *Overview*. Click anything to open its records.
* **Start here, Brittany** — current step, last completed, one recommended next action, waiting on whom, decisions needed, mini Next/Working/Waiting/Done board, last checkpoint. *Save checkpoint* writes a new dated checkpoint; history is kept.
* **Review** — the Stage 2 queue (people show their org-chart title, absorbed legacy roles and the responsibility list from the old ops hub): unverified people, then PROPOSED tasks, one at a time, with duplicate suggestions and merge/reject/verify. Decisions are stamped and survive re-imports.
* **Handover** — succession view for a departing person (Maria): what only she does, documented vs in her head, who else can do it today, what to capture before she leaves, sorted no-backup first; her procedures with step-by-step reviews and flow charts; each active job's status; a generated next-meeting agenda.
* **Procedures** — old SOPs vs the procedures confirmed in meetings, paired by *supersedes*. **Needs work** lists what is missing from each one, worst first: no steps written down, owner leaving with nobody named, no owner, never confirmed in a meeting. **Paste a procedure** takes a ChatGPT skill exactly as written and files it; **Paste the running log** takes the per-vendor and per-job specifics.
* **Build** — Maria's "How to build a house" as 105 ordered steps from lot stake to the final city inspections, grouped into six phases, each with the responsible party (linked to its vendor record), the inspections to schedule, the hold points ("do not pour until…"), and the steps McVaugh does itself. Filter by *MCH does it*, *Inspections*, or *Needs a decision*. Logins that were typed into the source sheet are **not** stored: the step says a login is needed and names the system, and the original file is restricted.
* **Board / Registry** — everything editable without the 3D view; Registry includes Vendors by trade (from the SOW Excel) with each vendor's pricing basis and what a work order for them must contain.
* **Integrations** — each shown as disconnected / connected / failing; three import options (Obsidian `.md` from the browser, CSV from the browser, and **Option 3: bulk-import a folder on this computer** with a dry-run preview and skip-unchanged re-import); backup export/restore; handbook export for ChatGPT Pages.
* **Work orders** — *Create a work order* when you have an approved bid in hand. The agent fills in the fields from the bid and the vendor record, flags anything missing (a per-square-foot vendor with no square footage cannot be entered), and enters it only once a person confirms. The agent never starts one. Requesting and comparing bids is **parked** — see below.
* **Approvals** — when an agent drafts something that commits money, a bar appears above every view with the drafted fields and the question put to the human. Only accounting/admin can decide; the decision is recorded with who, when, how, and any note. The same request also goes out as a Teams message with a link to a one-page approve/reject form.
* **AI config** — per-agent purpose, needs-AI?, provider/model, why, cost, approval, eval examples, fallback.
* **History** — all activity events with their source tag (MANUAL / N8N / IMPORT / DEMO), checkpoint history, audit (admin).

Setup maturity: gray outline → under review (amber) → 1/3 documented → 2/3 automation built → verification pending (purple) → ✓ ready. Runtime: idle, running (animated with task label), waiting (amber), failed (red), paused, stale/disconnected (warning). People are never shown inactive; untouched workflows say "workflow not reviewed". *Reduce motion* and the OS setting stop animations.

**Demo mode** (top bar) generates simulated agent activity tagged DEMO; turning it off deletes every demo event. Real events are never mixed in.

## Backup and restore

Copy `data/mcvaugh-world.sqlite`, or Integrations → *Download full backup (JSON)* / *Restore backup*.

## Tests

```
npm test
```
Runs `test/acceptance.js`: spawns a server on a temp folder and checks persistence across restart, milestone → visual state, ready-but-idle vs running, n8n start/finish/duplicate/failure/stale handling, role restrictions, demo separation, Obsidian import provenance, export.

## n8n on the same machine (Stage 3)

1. `scripts\setup-n8n.cmd` once (installs n8n into `n8n-runtime\`, writes `data\n8n.env` with a shared secret, creates `C:\McVaugh\qb-exports`).
2. `scripts\start-all.cmd` every time (opens two windows: the world on 8787, n8n on 5678).
3. In http://localhost:5678 create the owner account, then *Workflows → Import from file*: `n8n\mow-heartbeat.json` and `n8n\mow-qb-export-watch.json`; switch both **Active**.
4. Open http://localhost:5678/webhook/mow-heartbeat — the Executive reporting agent should animate for 8 seconds in the world and the event shows up tagged N8N in History.
5. Drop a QuickBooks CSV export into `C:\McVaugh\qb-exports` (the folder in `MOW_QB_EXPORT_DIR`) — the app notices the file, hands it to n8n, and the Accounting reconciliation agent turns amber (*waiting for approval*) with the file name.

n8n 2.x needs **Node.js 24**; the setup script installs n8n 1.x instead if you have an older Node, but Node 24 is the better choice (the world runs on it too).

### Getting procedures in from ChatGPT

Writing a skill per process in ChatGPT is fine; leaving them only there is the problem, because a skill in someone's account is not something a successor inherits. Two paste boxes on the **Procedures** tab bring them across.

**Paste a procedure** — paste the skill exactly as ChatGPT has it. No reformatting. It reads the usual headings (*when to use*, *you'll need*, *steps*, *approval*, *notes*) in any of the shapes people write them: markdown headings, bold lines, ALL CAPS, or `Steps:`. With no headings at all, a run of numbered or bulleted lines becomes the steps. Anything it cannot place is kept as notes, and the original text is attached to the procedure word for word so the skill can be rebuilt from it. It links the vendors and jobs the text names. Pasting the same procedure again updates it rather than making a second copy, and it appears on the regenerated MCH ops page as a current process.

**Paste the running log** — the per-vendor and per-job specifics. A markdown table, a spreadsheet paste, or lines like `Johnston Waterproofing — standard pricing, no square footage`. Column names are matched loosely because the headings in a chat move around. A vendor-wide note also becomes that vendor's work-order instruction and marks them reviewed. Rows show on the vendor record and on the job, so the detail is where the work happens rather than in a chat thread. Re-pasting updates rows in place.

Rows naming a vendor or job that is not on file are kept and flagged, so nothing is silently dropped.

### The purchasing agent: work orders

A work order starts when **a person asks for one**. Nothing else starts one: the agent does not watch for incoming bids and does not decide a work order is due.

1. Someone with an approved bid in hand opens **Work orders → Create a work order** (or tells the agent in Teams, once the channel webhook is set).
2. The agent fills in the fields from the bid and the vendor record, and flags what is missing. A vendor priced per square foot cannot be entered without the square footage.
3. It shows exactly what will be entered and asks for a check. Over the budget line it goes to Jim.
4. On confirmation `n8n\mow-wo-approval.json` enters it in the database and reports the number back. Entering it is what emails the subcontractor to say it is approved.

Rejecting enters nothing and requires a reason, which the server enforces. Because confirmations go to the purchasing channel rather than a person, whoever confirms picks their name and it is recorded as self-declared; confirming inside the world is recorded as authenticated. A link Teams merely previews never decides: the buttons are a form POST.

Needs `TEAMS_WEBHOOK_URL` (purchasing channel) and `MOW_PUBLIC_URL` before the Teams half works. The app half works now.

### Requesting and comparing bids — parked

Parked on 2026-10-26. How a bid gets requested and compared varies too much between trades to automate before the process is written down: some line items go to one vendor, some to three, and what makes two bids comparable differs by trade.

Nothing was thrown away. The bid request and bid records, the "ask only once every bid is in" rule, the overdue chase and `n8n\mow-bid-requests.json` are all still here and still covered by the tests, which switch the flag on to exercise them. While parked the bid webhooks answer `410` and the sweep does not run.

To turn it back on, set `bid_flow` to `active` in the `meta` table. Do that after there is a written bid process and an agent of its own, not before.

To add your own workflow: add an HTTP Request node at the start and end of a workflow: `POST http://<host>:8787/api/webhooks/n8n`, header `X-MOW-Secret`, JSON body `{ "agent_id": "...", "execution_id": "{{$execution.id}}", "status": "started" }` then `"finished"` or `"failed"`. Set the agent's *n8n workflow id* in the app to route by `workflow_id` instead.
