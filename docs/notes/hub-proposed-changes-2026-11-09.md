# What I'd change on the hub next — 9 November 2026

Everything below comes from the hub's own data plus the three handover transcripts.
Numbers are from the build generated today. Nothing here is applied; it's for you to
pick from.

---

## 1. Twenty-one of the 53 published procedures are owned by a role that no longer exists

The hub publishes each procedure under a 2006 role id. The count today:

| Published owner | Procedures |
|---|---|
| `doc` — Director of Construction (Maria) | **21** |
| `sales_exec` (James) | 8 |
| `lonnie` | 8 |
| `acct_asst` | 7 |
| cfo / president / dir_sales / dop / purchasing_mgr / admin_asst | 1–2 each |

Maria's own responsibility list is empty and she's marked departed — but **28 procedures
in the world still have her as owner**, and the page shows 21 of them under her old role.
Anyone opening the hub to find out who does something is told: the Director of
Construction. There is no Director of Construction.

**Proposal.** Run the same pass on procedure ownership that we ran on responsibilities:
every procedure gets a current owner and a named backup, or it's explicitly marked
*unassigned — nobody does this*. Unassigned is a legitimate answer and a more useful one
than a dead role. I can produce the list of 28 with a proposed owner each, for you to
approve in a batch rather than one at a time.

Six of them have never been reviewed against any meeting at all:
preconstruction planning, preconstruction start (spec), preconstruction redline with
buyer, budget & home specification, president plan selection, permitting. Preconstruction
is where a job starts — it's the weakest-covered part of the hub.

## 2. Nobody is told what's *not* covered

The hub shows procedures and responsibilities. It doesn't show the holes: the questions
raised in the transcripts that nobody answered. Right now there are six open decisions and
a list of per-procedure gaps sitting in `missing_info` fields that the page never prints.

**Proposal.** A "what isn't settled" section on the hub, generated from the same data —
open decisions, procedures with something missing, procedures with no owner, and the
stale four. You said the world should show "what is left over and not answered in the
transcripts." That exists in the world; it should be on the page everyone reads too.

## 3. Workload is wildly uneven and the page doesn't say so

Live responsibilities as published today: **Brittany 66**, Lonnie 62, Kenneth 39, James 37,
Teresa 35, Jim 25, Pam 24.

You have more on your list than anyone in the company, and Lonnie — who started weeks ago
— is second. You told me earlier not to chase the size of individual items, and I'm not;
this is about the count. It's the clearest argument in the data for which agents to build
first.

**Proposal.** Nothing automatic. Just a short pass on your 66 and Lonnie's 62 asking of
each: does this need a person, or is it a candidate for one of the agents?

## 4. Fifteen agents exist and thirteen have never been reviewed

Only two are past `not_reviewed`: purchasing, and vendor compliance (GL insurance). None
is enabled. The rest are names with a department attached.

**Proposal.** Stop at three. Vendor compliance is genuinely ready — the insurance sweep
works and has one human gate. Purchasing is documented. Pick one more that removes work
from your 66, and mark the other twelve `proposed` so the hub stops implying twelve agents
are on the way.

## 5. Departed people are still on the team roster

Maria (0 live, 24 struck off) and the purchasing list (0 live, 7 struck off) both still
publish as team members. That's right for history and wrong for "who works here."

**Proposal.** A separate *former* section on the hub, below the team, so the roster answers
"who do I go to" and the history stays reachable.

## 6. The thing the world was meant to show and doesn't yet

From your own description: *"review that agents and visually see the process they are
engaging in."* The world shows roles, agents and approvals, but there's no view of an
agent running a procedure step by step. That's still unbuilt, and it's the piece that
makes an agent reviewable rather than trusted.

---

## What I'd do first

1. The ownership pass (**#1**) — it's the one that makes the hub answer its main question.
2. The "what isn't settled" section (**#2**) — cheap, and it's already in the data.
3. The former-employees split (**#5**) — small and removes a live source of confusion.

The agent work (#4, #6) is worth doing after the procedures are correct, not before —
an agent built on a procedure owned by a role that doesn't exist inherits the problem.
