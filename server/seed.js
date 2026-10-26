// Seed data derived from McVaugh_Operations_Assessment_and_Pages_Handoff.md (discovery dated 2026-10-02).
// CONFIRMED facts are marked confirmed/approved; everything else is PROPOSED and awaits review.
// Seeding only runs when the database is empty, so edits made in the app are never overwritten.
'use strict';
const { upsert, addEvent, nowIso } = require('./db');
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
