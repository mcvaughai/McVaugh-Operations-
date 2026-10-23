# Month-End Close Checklist — McVaugh

Status: **PROPOSED**. The task list is drawn from McVaugh's own documented processes
(`seed/mch-ops-hub.json` → `accounting_weekly`, `accounting_monthly`,
`accounting_quarterly_yearly`) and the assessment handoff. The **day assignments,
dependency levels and the critical path are proposed** and need Brittany's and Kenneth's
confirmation before the first close is run against them. Nothing here changes a
procedure; it sequences the ones already written down.

> This checklist assists with close management. It is not financial advice, and it is
> not a substitute for review by the Controller/CFO and the company's CPA.

---

## 1. Scope

| | |
|---|---|
| **System of record** | QuickBooks Desktop Enterprise (multi-company) |
| **Operational record** | MCH database (`db.mcvaugh.com/buildconnect/NewStuff/`) — work orders, purchase orders, budgets, paid status |
| **Entities closed** | MCH (McVaugh Custom Homes), TA (Royal Oaks Courtside Villas TA), OA (Royal Oaks Landing OA), RROPOA, MVID, and the BBj/Banyan Tree activity |
| **Target duration** | 5 business days (T+1 … T+5). See §7 for what a 3-day close would require. |

### Owners

| Code | Who | Scope in the close |
|---|---|---|
| **CFO** | Brittany | Owns the close. Budget/QB updates, reconciliations, cash report, Builders Risk, HOA billing. |
| **KEN** | Kenneth | Bank access, wires, transfers, check-run approval, HOA attorney, CPA liaison. |
| **AA** | Accounting Assistant | AMEX, payables, deposits, DB↔QB import, actual-to-budget reports. |
| **ADM** | Teresa | Incoming checks, deposit slips, filing. |
| **PUR** | Purchasing (Maria → successor) | WO/PO entry and completion marking in the database. **Succession risk — see §8.** |
| **EXEC** | Jim | Check-run approval, cash decisions, review of results. |
| **EXT** | External | Carol Hocks (BCH) — Builders Risk; CPA; Title companies; Built.com/bank for draws. |

---

## 2. Close calendar at a glance

| Day | Theme | Lead |
|---|---|---|
| **T-3 … T-1** | Cut-off, reminders, pre-reconcile, DB/QB match pass | CFO, AA |
| **T+1** | Get everything *in*: cards, payables, deposits, draws, DB→QB import, utilities | AA, ADM |
| **T+2** | Match everything: bank recs, AP/WO/PO reconciliation, HOA water billing, intercompany | CFO, AA |
| **T+3** | Balance-sheet recs, job-cost review, preliminary trial balance, first variance pass | CFO |
| **T+4** | Job value / Builders Risk, cash report, draft statements, management review | CFO, KEN, EXEC |
| **T+5** | Final adjustments, hard close, period lock, distribution, retrospective | CFO, KEN |
| **18th** | **MVID Sales & Use Tax report — hard external deadline, not movable** | CFO |

---

## 3. The checklist

Each task carries an ID (used in the status board, §5), an owner, and the IDs it
depends on. `—` means no dependency: it can start as soon as the day opens.

### Pre-close — T-3 to T-1 (last three business days of the month)

| ID | Task | Owner | Entity | Depends on |
|---|---|---|---|---|
| PC-1 | Send the close calendar and deadlines to everyone who feeds the close (purchasing, admin, Jim) | CFO | All | — |
| PC-2 | Confirm cut-off with purchasing: every WO/PO for work completed this month is entered and marked complete in the database | CFO + PUR | MCH | PC-1 |
| PC-3 | Confirm the Friday check run and auto-pay schedule against the month-end date; flag any run that straddles the cut-off | AA | All | — |
| PC-4 | Verify sub-systems are healthy: database reachable, QB company files open, DB→QB import running | AA | All | — |
| PC-5 | Preliminary bank reconciliation — everything except the last day's activity | CFO | All | PC-4 |
| PC-6 | Review open POs and uncompleted WOs for accrual candidates (received-not-invoiced) | CFO + PUR | MCH | PC-2 |
| PC-7 | Collect known unusual items: lot closings, settlement statements, new loans, insurance events | CFO | All | — |
| PC-8 | Confirm which draws (Built.com and the supplemental-form jobs, e.g. 59NKW, 11419 St Germain) will land before month-end | CFO | MCH | — |

### T+1 — Capture

Goal: every transaction that belongs to the month is **in QuickBooks** by end of day.

| ID | Task | Owner | Entity | Depends on |
|---|---|---|---|---|
| D1-1 | Run the final DB→QB work order / purchase order import; run the manual import for anything that did not carry | AA | MCH | PC-2 |
| D1-2 | Enter straight invoices (bills that never existed in the database) directly in QB | AA | MCH | — |
| D1-3 | Process general payables through month-end | AA | All | D1-1, D1-2 |
| D1-4 | Process the AMEX bill; file receipts in the statement-date folder | AA | All | — |
| D1-5 | Book and pay utilities and auto-pays for the month (Gainsborough Waste, Yellowstone, Kankels/59NKW, Houston Seal Patrol, insurance auto-pays) | AA | All | — |
| D1-6 | Sweep every bank account for wires and unbooked auto-pays; book anything missing in QB | AA + KEN | All | — |
| D1-7 | Record incoming checks: copy, deposit slip, deposit, book in QB, file to the month's Checks Received folder | ADM + AA | All | — |
| D1-8 | Book received draws in QB and mark them received in the database | CFO | MCH | PC-8 |
| D1-9 | Post payroll and the payroll accrual if the pay period straddles month-end | CFO | All | — |
| D1-10 | Post intercompany transactions (MCH ↔ TA ↔ OA ↔ RROPOA) on both sides | CFO | All | — |
| D1-11 | Run fixed-asset depreciation | CFO | All | — |
| D1-12 | Post prepaid expense amortization (insurance, prepaid fees) | CFO | All | — |
| D1-13 | Record the Banyan Tree payment from BBj and update the reconciliation | CFO | BBj | — |

**End of T+1 gate:** no un-imported WOs/POs, no unbooked bank activity, no unposted deposits.
If any of these are open, T+2 reconciliations will produce false exceptions — fix before moving on.

### T+2 — Match

Goal: every subledger ties to the GL, and the database agrees with QuickBooks.

| ID | Task | Owner | Entity | Depends on |
|---|---|---|---|---|
| D2-1 | Bank reconciliations — all accounts, final statements | CFO | All | D1-3 … D1-8, PC-5 |
| D2-2 | **AP / WO / PO reconciliation per active job** — four buckets: matched; paid in DB not QB; paid in QB not DB; present in only one system (use the `mch-ap-reconciliation` procedure) | CFO + AA | MCH | D1-1, D1-3 |
| D2-3 | Correct the losing side of each exception from D2-2 (QB entry or database paid-status/date) | AA | MCH | D2-2 |
| D2-4 | AR reconciliation: homeowner/HOA balances, title-company receivables | CFO | TA, OA, RROPOA | D1-7 |
| D2-5 | Bill TA/OA water | CFO | TA, OA | D2-4 |
| D2-6 | Issue late fees and re-send past-due notices (RROPOA, OA, TA) | CFO | TA, OA, RROPOA | D2-5 |
| D2-7 | Prepare title-company invoices for any TA/OA sale that closed in the month | CFO | TA, OA | PC-7 |
| D2-8 | Post remaining accrual entries from the PC-6 received-not-invoiced review | CFO | MCH | PC-6, D2-2 |
| D2-9 | Intercompany reconciliation — confirm both sides agree before anything is eliminated | CFO | All | D1-10 |
| D2-10 | Begin balance-sheet account reconciliations | CFO | All | D2-1 |

### T+3 — Reconcile and look

| ID | Task | Owner | Entity | Depends on |
|---|---|---|---|---|
| D3-1 | Complete all balance-sheet reconciliations | CFO | All | D2-10 |
| D3-2 | Post adjusting entries found during reconciliation | CFO | All | D3-1 |
| D3-3 | Transfer designated reserve money from budget to the reserve account at Prosperity; record the TA checking→savings transfer in QB | KEN + CFO | TA | D2-1 |
| D3-4 | Update the loan tracking / debt schedule for the month's draws and payments | CFO | MCH | D1-8 |
| D3-5 | Run the preliminary trial balance for each company | CFO | All | D3-2 |
| D3-6 | Run the **P/L by Job** report; process actual-to-budget into Excel | AA | MCH | D3-5 |
| D3-7 | First variance pass per active job — budget vs. actual, flag cost codes over budget and any job with actuals but no budget (use the `mch-budget-vs-actual` procedure) | CFO + PUR | MCH | D3-6 |
| D3-8 | Investigate and resolve material job variances with purchasing before they reach Jim | CFO + PUR | MCH | D3-7 |

### T+4 — Report

| ID | Task | Owner | Entity | Depends on |
|---|---|---|---|---|
| D4-1 | **Builders Risk:** copy last month's worksheet, update name and dates, add houses that reached foundation, remove houses that finished | AA | MCH | D3-6 |
| D4-2 | Update the Builders Risk value column from the P/L by Job report (value = total COGS + 990 PUD + total expenses where BCH reimburses soft costs) | AA | MCH | D4-1, D3-6 |
| D4-3 | Email the Builders Risk sheet to Carol Hocks at BCH | CFO | MCH | D4-2 |
| D4-4 | Update the cash report (including the rolling 13-week view, with uncertain draws and closings flagged) | CFO | All | D3-5, D3-4 |
| D4-5 | Submit the cash report | CFO | All | D4-4 |
| D4-6 | Post tax provision / accrual entries (sales and use, property, franchise) | CFO | All | D3-5 |
| D4-7 | Finalize all journal entries — **soft close** | CFO | All | D4-6, D3-2 |
| D4-8 | Generate draft statements per company (P&L, balance sheet, cash) | CFO | All | D4-7 |
| D4-9 | Detailed variance commentary — job-level and entity-level, written, not verbal | CFO | All | D4-8, D3-7 |
| D4-10 | Management review with Jim: results, job variances, cash decisions | EXEC + CFO + KEN | All | D4-9, D4-5 |

### T+5 — Close

| ID | Task | Owner | Entity | Depends on |
|---|---|---|---|---|
| D5-1 | Post final adjustments from the management review | CFO | All | D4-10 |
| D5-2 | Finalize statements — **hard close** | CFO | All | D5-1 |
| D5-3 | Lock the period in QuickBooks (closing date + password, per company) | CFO | All | D5-2 |
| D5-4 | Distribute the reporting package to Jim and Kenneth | CFO | All | D5-3 |
| D5-5 | Update forecasts and the cash projection from actuals | CFO | All | D5-2 |
| D5-6 | Close retrospective — log what slipped and why (§9) | CFO | All | D5-4 |

### Anchored to the calendar, not to T+N

| ID | Task | Owner | Due |
|---|---|---|---|
| X-1 | **Report MVID Sales and Use Tax** | CFO | **18th of every month — external deadline** |
| X-2 | Friday check run: suggested checks and auto-pays to Jim and Kenneth | AA | Every Friday, including during close |
| X-3 | Draw requests (Built.com and supplemental-form jobs) | CFO | Weekly / as milestones hit |
| X-4 | Water shut-off notices for past-due TA/OA | CFO | Weekly, after D2-6 |

> **Quarter-end and year-end add work on top of this checklist** — quarterly financial
> reports, % of completion, intercompany balancing and clearing, Texas Mutual and Texas
> Workforce Commission payroll reports, GL audits; and at year-end HOA annual assessments,
> HOA budgets, CBUSA vendor reporting, property taxes, QB files to the CPA, 1099s.
> Plan those closes at **T+7 or T+8**, not T+5. See `accounting_quarterly_yearly`.

---

## 4. Dependencies and the critical path

### Dependency levels

```
LEVEL 1 — no dependencies, start at T+1
├── D1-2  Straight invoices into QB
├── D1-4  AMEX
├── D1-5  Utilities and auto-pays
├── D1-6  Bank sweep for wires / unbooked auto-pays
├── D1-7  Incoming checks and deposits
├── D1-9  Payroll and payroll accrual
├── D1-11 Depreciation
├── D1-12 Prepaid amortization
├── D1-13 Banyan Tree / BBj
└── D1-10 Intercompany posting
      ▲ and, gated by pre-close only:
      └── D1-1 DB→QB WO/PO import  (needs PC-2 purchasing cut-off)
          └── D1-3 General payables

LEVEL 2 — needs Level 1 complete
├── D2-1  Bank reconciliations        (needs all cash entries + final statements)
├── D2-2  AP / WO / PO reconciliation (needs the import and payables posted)
├── D2-4  AR reconciliation           (needs deposits booked)
├── D2-8  Remaining accrual JEs       (needs the RNI review and D2-2 exceptions)
└── D2-9  Intercompany reconciliation (needs both sides posted)
      └── D2-3 Fix exceptions  →  D2-5 Water billing  →  D2-6 Late fees / notices

LEVEL 3 — needs Level 2 complete
├── D3-1  Balance-sheet reconciliations
├── D3-2  Adjusting entries
├── D3-3  Reserve transfers
├── D3-5  Preliminary trial balance
└── D3-6  P/L by Job + actual-to-budget
      └── D3-7 Job variance pass → D3-8 Resolve with purchasing

LEVEL 4 — needs Level 3 complete
├── D4-1/2/3  Builders Risk           (values come from the P/L by Job report)
├── D4-4/5    Cash report
├── D4-6      Tax provision           (needs pre-tax result)
├── D4-7      Soft close
├── D4-8      Draft statements
└── D4-9      Variance commentary
      └── D4-10 Management review

LEVEL 5 — needs Level 4 complete
└── D5-1 Final adjustments → D5-2 Hard close → D5-3 Period lock
    → D5-4 Distribution → D5-5 Forecast update → D5-6 Retrospective
```

### Critical path

The longest chain decides how short the close can be. For McVaugh it runs through the
database-to-QuickBooks match, not through the bank:

```
PC-2 purchasing cut-off
  → D1-1 DB→QB import
    → D1-3 payables
      → D2-2 AP/WO/PO reconciliation
        → D2-3 exception fixes
          → D3-1 balance-sheet recs
            → D3-5 trial balance
              → D3-6 P/L by Job
                → D3-7 job variance pass
                  → D4-8 draft statements
                    → D4-10 management review
                      → D5-2 hard close
```

Two things follow from this. First, **anything that delays purchasing's cut-off (PC-2)
delays the hard close by the same number of days** — it is the first link in the chain.
Second, the Builders Risk sheet and the cash report hang off the P/L by Job report, so a
late job-cost posting moves an external commitment (Carol Hocks at BCH), not just an
internal one.

### What can run in parallel

These never block each other and should be worked simultaneously, not in list order:
bank reconciliations (D2-1) ∥ AP reconciliation (D2-2) ∥ AR and HOA billing (D2-4 → D2-6)
∥ intercompany (D2-9). Likewise at T+4: Builders Risk (D4-1→3) ∥ cash report (D4-4) ∥
tax provision (D4-6).

---

## 5. Status tracking

### The board

One row per task ID. Keep it where both Brittany and Kenneth can see it; it is the
agenda for the daily stand-up.

| ID | Task | Owner | Entity | Due | Status | Blocker | Notes |
|---|---|---|---|---|---|---|---|
| PC-2 | Purchasing cut-off confirmed | PUR | MCH | T-1 | | | |
| D1-1 | DB→QB WO/PO import | AA | MCH | T+1 | | | |
| D2-2 | AP/WO/PO reconciliation | CFO | MCH | T+2 | | | |
| … | | | | | | | |

### Status values

- **Not Started** — not begun; may be waiting on a dependency that has not cleared.
- **In Progress** — actively being worked.
- **Complete** — finished *and* reviewed. A reconciliation with open exceptions is not complete.
- **Blocked** — cannot proceed. A blocked task must name what is blocking it and who owns the unblock.
- **At Risk** — in progress but unlikely to meet its day.

A task is only **Complete** when every ID in its *Depends on* column is also Complete.
If a downstream task is being worked while an upstream one is open, that is a rework risk
and should be called out at stand-up.

### Daily stand-up — 15 minutes, every day of the close

1. Walk the board for today's day number; flag anything behind.
2. Surface blockers — name the blocker and the person who can clear it.
3. Reassign or escalate; Jim is the escalation point for anything that threatens the hard-close date.
4. If a critical-path task (§4) slips, say out loud what that does to the T+5 date. Critical-path slips move the close; others usually do not.

### Metrics to track month over month

| Metric | Definition | Target |
|---|---|---|
| Close duration | Business days from month-end to hard close (D5-2) | 5, trending to 3 |
| DB↔QB exceptions | Count of buckets 2–4 from D2-2 across all jobs | Reduce every month |
| Entries after soft close | Adjustments posted after D4-7 | Minimize; a rising count means the T+3 review is too shallow |
| Late tasks | Tasks completed after their day | Zero |
| Critical-path slips | Days the hard close moved | Zero |
| Corrections after close | Errors found after D5-3 | Zero |

---

## 6. Automation candidates

The close already has two deterministic procedures written and a workflow layer to run
them in. These are the highest-value targets, in order:

| Task | Today | Candidate |
|---|---|---|
| D2-2 AP/WO/PO reconciliation | Manual compare, intermittent | `mch-ap-reconciliation` logic — pure matching, no model needed. Blocked on a server-side credential for `db.mcvaugh.com`. See `docs/ARCHITECTURE.md` §4. |
| D3-7 Job variance pass | Manual Excel | `mch-budget-vs-actual` logic — arithmetic and thresholds, no model needed. Same credential blocker. |
| D1-11/D1-12 Depreciation, prepaid amortization | Manual entries | Recurring (memorized) transactions in QB. |
| D4-1/D4-2 Builders Risk | Copy last month's sheet by hand | Generate from the P/L by Job export; the add/remove rule (foundation in, finished out) is mechanical. |
| D2-6 / X-4 Late fees and shut-off notices | Manual | `shutoff-notice-generator` already does the ROLA/ROCVTA notices from the QB AR aging export. |

Every one of these stays **read / flag / draft only** — payments, approvals and spending
remain human, per decision `dec-agents-readonly`.

---

## 7. What a 3-day close would require

Not recommended until the items below are true; attempting it first just moves the
failures later.

| Day | Activities |
|---|---|
| T+1 | All entries posted (automated + manual), DB↔QB import and reconciliation, bank recs, intercompany, preliminary trial balance |
| T+2 | Balance-sheet recs, job-cost and variance pass, Builders Risk, cash report, draft statements, management review |
| T+3 | Final adjustments, hard close, period lock, distribution, forecast |

Prerequisites, each of which is a real gap today:

1. **Work orders and purchase orders entered before work begins, consistently** — today this is acknowledged as inconsistent, and it is the first link in the critical path.
2. **Automated DB→QB import with no manual fallback.**
3. **Continuous reconciliation** — the DB↔QB match run weekly, not at month-end, so T+2 confirms rather than discovers.
4. **Recurring entries memorized in QB** (depreciation, prepaid, standard accruals).
5. **A second person able to run every close task** — see §8.

---

## 8. Known risks and bottlenecks

| Risk | Why it matters here | Mitigation |
|---|---|---|
| **Purchasing succession** — WO/PO entry and completion marking sit with a departing person | PC-2 is the first link in the critical path; losing it stops the close before it starts | Finish the handover of WO/PO entry and completion marking, and name a backup, before the next close. See the Handover view. |
| Inconsistent WO/PO entry | Produces false exceptions at D2-2 and understates committed cost | Enforce the PC-2 cut-off; measure DB↔QB exception count monthly |
| Intermittent DB↔QB matching | Exceptions accumulate and surface at close instead of during the month | Move D2-2 to a weekly run |
| Multi-company in QB Desktop | Every reconciliation, lock and report is done ×N companies; easy to close one and miss another | Track status per entity on the board, not once overall |
| Single-person bank access | D1-6, D3-3 and wires depend on Kenneth being available during close week | Documented backup and a second authorized signer |
| Builders Risk is an external commitment | D4-3 depends on job costs being final; a slip is visible outside the company | Keep D4-1/2 on T+4, never T+5 |
| Manual Excel in the chain | Builders Risk and actual-to-budget are copy-forward worksheets — a stale copy is silent | Date and version each worksheet; reconcile totals to the P/L by Job report |

---

## 9. Retrospective (D5-6)

Five questions, logged each month so the answers can be compared:

1. What went well this close that we should keep doing?
2. What took longer than expected, and which task ID was it?
3. What blocked us, and could it have been cleared before close week?
4. Was there anything in the results we should have caught at T+3 instead of at the T+4 review?
5. What single task should be automated before next month?

---

## 10. Sources

| Content | Source |
|---|---|
| Monthly, weekly, quarterly and yearly accounting tasks | `seed/mch-ops-hub.json` — `accounting_monthly`, `accounting_weekly`, `accounting_quarterly_yearly` |
| Roles and responsibilities (CFO, Controller, Accounting Assistant) | `seed/mch-ops-hub.json` — `roles` |
| Order/accounting process, reconciliation and cash ownership, systems | `docs/McVaugh_Operations_Assessment_and_Pages_Handoff.md` |
| Reconciliation and budget-variance logic | `mch-ap-reconciliation`, `mch-budget-vs-actual` company skills; `docs/ARCHITECTURE.md` §4 |
| Close framework — day structure, dependency levels, status model, metrics | `finance:close-management` skill |

Day assignments, dependency levels and the critical path are **proposed** and are the
part of this document to challenge first.
