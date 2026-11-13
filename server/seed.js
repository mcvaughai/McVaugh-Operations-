// Seed data derived from McVaugh_Operations_Assessment_and_Pages_Handoff.md (discovery dated 2026-10-02).
// CONFIRMED facts are marked confirmed/approved; everything else is PROPOSED and awaits review.
// Seeding only runs when the database is empty, so edits made in the app are never overwritten.
'use strict';
const { upsert, addEvent, nowIso, slug } = require('./db');
const fs = require('node:fs');
const path = require('node:path');

const HANDOFF = 'Handoff: McVaugh_Operations_Assessment_and_Pages_Handoff.md (2026-10-02)';

const departments = [
  { id: 'exec',       name: 'Executive & Implementation',      short: 'Executive',     gx: 0, gy: 0, hue: 262, sort: 1, description: 'Jim prioritizes; Brittany leads implementation with Jim as backup.' },
  { id: 'estimating', name: 'Estimating & Budgets',             short: 'Estimating',    gx: 1, gy: 0, hue: 200, sort: 2, description: 'Estimates, approved baselines, actuals vs. commitments vs. forecast.' },
  { id: 'construction', name: 'Construction & Scheduling',      short: 'Construction',  gx: 2, gy: 0, hue: 28,  sort: 3, description: 'Field supervision, schedules, six-week readiness, daily blockers.' },
  { id: 'purchasing', name: 'Purchasing & Trade Coordination',  short: 'Purchasing',    gx: 3, gy: 0, hue: 150, sort: 4, description: 'Work orders, purchase orders, trade commitments, deliveries.' },
  { id: 'design',     name: 'Design & Selections',              short: 'Design',        gx: 0, gy: 1, hue: 320, sort: 5, description: 'Supplier selection sheets, Excel selection guide, tile layout drawings.' },
  { id: 'permits',    name: 'Permits & Plan Revisions',         short: 'Permits',       gx: 1, gy: 1, hue: 48,  sort: 6, description: 'Plan changes, coordinated submission review, professional impact review.' },
  { id: 'accounting', name: 'Accounting & Cash Planning',       short: 'Accounting',    gx: 2, gy: 1, hue: 120, sort: 7, description: 'QuickBooks Desktop Enterprise, reconciliation, 13-week cash forecast. Restricted.' },
  { id: 'marketing',  name: 'Marketing & Sales',                short: 'Sales',         gx: 3, gy: 1, hue: 350, sort: 8, description: 'Pre-completion marketing milestones, prospect follow-up.' },
  { id: 'quality',    name: 'Quality & Warranty',               short: 'Quality',       gx: 0, gy: 2, hue: 180, sort: 9, description: 'Trade scopes, inspection checkpoints, acceptance, warranty requests. Owner to confirm.' },
  { id: 'hoa',        name: 'HOA Management',                   short: 'HOA',           gx: 1, gy: 2, hue: 90,  sort: 10, description: 'Separate service processes and financial records (~20% of work mix). Owner to confirm.' },
];

const people = [
  { id: 'brittany', name: 'Brittany', role_summary: 'Implementation lead; accounting', departments: ['exec', 'accounting'], confirmed: 1 },
  { id: 'jim',      name: 'Jim',      role_summary: 'President/owner; executive sponsor; implementation backup; selection decisions', departments: ['exec', 'design'], confirmed: 1 },
  { id: 'maria',    name: 'Maria',    role_summary: 'Construction, field supervision, purchasing', departments: ['construction', 'purchasing'], confirmed: 1 },
  { id: 'pam',      name: 'Pam',      role_summary: 'Design, marketing, sales; selection decisions', departments: ['design', 'marketing'], confirmed: 1 },
  { id: 'james',    name: 'James',    role_summary: 'Design, marketing, sales (James is a different person from Jim)', departments: ['design', 'marketing'], confirmed: 1 },
  { id: 'kenneth',  name: 'Kenneth',  role_summary: 'Accounting', departments: ['accounting'], confirmed: 1 },
  { id: 'danielle', name: 'Danielle', role_summary: 'Selections/design when assigned', departments: ['design'], confirmed: 1 },
].map(p => ({ ...p, review_status: 'not_reviewed', source: HANDOFF, notes: 'Confirmed person. Responsibilities listed are from the handoff; detailed task review has not happened yet.' }));

// Proposed agent placeholders. approach: rules | ai | hybrid | undecided — with a note on why.
const agents = [
  { id: 'agent-schedule-readiness', name: 'Schedule readiness',          department_id: 'construction', approach: 'hybrid',  approach_note: 'Dependency/date math is deterministic rules. AI only to summarize threatened milestones in plain language.', initial_output: 'Blockers, trade conflicts, threatened milestones', human_authority: 'Maria approves recovery commitments' },
  { id: 'agent-trade-commitments',  name: 'Trade commitments',           department_id: 'purchasing',   approach: 'rules',   approach_note: 'Weekly commitment tracking and overdue flags are ordinary rules; no model needed.', initial_output: 'Missed/at-risk weekly commitments', human_authority: 'Maria' },
  { id: 'agent-purchasing',         name: 'Purchasing & deliveries',     department_id: 'purchasing',   approach: 'rules',   approach_note: 'Order deadlines and delivery-date reminders are deterministic.', initial_output: 'Order deadlines, late deliveries', human_authority: 'Authorized awards/spending stay human' },
  { id: 'agent-estimating',         name: 'Estimating & bid comparison', department_id: 'estimating',   approach: 'ai',      approach_note: 'Reading unstructured bids to find scope gaps benefits from a model; totals are checked by code.', initial_output: 'Bid gaps, scope/exclusion differences', human_authority: 'Authorized awards' },
  { id: 'agent-budget-exceptions',  name: 'Budget exceptions',           department_id: 'estimating',   approach: 'rules',   approach_note: 'Budget vs. actual arithmetic is never sent to a model. (Existing mch-budget-vs-actual skill already does this comparison.)', initial_output: 'Over-budget cost codes, pending WO/PO exposure', human_authority: 'Maria + accounting' },
  { id: 'agent-design-selections',  name: 'Design & selections',         department_id: 'design',       approach: 'ai',      approach_note: 'Extracting draft selections from supplier PDFs needs document understanding; design verifies every draft.', initial_output: 'Extracted drafts, missing details, revision comparisons', human_authority: 'Design verifies; Maria checks budget' },
  { id: 'agent-permits',            name: 'Plan revisions & permit tracking', department_id: 'permits', approach: 'hybrid',  approach_note: 'Submission deadlines are rules; summarizing change impact is a draft task for a model.', initial_output: 'Logged changes, pending submissions', human_authority: 'Maria + design professionals' },
  { id: 'agent-reconciliation',     name: 'Accounting reconciliation',   department_id: 'accounting',   approach: 'rules',   approach_note: 'Payment matching is deterministic (existing mch-ap-reconciliation skill logic). Model only drafts explanations for exceptions.', initial_output: 'Reconciliation queue: DB vs QuickBooks exceptions', human_authority: 'Accounting resolves; authorized payments' },
  { id: 'agent-cash-forecast',      name: 'Cash forecast preparation',   department_id: 'accounting',   approach: 'rules',   approach_note: 'Rolling 13-week forecast is arithmetic on known draws/closings; uncertainty flags are rules.', initial_output: 'Forecast inputs, uncertain draws/closings', human_authority: 'Jim decides' },
  { id: 'agent-sales-followup',     name: 'Sales follow-up',             department_id: 'marketing',    approach: 'hybrid',  approach_note: 'Overdue follow-up reminders are rules; drafting follow-up messages is a model task.', initial_output: 'Follow-up drafts, prospect exceptions', human_authority: 'Pricing and negotiation stay human' },
  { id: 'agent-marketing-readiness', name: 'Marketing readiness',        department_id: 'marketing',    approach: 'rules',   approach_note: 'Pre-completion milestone checklist is a rule set.', initial_output: 'Missed pre-completion marketing milestones', human_authority: 'Pam/James' },
  { id: 'agent-quality-warranty',   name: 'Quality & warranty',          department_id: 'quality',      approach: 'rules',   approach_note: 'Request → assignment → due date → closure is a tracked workflow; no model needed for tracking.', initial_output: 'Open warranty items, overdue inspections', human_authority: 'Inspectors retain technical judgment' },
  { id: 'agent-hoa',                name: 'HOA coordination',            department_id: 'hoa',          approach: 'undecided', approach_note: 'Owner and process not yet confirmed.', initial_output: 'To be defined', human_authority: 'To confirm' },
  { id: 'agent-exec-reporting',     name: 'Executive reporting',         department_id: 'exec',         approach: 'ai',      approach_note: 'Source-linked decision brief is a drafting task; every number comes from the other agents, not the model.', initial_output: 'Source-linked decision brief', human_authority: 'Jim prioritizes' },
].map(a => ({ ...a, setup_stage: 'not_reviewed', enabled: 0, paused: 0, proposed: 1,
  purpose: a.initial_output + '. Read/flag/draft only until validated; no spending, payments, contracts, pricing changes, or construction acceptance.' }));

// Proposed procedures from handoff section 05, stored as tasks (proposed=1).
const procTasks = [
  { id: 'proc-estimating',   title: 'Estimating procedure',           department_id: 'estimating',  owner_id: 'maria',   steps: 'Consistent scope, quantities, exclusions, dated pricing, review and approved baseline.', missing_info: 'Estimating ownership to confirm.' },
  { id: 'proc-budget',       title: 'Budget control procedure',       department_id: 'estimating',  owner_id: 'maria',   backup_id: 'brittany', steps: 'Actuals, outstanding commitments, forecast remaining costs without double counting.', missing_info: 'Which budget (database vs. Excel) is authoritative?' },
  { id: 'proc-orders',       title: 'Order authorization procedure',  department_id: 'purchasing',  owner_id: 'maria',   steps: 'Budget check and approval before issuance; explicit exceptions. Order states: authorization → issuance → work completion → acceptance → invoice receipt → reconciliation → payment approval → payment.', missing_info: 'Who can perform each state transition? Approval limits.' },
  { id: 'proc-scheduling',   title: 'Scheduling procedure',           department_id: 'construction', owner_id: 'maria',  steps: 'Dependencies, calendars, shared trade capacity, baseline and forecast.', inputs: 'Excel schedules (current source).' },
  { id: 'proc-readiness',    title: 'Readiness procedure',            department_id: 'construction', owner_id: 'maria',  steps: 'Six-week constraints, weekly commitments, daily blockers.' },
  { id: 'proc-selections',   title: 'Selections procedure',           department_id: 'design',      owner_id: 'pam',     backup_id: 'maria', steps: 'Supplier document → verified entry → approval and drawing revision linked. Fields: room/location, supplier/product/SKU, finish, dimensions, quantity/unit, price/scope, allowance, approval status/date/person, order deadline, delivery, install dependency, drawing revision.', missing_info: 'Meaning of Maria\'s signature: selection approval vs. spending authorization. Excel formula errors and template labels need separate verification.' },
  { id: 'proc-permits',      title: 'Permit change procedure',        department_id: 'permits',     owner_id: 'maria',   steps: 'Coordinated submission review; logged changes and professional impact review.', missing_info: 'Maria\'s examples of changes causing permit delays, when discovered, who initiates.' },
  { id: 'proc-quality',      title: 'Quality procedure',              department_id: 'quality',     owner_id: 'maria',   steps: 'Trade scopes, inspection checkpoints, acceptance and corrections.', missing_info: 'Trade scopes/checklists.' },
  { id: 'proc-reconciliation', title: 'Reconciliation procedure',     department_id: 'accounting',  owner_id: 'brittany', backup_id: 'kenneth', steps: 'Order/bill/payment exceptions; partial and disputed items supported. Current: Maria marks completion in DB; accounting enters in QuickBooks; matching checked intermittently; accounting marks payment status/date in DB.', sensitive: 1, inputs: 'MCH database WO/PO pages; QuickBooks Transaction List by Vendor CSV.' },
  { id: 'proc-cash',         title: 'Cash planning procedure',        department_id: 'accounting',  owner_id: 'brittany', backup_id: 'kenneth', steps: 'Rolling 13-week forecast with uncertain draws/closings identified. Jim decides.', sensitive: 1 },
  { id: 'proc-sales',        title: 'Sales follow-up procedure',      department_id: 'marketing',   owner_id: 'pam',     backup_id: 'james', steps: 'Pre-completion marketing milestones and assigned prospect next actions.', missing_info: 'Current sales pipeline / follow-up records.' },
  { id: 'proc-warranty',     title: 'Warranty procedure',             department_id: 'quality',     steps: 'Request, assignment, due date, evidence and closure.', missing_info: 'Owner to confirm.' },
  { id: 'proc-hoa',          title: 'HOA procedure',                  department_id: 'hoa',         steps: 'Separate service processes and financial records.', missing_info: 'Owner to confirm.' },
].map(t => ({ ...t, proposed: 1, board: 'next', documented: 0, automated: 0, verified: 0, source: HANDOFF + ' §05',
  approval_rules: t.approval_rules || 'To define during workflow review.',
  next_action: t.next_action || 'Review with owner; confirm trigger, inputs, deadline, approval rules, completion evidence.' }));

// Brittany's implementation tasks (project stages: gather → map → simplify → choose → pilot → expand)
const implTasks = [
  { id: 'impl-confirm-people',     title: 'Confirm people and responsibilities with the team', project_stage: 'gather', owner_id: 'brittany', backup_id: 'jim', board: 'working', next_action: 'Open each person, confirm roles, mark "Verified". Add anyone missing.', steps: 'Open each person card → confirm role summary → set review status.' },
  { id: 'impl-source-access',      title: 'Get an accessible copy of the MCH-DB source and confirm live version', project_stage: 'gather', owner_id: 'brittany', backup_id: 'jim', board: 'waiting', waiting_on: 'Brittany (Windows machine access: C:\\Users\\bmcvaugh\\Documents\\MCH-DB) / Efficient Computer Systems', blocker: 'Cloud sessions cannot reach the Windows directory. Technical assessment is blocked until source is in an authorized environment.', missing_info: 'Live version, deployment, backups, maintenance contact, hosting costs.' },
  { id: 'impl-pilot-home',         title: 'Pick two pilot homes with Maria and Jim', project_stage: 'choose', owner_id: 'brittany', board: 'next', waiting_on: 'Maria, Jim', next_action: 'Mark two homes as "pilot" in the neighborhood view.', missing_info: 'Current schedule and budget for one pilot candidate; which budget is authoritative.' },
  { id: 'impl-qb-details',         title: 'Record exact QuickBooks Enterprise version, company-file count, hosting, integration access', project_stage: 'gather', owner_id: 'brittany', backup_id: 'kenneth', board: 'next', sensitive: 1 },
  { id: 'impl-approval-limits',    title: 'Document approval limits, signature meanings, and task backups', project_stage: 'map', owner_id: 'brittany', board: 'next', waiting_on: 'Jim, Maria' },
  { id: 'impl-decision-weights',   title: 'Jim approves decision-matrix weights (30/25/25/20)', project_stage: 'choose', owner_id: 'jim', board: 'waiting', waiting_on: 'Jim' },
  { id: 'impl-n8n',                title: 'Stand up n8n and connect one real workflow to this world', project_stage: 'pilot', owner_id: 'brittany', board: 'next', next_action: 'Decide hosting for n8n (self-hosted vs. cloud); set MOW_N8N_SECRET; send a test callback.', automation_approach: 'n8n execution events → POST /api/webhooks/n8n (authenticated, deduplicated by execution id).' },
  { id: 'impl-pages-handbook',     title: 'Keep ChatGPT Pages as handbook; use export/update workflow', project_stage: 'map', owner_id: 'brittany', board: 'next', automation_approach: 'No supported read/write API verified for ChatGPT Business Pages. Use Export → paste into Pages; log the export as a manual integration event.' },
].map(t => ({ ...t, proposed: 0, documented: 1, automated: 0, verified: 0, source: 'Stage 1 build (2026-10-06)', department_id: 'exec' }));

const decisions = [
  { id: 'dec-no-platform',    date: '2026-10-02', title: 'No platform selected; no production migration authorized', reason: 'Assessment first. Compare improving the original DB, completing parts of BuildConnect, or purchasing (JobTread/Buildertrend candidates). Must-pass requirements override weighted score.', decided_by: 'Brittany, Jim', status: 'approved' },
  { id: 'dec-keep-live',      date: '2026-10-02', title: 'Keep the live McVaugh database and QuickBooks Enterprise operating', reason: 'They remain the only live construction/accounting systems during assessment. BuildConnect 2.0 is an unused prototype; nothing in it is assumed to work.', decided_by: 'Brittany, Jim', status: 'approved' },
  { id: 'dec-pilot-two',      date: '2026-10-02', title: 'Pilot approved improvements on two homes before broader rollout', reason: 'Limit risk; measure before/after baselines.', decided_by: 'Jim', status: 'approved' },
  { id: 'dec-ai-subs',        date: '2026-10-02', title: 'Use ChatGPT Business and Claude Team; Premium/Dots upgrade deferred', reason: 'Start with existing subscriptions. API usage is billed separately and must not be purchased automatically.', decided_by: 'Brittany', status: 'approved' },
  { id: 'dec-agents-readonly', date: '2026-10-02', title: 'Agents start read-only / draft; no automated funds movement, contracts, pricing, or physical acceptance', reason: 'Human authorization retained until an authorization policy is expressly defined.', decided_by: 'Brittany, Jim', status: 'approved' },
  { id: 'dec-store',          date: '2026-10-06', title: 'Canonical store for this app: single SQLite file (data/mcvaugh-world.sqlite) with JSON export', reason: 'Zero dependencies, runs on the Windows machine with Node, trivially backed up by copying one file. Operational systems (MCH DB, QuickBooks) stay authoritative for their own transactions.', decided_by: 'Stage 1 build — needs Brittany\'s confirmation', status: 'proposed' },
  { id: 'dec-reuse',          date: '2026-10-06', title: 'Reuse existing mch-budget-vs-actual / mch-ap-reconciliation skill logic for deterministic checks instead of new AI agents', reason: 'Those skills already define the DB page URLs and matching rules; the budget and reconciliation agents should wrap them, not re-invent them.', decided_by: 'Stage 1 build — needs Brittany\'s confirmation', status: 'proposed' },
].map(d => ({ ...d, source: d.date === '2026-10-02' ? HANDOFF : 'docs/ARCHITECTURE.md' }));

const integrations = [
  { id: 'manual',    name: 'Manual verified updates',            kind: 'manual',   status: 'connected',    notes: 'Progress updates entered in this app. Always labeled "manual".' },
  { id: 'obsidian',  name: 'Obsidian Markdown import',            kind: 'snapshot', status: 'disconnected', notes: 'Drop .md files on the Import page. Retains file name and import date. A snapshot, not a live link.' },
  { id: 'dashboard', name: 'Old people/responsibilities dashboard import', kind: 'snapshot', status: 'disconnected', notes: 'Import CSV/JSON export of the old dashboard. Not located in this environment yet.' },
  { id: 'excel',     name: 'Excel schedule / selection imports',  kind: 'snapshot', status: 'disconnected', notes: 'Save the sheet as CSV and import. Retains source file name and date.' },
  { id: 'mchdb',     name: 'McVaugh database (read-only)',        kind: 'live',     status: 'disconnected', config: JSON.stringify({ base_url: 'http://db.mcvaugh.com/buildconnect/NewStuff/', auth: 'browser login (not stored here)' }), notes: 'Pages used by the existing skills: wotracking.html, potracking.html, budgetform.html. Requires a logged-in session; server only checks reachability.' },
  { id: 'quickbooks', name: 'QuickBooks reconciliation reports',  kind: 'snapshot', status: 'disconnected', notes: 'QuickBooks Desktop Enterprise: CSV exports (Transaction List by Vendor, P&L by Job). No direct API connection.' },
  { id: 'n8n',       name: 'n8n workflow events',                 kind: 'callback', status: 'disconnected', notes: 'n8n posts execution events to /api/webhooks/n8n with the shared secret. Duplicate execution ids are ignored; failures are retained; runs with no finish after 30 min show as stale.' },
  { id: 'pages',     name: 'ChatGPT Business Pages (handbook)',   kind: 'manual',   status: 'disconnected', notes: 'No supported read/write integration verified. Use Export → paste. Pages remain the handbook and decision reference.' },
].map(i => ({ ...i, last_checked: null }));

// Job list snapshot from the existing mch-budget-vs-actual skill JOB_MAP. This is a SNAPSHOT:
// it includes lots, HOA entities, offices and finished jobs. Active status is unknown until Brittany marks it.
const JOB_MAP = {
  '12705 1/2 W Houston Ctr Blvd': '807', '4710 Aftonshire Dr BUILDING': '821', '11623 Bistro Lane': '854', '3307 Bridgeberry': '840',
  '12437 Cobblestone Dr': '806', '4019 Del Bello Rd': '837', '5658 del Monte - GARAGE': '845', '5658 Del Monte Dr - R': '843',
  '411 Electra Dr': '834', '4219 Emory Ave': '829', '11434 Gallant Ridge - R 2023': '851', '22675 Highway 59 N Maintenance': '856',
  '22675 Highway 59 N Remodel': '827', '22675 Highway 59 N Repair': '826', 'Leander': '832', '3 Pebble Beach - Gym': '825',
  '11200 Richmond': '816', '11011 Richmond Ave, Ste. 615': '859', '11700 Richmond Avenue': '691', '11700 Richmond Avenue - REC CEN': '741',
  'ROCVTA': '814', '3030 Rosemary Park Ln': '305', '3035 Rosemary Park Ln': '303', '3035 Rosemary Park Ln - A': '792',
  '3035 Rosemary Park Ln - Home': '663', '3038 Rosemary Park Ln - LOT': '842', '3113 Royal Courtside Ave MCH': '833',
  '11619 Royal Ivory Crossing': '779', '11623 Royal Ivory Crossing': '780', '11627 Royal Ivory Crossing': '781', '11631 Royal Ivory Crossing': '782',
  '11635 Royal Ivory Crossing': '783', '11639 Royal Ivory Crossing': '784', '11643 Royal Ivory Crossing': '785', '11703 Royal Ivory Crossing': '786',
  '11707 Royal Ivory Crossing': '787', '11711 Royal Ivory Crossing': '788', '11715 Royal Ivory Crossing': '754', 'Royal Oaks Landing OA': '836',
  '3249 Royal Oaks Terrace Ln- PO': '818', '3300 Royal Palisades Ln': '790', '11602 Royal Parkside Place': '766', '11603 Royal Parkside Place': '767',
  '11606 Royal Parkside Place': '765', '11607 Royal Parkside Place': '768', '11611 Royal Parkside Place': '769', '11612 Royal Parkside Place': '764',
  '11515 Royal Plain Ave': '747', '11518 Royal Plain Ave': '760', '11519 Royal Plain Ave': '761', '11602 Royal Plain Ave': '759',
  '11603 Royal Plain Ave': '762', '11606 Royal Plain Ave': '758', '11614 Royal Plain Avenue': '852', '11515 Royal Plain Avenue - A': '848',
  '11502 Royal Portico - A': '838', '11602 Royal Veil Lane': '773', '11603 Royal Veil Lane': '774', '11606 Royal Veil Lane': '772',
  '11607 Royal Veil Lane': '709', '11610 Royal Veil Lane': '771', '11614 Royal Veil Lane': '855', '17007 S. Bear Creek': '850',
  '17007 S. Bear Creek Drive - LOT': '846', '11419 St Germain - LOT': '841', '11419 St Germain Way': '849', '11415 St. Germain Way': '828',
  '3514 St. Tropez Way': '857', '3514 St. Tropez Way - LOT': '858', '8318 Thaxton Road': '830', 'Your Home Experts': '696',
};

function guessKind(addr) {
  const a = addr.toLowerCase();
  if (/\blot\b/.test(a)) return 'lot';
  if (/rocvta|landing oa|hoa/.test(a)) return 'hoa';
  if (/ste\.|suite|highway 59|richmond|home experts|building|gym|rec cen/.test(a)) return 'other';
  return 'unknown';
}

function seedIfEmpty(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;
  if (count > 0) return false;
  const ts = nowIso();
  db.exec('BEGIN');
  try {
    for (const d of departments) upsert(db, 'departments', d);
    for (const p of people) upsert(db, 'people', p);
    for (const a of agents) upsert(db, 'agents', a);
    for (const t of [...procTasks, ...implTasks]) upsert(db, 'tasks', t);
    for (const d of decisions) upsert(db, 'decisions', d);
    for (const i of integrations) upsert(db, 'integrations', i);
    for (const a of agents) {
      upsert(db, 'ai_configs', {
        id: 'ai-' + a.id, agent_id: a.id, purpose: a.initial_output,
        needs_ai: a.approach === 'rules' ? 'no_rules' : (a.approach === 'undecided' ? 'undecided' : 'yes'),
        provider: a.approach === 'rules' ? 'none (deterministic code)' : 'configurable — see config/models.json',
        model: a.approach === 'rules' ? '' : '(not chosen; verify availability first)',
        why: a.approach_note,
        expected_cost: a.approach === 'rules' ? '$0 model cost (hosting only)' : 'Unknown until volume is measured. API usage is billed separately from ChatGPT Business / Claude Team seats.',
        approval: 'Human approval required for any action beyond read/flag/draft.',
        eval_examples: 'To collect: 5 real examples with expected output before enabling.',
        fallback: 'Flag for human review; never act silently.',
      });
    }
    for (const [address, job_id] of Object.entries(JOB_MAP)) {
      upsert(db, 'homes', { id: 'job-' + job_id, address, job_id, active: 'unknown', kind: guessKind(address),
        source: 'Snapshot: JOB_MAP in mch-budget-vs-actual skill', imported_at: ts, notes: 'Imported from skill snapshot. Active status not confirmed.' });
    }
    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(ts, 'gather',
      'Stage 1: visual world, registry, and saved state are built. Review what was seeded from the handoff.',
      'Discovery conversation and handoff (2026-10-02). Stage 1 build (2026-10-06).',
      'Open "Brittany" in the Executive building and mark her responsibilities Verified — then do the same for Jim.',
      'Brittany (source access to MCH-DB on the Windows machine)',
      'Confirm the SQLite store decision; confirm the reuse decision for the existing skills.',
      'Seeded automatically. Everything marked PROPOSED still needs review with the team.', 'system');
    addEvent(db, { entity_type: 'system', entity_id: 'app', kind: 'setup', status: 'info', label: 'Database seeded from handoff', source: 'system', external_id: 'seed-' + ts });
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)').run('seeded_at', ts);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}


// Keyed data updates applied once per database (also to databases seeded before the update existed).
// Each entry records facts Brittany supplied, with source and date.
const UPDATES = [
  { key: 'active-jobs-2026-10-06', apply(db) {
    const src = 'Brittany, loan-tracking screen (2026-10-06)'; const ts = nowIso();
    const permits = [...[12030, 12032, 12034, 12036].map(n => `${n} Royal Oaks Run Dr`), ...[12051, 12053, 12055, 12057, 12059, 12061].map(n => `${n} Royal Oaks Banner Way`)];
    for (const address of permits) {
      const ex = db.prepare('SELECT id FROM homes WHERE lower(address) = lower(?)').get(address);
      upsert(db, 'homes', { id: ex?.id || 'home-' + address.toLowerCase().replace(/[^a-z0-9]+/g, '-'), address, kind: 'home', active: 'active', stage: 'Waiting for permits to start', source: src, imported_at: ts, notes: 'Active job per Brittany. Not in the skill job map; MCH Job ID to confirm.' });
    }
    for (const [id, address] of [['job-766', '11602 Royal Parkside Place'], ['job-767', '11603 Royal Parkside Place']]) {
      upsert(db, 'homes', { id, address, kind: 'home', active: 'active', stage: 'In progress (construction loan drawn)', source: src, imported_at: ts, notes: 'Active job per Brittany. Stage inferred from loan draws on the bank screen; confirm construction stage.' });
    }
    upsert(db, 'tasks', { id: 'impl-confirm-13th-home', title: 'Confirm the 13th active home (one row was redacted on the loan screen)', department_id: 'exec', owner_id: 'brittany', board: 'next', project_stage: 'gather', proposed: 0, documented: 1, source: src, next_action: 'Open Registry → Homes and mark the missing active job; add its MCH Job ID.' });
    addEvent(db, { entity_type: 'integration', entity_id: 'manual', kind: 'import', status: 'info', label: 'Manual: 12 active jobs recorded from Brittany (10 waiting for permits, 2 in progress)', source: 'manual', actor: 'brittany', external_id: 'update-active-jobs-2026-10-06' });
  } },
  { key: 'org-chart-10-24-25', apply(db) {
    // Company Organizational Chart as of 10.24.25, supplied by Brittany on 2026-10-06. Titles are as printed on the chart;
    // the handoff's role summaries are kept because they describe current implementation roles.
    const src = 'Company Organizational Chart (10.24.25), via Brittany 2026-10-06'; const ts = nowIso();
    const rows = [
      ['jim',      'Jim McVaugh',      'CEO',                              null,      'jim@mcvaugh.com',        ['exec', 'design']],
      ['pam',      'Pamela McVaugh',   'Sales Broker / Manager',           'jim',     'pam@mcvaugh.com',        ['design', 'marketing']],
      ['teresa',   'Teresa Teran',     'Executive Assistant / HR',         'jim',     'tteran@mcvaugh.com',     ['exec']],
      ['kenneth',  'Kenneth Chapman',  'Senior Accounting Manager',        'jim',     'kchapman@mcvaugh.com',   ['accounting']],
      ['maria',    'Maria Abney',      'Senior Project Manager',           'jim',     'mabney@mcvaugh.com',     ['construction', 'purchasing']],
      ['james',    'James McVaugh',    'Sales / Marketing Coordinator',    'pam',     'james@mcvaugh.com',      ['design', 'marketing']],
      ['brittany', 'Brittany McVaugh', 'Accounting Assistant',             'kenneth', 'brittany@mcvaugh.com',   ['exec', 'accounting']],
      ['ernesto',  'Ernesto Vazquez',  'Purchasing',                       'maria',   'evazquez@mcvaugh.com',   ['purchasing']],
    ];
    for (const [id, full_name, title, reports_to, email, departments] of rows) {
      const ex = db.prepare('SELECT id, departments FROM people WHERE id = ?').get(id);
      const merged = ex ? [...new Set([...JSON.parse(ex.departments || '[]'), ...departments])] : departments;
      upsert(db, 'people', { id, name: ex ? undefined : full_name.split(' ')[0], full_name, title, reports_to, email, departments: merged, confirmed: 1,
        ...(ex ? {} : { role_summary: title + ' (per org chart; responsibilities not yet reviewed)', review_status: 'not_reviewed', source: src, notes: 'On the 10.24.25 org chart but not in the assessment handoff.' }) });
    }
    upsert(db, 'people', { id: 'teresa', notes: 'On the 10.24.25 org chart but not in the assessment handoff. Shared mailbox accounting@mcvaugh.com is listed under Kenneth; purchasing@mcvaugh.com under Ernesto.' });
    upsert(db, 'people', { id: 'danielle', notes: 'Confirmed in the handoff (selections/design when assigned). Not on the 10.24.25 org chart — confirm current status.' });
    addEvent(db, { entity_type: 'integration', entity_id: 'manual', kind: 'import', status: 'info', label: 'Manual: org chart 10.24.25 recorded (8 people, titles, reporting lines; Teresa and Ernesto added)', source: 'manual', actor: 'brittany', external_id: 'update-org-chart-10-24-25' });
    upsert(db, 'decisions', { id: 'dec-org-chart', date: '2026-10-06', title: 'Org chart 10.24.25 is the reference for titles and reporting lines', reason: 'Supplied by Brittany. Danielle is not on it; shared mailboxes accounting@ and purchasing@ exist.', decided_by: 'Brittany', status: 'approved', source: src });
  } },
  { key: 'ops-hub-2026-10-06', apply(db) {
    // The old MCH Operations Hub (mch-ops-hub.jsx) data: 21 SOPs, 16 legacy roles, current-team responsibilities. Re-importable from Integrations.
    const { importOpsHub } = require('./imports');
    const content = fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.json'), 'utf8');
    importOpsHub(db, { filename: 'seed/mch-ops-hub.json', content }, 'system');
    upsert(db, 'integrations', { id: 'dashboard', status: 'connected', last_import_at: nowIso(), last_message: 'Snapshot: old ops hub data seeded from seed/mch-ops-hub.json (supplied 2026-10-06). Re-import the .jsx from Integrations when it changes.' });
  } },
  { key: 'db-procedures-doc-2026-10-06', apply(db) {
    // PROCEDURES FOR THE MCH DATABASE.doc (Maria Abney, 2019) — text extracted from the Word 97 binary; screenshots omitted.
    const text = fs.readFileSync(path.join(__dirname, '..', 'seed', 'procedures-for-the-mch-database.txt'), 'utf8');
    const src = 'PROCEDURES FOR THE MCH DATABASE.doc (Maria Abney, 2019-01-28), via Brittany 2026-10-06';
    const id = 'obs-procedures-for-the-mch-database';
    const ex = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
    upsert(db, 'tasks', { id, title: 'Procedures for the MCH Database (subcontractor work-order guide)', department_id: 'construction', owner_id: 'maria', backup_id: 'ernesto',
      trigger: 'A subcontractor is assigned work on a job.', steps: text, documented: 1, source: src, source_link: 'http://db.mcvaugh.com/buildconnect/NewStuff/jobmenu.html',
      evidence: 'Work order accepted in the database (New WO → name); completion box clicked; superintendent verifies 100% complete and within scope.',
      approval_rules: 'Only amounts in the database are paid; any scope change needs approval and an additional work order.',
      missing_info: 'Written 2019 for subcontractors. Confirm the superintendent verification step now sits with Maria, and what the "Accounts Payable letter" is.',
      next_action: 'Maria confirms this is still how trades are told to use the database.', ...(ex ? {} : { proposed: 1, board: 'next' }) });
    upsert(db, 'documents', { id: 'doc-procedures-for-the-mch-database', title: 'Procedures for the MCH Database', path: 'PROCEDURES FOR THE MCH DATABASE.doc', kind: 'procedure', kind_reason: 'Word 97 .doc, text extracted by the build (binary scan)', sensitive: 0, task_id: id, department_id: 'construction', summary: 'Subcontractor-facing guide to accepting and completing work orders in db.mcvaugh.com.', content: text, size: text.length, source: src, imported_at: nowIso(), underlying_path: 'PROCEDURES FOR THE MCH DATABASE.doc', underlying_status: 'extracted' });
    addEvent(db, { entity_type: 'task', entity_id: id, kind: 'import', status: 'info', label: 'Imported: Procedures for the MCH Database (.doc text, 2019)', source: 'import', actor: 'system', external_id: 'update-db-procedures-2026-10-06' });
  } },
  { key: 'ops-hub-2026-10-20', apply(db) {
    // Updated hub supplied 2026-10-20 (mch-ops-hub.html). Same importer; review decisions on existing tasks are kept.
    const { importOpsHub } = require('./imports');
    const content = fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.json'), 'utf8');
    importOpsHub(db, { filename: 'seed/mch-ops-hub.json (2026-10-20)', content }, 'system');
    upsert(db, 'integrations', { id: 'dashboard', status: 'connected', last_import_at: nowIso(), last_message: 'Snapshot: ops hub re-imported from the 2026-10-20 .html (25 SOPs; Maria\'s [N/A] cross-offs recorded).' });
    addEvent(db, { entity_type: 'integration', entity_id: 'dashboard', kind: 'import', status: 'info', label: 'Hub 2026-10-20: +4 accounting SOPs; Maria +58/−29 responsibilities (19 crossed off); James +13; Ernesto new purchasing-manager job description; Brittany +50; Kenneth +25', source: 'import', actor: 'system', external_id: 'update-ops-hub-2026-10-20' });
  } },
  { key: 'stage2-checkpoint-2026-10-06', apply(db) {
    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author) VALUES (?,?,?,?,?,?,?,?,?)`).run(nowIso(), 'gather',
      'Stage 2: the old ops hub (21 SOPs, responsibilities for all 8 people) and the org chart are imported. Work through the Review tab one item at a time.',
      'Stage 1 build (visual world, registry, saved state). Stage 2 build (folder import with skip-unchanged, import preview, review queue with merge). 12 active jobs recorded.',
      'Review tab → Maria first: her card now lists 54 responsibilities absorbed from DOC / Superintendent / PM / CA. Mark what is right, note what is not.',
      'Brittany (old dashboard export and a few real Obsidian notes, so the mapping can be checked); Brittany (which job is the 13th active home)',
      'Confirm the SQLite store decision; confirm the reuse decision for the existing skills.',
      'Added by the Stage 2 build. Save your own checkpoint when you stop.', 'system');
  } },
  { key: 'succession-2026-10-20', apply(db) {
    const S = require('../seed/succession-2026-10-20.js');
    const ts = nowIso();
    // 1. meetings as dated documents with provenance
    for (const m of S.MEETINGS) {
      const text = fs.readFileSync(path.join(__dirname, '..', m.file), 'utf8');
      upsert(db, 'documents', { id: m.id, title: m.title, path: m.file, kind: 'meeting', kind_reason: 'meeting transcript', sensitive: 0, summary: m.summary, content: text, size: text.length,
        source: m.source, imported_at: ts, meeting_date: m.date, attendees: JSON.stringify(m.attendees), cite_key: m.cite, underlying_status: 'extracted' });
      addEvent(db, { entity_type: 'document', entity_id: m.id, kind: 'import', status: 'info', label: `Meeting transcript stored: ${m.date} ${m.title}`, source: 'import', actor: 'brittany', external_id: 'meeting-' + m.id });
    }
    // 2. step-by-step reconciliation written into each task
    const verdictWord = { match: 'MATCH', changed: 'CHANGED', no_longer: 'NO LONGER DONE', not_mentioned: 'NOT MENTIONED', new: 'NEW (confirmed)' };
    for (const [taskId, rows] of Object.entries(S.STEP_REVIEWS)) {
      const t = db.prepare('SELECT id, missing_info, verification_result FROM tasks WHERE id = ?').get(taskId); if (!t) continue;
      const counts = {}; for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
      const summary = Object.entries(counts).map(([k, n]) => `${n} ${verdictWord[k].toLowerCase()}`).join(', ');
      const notMentioned = rows.filter(r => r.verdict === 'not_mentioned').map(r => `step ${r.n}: ${r.old}`);
      const vr = `Reconciled against meetings 2026-10-12 (Jim) and 2026-10-16 (Maria): ${summary}. Steps marked MATCH or CHANGED/NEW with a citation are confirmed current; everything else stays "from old SOP, unconfirmed". See the step table on this task.`;
      const mi = [t.missing_info, notMentioned.length ? `Not mentioned in either meeting (unconfirmed): ${notMentioned.join('; ')}.` : null].filter(Boolean).join(' ');
      upsert(db, 'tasks', { id: taskId, step_review: JSON.stringify(rows), verification_result: vr, missing_info: mi, verified: 0 });
      addEvent(db, { entity_type: 'task', entity_id: taskId, kind: 'setup', status: 'info', label: `Step review written from transcripts (${summary})`, source: 'import', actor: 'brittany', external_id: 'stepreview-' + taskId });
    }
    // 3. procedures confirmed in the transcripts that had no SOP
    for (const n of S.NEW_TASKS) { const ex = db.prepare('SELECT id FROM tasks WHERE id = ?').get(n.id); upsert(db, 'tasks', { ...n, source: n.source + ' (transcript)', ...(ex ? { proposed: undefined, board: undefined } : {}) }); }
    // 4. flow charts
    for (const [taskId, flow] of Object.entries(S.FLOWS)) { if (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)) upsert(db, 'tasks', { id: taskId, flow: JSON.stringify(flow) }); }
    // 5. job status
    for (const h of S.HOME_STATUS) {
      const home = db.prepare('SELECT id FROM homes WHERE lower(address) = lower(?)').get(h.match); if (!home) continue;
      upsert(db, 'homes', { id: home.id, stage: h.stage, permits: h.permits, trades: h.trades, issues: h.issues, next_milestone: h.next_milestone, status_cite: h.cite + ' (Maria meeting 2026-10-16)' });
      addEvent(db, { entity_type: 'home', entity_id: home.id, kind: 'note', status: 'info', label: `Status from Maria meeting 2026-10-16: ${h.stage}`, source: 'import', actor: 'brittany', external_id: 'homestatus-' + home.id });
    }
    for (const home of db.prepare("SELECT id, notes FROM homes WHERE active = 'active' AND (address LIKE '%Royal Oaks Run%' OR address LIKE '%Royal Oaks Banner%')").all()) {
      upsert(db, 'homes', { id: home.id, permits: 'Waiting for permits (Brittany 10/06). ' + S.VILLAS_NOTE.active_waiting, status_cite: S.VILLAS_NOTE.cite + ' (Maria meeting 2026-10-16)', next_milestone: 'Confirm with Maria whether this lot is one of the 7 with permits approved/near-complete; pay impact fees when the bank/Jim says start.' });
    }
    // 6. handover items
    for (const h of S.HANDOVER) upsert(db, 'handover_items', { ...h, person_id: 'maria', status: 'open' });
    upsert(db, 'people', { id: 'maria', notes: 'LEAVING — succession pass in progress (meetings 2026-10-12 with Jim, 2026-10-16 with Maria). See the Handover tab.' });
    upsert(db, 'decisions', { id: 'dec-maria-succession', date: '2026-10-20', title: 'Maria is leaving; her work is being documented for a successor', reason: 'Maria knows and is putting everything in Public > Company information > MCH > Workflow processes > "Maria leaving". A construction manager who can schedule on site is needed (Maria, 2026-10-16 23:06).', decided_by: 'Brittany, Jim', status: 'approved', source: 'Maria meeting 2026-10-16' });
    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author) VALUES (?,?,?,?,?,?,?,?,?)`).run(ts, 'map',
      'Succession pass for Maria: transcripts reconciled against the old SOPs; Handover tab lists what only she does.',
      'Hub refreshed to the 2026-10-20 version. Two meeting transcripts stored. 12 SOPs step-reviewed; 13 procedures confirmed from the meetings; 6 flow charts; 11603/11602 status recorded.',
      'Open the Handover tab, read the "no backup" items, then take the generated agenda into the next meeting with Maria (Landing is the planned topic).',
      'Maria (permit document, schedule document, vendor/rate list, 11603 calendar copy, Frank scope doc); Jim (WO approval chain after Maria)',
      'Who approves work orders after Maria leaves; Teresa vs James for Leander ARC; who owns vendor insurance.',
      'Added by the succession pass.', 'system');
  } },
  { key: 'handover-links-2026-10-20', apply(db) {
    const S = require('../seed/succession-2026-10-20.js'); const ts = nowIso();
    for (const t of S.EXTRA_TASKS) { const ex = db.prepare('SELECT id FROM tasks WHERE id = ?').get(t.id); upsert(db, 'tasks', { ...t, ...(ex ? { proposed: undefined, board: undefined } : {}) }); }
    for (const [taskId, flow] of Object.entries(S.EXTRA_FLOWS)) if (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)) upsert(db, 'tasks', { id: taskId, flow: JSON.stringify(flow) });
    for (const d of S.DOC_PLACEHOLDERS) {
      if (db.prepare('SELECT file_path FROM documents WHERE id = ?').get(d.id)?.file_path) continue; // already uploaded by Brittany
      upsert(db, 'documents', { id: d.id, title: d.title, path: null, kind: d.kind, kind_reason: 'referred to in a meeting; not attached yet', sensitive: 0, task_id: d.task_id, summary: d.summary + ' ' + d.cite, source: 'Maria meeting 2026-10-16 ' + d.cite, imported_at: ts, underlying_status: 'not_attached' });
      const t = db.prepare('SELECT doc_ids FROM tasks WHERE id = ?').get(d.task_id); if (t) { const ids = JSON.parse(t.doc_ids || '[]'); if (!ids.includes(d.id)) upsert(db, 'tasks', { id: d.task_id, doc_ids: [...ids, d.id] }); }
    }
    for (const [hid, l] of Object.entries(S.HANDOVER_LINKS)) if (db.prepare('SELECT 1 FROM handover_items WHERE id = ?').get(hid)) upsert(db, 'handover_items', { id: hid, task_ids: l.tasks, doc_ids: l.docs, why: S.HANDOVER_WHY[hid] || null });
  } },
  { key: 'meeting-3-2026-10-20', apply(db) {
    const M = require('../seed/meeting-2026-10-20.js'); const ts = nowIso();
    const text = fs.readFileSync(path.join(__dirname, '..', M.MEETING.file), 'utf8');
    upsert(db, 'documents', { id: M.MEETING.id, title: M.MEETING.title, path: M.MEETING.file, kind: 'meeting', kind_reason: 'meeting transcript', sensitive: 0, summary: M.MEETING.summary, content: text, size: text.length, source: M.MEETING.source, imported_at: ts, meeting_date: M.MEETING.date, attendees: JSON.stringify(M.MEETING.attendees), cite_key: M.MEETING.cite, underlying_status: 'extracted' });
    addEvent(db, { entity_type: 'document', entity_id: M.MEETING.id, kind: 'import', status: 'info', label: `Meeting transcript stored: ${M.MEETING.date} ${M.MEETING.title}`, source: 'import', actor: 'brittany', external_id: 'meeting-' + M.MEETING.id });
    for (const [taskId, rows] of Object.entries(M.STEP_REVIEW_APPEND)) {
      const t = db.prepare('SELECT step_review, verification_result FROM tasks WHERE id = ?').get(taskId); if (!t) continue;
      const existing = JSON.parse(t.step_review || '[]');
      // a later meeting's finding on the same step replaces the earlier verdict for that step
      const span = n => { const m = String(n).match(/^(\d+)\s*[–-]\s*(\d+)$/); if (m) { const a = []; for (let i = +m[1]; i <= +m[2]; i++) a.push(String(i)); return a; } return [String(n)]; };
      const covered = new Set(rows.filter(n => n.n !== 'new').flatMap(n => span(n.n)));
      const merged = existing.filter(r => r.n === 'new' || !span(r.n).some(x => covered.has(x))).concat(rows);
      upsert(db, 'tasks', { id: taskId, step_review: JSON.stringify(merged), verification_result: (t.verification_result || '') + ` Updated from the 2026-10-20 call: ${rows.map(r => `${r.n} ${r.verdict.replace('_', ' ')}`).join('; ')}.` });
      addEvent(db, { entity_type: 'task', entity_id: taskId, kind: 'setup', status: 'info', label: 'Step review updated from the 2026-10-20 call', source: 'import', actor: 'brittany', external_id: 'stepreview3-' + taskId });
    }
    for (const n of M.NEW_TASKS) { const ex = db.prepare('SELECT id FROM tasks WHERE id = ?').get(n.id); upsert(db, 'tasks', { ...n, ...(ex ? { proposed: undefined, board: undefined } : {}) }); }
    for (const h of M.HOME_UPDATES) {
      let home = db.prepare('SELECT * FROM homes WHERE lower(address) = lower(?)').get(h.match); if (!home) continue;
      upsert(db, 'homes', { id: home.id, stage: h.stage || undefined, active: h.active || undefined, kind: h.kind || undefined, notes: [home.notes, h.notes_add + ' ' + h.cite].filter(Boolean).join('\n'), status_cite: [home.status_cite, h.cite + ' (Maria call 2026-10-20)'].filter(Boolean).join('; ') });
      addEvent(db, { entity_type: 'home', entity_id: home.id, kind: 'note', status: 'info', label: `From Maria call 2026-10-20: ${h.notes_add.slice(0, 80)}`, source: 'import', actor: 'brittany', external_id: 'home3-' + home.id });
    }
    for (const u of M.HANDOVER_UPDATES) { const ex = db.prepare('SELECT note FROM handover_items WHERE id = ?').get(u.id); if (!ex) continue; upsert(db, 'handover_items', { ...u, note: [ex.note, u.note].filter(Boolean).join('\n') }); }
    for (const h of M.NEW_HANDOVER) upsert(db, 'handover_items', { ...h, person_id: 'maria', status: 'open' });
    for (const [newId, olds] of Object.entries(M.SUPERSEDES)) if (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(newId)) upsert(db, 'tasks', { id: newId, supersedes: olds });
    upsert(db, 'people', { id: 'maria', notes: 'LEAVING — last day before Nov 9 ("November 3rd I\'m still here; worry about November 9th") [M3 5:37]. Succession pass in progress; see the Handover tab.' });
    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author) VALUES (?,?,?,?,?,?,?,?,?)`).run(ts, 'map',
      'Succession pass: three meetings reconciled; Procedures tab shows old vs new; Maria leaves before Nov 9.',
      'Meeting 3 (2026-10-20 call) stored: plan types per address, Landing supervision scopes, change orders outside the database, inspection binder, budget-increase-as-log.',
      'Friday 10/23 meeting with Maria: take the agenda (Landing supervision, inspection binder, square-footage sheet, 11603 calendar photo). Upload the scopes doc and the inspections/fees doc when they arrive.',
      'Maria (scopes doc 10/20, calendar photo, square-footage sheet, permit resubmittal recording); Frank\'s company (Landing schedule)',
      'Who calls Landing inspections after Nov 9; who prices change orders after Maria; whether Kenneth owns insurance tracking.',
      'Added by the meeting-3 update.', 'system');
  } },
  { key: 'sow-vendors-2026-10-21', apply(db) {
    // SOW_subs_pricing_contractor_info.xlsx supplied by Brittany 2026-10-21 — the vendor/rate list Maria promised [M 18:59] with the contact columns she said she would add [M3 7:43].
    const { importSow } = require('./imports'); const ts = nowIso();
    const fp = path.join(__dirname, '..', 'seed', 'files', 'SOW_subs_pricing_contractor_info.xlsx'); const buf = fs.readFileSync(fp);
    const src = 'SOW_subs_pricing_contractor_info.xlsx (Maria), via Brittany 2026-10-21';
    const n = importSow(db, buf, src);
    const { xlsxText } = require('./imports'); const text = xlsxText(buf);
    upsert(db, 'documents', { id: 'doc-sow-excel', title: 'SOW — subs, pricing, contractor info (Excel)', path: 'SOW_subs_pricing_contractor_info.xlsx', kind: 'reference', kind_reason: 'supplied by Brittany 2026-10-21', sensitive: 1, task_id: 'tr-bids-and-sqft-rates',
      summary: `Two sheets: Purchasing (trade → subcontractor type, documents to provide, current $/sf, notes/lead times) and Construction (trade → current vendor, contact names, phone/email, who to call for bidding vs scheduling). ${n} trades.`, size: buf.length, source: src, imported_at: ts, file_path: fp, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: text.slice(0, 200 * 1024), underlying_status: 'extracted', underlying_path: 'SOW_subs_pricing_contractor_info.xlsx' });
    for (const hid of ['ho-work-orders', 'ho-bids-vendors']) { const h = db.prepare('SELECT doc_ids, note, documented FROM handover_items WHERE id = ?').get(hid); if (!h) continue; const ids = JSON.parse(h.doc_ids || '[]'); if (!ids.includes('doc-sow-excel')) ids.unshift('doc-sow-excel'); upsert(db, 'handover_items', { id: hid, doc_ids: ids, documented: hid === 'ho-bids-vendors' ? 'yes (SOW Excel 10/21: vendors, contacts, $/sf)' : h.documented, note: [h.note, `10/21: SOW Excel received — ${n} trades with current vendor, contacts and $/sf rates; square footage per plan still missing.`].filter(Boolean).join('\n') }); }
    const t = db.prepare('SELECT doc_ids FROM tasks WHERE id = ?').get('tr-bids-and-sqft-rates'); if (t) { const ids = JSON.parse(t.doc_ids || '[]'); if (!ids.includes('doc-sow-excel')) upsert(db, 'tasks', { id: 'tr-bids-and-sqft-rates', doc_ids: [...ids, 'doc-sow-excel'], documented: 1, inputs: 'SOW Excel (10/21): per trade — subcontractor type, documents to provide for bidding, current $/sf, lead-time notes; Construction sheet — current vendor and who to call for bidding vs field scheduling. See Registry → Vendors.' }); }
    upsert(db, 'integrations', { id: 'excel', status: 'connected', last_import_at: ts, last_message: `Snapshot: SOW Excel seeded (${n} trades)` });
    addEvent(db, { entity_type: 'integration', entity_id: 'excel', kind: 'import', status: 'info', label: `Snapshot import: SOW_subs_pricing_contractor_info.xlsx → ${n} vendors`, source: 'import', actor: 'brittany', external_id: 'update-sow-2026-10-21' });
  } },
  { key: 'wo-entry-skill-2026-10-22', apply(db) {
    const ts = nowIso();
    // Pricing basis from the SOW rate column: "$7.50/SF" → per square foot (the WO must carry the trade's square footage); fixed dollar amounts → fixed; blank → per bid / unknown.
    for (const v of db.prepare('SELECT id, trade, rate, vendor FROM vendors').all()) {
      const r = String(v.rate || '');
      const basis = /\/\s*(sf|sq\.?\s*ft|square)/i.test(r) ? 'per_sqft' : /\$\s*[\d,]+/.test(r) ? 'fixed' : 'per_bid';
      const johnston = /johnston/i.test(v.vendor || '');
      upsert(db, 'vendors', { id: v.id, pricing_basis: basis,
        wo_review: johnston ? 'reusable' : 'needs_review',
        wo_instructions: johnston ? 'Standard pricing — lump sum per approved bid/invoice, not per square foot. The ChatGPT skill "enter work order from approved bid" (Brittany, 2026-10-21) works for this vendor as-is.'
          : basis === 'per_sqft' ? `Pricing is per square foot (${r.trim()}). The work order must carry the trade's square footage × rate; square footage differs by trade (framer = total covered, sheetrock excludes balconies, trim = AC area) [M 38:30–39:20]. Review before reusing the bid-entry skill.`
          : basis === 'fixed' ? `Fixed prices listed (${r.trim()}). Check the bid matches the listed unit prices; review before reusing the bid-entry skill.`
          : 'Pricing comes from the bid. Review the vendor\'s bid format once before reusing the bid-entry skill.' });
    }
    upsert(db, 'tasks', { id: 'tr-wo-entry-from-bid', title: 'Enter a work order into the database from a subcontractor\'s approved bid (ChatGPT skill)', department_id: 'purchasing', owner_id: 'brittany', backup_id: 'ernesto', proposed: 0, documented: 1, automated: 1, verified: 0, board: 'working',
      trigger: 'A subcontractor bid/invoice is approved (within budget — see Budget check) and a work order must be entered in db.mcvaugh.com.',
      inputs: 'Approved bid or invoice (PDF/email); job address; the vendor\'s pricing basis (Registry → Vendors → WO instructions).',
      steps: '1. Confirm the bid is within the budget line (Jim approves otherwise).\n2. Run the ChatGPT skill with the bid: it drafts the WO fields (vendor, job, cost code, description, amount, draws).\n3. Check the vendor\'s WO instructions: per-square-foot vendors need square footage × rate on the WO; standard-priced vendors (Johnston Waterproofing) can be entered as drafted.\n4. Enter/accept the WO in the database; the database emails the sub; the sub accepts = price agreed [M 58:18–59:32].',
      approval_rules: 'Human enters and approves every WO; the skill only drafts. Over-budget needs Jim [J 10/12].',
      automation_approach: 'ChatGPT skill (Business seat — no API cost) reads the bid and drafts WO fields. Deterministic checks around it: budget line (rules), pricing basis per vendor (rules). Built and used by Brittany for Johnston Waterproofing (2026-10-21). Every other vendor must be reviewed once for special instructions before the skill is trusted for it.',
      verification_result: 'Verified for one vendor only: Johnston Waterproofing (standard pricing). All other vendors: WO review = needs_review (see Registry → Vendors).', evidence: 'A work order in the database created from a bid with the skill, accepted by the sub.',
      next_action: 'Review the next vendor\'s bid format (suggest Andrade Concrete: per-sq-ft slab) and mark its WO review.', source: 'Brittany, 2026-10-21 (ChatGPT skill built); Maria meeting 2026-10-16', supersedes: ['hub-new_work_order'], agent_id: 'agent-purchasing' });
    upsert(db, 'ai_configs', { id: 'ai-wo-entry-from-bid', agent_id: 'agent-purchasing', purpose: 'Read an approved subcontractor bid/invoice and draft the work-order fields for db.mcvaugh.com', needs_ai: 'yes', provider: 'ChatGPT Business (existing seat) — custom skill', model: 'as configured in the ChatGPT skill (not an API call)', why: 'Bids are unstructured documents; extracting vendor/amount/scope needs document understanding. Budget check and pricing basis stay deterministic.', expected_cost: '$0 beyond the existing ChatGPT Business seat', approval: 'Brittany/Ernesto review the draft and enter the WO; nothing is written automatically', eval_examples: 'Johnston Waterproofing bid (2026-10-21) → correct WO. To add: one per-sq-ft vendor (framer), one fixed-price vendor (garage door), one lumber PO with draws.', fallback: 'Type the WO manually from the bid (about one minute per Maria [M 35:12]).', updated_at: ts });
    upsert(db, 'documents', { id: 'doc-wo-entry-skill', title: 'ChatGPT skill: enter work order from approved bid (definition/prompt)', path: null, kind: 'procedure', kind_reason: 'built by Brittany 2026-10-21; export the skill text and attach', sensitive: 0, task_id: 'tr-wo-entry-from-bid', summary: 'The skill instructions as written in ChatGPT. Attach the exported text so a successor can recreate it.', source: 'Brittany 2026-10-21', imported_at: ts, underlying_status: 'not_attached' });
    upsert(db, 'documents', { id: 'doc-how-to-build-a-house', title: 'How to build a house (Maria)', path: null, kind: 'procedure', kind_reason: 'referred to by Brittany 2026-10-22; in L:\\COMPANY INFORMATION\\MCH\\WORKFLOW PROCESSES\\MARIA LEAVING', sensitive: 0, task_id: 'tr-schedule-and-trade-coordination', summary: 'Maria\'s document on the order and tasks of building a house — the "basic schedule, at least the tasks that go into building a house" she promised [M3 26:23]. Attach from the Maria leaving folder (Option 3 import or Upload).', source: 'Brittany 2026-10-22', imported_at: ts, underlying_status: 'not_attached' });
    for (const [tid, did] of [['tr-wo-entry-from-bid', 'doc-wo-entry-skill'], ['tr-schedule-and-trade-coordination', 'doc-how-to-build-a-house']]) { const t = db.prepare('SELECT doc_ids FROM tasks WHERE id = ?').get(tid); if (t) { const ids = JSON.parse(t.doc_ids || '[]'); if (!ids.includes(did)) upsert(db, 'tasks', { id: tid, doc_ids: [...ids, did] }); } }
    for (const [hid, did] of [['ho-scheduling', 'doc-how-to-build-a-house'], ['ho-trade-calls', 'doc-how-to-build-a-house'], ['ho-work-orders', 'doc-wo-entry-skill']]) { const h = db.prepare('SELECT doc_ids, task_ids FROM handover_items WHERE id = ?').get(hid); if (h) { const ids = JSON.parse(h.doc_ids || '[]'); if (!ids.includes(did)) upsert(db, 'handover_items', { id: hid, doc_ids: [...ids, did], ...(hid === 'ho-work-orders' ? { task_ids: [...new Set([...JSON.parse(h.task_ids || '[]'), 'tr-wo-entry-from-bid'])] } : {}) }); } }
    upsert(db, 'integrations', { id: 'obsidian', notes: 'Drop .md files on the Import page, or point Option 3 at a folder: .md, .csv, .docx, .xlsx, .pdf, .html are all taken; office files attach to the waiting document cards they match. Snapshot, not a live link.' });
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('import_dir', ?)").run('L:\\COMPANY INFORMATION\\MCH\\WORKFLOW PROCESSES\\MARIA LEAVING');
    addEvent(db, { entity_type: 'task', entity_id: 'tr-wo-entry-from-bid', kind: 'setup', status: 'info', label: 'Manual: ChatGPT WO-entry skill recorded; verified for Johnston Waterproofing only; other vendors flagged needs_review', source: 'manual', actor: 'brittany', external_id: 'update-wo-skill-2026-10-22' });
  } },
  { key: 'build-sequence-2026-10-22', apply(db) {
    // "How to build a house" — the document Maria promised in the 10/20 meeting [M3 26:23], supplied by Brittany 2026-10-22.
    // 100+ ordered steps: Description | Responsible Party (currently at villas) | Notes. This is the first written
    // answer to "what order does a McVaugh house get built in", so it is imported as ordered steps, not as one blob.
    const { importSow, importBuildSequence, xlsxText, redactCredentials } = require('./imports'); const ts = nowIso();
    // The same send also carried an updated SOW (two third-party inspection vendors added): re-import it first so
    // the build steps can match their responsible party to a vendor record.
    const sowFp = path.join(__dirname, '..', 'seed', 'files', 'SOW_subs_pricing_contractor_info.xlsx');
    const nSow = importSow(db, fs.readFileSync(sowFp), 'SOW_subs_pricing_contractor_info.xlsx (Maria), via Brittany 2026-10-22 (updated)');
    for (const v of db.prepare("SELECT id, trade, rate, vendor, wo_review FROM vendors WHERE wo_review IS NULL").all()) {
      const r = String(v.rate || '');
      upsert(db, 'vendors', { id: v.id, pricing_basis: /\/\s*(sf|sq\.?\s*ft|square)/i.test(r) ? 'per_sqft' : /\$\s*[\d,]+/.test(r) ? 'fixed' : 'per_bid', wo_review: 'needs_review',
        wo_instructions: 'Not yet reviewed for work-order entry. Check one approved bid from this vendor before using the ChatGPT skill on it.' });
    }

    const fp = path.join(__dirname, '..', 'seed', 'files', 'How_to_build_a_house.xlsx'); const buf = fs.readFileSync(fp);
    const src = 'How to build a house.xlsx (Maria), via Brittany 2026-10-22';
    const r = importBuildSequence(db, buf, src);
    const mch = db.prepare("SELECT COUNT(*) c FROM build_steps WHERE kind = 'step' AND is_mch = 1").get().c;
    const insp = db.prepare("SELECT COUNT(*) c FROM build_steps WHERE inspection IS NOT NULL").get().c;
    const unmatched = db.prepare("SELECT COUNT(*) c FROM build_steps WHERE kind = 'step' AND vendor_id IS NULL AND is_mch = 0").get().c;

    // The document itself, now attached (it was a waiting placeholder).
    upsert(db, 'documents', { id: 'doc-how-to-build-a-house', title: 'How to build a house (Maria)', path: 'How_to_build_a_house.xlsx', kind: 'procedure',
      kind_reason: 'the build-order document Maria promised [M3 26:23]; supplied by Brittany 2026-10-22. Restricted because the original file has live portal passwords typed into it.', sensitive: 1, task_id: 'tr-schedule-and-trade-coordination',
      summary: `${r.steps - r.holds} ordered build steps from lot stake to the final city inspections, each with the responsible party and Maria's notes, plus ${r.holds} hold points and notifications. Written for the Villas. ${mch} steps are MCH's own action (scheduling, meter releases, city inspections); ${insp} are inspections; ${unmatched} steps name a party with no vendor record. Logins written in the sheet were not imported.`,
      size: buf.length, source: src, imported_at: ts, file_path: fp, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // The extracted text is stripped of the logins before it is stored; the original file still contains them,
      // which is why the document itself is restricted. The redacted build steps stay open to everyone.
      content: redactCredentials(xlsxText(buf)).notes.slice(0, 200 * 1024), underlying_status: 'extracted', underlying_path: 'How_to_build_a_house.xlsx' });

    // It is the schedule procedure's steps — the task had none.
    upsert(db, 'tasks', { id: 'tr-schedule-and-trade-coordination', documented: 1,
      inputs: 'How to build a house (Maria, 10/22): the full build order with responsible party per step. See the Build view.',
      verification_result: `Build order documented 2026-10-22: ${r.steps - r.holds} steps, ${r.holds} hold/notify points. Not yet walked through with Maria step by step.`,
      next_action: 'Walk the build order with Maria once: confirm the steps she does herself (MCH) and who takes each after she leaves.',
      missing_info: `${unmatched} steps name a responsible party with no vendor record${r.gaps ? `; ${r.gaps} steps still have no contractor chosen` : ''}; durations/lead times are in the notes but there is no calendar.` });

    // What this changes for the handover.
    for (const [hid, note] of [
      ['ho-scheduling', `10/22: "How to build a house" received — the build order now exists in writing (${r.steps - r.holds} steps). What it does not give: how long each step takes, so the schedule still comes out of Maria's head. ${mch} steps are MCH's own action.`],
      ['ho-trade-calls', `10/22: the build order names the responsible party for each step, so a successor knows who to call and when. ${unmatched} steps name a party with no vendor record.`],
    ]) { const h = db.prepare('SELECT doc_ids, note FROM handover_items WHERE id = ?').get(hid); if (!h) continue;
      const ids = JSON.parse(h.doc_ids || '[]'); if (!ids.includes('doc-how-to-build-a-house')) ids.unshift('doc-how-to-build-a-house');
      upsert(db, 'handover_items', { id: hid, doc_ids: ids, documented: 'partly (build order 10/22; no durations)', note: [h.note, note].filter(Boolean).join('\n') }); }

    // New handover items the document itself surfaces.
    upsert(db, 'handover_items', { id: 'ho-builder-own-steps', person_id: 'maria', item: `The ${mch} build steps MCH does itself (meter releases, city inspections, notifying accounting of pour dates)`,
      basis: 'How to build a house (Maria) 10/22 — rows where the responsible party is MCH', documented: 'yes (listed, with notes)', current: 'Maria', backup: 'nobody assigned', risk: 'high',
      capture: 'Decide per step who does it after Maria: Ernesto, the new builder, or accounting. The city portal and utility releases need accounts in a successor\'s name.',
      why: 'The sheet lists them but does not say who does them after Maria. These are the steps with no subcontractor to fall back on — if nobody schedules the city inspection or releases the meter, the job stops.',
      cite: 'How to build a house (Maria) 10/22', status: 'open', doc_ids: ['doc-how-to-build-a-house'], task_ids: ['tr-schedule-and-trade-coordination'], updated_at: ts });
    if (r.credentials) upsert(db, 'handover_items', { id: 'ho-portal-logins', person_id: 'maria', item: 'Logins for the city permit portal and the utility (Reliant/CenterPoint) builder sites',
      basis: 'How to build a house (Maria) 10/22 — logins were typed into the notes column', documented: 'written in the sheet, which is the problem', current: 'Maria (accounts in her name)', backup: 'nobody assigned', risk: 'high',
      capture: 'Move these to the password manager and re-register the accounts to a successor before her last day. The logins were deliberately not imported into this app.',
      why: `${r.credentials} steps had a username and password typed into the notes column of a shared spreadsheet. They are not stored here. The accounts are in Maria's name, so when she leaves, meter releases and inspection scheduling stop until they are transferred.`,
      cite: 'How to build a house (Maria) 10/22', status: 'open', doc_ids: ['doc-how-to-build-a-house'], updated_at: ts });

    upsert(db, 'integrations', { id: 'excel', status: 'connected', last_import_at: ts, last_message: `Snapshot: How to build a house (${r.steps - r.holds} steps) + SOW re-import (${nSow} trades)` });
    addEvent(db, { entity_type: 'document', entity_id: 'doc-how-to-build-a-house', kind: 'import', status: 'info',
      label: `Snapshot import: How to build a house → ${r.steps - r.holds} ordered steps, ${r.holds} hold/notify points, ${r.credentials} logins redacted`, source: 'import', actor: 'brittany', external_id: 'update-buildseq-2026-10-22' });
  } },
  { key: 'purchasing-agent-wo-job-2026-10-23', apply(db) {
    const ts = nowIso();
    // Brittany: make the work-order skill a purchasing agent job — on a bid from a sub, the agent enters the
    // work order and asks a human in Teams to verify and approve.
    //
    // Built as DRAFT → ask → release, not enter → ask. Entering a work order in the MCH database emails the
    // subcontractor, and the sub accepting it is the price being agreed [M 58:18–59:32]. Asking after that point
    // would commit McVaugh to a price before a human approved it, which is the one thing agents must not do.
    // Whether the database can hold a work order without notifying the sub is NOT known and must be checked.
    upsert(db, 'agents', { id: 'agent-purchasing', name: 'Purchasing & deliveries',
      purpose: 'Draft a work order from a subcontractor\'s approved bid, then ask a named human in Teams to verify and approve it. Also order deadlines and late deliveries. Drafts only: nothing reaches a subcontractor without a human approval recorded against a name.',
      setup_stage: 'documented', approach: 'mixed',
      approach_note: 'AI reads the bid (unstructured document) and fills the work-order fields. Everything around it is deterministic: budget-line check, the vendor\'s pricing basis, square footage for per-sq-ft trades, and the approval gate itself.',
      human_authority: 'A named person approves every work order before it goes to the sub. Over the budget line, that person is Jim [J 10/12]. The agent never sends, never prices, never accepts work.',
      initial_output: 'A drafted work order plus a Teams message: "A work order was entered as a draft. Please verify it is correct. Do you approve sending it to the subcontractor?"',
      n8n_workflow_id: 'mow-wo-approval', enabled: 0, paused: 0, proposed: 1, updated_at: ts });

    upsert(db, 'tasks', { id: 'tr-wo-entry-from-bid', agent_id: 'agent-purchasing',
      title: 'Enter a work order into the database from a subcontractor\'s approved bid',
      steps: '1. A bid or invoice arrives from a subcontractor (Teams or email).\n2. The agent reads it and fills the work-order fields: vendor, job, cost code, description, amount, draws.\n3. Deterministic checks run: is it within the budget line; what is this vendor\'s pricing basis; for a per-sq-ft trade, is the square footage on the order.\n4. The work order is saved as a DRAFT. Nothing goes to the sub yet.\n5. The agent posts in Teams: "A work order was entered as a draft. Please verify it is correct. Do you approve?" with the drafted fields and a link.\n6. Brittany or Ernesto opens it, checks it against the bid, and approves or rejects. Over the budget line it goes to Jim.\n7. On approval the work order is released and the database emails the sub; the sub accepting is the price agreed [M 58:18–59:32]. On rejection nothing is sent and the reason is recorded.',
      approval_rules: 'Every work order is approved by a named person before it reaches the subcontractor. The approval is recorded with who, when and how. Over the budget line, Jim approves [J 10/12]. The agent cannot approve its own draft, and an approval link that is merely previewed never counts as a decision.',
      automation_approach: 'n8n workflow mow-wo-approval: bid arrives → ChatGPT skill drafts the fields → POST /api/webhooks/approval creates a pending approval and turns the purchasing agent amber → Teams message with Approve/Reject links → the decision is posted back and recorded. The ChatGPT skill is Brittany\'s existing one (Business seat, no API cost); it is proven for Johnston Waterproofing only.',
      blocker: 'Unverified: can the MCH database hold a work order as a draft without emailing the subcontractor? If it cannot, the agent must stop at a prepared work order and a human does the final entry. Ask Ernesto or whoever maintains db.mcvaugh.com before building this.',
      waiting_on: 'Ernesto (can the database save a work order without notifying the sub?); Brittany (Teams channel and the incoming webhook)',
      next_action: 'Answer the draft question above. Then set the Teams webhook in n8n and run one real bid end to end with Johnston Waterproofing.',
      verification_result: 'The drafting step is proven by hand for Johnston Waterproofing only (2026-10-21). The Teams approval loop is designed and built in this app, but has not been run against a real bid.',
      automated: 0, verified: 0, updated_at: ts });

    upsert(db, 'integrations', { id: 'teams', name: 'Microsoft Teams (approval messages)', kind: 'callback', status: 'disconnected',
      notes: 'Where the purchasing agent asks a human to approve a drafted work order. Needs an incoming webhook for the channel, set in n8n as TEAMS_WEBHOOK_URL, and MOW_PUBLIC_URL set to an address Teams can reach. Until both are set this stays disconnected and no approval message can be sent.',
      config: JSON.stringify({ workflow: 'mow-wo-approval', channel: 'to be chosen by Brittany', env: ['TEAMS_WEBHOOK_URL', 'MOW_PUBLIC_URL', 'MOW_N8N_SECRET'] }), last_checked: ts });

    upsert(db, 'ai_configs', { id: 'ai-wo-entry-from-bid', agent_id: 'agent-purchasing',
      purpose: 'Read a subcontractor\'s bid or invoice and fill in the work-order fields, as a draft for a human to approve',
      needs_ai: 'yes, for reading the bid only', provider: 'ChatGPT Business (existing seat) — custom skill', model: 'as configured in the ChatGPT skill (not an API call)',
      why: 'Bids are unstructured documents, so pulling out vendor, job, scope and amount needs document understanding. Nothing else here does: the budget check, the pricing basis, the square-footage rule and the approval gate are all deterministic, and are kept out of the model.',
      expected_cost: '$0 beyond the existing ChatGPT Business seat', approval: 'A named person approves every work order in Teams before it reaches the sub. The agent cannot send, approve or price.',
      eval_examples: 'Johnston Waterproofing bid (2026-10-21) → correct work order. Still to add before this runs unattended: one per-sq-ft vendor (framer), one fixed-price vendor (garage door), one lumber order with draws, and one bid that is over the budget line (must route to Jim).',
      fallback: 'Type the work order from the bid by hand, about a minute each [M 35:12]. The approval step still happens in Teams.', updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-wo-agent-draft-first', date: '2026-10-23',
      title: 'The purchasing agent drafts a work order and a human releases it; it never sends one itself',
      reason: 'Brittany asked for the agent to enter the work order and then ask for approval in Teams. Entering it in the MCH database is what emails the subcontractor, and the sub accepting is the price being agreed [M 58:18–59:32], so approving afterwards would come too late to stop a commitment. The agent therefore drafts, asks "a work order was entered as a draft, please verify it is correct, do you approve?", and the approval is what releases it. Open question: whether the database can hold a draft without notifying the sub.',
      decided_by: 'Brittany (asked), recorded by the build', status: 'open', source: 'Brittany 2026-10-23', created_at: ts });

    addEvent(db, { entity_type: 'agent', entity_id: 'agent-purchasing', kind: 'setup', status: 'info',
      label: 'Manual: work-order entry from an approved bid became a purchasing agent job — drafts only, approved by a named human in Teams',
      source: 'manual', actor: 'brittany', external_id: 'update-wo-agent-2026-10-23' });
  } },
  { key: 'bid-request-flow-2026-10-25', apply(db) {
    const ts = nowIso();
    // Brittany's design, after checking it with Maria: the agent runs on its own when a bid arrives, but only
    // asks a human once every bid requested for that line item is in. That rule needs the request recorded first.
    //
    // Maria's answer (Teams, 10/24) settled two facts this is built on:
    //   1. Entering the work order IS the approval — "they get an email on their end saying there's a work
    //      order entered/approved". So approval has to come before entry, which is why the agent asks first.
    //   2. Waterproofing is sole-sourced to Johnston today, and that is her practice rather than a rule:
    //      "absolutely moving forward whomever is doing it can get more than one bid, this is just what we
    //      have been doing". So a single-vendor line item is allowed but has to say so, in writing.
    upsert(db, 'documents', { id: 'doc-maria-bid-process-answer', title: 'Maria on how bids and work orders actually work (Teams, 10/24)',
      path: null, kind: 'procedure', kind_reason: 'Maria answering Brittany directly; the only written confirmation that entering a work order is what approves it',
      sensitive: 0, task_id: 'tr-wo-entry-from-bid', meeting_date: '2026-10-24', cite_key: 'M-chat 10/24',
      attendees: JSON.stringify(['maria', 'brittany']),
      summary: 'Q: is the bid sheet sent after agreeing a price, or do they send it on request and you compare and then enter it, which is what approves it? A: "yes and no." For waterproofing and balcony coatings she does not get other pricing, only Johnston — there is no comparable company for the workmanship, the price is reasonable, and they have had no issues. She adds that whoever takes it over can and should get more than one bid, and that this is just what they have been doing. Confirmed: "yes they get an email on their end saying theres a work order entered/ approved."',
      content: 'Brittany: when they email that sheet of paper like with the Johnston waterproofing one, is that after a discussion and agreeing to the price, or do they just send it after you request a bid and then you look at it, decide if it is the cheapest of the 3 or just a good price (if not comparing it to two other subcontractors), and then you enter it into the database, which is saying you approve it, and they see it was submitted and approve it on their end?\n\nMaria: yes and no. for waterproofing and balcony coatings i don\'t get other pricing just Johnston. there\'s not really a good waterproofing company with their workmanship and i think for waterproofing it\'s worth to pay the price. and their price is reasonable. but absolutely moving forward whomever is doing it can get more than one bid, this is just what we have been doing and fortunately haven\'t had any issues with the work. yes they get an email on their end saying theres a work order entered/ approved.',
      source: 'Maria to Brittany, Teams chat 2026-10-24', imported_at: ts, underlying_status: 'extracted' });

    // The new procedure: requesting bids off the vendor contact list.
    upsert(db, 'tasks', { id: 'tr-bid-requests', title: 'Request bids for a line item from the vendor contact list', department_id: 'purchasing',
      owner_id: 'brittany', backup_id: 'ernesto', agent_id: 'agent-purchasing', proposed: 0, documented: 1, automated: 0, verified: 0, board: 'next',
      trigger: 'A line item on a job needs pricing — usually the next trade in the build sequence.',
      inputs: 'The line item/trade, the job, the documents that trade needs in order to bid (Registry → Vendors → documents to provide), and the vendors on the contact list for that trade.',
      steps: '1. The agent builds the request from the vendor contact list for that trade: who to ask, what documents they need, when it is due back.\n2. The agent asks in the purchasing Teams channel: "Send a bid request to X, Y, Z?" If only one vendor is on the list it says so, because one bid is a choice, not a default [M-chat 10/24].\n3. A named person approves. Nothing reaches a vendor before that.\n4. The request goes out and the clock starts. The request records how many bids are expected — this is what makes "are they all in?" answerable.\n5. Bids come back and are recorded against the request. No one is asked anything yet.\n6. When the last expected bid lands, the agent asks for a decision. If the due date passes first, it asks whether to chase the missing vendors or decide on what is in.',
      approval_rules: 'Sending a bid request is approved by a named person. A single-vendor request is allowed but must carry the reason — Maria\'s practice on waterproofing is the example, and she said it should not stay the default [M-chat 10/24].',
      automation_approach: 'n8n workflow mow-bid-requests: build the request from the vendors table → POST /api/webhooks/bid-request → the purchasing channel gets the approval card → on approval the request is marked sent and n8n picks it up from /api/webhooks/work and emails the vendors.',
      evidence: 'A bid request recorded against the line item with the vendors asked, the documents sent and the due date.',
      next_action: 'Decide the house rule: how many bids per line item before a sole-source reason is required.',
      missing_info: 'There is no budget line or cost-code list in this app yet, so a line item is matched by trade and job. Cost codes would make the match exact.',
      source: 'Brittany 2026-10-25; Maria chat 2026-10-24', updated_at: ts });

    // The work-order procedure now starts from an approved bid on a complete request.
    upsert(db, 'tasks', { id: 'tr-wo-entry-from-bid', supersedes: ['hub-new_work_order'],
      trigger: 'Every bid requested for a line item has come in (or the request was sole-sourced, or the due date passed and a human chose to decide early).',
      steps: '1. Bids are in against the bid request. The agent does not ask before they all are.\n2. The agent posts one message to the purchasing Teams channel. One bid asks "do you approve?"; several bids show them side by side and ask "which one?".\n3. The message says plainly what yes does: entering the work order is what emails the subcontractor to say it is approved [M-chat 10/24].\n4. Per-square-foot vendors are flagged in the message if the square footage is missing, because their work order cannot be entered without it.\n5. A named person approves one bid, or rejects with a reason. Rejecting enters nothing and sends nothing; the line item goes back to a human until another bid arrives.\n6. On approval the agent enters the work order in db.mcvaugh.com and reports the work-order number back. The losing bids are marked superseded, not deleted.',
      approval_rules: 'A named person approves before anything is entered. Over the budget line, that person is Jim [J 10/12]. Approving with several bids on the table requires naming which one. Rejecting requires a reason. The agent never sends, prices or accepts.',
      blocker: null,
      waiting_on: 'Brittany (purchasing Teams channel webhook, and the house rule on how many bids per line item)',
      next_action: 'Create the purchasing channel webhook, then run one real Johnston waterproofing bid end to end.',
      verification_result: 'The ordering question is settled: Maria confirmed entering the work order is what notifies and approves the sub [M-chat 10/24], so the agent asks first. The loop is built and tested in this app but has not been run against a real bid or the real database.',
      updated_at: ts });

    const link = (tid, did) => { const t = db.prepare('SELECT doc_ids FROM tasks WHERE id = ?').get(tid); if (!t) return; const ids = JSON.parse(t.doc_ids || '[]'); if (!ids.includes(did)) upsert(db, 'tasks', { id: tid, doc_ids: [...ids, did] }); };
    link('tr-wo-entry-from-bid', 'doc-maria-bid-process-answer'); link('tr-bid-requests', 'doc-maria-bid-process-answer');

    upsert(db, 'agents', { id: 'agent-purchasing',
      purpose: 'Run the bid loop for a line item: build the request from the vendor contact list, collect the bids, and ask the purchasing channel to decide once they are all in. Then enter the approved work order. Never contacts a vendor and never enters anything without a named person approving it first.',
      approach_note: 'AI reads the incoming bid document. Everything else is deterministic and kept out of the model: who to ask (the vendors table), whether all bids are in (a count against the request), the budget check, the pricing basis, the square-footage rule, the due-date chase, and both approval gates.',
      human_authority: 'Two gates, both named: a person approves sending a bid request, and a person approves the bid that becomes a work order. Over the budget line that person is Jim. The agent cannot send, price, award or accept work.',
      initial_output: 'A bid request waiting to be approved; later, "all bids are in for this line item — which one?" in the purchasing Teams channel.',
      n8n_workflow_id: 'mow-wo-approval', updated_at: ts });

    upsert(db, 'integrations', { id: 'teams', name: 'Microsoft Teams — purchasing channel (approvals)', status: 'disconnected',
      notes: 'Approval cards go to the purchasing channel, agreed with Brittany 2026-10-25. Because a channel is not a person, the approval page makes whoever decides pick their name, and records it as self-declared rather than verified. Needs an incoming webhook for that channel in TEAMS_WEBHOOK_URL, and MOW_PUBLIC_URL set to an address Teams can reach.',
      config: JSON.stringify({ channel: 'Purchasing', workflows: ['mow-bid-requests', 'mow-wo-approval'], identity: 'self-declared: the approver picks their name', env: ['TEAMS_WEBHOOK_URL', 'MOW_PUBLIC_URL', 'MOW_N8N_SECRET'] }), last_checked: ts });

    upsert(db, 'decisions', { id: 'dec-bid-rule', date: '2026-10-25',
      title: 'The agent asks for a decision only once every bid requested for a line item is in',
      reason: 'Brittany\'s rule, to stop the agent asking about each bid separately when a line item is out to several vendors. It needs a bid request recorded up front with how many bids are expected, which is what the bid_requests table is for. A request that passes its due date is never left silent: the agent asks whether to chase or to decide on what is in. Sole-sourced line items are allowed but must carry the reason, because Maria said more than one bid should become the norm [M-chat 10/24].',
      decided_by: 'Brittany', status: 'accepted', source: 'Brittany 2026-10-25', created_at: ts });
    upsert(db, 'decisions', { id: 'dec-wo-agent-draft-first', status: 'accepted',
      reason: 'Settled 10/24. Maria confirmed the subcontractor is emailed when the work order is entered, and that this is what tells them it is approved. So the agent asks before entering, not after. Brittany\'s flow does this: the Teams message comes first, and entry only happens on a yes. The earlier open question about holding an unsent draft in the database no longer applies, because nothing is entered until a person has approved.',
      title: 'The purchasing agent asks before it enters a work order, never after' });

    addEvent(db, { entity_type: 'agent', entity_id: 'agent-purchasing', kind: 'setup', status: 'info',
      label: 'Manual: bid request → collect bids → decide once all are in → enter the work order; both gates approved in the purchasing Teams channel',
      source: 'manual', actor: 'brittany', external_id: 'update-bid-flow-2026-10-25' });
  } },
  { key: 'park-bids-human-trigger-2026-10-26', apply(db) {
    const ts = nowIso();
    // Brittany, 2026-10-26: park the bid half. How a bid gets requested and compared varies too much by trade
    // to automate before there is a bid process on paper and an agent of its own. Nothing is deleted — the
    // tables, endpoints, view and workflow stay, switched off, so the work is there when the process exists.
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('bid_flow', 'parked')").run();

    upsert(db, 'tasks', { id: 'tr-bid-requests', board: 'next', proposed: 1, automated: 0, documented: 0,
      title: 'Request bids for a line item (PARKED — needs its own process first)',
      blocker: 'Parked 2026-10-26. Requesting and comparing bids is too varied between trades to automate yet: some line items go to one vendor, some to three, and what counts as comparable differs by trade. It needs a written bid process and its own agent before any of this runs.',
      waiting_on: 'A written bid process — who gets asked for what, how many bids per trade, and what makes two bids comparable',
      next_action: 'Park it. Pick this back up after the purchasing procedures are up to date, starting from how bids are actually requested today.',
      verification_result: 'Built and tested in this app (bid request, bid collection, the all-in rule, the overdue chase) but switched off and never run against a real bid.',
      updated_at: ts });

    // The work order is now started by a person, not by a bid landing.
    upsert(db, 'tasks', { id: 'tr-wo-entry-from-bid', title: 'Create a work order in the database (asked for by a person)',
      documented: 1, automated: 0, verified: 0, board: 'working', proposed: 0,
      trigger: 'A person asks for it. Somebody has an approved bid in hand and tells the agent to create the work order. Nothing else starts one — the agent does not watch for bids and does not decide a work order is due.',
      inputs: 'The vendor, the job, the amount and what the work is. The bid itself where there is one. For a vendor priced per square foot, the square footage (Registry → Vendors shows which vendors those are).',
      steps: '1. A person asks for a work order: in the app (Work orders → Create), or by telling the agent in Teams.\n2. The agent fills in the work-order fields from the bid and the vendor record, and flags anything missing — a per-square-foot vendor with no square footage cannot be entered.\n3. The agent shows exactly what it will enter and asks the person to check it.\n4. The person confirms, or rejects with a reason. Over the budget line it goes to Jim [J 10/12].\n5. On confirmation the agent enters the work order in db.mcvaugh.com and reports the number back. Entering it is what emails the subcontractor to say it is approved [M-chat 10/24].',
      approval_rules: 'A person starts it and a person confirms it before anything is entered. Over the budget line, Jim confirms. The agent never starts a work order, never prices one and never accepts work.',
      automation_approach: 'The person asks; the ChatGPT skill reads the bid and fills the fields; the app holds the confirmation; n8n enters it and reports the number. Deterministic checks stay out of the model: the vendor\'s pricing basis, the square-footage rule, and the budget line.',
      blocker: null,
      waiting_on: 'Brittany (purchasing Teams channel webhook, if the ask should also work from Teams)',
      next_action: 'Run one real Johnston waterproofing bid through it from the app, end to end, and check the work order that comes out.',
      verification_result: 'Drafting is proven by hand for Johnston Waterproofing only (2026-10-21). The ask → confirm → enter loop works in this app but has not been run against the real database.',
      missing_info: 'Which vendors besides Johnston have been reviewed for work-order entry — every other vendor is still needs_review.',
      updated_at: ts });

    upsert(db, 'agents', { id: 'agent-purchasing', setup_stage: 'documented', enabled: 0, proposed: 1,
      purpose: 'Create a work order in the database when a person asks for one: fill in the fields from the bid and the vendor record, show them for checking, and enter it once confirmed. Also order deadlines and late deliveries. It never starts a work order by itself.',
      approach_note: 'AI reads the bid document. Everything else is deterministic and kept out of the model: the vendor\'s pricing basis, the square-footage rule, the budget line, and the confirmation gate. Requesting and comparing bids is parked until there is a process for it.',
      human_authority: 'A person asks for the work order and a person confirms what will be entered. Over the budget line that is Jim. The agent cannot start, price, award or accept work.',
      initial_output: 'A filled-in work order waiting to be checked, with anything missing flagged.',
      n8n_workflow_id: 'mow-wo-approval', updated_at: ts });

    upsert(db, 'integrations', { id: 'teams', name: 'Microsoft Teams — purchasing channel (confirmations)',
      notes: 'Work-order confirmations go to the purchasing channel. Because a channel is not a person, whoever confirms picks their name and it is recorded as self-declared. Needs TEAMS_WEBHOOK_URL and MOW_PUBLIC_URL. The bid-request workflow is parked and should stay switched off in n8n.',
      last_checked: ts });

    upsert(db, 'decisions', { id: 'dec-park-bid-flow', date: '2026-10-26',
      title: 'Park the automated bid request and comparison; a person starts every work order',
      reason: 'How a bid is requested and compared is too varied between trades to automate before the process exists on paper. Some line items go to one vendor and some to three, and what makes two bids comparable differs by trade. Automating the ask first would have encoded guesses. The trigger for a work order is now a person asking for one. The bid tables, endpoints, view and workflow are kept switched off so none of the work is lost, and the flag in meta turns them back on when a bid process and its own agent exist.',
      decided_by: 'Brittany', status: 'accepted', source: 'Brittany 2026-10-26', created_at: ts });

    addEvent(db, { entity_type: 'agent', entity_id: 'agent-purchasing', kind: 'setup', status: 'info',
      label: 'Manual: bid request/comparison parked; a work order is now started by a person asking for one',
      source: 'manual', actor: 'brittany', external_id: 'update-park-bids-2026-10-26' });
  } },
  { key: 'skill-gl-insurance-2026-11-03', apply(db) {
    const ts = nowIso();
    // Brittany's ChatGPT skill "Update GL Insurance", pasted 2026-11-03. Filed through the same parser the
    // paste box uses, so what is stored here is exactly what pasting it in the app would produce.
    const { parseSkill, mentionsIn } = require('./imports');
    const text = fs.readFileSync(path.join(__dirname, '..', 'seed', 'skills', 'update-gl-insurance.txt'), 'utf8');
    const p = parseSkill(text);
    const id = 'sop-update-gl-insurance';
    const src = 'ChatGPT skill "Update GL Insurance" (Brittany), 2026-11-03';
    upsert(db, 'tasks', { id, title: p.title || 'Update GL Insurance', department_id: 'purchasing',
      owner_id: 'brittany', backup_id: 'kenneth', proposed: 0, documented: 1, automated: 0, verified: 0, board: 'working',
      trigger: p.trigger, inputs: p.inputs, steps: p.steps.join('\n'), approval_rules: p.approval_rules || null,
      // Four systems hold the same expiry date and nothing reconciles them; that is the risk this procedure carries.
      missing_info: 'The same GL expiry lives in four places — the register spreadsheet, the certificate folder, BuildConnect and QuickBooks — and nothing checks that they agree. Nobody is alerted when a certificate is about to lapse; it is noticed when someone looks. No list of which vendors are currently expired or expiring.',
      evidence: 'Register row saved and re-read, certificate filed with the superseded one archived, BuildConnect GL date re-opened and confirmed, certificate handed to Kenneth for QuickBooks.',
      next_action: 'Decide with Jim and Kenneth who owns insurance tracking after Maria leaves, then walk one real renewal with that person before 9 November.',
      source: src, supersedes: ['tr-vendor-onboarding-insurance'], updated_at: ts });

    upsert(db, 'documents', { id: 'doc-' + id, title: 'Update GL Insurance — skill text as written', kind: 'procedure',
      kind_reason: 'the ChatGPT skill this procedure was written from', sensitive: 0, task_id: id,
      summary: `${p.subtitle || 'Update vendor insurance records and file renewals'}. Pasted 2026-11-03. ${p.step_count} steps across ${p.steps.filter(s => !/^\d+\./.test(s)).length} phases.`,
      content: text, size: text.length, source: src, imported_at: ts, underlying_status: 'extracted' });

    // The files it depends on, none of which are reachable from this app: placeholders so they are at least named.
    for (const [did, title, pth, reason] of [
      ['doc-insurance-procedure-docx', 'Insurance certificate procedure (Maria)', 'L:\\COMPANY INFORMATION\\MCH\\WORKFLOW PROCESSES\\MARIA LEAVING\\INSURANCE CERTIFICATE PROCEDURE.docx', 'Maria\'s own written procedure, named by the skill as the authority'],
      ['doc-gl-register-xls', 'GL insurance and workers comp register (current)', 'L:\\COMPANY INFORMATION\\MCH\\PURCHASING\\Vendor.Subcontractors - GL Insurance\\Copy of GL Insurance and workers comp - current.xls', 'the register the expiry dates are kept in; legacy .xls with hidden rows and three tabs'],
    ]) upsert(db, 'documents', { id: did, title, path: pth, kind: 'procedure', kind_reason: reason, sensitive: 0, task_id: id,
      summary: 'Named by the GL insurance skill. Not attached: it lives on the L: drive, which this app cannot reach. Attach it with Option 3 or Upload.',
      source: src, imported_at: ts, underlying_status: 'not_attached' });
    const t = db.prepare('SELECT doc_ids FROM tasks WHERE id = ?').get(id);
    upsert(db, 'tasks', { id, doc_ids: [...new Set([...JSON.parse(t.doc_ids || '[]'), 'doc-' + id, 'doc-insurance-procedure-docx', 'doc-gl-register-xls', 'doc-insurance-spreadsheet'])] });

    // The quirks a successor would otherwise rediscover the hard way.
    for (const [sid, detail] of [
      ['ws-buildconnect-gl-field', 'BuildConnect GL renewal: the editable record is in the mainframe; the GL field is the liability expiry input. Press Enter to save — blue text means the UI accepted it, not that it saved. The save needs the parent php frame and its submit helper; the standalone contact page is read-only. If Enter errors, go Back then Forward to recover the helper, then re-open the contact and check the stored date before trying again. Never retry a save you are unsure of.'],
      ['ws-gl-register-tabs', 'The GL register has three tabs (GL INSURANCE, OLD-GL INSURANCE, NOT ACTIVE GL INSURANCE) and hidden inactive rows. Update the active row only. Keep the legacy .xls format and open it in real Excel — converting it loses formulas, formatting and hidden rows. Back it up before editing, and re-read it after saving.'],
      ['ws-gl-cert-identity', 'Reading a certificate: the insured vendor is the named insured, not the certificate holder (that is McVaugh). Do not take the issue date, or another policy\'s expiry, for the GL expiry. Look at the whole page when the layout matters.'],
    ]) upsert(db, 'wo_specifics', { id: sid, detail, scope: 'vendor', vendor_name: 'all vendors (GL insurance)', task_id: id, source: src, noted_on: '2026-11-03', updated_at: ts });

    // What the skill settles, and what it does not.
    const h = db.prepare('SELECT * FROM handover_items WHERE id = ?').get('ho-vendor-insurance');
    if (h) upsert(db, 'handover_items', { id: 'ho-vendor-insurance', risk: 'medium',
      documented: 'yes for renewals (GL insurance skill, 11/03); vendor onboarding still not written down',
      backup: 'James did it once with Maria 10/17; Kenneth is the proposal, not yet decided',
      why: 'The renewal half is now written down step by step, including the BuildConnect quirks that are easy to get wrong. Two things are still open: who owns it after Maria, and the fact that the same expiry date sits in four systems with nothing reconciling them, so a lapsed certificate is found by looking rather than by being told.',
      capture: 'Get Jim to name the owner. Walk one real renewal with that person before 9 November. Separately, agree where the list of expiring certificates comes from.',
      doc_ids: [...new Set([...JSON.parse(h.doc_ids || '[]'), 'doc-' + id, 'doc-insurance-procedure-docx', 'doc-gl-register-xls'])],
      task_ids: [...new Set([...JSON.parse(h.task_ids || '[]'), id])], updated_at: ts });

    upsert(db, 'tasks', { id: 'tr-vendor-onboarding-insurance', documented: 0,
      missing_info: 'The renewal half is written down (see "Update GL Insurance"). Signing up a NEW vendor — what is collected, who approves, what goes in the database first — is still only in Maria\'s head.',
      next_action: 'Ask Maria to walk through signing up one new vendor from scratch before 9 November.', updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-insurance-owner', date: '2026-11-03',
      title: 'Who owns vendor insurance tracking after Maria leaves',
      reason: 'Maria suggested Kenneth, since he already updates insurance in QuickBooks and the procedure ends by handing him the certificate. James has done it once, walked through by Maria on 10/17. The renewal procedure is now written down either way, so this is about who owns it, not whether it is documented. Open until Jim names someone.',
      decided_by: 'Jim to decide', status: 'open', source: 'Maria 10/17; GL insurance skill 11/03', created_at: ts });

    addEvent(db, { entity_type: 'task', entity_id: id, kind: 'setup', status: 'info',
      label: `Added from a pasted ChatGPT skill: Update GL Insurance (${p.step_count} steps)`,
      source: 'import', actor: 'brittany', external_id: 'paste-gl-insurance-2026-11-03' });
  } },
  { key: 'hub-session-2026-11-03', apply(db) {
    const ts = nowIso();
    // Brittany's 2026-11-03 working session on the MCH Operations Hub, recorded from her session summary.
    // The hub was edited directly in that session; this app's store did not know any of it. Facts below are
    // taken from the summary. Where it gives counts rather than the items themselves, the count is recorded
    // as a claim with its source, and the items are not invented.
    const SRC = 'MCH Operations Hub session summary, 2026-11-03 (Brittany)';

    upsert(db, 'documents', { id: 'doc-hub-session-2026-11-03', title: 'Ops hub working session — 3 November 2026', kind: 'reference',
      kind_reason: 'Brittany\'s summary of a session that changed the hub directly', sensitive: 0, meeting_date: '2026-11-03', cite_key: 'HUB 11/03',
      summary: 'Hub went from 25 SOPs to 33 (3 archived as legacy), 8 to 9 people (Lonnie added, Maria marked departing), and gained 8 vendor rules, 10 historical WO/PO records, and new UI (ROCC and N/A toggles, roles-covered modal, vendor-rules and history panels). Maria\'s 54 responsibilities were redlined; purchasing work was split across Maria, James and Ernesto.',
      source: SRC, imported_at: ts, underlying_status: 'summary_only' });

    // --- Lonnie: Maria's successor on construction and permitting. This is the biggest change here.
    upsert(db, 'people', { id: 'lonnie', name: 'Lonnie', full_name: null, title: 'Construction / Permitting Lead (incoming)',
      role_summary: 'Incoming; takes on Maria\'s construction and permitting work. Started around 3 November 2026.',
      departments: ['construction', 'permits'], confirmed: 0, review_status: 'not_reviewed',
      notes: 'INCOMING — absorbing Maria\'s construction responsibilities [HUB 11/03]. Full name and email still needed. Nothing has been verified with Lonnie directly yet.',
      reports_to: 'jim', source: SRC, created_at: ts, updated_at: ts });

    upsert(db, 'people', { id: 'maria',
      notes: 'LEAVING — last day 6 November 2026, transitioning to Lonnie [HUB 11/03]. This supersedes the earlier "before Nov 9" reading of the 10/20 call. Succession pass in progress; see the Handover tab.',
      updated_at: ts });

    // Maria's items now have somewhere to go. Only the construction/permitting ones; purchasing went elsewhere.
    const toLonnie = db.prepare("SELECT id, backup_id, department_id FROM tasks WHERE owner_id = 'maria' AND archived = 0 AND department_id IN ('construction','permits')").all();
    for (const t of toLonnie) if (!t.backup_id) upsert(db, 'tasks', { id: t.id, backup_id: 'lonnie', updated_at: ts });

    // --- The eight vendor rules, with the cost codes the hub now carries.
    const RULES = [
      ['johnston', 'Johnston Waterproofing', '409.0', 'Price each scope separately on the work order and leave the general square-footage field blank.'],
      ['autumn', 'Autumn HVAC', '610', 'Draws split 60/30/10. Pricing is equipment-based, so the equipment has to be identified on the order.'],
      ['hh-fence', 'H&H Fence (HOA)', '940.0', 'HOA work routes through ROCVTA, not the job. Maintenance scope.'],
      ['synergy', 'Synergy Roofing', '400', 'Draws split 30/50/20.'],
      ['electrical-works', 'Electrical Works', '620', 'Changes go through construction change orders.'],
      ['reece', 'Reece Plumbing', '601', 'Split the valves and the trims onto separate lines. The purchase order is emailed to the vendor.'],
      ['lowes', 'Lowes', '996', 'Routed by CUSTOMER CODE. Mind the difference between Complete and Received.'],
      ['hoa-all', 'All HOA work', 'trade-specific', 'HOA work goes through ROCVTA via Teresa, whatever the trade.'],
    ];
    for (const [slug, name, code, rule] of RULES) {
      const v = db.prepare('SELECT id, vendor FROM vendors WHERE LOWER(vendor) LIKE LOWER(?)').get('%' + name.split(' ')[0] + '%');
      const detail = `Cost code ${code}. ${rule}`;
      upsert(db, 'wo_specifics', { id: 'ws-rule-' + slug, vendor_id: v ? v.id : null, vendor_name: name, detail,
        scope: 'vendor', task_id: 'tr-wo-entry-from-bid', source: SRC, noted_on: '2026-11-03', updated_at: ts });
      if (v) upsert(db, 'vendors', { id: v.id, wo_instructions: detail, wo_review: 'reviewed' });
    }
    // Flagged rather than merged: the hub names Reece Plumbing; the SOW on file says GT Plumbing for PLUMBING.
    upsert(db, 'wo_specifics', { id: 'ws-rule-plumbing-conflict', vendor_id: 'vendor-plumbing', vendor_name: 'PLUMBING — which vendor?',
      detail: 'CONFLICT: the hub\'s vendor rules name Reece Plumbing (cost code 601); the SOW on file names GT Plumbing for the PLUMBING trade. Both may be true (different scopes or a change of vendor) but the work-order rule cannot be applied until someone says which. Ask Brittany or Ernesto.',
      scope: 'vendor', task_id: 'tr-wo-entry-from-bid', source: SRC, noted_on: '2026-11-03', updated_at: ts });

    // --- The eight SOPs the hub gained. Only the GL insurance one has its text here; the rest are named only.
    const SOPS = [
      ['sop-pur-01-wo-entry-buildconnect', 'Work Order Entry in BuildConnect (SOP-PUR-01)', 'purchasing', 'ChatGPT skill export'],
      ['sop-pur-02-material-po-entry', 'Material PO Entry (SOP-PUR-02)', 'purchasing', 'drafted from review notes'],
      ['sop-pur-03-lowes-receipt-po', 'Lowe\'s Receipt PO Entry and Handoff (SOP-PUR-03)', 'purchasing', 'ChatGPT skill export, confirmed 26 October'],
      ['sop-fin-01-cash-flow-rollover', 'Weekly Cash Flow Statement Rollover (SOP-FIN-01)', 'accounting', 'ChatGPT skill export'],
      ['sop-fin-02-draw-schedule-bank', 'Draw Schedule Update and Bank Request (SOP-FIN-02)', 'accounting', 'ChatGPT skill export'],
      ['sop-start-house-buildconnect', 'Start House in BuildConnect Database', 'construction', 'ChatGPT skill export'],
      ['sop-permitting-ipermits-projectdox', 'Permitting Process — iPermits / ProjectDox (current)', 'permits', 'new, from review notes'],
    ];
    for (const [id, title, dept, origin] of SOPS) upsert(db, 'tasks', { id, title, department_id: dept,
      owner_id: dept === 'accounting' ? 'brittany' : 'brittany', backup_id: null, proposed: 0, documented: 0, automated: 0, verified: 0, board: 'next',
      trigger: null, steps: null,
      missing_info: `Named in the hub on 3 November (${origin}) but its steps are not in this app. Paste the skill text in on the Procedures tab and this fills itself in.`,
      next_action: 'Paste the skill text (Procedures → Paste a procedure).', source: SRC, updated_at: ts });
    // The one that is already here in full.
    upsert(db, 'tasks', { id: 'sop-update-gl-insurance', title: 'Vendor GL Insurance Certificate Renewal', updated_at: ts });

    // --- The three legacy SOPs the hub archived. All three already had confirmed replacements here.
    for (const id of ['hub-permitting', 'hub-new_work_order', 'hub-work_order_ap']) {
      const t = db.prepare('SELECT review_note FROM tasks WHERE id = ?').get(id); if (!t) continue;
      upsert(db, 'tasks', { id, review_note: [t.review_note, 'Archived as legacy in the hub on 3 November 2026 [HUB 11/03]. Kept here, not deleted: the supersedes links are what show which procedure replaced it.'].filter(Boolean).join('\n'), updated_at: ts });
    }
    upsert(db, 'tasks', { id: 'sop-permitting-ipermits-projectdox', supersedes: ['hub-permitting'] });
    upsert(db, 'tasks', { id: 'sop-pur-01-wo-entry-buildconnect', supersedes: ['hub-new_work_order'] });

    // --- Who picked up what. Counts are from the summary; the items themselves are in the hub, not here.
    for (const [pid, note] of [
      ['james', 'Grew from 13 to 32 responsibilities on 3 November [HUB 11/03]: six purchasing items (bid collection, WO/PO entry, subcontractor management), two sales items, five construction items from Maria\'s redline, plus GL insurance processing, subcontractor packets, the purchasing inbox, W-9 and contractor liability insurance upkeep, and ownership of the Purchasing Manual.'],
      ['kenneth', 'Gained two on 3 November [HUB 11/03]: invoice and backcharge review (from Maria), and updating GL insurance in QuickBooks.'],
      ['brittany', 'Gained five on 3 November [HUB 11/03]: cash report rollover, draw schedule updates, draw request drafts, starting houses in the database, and running the GL insurance renewal skill.'],
      ['ernesto', 'Cut back on 3 November [HUB 11/03] to the 25 items in the Purchasing Manager job description. Twenty-eight responsibilities were added from that JD earlier in the same session, then the list was reduced to the JD items only. Still to review for what actually applies.'],
    ]) { const p = db.prepare('SELECT notes FROM people WHERE id = ?').get(pid); if (p) upsert(db, 'people', { id: pid, notes: [p.notes, note].filter(Boolean).join('\n'), updated_at: ts }); }

    // --- What the session left open.
    for (const [id, title, reason] of [
      ['dec-purchasing-split-lonnie-james', 'How purchasing work splits between Lonnie and James', 'Fourteen purchasing items moved to Maria and six to James in the 3 November redistribution. Maria leaves on the 6th, so her fourteen need an owner. Lonnie is taking construction and permitting; James already has six. Nobody has said which of the fourteen go where.'],
      ['dec-change-order-na-review', 'Which change-order steps are genuinely no longer done', 'Twenty of Maria\'s items were marked N/A in the redline and are hidden behind a toggle. The change-order ones need checking with her before she goes, because "not done any more" and "not done by Maria any more" are different things.'],
    ]) upsert(db, 'decisions', { id, date: '2026-11-03', title, reason, decided_by: 'open', status: 'open', source: SRC, created_at: ts });

    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ts, 'map',
        'Hub session 11/03 recorded here: Lonnie added, Maria last day 6 November, 8 vendor rules, 7 SOPs named but not yet pasted in.',
        'MCH ops hub session 3 November: 33 SOPs, vendor rules, historical WO/PO records, ROCC and N/A toggles.',
        'Paste the 7 named SOP skill texts in (Procedures → Paste a procedure) so the steps live here too, starting with the two purchasing ones.',
        'Lonnie (full name and email); whoever decides how Maria\'s 14 purchasing items split between Lonnie and James',
        'Purchasing split between Lonnie and James; which change-order steps are really N/A; Reece vs GT Plumbing for the plumbing work-order rule',
        'Recorded from Brittany\'s hub session summary. The hub itself was edited directly in that session; this app did not write those changes and will no longer overwrite a hub it did not generate.', 'brittany');

    // Brittany, 2026-11-03: James owns vendor insurance tracking. This closes the question left open on 11/03.
    upsert(db, 'decisions', { id: 'dec-insurance-owner', status: 'accepted', decided_by: 'Brittany',
      reason: 'Decided 3 November: James owns it. He had already done one renewal with Maria walking him through it on 10/17, and the hub session moved GL insurance processing, W-9 upkeep and contractor liability insurance maintenance to him. Kenneth stays the QuickBooks end of it, which is where the certificate is handed off. The renewal procedure is written down, so what was missing was the owner, and now it is not.' });
    upsert(db, 'tasks', { id: 'sop-update-gl-insurance', owner_id: 'james', backup_id: 'kenneth',
      next_action: 'Walk one real renewal with James before Maria leaves on 6 November.',
      waiting_on: null, updated_at: ts });
    { const h = db.prepare('SELECT * FROM handover_items WHERE id = ?').get('ho-vendor-insurance');
      if (h) upsert(db, 'handover_items', { id: 'ho-vendor-insurance', backup: 'James (owns it from 3 November); Kenneth updates QuickBooks', risk: 'low', status: 'reassigned',
        why: 'Owner settled on 3 November: James. The renewal procedure is written down step by step. What is still missing is not a person but a warning: the expiry date sits in the register, the certificate folder, BuildConnect and QuickBooks, and nothing tells anyone a certificate is about to lapse.',
        capture: 'Walk one real renewal with James before 6 November. Then fix the tracking so a lapse is noticed before it happens, not after.', updated_at: ts }); }

    addEvent(db, { entity_type: 'person', entity_id: 'lonnie', kind: 'setup', status: 'info',
      label: 'Manual: Lonnie added as incoming Construction/Permitting Lead, taking Maria\'s construction work (last day 6 November)',
      source: 'manual', actor: 'brittany', external_id: 'hub-session-2026-11-03' });
  } },
  { key: 'insurance-automation-2026-11-04', apply(db) {
    const ts = nowIso();
    const SRC = 'Brittany, 2026-11-04';

    // Not a conflict after all: Reece and GT are both plumbing vendors. Reece gets its own record.
    upsert(db, 'vendors', { id: 'vendor-plumbing-reece', trade: 'PLUMBING', vendor: 'Reece Plumbing', contacts: JSON.stringify([]),
      pricing_basis: 'per_bid', wo_review: 'reviewed',
      wo_instructions: 'Cost code 601. Split the valves and the trims onto separate lines. The purchase order is emailed to the vendor.',
      notes: 'One of two plumbing vendors; GT Plumbing is the other. Confirmed by Brittany 2026-11-04.', source: SRC, imported_at: ts, updated_at: ts });
    upsert(db, 'vendors', { id: 'vendor-plumbing', notes: [db.prepare('SELECT notes FROM vendors WHERE id = ?').get('vendor-plumbing')?.notes, 'One of two plumbing vendors; Reece Plumbing (cost code 601) is the other [Brittany 11/04].'].filter(Boolean).join(' ') });
    db.prepare("DELETE FROM wo_specifics WHERE id = 'ws-rule-plumbing-conflict'").run();
    upsert(db, 'wo_specifics', { id: 'ws-rule-reece', vendor_id: 'vendor-plumbing-reece', vendor_name: 'Reece Plumbing',
      detail: 'Cost code 601. Split the valves and the trims onto separate lines. The purchase order is emailed to the vendor.',
      scope: 'vendor', task_id: 'tr-wo-entry-from-bid', source: SRC, noted_on: '2026-11-04', updated_at: ts });
    upsert(db, 'wo_specifics', { id: 'ws-rule-plumbing-two-vendors', vendor_id: 'vendor-plumbing', vendor_name: 'PLUMBING — two vendors',
      detail: 'There are two plumbing vendors and both are current: GT Plumbing, and Reece Plumbing at cost code 601. Check which one the bid is from before applying a work-order rule; they are not interchangeable.',
      scope: 'vendor', task_id: 'tr-wo-entry-from-bid', source: SRC, noted_on: '2026-11-04', updated_at: ts });

    // The GL insurance renewal is meant to become an automated task. Four places is by design, not a defect:
    // each has its own users. What was missing is that updating them is manual and nothing warns beforehand.
    upsert(db, 'agents', { id: 'agent-vendor-compliance', name: 'Vendor compliance (GL insurance)', department_id: 'purchasing',
      purpose: 'Watch every vendor\'s general liability expiry, raise the renewal before it lapses, and once a human has checked the certificate, make the same change in all four places it has to appear.',
      setup_stage: 'documented', approach: 'mixed',
      approach_note: 'AI reads the certificate PDF, which is the only part that needs it. Everything else is deterministic: the countdown to expiry, matching the vendor, writing the register row, filing and archiving the PDF, the BuildConnect field, and the handoff to Kenneth.',
      human_authority: 'One gate, and it is the right one: a person checks the extracted dates against the certificate before anything is written. Insurance is what McVaugh relies on if a sub damages something, so a wrong date written into four systems is worse than no date. Kenneth still does QuickBooks himself.',
      initial_output: 'A renewal raised 60 days out, then 30, then overdue; and after approval, the four updates with a report of which ones went through.',
      enabled: 0, paused: 0, proposed: 1, n8n_workflow_id: 'mow-gl-insurance', updated_at: ts });

    upsert(db, 'tasks', { id: 'sop-update-gl-insurance', agent_id: 'agent-vendor-compliance', owner_id: 'james', backup_id: 'kenneth',
      trigger: 'The world raises it when a vendor\'s GL cover is 60 days from expiry, again at 30, and again once it has lapsed. A certificate arriving early also starts it.',
      // Correcting the earlier reading: the duplication is deliberate.
      missing_info: 'Nothing missing about where the date goes. The expiry has to appear in all four places because different people work in different ones: the register is what purchasing reads, the certificate folder is the evidence, BuildConnect is what the field and the database see, and QuickBooks is what accounting pays against. What is missing is the automation: today all four are updated by hand, one at a time.',
      automation_approach: 'n8n workflow mow-gl-insurance. The world watches the expiry dates and raises the renewal. A person checks the dates on the certificate against the PDF and approves — that is the only gate. The agent then makes the same change in all four places and reports which ones went through, so a half-finished update is visible instead of silent. The two hard parts are the register (a legacy .xls with three tabs, hidden rows and formulas, so it must be driven through real Excel rather than rewritten) and BuildConnect (a frameset whose save needs the parent frame, where blue text is not proof of a save and the stored date has to be read back).',
      verification_result: 'Written down and proven by hand. The warning and the approval gate are built and working in this app; the four writes are not automated yet.',
      next_action: 'Paste the register so every vendor has an expiry date, then let the 60-day warning raise the first renewal and walk it with James by hand once before automating any of it.',
      evidence: 'All four updated for the same vendor and expiry, with the register re-read after saving and the BuildConnect date re-opened and confirmed.', updated_at: ts });

    upsert(db, 'ai_configs', { id: 'ai-gl-certificate-read', agent_id: 'agent-vendor-compliance',
      purpose: 'Read a renewal certificate and pull out the insured vendor, the GL effective and expiry dates, and the workers comp expiry',
      needs_ai: 'yes, for the certificate only', provider: 'ChatGPT Business (existing seat) — the Update GL Insurance skill',
      model: 'as configured in the skill (not an API call)',
      why: 'Certificates are scanned PDFs with inconsistent layouts, and the insured vendor has to be told apart from the certificate holder, which is always McVaugh. Nothing else here needs a model: the countdown, the vendor match and all four writes are rules.',
      expected_cost: '$0 beyond the existing ChatGPT Business seat',
      approval: 'A person compares the extracted dates against the certificate before anything is written. The agent never writes on its own reading.',
      eval_examples: 'To build before this runs unattended: one certificate where McVaugh is the holder and the vendor is the named insured, one with GL and workers comp on the same page with different dates, one scanned at an angle, and one where the issue date could be mistaken for the expiry.',
      fallback: 'Type the dates in by hand from the PDF; the four updates and the approval gate are unchanged.', updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-insurance-four-places', date: '2026-11-04',
      title: 'The GL expiry stays in all four systems; the fix is automating the update, not consolidating',
      reason: 'Suggested picking one book of record and treating the rest as copies. Brittany: all four are used by different people, so all four have to be right. Consolidating would just move the problem onto whoever lost their system. The renewal is instead becoming an automated task: the world warns before expiry, a person checks the certificate once, and the agent makes the same change in all four and reports which ones went through.',
      decided_by: 'Brittany', status: 'accepted', source: SRC, created_at: ts });

    addEvent(db, { entity_type: 'agent', entity_id: 'agent-vendor-compliance', kind: 'setup', status: 'info',
      label: 'Manual: vendor compliance agent defined — warn at 60/30/expired, one human check of the certificate, then update all four systems',
      source: 'manual', actor: 'brittany', external_id: 'insurance-automation-2026-11-04' });
  } },
  { key: 'running-log-2026-11-04', apply(db) {
    const ts = nowIso();
    const SRC = 'Running log of vendor specifics (Brittany), pasted 2026-11-04';
    // Lowe's is in the log and in the hub's vendor rules but was never a vendor record, so the rule had
    // nowhere to attach. It is a supplier rather than a trade sub, which is why it was missed.
    upsert(db, 'vendors', { id: 'vendor-lowes', trade: 'MATERIALS — LOWES', vendor: 'Lowes Home Centers, Inc.',
      contacts: JSON.stringify([]), pricing_basis: 'per_bid', wo_review: 'reviewed',
      notes: 'Supplier, not a trade subcontractor. Receipts become purchase orders against the job.', source: SRC, imported_at: ts, updated_at: ts });

    // The log itself, stored so the detail survives outside the chat it was written in.
    const text = fs.readFileSync(path.join(__dirname, '..', 'seed', 'skills', 'running-log-2026-11-03.txt'), 'utf8');
    upsert(db, 'documents', { id: 'doc-running-log-2026-11-03', title: 'Running log — vendor work-order specifics (3 November)',
      kind: 'reference', kind_reason: 'the per-vendor detail Brittany keeps as she works', sensitive: 0, task_id: 'tr-wo-entry-from-bid',
      summary: 'Seven vendors with what a work order for each of them has to carry: cost codes, draw splits, how square footage is handled, where the source file goes and who gets told. Several entries deliberately say that a recorded precedent is not current pricing.',
      content: text, size: text.length, source: SRC, imported_at: ts, underlying_status: 'extracted' });

    const { parseSpecificsLog, matchVendorRows } = require('./imports');
    for (const r of parseSpecificsLog(text)) {
      const rows = matchVendorRows(db, r.vendor);
      const v = rows[0];
      const id = 'ws-' + slug(v ? v.id : r.vendor).slice(0, 52);
      upsert(db, 'wo_specifics', { id, vendor_id: v ? v.id : null, vendor_name: r.vendor, detail: r.detail || '',
        scope: 'vendor', task_id: 'tr-wo-entry-from-bid', source: SRC, noted_on: r.updated || '2026-11-03', updated_at: ts });
      for (const row of rows) upsert(db, 'vendors', { id: row.id, wo_instructions: r.detail, wo_review: 'reviewed' });
    }
    // The earlier, shorter versions of these rules came from the hub summary; the log supersedes them.
    for (const old of ['ws-rule-johnston', 'ws-rule-autumn', 'ws-rule-hh-fence', 'ws-rule-synergy', 'ws-rule-electrical-works', 'ws-rule-reece', 'ws-rule-lowes'])
      db.prepare('DELETE FROM wo_specifics WHERE id = ?').run(old);

    addEvent(db, { entity_type: 'task', entity_id: 'tr-wo-entry-from-bid', kind: 'import', status: 'info',
      label: 'Running log pasted: 7 vendors with their work-order specifics; Lowes added as a supplier record',
      source: 'import', actor: 'brittany', external_id: 'running-log-2026-11-04' });
  } },
  { key: 'hub-sop-steps-2026-11-04', apply(db) {
    const ts = nowIso();
    const SRC = 'MCH Operations Hub export, 3 November 2026';
    const { parseOpsHub } = require('./imports');
    const html = fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub-2026-11-03.html'), 'utf8');
    const hub = parseOpsHub(html);
    const proc = id => hub.processes.find(p => p.id === id);
    const numbered = p => (p.steps || []).map((s, i) => `${i + 1}. ${String(s).trim()}`).join('\n');

    // The seven the hub had and this app only knew by name. Owners are taken from what the 3 November
    // session recorded, not guessed: WO/PO entry went to James, the cash and draw work and starting a house
    // went to Brittany, and permitting goes to Lonnie as Maria's successor on construction and permits.
    const MAP = [
      ['sop-pur-01-wo-entry-buildconnect', 'wo_entry_buildconnect', 'james', 'ernesto'],
      ['sop-pur-02-material-po-entry', 'material_po_entry', 'james', 'ernesto'],
      ['sop-pur-03-lowes-receipt-po', 'lowes_po_buildconnect', 'james', 'kenneth'],
      ['sop-fin-01-cash-flow-rollover', 'cash_report_weekly', 'brittany', 'kenneth'],
      ['sop-fin-02-draw-schedule-bank', 'draw_schedule_update', 'brittany', 'kenneth'],
      ['sop-start-house-buildconnect', 'start_house_database', 'brittany', 'lonnie'],
      ['sop-permitting-ipermits-projectdox', 'permitting_current', 'lonnie', 'brittany'],
    ];
    let filled = 0;
    for (const [taskId, hubId, owner, backup] of MAP) {
      const p = proc(hubId); if (!p) continue;
      upsert(db, 'tasks', { id: taskId, title: p.name, owner_id: owner, backup_id: backup,
        steps: numbered(p), documented: (p.steps || []).length ? 1 : 0,
        trigger: p.description || null, missing_info: null,
        next_action: 'Walk it once with the person who now owns it, then mark it verified.',
        source: SRC, updated_at: ts });
      upsert(db, 'documents', { id: 'doc-' + taskId, title: p.name + ' — as written in the hub', kind: 'procedure',
        kind_reason: 'the SOP text from the 3 November hub export', sensitive: 0, task_id: taskId,
        summary: `${(p.steps || []).length} steps. ${String(p.description || '').slice(0, 300)}`,
        content: [p.name, '', p.description || '', '', ...(p.steps || []).map((s, i) => `${i + 1}. ${s}`)].join('\n'),
        source: SRC, imported_at: ts, underlying_status: 'extracted' });
      const t = db.prepare('SELECT doc_ids FROM tasks WHERE id = ?').get(taskId);
      const ids = JSON.parse(t.doc_ids || '[]'); if (!ids.includes('doc-' + taskId)) upsert(db, 'tasks', { id: taskId, doc_ids: [...ids, 'doc-' + taskId] });
      filled++;
    }

    // The hub also carries a 21-step rendering of the GL insurance renewal. Kept beside the skill text
    // rather than replacing it, because the skill is what the agent runs and the two have drifted.
    const gl = proc('gl_insurance_update');
    if (gl) {
      upsert(db, 'documents', { id: 'doc-hub-gl-insurance-steps', title: 'Vendor GL Insurance Certificate Renewal — hub version (21 steps)',
        kind: 'procedure', kind_reason: 'the hub rendering of the same process; longer than the skill text', sensitive: 0,
        task_id: 'sop-update-gl-insurance',
        summary: 'The hub writes this renewal as 21 numbered steps; the ChatGPT skill writes it as 14 across five phases. Same process, two versions. Reconcile before either is automated.',
        content: [gl.name, '', gl.description || '', '', ...(gl.steps || []).map((s, i) => `${i + 1}. ${s}`)].join('\n'),
        source: SRC, imported_at: ts, underlying_status: 'extracted' });
      const t = db.prepare('SELECT doc_ids, missing_info FROM tasks WHERE id = ?').get('sop-update-gl-insurance');
      upsert(db, 'tasks', { id: 'sop-update-gl-insurance', doc_ids: [...new Set([...JSON.parse(t.doc_ids || '[]'), 'doc-hub-gl-insurance-steps'])],
        missing_info: [t.missing_info, 'The hub writes this as 21 steps and the ChatGPT skill as 14 across five phases. Pick one before automating, so the agent and the people are following the same thing.'].filter(Boolean).join(' ') });
    }

    // Full names the hub carries and this app did not.
    for (const m of (hub.team || [])) {
      const pid = m.id === 'purchasing' ? 'ernesto' : m.id;
      const person = db.prepare('SELECT id, full_name FROM people WHERE id = ?').get(pid); if (!person) continue;
      const full = String(m.name || '').trim();
      if (full && !/\[/.test(full) && full !== person.full_name) upsert(db, 'people', { id: pid, full_name: full, updated_at: ts });
    }
    upsert(db, 'people', { id: 'lonnie', notes: 'INCOMING — Construction / Permitting Lead, taking Maria\'s construction and permitting work [HUB 11/03]. The hub still shows "Lonnie [Update Last Name]": the surname and email are the outstanding piece. 53 responsibilities already assigned to him there.', updated_at: ts });

    upsert(db, 'documents', { id: 'doc-ops-hub-2026-11-03', title: 'MCH Operations Hub — export of 3 November 2026', kind: 'dashboard',
      kind_reason: 'the hub as it stood after Brittany\'s 3 November session', sensitive: 0,
      summary: `33 SOPs (all with steps), 9 people, 16 legacy roles. Source of the seven SOPs this app had only by name, and of everyone's full names.`,
      path: 'mch-ops-hub-2026-11-03.html', source: SRC, imported_at: ts, underlying_status: 'extracted' });

    addEvent(db, { entity_type: 'integration', entity_id: 'dashboard', kind: 'import', status: 'info',
      label: `Hub export read: ${filled} SOPs filled in with their steps, owners assigned from the 3 November session`,
      source: 'import', actor: 'brittany', external_id: 'hub-sop-steps-2026-11-04' });
  } },
  { key: 'checkpoint-2026-11-04', apply(db) {
    const ts = nowIso();
    // The previous checkpoint still said "paste the 7 named SOP skill texts". They were filled from the hub
    // export on 4 November, so that advice was stale the moment it was carried out. Checkpoints are stored
    // text, not derived, so an update that finishes a step has to retire the step as well.
    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ts, 'map',
        'Hub and world lined up: all 33 hub SOPs exist here, the seven that were name-only now carry their steps, and no procedure is left undocumented.',
        'Read the 3 November hub export: seven SOPs filled in with steps and owners (work orders, material POs and Lowe\'s to James; cash, draws and starting a house to Brittany; permitting to Lonnie), everyone\'s full names, and the vendor running log.',
        'Walk the three purchasing procedures with James and the permitting one with Lonnie before Maria\'s last day on 6 November. Those four are the work actually changing hands.',
        'Lonnie (surname and email — the hub still shows "Update Last Name"); Jim, on how Maria\'s 14 purchasing items split between Lonnie and James',
        'How the purchasing items split between Lonnie and James; which change-order steps are genuinely no longer done; whether the GL renewal follows the hub\'s 21 steps or the skill\'s 14',
        'Checkpoint refreshed after the hub import. The earlier one still asked for the seven SOPs to be pasted; they came out of the hub export instead.', 'brittany');
    addEvent(db, { entity_type: 'system', entity_id: 'checkpoint', kind: 'setup', status: 'info',
      label: 'Checkpoint refreshed: the seven SOPs are in, so the "paste them" step is retired',
      source: 'manual', actor: 'brittany', external_id: 'checkpoint-2026-11-04' });
  } },
  { key: 'meeting-james-2026-11-03', apply(db) {
    const ts = nowIso();
    const SRC = 'Meeting recording: James McVaugh, Brittany, Lonnie — 3 November 2026, 1h27m';
    const CITE = '[J 11/03]';
    const { docxText } = require('./imports');
    const fp = path.join(__dirname, '..', 'seed', 'meetings', 'james-2026-11-03.docx');
    const text = docxText(fs.readFileSync(fp)).replace(/&apos;/g, '’');
    upsert(db, 'documents', { id: 'doc-meeting-james-2026-11-03', title: 'House-by-house status meeting — 3 November 2026', kind: 'meeting',
      kind_reason: 'Teams recording transcript', sensitive: 0, meeting_date: '2026-11-03', cite_key: 'J 11/03',
      attendees: JSON.stringify(['james', 'brittany', 'lonnie']),
      summary: 'Walked the four Royal Parkside villas one by one, then permits and the outlying jobs. Lonnie was handed the schedules for 11603 and 11607, the lumber drops, and the inspection report and punch list for the model. Automatic transcript with heavy crosstalk, so names and some figures are unreliable; what is recorded below is only what was clear.',
      content: text.slice(0, 400 * 1024), size: text.length, source: SRC, imported_at: ts,
      file_path: fp, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', underlying_status: 'extracted' });

    const H = (id, fields) => { if (db.prepare('SELECT 1 FROM homes WHERE id = ?').get(id)) upsert(db, 'homes', { id, status_cite: CITE, updated_at: ts, ...fields }); };
    H('job-765', { active: 'active', stage: 'The model — punch-out and exterior paint',
      next_milestone: 'Lonnie and James walk the inspection report and punch list together (4 Nov); painters back on the exterior once it stops raining.',
      issues: 'Drywall crew were in to fix doors. Exterior paint was walked with the painters on 2 Nov but rain may have stopped them. Painters are needed in the model again after the sheetrockers. Furniture and the patio furniture in the garage go back to the storage unit on Richmond; the garages have to be emptied apart from the window, door and tub. Nobody was sure who holds the storage key.' });
    H('job-766', { active: 'active', stage: 'Active punch-out, finals in progress',
      next_milestone: 'Structural final re-inspection on site 4 Nov with plans and permits; proper punch-out walk on Friday once the painters and cleaners are done.',
      issues: 'Painters are doing the punch-out; a final clean needs booking before Friday. Vent hood, and securing the oven and microwave, due 4 Nov. The oven handle for the model has not arrived — Lonnie is tracking it. Work orders are done. The draw was requested from First Financial and is believed received, but that was not confirmed in the meeting.' });
    H('job-767', { active: 'active', stage: 'Framing; cabinet drawings under review',
      next_milestone: 'Review the cabinet drawings against the plans and selections with Lonnie before they go to production; Lonnie to build a Microsoft Project schedule for this house and 11607.',
      issues: 'Cabinet drawings arrived 3 Nov. Pricing was already compared with the old model about four months ago and the increase was justified by extra cabinets including a trash cabinet; James wants the drawings checked for doors versus added cabinets. Selection sheets are not finalised — Danielle is back next week to finish them.' });
    H('job-768', { active: 'active', stage: 'Slab down, framing about to start (plan 3A, modified to four bedrooms)',
      next_milestone: 'Trusses arrive 4 Nov; framer starts Friday once the lumber is released. Framing runs about three weeks through corners and deck with inspections.',
      issues: 'The framer is waiting on confirmation that the lumber has been released. Grading is done and the site is cleared. Doors and windows are ready whenever wanted, no delay there. Work orders are good through plumbing, electrical, framing and roofing, but there is no mechanical work order and nobody knew why. No selections recorded for this house yet. Same plan as 11602 behind it, with the game room made into a fourth bedroom with a full bath.' });
    H('job-854', { active: 'active', stage: 'Leander Builders building it; utilities being finalised',
      next_milestone: 'City was due to enter it on 4 Nov so the impact fees and the meter fee can be paid.',
      issues: 'Landscaping is installed. Leander Builders is handling the build; Brittany emails them to make contact with James.' });

    // Things the meeting raised that are nobody's task yet.
    const T = (id, o) => upsert(db, 'tasks', { id, department_id: o.dept, owner_id: o.owner, backup_id: o.backup || null,
      title: o.title, trigger: o.trigger || null, steps: null, documented: 0, automated: 0, verified: 0, board: o.board || 'next',
      proposed: 0, missing_info: o.missing || null, next_action: o.next, blocker: o.blocker || null, source: SRC + ' ' + CITE, updated_at: ts });
    T('j1103-mechanical-wo-11607', { dept: 'purchasing', owner: 'james', backup: 'lonnie',
      title: '11607: find out why there is no mechanical work order', board: 'next',
      trigger: 'Raised 3 Nov: work orders are complete through plumbing, electrical, framing and roofing, but mechanical is missing and nobody knew why.',
      next: 'Check the database for a mechanical work order on 11607 and raise one if it is genuinely absent.' });
    T('j1103-file-locations-doc', { dept: 'executive', owner: 'brittany', backup: 'teresa',
      title: 'Write down where all the files live — plans, colours, selections', board: 'next',
      trigger: 'James, 3 Nov: "one of the documents I need to do is where all the files are. All the plans, all the colour, everything."',
      missing: 'The exterior colour matrix is said to be in the "how to build a house" document with its file path, and Teresa holds the master copy signed by Jim. That needs confirming and writing down in one place.',
      next: 'List each document type and its path; confirm the signed colour matrix with Teresa.' });
    T('j1103-exterior-colour-change', { dept: 'design', owner: 'james', backup: 'lonnie',
      title: 'Decide whether to lighten the villa exterior colour before stucco', board: 'next',
      trigger: 'James wants the exterior lightened by a shade; it has to be settled before stucco starts on 11603 and 11607.',
      missing: 'There is a long-running disagreement about whether the paint and the stucco match; Jim is not satisfied. The stucco mix differs from the paint even though both are Sherwin-Williams.',
      next: 'Settle the colour with Jim before the stucco contractor starts.' });
    T('j1103-hoa-wall-repairs', { dept: 'hoa', owner: 'james', backup: 'teresa',
      title: 'HOA front wall: crack repair and repainting (11507 end)', board: 'next',
      trigger: 'Phase one of the wall repairs was agreed but has not been started.',
      missing: 'Alberto quoted for the repaint but nobody could remember the figure. MCH is the HOA here and is responsible for the walls, landscaping and common areas; there are reserves, but this has to be checked against the budget first.',
      next: 'Find Alberto’s price, check it against the HOA budget, then schedule the front wall.' });
    T('j1103-townhome-permits', { dept: 'permits', owner: 'lonnie', backup: 'brittany',
      title: 'Townhomes: update and push the two submitted permit applications', board: 'next',
      trigger: 'Both buildings are submitted with project numbers and open applications. Nothing is approved.',
      missing: 'Both were submitted for OLA and need updating. Both are to be the new fives with a third floor, three storeys like the building next to them.',
      next: 'James wants Lonnie to run these, using the document Brittany has just finished on how to start a new application.' });
    T('j1103-anna-maria-remodel', { dept: 'estimating', owner: 'james', backup: 'pam',
      title: 'Anna Maria remodel (Royal Oaks): needs plans before it can be priced', board: 'waiting',
      trigger: 'She wants a price for added square footage and redone elevations throughout.',
      missing: 'It cannot be bid without plans, and drawings cost money. She has not replied to the email.',
      next: 'Chase the reply, then agree who pays for the drawings before quoting.' });

    // Two people keeping the same vendor list is the same duplication problem as the hub.
    upsert(db, 'wo_specifics', { id: 'ws-vendor-list-duplication', vendor_name: 'ALL — which vendor list is right?',
      detail: 'Brittany keeps a spreadsheet of which vendor was used at each construction stage for each villa; James says the current list already lives in the workflow folder. Brittany’s is per house and historical (the plumber changed between houses, Shelltex then another), James’s is the current vendors only. Both are useful and neither is wrong, but agree which one is checked before a work order is raised.',
      scope: 'vendor', task_id: 'tr-wo-entry-from-bid', source: SRC + ' ' + CITE, noted_on: '2026-11-03', updated_at: ts });

    // Lonnie is being handed real work now, which is what the handover was waiting for.
    upsert(db, 'people', { id: 'lonnie', review_status: 'under_review',
      role_summary: 'Construction and permitting. Taking the schedules for 11603 and 11607, the lumber drops, the model’s inspection report and punch list, and the townhome permit applications. Learning the plan reviews alongside James.',
      updated_at: ts });
    for (const [hid, note] of [['ho-scheduling', '11/03: Lonnie takes the 11603 and 11607 schedules, to be built in Microsoft Project, after James walks him through the lumber drops. First real handover of a schedule.'],
      ['ho-trade-calls', '11/03: James is going through the model’s punch list with Lonnie and telling him who to call for what.']])
      { const h = db.prepare('SELECT note FROM handover_items WHERE id = ?').get(hid); if (h) upsert(db, 'handover_items', { id: hid, note: [h.note, note].filter(Boolean).join('\n'), updated_at: ts }); }

    addEvent(db, { entity_type: 'document', entity_id: 'doc-meeting-james-2026-11-03', kind: 'import', status: 'info',
      label: 'Meeting stored: house-by-house status with James and Lonnie, 3 November; five jobs updated and six follow-ups raised',
      source: 'import', actor: 'brittany', external_id: 'meeting-james-2026-11-03' });
  } },
  { key: 'purchasing-split-2026-11-04', apply(db) {
    const ts = nowIso();
    const SRC = 'Maria to Brittany, 2026-11-04 07:30';
    const CITE = '[M-chat 11/04]';
    // Maria's answer to "who takes over your pricing and coordination": Lonnie, because it needs somebody
    // who knows what they are looking at in a bid — whether it is accurate and matches the specification.
    // Once the price is negotiated and agreed, James raises the work order or PO. Judgment and entry split.
    upsert(db, 'documents', { id: 'doc-maria-purchasing-split', title: 'Maria on who takes over pricing and coordination (11/04)',
      kind: 'procedure', kind_reason: 'Maria answering the open question directly, four days before she leaves',
      sensitive: 0, meeting_date: '2026-11-04', cite_key: 'M-chat 11/04', attendees: JSON.stringify(['maria', 'brittany']),
      summary: 'Lonnie takes pricing and coordination, because reviewing a bid needs someone who can tell whether it is accurate and matches the specifications provided. Once the price is negotiated and agreed, James does the work order or PO.',
      content: 'Brittany: who takes over Maria’s pricing and coordination responsibilities.\n\nMaria: this should be Lonnie. like we discussed in the meeting on Monday, it needs to be somebody that knows what they are looking for/at in the bids received so they know it is accurate and it matches the specifications provided, etc. once the price is negotiated and agreed, then James can come in and do the work order or PO necessary,',
      source: SRC, imported_at: ts, underlying_status: 'extracted' });

    upsert(db, 'decisions', { id: 'dec-purchasing-split-lonnie-james', status: 'accepted', decided_by: 'Maria, confirming what was agreed in the Monday meeting',
      title: 'Lonnie prices and coordinates; James raises the work order or PO once the price is agreed',
      reason: 'Maria, 4 November: the bid review has to sit with someone who knows what they are looking at, so they can tell whether a bid is accurate and matches the specifications provided. That is Lonnie. Once the price is negotiated and agreed, James comes in and does the work order or PO. The line is judgment versus entry, not purchasing versus construction, which is why it does not split neatly by department. ' + CITE,
      source: SRC });

    // Judgment work follows Lonnie.
    for (const [id, note] of [
      ['tr-bids-and-sqft-rates', 'Lonnie reviews the bid against the specification and agrees the price; James raises the work order afterwards ' + CITE],
      ['tr-schedule-and-trade-coordination', 'Coordination passes to Lonnie ' + CITE],
      ['tr-field-verification-and-draws', 'Verifying the work before a draw is judgment, so it follows Lonnie ' + CITE],
    ]) { const t = db.prepare('SELECT approval_rules FROM tasks WHERE id = ?').get(id); if (!t) continue;
      upsert(db, 'tasks', { id, owner_id: 'lonnie', backup_id: 'james',
        approval_rules: [t.approval_rules, note].filter(Boolean).join(' '), updated_at: ts }); }
    upsert(db, 'tasks', { id: 'tr-selections-vendor-bidding', owner_id: 'lonnie', backup_id: 'danielle',
      missing_info: 'Danielle still owns the selections themselves; what moves to Lonnie is pricing them and judging new vendor bids ' + CITE, updated_at: ts });

    // Entry work follows James.
    for (const id of ['tr-purchase-orders-materials', 'tr-wo-entry-from-bid'])
      if (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(id))
        upsert(db, 'tasks', { id, owner_id: 'james', backup_id: 'lonnie',
          trigger: 'A price has been reviewed and agreed by Lonnie. James then raises the work order or purchase order. ' + CITE, updated_at: ts });

    // The handover items this settles.
    for (const [hid, backup, why] of [
      ['ho-bids-vendors', 'Lonnie (prices and negotiates); James raises the WO/PO afterwards',
        'Settled 4 November: Lonnie takes this, because judging whether a bid is accurate and matches the specification needs someone who knows what they are looking at ' + CITE + '. He is new, so the knowledge of who to call and what a fair price looks like is still the thing to capture before Maria goes.'],
      ['ho-budget-check', 'Lonnie checks the bid; Jim still decides anything over budget',
        'Settled 4 November: checking a bid against the budget sits with Lonnie as part of pricing ' + CITE + '. Over the line it is still Jim.'],
      ['ho-work-orders', 'James (entry), from a price Lonnie has agreed',
        'Settled 4 November: James raises the work order once the price is agreed ' + CITE + '. The judgment about whether the price is right is not his.'],
      ['ho-purchase-orders', 'James (entry), from a price Lonnie has agreed',
        'Settled 4 November: same split as work orders ' + CITE + '.'],
    ]) { const h = db.prepare('SELECT * FROM handover_items WHERE id = ?').get(hid); if (!h) continue;
      upsert(db, 'handover_items', { id: hid, backup, why, status: 'reassigned', risk: hid === 'ho-bids-vendors' ? 'high' : 'medium',
        capture: hid === 'ho-bids-vendors'
          ? 'Sit Lonnie down with Maria over two or three real bids before 6 November: what she checks first, what makes a bid wrong, and what a fair number looks like per trade.'
          : h.capture,
        doc_ids: [...new Set([...JSON.parse(h.doc_ids || '[]'), 'doc-maria-purchasing-split'])], updated_at: ts }); }

    upsert(db, 'people', { id: 'lonnie',
      role_summary: 'Construction, permitting, and now pricing and trade coordination. Reviews bids against the specification, negotiates and agrees the price; James raises the work order or PO afterwards ' + CITE + '. Holds the schedules for 11603 and 11607, the lumber drops, the model’s punch list and the townhome permits.',
      departments: ['construction', 'permits', 'purchasing'], updated_at: ts });

    // The thing this makes urgent: Lonnie inherits the judgment with none of the experience behind it.
    upsert(db, 'tasks', { id: 'tr-lonnie-bid-review-handover', title: 'Walk real bids with Maria and Lonnie before she leaves',
      department_id: 'purchasing', owner_id: 'brittany', backup_id: 'james', board: 'working', proposed: 0,
      documented: 0, automated: 0, verified: 0,
      trigger: 'Maria named Lonnie for pricing on 4 November; her last day is the 6th.',
      inputs: 'Two or three bids already in hand, ideally from different trades including one priced per square foot.',
      steps: '1. Pick two or three recent bids, including a per-square-foot trade.\n2. Maria walks Lonnie through each: what she looks at first, how she checks it against the specification, what would make her reject it.\n3. Write down what she checks, in her words, against each trade.\n4. Lonnie prices the next live bid with Maria watching rather than the other way round.',
      missing_info: 'Everything about how Maria judges a bid is still only in her head. The procedure for entering a work order is written down; the judgment that comes before it is not.',
      next_action: 'Book it for 5 November. This is the last of Maria’s knowledge that has no written form and no backup.',
      source: SRC + ' ' + CITE, updated_at: ts });

    addEvent(db, { entity_type: 'person', entity_id: 'lonnie', kind: 'setup', status: 'info',
      label: 'Manual: Maria named Lonnie for pricing and coordination; James raises the work order or PO once the price is agreed',
      source: 'manual', actor: 'brittany', external_id: 'purchasing-split-2026-11-04' });
  } },
  { key: 'rol-scope-2026-11-04', apply(db) {
    const ts = nowIso();
    const SRC = 'Revised scope of work and specifications, Royal Oaks Landing Plan 1A — Urban Edge Builders (Frank Martin), dated 14 October 2026; sent by Maria 4 November 2026';
    const CITE = '[ROL SOW 10/14]';
    const { docxText } = require('./imports');
    const fp = path.join(__dirname, '..', 'seed', 'meetings', 'rol-scope-2026-10-14.docx');
    const text = docxText(fs.readFileSync(fp)).replace(/&apos;/g, '’');
    upsert(db, 'documents', { id: 'doc-rol-scope-2026-10-14', title: 'Royal Oaks Landing — scope of work and specifications, Plan 1A (Frank Martin)',
      kind: 'reference', kind_reason: 'the Landing scope Brittany has been waiting on since 20 October', sensitive: 0,
      meeting_date: '2026-10-14', cite_key: 'ROL SOW 10/14',
      summary: 'Urban Edge Builders’ construction proposal for one Plan 1A two-storey house at Royal Oaks Landing, 2,035.39 SF air conditioned, addressed to Maria. Sets out what is built, what is included at the contract price, what is an allowance and what is excluded. Maria: the highlights are what is still waiting on information, and the items marked "(by owner)" are McVaugh’s own scope. Not signed; several blanks and open questions remain.',
      content: text, size: text.length, source: SRC, imported_at: ts,
      file_path: fp, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', underlying_status: 'extracted' });

    // What McVaugh does itself, marked "(by owner)" in the proposal. The site-and-permitting line is
    // genuinely ambiguous about where the marker starts, so it is recorded as ambiguous rather than guessed.
    upsert(db, 'tasks', { id: 'tr-landing-frank-scope', owner_id: 'lonnie', backup_id: 'james', documented: 1, updated_at: ts,
      trigger: 'A Landing house is to be built. Frank Martin’s company (Urban Edge Builders) is the contractor; this says which parts McVaugh still carries.',
      inputs: 'The scope of work and specifications for the plan being built ' + CITE + '.',
      steps: 'McVaugh’s own scope, from the items marked "(by owner)":\n1. Geotechnical investigation and soil report (excluded by Frank).\n2. Form survey and final survey (excluded by Frank, along with title insurance, appraisal and all lender and closing costs).\n3. Water, sewer and wastewater impact fees (excluded by Frank).\n4. Part of the site and permitting line, where "(by owner)" is written mid-sentence — see the missing information below.\n\nEverything else in the included scope is Urban Edge Builders at the contract price.',
      missing_info: 'The site and permitting line reads "Survey and form-board survey, foundation check, HOA and ARC submittal, (by owner) excavation, select fill, temporary power, water and sanitary facilities, silt fence and stormwater controls, dumpster and site cleanup." The marker sits in the middle of the list and it is not clear whether it applies to what comes before it or everything after. That is the difference between McVaugh paying for excavation, fill, temporary utilities and site cleanup or not. Ask Frank to re-punctuate that line before anyone signs.',
      next_action: 'Get the site and permitting line clarified in writing, then confirm the four (by owner) items are in the McVaugh budget for each Landing lot.',
      source: SRC, doc_ids: ['doc-rol-scope-2026-10-14'] });

    // The commercially significant contradiction. Not resolved here: it changes who pays.
    upsert(db, 'decisions', { id: 'dec-rol-allowance-or-standard', date: '2026-11-04',
      title: 'Royal Oaks Landing: are the eleven finish categories allowances or standard?',
      reason: 'Section Four is headed REMAINING ALLOWANCES and says "These ten items have no fixed specification yet and are carried as allowances until quotations are obtained." The next sentence says "Categories highlighted below have been discussed and agreed as STANDARD, not allowances". Every one of the rows beneath it is highlighted, which would mean nothing is left as an allowance — yet the signature page carries a total of $98,700 in allowances. Both cannot be true. If they are allowances, McVaugh pays any overage plus overhead and profit by change order; if they are standard, they are in the contract price. Nobody should sign until Frank says which. The sentence also has no full stop and reads like it was inserted later. ' + CITE,
      decided_by: 'Frank Martin to clarify', status: 'open', source: SRC, created_at: ts });

    // The eleven categories and what each is still waiting for.
    upsert(db, 'tasks', { id: 'tr-rol-open-selections', title: 'Royal Oaks Landing Plan 1A: close out the open finish selections',
      department_id: 'design', owner_id: 'lonnie', backup_id: 'danielle', board: 'working', proposed: 0,
      documented: 1, automated: 0, verified: 0,
      trigger: 'The scope lists eleven finish categories with no fixed specification.',
      steps: '1. Cabinetry and vanities — selections per samples presented to owner.\n2. Countertops — selections available per samples; "island with waterfall?" is still a question in the document.\n3. Masonry and stone veneer — owner is waiting on samples.\n4. Exterior stucco system — colour to be selected by owner.\n5. Landscaping and sod.\n6. Stair rail and baluster package — contemporary wood handrail, matte black iron balusters as presented.\n7. Irrigation — must meet City of Houston requirements.\n8. Mirrors and shower enclosures — frameless enclosures, plate mirrors to ceiling in master bathrooms.\n9. Decorative light fixtures — selections to be decided.\n10. Door and cabinet hardware — brushed nickel, polished chrome and matte black.\n11. Carpet — bedrooms, closets, stairs and landings.',
      missing_info: 'The section says ten items and lists eleven. No amount is shown against any line; the only figure is a $98,700 total on the signature page. Window style is marked TBD. Three tile lines say "additional selections and options TBD based on recent meetings" without saying which meetings or what was decided. Several entries are literally rows of question marks. The flooring colour has a deadline sentence with the date left blank, and if it passes Urban Edge proceeds with its own standard vinyl plank.',
      next_action: 'Ask Frank for the per-line allowance amounts and the missing specifications; fill in the flooring deadline date before it becomes his choice by default.',
      source: SRC, doc_ids: ['doc-rol-scope-2026-10-14'], updated_at: ts });

    upsert(db, 'tasks', { id: 'tr-rol-document-errors', title: 'Royal Oaks Landing scope: corrections to raise with Frank before signing',
      department_id: 'estimating', owner_id: 'james', backup_id: 'lonnie', board: 'next', proposed: 0,
      documented: 1, automated: 0, verified: 0,
      trigger: 'Reading the 14 October proposal before it is signed.',
      steps: '1. Allowance or standard? Section Four contradicts itself and the $98,700 total (see the open decision).\n2. "These ten items" introduces a list of eleven.\n3. No allowance amount is given on any individual line.\n4. The carpet line covers "stairs from second to third floor and landings" on a plan described throughout as two storey. Either the line was copied from a three-storey plan or the plan is wrong.\n5. The "(by owner)" marker in the site and permitting line is mid-sentence and ambiguous.\n6. Two blanks are unfilled: the lot and block, and the date by which the flooring selection must be confirmed in writing.',
      evidence: 'A revised proposal from Frank with each of these resolved in writing.',
      next_action: 'Send the list to Frank in one message rather than piecemeal; none of it should wait for Maria to chase.',
      source: SRC, doc_ids: ['doc-rol-scope-2026-10-14'], updated_at: ts });

    // This closes one of the things Maria owed, and opens the real work behind it.
    for (const [hid, note] of [
      ['ho-landing-frank', 'RECEIVED 4 November: the scope of work and specifications arrived, dated 14 October ' + CITE + '. It names the four things McVaugh carries at the Landing, so "what we do vs what Frank does" is answered on paper. What it does not settle: whether eleven finish categories are allowances or standard, which is a $98,700 question, and where the "(by owner)" marker starts in the site and permitting line.'],
      ['ho-permits', '4 November: the Landing scope confirms HOA and ARC submittal sits inside Frank’s included scope, not McVaugh’s ' + CITE + '.'],
    ]) { const h = db.prepare('SELECT note, doc_ids FROM handover_items WHERE id = ?').get(hid); if (!h) continue;
      upsert(db, 'handover_items', { id: hid, note: [h.note, note].filter(Boolean).join('\n'),
        doc_ids: [...new Set([...JSON.parse(h.doc_ids || '[]'), 'doc-rol-scope-2026-10-14'])], updated_at: ts }); }
    { const h = db.prepare('SELECT * FROM handover_items WHERE id = ?').get('ho-landing-frank');
      if (h) upsert(db, 'handover_items', { id: 'ho-landing-frank', documented: 'yes — scope of work received 4 November',
        backup: 'Lonnie (takes the Landing supervision with James on the commercial side)', status: 'captured',
        task_ids: [...new Set([...JSON.parse(h.task_ids || '[]'), 'tr-landing-frank-scope', 'tr-rol-open-selections', 'tr-rol-document-errors'])], updated_at: ts }); }

    addEvent(db, { entity_type: 'document', entity_id: 'doc-rol-scope-2026-10-14', kind: 'import', status: 'info',
      label: 'Landing scope of work received from Maria — McVaugh’s four (by owner) items recorded; allowance-or-standard contradiction raised',
      source: 'import', actor: 'brittany', external_id: 'rol-scope-2026-11-04' });
  } },
  { key: 'permitting-provenance-2026-11-08', apply(db) {
    const ts = nowIso();
    const SRC = 'Comparison of the 3 and 4 November hub exports, 2026-11-08';
    // Three permitting procedures exist and only one has ever been checked against what Maria said.
    // The 14-step "current" version was drafted from review notes in the same session that created it and
    // names jurisdictions McVaugh does not build in, so it is not a record of how permits are actually pulled.
    upsert(db, 'tasks', { id: 'sop-permitting-ipermits-projectdox', documented: 0, verified: 0,
      title: 'Permitting Process — iPermits / ProjectDox (current, not yet verified)',
      missing_info: 'Not a record of how McVaugh actually permits. The 14-step version in the 3 November hub was drafted from review notes and told the reader to "log into iPermits for the applicable jurisdiction (Leander, Cedar Park, etc.)". Cedar Park appears nowhere in any McVaugh record; Leander exists as a builder name and an ARC plan review, not a jurisdiction. McVaugh builds in Houston and Harris County, and Maria’s own build document names the real portal: the City of Houston iPermits site. The 4 November rewrite is shorter but more honest — it says "the Houston workflow described by Maria" and points at her completed new-application how-to.',
      blocker: 'The real source material is Maria’s new-application document, which has not been attached here, plus the City of Houston steps already captured in her build sequence. Until one of those is written up, this procedure is a placeholder.',
      next_action: 'Get Maria’s completed new-application how-to, then rebuild this from it and from the city inspection steps in "How to build a house". Do not restore the 14-step version.',
      source: SRC, updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-permitting-source-of-truth', date: '2026-11-08',
      title: 'Which permitting procedure is the real one',
      reason: 'Three exist. The 2004 legacy SOP (42 steps) is the only one reconciled against Maria’s transcripts, but it describes the process as it was twenty-two years ago. The 14-step "current" version drafted on 3 November was never checked and names jurisdictions McVaugh does not build in. The 4 November rewrite (7 steps) is accurate about what is unknown but is not yet a procedure anyone can follow. The material to build a real one exists: Maria’s new-application document, and the City of Houston permit and inspection steps already recorded in her build sequence. Lonnie owns permitting and Maria has left, so this needs doing rather than deciding.',
      decided_by: 'open — Brittany and Lonnie', status: 'open', source: SRC, created_at: ts });

    addEvent(db, { entity_type: 'task', entity_id: 'sop-permitting-ipermits-projectdox', kind: 'setup', status: 'info',
      label: 'Correction: the 14-step permitting procedure was drafted from review notes, not from Maria, and named jurisdictions McVaugh does not build in',
      source: 'manual', actor: 'brittany', external_id: 'permitting-provenance-2026-11-08' });
  } },
  { key: 'purchasing-rewrite-losses-2026-11-08', apply(db) {
    const ts = nowIso();
    const SRC = 'Comparison of the 3 and 4 November hub exports, 2026-11-08';
    // The 4 November rewrites added good corrections and removed the mechanics. Recorded against each
    // procedure so the next person to edit them knows what to put back rather than rediscovering it.
    upsert(db, 'tasks', { id: 'sop-pur-01-wo-entry-buildconnect', verified: 0,
      missing_info: 'The 4 November rewrite (15 steps to 11) dropped: the navigation (Jobs, routed job, New Work Order in the BuildConnect frame); why the payment-period count goes first (changing it reloads the form); submitting via the passcode-box Enter step and keeping the passcode private; leaving completion and payment flags unset for new work; "never create a duplicate" as a stop rule; and the calendar-persistence workaround (report requested versus saved date, preserve the existing record). Three vendor rules also left this procedure for the vendor-rules panel: Synergy 30/50/20, Electrical Works code 620, Reece 601 split valves and trims. What it gained is worth keeping: a source document alone is not spending approval, do not substitute the bill-to address, do not sign for vendors, and the ten-minute turnaround was discussed rather than committed.',
      next_action: 'Merge: put the dropped mechanics back as the body and keep the new caveats around them.',
      source: SRC, updated_at: ts });
    upsert(db, 'tasks', { id: 'sop-pur-02-material-po-entry', verified: 0,
      missing_info: 'The 4 November rewrite (15 steps to 8) dropped: the navigation (Jobs, correct job, New Purchase Order); cost code 996 for Lowe’s and Home Depot; using a single draw for standalone quotes; separating merchandise from tax; verifying the form recalculates after blur; the proposal-date versus invoice-date rule; verifying the cost code on the saved PO; and the distinction between Complete, Received, Pay and Paid In Full. It also dropped an open question rather than answering it: who owns this procedure, who backs it up, and what someone may spend without asking.',
      blocker: 'Nobody has been named as owner or backup for material POs, and no spending authority boundary has been set. The 3 November version flagged this; the 4 November rewrite removed the flag.',
      next_action: 'Decide the owner, the backup and the spending boundary, then merge the dropped mechanics back into the steps.',
      source: SRC, updated_at: ts });
    upsert(db, 'decisions', { id: 'dec-material-po-authority', date: '2026-11-08',
      title: 'Who owns material purchase orders, and what can be spent without asking',
      reason: 'The 3 November procedure carried this as an open note: "Material PO procedure owner and backup to be confirmed; approval boundary for spending authority to be established." The 4 November rewrite removed the note without answering it. Under Maria’s split, Lonnie agrees the price and James raises the PO, but neither is recorded as owning the procedure, and no figure has been set above which someone has to ask. Jim sets spending limits elsewhere, so this is his to decide.',
      decided_by: 'Jim to decide', status: 'open', source: SRC, created_at: ts });
    addEvent(db, { entity_type: 'task', entity_id: 'sop-pur-02-material-po-entry', kind: 'setup', status: 'info',
      label: 'Recorded what the 4 November rewrites dropped from the two purchasing procedures, including an open spending-authority question that was removed rather than answered',
      source: 'manual', actor: 'brittany', external_id: 'purchasing-rewrite-losses-2026-11-08' });
  } },
  { key: 'purchasing-merged-2026-11-08', apply(db) {
    const ts = nowIso();
    const SRC = 'Merged from the 3 November steps and the 4 November rewrite, 2026-11-08';

    const WO = [
      'Read the source estimate or invoice and extract vendor, verified job and routing, reference number, date, scope, quantities, rates, total, work site, schedule and approval context. Check it against the current approved quote: selections, plans, takeoffs, counts and inclusions. A source document on its own is not spending approval.',
      'Apply routing first. HOA work requested and approved through Teresa goes to ROCVTA: keep ROCVTA as the database job and put the full physical work address prominently in the description. Do not substitute the bill-to address.',
      'In logged-in Chrome, check Work Order Tracking for the selected job before entry and before every retry. Use All and include voided records and related extras, so a duplicate cannot be created.',
      'Open Jobs, then the correctly routed job, then New Work Order in the BuildConnect frame.',
      'Set the payment-period count FIRST. Changing it reloads the form, so anything entered before it is lost.',
      'Apply the current vendor and scope rule:\n   · Johnston, membrane and built-up roofing, code 409. Separate priced scopes; leave the general square footage and rate blank; put the supplied area and rate in the scope row; preserve the package totals.\n   · All A/C work orders: 60/30/10, following the exact draw descriptions on WO 39974. Recalculate the amounts from each new contract total and reconcile the rounding. Pricing is equipment, register and system based, never per square foot. Enter the verified A/C area in the square-footage field AND in the saved description. The 2,626 A/C square feet applies to 11603 Royal Parkside only.\n   · H&H HOA fence maintenance: ROCVTA, Maintenance, code 940, one 100% draw for one priced scope. Other HOA trades need their coding verified first.\n   · Synergy roofing: 30/50/20 draws.\n   · Electrical Works change orders: code 620.\n   · Reece plumbing fixtures: code 601; split valves and trims when asked.',
      'Verify the line amounts after blur. Confirm the sum matches the contract total and the percentages come to 100.',
      'Use the authorized schedule. The invoice or estimate date is NOT automatically the start date. Put the proposal date in the applicable Invoice Date fields for proposal orders, and the actual invoice date for invoices. Start and completion are schedule dates with an agreed duration, separate from the invoice date. Leave the completion and payment flags unset on new work.',
      'Respect any requested review stop. Submit only within current authorization, using the passcode-box Enter step, and keep the passcode private. Do not sign for a vendor, and do not infer field acceptance, completion or payment approval.',
      'A blank or white screen after submitting is an uncertain result, not proof of failure, and may well mean it saved. Do not retry immediately.',
      'Reopen Work Order Tracking and the saved record. Verify the work-order ID, routed job, vendor, reference, rows, labelled area, dates and total.',
      'If verification is inconclusive, stop and report the uncertainty. Never create a duplicate.',
      'Calendar selections have sometimes failed to persist. If a date does not take, report the requested date against the saved one and preserve the existing record. Date persistence, edit permissions and the WO 40186 correction are all still open.',
      'Once the saved order is verified, file the original proposal, estimate or invoice in the existing Public, matching job, Purchasing, accepted-bid-work-order, vendor folder structure. Reuse the structure that is actually there, create only a missing vendor folder, preserve the original and verify the copy. H&H HOA source documents go in community Purchasing, ROCV H&H Fence.',
      'An urgent request for a ready work order was expected promptly, about ten minutes in discussion, but that was never agreed as a standing commitment. Confirm who is primary and backup, and the supplier deadline, rather than assuming.',
    ];

    const PO = [
      'Obtain the approved quote, proposal or invoice. Compare it against the approved selections, specification, plans and takeoff: vendor, job address, items, quantities, inclusions and pricing. Confirm the price, the actual tax, any deposit, delivery, the source date and reference, and the approval. Flag any discrepancy before going further.',
      'Verify the job address and match it to the correct BuildConnect job. Use the job and vendor that already exist rather than creating new ones.',
      'Check Purchase Order Tracking for duplicates before entry and before every retry, comparing reference, date, scope and amount.',
      'Select Jobs, then the correct job, then New Purchase Order.',
      'Select the vendor and the cost code for the material type: 601 for plumbing fixtures, 996 for Lowe’s and Home Depot.',
      'Set the payment rows. Split into separate draws when the scope calls for it, such as Reece valves against trims when that is requested. Use a single draw for a standalone quote. The water-heater single draw is one historical example, not the default for every quote.',
      'Enter the amounts. Separate merchandise from the actual tax where that applies, and check the form recalculates after blur.',
      'Enter the invoice or proposal number and the real date: the proposal date for proposal-based orders, the invoice date for invoices.',
      'Submit, then verify the saved purchase order in Tracking: PO number, job, vendor, reference, amounts, dates and the cost code.',
      'For a supplier-dispatched PO, email the authorized order to the verified contact on the proposal and keep both the dispatch and the supplier’s acknowledgment. Check who the current recipients are rather than copying Maria out of habit. A work-order portal notification does not establish that a PO was delivered.',
      'Mark Complete only when authorized. Complete is a separate thing from Received, Pay and Paid In Full. Lowe’s receipt status, Canon and the physical handoff follow their own procedure: do not apply the Lowe’s complete-for-payment rule to every material PO.',
      'File the unchanged source document and the PO PDF where applicable, in the existing Public, matching job, Purchasing, accepted-bid, vendor folder structure. Preserve the originals and verify the copy.',
      'Extra lumber ordered before 9 AM may catch the same-day truck. Verify the supplier cutoff and the early coverage, and never promise a truck without confirming it. Expedited entry for early lumber or material coverage is job-specific, not a standing commitment.',
      'STILL OPEN: nobody is recorded as owning this procedure or backing it up, and no figure has been set above which someone has to ask before spending. See the open decision for Jim.',
    ];

    const put = (id, steps, note) => upsert(db, 'tasks', { id,
      steps: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), documented: 1, verified: 0,
      missing_info: note, source: SRC, updated_at: ts,
      next_action: 'Walk it once with the person who owns it, then mark it verified.' });

    put('sop-pur-01-wo-entry-buildconnect', WO,
      'Merged 8 November: the mechanics the 4 November rewrite dropped are back (the navigation, why the payment-period count goes first, the passcode-box submit, leaving the completion and payment flags unset, "never create a duplicate", and the calendar-persistence workaround), with the caveats that rewrite added kept around them. The Synergy, Electrical Works and Reece rules are back in the procedure as well as in the vendor-rules panel. Not yet walked through with James.');
    put('sop-pur-02-material-po-entry', PO,
      'Merged 8 November: the mechanics the 4 November rewrite dropped are back (the navigation, cost code 996, the single-draw rule, separating merchandise from tax, checking the form recalculates, the proposal-versus-invoice date rule, verifying the cost code on the saved PO, and the Complete versus Received distinction), with the new caveats kept. The owner, backup and spending boundary are still unset and are called out as the last step rather than left implicit.');
    upsert(db, 'tasks', { id: 'sop-pur-02-material-po-entry',
      blocker: 'Nobody owns this procedure and no spending authority boundary has been set. Jim to decide.' });

    addEvent(db, { entity_type: 'task', entity_id: 'sop-pur-01-wo-entry-buildconnect', kind: 'setup', status: 'info',
      label: `Merged: work-order entry now ${WO.length} steps, material PO ${PO.length} — the 4 November caveats kept, the dropped mechanics restored`,
      source: 'manual', actor: 'brittany', external_id: 'purchasing-merged-2026-11-08' });
  } },
  { key: 'meeting-purchasing-2026-11-05', apply(db) {
    const ts = nowIso();
    const SRC = 'Meeting recording: Maria, Brittany and James reviewing purchasing responsibilities — 5 November 2026, 31m';
    const { docxText } = require('./imports');
    const fp = path.join(__dirname, '..', 'seed', 'meetings', 'purchasing-review-2026-11-05.docx');
    const text = docxText(fs.readFileSync(fp)).replace(/&apos;/g, '’');
    // Stored now so the transcript is not lost. The responsibility moves it decides are applied once all
    // three transcripts are in, so Ernesto's list is emptied in one pass rather than three.
    upsert(db, 'documents', { id: 'doc-meeting-purchasing-2026-11-05', title: 'Purchasing responsibilities reviewed line by line — 5 November 2026',
      kind: 'meeting', kind_reason: 'Teams recording; Maria answering every remaining purchasing line', sensitive: 0,
      meeting_date: '2026-11-05', cite_key: 'M 11/05', attendees: JSON.stringify(['maria', 'brittany', 'james']),
      summary: 'Went through Ernesto’s remaining job items and the purchasing lines under James. Every line was answered: to James (back charges, signing up subcontractors and vendors, the purchasing mailbox, entering work orders, POs and approved budgets), to Lonnie (permitting, bids out and in, estimating, budgets, CBUSA, lead times, invoice receiving, material waste), or struck off (permit rack, obtaining plans, detailed scopes, supplementing takeoffs, licence checks, the vendor feedback system, the slot schedule). Nothing remained with Ernesto. Also: lumber is the only genuinely time-critical PO and must be entered before the morning truck window; store purchases need no approval while bids go to Lonnie first; the Landing is one work order to Frank Martin Development with seven draws, not per-trade orders.',
      content: text, size: text.length, source: SRC, imported_at: ts,
      file_path: fp, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', underlying_status: 'extracted' });
    addEvent(db, { entity_type: 'document', entity_id: 'doc-meeting-purchasing-2026-11-05', kind: 'import', status: 'info',
      label: 'Purchasing review transcript stored (5 November). Responsibility moves held until all three transcripts are in.',
      source: 'import', actor: 'brittany', external_id: 'meeting-purchasing-2026-11-05' });
  } },
  { key: 'meeting-allofficE-2026-11-06', apply(db) {
    const ts = nowIso();
    const SRC = 'Meeting recording: all-office document walkthrough on Maria’s last day — 6 November 2026, 39m';
    const CITE = '[ALL 11/06]';
    const { docxText } = require('./imports');
    const fp = path.join(__dirname, '..', 'seed', 'meetings', 'all-office-handover-2026-11-06.docx');
    const text = docxText(fs.readFileSync(fp)).replace(/&apos;/g, '’');
    upsert(db, 'documents', { id: 'doc-meeting-alloffice-2026-11-06', title: 'All-office document walkthrough, Maria’s last day — 6 November 2026',
      kind: 'meeting', kind_reason: 'Teams recording; Maria walking the office through every document she wrote', sensitive: 0,
      meeting_date: '2026-11-06', cite_key: 'ALL 11/06', attendees: JSON.stringify(['maria', 'brittany', 'james', 'teresa', 'kenneth', 'lonnie']),
      summary: 'Maria walked everyone through the documents she created: how to build a house, the SOW pricing workbook, Leander master approvals, signing up subcontractors and vendors, Lowe’s and card purchases, insurance certificates, the permit set, and entering budgets and increases. Every login sits inside its document. New facts: check the GL spreadsheet every other week (yellow means within 30 days); a budget increase now needs two approvals, Director of Operations and Jim, with no notification so the approver must be emailed; the purchasing mailbox goes to both James and Brittany; and Maria put the whole purchasing load at about an hour and a half a week. NOTE the speaker labels in this transcript are wrong — almost everything attributed to James is Maria.',
      content: text, size: text.length, source: SRC, imported_at: ts,
      file_path: fp, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', underlying_status: 'extracted' });

    // The portal identity problem, which is the same shape as the utility logins and now urgent.
    { const h = db.prepare('SELECT * FROM handover_items WHERE id = ?').get('ho-portal-logins');
      if (h) upsert(db, 'handover_items', { id: 'ho-portal-logins', risk: 'high', status: 'open',
        item: 'Logins and account identity for the city permit portal, the utility builder sites and the City of Houston payment system',
        why: (h.why || '') + ' Confirmed again on 6 November: every City of Houston portal account is registered to M. Abney and Maria said she does not know how to change the email inside the portal ' + CITE + '. She has now left, so permit applications, water capacity requests and shopping-cart payments all still run through a departed employee’s identity.',
        capture: 'Call the City of Houston and ask what is needed to transfer the contractor account to a current employee. Do the same for Reliant and the CenterPoint builder portal. This is the single most urgent item left.',
        doc_ids: [...new Set([...JSON.parse(h.doc_ids || '[]'), 'doc-meeting-alloffice-2026-11-06'])], updated_at: ts }); }

    // GL insurance: Maria's manual cadence, which the Insurance view now does automatically.
    { const t = db.prepare('SELECT steps FROM tasks WHERE id = ?').get('sop-update-gl-insurance');
      if (t) upsert(db, 'tasks', { id: 'sop-update-gl-insurance',
        trigger: 'Either the world raises it at 60, 30 or zero days, or the fortnightly check Maria described: open the GL spreadsheet every other week and chase anything showing yellow, which means within 30 days of expiry ' + CITE + '. Send one email covering everyone who is yellow.',
        evidence: 'Register row saved and re-read, certificate filed with the superseded one archived, BuildConnect date re-opened and confirmed, and a copy to Kenneth for QuickBooks. The point of the whole thing: do not pay a subcontractor who is not currently insured. MCH carries builder’s risk only, which covers the house and not the people working on it.',
        updated_at: ts }); }

    // Things the meeting left for someone to do.
    const T = (id, o) => upsert(db, 'tasks', { id, department_id: o.dept, owner_id: o.owner, backup_id: o.backup || null,
      title: o.title, trigger: o.trigger, steps: null, documented: 0, automated: 0, verified: 0, board: o.board || 'next',
      proposed: 0, missing_info: o.missing || null, next_action: o.next, source: SRC + ' ' + CITE, updated_at: ts });
    T('a1106-hub-access', { dept: 'executive', owner: 'brittany', backup: 'james', board: 'working',
      title: 'Give everyone access to the operations hub and introduce it', 
      trigger: 'Raised on 6 November: the hub exists but nobody has access and nobody has been shown it. "It needs to be accessible and everybody needs to be aware of it" — by Monday.',
      next: 'Put it somewhere everyone can open, then walk the office through it the way Maria walked them through her documents.' });
    T('a1106-wo-po-recording', { dept: 'purchasing', owner: 'brittany', backup: 'james', board: 'working',
      title: 'Record how to create a work order and a purchase order, for Lonnie',
      trigger: 'The one document Maria did not write. The old video could not be found.',
      missing: 'Brittany has the transcript of the earlier walkthrough and knows the process.',
      next: 'Record it and file it with Maria’s other documents.' });
    T('a1106-shopping-cart-warning', { dept: 'accounting', owner: 'lonnie', backup: 'teresa',
      title: 'Bold the "verify with accounting before paying" line in the shopping-cart document',
      trigger: 'Teresa raised it and Maria agreed: nobody pays the city without accounting confirming first. Maria’s words were "do not press go."',
      next: 'Find the line in the document and make it impossible to miss.' });
    T('a1106-doc-numbering', { dept: 'executive', owner: 'lonnie', backup: 'brittany',
      title: 'Number Maria’s documents in the order you would actually use them',
      trigger: 'Teresa asked for step 1, step 2 and so on in the filenames; the folder is alphabetical, which is not the order anything happens in. Maria agreed, at least for permitting.',
      next: 'Rename the permit documents first, since that is the set with a real sequence.' });
    T('a1106-qb-template-phone', { dept: 'accounting', owner: 'brittany', backup: 'kenneth',
      title: 'Fix the office number on the QuickBooks water-billing template',
      trigger: 'Homeowners are still calling and emailing Maria and James about water bills because the template carries the main office number.',
      next: 'Update the template to the ROCVTA and ROL accounting contacts.' });
    T('a1106-database-training', { dept: 'executive', owner: 'brittany', backup: 'lonnie',
      title: 'Database training — nothing exists for it',
      trigger: 'Acknowledged in the meeting as a separate gap that none of Maria’s documents cover.',
      missing: 'Maria’s documents cover individual procedures but assume you can already drive the database.',
      next: 'Decide whether this is a document, a recording, or time with Ernesto and Lonnie.' });

    upsert(db, 'decisions', { id: 'dec-budget-increase-approvals', date: '2026-11-06',
      title: 'A budget increase needs two approvals; a standard budget needs one',
      reason: 'Stated on 6 November ' + CITE + '. A standard budget goes to the Director of Operations alone. An increase needs the Director of Operations and Jim, because Teresa now holds that role. The database sends no notification either way, so whoever submits has to email Teresa and Kenneth and tell them it is waiting.',
      decided_by: 'Maria, confirming current practice', status: 'accepted', source: SRC, created_at: ts });

    addEvent(db, { entity_type: 'document', entity_id: 'doc-meeting-alloffice-2026-11-06', kind: 'import', status: 'info',
      label: 'All-office handover stored (6 November, Maria’s last day): eight document sets inventoried, six follow-ups raised, portal identity flagged as the most urgent gap',
      source: 'import', actor: 'brittany', external_id: 'meeting-alloffice-2026-11-06' });
  } },
  { key: 'responsibility-handover-2026-11-08', apply(db) {
    const ts = nowIso();
    const SRC = 'Three handover transcripts: purchasing review 5 Nov, all-office walkthrough 6 Nov, final line-by-line review 6 Nov';
    const CITE = '[FINAL 11/06]';
    const { docxText, parseOpsHub } = require('./imports');

    const fp = path.join(__dirname, '..', 'seed', 'meetings', 'maria-final-review-2026-11-06.docx');
    const text = docxText(fs.readFileSync(fp)).replace(/&apos;/g, '’');
    upsert(db, 'documents', { id: 'doc-meeting-maria-final-2026-11-06', title: 'Maria’s final review — every item on her list, assigned or removed (6 November)',
      kind: 'meeting', kind_reason: 'Teams recording; Maria going line by line through her own 85 responsibilities', sensitive: 0,
      meeting_date: '2026-11-06', cite_key: 'FINAL 11/06', attendees: JSON.stringify(['maria', 'brittany', 'james']),
      summary: 'Maria went through all 85 of her listed responsibilities and said, for each one, who takes it or whether it goes. Her closing verdict: "a combination of this and the Ernesto one are like 100% overkill, because these were made for Royal Oaks and 30 homes at a time. Everything that needs to be assigned has been assigned, and everything that needs to be gone has been deleted."',
      content: text, size: text.length, source: SRC, imported_at: ts,
      file_path: fp, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', underlying_status: 'extracted' });

    const hub = parseOpsHub(fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub-2026-11-04.html'), 'utf8'));
    const clean = s => String(s).replace(/^Historical \/ transition reference:\s*/, '').replace(/^\[N\/A\]\s*/, '').trim();
    const MARIA = (hub.team.find(t => t.id === 'maria').responsibilities || []).map(clean);
    const ERN = (hub.team.find(t => t.id === 'purchasing' || t.id === 'ernesto').responsibilities || []).map(clean);

    // Maria's 85, as she assigned them. null means she said it goes.
    const L = 'lonnie', J = 'james', T = 'teresa', M = 'jim', K = 'kenneth';
    const MARIA_TO = { 1: L, 2: L, 3: L, 4: L, 5: L, 6: L, 7: L, 8: L, 9: L, 10: L, 11: L, 12: L, 13: L,
      14: J, 15: J, 16: L, 17: L, 18: L, 19: null, 20: null, 21: M, 22: L, 23: L, 24: null, 25: L, 26: null,
      27: L, 28: T, 29: null, 30: L, 31: L, 32: null, 33: L, 34: [L, M], 35: L, 36: M, 37: L, 38: null,
      39: [L, M], 40: L, 41: [L, J], 42: L, 43: L, 44: L, 45: L, 46: L, 47: L, 48: L, 49: L, 50: [L, M],
      51: J, 52: L, 53: J, 54: L, 55: L, 56: [L, K], 57: L, 58: [M, K], 59: [L, J], 60: L, 61: L, 62: L,
      63: null, 64: T, 65: J, 66: null, 67: L, 68: null, 69: null, 70: null, 71: null, 72: null, 73: null,
      74: null, 75: null, 76: null, 77: null, 78: null, 79: M, 80: M, 81: null, 82: null, 83: null, 84: null, 85: K };
    // Ernesto's 25, from the 5 November review. Nothing stays with him.
    const ERN_TO = { 1: null, 2: null, 3: L, 4: null, 5: L, 6: null, 7: L, 8: L, 9: L, 10: L, 11: J, 12: J,
      13: null, 14: null, 15: L, 16: J, 17: J, 18: L, 19: [L, K], 20: null, 21: L, 22: L, 23: L, 24: L, 25: L };

    // Two lines Maria corrected as she went, so they do not read as nonsense under a new owner.
    const REWORD = {
      'Creates the spec writer (including interior selections)': 'Specifications including interior selections — there is no SpecWriter any more',
      'Prepares proforma and forwards to Kenneth': 'Prepares the proformas for the banks',
    };
    const add = {}; const dropped = [];
    const push = (who, textLine, from) => { (add[who] = add[who] || []).push(textLine + (from ? ` (${from})` : '')); };
    for (const [list, map, from] of [[MARIA, MARIA_TO, 'from Maria'], [ERN, ERN_TO, 'from the purchasing list']]) {
      list.forEach((line, i) => {
        const to = map[i + 1];
        if (!to) { dropped.push(line); return; }
        const whos = Array.isArray(to) ? to : [to];
        const body = REWORD[line.replace(/^\(Purchasing\)\s*/, '')] || line;
        for (const w of whos) push(w, body, whos.length > 1 ? from + ', with ' + whos.filter(x => x !== w).join(' and ') : from);
      });
    }

    const merge = (pid, extra) => {
      const p = db.prepare('SELECT responsibilities FROM people WHERE id = ?').get(pid); if (!p) return;
      const now = JSON.parse(p.responsibilities || '[]');
      const seen = new Set(now.map(x => String(x).toLowerCase().slice(0, 60)));
      for (const line of extra || []) if (!seen.has(line.toLowerCase().slice(0, 60))) { now.push(line); seen.add(line.toLowerCase().slice(0, 60)); }
      upsert(db, 'people', { id: pid, responsibilities: now, updated_at: ts });
    };
    for (const pid of [L, J, T, M, K]) merge(pid, add[pid]);

    // Nothing is left with either of them.
    upsert(db, 'people', { id: 'ernesto', responsibilities: [], crossed_off: ERN.filter((_, i) => !ERN_TO[i + 1]),
      notes: 'Purchasing list emptied 8 November. Every one of the 25 items was reviewed with Maria on 5 November and went to Lonnie, to James, or off the list entirely ' + CITE + '. Nothing remains assigned here.',
      updated_at: ts });
    upsert(db, 'people', { id: 'maria', responsibilities: [], crossed_off: MARIA.filter((_, i) => !MARIA_TO[i + 1]),
      notes: 'DEPARTED 6 November 2026. All 85 listed responsibilities were reviewed with her on her last day and either reassigned or removed ' + CITE + '. Her verdict on both lists: "100% overkill, because these were made for Royal Oaks and 30 homes at a time." Open projects were transferred to Lonnie. She left a personal number with the office.',
      updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-responsibilities-reassigned', date: '2026-11-08',
      title: 'Maria’s and the purchasing list are fully reassigned; nothing is left with either',
      reason: `Across three recorded sessions Maria went through all 85 of her own items and all 25 purchasing items and named an owner or struck each one off. Of the 110, ${dropped.length} were removed as no longer done, and the rest went to Lonnie (the construction and judgement work), James (entry and administration), Teresa, Jim or Kenneth. The removals are not deletions of history: each is kept against the person who used to hold it. Maria’s own view was that both lists were written for Royal Oaks at thirty homes at a time and are heavier than the current operation needs.`,
      decided_by: 'Maria, with Brittany and James', status: 'accepted', source: SRC, created_at: ts });

    addEvent(db, { entity_type: 'person', entity_id: 'ernesto', kind: 'setup', status: 'info',
      label: `Responsibilities reassigned: ${(add[L] || []).length} to Lonnie, ${(add[J] || []).length} to James, ${(add[T] || []).length} to Teresa, ${(add[M] || []).length} to Jim, ${(add[K] || []).length} to Kenneth, ${dropped.length} removed. Maria and the purchasing list are both empty.`,
      source: 'manual', actor: 'brittany', external_id: 'responsibility-handover-2026-11-08' });
  } },
  { key: 'sop-decisions-from-transcripts-2026-11-08', apply(db) {
    const ts = nowIso();
    const SRC = 'The three handover transcripts, 5 and 6 November 2026';

    // Maria described the back-charge process in full, so this one is rewritten rather than put to a vote.
    upsert(db, 'tasks', { id: 'hub-back_charge', owner_id: 'james', backup_id: 'lonnie', documented: 1, verified: 0,
      title: 'Back charge a subcontractor',
      trigger: 'A subcontractor broke something, left a mess they were asked to clear and did not, or failed to finish work somebody else then had to finish. It is judged case by case — cutting sheetrock to reach a pipe is not a back charge.',
      steps: '1. Whoever runs the job decides there is a back charge, because they know what actually happened and why.\n2. Tell the vendor first. "There is nothing worse than a vendor receiving a cheque that says minus $400 and they have zero idea why." Give them a chance to put it right: tell them if it is not cleaned within three days you will get someone else and charge it back.\n3. Create a new back charge in the database. It works like a work order — fill in all the information.\n4. Fill in who was notified and the date they were notified. The field exists and it is the most important part of the record.\n5. Click approved as soon as it is entered, so it lands on the back-charge report Kenneth checks before cutting cheques.',
      approval_rules: 'The builder decides it, James enters it, and it must be approved in the database before cheques run. The vendor is told before any money is withheld.',
      missing_info: 'Maria said she would add back-charge instructions to the same document as the budget workflow. Check whether that was done before she left.',
      next_action: 'Find the written version in the workflow folder; if it is not there, this is the record.',
      review_note: 'Rewritten 8 November from Maria’s own description [M 11/05]. The 2004 version is superseded. Volume is about $2,000 to $3,000 a year, so it is rare.',
      source: 'Maria, purchasing review 5 November 2026', updated_at: ts });

    // The rest contradict what the transcripts say, so they go to Brittany as decisions rather than being
    // rewritten on my judgement. This is what the world is for.
    const D = (id, title, reason) => upsert(db, 'decisions', { id, date: '2026-11-08', title, reason,
      decided_by: 'Brittany to approve', status: 'proposed', source: SRC, created_at: ts });
    D('dec-sop-change-order-log', 'Change Order Budget Entry (2022) refers to a log that does not exist',
      'The SOP has steps for logging change orders into a change order budget log and printing it weekly for the tactical meeting. Maria on 6 November: "68 is gone. We don’t do that. There’s no change order log." Proposal: cut the logging and printing steps, keep the pricing and approval steps, and record that change orders are priced, approved by the customer and paid for before the work is executed.');
    D('dec-sop-weekly-budget-review', 'Weekly Budget Review (2005) describes something nobody does',
      'The SOP has the budget reviewed weekly while processing accounts payable. Maria on item 26: "we haven’t done that." She also said budget against actual is really Lonnie and Kenneth but "none of these are being done on a regular basis on every single job." Proposal: either retire the SOP, or keep it and name who does it and how often. Do not leave it describing a routine that does not happen.');
    D('dec-sop-bonus-request', 'Bonus Request Submittal (2005) — nobody has run it in years',
      'Maria on items 79 and 80: "we haven’t done bonuses in so long and I don’t know how long he was set up, to be completely honest. Those are a question for Jim." Proposal: ask Jim whether the bonus scheme still exists. If it does, it needs an owner; if not, retire the SOP rather than leave it looking live.');
    D('dec-sop-framed-mirrors', 'Framed Mirror Purchase Process (2004) — Maria said to drop it',
      'Her words on item 83: "I really don’t know why we have a framed mirror purchasing process. That can go away. That’s dumb." The two responsibilities behind it are already struck off. Proposal: retire the SOP. Mirrors are measured and installed as part of ordinary trade coordination.');
    D('dec-sop-budget-revision-log', 'Budget Revision Update Process (2005) — the revision log was struck off',
      'Items 72, 73 and 74 covered logging the overage, printing the log weekly and forwarding it to Kenneth. All three were struck off on 6 November. The SOP still describes them. Proposal: replace the log with what actually happens now — a budget increase is requested in the database and needs two approvals, the Director of Operations and Jim, with the approver emailed because the database notifies nobody.');
    D('dec-sop-start-packet', 'Start Packet Process — nobody assembles one any more',
      'Maria on item 38: "nobody puts together a construction start package anymore. Everything is digital, so that one can go away." The Start Packet Process SOP is 47 steps. Proposal: check what in it is still done digitally and keep only that, or retire it and point at the job files in Public.');

    addEvent(db, { entity_type: 'task', entity_id: 'hub-back_charge', kind: 'setup', status: 'info',
      label: 'Back charge rewritten from Maria’s description; six more 2004-2022 SOPs raised as decisions because the transcripts contradict them',
      source: 'manual', actor: 'brittany', external_id: 'sop-decisions-2026-11-08' });
  } },
  { key: 'sop-outcomes-2026-11-09', apply(db) {
    const ts = nowIso();
    const SRC = 'Brittany, 2026-11-09';

    // Gone for good. Not done at all any more.
    upsert(db, 'tasks', { id: 'hub-framed_mirror_purchase', lifecycle: 'retired', content_locked: 1, archived: 1, board: 'done',
      review_note: 'Retired 9 November: "framed mirrors can be completely removed, we don’t do that anymore at all" [Brittany 11/09]. Maria had already called it dumb on her last day. Kept here so the history is visible; it is out of the published hub.',
      next_action: null, updated_at: ts });
    upsert(db, 'decisions', { id: 'dec-sop-framed-mirrors', status: 'accepted', decided_by: 'Brittany',
      reason: 'Retired. McVaugh does not do this at all any more, so there is nothing to correct and nothing to keep. [Brittany 11/09]' });

    // The log is gone, but change orders are still tracked — by a different mechanism, which is the useful part.
    upsert(db, 'tasks', { id: 'hub-change_order_budget', lifecycle: 'current', content_locked: 1, owner_id: 'james', backup_id: 'lonnie',
      title: 'Change order costs on a job',
      trigger: 'A change order has been approved by the buyer and the extra cost has to land against the job.',
      steps: '1. The change order is approved by the buyer.\n2. The extra cost goes on the job as a work order or purchase order against the extra cost code for that trade — the .2 and .3 extensions, so the base code stays the original scope and the change sits beside it.\n3. That is the tracking. There is no change order log, no weekly print and nothing forwarded for a tactical meeting.',
      missing_info: 'Worth writing down once: which extension is used when (.2 for the first change on a trade, .3 for the second, and so on), and whether anything beyond .3 has ever been needed.',
      review_note: 'Rewritten 9 November [Brittany 11/09]. The 2022 version had the change order logged into a change order budget log, printed weekly, reviewed by the President, forwarded to the CFO and entered in two systems. Maria: "there’s no change order log." Brittany: change orders are tracked by adding a work order or purchase order at the .2 and .3 extra cost codes.',
      next_action: 'Confirm the extension convention with James, then mark it verified.',
      documented: 1, verified: 0, source: SRC, updated_at: ts });
    upsert(db, 'decisions', { id: 'dec-sop-change-order-log', status: 'accepted', decided_by: 'Brittany',
      reason: 'The log is removed. Change orders are tracked by adding a work order or purchase order against the extra cost codes, the .2 and .3 extensions, so the cost sits on the job beside the original scope. [Brittany 11/09]' });

    // Somebody should, nobody does. Not retired, not current — and saying so is the point.
    const STALE = [
      ['hub-budget_review', 'Weekly Budget Review', 'Maria: "we haven’t done that." Budget against actual is really Lonnie and Kenneth, but "none of these are being done on a regular basis on every single job."'],
      ['hub-bonus_request', 'Bonus Request Submittal', 'Maria: "we haven’t done bonuses in so long and I don’t know how long he was set up, to be completely honest. Those are a question for Jim."'],
      ['hub-budget_revision', 'Budget Revision Update', 'The overage log, the weekly print and forwarding it to Kenneth were all struck off on 6 November. What happens now is a budget increase request in the database needing two approvals, the Director of Operations and Jim, with the approver emailed because nothing notifies them.'],
      ['hub-start_packet', 'Start Packet Process', 'Maria: "nobody puts together a construction start package anymore. Everything is digital."'],
    ];
    for (const [id, name, why] of STALE) {
      const t = db.prepare('SELECT review_note FROM tasks WHERE id = ?').get(id); if (!t) continue;
      upsert(db, 'tasks', { id, lifecycle: 'stale', content_locked: 1, verified: 0, board: 'next',
        missing_info: `STALE: somebody should be doing this and nobody is. ${why} It is not retired — the need is real — but the written procedure describes a routine that is not happening, so following it would not reflect the company. [Brittany 11/09]`,
        next_action: 'Correct the process first, then rewrite the procedure to match. Until then do not treat this as current.',
        review_note: [t.review_note, 'Marked stale 9 November: "something someone should do but doesn’t. Those are stale until we get processes corrected." [Brittany 11/09]'].filter(Boolean).join('\n'),
        updated_at: ts });
    }
    for (const id of ['dec-sop-weekly-budget-review', 'dec-sop-bonus-request', 'dec-sop-budget-revision-log', 'dec-sop-start-packet'])
      upsert(db, 'decisions', { id, status: 'accepted', decided_by: 'Brittany',
        reason: 'Marked stale rather than retired: somebody should be doing this and nobody is. The procedure stays on the books as a known gap until the process itself is corrected, and is not to be treated as current in the meantime. [Brittany 11/09]' });

    // How change orders are really costed now, where a work order gets raised.
    upsert(db, 'wo_specifics', { id: 'ws-change-order-cost-codes', vendor_name: 'ALL — change orders',
      detail: 'A change order is costed by raising a work order or purchase order against the extra cost code for that trade, using the .2 and .3 extensions. The base code keeps the original scope and the change sits beside it. There is no separate change order log.',
      scope: 'vendor', task_id: 'tr-wo-entry-from-bid', source: SRC, noted_on: '2026-11-09', updated_at: ts });

    addEvent(db, { entity_type: 'task', entity_id: 'hub-change_order_budget', kind: 'setup', status: 'info',
      label: 'Framed mirrors retired; change order log replaced by .2/.3 extra cost codes; four procedures marked stale pending process correction',
      source: 'manual', actor: 'brittany', external_id: 'sop-outcomes-2026-11-09' });
  } },

  // The two retired procedures still had live responsibilities hanging off other people. Retiring the SOP
  // does not retire the work unless the work comes off the person, so strike them where they sit.
  { key: 'retired-sop-strays-2026-11-09', apply(db) {
    const ts = nowIso();
    const STRAYS = [
      ['jim', /change order log/i, 'The change order log is gone. Change orders are tracked by raising a work order or purchase order against the .2 / .3 extra cost codes. [Brittany 11/09]'],
      ['kenneth', /change order log/i, 'The change order log is gone. Change orders are tracked by raising a work order or purchase order against the .2 / .3 extra cost codes. [Brittany 11/09]'],
      ['pam', /framed mirror/i, 'McVaugh does not do framed mirrors at all any more. [Brittany 11/09]'],
    ];
    const struck = [];
    for (const [pid, rx, why] of STRAYS) {
      const p = db.prepare('SELECT * FROM people WHERE id = ?').get(pid); if (!p) continue;
      const live = JSON.parse(p.responsibilities || '[]');
      const off = JSON.parse(p.crossed_off || '[]');
      const keep = live.filter(r => !rx.test(String(r)));
      const drop = live.filter(r => rx.test(String(r)));
      if (!drop.length) continue;
      upsert(db, 'people', { id: pid, responsibilities: keep,
        crossed_off: [...off, ...drop.filter(d => !off.includes(d))],
        notes: [p.notes, `${drop.length} responsibilit${drop.length === 1 ? 'y' : 'ies'} struck off 9 November: ${why}`].filter(Boolean).join('\n'),
        updated_at: ts });
      struck.push(`${pid}: ${drop.join('; ')}`);
    }
    addEvent(db, { entity_type: 'person', entity_id: 'jim', kind: 'setup', status: 'info',
      label: struck.length ? `Struck off work belonging to retired procedures — ${struck.join(' | ')}` : 'No stray responsibilities left from the retired procedures',
      source: 'manual', actor: 'brittany', external_id: 'retired-sop-strays-2026-11-09' });
  } },

  // Kenneth was listed as receiving the proforma from Maria. He is the one who makes it.
  { key: 'kenneth-proforma-2026-11-09', apply(db) {
    const ts = nowIso();
    const k = db.prepare('SELECT * FROM people WHERE id = ?').get('kenneth');
    if (k) {
      const live = JSON.parse(k.responsibilities || '[]');
      const off = JSON.parse(k.crossed_off || '[]');
      const drop = live.filter(r => /receives\s+pro\s?forma/i.test(String(r)));
      if (drop.length) upsert(db, 'people', { id: 'kenneth',
        responsibilities: live.filter(r => !/receives\s+pro\s?forma/i.test(String(r))),
        crossed_off: [...off, ...drop.filter(d => !off.includes(d))],
        notes: [k.notes, 'Struck off 9 November: he does not receive the proforma from Maria — he is the one who creates it. What stays is preparing the proformas for the banks. [Brittany 11/09]'].filter(Boolean).join('\n'),
        updated_at: ts });
    }

    // The 2004 SOP has it the other way round. Say so on the step rather than quietly rewriting a legacy SOP.
    const pre = db.prepare('SELECT missing_info, review_note FROM tasks WHERE id = ?').get('hub-preconstruction_planning');
    if (pre) upsert(db, 'tasks', { id: 'hub-preconstruction_planning', verified: 0,
      missing_info: [pre.missing_info, 'Step 38 ("DOC prepares proforma and forwards to CFO") is backwards for how it works today: Kenneth creates the proformas. [Brittany 11/09] Who feeds him the numbers, and at what point, still needs writing down before the step is rewritten.'].filter(Boolean).join(' '),
      review_note: [pre.review_note, 'Flagged 9 November: the proforma direction in step 38 is contradicted by current practice.'].filter(Boolean).join('\n'),
      updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-sop-proforma-direction', date: '2026-11-09',
      title: 'Rewrite the preconstruction step that has Maria preparing the proforma for Kenneth',
      reason: 'Brittany: Kenneth creates the proformas, so "receives proforma from Maria" came off his list. Step 38 of the 2004 preconstruction SOP still says the Director of Construction prepares it and forwards it to the CFO. Rewriting it needs one more answer: what Kenneth needs from the job before he can build the proforma, and who gives it to him now that Maria has gone. [Brittany 11/09]',
      status: 'open', decided_by: null, source: 'Brittany, 2026-11-09' });

    addEvent(db, { entity_type: 'person', entity_id: 'kenneth', kind: 'setup', status: 'info',
      label: 'Struck off "Receives proforma from Maria" — Kenneth creates the proformas; the 2004 SOP step that says otherwise is flagged',
      source: 'manual', actor: 'brittany', external_id: 'kenneth-proforma-2026-11-09' });
  } },

  // Brittany wants the proforma on her own review list, not parked as waiting on somebody else, and
  // reviewed across the SOPs rather than as one bad step. Nothing in the three handover transcripts
  // covers it — the final Maria meeting of 6 November does not mention a proforma at all — so what
  // she passed to Kenneth to build it was never written down anywhere.
  { key: 'proforma-review-2026-11-09', apply(db) {
    const ts = nowIso();
    upsert(db, 'decisions', { id: 'dec-sop-proforma-direction', date: '2026-11-09',
      title: 'Proforma: review it across the SOPs — what does Kenneth need, and who gives it to him now',
      reason: 'Kenneth creates the proformas, so "Receives proforma from Maria" came off his list [Brittany 11/09]. What is left open is the input: Brittany believes some of what Kenneth needs to build a proforma came from Maria, but not what. It is not in any transcript — the final Maria review of 6 November never mentions a proforma — and it is not on her struck-off list either, so it was never written down. The 2004 preconstruction SOP has it backwards at step 38 ("DOC prepares proforma and forwards to CFO"), and that is the only SOP that mentions a proforma at all, which is its own problem: a document the banks need appears once, in the wrong direction, in a twenty-year-old procedure. Review needed across the SOPs, not just that step: what inputs Kenneth needs, at what point in the job, who produces each one now, and where the procedure for it lives.',
      status: 'proposed', decided_by: null, source: 'Brittany, 2026-11-09' });

    const pre = db.prepare('SELECT missing_info FROM tasks WHERE id = ?').get('hub-preconstruction_planning');
    if (pre && !/only SOP that mentions/.test(pre.missing_info || ''))
      upsert(db, 'tasks', { id: 'hub-preconstruction_planning',
        missing_info: [pre.missing_info, 'This is also the only SOP that mentions a proforma anywhere, so there is no written procedure for producing one.'].filter(Boolean).join(' '),
        updated_at: ts });

    addEvent(db, { entity_type: 'task', entity_id: 'hub-preconstruction_planning', kind: 'setup', status: 'info',
      label: 'Proforma raised for Brittany to review across the SOPs: what Kenneth needs to build one, and who supplies it now Maria has gone',
      source: 'manual', actor: 'brittany', external_id: 'proforma-review-2026-11-09' });
  } },

  // The hub still published the 2006 New Work Order steps — red-lined plans to a Construction Assistant,
  // a bid list from the PM, a start package — although every one of those steps was gone through in the
  // meetings and found to be wrong. The step-by-step review was sitting in the world and never reached
  // the page. Publish what the meetings established, and keep the two steps nobody confirmed out of it.
  { key: 'new-work-order-rewrite-2026-11-09', apply(db) {
    const ts = nowIso();
    const SRC = 'Rewritten from the Maria and Jim meetings, 2026-11-09';
    upsert(db, 'tasks', { id: 'hub-new_work_order', title: 'New work order: pricing a trade and raising the order',
      owner_id: 'lonnie', backup_id: 'james', proposed: 0, documented: 1, verified: 0,
      content_locked: 1, department_id: 'purchasing',
      trigger: 'A lot and plan are known and a trade has to be priced and put on the job.',
      steps: [
        '1. The plan is known as soon as the lot is assigned — the villas build from approved master plans (3, 3A, 4, 4A). Nobody receives red-lined plans, and the Construction Assistant post no longer exists as a job — that work is Lonnie\'s. [M 15:13–16:30] [Brittany 11/09]',
        '2. Who to send to is vendor knowledge, not a document. What exists is the list Maria left of people to send bids to; it has no owner yet and no current rates against it. [M 18:59]',
        '3. Square-foot trades are not bid: framing, concrete, stucco, sheetrock, paint and trim are priced at the agreed $/sq ft × that trade\'s square footage. The square footage differs by trade — framer is the total including garage and patios, sheetrock excludes balconies, trim is the A/C area. [M 12:41–13:36, 57:54–59:32]',
        '4. Electrical, plumbing and mechanical do go out to bid, but come back consistent per plan. Interior finishes cannot be priced at all until selections are done. [M 12:41–13:36]',
        '5. Send bids close to the start. Bid too early and the price rises before slab. [M 16:30–17:35]',
        '6. What each trade needs in order to bid is listed on the SOW spreadsheet, under "necessary documents to provide". Where each of those documents comes from was asked of Maria and never answered. [M 13:36–14:18]',
        '7. Lonnie reviews the price and agrees it. [M-chat 11/04]',
        '8. James then raises the work order in the database. A work order is labor only and paperless. [M-chat 11/04] [M 36:37–39:20]',
        '9. A per-square-foot work order is built from square footage × rate, split over that trade\'s draw schedule. [M 57:54–59:32]',
        '10. Entering it is what emails the subcontractor. The subcontractor accepting it in the portal is the agreed price — there is no signed document. [M 36:37–39:20] [M-chat 10/24]',
        '11. There is no handoff to a start package: no Construction Assistant exists and start packet distribution was struck off. [HUB 10/20]',
      ].join('\n'),
      missing_info: 'Two steps of the 2006 procedure were dropped because nobody confirmed them in any meeting: the Construction Assistant advising Purchasing of the address, date and subcontractor, and calling subcontractors if a bid has not arrived within a week. The hub of 20 October put that second one on James, unconfirmed — decide whether chasing a late bid is anybody\'s job. Still open: who owns the vendor list and its current $/sq ft rates, the square footage per plan per trade, and where each bidding document comes from.',
      next_action: 'Walk steps 7 to 10 with Lonnie and James together — that is the join between pricing and entry, and it is the part that changed hands.',
      review_note: 'Rewritten 9 November [Brittany 11/09]: "the new work order process is not correct in the hub, and this was discussed so many times in previous transcripts." It was. The step-by-step review against the meetings was already stored here — five of the seven 2006 steps marked changed or no longer done — but the hub went on publishing the 2006 text. This is that review turned into the procedure. The detailed database mechanics live in SOP-PUR-01; this is the process around it.',
      source: SRC, updated_at: ts });

    // Nothing is supposed to point at the purchasing list any more. The responsibilities were cleared on
    // 8 November, but seven procedures still named Ernesto as owner or backup.
    const REHOME = [
      ['hub-new_work_order', null, null],
      ['hub-work_order_ap', 'jim', 'lonnie'],
      ['hub-start_packet', 'lonnie', 'james'],
      ['tr-bid-requests', null, 'james'],
      ['sop-pur-01-wo-entry-buildconnect', null, 'lonnie'],
      ['sop-pur-02-material-po-entry', null, 'lonnie'],
      ['obs-procedures-for-the-mch-database', null, 'james'],
    ];
    const rehomed = [];
    for (const [id, owner, backup] of REHOME) {
      const t = db.prepare('SELECT id, owner_id, backup_id FROM tasks WHERE id = ?').get(id); if (!t) continue;
      const row = { id };
      if (t.owner_id === 'ernesto' && owner) row.owner_id = owner;
      if (t.backup_id === 'ernesto' && backup) row.backup_id = backup;
      if (Object.keys(row).length === 1) continue;
      upsert(db, 'tasks', { ...row, updated_at: ts }); rehomed.push(id);
    }

    upsert(db, 'decisions', { id: 'dec-late-bid-chasing', date: '2026-11-09',
      title: 'Is chasing a late bid anybody\'s job now?',
      reason: 'The 2006 procedure had the Purchasing Manager call subcontractors if a bid had not arrived within a week. The hub of 20 October put it on James, but it was never confirmed in any meeting, so it came out of the rewritten procedure rather than being published as fact. If a bid going quiet should still be chased, say by whom and after how long. [Brittany 11/09]',
      status: 'proposed', decided_by: null, source: SRC });

    addEvent(db, { entity_type: 'task', entity_id: 'hub-new_work_order', kind: 'setup', status: 'info',
      label: `New work order process rewritten from the meetings; ${rehomed.length} procedures taken off the purchasing list`,
      source: 'manual', actor: 'brittany', external_id: 'new-work-order-rewrite-2026-11-09' });
  } },

  // Brittany's rules, 9 November: the Construction Assistant's work is Lonnie's unless a transcript put it
  // with James; every procedure that named the purchasing list belongs to Lonnie or James; and chasing a
  // late bid is Lonnie's, because he requests the bids now.
  { key: 'ca-to-lonnie-and-late-bids-2026-11-09', apply(db) {
    const ts = nowIso();
    const SRC = 'Brittany, 2026-11-09';
    const CA = 'Construction Assistant (CA)';

    // The CA role sat with Maria, who has left. Construction work goes to Lonnie.
    for (const [pid, fn] of [['maria', r => r.filter(x => x !== CA)], ['lonnie', r => [...new Set([...r, CA])]]]) {
      const p = db.prepare('SELECT legacy_roles, notes FROM people WHERE id = ?').get(pid); if (!p) continue;
      upsert(db, 'people', { id: pid, legacy_roles: fn(JSON.parse(p.legacy_roles || '[]')), updated_at: ts });
    }
    const lon = db.prepare('SELECT notes FROM people WHERE id = ?').get('lonnie');
    if (lon && !/Construction Assistant/.test(lon.notes || ''))
      upsert(db, 'people', { id: 'lonnie', notes: [lon.notes, 'Holds the Construction Assistant role as well as construction and permitting: "CA responsibilities should be all Lonnie\'s, aka construction, unless the transcript listed them as James." [Brittany 11/09]'].filter(Boolean).join('\n'), updated_at: ts });

    // Every procedure that used to name the purchasing list is Lonnie's or James's — construction or entry.
    const OWNERS = [
      ['hub-work_order_ap', 'lonnie', 'james'],        // approval and payment routing: the field side is Lonnie's
      ['hub-start_packet', 'lonnie', 'james'],
      ['obs-procedures-for-the-mch-database', 'james', 'lonnie'],  // the work-order guide: entry is James's
      ['sop-pur-01-wo-entry-buildconnect', 'james', 'lonnie'],
      ['sop-pur-02-material-po-entry', 'james', 'lonnie'],
      ['hub-new_work_order', 'lonnie', 'james'],
      ['tr-bid-requests', 'brittany', 'lonnie'],       // parked, Brittany's until it has a process; bids are Lonnie's
    ];
    for (const [id, owner, backup] of OWNERS) {
      if (!db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)) continue;
      upsert(db, 'tasks', { id, owner_id: owner, backup_id: backup, updated_at: ts });
    }

    // The two steps dropped on 9 November for want of confirmation now have an owner, so they go back in.
    const nwo = db.prepare('SELECT steps FROM tasks WHERE id = ?').get('hub-new_work_order');
    if (nwo && !/chase/i.test(nwo.steps || '')) {
      const lines = String(nwo.steps).split('\n');
      const at = lines.findIndex(l => /^7\./.test(l));   // after "Lonnie reviews the price and agrees it"
      const extra = [
        'If a bid has not come back, Lonnie chases it. He requests the bids, so following them up is his. [Brittany 11/09] The old procedure said a week; whether a week is still the right wait is not settled.',
        'Lonnie tells James what went out — address, date and which subcontractor — so entry knows what is coming. [Brittany 11/09, as the CA step, now Lonnie\'s] Never confirmed in a meeting: check it is really happening before relying on it.',
      ];
      lines.splice(at >= 0 ? at : lines.length, 0, ...extra);
      upsert(db, 'tasks', { id: 'hub-new_work_order',
        steps: lines.map((l, i) => l.replace(/^\s*\d+\.\s*/, '').trim()).map((l, i) => `${i + 1}. ${l}`).join('\n'),
        missing_info: 'Still open: who owns the vendor list and its current $/sq ft rates, the square footage per plan per trade, where each bidding document comes from, and how long a bid may go quiet before Lonnie chases it. The step where Lonnie tells James what went out was never confirmed in a meeting — check it is actually happening.',
        updated_at: ts });
    }

    upsert(db, 'decisions', { id: 'dec-late-bid-chasing', status: 'accepted', decided_by: 'Brittany',
      reason: 'Lonnie. He requests the bids now, so chasing one that has gone quiet is his. Back in the procedure as his step. How long to wait is not settled — the 2006 text said a week. [Brittany 11/09]' });

    // What is left of the same problem: three dead roles still sit with Maria and two with the purchasing list,
    // which is why 21 procedures still publish under "Director of Construction".
    upsert(db, 'decisions', { id: 'dec-legacy-roles-rehome', date: '2026-11-09',
      title: 'Five legacy roles still belong to people who have left — DOC, Superintendent and PM to Maria, DOP and Purchasing Manager to the purchasing list',
      reason: 'The Construction Assistant role moved to Lonnie on 9 November. Still sitting with Maria: Director of Construction, Superintendent and Project Manager. Still with the purchasing list: Director of Purchasing / Operations and Purchasing Manager. This is why 21 of the 53 published procedures show their owner as "Director of Construction" — a role nobody holds. Same rule as the CA one would settle it: construction to Lonnie, entry and purchasing to James, unless a transcript says otherwise. [Brittany 11/09]',
      status: 'proposed', decided_by: null, source: SRC });

    addEvent(db, { entity_type: 'person', entity_id: 'lonnie', kind: 'setup', status: 'info',
      label: 'Construction Assistant role moved to Lonnie; the seven purchasing-list procedures now sit with Lonnie or James; chasing a late bid is Lonnie\'s',
      source: 'manual', actor: 'brittany', external_id: 'ca-to-lonnie-and-late-bids-2026-11-09' });
  } },

  // The hub's completed-records panel was a list frozen in the page. Put the records in the world so the
  // panel comes from data, and so the next work order entered can be added rather than hand-edited.
  { key: 'work-orders-entered-2026-11-09', apply(db) {
    const ts = nowIso();
    const RECORDS = [
      {
            "id": "wo-40184",
            "wo_number": "WO 40184",
            "vendor_name": "Johnston Waterproofing",
            "job_name": "11603 Royal Parkside",
            "amount": 1935.75,
            "cost_code": "409",
            "notes": "4 rows: waterproofing, door pans, crickets"
      },
      {
            "id": "wo-40186",
            "wo_number": "WO 40186",
            "vendor_name": "H & H Fence",
            "job_name": "ROCVTA",
            "amount": 3025,
            "cost_code": "940",
            "notes": "Invoice 7272; physical site 11507 Royal Ivory Crossing; requested start 10/23 vs saved 10/27; authorized correction and date-policy review open"
      },
      {
            "id": "wo-40187",
            "wo_number": "WO 40187",
            "vendor_name": "M. Reeves",
            "job_name": "11602 Royal Parkside",
            "amount": 110,
            "cost_code": "",
            "notes": "Invoice 658140"
      },
      {
            "id": "wo-40188",
            "wo_number": "WO 40188",
            "vendor_name": "Autumn HVAC",
            "job_name": "11603 Royal Parkside",
            "amount": 16438.37,
            "cost_code": "610",
            "notes": "60/30/10 draws; 2,626 A/C sq ft"
      },
      {
            "id": "wo-40189",
            "wo_number": "WO 40189",
            "vendor_name": "Synergy",
            "job_name": "11603 Royal Parkside",
            "amount": 23991.24,
            "cost_code": "400",
            "notes": "30/50/20 draws; 2,542 roof sq ft; proposal date Oct 20, 2026"
      },
      {
            "id": "wo-40190",
            "wo_number": "WO 40190",
            "vendor_name": "Electrical Works CO2",
            "job_name": "11602 Royal Parkside",
            "amount": 1135,
            "cost_code": "620",
            "notes": "Invoice 22923"
      },
      {
            "id": "wo-40191",
            "wo_number": "WO 40191",
            "vendor_name": "Electrical Works CO3",
            "job_name": "11602 Royal Parkside",
            "amount": 255,
            "cost_code": "620",
            "notes": "Invoice 23263"
      },
      {
            "id": "po-21131",
            "wo_number": "PO 21131",
            "vendor_name": "Lowes",
            "job_name": "11602 Royal Parkside",
            "amount": 82.27,
            "cost_code": "996",
            "notes": "Receipt 41867; sent to Canon, physical output/handoff unverified; Complete disabled"
      },
      {
            "id": "po-21133",
            "wo_number": "PO 21133",
            "vendor_name": "Reece",
            "job_name": "11603 Royal Parkside",
            "amount": 8791.4,
            "cost_code": "601",
            "notes": "Valves $534.16 + trims $8,257.24; email sent"
      },
      {
            "id": "po-21134",
            "wo_number": "PO 21134",
            "vendor_name": "Reece",
            "job_name": "11603 Royal Parkside",
            "amount": 1493.65,
            "cost_code": "601",
            "notes": "Quote S124892371-0001; PO emailed to vendor with Maria cc"
      }
];
    for (const r of RECORDS)
      upsert(db, 'work_orders', { ...r, entered_by: 'james', entered_on: '2026-10',
        source: 'Recorded in the hub during the October work-order sessions', updated_at: ts });
    addEvent(db, { entity_type: 'integration', entity_id: 'dashboard', kind: 'setup', status: 'info',
      label: `${RECORDS.length} entered work orders and purchase orders moved into the world; the hub panel now comes from them`,
      source: 'manual', actor: 'brittany', external_id: 'work-orders-entered-2026-11-09' });
  } },

  // "Construction Assistant" is gone for good. The role is Construction and Lonnie holds it, so the words
  // come out of the role, out of Lonnie's record and out of every procedure step that still used them.
  { key: 'construction-not-ca-2026-11-09', apply(db) {
    const ts = nowIso();
    const lon = db.prepare('SELECT legacy_roles, notes FROM people WHERE id = ?').get('lonnie');
    if (lon) upsert(db, 'people', { id: 'lonnie',
      legacy_roles: [...new Set([...JSON.parse(lon.legacy_roles || '[]').filter(r => !/Construction Assistant/i.test(r)), 'Construction'])],
      notes: String(lon.notes || '').replace(/Holds the Construction Assistant role as well as construction and permitting[^\n]*/,
        'Holds Construction: "remove Construction Assistant completely and replace with just Construction, aka Lonnie." The old CA work is construction work and it is his. [Brittany 11/09]'),
      updated_at: ts });

    // The words themselves, wherever they appear in a procedure.
    const fix = v => String(v || '')
      .replace(/Construction Assistant \(CA\)/gi, 'Construction')
      .replace(/Construction Assistant/gi, 'Construction')
      .replace(/\bCA\b(?!\w)/g, 'Construction')
      .replace(/\bconstruction_asst\b/g, 'construction');
    let touched = 0;
    for (const t of db.prepare('SELECT id, steps, inputs, trigger, missing_info FROM tasks').all()) {
      const row = { id: t.id };
      for (const k of ['steps', 'inputs', 'trigger', 'missing_info']) if (t[k] && fix(t[k]) !== t[k]) row[k] = fix(t[k]);
      if (Object.keys(row).length === 1) continue;
      upsert(db, 'tasks', { ...row, updated_at: ts }); touched++;
    }

    // Step 1 of the new work order procedure said the CA post no longer exists. Say what is true instead.
    const nwo = db.prepare('SELECT steps FROM tasks WHERE id = ?').get('hub-new_work_order');
    if (nwo) upsert(db, 'tasks', { id: 'hub-new_work_order',
      steps: String(nwo.steps).replace(/Nobody receives red-lined plans[^\n]*/,
        'Nobody receives red-lined plans, and there is no assistant post to receive them — that work is Construction, which is Lonnie. [M 15:13–16:30] [Brittany 11/09]'),
      updated_at: ts });

    const doc = db.prepare("SELECT id, content FROM documents WHERE id = 'doc-legacy-role-construction-asst'").get();
    if (doc) upsert(db, 'documents', { id: doc.id, content: fix(doc.content),
      reason: 'Former Construction Assistant role, renamed Construction and held by Lonnie from 9 November', updated_at: ts });

    addEvent(db, { entity_type: 'person', entity_id: 'lonnie', kind: 'setup', status: 'info',
      label: `Construction Assistant removed: the role is Construction and Lonnie holds it (${touched} procedures reworded)`,
      source: 'manual', actor: 'brittany', external_id: 'construction-not-ca-2026-11-09' });
  } },

  // "Merge Director of Construction and Construction into one role, Construction, aka Lonnie." [Brittany 11/09]
  // The role merge is only half of it: 27 procedures were still owned by Maria, who has left, and the hub
  // showed them under a role nobody held. Construction being Lonnie means those are his.
  { key: 'doc-into-construction-2026-11-09', apply(db) {
    const ts = nowIso();
    const fix = v => String(v || '')
      .replace(/Director of Construction \(DOC\)/gi, 'Construction').replace(/Director of Construction/gi, 'Construction')
      .replace(/\bDOC\b(?!\w)/g, 'Construction');

    // Maria keeps nothing: the role is Construction and Lonnie holds it.
    const mar = db.prepare('SELECT legacy_roles, notes FROM people WHERE id = ?').get('maria');
    if (mar) upsert(db, 'people', { id: 'maria',
      legacy_roles: JSON.parse(mar.legacy_roles || '[]').filter(r => !/Director of Construction|^Construction$/i.test(r)),
      updated_at: ts });
    const lon = db.prepare('SELECT legacy_roles FROM people WHERE id = ?').get('lonnie');
    if (lon) upsert(db, 'people', { id: 'lonnie',
      legacy_roles: [...new Set([...JSON.parse(lon.legacy_roles || '[]').filter(r => !/Director of Construction/i.test(r)), 'Construction'])],
      updated_at: ts });

    // Procedures still recorded against Maria. Construction work is Lonnie's; the handful that are plainly
    // not construction are moved too, because nobody holding them is worse, and raised for a second look.
    const NOT_CONSTRUCTION = ['hub-interior_designer_selection', 'hub-interior_designer_hoa_rocc', 'hub-president_plan_selection'];
    const moved = [], flagged = [];
    for (const t of db.prepare("SELECT id, title, backup_id, review_note FROM tasks WHERE owner_id = 'maria'").all()) {
      upsert(db, 'tasks', { id: t.id, owner_id: 'lonnie', backup_id: t.backup_id === 'lonnie' ? null : t.backup_id,
        review_note: [t.review_note, 'Moved to Lonnie 9 November: Director of Construction and Construction are one role, Construction, and it is his. [Brittany 11/09]'].filter(Boolean).join('\n'),
        updated_at: ts });
      (NOT_CONSTRUCTION.includes(t.id) ? flagged : moved).push(t.title);
    }

    // The words, in procedure text as well as in the role.
    for (const t of db.prepare('SELECT id, steps, inputs, trigger, missing_info FROM tasks').all()) {
      const row = { id: t.id };
      for (const k of ['steps', 'inputs', 'trigger', 'missing_info']) if (t[k] && fix(t[k]) !== t[k]) row[k] = fix(t[k]);
      if (Object.keys(row).length > 1) upsert(db, 'tasks', { ...row, updated_at: ts });
    }

    upsert(db, 'decisions', { id: 'dec-legacy-roles-rehome', status: 'accepted', decided_by: 'Brittany',
      reason: 'Director of Construction is merged into Construction, which is Lonnie — the same answer as the Construction Assistant one. The 27 procedures recorded against Maria moved to him with it. Superintendent and Project Manager, and the two purchasing roles, are still unmerged. [Brittany 11/09]' });

    upsert(db, 'decisions', { id: 'dec-non-construction-with-lonnie', date: '2026-11-09',
      title: 'Three of the procedures that moved to Lonnie are not really construction',
      reason: `Merging Director of Construction into Construction moved everything recorded against Maria to Lonnie. Three of them do not look like construction work: ${flagged.join('; ')}. They went to him rather than being left with nobody, which is where they were. Interior design selections may belong with Pam, and choosing the plan may be Jim's. Say where each should sit. [Brittany 11/09]`,
      status: 'proposed', decided_by: null, source: 'Brittany, 2026-11-09' });

    addEvent(db, { entity_type: 'person', entity_id: 'lonnie', kind: 'setup', status: 'info',
      label: `Director of Construction merged into Construction: ${moved.length + flagged.length} procedures moved from Maria to Lonnie, ${flagged.length} of them flagged as probably not construction`,
      source: 'manual', actor: 'brittany', external_id: 'doc-into-construction-2026-11-09' });
  } },

  // The three that went to Lonnie with the construction merge but are not construction work. [Brittany 11/09]
  { key: 'selections-to-pam-plan-to-jim-2026-11-09', apply(db) {
    const ts = nowIso();
    const PLACE = [
      ['hub-interior_designer_selection', 'pam', 'james', 'Interior design selections are Pam\'s. James backs it up as Selection Coordinator.'],
      ['hub-interior_designer_hoa_rocc', 'pam', 'teresa', 'Interior design selections are Pam\'s. HOA and ROCVTA routing goes through Teresa, so she backs this one up.'],
      ['hub-president_plan_selection', 'jim', 'pam', 'Choosing the plan is Jim\'s. Pam backs it up from sales.'],
    ];
    for (const [id, owner, backup, why] of PLACE) {
      const t = db.prepare('SELECT review_note FROM tasks WHERE id = ?').get(id); if (!t) continue;
      upsert(db, 'tasks', { id, owner_id: owner, backup_id: backup,
        review_note: [t.review_note, `Placed 9 November: ${why} It had moved to Lonnie with the construction merge, which was never where it belonged. [Brittany 11/09]`].filter(Boolean).join('\n'),
        updated_at: ts });
    }
    upsert(db, 'decisions', { id: 'dec-non-construction-with-lonnie', status: 'accepted', decided_by: 'Brittany',
      reason: 'Interior design selections to Pam, backed up by James on the selections one and Teresa on the HOA / ROCVTA one. President plan selection to Jim, backed up by Pam. [Brittany 11/09]' });
    addEvent(db, { entity_type: 'task', entity_id: 'hub-interior_designer_selection', kind: 'setup', status: 'info',
      label: 'Interior design selections placed with Pam; plan selection with Jim — off Lonnie, who only held them because of the construction merge',
      source: 'manual', actor: 'brittany', external_id: 'selections-to-pam-plan-to-jim-2026-11-09' });
  } },

  // A place to put work that is on somebody's list only because it had to go somewhere. [Brittany 11/10]
  // One tab on the hub, so what nobody owns can be seen at a glance instead of hiding inside a real list.
  { key: 'unclassified-holder-2026-11-10', apply(db) {
    const ts = nowIso();
    upsert(db, 'people', { id: 'unclassified', name: 'Unclassified', full_name: 'Unclassified',
      title: 'No role assigned yet', role_summary: 'Work that is not anybody\'s yet. Parked here on purpose so it stays visible rather than sitting on whoever happened to be nearest it.',
      departments: [], confirmed: 0, review_status: 'not_reviewed', responsibilities: [], crossed_off: [],
      notes: 'UNCLASSIFIED — not a person. Created 9 November so a responsibility nobody owns can be taken off a real list without being lost: "James isn\'t doing these but I don\'t know who is." Everything here needs an owner. [Brittany 11/10]',
      source: 'Brittany, 2026-11-10', updated_at: ts });
    addEvent(db, { entity_type: 'person', entity_id: 'unclassified', kind: 'setup', status: 'info',
      label: 'Unclassified added to the hub as its own tab, for work that has no owner yet',
      source: 'manual', actor: 'brittany', external_id: 'unclassified-holder-2026-11-10' });
  } },

  // Nineteen of James's thirty-seven are not his. He is not doing them and nobody knows who is, so they
  // move to Unclassified rather than staying on his list to make it look covered. [Brittany 11/10]
  { key: 'james-to-unclassified-2026-11-10', apply(db) {
    const ts = nowIso();
    // Matched on their opening words so a later rewording does not silently miss one.
    const MOVE = [
      'Distributes copies of contract, specs, and upgrades',
      'Submits change order requests',
      'Follows up on customer approval of change orders',
      'Reviews floorplan choices, design options',
      'Schedules series of walk-throughs',
      'Confirms closing date with buyer',
      'Schedules New Home Orientation',
      'Schedules Homeowner Acceptance meeting',
      'Calls buyer within 24-48 hours',
      'Guides buyer through initial sales process',
      'Coordinates with Pam on buyer selections',
      '(Sales) Makes copies of contract package',
      '(Sales) Reviews status report and distributes contract package',
      '(Purchasing) Collects bids from subcontractors',
      '(Purchasing) Calls subcontractors for bids if not received',
      '(Purchasing) Requests and manages bid lists',
      '(Purchasing) Advises team of address, date, and subcontractor',
      '(Purchasing) Determines most competitive bid and creates work orders',
      'Modifies database budget when bid/quote approved',
    ];
    const j = db.prepare('SELECT * FROM people WHERE id = ?').get('james');
    const u = db.prepare('SELECT * FROM people WHERE id = ?').get('unclassified');
    if (!j || !u) return;
    const live = JSON.parse(j.responsibilities || '[]');
    const hit = r => MOVE.some(m => String(r).toLowerCase().startsWith(m.toLowerCase()));
    const moving = live.filter(hit), keeping = live.filter(r => !hit(r));
    // Including the five bid-request ones: "those should go to NA" [Brittany 11/10].
    const tagged = moving;   // the tab stays readable; where the bid work probably belongs is in the decision
    // Recorded as struck off his list as well as moved, which is what it is: a removal somebody decided.
    // It also means a re-import of an older hub cannot hand them back to him.
    upsert(db, 'people', { id: 'james', responsibilities: keeping,
      crossed_off: [...new Set([...JSON.parse(j.crossed_off || '[]'), ...moving])],
      notes: [j.notes, `${moving.length} responsibilities moved to Unclassified on 10 November: "James isn't doing these but I don't know who is." His list is the ${keeping.length} that are genuinely his. [Brittany 11/10]`].filter(Boolean).join('\n'),
      updated_at: ts });
    upsert(db, 'people', { id: 'unclassified',
      responsibilities: [...JSON.parse(u.responsibilities || '[]'), ...tagged.map(r => `${r} (was on James's list)`)],
      updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-unclassified-owners', date: '2026-11-10',
      title: `${moving.length} responsibilities have no owner — who does each of them?`,
      reason: `Taken off James on 10 November because he is not doing them. Thirteen are buyer-facing sales work — walk-throughs, orientation, acceptance meeting, closing date, change order approvals, the contract package — which reads like Pam's or a sales coordinator's. Five are the bid-request work that became Lonnie's on 9 November and are flagged as such on the tab. One is modifying the database budget when a bid is approved, which sits next to James's own work-order entry. They are parked in Unclassified so the gap is visible instead of hiding on a real list. [Brittany 11/10]`,
      status: 'proposed', decided_by: null, source: 'Brittany, 2026-11-10' });

    addEvent(db, { entity_type: 'person', entity_id: 'james', kind: 'setup', status: 'info',
      label: `${moving.length} responsibilities moved from James to Unclassified; his list is down to ${keeping.length}`,
      source: 'manual', actor: 'brittany', external_id: 'james-to-unclassified-2026-11-10' });
  } },

  // The thirteen buyer-facing items are Pam's. [Brittany 11/10] They were only unclassified for a day.
  { key: 'sales-items-to-pam-2026-11-10', apply(db) {
    const ts = nowIso();
    const SALES = [
      'Distributes copies of contract, specs, and upgrades',
      'Submits change order requests',
      'Follows up on customer approval of change orders',
      'Reviews floorplan choices, design options',
      'Schedules series of walk-throughs',
      'Confirms closing date with buyer',
      'Schedules New Home Orientation',
      'Schedules Homeowner Acceptance meeting',
      'Calls buyer within 24-48 hours',
      'Guides buyer through initial sales process',
      'Coordinates with Pam on buyer selections',
      '(Sales) Makes copies of contract package',
      '(Sales) Reviews status report and distributes contract package',
    ];
    // Two of them were written from someone else's side of the desk and read wrong once they are hers.
    const REWORD = [
      [/^Calls buyer within 24-48 hours to set up consultation with Pam/i, 'Calls buyer within 24-48 hours to set up the design consultation'],
      [/^Coordinates with Pam on buyer selections and design consultations/i, 'Coordinates buyer selections and design consultations with James'],
    ];
    const u = db.prepare('SELECT * FROM people WHERE id = ?').get('unclassified');
    const pam = db.prepare('SELECT * FROM people WHERE id = ?').get('pam');
    if (!u || !pam) return;
    const held = JSON.parse(u.responsibilities || '[]');
    const isSales = r => SALES.some(m => String(r).toLowerCase().startsWith(m.toLowerCase()));
    const moving = held.filter(isSales), staying = held.filter(r => !isSales(r));
    const clean = r => {
      let x = String(r).replace(/\s*\(was on James's list\)\s*$/, '');
      for (const [re, to] of REWORD) if (re.test(x)) x = x.replace(re, to);
      return `${x} (from James)`;
    };
    upsert(db, 'people', { id: 'pam',
      responsibilities: [...JSON.parse(pam.responsibilities || '[]'), ...moving.map(clean)],
      notes: [pam.notes, `${moving.length} buyer-facing responsibilities placed with her on 10 November — walk-throughs, orientation, the acceptance meeting, closing dates, change orders and the contract package. They came off James, who is not doing them. [Brittany 11/10]`].filter(Boolean).join('\n'),
      updated_at: ts });
    upsert(db, 'people', { id: 'unclassified', responsibilities: staying, updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-unclassified-owners',
      title: `${staying.length} responsibilities still have no owner`,
      reason: `The thirteen buyer-facing sales items went to Pam on 10 November. What is left unclassified: five bid-request items — collecting bids, chasing them after a week, managing bid lists, advising on address, date and subcontractor, and determining the most competitive bid — and modifying the database budget when a bid or quote is approved. The bid work looks like Lonnie's, since requesting and chasing bids became his on 9 November, but it has not been said. [Brittany 11/10]`,
      status: 'proposed', source: 'Brittany, 2026-11-10' });

    addEvent(db, { entity_type: 'person', entity_id: 'pam', kind: 'setup', status: 'info',
      label: `${moving.length} buyer-facing responsibilities placed with Pam; ${staying.length} left unclassified`,
      source: 'manual', actor: 'brittany', external_id: 'sales-items-to-pam-2026-11-10' });
  } },

  // Finishing James's list. [Brittany 11/10] Marketing is nobody's yet, permitting is Lonnie's, and five
  // entries go: four of them say again what another line on his list already says, and one is a duplicate
  // of his own work-order entry. Struck off, not erased — the removal is a decision and reads as one.
  { key: 'james-list-final-2026-11-10', apply(db) {
    const ts = nowIso();
    const TO_UNCLASSIFIED = ['Manages all marketing materials', 'Assists with MLS listings'];
    const TO_LONNIE = ['Handles all permitting coordination'];
    const DELETE = [
      ['Enters work orders in database when within budget', 'Same work as "(Purchasing) Enters work orders and purchase orders into database", which stays.'],
      ['Manages permit card filing and permit rack', 'Goes with permitting, and the permit rack is not kept.'],
      ['Confirm required permits, insurance, licenses, and approvals are in place', 'Covered by the vendor compliance lines he keeps.'],
      ['Maintain contractors liability insurance and keep up to date on all required forms', 'Said already by the GL certificate renewal line and the vendor-documents line.'],
      ['Maintain Purchasing database items', 'Too vague to own; the specific purchasing lines he keeps are the work.'],
    ];
    const j = db.prepare('SELECT * FROM people WHERE id = ?').get('james');
    const u = db.prepare('SELECT * FROM people WHERE id = ?').get('unclassified');
    const lon = db.prepare('SELECT * FROM people WHERE id = ?').get('lonnie');
    if (!j || !u || !lon) return;
    const starts = (r, list) => list.some(m => String(r).toLowerCase().startsWith(String(m).toLowerCase()));
    const live = JSON.parse(j.responsibilities || '[]');
    const toUn = live.filter(r => starts(r, TO_UNCLASSIFIED));
    const toLon = live.filter(r => starts(r, TO_LONNIE));
    const gone = live.filter(r => starts(r, DELETE.map(d => d[0])));
    const keeping = live.filter(r => !toUn.includes(r) && !toLon.includes(r) && !gone.includes(r));

    upsert(db, 'people', { id: 'james', responsibilities: keeping,
      crossed_off: [...new Set([...JSON.parse(j.crossed_off || '[]'), ...toUn, ...toLon, ...gone])],
      notes: [j.notes, `Finalised 10 November: marketing and MLS moved to Unclassified, permitting coordination to Lonnie, and ${gone.length} entries removed as saying again what another line already says. His list is ${keeping.length}. [Brittany 11/10]`].filter(Boolean).join('\n'),
      updated_at: ts });
    upsert(db, 'people', { id: 'unclassified',
      responsibilities: [...JSON.parse(u.responsibilities || '[]'), ...toUn.map(r => `${r} (was on James's list)`)],
      updated_at: ts });
    upsert(db, 'people', { id: 'lonnie',
      responsibilities: [...JSON.parse(lon.responsibilities || '[]'), ...toLon.map(r => `${r} (from James)`)],
      notes: [lon.notes, 'Permitting coordination — impact fees, rescheck and permit tracking — moved from James on 10 November. [Brittany 11/10]'].filter(Boolean).join('\n'),
      updated_at: ts });

    const why = Object.fromEntries(DELETE);
    upsert(db, 'decisions', { id: 'dec-james-list-removals', date: '2026-11-10',
      title: `${gone.length} responsibilities removed from James's list as duplicates`,
      reason: `Struck off on 10 November, not deleted, so they stay visible as removals. ${gone.map(g => `"${g}" — ${why[Object.keys(why).find(k => g.toLowerCase().startsWith(k.toLowerCase()))] || 'removed'}`).join(' ')} If any of these is really separate work rather than a restatement, say so and it comes back.`,
      status: 'accepted', decided_by: 'Brittany', source: 'Brittany, 2026-11-10' });

    upsert(db, 'decisions', { id: 'dec-unclassified-owners',
      title: `${JSON.parse(db.prepare("SELECT responsibilities FROM people WHERE id = 'unclassified'").get().responsibilities).length} responsibilities still have no owner`,
      reason: 'Unclassified holds the five bid-request items, modifying the database budget when a bid is approved, and now marketing and MLS listings. The bid work looks like Lonnie\'s, since requesting and chasing bids became his on 9 November, but Brittany has said to leave them unclassified for now. Marketing and MLS have no obvious home at all. [Brittany 11/10]',
      status: 'proposed', source: 'Brittany, 2026-11-10' });

    addEvent(db, { entity_type: 'person', entity_id: 'james', kind: 'setup', status: 'info',
      label: `James's list finalised at ${keeping.length}: 2 to Unclassified, 1 to Lonnie, ${gone.length} struck off as duplicates`,
      source: 'manual', actor: 'brittany', external_id: 'james-list-final-2026-11-10' });
  } },

  // Backcharges were three lines on James's list for what is one duty. They become one responsibility with
  // its steps underneath, hidden until it is clicked. [Brittany 11/11]
  { key: 'backcharges-one-responsibility-2026-11-11', apply(db) {
    const ts = nowIso();
    const PARENT = 'Handles backcharges when reported by construction';
    // Ordered by what has to happen first. Brittany said the subcontractor is told "prior to entering into
    // the database", so notifying comes before the entry even though she listed the entry first.
    const STEPS = [
      'Notifies the subcontractor of the backcharge before it goes into the database.',
      'Fills out the backcharge in the database completely.',
      'Clicks backcharge approval in the database.',
    ];
    const OLD = [/^Fills out database backcharges/i, /^Must notify subcontractors of backcharges/i, /^Clicks back ?charge approval/i];
    const j = db.prepare('SELECT * FROM people WHERE id = ?').get('james'); if (!j) return;
    const live = JSON.parse(j.responsibilities || '[]');
    const first = live.findIndex(r => OLD.some(re => re.test(String(r))));
    const rest = live.filter(r => !OLD.some(re => re.test(String(r))));
    const folded = live.filter(r => OLD.some(re => re.test(String(r))));
    if (!folded.length) return;
    rest.splice(first < 0 ? rest.length : Math.min(first, rest.length), 0, PARENT);
    upsert(db, 'people', { id: 'james', responsibilities: rest,
      responsibility_steps: { ...JSON.parse(j.responsibility_steps || '{}'), [PARENT]: STEPS },
      // The exact lines that became steps, so a snapshot taken before the fold cannot list them again
      // beside the responsibility that now contains them.
      folded_lines: [...new Set([...JSON.parse(j.folded_lines || '[]'), ...folded])],
      notes: [j.notes, `Backcharges folded into one responsibility on 11 November: "${PARENT}". The three lines that were on the list — filling it out, telling the subcontractor, clicking approval — are its steps, shown when the responsibility is clicked. [Brittany 11/11]`].filter(Boolean).join('\n'),
      updated_at: ts });

    addEvent(db, { entity_type: 'person', entity_id: 'james', kind: 'setup', status: 'info',
      label: `Backcharges: ${folded.length} responsibilities folded into one with ${STEPS.length} steps behind it`,
      source: 'manual', actor: 'brittany', external_id: 'backcharges-one-responsibility-2026-11-11' });
  } },

  // The back charge procedure: the notification goes in the database, and James does the whole of it once
  // construction reports it. [Brittany 11/11]
  { key: 'back-charge-james-owns-it-2026-11-11', apply(db) {
    const ts = nowIso();
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get('hub-back_charge'); if (!t) return;
    upsert(db, 'tasks', { id: 'hub-back_charge', owner_id: 'james', backup_id: 'lonnie',
      content_locked: 1, documented: 1,
      steps: String(t.steps)
        .replace('1. Whoever runs the job decides there is a back charge, because they know what actually happened and why.',
                 '1. Construction decides there is a back charge and reports it, because they know what actually happened and why. Everything after this is James.')
        .replace('4. Fill in who was notified and the date they were notified. The field exists and it is the most important part of the record.',
                 '4. Fill in who was notified and the date they were notified, in the database. The field exists and it is the most important part of the record.'),
      inputs: 'Who does what:\nConstruction (Lonnie) — decides there is a back charge and reports it\nPurchasing assistant (James) — every step after that: telling the vendor, creating it in the database, recording who was notified and when, and clicking approved\nAccounting (Kenneth) — reads the back-charge report before cutting cheques',
      review_note: [t.review_note, 'Updated 11 November: the notification is recorded in the database, and James runs the whole procedure once construction reports it — "James will be doing this entire process." [Brittany 11/11]'].filter(Boolean).join('\n'),
      updated_at: ts });

    // His list says purchasing; the hub still calls him Sales / Marketing Coordinator.
    const j = db.prepare('SELECT title FROM people WHERE id = ?').get('james');
    if (j && /sales|marketing/i.test(j.title || ''))
      upsert(db, 'decisions', { id: 'dec-james-title', date: '2026-11-11',
        title: `James's title still reads "${j.title}" — should it be Purchasing Assistant?`,
        reason: 'Brittany called him the purchasing assistant on 11 November, and every one of the eight responsibilities left on his list is purchasing: work order and PO entry, back charges, takeoffs and estimates, vendor pricing, W-9s, GL insurance and the purchasing files. The marketing and MLS lines moved to Unclassified on 10 November. The title is the last thing still describing the old job. [Brittany 11/11]',
        status: 'proposed', decided_by: null, source: 'Brittany, 2026-11-11' });

    addEvent(db, { entity_type: 'task', entity_id: 'hub-back_charge', kind: 'setup', status: 'info',
      label: 'Back charge: notification recorded in the database; James runs the whole procedure once construction reports it',
      source: 'manual', actor: 'brittany', external_id: 'back-charge-james-owns-it-2026-11-11' });
  } },

  // A back charge is not a financial procedure. The financial part starts where this one ends: accounting
  // is told one was entered and puts it into QuickBooks. [Brittany 11/11]
  { key: 'back-charge-not-financial-2026-11-11', apply(db) {
    const ts = nowIso();
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get('hub-back_charge'); if (!t) return;
    upsert(db, 'tasks', { id: 'hub-back_charge', hub_category: 'Operations', department_id: 'purchasing',
      inputs: String(t.inputs || '').replace(
        'Accounting (Kenneth) — reads the back-charge report before cutting cheques',
        'Accounting (Kenneth) — where the financial side starts, after this procedure ends: accounting is notified a back charge was entered, puts it into QuickBooks, and reads the back-charge report before cutting cheques'),
      review_note: [t.review_note, 'Recategorised 11 November from Financial to Operations: "the financial side of this starts at the end of this current back charge process, because accounting gets notified a back charge was entered and then they put it into QuickBooks." The procedure itself is construction reporting it and purchasing recording it. [Brittany 11/11]'].filter(Boolean).join('\n'),
      updated_at: ts });
    addEvent(db, { entity_type: 'task', entity_id: 'hub-back_charge', kind: 'setup', status: 'info',
      label: 'Back charge moved out of Financial into Operations; the QuickBooks entry is recorded as what accounting does after it',
      source: 'manual', actor: 'brittany', external_id: 'back-charge-not-financial-2026-11-11' });
  } },

  // James is the purchasing assistant. The sales and marketing half of the title waits until he actually
  // holds sales and marketing work — those two lines are sitting in Unclassified. [Brittany 11/11]
  { key: 'james-title-purchasing-assistant-2026-11-11', apply(db) {
    const ts = nowIso();
    const j = db.prepare('SELECT title, notes FROM people WHERE id = ?').get('james'); if (!j) return;
    upsert(db, 'people', { id: 'james', title: 'Purchasing Assistant', role_summary: 'Purchasing: work order and purchase order entry, back charges, estimating support, and vendor compliance.',
      notes: [j.notes, `Title changed from "${j.title}" to Purchasing Assistant on 11 November. It becomes "Purchasing Assistant / Sales & Marketing Assistant" if and when he actually holds sales and marketing work — marketing materials and MLS listings are in Unclassified, not with him, so the title would be describing a job he is not doing. [Brittany 11/11]`].filter(Boolean).join('\n'),
      updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-james-title', status: 'accepted', decided_by: 'Brittany',
      reason: 'Purchasing Assistant. The sales and marketing half waits until he has sales and marketing responsibilities — "maybe wait on the sales and marketing part until he has sales and marketing responsibilities." [Brittany 11/11]' });

    // So the title is not forgotten if those two lines land back on him.
    upsert(db, 'decisions', { id: 'dec-marketing-owner', date: '2026-11-11',
      title: 'Who owns marketing materials and MLS listings?',
      reason: 'Both are in Unclassified since 10 November, taken off James because he is not doing them. They are the only two responsibilities in the company with no home that are not purchasing. If they go back to James his title becomes "Purchasing Assistant / Sales & Marketing Assistant"; if they go to Pam they join the buyer-facing work she took on 10 November. [Brittany 11/11]',
      status: 'proposed', decided_by: null, source: 'Brittany, 2026-11-11' });

    addEvent(db, { entity_type: 'person', entity_id: 'james', kind: 'setup', status: 'info',
      label: 'James retitled Purchasing Assistant; the sales and marketing half of the title waits on the work',
      source: 'manual', actor: 'brittany', external_id: 'james-title-purchasing-assistant-2026-11-11' });
  } },

  // Preparing the budget is construction's. Entering the approved one is purchasing's. [Brittany 11/11]
  { key: 'budget-prep-lonnie-entry-james-2026-11-11', apply(db) {
    const ts = nowIso();
    const PREP = /^Assist with takeoffs, estimates/i;
    const ENTRY = 'Enters the approved construction budget into the database, once construction hands it over';
    const j = db.prepare('SELECT * FROM people WHERE id = ?').get('james');
    const lon = db.prepare('SELECT * FROM people WHERE id = ?').get('lonnie');
    if (!j || !lon) return;
    const live = JSON.parse(j.responsibilities || '[]');
    const moving = live.filter(r => PREP.test(String(r)));
    const rest = live.filter(r => !PREP.test(String(r)));
    const at = live.findIndex(r => PREP.test(String(r)));
    rest.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0, ENTRY);
    upsert(db, 'people', { id: 'james', responsibilities: rest,
      crossed_off: [...new Set([...JSON.parse(j.crossed_off || '[]'), ...moving])],
      notes: [j.notes, 'Takeoffs, estimates, specifications, scopes of work and budget preparation moved to Lonnie on 11 November — that is construction\'s work. What James has instead is the entry: construction hands him the approved budget and he puts it in the database. [Brittany 11/11]'].filter(Boolean).join('\n'),
      updated_at: ts });
    upsert(db, 'people', { id: 'lonnie',
      responsibilities: [...JSON.parse(lon.responsibilities || '[]'),
        ...moving.map(r => String(r).replace(/\s*\(from Maria\)\s*$/, '') + ' (from James)'),
        'Hands the approved construction budget to purchasing for entry'],
      notes: [lon.notes, 'Takeoffs, estimates, home-specific specifications, scopes of work and construction budget preparation moved from James on 11 November: "that one is all Lonnie." He hands the approved budget to James, who enters it. [Brittany 11/11]'].filter(Boolean).join('\n'),
      updated_at: ts });

    // The matching line sitting in Unclassified is the same handoff at a later point.
    upsert(db, 'decisions', { id: 'dec-budget-entry-vs-revision', date: '2026-11-11',
      title: 'Does "modifies database budget when bid/quote approved" belong with James too?',
      reason: 'James now enters the approved construction budget when construction hands it over [Brittany 11/11]. "Modifies database budget when bid/quote approved" has been sitting in Unclassified since 10 November and is the same act at a later point in the job — the budget changing in the database once a price is agreed. If entering it is his, changing it probably is too, but it has not been said. Note the approval itself is not his either way: Lonnie agrees the price, James records it.',
      status: 'proposed', decided_by: null, source: 'Brittany, 2026-11-11' });

    addEvent(db, { entity_type: 'person', entity_id: 'lonnie', kind: 'setup', status: 'info',
      label: 'Budget preparation moved to Lonnie; James enters the approved budget when construction hands it over',
      source: 'manual', actor: 'brittany', external_id: 'budget-prep-lonnie-entry-james-2026-11-11' });
  } },

  // The transcripts do answer it. Maria, going down her own list on 6 November: item 15, modifies database
  // budget — "any budget entering would be James and there's a workflow for that." [Brittany 11/13: "it is
  // in the transcripts"]
  { key: 'budget-modification-james-2026-11-13', apply(db) {
    const ts = nowIso();
    const MATCH = /^Modifies database budget when bid\/quote approved/i;
    const u = db.prepare('SELECT * FROM people WHERE id = ?').get('unclassified');
    const j = db.prepare('SELECT * FROM people WHERE id = ?').get('james');
    if (!u || !j) return;
    const held = JSON.parse(u.responsibilities || '[]');
    const moving = held.filter(r => MATCH.test(String(r)));
    if (!moving.length) return;
    upsert(db, 'people', { id: 'unclassified', responsibilities: held.filter(r => !MATCH.test(String(r))), updated_at: ts });
    upsert(db, 'people', { id: 'james',
      responsibilities: [...JSON.parse(j.responsibilities || '[]'),
        'Modifies the budget in the database when a bid or quote is approved, and raises budget increase requests, working from numbers construction or Teresa give him'],
      notes: [j.notes, 'Budget modification confirmed as his on 13 November from the transcripts, not decided fresh: Maria, going down her own list on 6 November — "any budget entering would be James and there is a workflow for that" [M-final 11/06 5:40]; and on 5 November — "when the budgets are done, James will have to enter the budgets… whenever he gets a revision or something from construction or from Teresa having to increase a budget, he will have very specific information and numbers to do so" [Purchasing 11/05].'].filter(Boolean).join('\n'),
      updated_at: ts });

    upsert(db, 'decisions', { id: 'dec-budget-entry-vs-revision', status: 'accepted', decided_by: 'Brittany',
      reason: 'James, on the transcripts rather than a fresh decision. Maria on 6 November, reviewing item 15 of her own list: "any budget entering would be James and there is a workflow for that." On 5 November she had already said he enters the budget once it is approved, and handles revisions and increases from numbers construction or Teresa supply. [M-final 11/06] [Purchasing 11/05]' });

    upsert(db, 'decisions', { id: 'dec-unclassified-owners',
      title: `${JSON.parse(db.prepare("SELECT responsibilities FROM people WHERE id = 'unclassified'").get().responsibilities).length} responsibilities still have no owner`,
      reason: 'What is left unclassified is the five bid-request items, plus marketing materials and MLS listings. The bid work looks like Lonnie\'s, since requesting and chasing bids became his on 9 November, but Brittany has said to leave them for now. Marketing and MLS have no obvious home at all. [Brittany 11/13]',
      status: 'proposed', source: 'Brittany, 2026-11-13' });

    // The stale budget revision SOP has an answer in the same transcripts. Not applied — it is hers to approve.
    upsert(db, 'decisions', { id: 'dec-budget-increase-route', date: '2026-11-13',
      title: 'The stale budget revision procedure has an answer in the 6 November transcript',
      reason: 'Budget Revision Update was marked stale on 9 November because the written routine — the overage log, the weekly print, forwarding to Kenneth — is not happening. But the all-office meeting of 6 November describes what does happen: a budget increase is requested in the database with a reason; a standard one takes a single approval from the Director of Operations; Teresa and Kenneth are notified by email because nothing in the database tells them. If that is right, the procedure can be rewritten from current to stale rather than left as a known gap. [Brittany 11/13]',
      status: 'proposed', decided_by: null, source: 'All-office meeting, 2026-11-06' });

    addEvent(db, { entity_type: 'person', entity_id: 'james', kind: 'setup', status: 'info',
      label: 'Budget modification placed with James on the transcripts; Unclassified down to 7',
      source: 'manual', actor: 'brittany', external_id: 'budget-modification-james-2026-11-13' });
  } },
];
function applyUpdates(db) {
  const applied = new Set(JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'applied_updates'").get()?.value || '[]'));
  let n = 0;
  for (const u of UPDATES) {
    if (applied.has(u.key)) continue;
    db.exec('BEGIN'); try { u.apply(db); applied.add(u.key); db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_updates', ?)").run(JSON.stringify([...applied])); db.exec('COMMIT'); n++; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return n;
}

module.exports = { seedIfEmpty, applyUpdates };
