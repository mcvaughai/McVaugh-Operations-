# McVaugh Operations World — architecture and reuse decision (Stage 1)

Date: 2026-10-06. Status: Stage 1 delivered; decisions marked PROPOSED need Brittany's confirmation.

## 1. What was inspected before building

| Source | Result |
|---|---|
| `C:\Users\bmcvaugh\Documents`, `L:\AI Tools Shared`, `C:\Users\bmcvaugh\Documents\MCH-DB` | **Not accessible** from this cloud build environment. Nothing was inspected. Nothing is claimed about their contents. |
| Obsidian notes, old people/responsibilities dashboard, BuildConnect 2.0 | **Not accessible / not located** in this environment. Not inspected. |
| `McVaugh_Operations_Assessment_and_Pages_Handoff.md` (supplied) | Read in full. Confirmed facts, proposed procedures and decisions were seeded from it, each labeled. |
| Company skills `mch-budget-vs-actual` and `mch-ap-reconciliation` (installed in the Claude Team workspace) | Read in full. They document the live database pages (`db.mcvaugh.com/buildconnect/NewStuff/wotracking.html`, `potracking.html`, `budgetform.html`), a Job ID map, and deterministic budget/reconciliation logic. |
| GitHub repo `mcvaughai/mcvaugh-operations-` | Empty (no commits) before this build. No competing version exists. |

Conclusion: there was no existing application to extend, so Stage 1 is a new build. The two existing skills are the only reusable logic found; see §4.

## 2. Architecture

```
Browser (public/)                    Node 22 server (server/)                 Files (data/)
┌───────────────────────┐   HTTP    ┌──────────────────────────────┐        ┌────────────────────────┐
│ index.html / app.js   │ ───────▶ │ server.js  routing, roles,    │ ─────▶ │ mcvaugh-world.sqlite   │ canonical store
│ world.js (SVG iso)    │ ◀─────── │            demo mode, checks  │        │ credentials.json       │ role passphrases
│ styles.css            │          │ db.js      schema, upsert,    │        └────────────────────────┘
└───────────────────────┘          │            export/import       │
        ▲                          │ seed.js    handoff facts       │   ◀── POST /api/webhooks/n8n  (n8n callbacks)
   no credentials,                 │ imports.js Obsidian/CSV/Pages  │   ◀── snapshot imports (md/csv)
   no model calls                  └──────────────────────────────┘   ──▶ read-only reachability check of db.mcvaugh.com
```

* **Zero npm dependencies.** Node's built-in `node:sqlite`, `http`, `fetch`. Runs on the Windows machine with `node server/server.js`. No build step, no CDN (the build environment blocks CDNs anyway, which proves the app works offline).
* **Visual world** is plain SVG drawn from server state. Nothing in the renderer invents activity: a token animates only when the latest *run* event for that entity has `status = started` and is younger than 30 minutes.
* **Two independent dimensions** are stored and drawn separately: setup maturity (`setup_stage` / `review_status` / task `documented|automated|verified`) and runtime activity (derived from the `events` table).

## 3. Canonical persistent store — PROPOSED decision

**Choice:** one SQLite file, `data/mcvaugh-world.sqlite` (WAL mode), holding: task registry, people, agents, departments, homes, setup progress, decisions, checkpoints, activity events, integrations, AI configuration, audit log, sessions.

Why: a single file is the easiest thing for Brittany to back up and restore; no database server to maintain; `node:sqlite` needs no install. Operational systems (McVaugh database, QuickBooks) remain authoritative for their own transactions — this store never holds financial records, only links, statuses and evidence pointers.

**Recovery / export:**
1. Copy `data/mcvaugh-world.sqlite` (and `-wal`/`-shm` if present) — full backup.
2. `GET /api/export` (admin/accounting) downloads a JSON dump of every table; `POST /api/import/backup` (admin) restores it. The format is tagged `mcvaugh-operations-world/1`.
3. `GET /api/export/pages` produces the Markdown handbook for ChatGPT Pages.

Set `MOW_DATA_DIR` to put the data folder on a backed-up drive (e.g. `L:\AI Tools Shared\mcvaugh-world-data`). `data/` is git-ignored: the registry contains names and restricted notes and must not be pushed.

## 4. Reuse decision — PROPOSED

* **Budget exceptions** and **Accounting reconciliation** agents should wrap the deterministic logic already written in `mch-budget-vs-actual` and `mch-ap-reconciliation` (job-id lookup, WO/PO page parsing, QuickBooks CSV parsing, four-bucket matching). No model is involved in those comparisons. These skills currently run inside Claude with a logged-in Chrome session; moving them to n8n or a scheduled script requires a server-side credential for `db.mcvaugh.com` that does not exist yet.
* **Not reused:** BuildConnect 2.0 (unused, unverified prototype; not available here) and the old dashboard (not available). Both can be imported as snapshots when Brittany has them (Integrations → Import).

## 5. Agents: where ordinary rules are sufficient

Of the 14 proposed functions, 7 are marked `rules` (no model), 3 `ai`, 3 `hybrid`, 1 `undecided`; see the Registry → Agents table and the AI config view. The rule of thumb applied: arithmetic, matching, deadlines, reminders and status changes are code; reading unstructured documents (bids, supplier PDFs) and drafting prose are model tasks, always human-verified. Every agent starts read/flag/draft only; spending, payments, contracts, pricing and construction acceptance stay human (handoff §06, decision `dec-agents-readonly`).

## 6. Integration layer

| Integration | Kind | Stage 1 state | How it updates the world |
|---|---|---|---|
| Manual verified updates | manual | connected | Any write in the app; events labeled **Manual** with the role that made them. |
| Obsidian Markdown | snapshot | disconnected until first import | Drop `.md` files; headings map to task fields; `source` = file name + date. |
| Old dashboard | snapshot | disconnected | CSV import (`person, responsibility, department`). |
| Excel schedule / selections | snapshot | disconnected | Save as CSV, import. (`.xlsx` parsing without dependencies was not worth the risk; CSV keeps the import honest and simple.) |
| McVaugh database | live (read-only) | disconnected | Server checks reachability only; a 200 with the expected page marks it connected. Data pulls need a login that is not configured. Home cards link straight to the live budget/WO pages. |
| QuickBooks reports | snapshot | disconnected | CSV exports only; no API. |
| n8n events | callback | disconnected until `MOW_N8N_SECRET` is set and a first authenticated event arrives | See §7. |
| ChatGPT Pages | manual | disconnected | No supported read/write API was verified. Export → paste; "Mark pasted" logs it. |

A snapshot import is never shown as a live connection; the status dot and the `kind` chip are separate.

## 7. n8n as the workflow execution layer — evaluation

Fit: good. n8n has an HTTP Request node and per-execution ids, which is what this app needs. The agent posts to `POST /api/webhooks/n8n` with header `X-MOW-Secret: <MOW_N8N_SECRET>` and body:

```json
{ "agent_id": "agent-reconciliation", "execution_id": "{{$execution.id}}", "status": "started|finished|failed|waiting_approval", "label": "Reconcile 11611 Royal Parkside", "ts": "optional ISO time" }
```
or `workflow_id` instead of `agent_id` when the agent's `n8n_workflow_id` field is set.

* **Duplicates:** unique `(source, execution_id:status)`; repeats return `deduplicated: true` and change nothing.
* **Failures:** retained as events; the agent shows red until a later successful run.
* **Interrupted runs:** a `started` with no `finished` after 30 minutes shows **Stale** with a warning badge; the token stops animating.
* **Bad secret:** rejected with 401 and the n8n integration flips to *failing* so the problem is visible.
* **Not assumed:** that n8n has working connectors for QuickBooks Desktop or the McVaugh database. Those need a credential and a script node; Stage 3 work.

## 8. Permissions

Roles: `admin`, `accounting`, `construction`, `design_sales`, `viewer`. Passphrases live in `data/credentials.json` on the server (generated on first run; edit freely). Sessions are HttpOnly cookies. Enforced server-side:

* Tasks flagged `sensitive` (cash/accounting) are returned redacted to non-accounting roles and cannot be edited by them.
* Integration config and the database path are admin-only; audit log is admin-only; full export is admin/accounting.
* `viewer` is read-only. Every write and login is recorded in `audit`.
* No credentials in browser code or in the Pages export. n8n and MCH DB secrets come from environment variables.

## 9. AI model choice

`config/models.json` lists candidate model ids with the date and method of verification; the app never hard-codes one. The AI config table records purpose, provider/model, why, expected cost, approval rule, eval examples and fallback per agent. Existing ChatGPT Business / Claude Team seats do not cover API calls; nothing in this app purchases anything or calls a model.

## 10. Known limits of Stage 1

* The world is a 2D-SVG isometric scene, not WebGL; it is deliberately light so it runs anywhere.
* No `.xlsx` parsing (CSV only). No live MCH DB data pulls (reachability only). No Pages sync.
* The job list in the neighborhood is a snapshot copied from the skill's JOB_MAP (71 entries incl. lots, HOA entities, offices); which 13 are active is for Brittany to mark.
