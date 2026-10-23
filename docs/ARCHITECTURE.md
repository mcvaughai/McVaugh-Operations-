# McVaugh Operations World — architecture and reuse decision (Stage 1)

Date: 2026-10-06. Status: Stage 1 and Stage 2 delivered; decisions marked PROPOSED need Brittany's confirmation.

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

## 10. Stage 2 — import, reconcile, verify one at a time

* **Three import options.** (1) Obsidian notes from the browser, (2) CSV from the browser, (3) **folder bulk import**: `POST /api/import/folder {dir}` walks a folder on the server's filesystem (e.g. the vault on `L:`), imports every `.md`/`.csv`, and records each file's SHA-256 in `import_files`; a re-run skips files whose hash is unchanged and re-imports changed ones (`force` overrides). Admin/accounting only, because it reads the server's disk. Skips `.obsidian`, `.trash`, `.git`.
* **Preview before commit.** `POST /api/import/preview` (files or `dir`) runs the same parser as a dry run and reports, per file, which headings/columns mapped to which fields, which were unmapped, and warnings (unknown owner, unrecognized CSV layout, note with no headings). Nothing is written. Mapping tables (`heading_aliases`, `csv_aliases` in `meta`) can be extended from the UI once real files show their headings.
* **Provenance and idempotence.** Every imported record carries `source` = file name + date and an `import` event. Re-importing a note refreshes content fields but never undoes a review decision (`proposed`, `board`, owner/backup once set).
* **Review queue** (Review tab): people who are not yet verified, then tasks marked PROPOSED, one at a time. For a person: role summary, departments, tasks owned/backed up, imported responsibilities → *Verified* / *Under review* with a note, stamped `reviewed_at/by`. For a task: all stored fields, **possible duplicates** (token overlap on titles + same owner, ≥50%), → *Verify* (proposed=0), *Reject/archive* (leaves the board, history kept, `archived_count` shown), or **Merge** into an existing task (`POST /api/review/merge`: fills the target's empty fields, concatenates sources, archives the source, logs an event).
* **Document classification.** Brittany's vault listing (2026-10-06, ~40 files) showed that most notes are not procedures: leases and LLC papers for 59 N Kingwood, the employee handbook, chart of accounts, dashboards, the AI rollout plan, Python scripts, the org chart, and financial items (2026 cash flow, Amex review, loan payable, plan budgets). `classifyNote(name, content)` sorts each file into `procedure | org_chart | reference | dashboard | plan | legal | script | financial | other` by file-name rules, then by content headings. **Only `procedure` becomes a task**; every file is also stored in `documents` (title, kind, reason, summary, linked task). Financial files are flagged `sensitive` and redacted for non-accounting roles. Version pairs ("X" / "X (2)" / "X (8.17.22)") are flagged so Brittany decides which is current. The preview lets her override any file's kind before import; the Documents table lets her change it afterwards.
* **Index cards and linked files.** Four real notes from the vault (2026-10-06) showed the vault is an *index*: each note is a generated card (`type: document`, `source: localserver`) with a one-line "Why it matters", a link to the real file under `../_Inbox/_LocalServer/…` (PDF, .docx, .doc, .html), topic hubs and entities — no procedure text. `parseIndexCard` recognises the format; the folder import follows the link relative to the note and extracts text from `.docx` (built-in zip + XML strip, no dependencies), `.html`, `.md/.txt/.csv`. `.doc`, `.pdf`, `.xlsx` are stored as **needs conversion** (save as .docx/.html and re-run with *force*); a link that does not resolve is **not found** (the local-server folder must be reachable at the same relative path from the vault). A procedure card becomes a task only with extracted steps (`documented = 1`); otherwise the task is created with `missing_info` saying where the content lives. Hubs map to departments via `hub_departments` (editable); the near-universal "Construction Financials & Budget vs Actual" hub is treated as generic.
* **Old ops hub = the old dashboard.** `mch-ops-hub.jsx` (supplied 2026-10-06) holds the old people/responsibilities dashboard's data as JS constants: `INITIAL_PROCESSES` (21 SOPs with steps, owners and participants expressed as legacy roles — DOC, DOP, CFO, Superintendent, CA…; most dated 2004–2006, some 2022), `INITIAL_ROLES` (16 legacy role definitions) and `CURRENT_TEAM` (the 8 current people, each with the legacy roles they *absorbed* and a responsibility list). `parseOpsHub` evaluates the constants in an isolated `node:vm` context (no require, no globals, 2 s timeout); `importOpsHub` turns SOPs into PROPOSED tasks owned by whoever absorbed the legacy owner (unassigned legacy owners are reported), writes participants as "legacy role → current person", keeps each legacy role as an `org_chart` document, and stores responsibilities and absorbed roles on each person. The data is checked in as `seed/mch-ops-hub.json` and applied once per database; a newer `.jsx` can be re-imported from Integrations without undoing review decisions.
* **Procedures for the MCH Database (.doc).** LibreOffice could not open the Word 97 file in the build sandbox, so the text (246 words; screenshots omitted) was recovered by scanning the binary and is checked in as `seed/procedures-for-the-mch-database.txt`, seeded as a task owned by Maria (author) with evidence/approval rules drawn from the text.
* **Keyed data updates.** Facts Brittany supplies in conversation are applied once per database via `seed.js` `UPDATES` (tracked in `meta.applied_updates`), so a fresh database on her machine gets them too. First entry: the 12 active jobs (10 waiting for permits on Royal Oaks Run Dr / Royal Oaks Banner Way, 2 Royal Parkside Place in progress) from her loan-tracking screen on 2026-10-06; loan and bank figures were deliberately not stored.

## 11. Stage 3 — n8n on the same machine, one real workflow

* **Install.** `scripts\setup-n8n.cmd` (Windows) / `scripts/setup-n8n.sh` installs n8n into `./n8n-runtime` (local, not global), writes `data/n8n.env` with a fresh `MOW_N8N_SECRET`, `MOW_URL`, n8n port and flags, and creates `C:\McVaugh\qb-exports`. n8n 2.x requires Node 24; on Node 22/23 the script installs n8n 1.x (same workflow format). `scripts\start-all.cmd` starts both servers with that env file; the app also reads `data/n8n.env` itself, so the secret is never typed into a browser or committed (`data/` is git-ignored).
* **Workflows** (`n8n/*.json`, import via n8n → Workflows → Import from file, then switch Active):
  * `mow-heartbeat.json` — hourly schedule **and** a manual trigger at `GET http://localhost:5678/webhook/mow-heartbeat`. Posts `started` → waits 8 s → posts `finished` for `agent-exec-reporting`, labeled "n8n heartbeat (connection check)". It proves the real path n8n → app → world animation without inventing company activity.
  * `mow-qb-export-watch.json` — webhook-triggered (`POST /webhook/mow-qb-export`). n8n 2.x no longer ships the Local File Trigger node, so the **app** watches `MOW_QB_EXPORT_DIR` with `fs.watch` (debounced 2.5 s, deduplicated by name+size+mtime, logged as a *system* event) and calls that webhook with the file name. When a QuickBooks CSV lands in the folder (a real act by Brittany/Kenneth), n8n posts `started` then `waiting_approval` on `agent-reconciliation`, so the Accounting agent turns amber: "Reconciliation input ready — run mch-ap-reconciliation and record the result". The actual reconciliation still runs through the existing skill; recording the result is a manual *Finish* on the agent card (labeled Manual) until the skill's output is posted back automatically. Both workflow files carry fixed ids so re-importing updates rather than duplicates.
* **Verified in the build sandbox (2026-10-20)** with n8n 2.43.8 on Node 24: `GET /webhook/mow-heartbeat` → agent *running* (animated, N8N tag) → *finished* 8 s later; a CSV dropped in the watched folder → reconciliation agent *waiting for approval* with the file name. n8n 2.x requires Node 24; n8n 1.x could not be installed here because one of its dependencies is served from a host the sandbox proxy blocks.
* **Health.** Integrations → *Check connections* probes `MOW_N8N_URL` (`/healthz`), reports whether the secret is set and when the last authenticated event arrived; n8n down with past events = *failing*.
* **Not assumed:** connectors for QuickBooks Desktop or the McVaugh database inside n8n. Both need credentials that do not exist yet; the folder watcher is deliberately the first step because it needs none.

## 12. Succession pass for Maria (2026-10-20)

Inputs: the updated hub (`mch-ops-hub.html`, 2026-10-20), a transcript of Jim on the work-order process (call 2026-10-12, pasted), and the Teams transcript of Brittany's 1h12m meeting with Maria (2026-10-16, villas part). Everything derived from them lives in `seed/succession-2026-10-20.js` with a citation per claim (`[M mm:ss]`, `[J 10/12]`, `[HUB 10/20]`); inferences are labeled.

* **Hub refresh.** `parseOpsHub` now reads the built `.html` (data in a `<script type="text/babel">`; React stubbed in the VM). Diff vs 10/06: +4 SOPs (Lowes/Home Depot bill, accounting weekly/monthly/quarterly-yearly), 0 removed, 0 edited; Maria +58/−29 responsibilities of which 20 are her own `[N/A]` cross-offs (stored separately as `people.crossed_off`, shown struck through); James +13 (purchasing/bids, backcharges, permitting coordination); Ernesto's list replaced by a formal purchasing-manager job description (+28/−40); Brittany +50 and Kenneth +25 accounting cadences. Review decisions on existing tasks were kept (verified by test).
* **Meetings as documents** (`documents.kind = 'meeting'`, `meeting_date`, `attendees`, `source`, `cite_key`, full text). Future transcripts: same shape, same keyed-update pattern.
* **Step reviews** (`tasks.step_review`): per old SOP step → verdict `match | changed | no_longer | not_mentioned | new` → what was said → citation. 12 SOPs plus the warranty and HOA placeholders. `verification_result` summarizes; `missing_info` lists the not-mentioned steps so the Review queue shows them. `verified` stays 0: a step is current only when a transcript confirms it.
* **13 procedures confirmed from the meetings** that had no SOP (`tr-*` tasks: Leander ARC review, permit per address, per-sq-ft pricing, material POs, field verification and draws, scheduling and trade calls, vendor onboarding/insurance, walkthroughs, CBUSA, Landing/Frank, selections vendors, single-point WO approval, database budget enforcement).
* **Flow charts** (`tasks.flow`, rendered client-side as SVG): work order bid→payment, budget check/variance (Jim's rules), permit per address, foundation sequence, warranty request, Leander review. Overlays: GAP (unowned / in Maria's head), agent (rules-sufficient checks: budget exception, permit/lead-time reminders, DB-vs-QB reconciliation), human authority (Jim approvals, spending, physical acceptance, HOA decision).
* **Handover view** (`GET /api/handover?person=maria`, Handover tab): 20 items from her SOPs, hub responsibilities, legacy roles, active jobs and the transcripts; each with documented?, current?, backup, risk, capture-before-she-leaves, citation; sorted no-backup first then by risk; status editable (open/captured/reassigned/dropped).
* **Job status** on homes (`permits`, `trades`, `issues`, `next_milestone`, `status_cite`): 11603 and 11602 Royal Parkside from the transcript; the ten Royal Oaks Run/Banner Way lots carry the villas note (15 lots left, 7 permitted or near; which seven is unconfirmed).
* **Each handover item explains itself** (`why`: what process exists, what is missing from it) and links to its procedures (`task_ids`) and documents (`doc_ids`). The side panel shows trigger, numbered steps, the gaps taken from the flow chart, the chart (with a full-size view) and the step review, plus document cards. Documents Maria referred to but that are not in hand (walkthrough checklist, SOW Excel, permit doc, 11603 schedule, insurance spreadsheet, warranty procedure, Frank scope, vendor/rate list) exist as *not attached* placeholders; `POST /api/documents/upload` stores the real file under `data/uploads/` (git-ignored), extracts text from .docx/.html/.md/.txt/.csv, and `GET /files/<id>` serves it to signed-in roles (restricted documents stay restricted).
* **Agenda** (`GET /api/handover/agenda`): generated from no-backup items and not-mentioned steps, phrased as direct handover questions, plus the per-job status check and the list of documents Maria said she would leave.

* **Meeting 3 (2026-10-20 call, `seed/meeting-2026-10-20.js`)**: a later meeting's finding on the same SOP step replaces the earlier verdict (merge by step number); new facts: plan types per address (11602 3A almost complete, 11603 4A and 11607 3A are the two starts, 11606 plan 4, 11611 4A custom, old model 11603 Royal Plain), Landing = Frank's company as GC with MCH supervising (permits, inspections, surveys, energy), change orders outside the database for ~10 years (priced by Maria, paid, then a .1/.2 WO), no budget revision log (dated budget increases with a reason are the log), the inspection binder per job, Maria's last day before Nov 9.
* **Supersedes** (`tasks.supersedes`, JSON): a confirmed `tr-` procedure lists the old `hub-`/`proc-` procedures it replaces or absorbs; the task panel shows both directions. The **Procedures** tab filters New / Old / Both; *Both* pairs them side by side and lists old SOPs with no confirmed replacement (still the only description of that process).

* **SOW Excel → vendors.** `SOW_subs_pricing_contractor_info.xlsx` (2026-10-21) is the vendor/rate list Maria promised, now with the contact columns. A dependency-free `.xlsx` reader (`xlsxSheets`, zip + sharedStrings) turns the Purchasing sheet (trade, sub type, documents to provide, current $/sf, lead-time notes) and the Construction sheet (trade, current vendor, contacts, who to call for bidding vs field) into the `vendors` table (45 trades). Contacts and rates are restricted to accounting/admin; the file itself is stored as a restricted document. Appears in Registry → Vendors, on the Purchasing building and on the handover items.
* **"How to build a house" → the build sequence.** Maria's workbook (2026-10-22) is the only written answer to *what order does a McVaugh house get built in*, so it is imported as **ordered rows, not one blob of text**: `parseBuildSequence` / `importBuildSequence` fill a `build_steps` table with, per row, the sequence number, the phase, the description, the responsible party, the matched `vendor_id`, whether McVaugh itself performs it (`is_mch`), whether it is a city or third-party inspection, and Maria's notes. 105 steps, 3 hold/notify rows, six phases.
  * **Rows with no responsible party are not steps.** Maria wrote three in capitals — "DO NOT POUR UNTIL EVERYTHING ABOVE IS COMPLETE", "NOTIFY ACCOUNTING OF POUR DATE", "NOTIFY TERESA". They keep their place in the order and render as hold/notify banners, so a successor cannot read past them.
  * **Responsible parties are matched to the SOW vendor records** by token overlap (≥ 0.5) against vendor name and trade: 88 of 105 steps link to a vendor card. The ones that do not are a finding, not a bug — two steps have no contractor chosen yet ("?????? Working on contractor"), and two parties (Forja, Manuel Garcia) are not on the SOW at all.
  * **Logins are never stored.** Five rows had live portal usernames and passwords typed into the notes column (Reliant, CenterPoint builder portal, the Houston iPermits site). `redactCredentials` strips them at import from both the step notes and the extracted document text, leaving a pointer that names the *system* only. The original workbook still contains them, so the document itself is marked `sensitive` and `GET /files/doc-how-to-build-a-house` returns 403 to non-accounting roles — while the redacted build steps stay open to everyone, including the construction role that needs them. An acceptance test asserts each password string is absent from the whole store. The finding is raised as its own handover item (`ho-portal-logins`): the accounts are in Maria's name and CenterPoint's two-factor is tied to her email and phone.
  * **What it changes for the succession.** The 14 steps McVaugh performs itself become `ho-builder-own-steps` (high risk, no backup): they are the steps with no subcontractor to fall back on, and the sheet does not say who does them after Maria. The schedule handover item moves from *not documented* to *partly: build order 10/22, no durations* — the order now exists in writing, but how long each step takes is still only in her head. The agenda generator adds a section built from the data: who takes each MCH step, which logins to re-register, which two steps still need a contractor, and whether the order holds for the Landing and Royal Oaks Run or only the Villas.
  * **Build view.** Phases as a vertical timeline, each step a card with badges (MCH does this / city inspection / third-party inspection / login needed / no contractor chosen / not in the vendor list), vendor names linking to the vendor card, and filters for *MCH does it*, *Inspections* and *Needs a decision*.
* **Work orders from an approved bid.** Brittany's ChatGPT skill (2026-10-21) drafts the work-order fields from a subcontractor's approved bid. It is recorded as `tr-wo-entry-from-bid` (documented and automated, but **not** verified: it superseded `hub-new_work_order` and is proven for one vendor only). Each vendor now carries a `pricing_basis` derived from the SOW rate column (`$7.50/SF` → per square foot, a flat dollar amount → fixed, blank → per bid), plus `wo_instructions` and a `wo_review` state. **Johnston Waterproofing alone is `reusable`** — its pricing is standard. Every other vendor is `needs_review`, because a per-square-foot vendor's work order has to carry the trade's square footage and that differs by trade (framer = total covered area, sheetrock excludes balconies, trim = air-conditioned area). The AI-config row records that the skill drafts and a human enters every work order.
* **The purchasing agent's approval loop.** Brittany asked for the work-order skill to become an agent job: when a bid arrives from a subcontractor the agent enters the work order and asks a human in Teams to verify and approve it. It is built as **draft → ask → release**, not enter → ask, and that difference is the point. Entering a work order in the MCH database is what emails the subcontractor, and the sub accepting it is the price being agreed, so approving afterwards would come after the commitment, not before it. The agent therefore drafts, asks the exact question Brittany wrote, and the approval is what releases it. Recorded as an open decision (`dec-wo-agent-draft-first`) with the question it depends on: **can the database hold a work order without notifying the sub?** If it cannot, the agent stops at a prepared work order and a human does the final entry. The task carries that as a blocker rather than the build assuming an answer.
  * **`approvals` table.** One row per thing an agent wants a human to decide: the subject, the drafted fields, the evidence it came from, the exact question, who it was routed to, the channel, a single-use token, and then the decision — status, who, when, how (`app` / `teams-link`), and the note. `released` stays 0 until somebody approves, so "was this ever actually sent" is a column, not an inference.
  * **`POST /api/webhooks/approval`** (shared secret, same as the n8n events) creates the request, turns the purchasing agent amber with `waiting_approval`, and returns one link. Retried n8n executions deduplicate on `external_id`, so a retry never asks twice.
  * **A link preview must not approve anything.** Teams and Outlook fetch URLs to build previews, so `GET /approve/<id>` only renders the decision page even when the URL carries `&d=approve`; the buttons are a form POST. The token is server-side only and is stripped from `/api/state`, so the browser never holds something that could decide on its own.
  * **Deciding in the app.** `POST /api/approvals/<id>/{approve,reject,cancel}` is restricted to accounting/admin (`can.sensitive`), audited, and refuses a second decision with 409. The state payload carries `can_decide` so other roles see what is held up without being offered a button they cannot use. The approval bar sits above every view, because something waiting on a person is not a thing to go looking for in a tab.
  * **Honest status.** The agent ships `enabled: 0` with `setup_stage: documented`, the task's `automated` flag goes back to 0, and the Teams integration row is `disconnected` until `TEAMS_WEBHOOK_URL` and `MOW_PUBLIC_URL` are set. The drafting step is proven by hand for one vendor; the loop has not been run against a real bid, and nothing in the UI claims otherwise.
* **Ops hub kept in step.** `regenerateOpsHub` rebuilds `mch-ops-hub.html` from the hub's own UI (`seed/mch-ops-hub.template.html`) with its data constants replaced from the world: old SOPs (steps refreshed from the task, `status: legacy|superseded`, `supersededBy`), the confirmed `tr-` procedures as `Current (confirmed)` processes with `supersedes`, and each person's current responsibilities plus `[N/A]` cross-offs. `GET /api/export/opshub` downloads it; with `MOW_OPSHUB_PATH` set the file is rewritten 3 s after any task/person change. The regenerated file re-imports cleanly (tested), so the two never diverge.

## 13. Known limits after the succession pass

* No `.xlsx` parsing (CSV only). No live MCH DB data pulls (reachability only). No Pages sync.
* Duplicate detection is title-based; it will miss procedures described with different words and will suggest false matches on generic titles — it only suggests, never merges on its own.
* Only the villas were covered on 2026-10-16; Landing, the townhomes, custom homes, the TA/HOA work and warranty details are planned for the next meeting. "Frank" at Landing is unidentified. Which seven villa lots are permitted is unknown.
* The hub's SOPs are 2004–2022 vintage and written for roles that no longer exist as such; every one is PROPOSED with a note saying so. Responsibility lists on people are the hub's claims, not verified facts, until Brittany marks the person Verified.

* The world is a 2D-SVG isometric scene, not WebGL; it is deliberately light so it runs anywhere.
* No `.xlsx` parsing (CSV only). No live MCH DB data pulls (reachability only). No Pages sync.
* The job list in the neighborhood is a snapshot copied from the skill's JOB_MAP (71 entries incl. lots, HOA entities, offices); which 13 are active is for Brittany to mark.
