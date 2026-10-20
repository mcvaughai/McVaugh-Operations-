// Succession pass for Maria Abney — data derived from two meeting transcripts, applied once per database by seed.js.
// Every claim carries a citation:  [M hh:mm]  = Maria Abney meeting 2026-10-16 (Teams recording, 1h12m), timestamp
//                                  [J 10/12]  = Jim McVaugh call 2026-10-12 (pasted by Brittany 2026-10-20)
//                                  [HUB 10/20] = updated MCH Operations Hub supplied 2026-10-20 (Maria's own cross-offs are the "[N/A]" items)
// "confirmed" = said in a transcript. "unconfirmed" = from an old SOP or the hub, not yet confirmed by anyone.
// Inferences are labeled "(inference)".
'use strict';

const MEETINGS = [
  { id: 'meeting-2026-10-12-jim-work-orders', date: '2026-10-12', title: 'Jim McVaugh — work order approval and budget rules', attendees: ['Jim McVaugh', 'Brittany McVaugh'],
    source: 'Phone/Teams call transcript pasted by Brittany on 2026-10-20 (auto-transcribed; the paste contained a duplicated passage, de-duplicated here).', file: 'seed/meetings/2026-10-12-jim-work-order-process.txt', cite: 'J 10/12',
    summary: 'Who checks off work orders (Maria does super, PM and DOC today); within-budget WOs need no prior approval; over-budget requires a budget increase approved by Jim with a reason; no moving money between budget lines; variance/change-order/selection coding .1/.2/.3.' },
  { id: 'meeting-2026-10-16-maria-villas', date: '2026-10-16', title: 'Maria Abney — job description updates / villas handover (part 1)', attendees: ['Maria Abney', 'Brittany McVaugh', 'James McVaugh (listening)'],
    source: 'Teams meeting recording transcript "meeting job description updates-20261016_145917", 1h 12m 52s, exported as .docx by Brittany.', file: 'seed/meetings/2026-10-16-maria-villas-handover.txt', cite: 'M',
    summary: 'Leander ARC plan review; villa lot/permit status; permits per address; bidding and per-square-foot work orders; POs and the bids-awarded folder structure; scheduling (pencil calendar); field verification and draws; punch-out and walkthroughs; vendor onboarding and insurance; warranty and HOA requests; CBUSA reporting still to be written.' },
];

// ---------- per-step reconciliation of the old SOPs against what was said ----------
// verdict: match | changed | no_longer | not_mentioned | new
const STEP_REVIEWS = {
  'hub-new_work_order': [
    { n: 1, old: 'Red-lined plans are received by CA', verdict: 'changed', said: 'Villas use already-approved master plans (3, 3A, 4, 4A); the plan to send is known as soon as the lot is assigned. No Construction Assistant exists.', cite: '[M 15:13–16:30]' },
    { n: 2, old: 'CA requests current bid list from PM', verdict: 'changed', said: 'The "bid list" is Maria\'s own vendor knowledge; she will leave "a good list of people at least to send the bids to".', cite: '[M 18:59]' },
    { n: 3, old: 'CA sends plans to subcontractors for bidding', verdict: 'changed', said: 'Maria sends plans. Square-foot trades (framing, concrete, stucco, sheetrock) need no bid once a per-sq-ft price is agreed; electrical, plumbing, mechanical are sent out to bid but are consistent per plan. Timing matters: bid too early and prices rise before slab.', cite: '[M 12:41–13:36, 16:30–17:35]' },
    { n: 4, old: 'CA advises Purchasing Manager of address, date, subcontractor', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 5, old: 'If no bid within 1 week, Purchasing Manager calls subcontractors', verdict: 'not_mentioned', said: 'Hub 10/20 assigns "(Purchasing) Calls subcontractors for bids if not received within 1 week" to James — unconfirmed.', cite: '[HUB 10/20]' },
    { n: 6, old: 'Purchasing Manager determines most competitive bid and creates work order', verdict: 'changed', said: 'Maria creates the WOs. Jim: "Purchasing writes the work order and purchase order, they don\'t leave the office" — but today Maria does all roles. A WO is labor only, paperless; the sub accepts it in the portal and that acceptance is the agreed price; the database emails the sub automatically. Per-sq-ft WOs can be built from square footage × rate with the trade\'s draw schedule; square footage differs by trade (framer total, sheetrock excludes balconies, trim = AC area).', cite: '[J 10/12] [M 36:37–39:20, 57:54–59:32]' },
    { n: 7, old: 'Purchasing Manager returns work order to CA for start package', verdict: 'no_longer', said: 'No CA; start packet distribution crossed off by Maria ("[N/A] Distributes start packet and start memo").', cite: '[HUB 10/20]' },
    { n: 'new', old: '', verdict: 'new', said: 'Documents each trade needs for bidding are listed on the SOW Excel ("necessary documents to provide"); Brittany asked Maria to add where each document comes from.', cite: '[M 13:36–14:18]' },
  ],
  'hub-work_order_ap': [
    { n: 1, old: 'Purchasing collects bid', verdict: 'changed', said: 'Maria collects/negotiates; see New Work Order step 3.', cite: '[M 12:41–13:36]' },
    { n: 2, old: 'Purchasing enters work order in database', verdict: 'changed', said: 'Maria enters them ("she does check off as everything").', cite: '[J 10/12]' },
    { n: 3, old: 'Subcontractor or CA clicks complete if 100% complete', verdict: 'match', said: 'Subs click complete, usually only after their inspection passes ("99% of them don\'t even click complete until the inspection is passed"). The 2019 database guide tells subs the same.', cite: '[M 45:10] [DB procedures 2019]' },
    { n: 4, old: 'Superintendent clicks pay if 100% complete', verdict: 'match', said: '"Check everything before you click off on the work orders." WOs pay in draws, not lump sums; framers, plumbers, electricians, AC must pass inspections before a draw; painter/trim are checked visually and also have touch-up draws.', cite: '[M 30:19, 44:44–46:10]' },
    { n: 5, old: 'PM or DOC approves work order', verdict: 'changed', said: 'Maria approves as super, PM and DOC. Jim: PM "makes sure it\'s done"; DOC was "just final approval, so they know what\'s going on". There is no second approver today (gap).', cite: '[J 10/12]' },
    { n: 6, old: 'Is work order approved?', verdict: 'match', said: 'Same decision; made by Maria alone.', cite: '[J 10/12]' },
    { n: 7, old: 'If yes: goes to Accounting Assistant inbox for payment', verdict: 'match', said: 'Accounting enters in QuickBooks and marks paid in the database (handoff); the 2019 guide refers subs to the "Accounts Payable letter" for payment status (inference that this is still the path).', cite: '[Handoff §02] [DB procedures 2019]' },
    { n: 8, old: 'If no: PM types note and disapproves', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 9, old: 'Subcontractor logs in to fix issue', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 10, old: 'Superintendent verifies completion and approves', verdict: 'not_mentioned', said: 'Implied by step 4; not separately described.', cite: '' },
  ],
  'hub-budget_revision': [
    { n: 1, old: 'Superintendent reviews bid/quote against budget', verdict: 'match', said: 'Maria "reviews bid/quotes against budget, forwards to Jim if over budget".', cite: '[HUB 10/20] [J 10/12]' },
    { n: 2, old: 'Is amount greater than budget?', verdict: 'match', said: 'Jim: "I\'m supposed to approve it if it goes over budget."', cite: '[J 10/12]' },
    { n: 3, old: 'If no: Superintendent enters amount as work order', verdict: 'match', said: 'Within budget, Maria can schedule, submit and send a WO to the sub without anyone approving first.', cite: '[J 10/12]' },
    { n: 4, old: 'If yes: forward bid/quote to DOC for review with explanation', verdict: 'changed', said: 'Goes to Jim, not a DOC: "the budget has to be increased, and I\'d have to approve the budget increase, and they\'d have to explain why."', cite: '[J 10/12]' },
    { n: 5, old: 'Is bid/quote approved for entry?', verdict: 'match', said: 'Jim decides.', cite: '[J 10/12]' },
    { n: 6, old: 'If no: request better pricing / additional bids', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 7, old: 'If yes: DOC modifies database budget', verdict: 'changed', said: 'Jim wants the database to refuse a WO/PO that exceeds the budget; today it allows it. Who edits the budget line after approval was not stated (gap).', cite: '[J 10/12]' },
    { n: 8, old: 'DOC logs overage into budget revision log', verdict: 'no_longer', said: 'Crossed off by Maria: "[N/A] Logs overage into budget revision log".', cite: '[HUB 10/20]' },
    { n: 9, old: 'DOC prints budget revision log weekly for tactical meeting', verdict: 'no_longer', said: 'Crossed off: "[N/A] Prints budget revision log each week".', cite: '[HUB 10/20]' },
    { n: 10, old: 'President reviews and approves budget revision log', verdict: 'changed', said: 'Jim approves increases one at a time, with the reason; no weekly log.', cite: '[J 10/12]' },
    { n: 11, old: 'DOC forwards budget revision log to CFO', verdict: 'no_longer', said: 'Crossed off: "[N/A] Forwards budget revision log to Kenneth".', cite: '[HUB 10/20]' },
    { n: 12, old: 'CFO updates QuickBooks with revised numbers', verdict: 'not_mentioned', said: 'Kenneth\'s hub list still says "Updates QuickBooks with revised budget numbers" — unconfirmed.', cite: '[HUB 10/20]' },
    { n: 13, old: 'Superintendent enters WO once DOC modifies budget', verdict: 'match', said: 'WO only after the budget is increased and approved.', cite: '[J 10/12]' },
    { n: 14, old: 'DOC/Super cannot enter WO without approval', verdict: 'match', said: 'Jim\'s rule; the database does not enforce it.', cite: '[J 10/12]' },
    { n: 15, old: 'If budget change not approved: goes to President', verdict: 'match', said: 'Jim is the approver.', cite: '[J 10/12]' },
    { n: 'new', old: '', verdict: 'new', said: 'Jim\'s rules: budgets must be accurate ($7,200 item = $7,200 budget, not $10,000); no moving leftover money between budget lines; changes only through a budget increase with a reason; code overruns as variance (.1), change order (.2) or customer selection (.3) on cost-plus jobs.', cite: '[J 10/12]' },
  ],
  'hub-change_order_budget': [
    { n: 1, old: 'Change order is approved by buyer', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 2, old: 'DOC reviews database inbox daily for approved change orders', verdict: 'no_longer', said: 'Crossed off: "[N/A] Reviews database inbox daily for approved change orders".', cite: '[HUB 10/20]' },
    { n: 3, old: 'DOC logs change order into change order budget log', verdict: 'no_longer', said: 'Crossed off: "[N/A] Logs change orders into change order budget log".', cite: '[HUB 10/20]' },
    { n: 4, old: 'DOC prints copy of log weekly', verdict: 'no_longer', said: 'Crossed off: "[N/A] Prints log copies weekly for tactical meeting".', cite: '[HUB 10/20]' },
    { n: 5, old: 'President reviews change order log', verdict: 'not_mentioned', said: 'Jim: change orders are coded .2; no log mentioned.', cite: '[J 10/12]' },
    { n: 6, old: 'DOC forwards change order log to CFO', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 7, old: 'President enters change order budgets into QuickBooks', verdict: 'not_mentioned', said: 'Still on Jim\'s hub list; unconfirmed.', cite: '[HUB 10/20]' },
    { n: 8, old: 'DOC forwards reviewed log to CA', verdict: 'no_longer', said: 'No CA.', cite: '[HUB 10/20]' },
    { n: 9, old: 'DOP enters change order budgets into database', verdict: 'not_mentioned', said: 'Hub 10/20 lists "(Purchasing) Determines price/value to customer for change orders" under Maria; entering the budget was not discussed.', cite: '[HUB 10/20]' },
  ],
  'hub-budget_review': [
    { n: 1, old: 'Accounting updates budgets weekly', verdict: 'not_mentioned', said: 'Brittany\'s hub list has "WEEKLY: Database QB WO/PO Import"; unconfirmed that budgets are refreshed weekly.', cite: '[HUB 10/20]' },
    { n: 2, old: 'Reports saved to Public Drive > Weekly Download', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 3, old: 'Superintendent reviews budget as they process AP', verdict: 'match', said: 'Maria checks bids against budget before writing a WO.', cite: '[J 10/12] [HUB 10/20]' },
    { n: 4, old: 'Budget defines cost of home and sales price', verdict: 'not_mentioned', said: '', cite: '' },
    { n: 5, old: 'Each line item sets limit on WOs, invoices, POs', verdict: 'changed', said: 'Intended rule; Jim says the database currently lets an over-budget WO/PO through and the budgets are "pretty loose".', cite: '[J 10/12]' },
    { n: 6, old: 'Overages to $1,000 approved by Mark; over $1,000 by Jim', verdict: 'changed', said: 'No "Mark" today. Jim approves over-budget items; his hub line says "Approves over $1,000 budget overages" — whether a sub-$1,000 overage needs anyone\'s approval is unconfirmed.', cite: '[J 10/12] [HUB 10/20]' },
    { n: 7, old: 'Budget used to check account coding', verdict: 'not_mentioned', said: '', cite: '' },
  ],
  'hub-permitting': [
    { n: '1–23', old: 'Precon start → CA handles impact-fee check request, permitting company pick-up, rescheck, precon start log, permit delivery, permit rack', verdict: 'changed', said: 'Maria does permitting herself and submits to the city ("all of this I will have had submitted to the city"). Permits can be pulled any time; impact fees and permit fees are paid only when construction is about to start. Rescheck/energy is one of the per-address items. The precon start log was crossed off ("[N/A] Reviews precon start log daily"). No permitting company or CA was mentioned. Hub 10/20 reassigns "Handles all permitting coordination" and "Manages permit card filing" to James — unconfirmed.', cite: '[M 9:25–10:16, 14:23–16:20] [HUB 10/20]' },
    { n: 'new', old: '', verdict: 'new', said: 'Villas: master plans 3, 3A, 4, 4A are city-approved (2017/2018); per address you submit plot plan, energy, city forms — Maria has the list and is writing a full step-by-step permit document. 7 of the 15 remaining lots have permits approved or almost complete (some need only impact fees); the folders with status and approved documents are in her office. Landing: all masters approved; submitted as "repeats"; she is aligning the plan reviewers by Tuesday.', cite: '[M 7:42–8:03, 9:25, 10:42–11:24, 15:45–16:20]' },
    { n: '24–29', old: 'DOP assembles start packet; DOC fills start memo, distributes, updates status', verdict: 'no_longer', said: 'Crossed off: "[N/A] Fills out start date and super on start memo", "[N/A] Distributes start packet and start memo". Hub 10/20 moves "(Purchasing) Puts together construction start packet" under Maria — contradictory; unconfirmed.', cite: '[HUB 10/20]' },
    { n: '30–32', old: 'Super verifies HOA/ROCC approval before start', verdict: 'not_mentioned', said: 'Still on Maria\'s hub list ("Verifies HOA approval prior to start of home"); not discussed.', cite: '[HUB 10/20]' },
    { n: '33–42', old: 'Redline meeting with buyer, master set #5, plan racks', verdict: 'not_mentioned', said: 'Villas are spec repeats; no redline meeting was described.', cite: '' },
    { n: 'new', old: '', verdict: 'new', said: 'Once the permit is in hand, release to the surveyor first; order of construction is summarized on the SOW Excel and Maria will write an order-of-construction document.', cite: '[M 11:40–12:17]' },
  ],
  'hub-start_packet': [
    { n: '1–24', old: 'DOP enters house, orders plan/soils/engineer, redlines, numbering, copies, CAD, truss bids', verdict: 'changed', said: 'For villa and Landing repeats the architectural and structural plans are already approved, so ordering plans, soils and engineering do not recur per lot. Hub 10/20 puts many of these "(Purchasing)" items under Maria (orders plan, soils, engineer, CAD, truss bids, spec writer, ESI IDs) — not discussed in the meeting; unconfirmed for custom homes.', cite: '[M 15:34–16:20] [HUB 10/20]' },
    { n: '25–29', old: 'Permit company sends to city; permit received; project number entered', verdict: 'changed', said: 'See Permitting: Maria submits to the city.', cite: '[M 14:23]' },
    { n: '30–37', old: 'Takeoff service; bids to subs; landscape drawing; HOA approvals', verdict: 'not_mentioned', said: 'Lumber takeoffs exist and are what the lumber company needs; who produces them was not stated.', cite: '[M 18:36]' },
    { n: '38–42', old: 'Verify budget; SPEC Writer; assign super; POs and WOs entered', verdict: 'changed', said: 'Maria verifies budget and enters POs/WOs herself; every WO/PO created for a reference house (e.g. 11602 Royal Parkside) must be created for every house, with new price, PO number and description.', cite: '[M 52:18–53:10] [J 10/12]' },
    { n: '43–47', old: 'Start packet initialed; ESI IDs; water meter; financing memo', verdict: 'not_mentioned', said: 'Start packet crossed off; utilities and financing memo not discussed.', cite: '[HUB 10/20]' },
  ],
  'hub-homebuilding': [
    { n: '1–13', old: 'Eleven phases with day counts (Estate / Villas / Custom), walk-through, closing', verdict: 'not_mentioned', said: 'Day counts were not confirmed. Maria will write a schedule document with durations ("how long the concrete takes") before she leaves.', cite: '[M 26:08–26:34]' },
    { n: 'new', old: '', verdict: 'new', said: 'Her schedule is a hand-written pencil calendar, not on a computer; it changes daily with weather, inspections, material delays and trade availability. 11603\'s schedule is current to about today and will be updated by Monday. "Somebody that knows how to build houses has to be on the job site scheduling"; James can be eyes in the field but a construction manager is needed.', cite: '[M 21:04–23:30]' },
    { n: 'new', old: '', verdict: 'new', said: 'Lead-time rules on the SOW Excel: windows ordered around lot scrape; cabinets ordered around foundation pour. Example: Eggersmann cabinets for 11603 not yet ordered; ordering next week delivers ~end of January, after the house is ready for them — sequence must be re-ordered to fill the gap.', cite: '[M 24:06–26:08]' },
    { n: 'new', old: '', verdict: 'new', said: 'Foundation sequence: concrete crew sets forms → plumber installs grounds → inspection → concrete crew does cables/rebar → electrician runs island power → pour. "Everything floating in the middle of the floor is done before concrete; everything inside the exterior walls is done at framing." The builder calls each trade for its next visit; trades come 3–4 times.', cite: '[M 46:36–48:53]' },
    { n: 'new', old: '', verdict: 'new', said: 'Main cause of delays today: trades cancel or will not start when checks are late — "as long as we keep the people paid on time, the schedules will be fine."', cite: '[M 29:23–29:57]' },
    { n: 'new', old: '', verdict: 'new', said: 'Punch-out happens throughout construction, not only at the end (missing fixtures, cover plates, bad sheetrock, paint touch-ups, trim out of square, doors). City inspections and finals run through the process.', cite: '[M 49:25–50:19]' },
  ],
  'hub-homebuyer_expectations': [
    { n: '13, 15, 16', old: 'Sales Executive schedules walk-throughs, acceptance meeting, orientation', verdict: 'changed', said: 'Maria does all walkthroughs today (James has joined her); a checklist exists and the homeowner signs it, punch items are listed; "that really can be done by sales for sure". For spec homes Pam sends punch items and Maria/Teresa walk the house.', cite: '[M 50:34–51:38]' },
    { n: '22', old: 'Warranty items via warranty request system; Customer Care contacts within 24 hours', verdict: 'changed', said: 'Requests come through the database portal to the person assigned as manager — currently Maria; see Warranty.', cite: '[M 1:03:24]' },
    { n: 'other', old: 'Contract, deposit, loan, selections, closing steps', verdict: 'not_mentioned', said: '', cite: '' },
  ],
  'hub-back_charge': [
    { n: '1–4', old: 'Super notes rework, gives trade chance to repair, negotiates, schedules', verdict: 'not_mentioned', said: 'Maria\'s hub list keeps "Notes rework items requiring back charges" and "Contacts trades that caused repairs, negotiates pricing"; crossed off: "[N/A] Reviews invoices on Friday morning, initials and notes backcharges".', cite: '[HUB 10/20]' },
    { n: '5–22', old: 'Invoice review Friday, backcharge form, DOC approval, Acct Asst credit in QuickBooks', verdict: 'not_mentioned', said: 'Hub 10/20 moves "Fills out database backcharges completely" and "Must notify subcontractors of backcharges" to James, and "Reviews invoices weekly and verifies backcharges were entered" to Kenneth — unconfirmed.', cite: '[HUB 10/20]' },
  ],
  'hub-interior_designer_selection': [
    { n: '1–8', old: 'CA packet to interior designer, notification form, tracking', verdict: 'no_longer', said: 'No CA. Selections involve Pam ("your mom is involved with selections"); Maria is working with Danielle on interior selections, pricing and bidding with new vendors to compare against Ferguson, the roofer, the cabinet maker.', cite: '[M 18:59–19:50]' },
    { n: '9–26', old: 'Designer selections, ROCC application and approval cycle', verdict: 'not_mentioned', said: '', cite: '' },
  ],
  'proc-warranty': [
    { n: 'new', old: 'Handoff: request, assignment, due date, evidence, closure (owner to confirm)', verdict: 'new', said: 'Homeowner logs a warranty request in the database portal → it emails the person assigned as manager (Maria today; Teresa must reassign in the database before Maria leaves) → read it, handle if under warranty. First year the subcontractor covers; manufacturer warranties vary (AC parts/labor) — Jim knows coverage. Not covered: tell the homeowner, offer a price, record it in the request\'s Notes for a paper trail. Volume is low.', cite: '[M 1:03:24–1:09:12]' },
  ],
  'proc-hoa': [
    { n: 'new', old: 'Handoff: separate service processes and financial records (owner to confirm)', verdict: 'new', said: 'Everything HOA goes to Teresa. When she decides the HOA is responsible she enters a warranty request under job ROCVTA with the address in the description; whoever builds at the villas looks at construction-related HOA repairs (fences, cracked walls). Trash stickers/signs are not construction.', cite: '[M 1:04:19–1:10:15]' },
  ],
};

// ---------- new procedures confirmed in the transcripts (no SOP existed) ----------
const NEW_TASKS = [
  { id: 'tr-leander-arc-review', title: 'Leander ARC architectural plan review', department_id: 'hoa', owner_id: 'maria', backup_id: 'teresa', proposed: 0, documented: 1, board: 'next',
    trigger: 'A Leander builder emails a master plan or an address-specific plan for ARC approval (about 5–6 per month).',
    steps: '1. Check the first prerequisites against the Leander design guidelines (e.g. no front-loaded garages, roof pitch per section 404); reject by email if a prerequisite is missing.\n2. For a master plan: review once; it repeats. For an address-specific plan: review the address items.\n3. Reply by email to the builder\'s submitter with approval or the reasons for rejection; Teresa is copied on every email.\nTime: about one hour per month.',
    inputs: 'Plans (full set, PDF). Leander design guidelines: Leander ARC folder under ARC/HOA documents; Maria\'s tabbed/highlighted paper copy in her office.',
    evidence: 'Approval/rejection email with Teresa copied.', source_link: 'Maria leaving folder → "Leander ARC Review" how-to (Public > Company information > MCH > Workflow processes)',
    verification_result: 'Confirmed current [M 0:03–6:11]. Written how-to exists; Maria will add the guidelines\' file path. Not on her previous responsibility list.',
    missing_info: 'Who takes it: Teresa (knows where everything is, cc\'d on all emails) or James — Maria did not know. Phase one of Leander almost done; lots from two builders remain.', next_action: 'Decide Teresa vs James; have the chosen person review the next submission with Maria.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-permit-per-address', title: 'Pull a permit for a villa / Landing lot (per-address submission)', department_id: 'permits', owner_id: 'maria', proposed: 0, documented: 0, board: 'working',
    trigger: 'A lot is chosen for a start (permits can be pulled ahead; fees are paid only when ready to start).',
    steps: 'Master plans are approved (villas: 3, 3A, 4, 4A; Landing: all masters). Per address submit the address-specific package to the city: plot plan, energy/rescheck, city forms (full list in Maria\'s workflow folder). Keep a folder per lot with permit status and approved documents. Pay impact fees and permit fees when construction is ready to start. Then release to the surveyor first.',
    inputs: 'Approved master plan set; plot plan; energy calc; city forms.', evidence: 'Permit in hand; folder per lot in Maria\'s office.',
    verification_result: 'Confirmed [M 9:25–11:40, 14:23–16:20]. 7 of 15 remaining villa lots permitted or nearly (some need only impact fees). Townhome buildings (2 fourplexes, plans 5 & 6) not permitted.',
    missing_info: 'The full step-by-step permit document is being written by Maria ("that\'s somebody going to have to, as they do it, have a full document"). Which 7 addresses are permitted was not listed. City contacts and submission portal not described. Landing plan-reviewer alignment due Tuesday 10/21.', next_action: 'Get the permit document and the per-lot folder status list from Maria; walk one per-address submission with her successor.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-bids-and-sqft-rates', title: 'Price a house: per-square-foot trades, bids, and when to send them', department_id: 'purchasing', owner_id: 'maria', backup_id: 'ernesto', proposed: 0, documented: 0, board: 'working',
    trigger: 'Lot and plan are known.',
    steps: 'Square-foot trades (framing, concrete, stucco, sheetrock, paint, trim) are priced by agreed $/sq ft × the trade\'s square footage (framer = total incl. garage/patios; sheetrock excludes balconies; trim = AC/living area). Electrical, plumbing, mechanical go out to bid but are consistent per plan. Send bids close to the start so prices do not rise before slab. Interior finishes cannot be priced until selections are done.',
    inputs: 'SOW Excel "necessary documents to provide" per trade; plan square footages per trade (Maria created this for Ernesto; location to confirm).',
    verification_result: 'Confirmed [M 12:41–13:36, 16:30–17:35, 36:37–40:02].',
    missing_info: 'Vendor list with current $/sq ft rates ("I will leave a good list of people to send the bids to"). Square footage per plan per trade — Maria will locate it. Hub 10/20 gives James "(Purchasing) Collects bids" / "Requests bid lists" — unconfirmed.', next_action: 'Get the vendor/rate list and the square-footage-by-trade sheet; add them to the villa plan spreadsheet.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-purchase-orders-materials', title: 'Create purchase orders from material bids', department_id: 'purchasing', owner_id: 'maria', backup_id: 'ernesto', proposed: 0, documented: 1, board: 'next',
    trigger: 'A material vendor sends a proposal/bid (lumber from takeoffs and structural plans; windows/doors; trusses; fixtures).',
    steps: '1. Scrutinize the bid: right material, right selection, quantity; ideally 2–3 vendors compared.\n2. Enter the PO from the bid including deposit terms; reference the quote number in the PO description.\n3. Draws on the PO match the bid\'s subtotals (e.g. lumber: first-floor walls, second-floor/stairs).\n4. Never modify the original PO; extras go on separate POs (e.g. "Lumber Extras").\n5. Save quotes under Public > Company Information > MCH > Properties > Current projects > ROCV > Homes under construction > phase > address > Purchasing > Work orders, change orders and proposals > Bids awarded (by vendor, by category).',
    verification_result: 'Confirmed [M 17:52–18:53, 43:04–43:44, 53:24–57:48].', missing_info: 'Whether Ernesto already does this for any job was not stated. Fixture quantities come from plans; ordered from Ferguson; new vendors being tried.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-field-verification-and-draws', title: 'Verify trade work before paying a draw', department_id: 'construction', owner_id: 'maria', proposed: 0, documented: 0, board: 'working',
    trigger: 'A subcontractor clicks complete on a work order draw.',
    steps: 'Walk the work before clicking pay. Trades with inspections (framer, plumber, electrician, AC) must pass before a draw. Foundation: walk it with the foundation plan; check plumbing grounds before pour; forms → grounds → makeup (cables/rebar) → island power → pour. Painter and trim have no inspection — check visually; use touch-up and final draws. Draws per trade are standard percentages (e.g. framer 40/10/40/10).',
    evidence: 'Inspection results; the pay click in the database.',
    verification_result: 'Confirmed [M 30:19, 43:44–48:53]. No written checklist exists ("you just know"); Maria recommends scopes of work for the foundation first.',
    missing_info: 'Scope-of-work / check-off lists per trade do not exist. Draw percentages per trade are in the database on past WOs (e.g. 11603 framer Dependable Builders) but not written down; the database "prefab work order" template exists but its draws are wrong (question for Sunny, IT).', next_action: 'Have Maria dictate the foundation and framing check-off lists; record draw percentages per trade from 11603\'s WOs.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-schedule-and-trade-coordination', title: 'Schedule a house and call trades for each visit', department_id: 'construction', owner_id: 'maria', proposed: 0, documented: 0, board: 'working',
    trigger: 'Permit in hand; surveyor released.',
    steps: 'Order of construction per SOW Excel (surveyor first). Keep the house schedule and re-plan daily around weather, inspections, deliveries and trade availability; when something slips, call and reschedule the other trades. Call each trade for its next visit (forms set → plumber grounds; grounds passed → concrete makeup; makeup done → electrician island). Order long-lead items on time: windows at lot scrape, cabinets at foundation pour.',
    verification_result: 'Confirmed [M 11:40–12:17, 21:04–26:34, 48:15–48:38]. Schedule is a pencil calendar; nothing on a computer; no completed schedule kept from past houses.',
    missing_info: 'Durations per phase ("how long the concrete takes") — Maria will finish a schedule document before leaving. 11603 schedule to be updated by Monday 10/19 and copied to Brittany. Whether ChatGPT can draft a base schedule from plans: Maria doubts it (no square footage/specs).', next_action: 'Photograph/copy the 11603 calendar; get the schedule-with-durations document.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-vendor-onboarding-insurance', title: 'Sign up a vendor/subcontractor and keep insurance current', department_id: 'purchasing', owner_id: 'maria', backup_id: 'james', proposed: 0, documented: 0, board: 'next',
    trigger: 'A new vendor/sub is used, or a certificate expires.',
    steps: 'New sub: subcontractor agreement, collect insurance, create their database login (so the database can email them work orders). Ongoing: check the insurance spreadsheet, send renewal reminders, give copies to Kenneth, update the database and the spreadsheet.',
    verification_result: 'Confirmed [M 59:33–1:02:21]. James has done the insurance update before; Teresa knows how to create logins; "really easy".',
    missing_info: 'Location of the insurance spreadsheet (Maria will send). Not on Maria\'s or Ernesto\'s task list — must be assigned (Maria suggests James or Kenneth/accounting). Hub 10/20 gives Ernesto "Maintain contractors liability insurance" and "Maintain W-9 on every vendor" — unconfirmed.', next_action: 'Assign to James (operational) with Kenneth checking before cutting checks; get the spreadsheet path.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-homeowner-walkthrough', title: 'Homeowner walkthrough and punch list', department_id: 'marketing', owner_id: 'maria', backup_id: 'james', proposed: 0, documented: 1, board: 'next',
    trigger: 'A house is sold / ready for walkthrough.', steps: 'Walk the whole house with the homeowner, show how everything works, use the checklist; list punch items; homeowner signs. Spec homes: Pam sends punch items; Maria or Teresa walks.',
    verification_result: 'Confirmed [M 50:34–51:38]. Checklist exists. James has attended. Maria: "can be done by sales for sure".', missing_info: 'Where the checklist is saved.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-cbusa-reporting', title: 'CBUSA reporting process', department_id: 'purchasing', owner_id: 'maria', backup_id: 'kenneth', proposed: 0, documented: 0, board: 'next',
    trigger: 'CBUSA reporting cycle (unknown).', steps: 'Not yet written — Maria: "I need to write a process for that because that I haven\'t done."',
    verification_result: 'Mentioned, not described [M 1:11:43–1:12:01].', missing_info: 'Everything: cadence, what is reported, portal, who. Hub 10/20: Kenneth "YEARLY: CBUSA Vendor Reporting"; Ernesto "Attend CB/USA meetings", "Use CB/USA vendor committee".', next_action: 'Ask Maria to write it or walk it on a recording.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-landing-frank-scope', title: 'Royal Oaks Landing: what we do vs what Frank does', department_id: 'construction', owner_id: 'maria', proposed: 0, documented: 0, board: 'working',
    trigger: 'Landing starts (repeats of approved masters).', steps: 'Word document of what Frank says he will do, with Maria\'s redlines; to be finalized by Monday/Tuesday 10/20–21.',
    verification_result: 'Mentioned [M 10:36–11:18, 41:00–41:54]. Who Frank is was not stated in this meeting (inference: a builder/contractor partner at Landing — confirm).', missing_info: 'Final document; Frank\'s role and contract; which Landing lots are next.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-selections-vendor-bidding', title: 'Interior selections pricing and new vendor bids (with Danielle)', department_id: 'design', owner_id: 'maria', backup_id: 'danielle', proposed: 0, documented: 0, board: 'working',
    trigger: 'Selections for a house; vendor comparison.', steps: 'Pam is involved in selections; fixture quantities come from the plans; ordered from Ferguson. Maria started 2–3 weeks ago getting bids from new vendors to compare against Ferguson, the roofer, the cabinet maker; working with Danielle on interior selection pricing/bidding. Brittany asked that these sessions be recorded on Teams.',
    verification_result: 'Confirmed in progress [M 18:59–20:40].', missing_info: 'New vendor list and bids; what Danielle will own.', source: 'Maria meeting 2026-10-16' },
  { id: 'tr-wo-approval-single-point', title: 'Work order approval has one approver (Maria as super, PM and DOC)', department_id: 'purchasing', owner_id: 'jim', proposed: 0, documented: 1, board: 'waiting', waiting_on: 'Jim',
    trigger: 'Every work order today.', steps: 'Jim confirmed Maria checks off as everything. Historically: purchasing writes WO/PO (office), PM confirms done, DOC final approval. Decide who approves after Maria leaves.',
    verification_result: 'Confirmed [J 10/12].', blocker: 'Decision needed: successor approval chain and whether Jim wants a second approver on WOs/POs over a threshold.', next_action: 'Jim decides the approval chain; configure database roles accordingly.', source: 'Jim call 2026-10-12' },
  { id: 'tr-database-budget-enforcement', title: 'Database should block WOs/POs that exceed budget; budgets must be accurate', department_id: 'estimating', owner_id: 'jim', backup_id: 'brittany', proposed: 0, documented: 1, board: 'next',
    trigger: 'Jim\'s rule, 2026-10-12.', steps: 'Budget lines set at actual expected cost. No moving money between lines. Over budget → budget increase approved by Jim with the reason. Code: .1 variance, .2 change order, .3 customer selections (cost-plus). The database currently allows over-budget WOs/POs — enforcement is a change request (Sunny / Efficient Computer Systems).',
    automation_approach: 'Deterministic: the budget-exceptions agent (rules sufficient) can flag any WO/PO whose cost-code total exceeds budget using the existing mch-budget-vs-actual logic until the database enforces it.',
    verification_result: 'Confirmed [J 10/12].', missing_info: 'Whether sub-$1,000 overages need approval; who edits the budget line once Jim approves.', source: 'Jim call 2026-10-12' },
];

// ---------- flow charts (rendered client-side from this structure) ----------
// node types: trigger | step | decision | handoff | end ; flags: gap | agent | authority ; status: confirmed | unconfirmed
const FLOWS = {
  'hub-work_order_ap': { title: 'Work order: from bid to payment (as done today)', nodes: [
    { id: 'a', type: 'trigger', label: 'Price agreed with sub ($/sq ft or bid)', owner: 'Maria', status: 'confirmed', cite: '[M 36:37]' },
    { id: 'b', type: 'decision', label: 'Within budget line?', owner: 'Maria', status: 'confirmed', flags: ['agent'], note: 'Budget-exceptions agent (rules) can pre-check; DB does not enforce', cite: '[J 10/12]' },
    { id: 'c', type: 'step', label: 'Budget increase request with reason → Jim approves', owner: 'Jim', status: 'confirmed', flags: ['authority'], cite: '[J 10/12]' },
    { id: 'd', type: 'step', label: 'Enter WO in database (labor only, paperless)', owner: 'Maria', status: 'confirmed', flags: ['gap'], note: 'No backup today; hub proposes James/Ernesto', cite: '[M 57:54] [HUB 10/20]' },
    { id: 'e', type: 'handoff', label: 'Database emails sub; sub accepts WO = price agreed', owner: 'Subcontractor', status: 'confirmed', cite: '[M 58:18–59:32]' },
    { id: 'f', type: 'step', label: 'Work done; sub clicks complete (after inspection passes)', owner: 'Subcontractor', status: 'confirmed', cite: '[M 45:10]' },
    { id: 'g', type: 'step', label: 'Walk the work / check inspection; click pay for the draw', owner: 'Maria (super)', status: 'confirmed', flags: ['authority', 'gap'], note: 'Physical acceptance stays human; no checklist exists', cite: '[M 30:19, 44:44]' },
    { id: 'h', type: 'step', label: 'PM + DOC approval (same person today)', owner: 'Maria', status: 'confirmed', flags: ['gap'], note: 'Single approver; successor chain undecided', cite: '[J 10/12]' },
    { id: 'i', type: 'handoff', label: 'To accounting inbox → QuickBooks → paid, marked in DB', owner: 'Brittany / Kenneth', status: 'unconfirmed', flags: ['agent'], note: 'Reconciliation agent (rules) matches DB vs QB', cite: '[Handoff §02]' },
    { id: 'j', type: 'end', label: 'Draw paid on time (late pay = schedule delays)', owner: '', status: 'confirmed', cite: '[M 29:23]' },
  ], edges: [['a', 'b'], ['b', 'c', 'no'], ['c', 'd'], ['b', 'd', 'yes'], ['d', 'e'], ['e', 'f'], ['f', 'g'], ['g', 'h'], ['h', 'i'], ['i', 'j']] },
  'hub-budget_revision': { title: 'Budget check and variance (Jim\'s rules)', nodes: [
    { id: 'a', type: 'trigger', label: 'Bid/quote received for a cost code', owner: 'Maria', status: 'confirmed', cite: '[HUB 10/20]' },
    { id: 'b', type: 'decision', label: 'Exceeds remaining budget?', owner: 'Maria', status: 'confirmed', flags: ['agent'], note: 'Rules: compare to budget vs actual + pending WO/PO', cite: '[J 10/12]' },
    { id: 'c', type: 'step', label: 'Write WO/PO; no approval needed', owner: 'Maria', status: 'confirmed', cite: '[J 10/12]' },
    { id: 'd', type: 'step', label: 'Explain why; request budget increase', owner: 'Maria', status: 'confirmed', cite: '[J 10/12]' },
    { id: 'e', type: 'decision', label: 'Jim approves increase?', owner: 'Jim', status: 'confirmed', flags: ['authority'], cite: '[J 10/12]' },
    { id: 'f', type: 'step', label: 'Code it: .1 variance / .2 change order / .3 selections', owner: '?', status: 'confirmed', flags: ['gap'], note: 'Who edits the budget line is unstated', cite: '[J 10/12]' },
    { id: 'g', type: 'step', label: 'Get better pricing / do not proceed', owner: 'Maria', status: 'unconfirmed', cite: '[old SOP step 6]' },
    { id: 'h', type: 'end', label: 'Never move money between lines', owner: '', status: 'confirmed', cite: '[J 10/12]' },
  ], edges: [['a', 'b'], ['b', 'c', 'no'], ['b', 'd', 'yes'], ['d', 'e'], ['e', 'f', 'yes'], ['e', 'g', 'no'], ['f', 'c'], ['c', 'h']] },
  'tr-permit-per-address': { title: 'Permit a villa / Landing lot', nodes: [
    { id: 'a', type: 'trigger', label: 'Lot chosen; master plan already city-approved', owner: 'Jim / Maria', status: 'confirmed', cite: '[M 15:34]' },
    { id: 'b', type: 'step', label: 'Assemble per-address package: plot plan, energy, city forms', owner: 'Maria', status: 'confirmed', flags: ['gap'], note: 'Full list only in Maria\'s folder; doc in progress', cite: '[M 15:45]' },
    { id: 'c', type: 'step', label: 'Submit to city; track status in lot folder', owner: 'Maria', status: 'confirmed', flags: ['gap', 'agent'], note: 'Permit-tracking agent (rules): due/expiry reminders', cite: '[M 9:25]' },
    { id: 'd', type: 'decision', label: 'Bank/Jim: ready to start?', owner: 'Jim', status: 'confirmed', flags: ['authority'], cite: '[M 9:22–11:40]' },
    { id: 'e', type: 'step', label: 'Pay impact fees + permit fees', owner: 'Accounting', status: 'confirmed', flags: ['authority'], note: 'Spending', cite: '[M 9:25]' },
    { id: 'f', type: 'handoff', label: 'Release permit → surveyor first', owner: 'Maria → surveyor', status: 'confirmed', cite: '[M 11:40]' },
    { id: 'g', type: 'end', label: 'Construction order per SOW Excel', owner: '', status: 'confirmed', cite: '[M 12:07]' },
  ], edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'c', 'not yet (hold)'], ['d', 'e', 'yes'], ['e', 'f'], ['f', 'g']] },
  'tr-field-verification-and-draws': { title: 'Foundation sequence and acceptance', nodes: [
    { id: 'a', type: 'trigger', label: 'Surveyor done; lot prepped', owner: 'Maria', status: 'confirmed', cite: '[M 11:40]' },
    { id: 'b', type: 'step', label: 'Concrete crew sets forms', owner: 'Concrete sub', status: 'confirmed', cite: '[M 47:22]' },
    { id: 'c', type: 'handoff', label: 'Call plumber: install grounds', owner: 'Maria → plumber', status: 'confirmed', flags: ['gap'], note: 'Only Maria knows the call sequence', cite: '[M 48:15]' },
    { id: 'd', type: 'decision', label: 'Grounds inspection passed? Builder checks plumbing vs plan', owner: 'Maria + inspector', status: 'confirmed', flags: ['authority'], cite: '[M 46:36]' },
    { id: 'e', type: 'step', label: 'Concrete crew: cables/rebar makeup', owner: 'Concrete sub', status: 'confirmed', cite: '[M 47:22]' },
    { id: 'f', type: 'step', label: 'Electrician runs island power', owner: 'Electrician', status: 'confirmed', cite: '[M 48:15]' },
    { id: 'g', type: 'step', label: 'Walk slab with foundation plan; then pour', owner: 'Maria', status: 'confirmed', flags: ['authority', 'gap'], note: 'No written checklist', cite: '[M 46:31]' },
    { id: 'h', type: 'end', label: 'Pay foundation draw', owner: 'Maria', status: 'confirmed', cite: '[M 30:19]' },
  ], edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'c', 'no — fix'], ['d', 'e', 'yes'], ['e', 'f'], ['f', 'g'], ['g', 'h']] },
  'proc-warranty': { title: 'Warranty request', nodes: [
    { id: 'a', type: 'trigger', label: 'Homeowner submits request in database portal', owner: 'Homeowner', status: 'confirmed', cite: '[M 1:03:24]' },
    { id: 'b', type: 'handoff', label: 'Database emails the assigned manager', owner: 'Maria today', status: 'confirmed', flags: ['gap'], note: 'Teresa must reassign in DB before Maria leaves', cite: '[M 1:03:24]' },
    { id: 'c', type: 'decision', label: 'Under warranty? (1st year sub; manufacturer terms vary)', owner: 'Successor; Jim knows', status: 'confirmed', flags: ['authority'], cite: '[M 1:06:43–1:07:17]' },
    { id: 'd', type: 'step', label: 'Have the sub/vendor fix it', owner: 'Successor', status: 'confirmed', cite: '[M 1:06:43]' },
    { id: 'e', type: 'step', label: 'Tell homeowner not covered; offer a price; note in request Notes', owner: 'Successor', status: 'confirmed', cite: '[M 1:07:46–1:08:22]' },
    { id: 'f', type: 'end', label: 'Request closed with paper trail', owner: '', status: 'confirmed', cite: '[M 1:08:01]' },
  ], edges: [['a', 'b'], ['b', 'c'], ['c', 'd', 'yes'], ['c', 'e', 'no'], ['d', 'f'], ['e', 'f']] },
  'tr-leander-arc-review': { title: 'Leander ARC plan review', nodes: [
    { id: 'a', type: 'trigger', label: 'Builder emails plan (master or address-specific)', owner: 'Builder', status: 'confirmed', cite: '[M 0:53]' },
    { id: 'b', type: 'decision', label: 'Prerequisites met? (e.g. no front-loaded garage)', owner: 'Maria → Teresa?', status: 'confirmed', flags: ['gap'], note: 'Successor undecided', cite: '[M 5:13]' },
    { id: 'c', type: 'step', label: 'Check against design guidelines (section 404 roof pitch, etc.)', owner: 'Reviewer', status: 'confirmed', cite: '[M 2:05]' },
    { id: 'd', type: 'step', label: 'Email rejection with reasons (Teresa cc)', owner: 'Reviewer', status: 'confirmed', cite: '[M 5:31–5:39]' },
    { id: 'e', type: 'end', label: 'Email approval (Teresa cc)', owner: 'Reviewer', status: 'confirmed', flags: ['authority'], cite: '[M 5:39]' },
  ], edges: [['a', 'b'], ['b', 'd', 'no'], ['b', 'c', 'yes'], ['c', 'e']] },
};

// ---------- active job status from the transcripts ----------
const HOME_STATUS = [
  { match: '11603 Royal Parkside Place', stage: 'Framing (inspections in progress)', permits: 'Permitted; under construction.', trades: 'Framer: Dependable Builders (draws 40/10/40/10). Lumber: BFS (original PO + Lumber Extras). Cabinets: Eggersmann — NOT ordered.', issues: 'Framing inspection found metal issue; plywood and walls started 10/16 instead of two days earlier. Material delay. If cabinets are ordered next week, delivery is ~end of January — later than the house will be ready; sequence must be re-planned.', next_milestone: 'Finish framing + pass framing inspections; decide cabinet order date; Maria to update the hand-drawn schedule by Mon 10/19 and give Brittany a copy.', cite: '[M 21:46–24:34, 36:13–36:53, 55:10–57:25]' },
  { match: '11602 Royal Parkside Place', stage: 'Reference house for WOs/POs (status not stated)', permits: 'Permitted; built or in progress (not stated).', trades: 'Every WO/PO created here must be created for every future house (new price/PO#/description).', issues: 'No schedule was kept for it.', next_milestone: 'Confirm construction status with Maria.', cite: '[M 27:56, 52:18–53:10]' },
];
const VILLAS_NOTE = { active_waiting: 'Villas (ROCV): 15 lots not started — 7 permitted or nearly (some need only impact fees), 8 are townhomes in two fourplex buildings (plans 5 & 6, not permitted). Remaining single-family plans are 3, 3A, 4, 4A only; master plans city-approved 2017/2018. Which 7 addresses are permitted was not listed (inference: the 10 Royal Oaks Run / Banner Way lots recorded 10/06 are among these 15 — confirm).', cite: '[M 7:02–8:52, 15:13–16:20]' };

// ---------- Maria handover items (sorted by no-backup first in the app) ----------
// backup: '' = nobody can do it today.  documented: yes | partial | no.  current: confirmed | unconfirmed.
const HANDOVER = [
  { id: 'ho-scheduling', item: 'Scheduling each house day-to-day and re-planning when something slips', basis: 'Transcript; hub "Develop, maintain, and update schedules"', documented: 'no', current: 'confirmed', backup: '', risk: 'high', capture: 'Copy/photo of the 11603 pencil calendar; her schedule document with durations per phase; order-of-construction doc; the lead-time rules (windows at lot scrape, cabinets at foundation pour).', cite: '[M 21:04–26:34]' },
  { id: 'ho-trade-calls', item: 'Calling each trade for its next visit in the right order (forms → grounds → makeup → island power → pour; "inside the floor before concrete, inside the walls at framing")', basis: 'Transcript', documented: 'no', current: 'confirmed', backup: '', risk: 'high', capture: 'Walk one house start with her successor; dictate the call sequence per phase.', cite: '[M 46:36–48:53]' },
  { id: 'ho-field-acceptance', item: 'Checking trade work before paying draws (foundation walk, plumbing before pour, framing after inspection, paint/trim visually)', basis: 'SOP work_order_ap step 4; transcript', documented: 'no', current: 'confirmed', backup: '', risk: 'high', capture: 'Check-off lists for foundation (first), framing, rough-ins; draw percentages per trade from 11603 WOs.', cite: '[M 30:19, 43:44–48:53]' },
  { id: 'ho-wo-approval', item: 'Approving work orders as superintendent, PM and DOC — single approver', basis: 'Jim 10/12', documented: 'partial (Jim\'s rules)', current: 'confirmed', backup: '', risk: 'high', capture: 'Jim decides the successor approval chain; database roles updated.', cite: '[J 10/12]' },
  { id: 'ho-permits', item: 'Permitting per address (villas, Landing) and tracking fee timing', basis: 'SOP permitting (changed); transcript', documented: 'in progress', current: 'confirmed', backup: '', risk: 'high', capture: 'The step-by-step permit document; per-lot folder status list (which 7 are permitted); city submission details; Landing plan-reviewer alignment.', cite: '[M 9:25–11:24, 14:23–16:20]' },
  { id: 'ho-work-orders', item: 'Creating work orders (per-sq-ft rates × trade square footage, draws) and sending bids at the right time', basis: 'SOP new_work_order (changed); transcript', documented: 'partial (SOW Excel, 2019 DB guide, past WOs)', current: 'confirmed', backup: 'James / Ernesto per hub 10/20 — unconfirmed', risk: 'high', capture: 'Vendor list with current $/sq ft; square footage per plan per trade; draw schedule per trade.', cite: '[M 36:37–40:02, 16:53–17:35]' },
  { id: 'ho-hoa-repairs', item: 'Construction-related HOA repairs at the villas (fences, cracked walls) when Teresa asks', basis: 'Transcript', documented: 'no', current: 'confirmed', backup: '', risk: 'medium', capture: 'Agree who the villa construction manager is for HOA items.', cite: '[M 1:09:24–1:10:15]' },
  { id: 'ho-warranty', item: 'Warranty requests (database portal → assigned manager)', basis: 'Transcript', documented: 'partial ("there\'s a warranty procedure")', current: 'confirmed', backup: 'Jim knows coverage; nobody assigned', risk: 'medium', capture: 'Teresa reassigns the manager in the database; location of the warranty procedure.', cite: '[M 1:03:24–1:09:12]' },
  { id: 'ho-cbusa', item: 'CBUSA reporting', basis: 'Transcript', documented: 'no', current: 'unconfirmed', backup: 'Kenneth (yearly vendor reporting per hub) — unconfirmed', risk: 'medium', capture: 'Maria writes or records the process.', cite: '[M 1:11:43]' },
  { id: 'ho-landing-frank', item: 'Landing: split of work with Frank; repeats submission', basis: 'Transcript', documented: 'in progress', current: 'confirmed', backup: '', risk: 'medium', capture: 'Final Word document; who Frank is and his contract; next Landing lots.', cite: '[M 10:36–11:18, 41:00–41:54]' },
  { id: 'ho-purchase-orders', item: 'POs from material bids; quote references; extras as separate POs; bids-awarded folders', basis: 'Transcript', documented: 'partial (folder structure + examples)', current: 'confirmed', backup: 'Ernesto (hub purchasing manager) — unconfirmed', risk: 'medium', capture: 'Confirm Ernesto can do a lumber PO from a takeoff end to end.', cite: '[M 17:52–18:53, 53:24–57:48]' },
  { id: 'ho-bids-vendors', item: 'Who to call for bids and relationships with trades', basis: 'Transcript', documented: 'no', current: 'confirmed', backup: 'Ernesto — unconfirmed', risk: 'medium', capture: '"A good list of people to send the bids to" with rates; new vendors being tried.', cite: '[M 18:59]' },
  { id: 'ho-punch-out', item: 'Punch-out during construction and before handover', basis: 'Transcript', documented: 'no', current: 'confirmed', backup: 'Pam / Teresa walk spec homes (different eyes)', risk: 'medium', capture: 'Her mental checklist (fixtures, cover plates, sheetrock, paint, trim, doors).', cite: '[M 49:25–51:38]' },
  { id: 'ho-selections', item: 'Interior selections pricing and new vendor bids', basis: 'Transcript', documented: 'no', current: 'confirmed', backup: 'Danielle / Pam', risk: 'medium', capture: 'New vendor list and bids; record sessions with Danielle.', cite: '[M 18:59–20:40]' },
  { id: 'ho-budget-check', item: 'Checking bids against budget; escalating over-budget to Jim', basis: 'Jim 10/12; hub', documented: 'partial', current: 'confirmed', backup: 'Jim decides; nobody else checks', risk: 'medium', capture: 'How she checks the remaining budget before a WO (database page? spreadsheet?).', cite: '[J 10/12]' },
  { id: 'ho-vendor-insurance', item: 'Vendor/sub onboarding, agreements, insurance tracking, database logins', basis: 'Transcript', documented: 'partial (spreadsheet exists)', current: 'confirmed', backup: 'James (has done it); Kenneth; Teresa (logins)', risk: 'low', capture: 'Spreadsheet path; assign an owner.', cite: '[M 59:33–1:02:21]' },
  { id: 'ho-walkthrough', item: 'Homeowner walkthroughs', basis: 'Transcript', documented: 'yes (checklist)', current: 'confirmed', backup: 'James has attended; sales can do it', risk: 'low', capture: 'Checklist location.', cite: '[M 50:34–51:12]' },
  { id: 'ho-leander', item: 'Leander ARC plan reviews (~1 h/month)', basis: 'Transcript', documented: 'yes (how-to in Maria leaving folder)', current: 'confirmed', backup: 'Teresa (cc\'d on all)', risk: 'low', capture: 'Guidelines file path; decide Teresa vs James.', cite: '[M 0:03–6:11]' },
  { id: 'ho-legacy-roles', item: 'Four absorbed legacy roles: DOC, Superintendent, PM, Construction Assistant', basis: 'Hub', documented: 'yes (legacy role documents)', current: 'unconfirmed', backup: '', risk: 'high', capture: 'Which of the 4 roles the replacement must cover vs which split to James/Ernesto/Teresa.', cite: '[HUB 10/06]' },
  { id: 'ho-crossed-off', item: '19 hub responsibilities Maria crossed off as [N/A] (logs, tactical-meeting printouts, start memo, bonus forms, mirrors, proforma)', basis: 'Hub 10/20', documented: 'n/a', current: 'confirmed no longer done', backup: 'not applicable — no longer done', risk: 'low', capture: 'Confirm none of them is still needed by Jim/Kenneth (e.g. proforma, budget revision log).', cite: '[HUB 10/20]' },
];

module.exports = { MEETINGS, STEP_REVIEWS, NEW_TASKS, FLOWS, HOME_STATUS, VILLAS_NOTE, HANDOVER };

// ---------- links between handover items, procedures and the documents Maria referred to ----------
// Placeholder documents are created for files that exist on the company drives but are not attached yet;
// Brittany uploads the real file from the handover panel when she has it.
const DOC_PLACEHOLDERS = [
  { id: 'doc-homeowner-walkthrough-checklist', title: 'Homeowner walkthrough checklist', kind: 'procedure', summary: 'The checklist used at homeowner walkthroughs; homeowner signs it and punch items are listed on it. Location not stated.', cite: '[M 50:50–51:12]', task_id: 'tr-homeowner-walkthrough' },
  { id: 'doc-sow-excel', title: 'SOW Excel (scope of work / order of construction / documents to provide / lead times)', kind: 'reference', summary: 'Lists necessary documents per trade for bidding, order of construction, and lead-time notes (windows at lot scrape, cabinets at foundation pour). Now in OneDrive; a "Purchasing" folder under "Maria leaving" was proposed.', cite: '[M 11:40–13:36, 25:24–27:21]', task_id: 'tr-bids-and-sqft-rates' },
  { id: 'doc-leander-arc-howto', title: 'Leander ARC Review how-to', kind: 'procedure', summary: 'Word document in Public > Company information > MCH > Workflow processes > "Maria leaving" folder, describing master and address-specific plan approvals. Maria will add the guidelines file path.', cite: '[M 0:14–3:16]', task_id: 'tr-leander-arc-review' },
  { id: 'doc-permit-stepbystep', title: 'Permit process step-by-step (being written)', kind: 'procedure', summary: 'Maria: "I\'m typing a big document for everything because there\'s a lot to that." Per-address submission list to be in the workflow folder.', cite: '[M 9:25, 15:45]', task_id: 'tr-permit-per-address' },
  { id: 'doc-11603-schedule', title: '11603 Royal Parkside schedule (pencil calendar → copy)', kind: 'reference', summary: 'Hand-drawn calendar, current to ~10/16; Maria to update by Monday and give Brittany a copy. No digital version exists.', cite: '[M 21:46–22:40]', task_id: 'tr-schedule-and-trade-coordination' },
  { id: 'doc-schedule-durations', title: 'Schedule document with phase durations (being written)', kind: 'procedure', summary: 'How long concrete, foundation, plumbing etc. take; Maria will finish before leaving.', cite: '[M 26:34]', task_id: 'tr-schedule-and-trade-coordination' },
  { id: 'doc-insurance-spreadsheet', title: 'Subcontractor insurance tracking spreadsheet', kind: 'reference', summary: 'Maria checks it, sends reminders, gives copies to Kenneth; location to be sent.', cite: '[M 59:33–1:00:35]', task_id: 'tr-vendor-onboarding-insurance' },
  { id: 'doc-warranty-procedure', title: 'Warranty procedure', kind: 'procedure', summary: '"There\'s a warranty procedure" — location not stated.', cite: '[M 1:03:24]', task_id: 'proc-warranty' },
  { id: 'doc-frank-scope', title: 'Landing: what we do vs what Frank does (Word, with Maria\'s redlines)', kind: 'plan', summary: 'Shared in Teams chat with Brittany and James; to be finalized by Mon/Tue.', cite: '[M 41:00–41:54]', task_id: 'tr-landing-frank-scope' },
  { id: 'doc-vendor-rate-list', title: 'Vendor list with $/sq ft rates (to be left by Maria)', kind: 'reference', summary: '"I will leave a good list of people at least to send the bids to." Plus square footage per plan per trade (created for Ernesto; location unknown).', cite: '[M 18:59, 39:25]', task_id: 'tr-bids-and-sqft-rates' },
  { id: 'doc-foundation-checklist', title: 'Foundation / framing check-off lists (do not exist yet)', kind: 'procedure', summary: 'No written check-off lists exist; Maria recommends the foundation first. To be dictated.', cite: '[M 44:02–46:36]', task_id: 'tr-field-verification-and-draws' },
];
const HANDOVER_LINKS = {
  'ho-scheduling': { tasks: ['tr-schedule-and-trade-coordination', 'hub-homebuilding'], docs: ['doc-11603-schedule', 'doc-schedule-durations', 'doc-sow-excel'] },
  'ho-trade-calls': { tasks: ['tr-schedule-and-trade-coordination', 'tr-field-verification-and-draws'], docs: ['doc-sow-excel'] },
  'ho-field-acceptance': { tasks: ['tr-field-verification-and-draws', 'hub-work_order_ap'], docs: ['doc-foundation-checklist'] },
  'ho-wo-approval': { tasks: ['tr-wo-approval-single-point', 'hub-work_order_ap'], docs: [] },
  'ho-permits': { tasks: ['tr-permit-per-address', 'hub-permitting'], docs: ['doc-permit-stepbystep'] },
  'ho-work-orders': { tasks: ['tr-bids-and-sqft-rates', 'hub-new_work_order', 'obs-procedures-for-the-mch-database'], docs: ['doc-vendor-rate-list', 'doc-sow-excel', 'doc-procedures-for-the-mch-database'] },
  'ho-hoa-repairs': { tasks: ['proc-hoa'], docs: [] },
  'ho-warranty': { tasks: ['proc-warranty'], docs: ['doc-warranty-procedure'] },
  'ho-cbusa': { tasks: ['tr-cbusa-reporting'], docs: [] },
  'ho-landing-frank': { tasks: ['tr-landing-frank-scope'], docs: ['doc-frank-scope'] },
  'ho-purchase-orders': { tasks: ['tr-purchase-orders-materials'], docs: [] },
  'ho-bids-vendors': { tasks: ['tr-bids-and-sqft-rates', 'hub-new_work_order'], docs: ['doc-vendor-rate-list'] },
  'ho-punch-out': { tasks: ['tr-punch-out'], docs: [] },
  'ho-selections': { tasks: ['tr-selections-vendor-bidding', 'hub-interior_designer_selection'], docs: [] },
  'ho-budget-check': { tasks: ['hub-budget_revision', 'tr-database-budget-enforcement', 'hub-budget_review'], docs: [] },
  'ho-vendor-insurance': { tasks: ['tr-vendor-onboarding-insurance'], docs: ['doc-insurance-spreadsheet'] },
  'ho-walkthrough': { tasks: ['tr-homeowner-walkthrough', 'hub-homebuyer_expectations'], docs: ['doc-homeowner-walkthrough-checklist'] },
  'ho-leander': { tasks: ['tr-leander-arc-review'], docs: ['doc-leander-arc-howto'] },
  'ho-legacy-roles': { tasks: [], docs: ['doc-legacy-role-doc', 'doc-legacy-role-superintendent', 'doc-legacy-role-project-mgr', 'doc-legacy-role-construction-asst'] },
  'ho-crossed-off': { tasks: [], docs: [] },
};
const EXTRA_TASKS = [
  { id: 'tr-punch-out', title: 'Punch-out during construction and before handover', department_id: 'quality', owner_id: 'maria', backup_id: 'pam', proposed: 0, documented: 0, board: 'next',
    trigger: 'Continuous during construction; a final pass before handover; for spec homes whenever Pam sends punch items.',
    steps: 'Walk the house at each stage and look for: missing fixtures, missing cover plates, bad sheetrock, paint touch-ups, trim out of square, doors that do not close — fix as you go, do not leave it all for the end. Final: everything done and looks right, as if handing to a homeowner. City inspections and finals run through the process. Office people (Pam, Teresa) walking the house is useful as a different set of eyes.',
    verification_result: 'Confirmed [M 49:25–51:38]. No written check sheet exists ("you just know").', missing_info: 'A stage-by-stage check sheet (after sheetrock, after paint, after trim, final). Where Pam\'s punch items are sent/kept.', next_action: 'Record one walk of 11603 with Maria narrating; turn it into the check sheet.', source: 'Maria meeting 2026-10-16 (transcript)' },
];
const EXTRA_FLOWS = {
  'tr-punch-out': { title: 'Punch-out', nodes: [
    { id: 'a', type: 'trigger', label: 'A stage completes (sheetrock, paint, trim…) or Pam sends punch items', owner: 'Maria / Pam', status: 'confirmed', cite: '[M 49:25, 51:25]' },
    { id: 'b', type: 'step', label: 'Walk the house: fixtures, cover plates, sheetrock, paint, trim, doors', owner: 'Maria', status: 'confirmed', flags: ['gap'], note: 'No check sheet; only Maria knows what to look for', cite: '[M 49:54]' },
    { id: 'c', type: 'decision', label: 'Anything wrong?', owner: 'Maria', status: 'confirmed', cite: '[M 50:19]' },
    { id: 'd', type: 'handoff', label: 'Tell the trade; rework before the next draw', owner: 'Maria → trade', status: 'confirmed', flags: ['authority'], note: 'Draw held until fixed', cite: '[M 43:44–44:00]' },
    { id: 'e', type: 'step', label: 'Final pass + city finals before handover', owner: 'Maria', status: 'confirmed', cite: '[M 49:25]' },
    { id: 'f', type: 'end', label: 'Ready for homeowner walkthrough', owner: '', status: 'confirmed', cite: '[M 50:34]' },
  ], edges: [['a', 'b'], ['b', 'c'], ['c', 'd', 'yes'], ['d', 'b', 'recheck'], ['c', 'e', 'no'], ['e', 'f']] },
  'tr-homeowner-walkthrough': { title: 'Homeowner walkthrough', nodes: [
    { id: 'a', type: 'trigger', label: 'House sold / ready; walkthrough scheduled', owner: 'Sales', status: 'confirmed', cite: '[M 50:34]' },
    { id: 'b', type: 'step', label: 'Walk the whole house with the homeowner; show how everything works', owner: 'Maria (James attends)', status: 'confirmed', flags: ['gap'], note: 'Maria does all of them today; sales could', cite: '[M 50:34–50:50]' },
    { id: 'c', type: 'step', label: 'Fill the checklist; list punch items', owner: 'Maria', status: 'confirmed', cite: '[M 50:50]' },
    { id: 'd', type: 'step', label: 'Homeowner signs', owner: 'Homeowner', status: 'confirmed', flags: ['authority'], note: 'Acceptance', cite: '[M 51:00]' },
    { id: 'e', type: 'handoff', label: 'Punch items to trades; fixed before closing', owner: 'Maria → trades', status: 'unconfirmed', cite: '[old SOP step 15]' },
    { id: 'f', type: 'end', label: 'Closing; warranty portal access', owner: '', status: 'unconfirmed', cite: '[old SOP steps 17–22]' },
  ], edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f']] },
};
const HANDOVER_WHY = {
  'ho-wo-approval': 'A work-order process exists (Work Order AP SOP, 2006, and the 2019 database guide) and Maria follows it. What is missing is not the steps — it is the people: the SOP has three approvers (Superintendent clicks pay, PM confirms, DOC gives final approval) and Jim confirmed Maria is all three today. When she leaves, nobody is named for any of them, and the database roles still point at her. Also unreviewed from the SOP: steps 8–10 (what happens when a WO is disapproved).',
  'ho-scheduling': 'No schedule process exists in writing. The old Homebuilding SOP has phase day-counts nobody confirmed; Maria\'s actual schedule is a pencil calendar she re-plans daily and does not keep. A successor has nothing to start from.',
  'ho-trade-calls': 'Not in any SOP. The order in which trades are called back (forms → grounds → makeup → island power → pour) exists only as Maria\'s knowledge; the old Start Packet / Homebuilding SOPs never describe it.',
  'ho-field-acceptance': 'The Work Order AP SOP says "Superintendent clicks pay if 100% complete" but never says how completion is checked. Maria confirmed there is no check sheet; she walks it and knows. The foundation walk before pour is the riskiest unwritten check.',
  'ho-permits': 'The Permitting SOP (2004) describes a CA, a permitting company and a precon log that no longer exist. Maria submits per address to the city herself; she is writing the real step-by-step now. Seven villa lots are part-way through and only her folders show where.',
  'ho-work-orders': 'The New Work Order SOP (2006) assumes a CA, a PM and a Purchasing Manager. Today Maria prices by $/sq ft × trade square footage with standard draws and writes the WO herself. The rates, the square-footage-per-plan sheet and the draw percentages are not written anywhere a successor could find.',
  'ho-hoa-repairs': 'Not in any SOP. Teresa decides HOA responsibility and files it as a warranty request under ROCVTA; the construction-side fix is Maria\'s by default with nobody else named.',
  'ho-warranty': 'The handoff has a warranty placeholder "owner to confirm". The real mechanism (portal request → emailed to the assigned manager) is confirmed, but the manager in the database is Maria and the written procedure\'s location is unknown.',
  'ho-cbusa': 'Not in any SOP; Maria said she still has to write it. The hub assigns the yearly vendor report to Kenneth, unconfirmed.',
  'ho-landing-frank': 'Landing has no SOP of its own; the repeat submissions and the split of work with Frank exist only in a Word document Maria is still redlining.',
  'ho-purchase-orders': 'The old SOPs mention POs only as a line ("purchase orders entered by purchasing"). Maria confirmed the real rules (bid scrutiny, quote number on PO, never modify the original, extras as separate POs, folder structure). Ernesto is the hub\'s purchasing manager but it is unconfirmed he has done one end to end.',
  'ho-bids-vendors': 'The SOP says "send plans to subcontractors for bidding" — but which subs, at what rates, and when to send them (price timing) is Maria\'s judgment. She promised to leave a list.',
  'ho-punch-out': 'No SOP covers punch-out during construction. Maria does it continuously by eye; there is no check sheet. (The homeowner walkthrough checklist is a different, documented thing.)',
  'ho-selections': 'The Interior Designer Selection SOP (2005) describes a CA and ROCC packets that are gone. The current practice (Pam involved, Maria pricing with new vendors, Danielle starting) was only described in the meeting and is in flux.',
  'ho-budget-check': 'The Budget Revision SOP exists and Jim confirmed its rules on 10/12. What is missing: the database does not enforce them, the logs were crossed off, and only Maria checks a bid against the remaining budget before a WO — how she checks it was not described.',
  'ho-vendor-insurance': 'Not on anyone\'s task list (Maria said so). The spreadsheet exists; the owner does not. James and Kenneth can both do it.',
  'ho-walkthrough': 'Documented and others can do it; it is here only because Maria does every walkthrough today. Low effort to hand over.',
  'ho-leander': 'Documented (how-to exists) and Teresa is copied on everything; only the decision of who takes it is open. Not on Maria\'s old responsibility list at all.',
  'ho-legacy-roles': 'The hub shows Maria absorbed four former positions. Nothing says which of those a replacement must cover versus which parts move to James, Ernesto or Teresa — that decision shapes the job description.',
  'ho-crossed-off': 'Housekeeping: Maria crossed these off herself. Listed so Jim/Kenneth can confirm none is still wanted (e.g. the proforma, the budget revision log).',
};
module.exports.HANDOVER_WHY = HANDOVER_WHY;
module.exports.DOC_PLACEHOLDERS = DOC_PLACEHOLDERS; module.exports.HANDOVER_LINKS = HANDOVER_LINKS; module.exports.EXTRA_TASKS = EXTRA_TASKS; module.exports.EXTRA_FLOWS = EXTRA_FLOWS;
