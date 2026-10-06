// Seed data derived from McVaugh_Operations_Assessment_and_Pages_Handoff.md (discovery dated 2026-10-02).
// CONFIRMED facts are marked confirmed/approved; everything else is PROPOSED and awaits review.
// Seeding only runs when the database is empty, so edits made in the app are never overwritten.
'use strict';
const { upsert, addEvent, nowIso } = require('./db');

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
  { key: 'stage2-checkpoint-2026-10-06', apply(db) {
    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author) VALUES (?,?,?,?,?,?,?,?,?)`).run(nowIso(), 'gather',
      'Stage 2: review queue and bulk import are ready. Work through the Review tab one item at a time.',
      'Stage 1 build (visual world, registry, saved state). Stage 2 build (folder import with skip-unchanged, import preview, review queue with merge). 12 active jobs recorded.',
      'Open the Review tab and verify the first person (it starts with the people, then proposed tasks). Then point Integrations → Option 3 at your Obsidian vault and click Preview.',
      'Brittany (old dashboard export and a few real Obsidian notes, so the mapping can be checked); Brittany (which job is the 13th active home)',
      'Confirm the SQLite store decision; confirm the reuse decision for the existing skills.',
      'Added by the Stage 2 build. Save your own checkpoint when you stop.', 'system');
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
