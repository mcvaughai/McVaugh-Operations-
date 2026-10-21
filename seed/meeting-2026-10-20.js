// Meeting 3 — call with Maria (and James) on 2026-10-20, 28 min. Citations [M3 mm:ss]. Applied once by seed.js ('meeting-3-2026-10-20').
'use strict';
const MEETING = { id: 'meeting-2026-10-20-maria-call', date: '2026-10-20', title: 'Maria Abney — call: plan types, Landing split, permit docs, change orders, start packet', attendees: ['Maria Abney', 'Brittany McVaugh', 'James McVaugh'],
  source: 'Teams recording transcript "Call with James and 1 other-20261020_121248", 28m 43s, exported as .docx by Brittany (2026-10-21).', file: 'seed/meetings/2026-10-20-maria-call.txt', cite: 'M3',
  summary: 'Plan types per villa address; 11603 and 11607 are the two starts; Landing: Frank\'s company is the GC, MCH supervises (permits, inspections, surveys, energy); scopes doc due 10/20, meeting Fri 10/23; permit folder has inspections/fees doc, full submission doc still in progress (to be Teams-recorded); change orders not done in the database for ~10 years — priced by Maria, approved/paid by homeowner, then a .1/.2 work order; no budget revision log — dated budget increases with a reason act as the log; start packet = white binder (City-approved docs + stamped plans) for inspections only, everything else digital per job folder; Maria\'s last day before Nov 9; next meeting Fri 10/23.' };

// step-review rows to APPEND to existing tasks (cite M3)
const STEP_REVIEW_APPEND = {
  'hub-change_order_budget': [
    { n: '2–3', old: 'DOC reviews database inbox daily for approved change orders; logs into change order budget log', verdict: 'no_longer', said: '"We haven\'t done change orders in the database in 10 years." The portal flow made sense with 19 people and 35 sold specs; today: Maria prices the change, the homeowner approves and pays, then a work order is written on a .1 (extra) or .2 (change order) cost code. No change-order record in the database.', cite: '[M3 13:26–15:36]' },
  ],
  'hub-budget_revision': [
    { n: '8–9', old: 'DOC logs overage into budget revision log; prints weekly', verdict: 'no_longer', said: '"I\'ve never seen a budget revision log." Budget increases in the database are dated; if each carries its reason (lumber overrun, rain…) that is the log — "keeping a log separate is double dipping."', cite: '[M3 17:33–18:15]' },
  ],
  'hub-permitting': [
    { n: '24–29', old: 'DOP assembles start packet; DOC distributes start memo', verdict: 'changed', said: 'The "start packet" today is Maria\'s white binder per job: City of Houston approved documents + the stamped plans, kept in her office and taken to site for every inspection (left on site they get destroyed). Everything else is digital in the job folder on Public (…\\ROCV\\Homes under construction\\phase\\address\\City of Houston approved documents, Permit). Master stamped plans live once under the ROCV folder; custom homes have plans per address. Teresa keeps a paper folder too; both agreed it is unnecessary since Royal Parkside.', cite: '[M3 18:21–23:45]' },
    { n: 'new', old: '', verdict: 'new', said: 'In the "Maria leaving" folder now: how to call in inspections and pay for inspections and permits ("really what a builder will need"). The full permit-submission document is still being written; Maria will Teams-record a permit resubmittal instead of screenshots.', cite: '[M3 6:09–7:26]' },
  ],
  'hub-homebuilding': [
    { n: 'new', old: '', verdict: 'new', said: 'Maria will put together a basic schedule — "at least the tasks that go into building a house" — but the ordering of trades is construction-management knowledge a hire must bring ("that\'s what their job description is").', cite: '[M3 26:23–27:02]' },
  ],
};
// new confirmed procedure
const NEW_TASKS = [
  { id: 'tr-change-orders', title: 'Change orders (as done today, outside the database)', department_id: 'estimating', owner_id: 'maria', backup_id: 'jim', proposed: 0, documented: 1, board: 'next',
    trigger: 'A homeowner asks for a change on a sold home.', steps: '1. Maria prices the change.\n2. Homeowner approves and pays.\n3. A work order is written on the .1 (extra) or .2 (change order) cost code; no change-order record is created in the database.',
    verification_result: 'Confirmed [M3 13:26–15:36]. Supersedes the database change-order portal flow (Change Order Request / Change Order Budget Entry SOPs), unused for ~10 years.', missing_info: 'Who prices change orders after Maria; where the homeowner\'s approval/payment is recorded (not stated).', source: 'Maria call 2026-10-20 (transcript)', supersedes: ['hub-change_order_request', 'hub-change_order_budget'] },
  { id: 'tr-landing-supervision', title: 'Royal Oaks Landing: MCH supervision scopes (permits, inspections, surveys, energy)', department_id: 'construction', owner_id: 'maria', proposed: 0, documented: 0, board: 'working',
    trigger: 'Landing lots start under Frank\'s company as general contractor.', steps: 'Frank\'s company builds as GC; MCH supervises (not consults). MCH pulls the permits, so MCH calls in inspections and follows up on them; MCH does the surveys (form survey, final survey), the energy inspections and the house paperwork. Construction schedule comes from the GC — none exists yet. Scopes document promised by end of day 10/20; selections/specifications finalized Fri 10/23 (does not change who does what).',
    verification_result: 'Confirmed [M3 3:47–5:37]. Frank = the GC at Landing (confirmed; company name not stated).', missing_info: 'The scopes document; the GC\'s schedule; who at MCH calls inspections after Nov 9.', next_action: 'Get the scopes doc; put the GC schedule dates (surveys, energy inspections) on the Landing homes.', source: 'Maria call 2026-10-20 (transcript)' },
];
const HOME_UPDATES = [
  { match: '11603 Royal Parkside Place', notes_add: 'Plan 4A. One of the two current starts. Awaiting an inspection 10/20; the week of 10/20 and the next are scheduled; Maria to send a photo of her calendar.', cite: '[M3 0:48, 3:38]' },
  { match: '11602 Royal Parkside Place', stage: 'Almost complete', notes_add: 'Plan 3A — "almost complete, I wouldn\'t worry about that one." Reference house for 11607 (same plan).', cite: '[M3 0:23–0:43]' },
  { match: '11607 Royal Parkside Place', active: 'active', kind: 'home', stage: 'Starting (plan 3A)', notes_add: 'Plan 3A, one of the two starts Maria named; copy WOs/POs from 11602 (same plan).', cite: '[M3 0:23–0:43]' },
  { match: '11606 Royal Parkside Place', notes_add: 'Plan 4 (reference for vendors/square footage).', cite: '[M3 1:32]' },
  { match: '11611 Royal Parkside Place', notes_add: 'Plan 4A custom (extra 3-car garage and flex room) — usable as a vendor reference, not for square footages.', cite: '[M3 1:42–2:04]' },
  { match: '11603 Royal Plain Ave', notes_add: 'The old model: most recent 4A built — reference for 11603 Royal Parkside (also 4A).', cite: '[M3 0:59–1:19]' },
];
const HANDOVER_UPDATES = [
  { id: 'ho-leander', note: '10/20: Maria added the design-guidelines file path (HOA documents) to the how-to. [M3 8:41–11:52]' },
  { id: 'ho-vendor-insurance', backup: 'James (did it; Maria walked him through it Fri 10/17) — Maria suggests Kenneth own it since he updates QuickBooks insurance anyway', note: '10/20: confirmed James trained. [M3 10:49–11:44]' },
  { id: 'ho-permits', note: '10/20: "inspections + paying for inspections/permits" doc is in the folder; full permit-submission doc still in progress, to be Teams-recorded. [M3 6:09–7:26]' },
  { id: 'ho-landing-frank', item: 'Landing: Frank\'s company is the GC; MCH supervises — permits, inspections, surveys, energy, paperwork', capture: 'Scopes document (promised 10/20); GC\'s construction schedule; who calls inspections after Nov 9.', note: '10/20: Frank confirmed as the GC. Meeting Fri 10/23 finalizes selections/specs. [M3 3:47–5:37]' },
  { id: 'ho-work-orders', note: '10/20: Maria is still looking for the square-footage sheet she gave Ernesto; SOW Excel to get contractor contact columns. [M3 7:29–8:37]' },
  { id: 'ho-scheduling', note: '10/20: 11603 calendar photo promised; Maria will write a basic task list for building a house, but says trade ordering must come with the hire. [M3 3:27–3:47, 26:23]' },
  { id: 'ho-crossed-off', note: '10/20: change-order inbox/log confirmed gone (10 years); budget revision log never existed — dated DB budget increases with a reason are the log; start packet = inspection binder only. [M3 13:26–23:45]' },
];
const NEW_HANDOVER = [
  { id: 'ho-inspection-binder', item: 'Inspection binder per job (City-approved documents + stamped plans) taken to site for every inspection', basis: 'Transcript 10/20', documented: 'partial (contents are in the job folder on Public)', current: 'confirmed', backup: '', risk: 'medium', capture: 'Where the binders are; which addresses have one; the rule that stamped plans must be on site for inspections.', cite: '[M3 18:21–23:45]', why: 'The old "start packet / start memo" steps were crossed off, but a physical packet still exists: the white binder Maria builds per job and carries to inspections. Nobody else knows it exists or what goes in it.', task_ids: ['hub-permitting', 'tr-permit-per-address'], doc_ids: [] },
];
const SUPERSEDES = { // new (tr-) → old (hub-/proc-) procedures they replace or absorb
  'tr-permit-per-address': ['hub-permitting'],
  'tr-bids-and-sqft-rates': ['hub-new_work_order'],
  'tr-purchase-orders-materials': ['hub-start_packet'],
  'tr-field-verification-and-draws': ['hub-work_order_ap'],
  'tr-wo-approval-single-point': ['hub-work_order_ap'],
  'tr-schedule-and-trade-coordination': ['hub-homebuilding'],
  'tr-homeowner-walkthrough': ['hub-homebuyer_expectations'],
  'tr-database-budget-enforcement': ['hub-budget_revision', 'hub-budget_review'],
  'tr-selections-vendor-bidding': ['hub-interior_designer_selection', 'hub-interior_designer_hoa_rocc'],
  'tr-change-orders': ['hub-change_order_request', 'hub-change_order_budget'],
  'tr-landing-supervision': [],
  'tr-leander-arc-review': [], 'tr-vendor-onboarding-insurance': [], 'tr-cbusa-reporting': [], 'tr-landing-frank-scope': [], 'tr-punch-out': [],
  'proc-warranty': [], 'proc-hoa': [],
};
module.exports = { MEETING, STEP_REVIEW_APPEND, NEW_TASKS, HOME_UPDATES, HANDOVER_UPDATES, NEW_HANDOVER, SUPERSEDES };
