# McVaugh Operations — Assessment and Implementation Hub

Status: Planning and assessment. No platform selected; no production migration authorized or performed.
Prepared from the discovery conversation dated October 2, 2026.
Implementation lead: Brittany. Executive sponsor and backup: Jim.

## 01 — Executive brief for Jim

Assess the live McVaugh database and unused BuildConnect 2.0 prototype before selecting a system. Compare three options: improve the original system, complete selected parts of BuildConnect, or purchase a construction platform. Evaluate implementation cost, ongoing maintenance, ease of use, and reliability using actual McVaugh workflows.

The business priorities are trade delays, purchasing, estimating, budget control, cash coordination, sales follow-up, and plan changes affecting permits. The desired result is documented operating procedures supported by connected records and visible agents. Keep the live database and QuickBooks Enterprise operating during assessment. Pilot approved improvements on two homes before broader rollout.

The assessment will produce an evidence-based recommendation, scope, cost estimate, risks, maintenance ownership, and pilot acceptance criteria. No readiness conclusion follows merely from the existence of a prototype. No firm implementation price or timeline is established.

## 02 — Confirmed company context

| Topic | Confirmed information |
|---|---|
| Volume | 13 active homes; usually 3–5 annual starts; target not yet supplied |
| Work mix | User describes approximately 80% spec work and 20% HOA management |
| Live operations | Original McVaugh website database remains the only live construction system |
| Accounting | QuickBooks Desktop Enterprise |
| Database developer | Efficient Computer Systems; originally built by someone who previously worked for McVaugh |
| Source location | Windows computer: C:\Users\bmcvaugh\Documents\MCH-DB |
| Prototype | BuildConnect 2.0 created with Claude/Codex; nobody currently uses it |
| Budgets | Database and Excel |
| Schedules | Excel |
| Construction/purchasing | Maria |
| Design/sales | Pam and James; James is distinct from Jim |
| Selection decisions | Pam and Jim, sometimes Danielle |
| Accounting | Brittany and Kenneth |
| Implementation | Brittany, with Jim as backup |
| AI workspaces | ChatGPT Business and Claude Team; Premium/Dots upgrade deferred |

### Current order and accounting process
Maria enters work orders and purchase orders into the database, ideally before work begins, but not consistently. Maria marks completion. Accounting enters corresponding information into QuickBooks; matching is checked intermittently. Accounting marks payment status and date in the database.

### Current selections process
Supplier provides a paper selection sheet. Maria signs it. Information is transferred into an Excel selection guide. Design creates tile layout drawings. Maria informs design when selections exceed budget.

The supplied PDF and Excel examples represent DIFFERENT HOMES. Product differences between them are not errors. Excel formula errors and inconsistent template labels observed during the earlier review require separate verification and correction. Neither sample establishes current approved selections for all projects.

### Prior observations — not a completed technical audit
An earlier read-only inspection found original source/export files, an mch-app prototype, a modern-db redesign, ai-rollout materials, and reconciliation files. Prototype documentation describes Next.js/TypeScript/PostgreSQL and business modules. These descriptions are unverified claims until code and behavior are tested. The export README explicitly warns of plaintext passwords; treat source/export handling and development-data preparation accordingly.

The current cloud session cannot access the Windows source directory. Technical assessment remains blocked until source is available in an authorized environment. No application was launched or production connection tested in this assessment.

## 03 — Assessment work plan

### A. Establish the baseline
Identify the live source version, deployment, database schema, current maintainer, backups, recovery process, integrations, and hosting costs. Determine whether prototype and modern-db schemas are compatible or independent redesigns. Inventory existing functionality and workflow gaps without assuming documentation equals implementation.

Use a secure source copy or company-owned repository. Exclude secrets, plaintext credentials, raw sensitive exports, node_modules, and generated build files from general shared pages. Inspect a schema-only export and sanitized samples first.

### B. Trace representative workflows
Trace one home from estimate through budget, commitment, completion, acceptance, invoice, payment, and sale. Inspect one supplier selection through approval, drawing, purchasing, and installation. Trace a permit revision and a delayed trade. Identify duplicate entry, unclear authority, inconsistent IDs, and manual handoffs.

### C. Review the original application
Inspect data integrity, budget calculations, order states, partial payments, revisions, permissions, audit history, export capability, integration access, and maintainability. Document actual evidence by file/function or demonstrated behavior.

### D. Review BuildConnect
Test against sanitized data in isolation: authentication and permissions, actual business workflows, financial calculations, persisted updates, error handling, audit logs, migrations, backup/restore, and operational support. Review dependency/security issues and missing implementation. Distinguish a screen or schema from an operational feature. Do not run seed/migration scripts against live data.

### E. Compare purchased platforms
Require demonstrations using McVaugh scenarios. Verify QuickBooks Enterprise compatibility for the exact version and multi-company setup, API access, exports, selections, scheduling, partial payments, customer/trade access, support, and full pricing. Candidate vendors are JobTread and Buildertrend, not a final selection. Revalidate current features and written quotes during assessment.

### F. Produce a decision memo
For each option document reusable work, missing work, migration effort, expected operational benefit, one-time cost, recurring expense, internal staff effort, reliability, maintenance owner, and exit/export plan. Select an option only when evidence and cost support it; otherwise document what evidence is missing.

## 04 — Decision matrix and costs

Proposed scoring weights, subject to Jim's approval:

| Criterion | Weight | Evidence |
|---|---:|---|
| Reliability and financial/data integrity | 30% | Workflow tests, reconciliation, auditability, recovery |
| Workflow fit and ease of use | 25% | Office and mobile tasks performed by actual users |
| Three-year total cost | 25% | Quotes, build/support estimates, migration and staff effort |
| Maintainability and support | 20% | Named maintainer, updates, documentation, export and integration support |

Score 1–5 only after evidence. Unknown is not zero and is not a passing score. Must-pass requirements override the weighted score: correct financial calculations; practical QuickBooks workflow; project/entity separation; authorized access; audit history; recoverable data; and usable daily workflows.

Three-year cost = assessment + configuration/development + data cleanup/migration + training + 36 months of subscriptions/hosting/AI/support + estimated internal staff time. Show uncertain estimates as ranges and separate existing expenses from incremental expenses. Do not invent implementation or vendor quotes. Compare alternatives on the same functional scope. Avoid sunk-cost preference for existing prototype work.

## 05 — Operating procedures to design

Every procedure needs a trigger, owner, inputs, steps, deadline, approval rules, completion evidence, escalation, and retained record. All procedures below are PROPOSED, pending workflow review.

| Procedure | Proposed control | Owner |
|---|---|---|
| Estimating | Consistent scope, quantities, exclusions, dated pricing, review and approved baseline | Maria; estimating ownership to confirm |
| Budget | Actuals, outstanding commitments, forecast remaining costs without double counting | Maria + accounting |
| Orders | Budget check and approval before issuance; explicit exceptions | Maria |
| Scheduling | Dependencies, calendars, shared trade capacity, baseline and forecast | Maria |
| Readiness | Six-week constraints, weekly commitments, daily blockers | Maria |
| Selections | Supplier document, verified entry, approval and drawing revision linked | Design + Maria |
| Permit changes | Coordinated submission review; logged changes and professional impact review | Maria + design professionals |
| Quality | Trade scopes, inspection checkpoints, acceptance and corrections | Maria/qualified inspectors |
| Reconciliation | Order/bill/payment exceptions; partial and disputed items supported | Brittany/Kenneth |
| Cash | Rolling 13-week forecast with uncertain draws/closings identified | Brittany/Kenneth; Jim decisions |
| Sales | Pre-completion marketing milestones and assigned prospect next actions | Pam/James |
| Warranty | Request, assignment, due date, evidence and closure | Owner to confirm |
| HOA | Separate service processes and financial records | Owner to confirm |

Order states should distinguish authorization, issuance, work completion, acceptance, invoice receipt, reconciliation, payment approval, and payment. Determine who can perform each transition.

Selections require room/location, supplier/product/SKU, finish, dimensions, quantity and unit, price and scope, allowance, approval status/date/person, order deadline, delivery, installation dependency, and drawing revision. Maria's signature must have a defined meaning; selection approval and spending authorization may be different actions.

## 06 — Agents and visual oversight

Start with read-only/draft functions and add bounded actions after validation. Use stable system IDs and permissions. A workflow scheduler and reliable integrations may be required; a chat instruction alone does not establish unattended execution.

| Function | Initial output | Human authority |
|---|---|---|
| Schedule/readiness | Blockers, trade conflicts, threatened milestones | Maria approves recovery commitments |
| Purchasing/estimating | Bid gaps, order deadlines, budget exceptions | Authorized awards/spending |
| Design/selections | Extracted drafts, missing details, revision comparisons | Design verifies; Maria checks budget |
| Accounting | Reconciliation queue, forecast inputs | Accounting resolves; authorized payments |
| Sales | Follow-up drafts, inventory and prospect exceptions | Pricing and negotiation |
| Executive | Source-linked decision brief | Jim prioritizes |

Dashboard must show last successful run, source freshness, records checked, actions completed, pending approvals, failures, next run, and responsible person. Alert links must point to evidence. Missing data is not a clean bill of health. Define retries, duplicate prevention, logs, escalation, and pause/recovery.

Do not automate funds movement, contract execution, price commitments, or physical acceptance without an expressly defined authorization policy. Inspectors/design professionals retain technical judgment.

## 07 — Pilot and acceptance

Choose two representative homes with Maria and Jim. Establish before/after baselines for construction and inventory days, schedule commitment reliability, budget variance, purchasing delays, reconciliation exceptions, selection response times, and manual administrative effort.

Initial pilot scope: schedule readiness, purchasing/budget checks, selection-document control, accounting exception reporting, and daily executive decisions. Include sales-readiness milestones. Start small if integration difficulty warrants it.

Acceptance requires verified calculations, no duplicate financial records, correct job/entity mapping, preserved revisions, reliable task execution and error visibility, appropriate permissions, and users completing actual office/mobile workflows. Numeric targets will be set after baseline measurement. No production migration until a tested cutover, rollback, and maintenance plan is approved.

## 08 — Business workspace and Pages setup

Create a Space called McVaugh Operations in the business workspace. Use this document as the handoff source, then split sections into these pages:

1. Start Here — Executive Brief and Confirmed Facts
2. System Assessment — Evidence and Open Questions
3. Platform Decision — Options, Cost, and Recommendation
4. Operating Procedures — Drafts and Approved Versions
5. Pilot — Tasks, Owners, Acceptance, and Results
6. Agent Instructions — Permissions and Monitoring
7. Decisions and Changes — Date, Owner, Rationale, Source

Begin with Brittany and Jim. Share specific work pages with functional owners after reviewing access. Keep cash, accounting, source-code/security findings, and personnel information in separately restricted pages/spaces; child pages may inherit parent sharing.

Pages are the handbook, decision record, and collaboration layer. The selected operational systems remain the source for transactions and live schedules. Attaching a spreadsheet does not by itself create a live synchronization or recurring automation. Record explicit configuration and verification for each integration.

Do not expect this account's private chats, files, connections, or memory to automatically appear in the business account. Bring across selected relevant documents and this fact summary. Reauthorize company connections there as needed. Keep this conversation as historical discovery; continue authoritative decisions in the business workspace after handoff.

## 09 — Starter prompt to paste in the business account

Use the attached McVaugh_Operations_Assessment_and_Pages_Handoff.md as the project handoff. Create a parent Page called McVaugh Operations — Assessment and Implementation Hub and organize its content into the seven pages listed in section 08, if those capabilities are available. Otherwise prepare page-ready sections and tell me the remaining setup action. Preserve confirmed facts and distinguish them from proposed procedures, unverified prototype claims, and unanswered questions.

Brittany leads implementation; Jim is president/owner and backup; James is a separate person in marketing, sales, and design. The original database is live; BuildConnect 2.0 is unused. The supplier PDF and Excel selection guide examples are different homes.

Start with a read-only assessment of the original database and BuildConnect. Compare improving the original, completing selected prototype functions, or purchasing a platform. Use the decision matrix and three-year cost structure; do not select based on prototype existence or invent a price. Keep the original database and QuickBooks Enterprise operating. Do not run migrations, seeds, deploy changes, or alter production records as part of assessment.

First confirm access to source files, identify the available version, and produce an evidence inventory and gap assessment. If source is missing, state that limitation and continue only the process assessment. Track decisions and unanswered questions on the relevant pages. Preserve approved content when making targeted updates. Do not claim pages, automations, or integrations were created unless verified.

## 10 — Outstanding inputs

- Accessible source copy or repository, confirmed live version, and current maintenance contact.
- Current schedule and budget for one pilot candidate home; explain which budget is authoritative.
- Sanitized sample order, invoice, payment, and matching QuickBooks export.
- Exact QuickBooks Enterprise version, company-file count, hosting, and authorized integration access.
- Maria's examples of changes causing permit delays, when discovered, and who initiates them.
- Trade scopes/checklists and current sales pipeline or follow-up records.
- Approval limits, signature meanings, and task backups.
- Growth target, implementation budget, and available staff time.

The requested next-morning reminder was NOT created: the account had five active tasks and creation was rejected. Do not assume a reminder exists.
