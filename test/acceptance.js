// Stage 1 acceptance checks. Spawns the server on a temp data dir, exercises the API, restarts it, checks persistence.
// Run: npm test
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');

const PORT = 8799, B = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mow-test-'));
const env = { ...process.env, MOW_PORT: String(PORT), MOW_DATA_DIR: dataDir, MOW_N8N_SECRET: 's3cret' };
let proc;
function start() { return new Promise(res => { proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] }); proc.stdout.on('data', d => { if (String(d).includes('http://localhost')) res(); }); }); }
function stop() { return new Promise(res => { proc.on('exit', res); proc.kill(); }); }
let cookie = '';
async function call(method, p, body, headers = {}) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const results = [];
async function check(name, fn) { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' — ' + e.message]); } }

(async () => {
  await start();
  const creds = JSON.parse(fs.readFileSync(path.join(dataDir, 'credentials.json'), 'utf8'));
  await check('login as admin', async () => { const r = await call('POST', '/api/login', { passphrase: creds.admin }); assert.equal(r.body.role, 'admin'); });
  // Real job ids from the registry; an id that is not a job is refused, so these cannot be made up.
  let JOB, JOB2;
  await check('jobs resolve to real registry ids', async () => {
    const homes = (await call('GET', '/api/state')).body.homes.filter(h => h.active === 'active');
    assert.ok(homes.length >= 2); JOB = homes[0].id; JOB2 = homes[1].id;
    assert.match(JOB, /^job-/);
  });
  await check('seeded confirmed people and proposed agents', async () => { const s = (await call('GET', '/api/state')).body; assert.equal(s.people.length, 11, 'Lonnie joined on 3 November; Unclassified is a holder, not a person');
    const un = s.people.find(p => p.id === 'unclassified');
    assert.match(un.notes, /UNCLASSIFIED — not a person/, 'it is clearly not somebody'); assert.equal(s.people.find(p => p.id === 'ernesto').reports_to, 'maria'); assert.equal(s.people.find(p => p.id === 'brittany').title, 'Accounting Assistant'); assert.equal(s.agents.length, 15, 'vendor compliance agent added 4 November'); assert.ok(s.agents.every(a => a.proposed === 1)); assert.ok(s.tasks.filter(t => t.proposed).length >= 13); });
  await check('new task persists', async () => { const r = await call('POST', '/api/tasks', { title: 'Acceptance task', owner_id: 'maria', board: 'next' }); assert.equal(r.status, 200); assert.equal(r.body.id, 'acceptance-task'); });
  await check('setup milestone changes visual state', async () => { await call('POST', '/api/agents/agent-budget-exceptions', { setup_stage: 'ready' }); const s = (await call('GET', '/api/state')).body; const a = s.agents.find(a => a.id === 'agent-budget-exceptions'); assert.equal(a.setup_stage, 'ready'); assert.equal(a.runtime.status, 'idle', 'ready-but-idle'); assert.ok(s.events.some(e => e.entity_id === 'agent-budget-exceptions' && e.kind === 'setup' && e.source === 'manual')); });
  await check('documented/automated/verified are distinct', async () => { await call('POST', '/api/tasks/acceptance-task', { documented: 1 }); let t = (await call('GET', '/api/state')).body.tasks.find(t => t.id === 'acceptance-task'); assert.deepEqual([t.documented, t.automated, t.verified], [1, 0, 0]); });
  await check('webhook rejects bad secret', async () => { const r = await call('POST', '/api/webhooks/n8n', { agent_id: 'agent-budget-exceptions' }, { Cookie: '' }); assert.equal(r.status, 401); });
  await check('real workflow event starts animation (running) and ends it', async () => {
    let r = await call('POST', '/api/webhooks/n8n', { agent_id: 'agent-budget-exceptions', execution_id: 'e1', status: 'started', label: 'Check budgets' }, { 'X-MOW-Secret': 's3cret' }); assert.equal(r.body.deduplicated, false);
    let a = (await call('GET', '/api/state')).body.agents.find(a => a.id === 'agent-budget-exceptions'); assert.equal(a.runtime.status, 'running'); assert.equal(a.runtime.source, 'n8n');
    r = await call('POST', '/api/webhooks/n8n', { agent_id: 'agent-budget-exceptions', execution_id: 'e1', status: 'finished', label: 'Check budgets' }, { 'X-MOW-Secret': 's3cret' });
    a = (await call('GET', '/api/state')).body.agents.find(a => a.id === 'agent-budget-exceptions'); assert.equal(a.runtime.status, 'idle');
  });
  await check('duplicate events are ignored', async () => { const r = await call('POST', '/api/webhooks/n8n', { agent_id: 'agent-budget-exceptions', execution_id: 'e1', status: 'finished' }, { 'X-MOW-Secret': 's3cret' }); assert.equal(r.body.deduplicated, true); });
  await check('failure stays visible', async () => { await call('POST', '/api/webhooks/n8n', { agent_id: 'agent-trade-commitments', execution_id: 'e2', status: 'failed', label: 'Sheet missing' }, { 'X-MOW-Secret': 's3cret' }); const a = (await call('GET', '/api/state')).body.agents.find(a => a.id === 'agent-trade-commitments'); assert.equal(a.runtime.status, 'failed'); });
  await check('interrupted run shows as stale', async () => { const old = new Date(Date.now() - 45 * 60000).toISOString(); await call('POST', '/api/webhooks/n8n', { agent_id: 'agent-purchasing', execution_id: 'e3', status: 'started', ts: old }, { 'X-MOW-Secret': 's3cret' }); const a = (await call('GET', '/api/state')).body.agents.find(a => a.id === 'agent-purchasing'); assert.equal(a.runtime.status, 'stale'); });
  await check('people are never "inactive" — labeled workflow not reviewed', async () => { const s = (await call('GET', '/api/state')).body; assert.ok(s.people.every(p => p.runtime.status === 'workflow_not_reviewed')); });
  await check('checkpoint persists and is resumable', async () => { await call('POST', '/api/checkpoints', { stage: 'map', next_action: 'Verify Maria' }); const s = (await call('GET', '/api/state')).body; assert.equal(s.checkpoint.next_action, 'Verify Maria'); assert.equal(s.checkpoint.stage, 'map'); });
  await check('demo activity is separated and purged', async () => { await call('POST', '/api/demo', { on: true }); let s = (await call('GET', '/api/state')).body; assert.ok(s.demo); assert.ok(s.events.some(e => e.source === 'demo')); await call('POST', '/api/demo', { on: false }); s = (await call('GET', '/api/state')).body; assert.ok(!s.events.some(e => e.source === 'demo')); assert.ok(s.events.some(e => e.source === 'n8n'), 'real events retained'); });
  await check('roles restrict sensitive information', async () => {
    const admin = cookie; cookie = '';
    await call('POST', '/api/login', { passphrase: creds.construction });
    const s = (await call('GET', '/api/state')).body; assert.equal(s.role, 'construction'); assert.ok(s.tasks.some(t => t.restricted)); assert.ok(s.people.every(p => p.email === undefined), 'emails hidden from non-accounting roles'); assert.ok(!s.tasks.some(t => t.restricted && t.steps)); assert.equal(s.audit.length, 0); assert.equal(s.server.db_path, undefined);
    const r = await call('POST', '/api/tasks/proc-cash', { board: 'done' }); assert.equal(r.status, 403);
    const x = await call('GET', '/api/export'); assert.equal(x.status, 403);
    cookie = '';
    await call('POST', '/api/login', { passphrase: creds.viewer }); const w = await call('POST', '/api/tasks', { title: 'nope' }); assert.equal(w.status, 403);
    cookie = admin;
  });
  await check('obsidian import keeps source and date', async () => { const r0 = await call('POST', '/api/import/obsidian', { files: [{ name: 'Selections SOP.md', content: '---\nowner: Pam\ndepartment: design\n---\n# Selections SOP\n## Trigger\nSupplier sends sheet\n## Steps\n1. Maria signs\n2. Enter in Excel\n' }] }); const r = r0.body; assert.equal(r.imported, 1, JSON.stringify(r0)); const t = (await call('GET', '/api/state')).body.tasks.find(t => t.id === 'obs-selections-sop'); assert.equal(t.owner_id, 'pam'); assert.match(t.source, /Obsidian import: Selections SOP.md/); assert.equal(t.trigger, 'Supplier sends sheet'); });
  await check('active jobs recorded from Brittany (data update applied once)', async () => { const s = (await call('GET', '/api/state')).body; const act = s.homes.filter(h => h.active === 'active'); assert.equal(act.length, 15, 'the model and 11623 Bistro went active after the 3 November walk-through'); assert.equal(act.filter(h => /permits/i.test(h.stage)).length, 10); });
  await check('folder import: dry run writes nothing; import; re-import skips unchanged; changed file re-imports', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'mow-vault-')); fs.mkdirSync(path.join(vault, '.obsidian')); fs.writeFileSync(path.join(vault, '.obsidian', 'x.md'), 'ignored');
    fs.writeFileSync(path.join(vault, 'PO.md'), '---\nowner: Maria\ndepartment: Purchasing\n---\n# Issue a purchase order\n## When\nBudget checked\n## Steps\nEnter PO\n## Vendor notes\nx\n');
    fs.writeFileSync(path.join(vault, 'dash.csv'), 'Person,Responsibility,Department\nMaria,Issue purchase orders,Purchasing\nTonya,HOA dues billing,HOA\n');
    const dry = (await call('POST', '/api/import/preview', { dir: vault })).body; assert.equal(dry.dry_run, true); assert.equal(dry.scanned, 2); assert.deepEqual(dry.files.find(f => f.path === 'PO.md').preview.mapping.unmapped, ['Vendor notes']); assert.equal(dry.files.find(f => f.path === 'dash.csv').preview.target, 'dashboard');
    assert.ok(!(await call('GET', '/api/state')).body.tasks.find(t => t.id === 'obs-issue-a-purchase-order'), 'dry run must not write');
    let r = (await call('POST', '/api/import/folder', { dir: vault })).body; assert.equal(r.imported, 2);
    let s = (await call('GET', '/api/state')).body; const t = s.tasks.find(t => t.id === 'obs-issue-a-purchase-order'); assert.equal(t.department_id, 'purchasing'); assert.equal(t.trigger, 'Budget checked'); assert.equal(t.owner_id, 'maria'); assert.ok(s.people.find(p => p.id === 'tonya' && !p.confirmed && p.departments.includes('hoa')));
    r = (await call('POST', '/api/import/folder', { dir: vault })).body; assert.equal(r.imported, 0); assert.equal(r.skipped_unchanged, 2);
    fs.appendFileSync(path.join(vault, 'PO.md'), '## Deadline\nSame day\n');
    r = (await call('POST', '/api/import/folder', { dir: vault })).body; assert.equal(r.imported, 1); assert.equal(r.skipped_unchanged, 1);
    assert.equal((await call('GET', '/api/state')).body.tasks.find(t => t.id === 'obs-issue-a-purchase-order').deadline, 'Same day');
    fs.rmSync(vault, { recursive: true, force: true });
  });
  await check('review: duplicates found, merge archives source and fills target, decisions survive re-import', async () => {
    const d = (await call('POST', '/api/review/duplicates', { id: 'dash-maria-issue-purchase-orders' })).body; assert.ok(d.some(x => x.id === 'obs-issue-a-purchase-order'));
    await call('POST', '/api/review/merge', { source_id: 'dash-maria-issue-purchase-orders', target_id: 'obs-issue-a-purchase-order' });
    let s = (await call('GET', '/api/state')).body; assert.ok(!s.tasks.find(t => t.id === 'dash-maria-issue-purchase-orders')); assert.equal(s.archived_count, 2, 'the merged duplicate, plus the framed-mirror SOP retired on 9 November');
    await call('POST', '/api/tasks/obs-issue-a-purchase-order', { proposed: 0, review_note: 'ok' });
    await call('POST', '/api/import/obsidian', { files: [{ name: 'PO.md', content: '# Issue a purchase order\n## Steps\nchanged' }] });
    const t = (await call('GET', '/api/state')).body.tasks.find(t => t.id === 'obs-issue-a-purchase-order'); assert.equal(t.proposed, 0); assert.equal(t.reviewed_by, 'admin'); assert.equal(t.steps, 'changed'); assert.equal(t.owner_id, 'maria', 'owner kept');
    await call('POST', '/api/people/maria', { review_status: 'verified' }); const m = (await call('GET', '/api/state')).body.people.find(p => p.id === 'maria'); assert.ok(m.reviewed_at && m.reviewed_by === 'admin');
  });
  await check('vault files are classified; only procedures become tasks; financial docs restricted', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'mow-vault2-'));
    for (const n of ['59 N Kingwood Signed Lease', '2026 Cash Flow Statement (Highlighted)', 'Employee Handbook', 'Employee Handbook (8.17.22)', 'Company Organizational Chart (10.24.25)', 'qb_bank_balances.py', 'MCH Executive Dashboard', 'Water Bills Monthly Procedure (ROCVTA)']) fs.writeFileSync(path.join(vault, n + '.md'), `# ${n}\n\nbody\n`);
    const dry = (await call('POST', '/api/import/preview', { dir: vault })).body;
    const k = Object.fromEntries(dry.files.map(f => [f.path.replace('.md', ''), f.preview.kind]));
    assert.equal(k['59 N Kingwood Signed Lease'], 'legal'); assert.equal(k['2026 Cash Flow Statement (Highlighted)'], 'financial'); assert.equal(k['Employee Handbook'], 'reference'); assert.equal(k['Company Organizational Chart (10.24.25)'], 'org_chart'); assert.equal(k['qb_bank_balances.py'], 'financial'); assert.equal(k['MCH Executive Dashboard'], 'dashboard'); assert.equal(k['Water Bills Monthly Procedure (ROCVTA)'], 'procedure');
    assert.ok(dry.files.find(f => f.path.startsWith('Employee Handbook (8')).preview.warnings.some(w => /version of/.test(w)));
    const r = (await call('POST', '/api/import/folder', { dir: vault, overrides: { 'Employee Handbook.md': 'procedure' } })).body; assert.equal(r.imported, 8);
    const s = (await call('GET', '/api/state')).body;
    assert.ok(s.tasks.find(t => t.id === 'obs-water-bills-monthly-procedure-rocvta')); assert.ok(s.tasks.find(t => t.id === 'obs-employee-handbook'), 'override honored');
    assert.ok(!s.tasks.find(t => t.id.startsWith('obs-') && /lease|cash flow/i.test(t.title)), 'lease/cash flow notes must not become tasks');
    assert.equal(s.documents.filter(d => d.kind === 'financial').length, 2); assert.ok(s.documents.find(d => d.id === 'doc-water-bills-monthly-procedure-rocvta').task_id);
    const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.construction });
    const c = (await call('GET', '/api/state')).body; assert.ok(c.documents.filter(d => d.kind === 'financial').every(d => d.restricted)); cookie = admin;
    fs.rmSync(vault, { recursive: true, force: true });
  });
  await check('index cards: docx/html extracted, .doc flagged for conversion, missing file flagged, tasks only with content', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'mow-vault3-')); fs.mkdirSync(path.join(vault, 'notes')); fs.mkdirSync(path.join(vault, 'srv'));
    const card = (title, file, hubs) => `---\ntitle: "${title}"\ntype: document\nsource: localserver\nprimary_hub: "Knowledge Base & SOPs"\n---\n# ${title}\n\n> [!info] Document · [\`${path.basename(file)}\`](../srv/${encodeURIComponent(path.basename(file))})\n\n## Why it matters\nCore ${title}\n\n## Topic hubs\n${hubs.map(h => '- [[' + h + ']]').join('\n')}\n\n## Entities\n- [[Jim McVaugh]]\n`;
    fs.writeFileSync(path.join(vault, 'notes', 'MCH Accounting SOP.md'), card('MCH Accounting SOP', 'MCH_Accounting_SOP.docx', ['Construction Financials & Budget vs Actual', 'Database & Reconciliation']));
    fs.writeFileSync(path.join(vault, 'notes', 'Vendor Setup Procedure.md'), card('Vendor Setup Procedure', 'VENDOR SETUP.doc', ['Database & Reconciliation']));
    fs.writeFileSync(path.join(vault, 'notes', 'MCH Operations Hub.md'), card('MCH Operations Hub', 'mch-ops-hub.html', ['Construction Financials & Budget vs Actual']));
    fs.writeFileSync(path.join(vault, 'notes', 'Company Organizational Chart (10.24.25).md'), card('Company Organizational Chart (10.24.25)', 'Org Chart.pdf', []));
    // minimal docx (zip with word/document.xml), built without dependencies via zlib
    const zlib = require('node:zlib'); const xml = Buffer.from('<w:document><w:body><w:p><w:r><w:t>Step 1: Enter the bill &amp; job.</w:t></w:r></w:p></w:body></w:document>');
    const def = zlib.deflateRawSync(xml); const name = Buffer.from('word/document.xml'); const crc = 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(xml.length, 22); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(def.length, 20); cd.writeUInt32LE(xml.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
    const cdOff = lh.length + name.length + def.length; const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(cdOff, 16);
    fs.writeFileSync(path.join(vault, 'srv', 'MCH_Accounting_SOP.docx'), Buffer.concat([lh, name, def, cd, name, eocd]));
    fs.writeFileSync(path.join(vault, 'srv', 'VENDOR SETUP.doc'), 'binary'); fs.writeFileSync(path.join(vault, 'srv', 'mch-ops-hub.html'), '<html><body><h1>Hub</h1><p>Maria &ndash; Construction</p></body></html>');
    const r = (await call('POST', '/api/import/folder', { dir: path.join(vault, 'notes') })).body; assert.equal(r.imported, 4);
    const s = (await call('GET', '/api/state')).body; const doc = id => s.documents.find(d => d.id === id);
    assert.equal(doc('doc-mch-accounting-sop').underlying_status, 'extracted'); assert.match(doc('doc-mch-accounting-sop').content, /Step 1: Enter the bill & job/); assert.equal(doc('doc-mch-accounting-sop').department_id, 'accounting');
    assert.equal(doc('doc-vendor-setup-procedure').underlying_status, 'needs_conversion'); assert.equal(doc('doc-company-organizational-chart-10-24-25').underlying_status, 'not_found');
    assert.match(doc('doc-mch-operations-hub').content, /Maria – Construction/); assert.equal(doc('doc-mch-operations-hub').department_id, null, 'generic hub assigns no department');
    const t1 = s.tasks.find(t => t.id === 'obs-mch-accounting-sop'); assert.equal(t1.documented, 1); assert.match(t1.steps, /Step 1/); assert.equal(t1.proposed, 1);
    const t2 = s.tasks.find(t => t.id === 'obs-vendor-setup-procedure'); assert.equal(t2.documented, 0); assert.match(t2.missing_info, /needs conversion/);
    assert.ok(!s.tasks.find(t => /Operations Hub|Organizational Chart/.test(t.title)), 'non-procedures are not tasks');
    fs.rmSync(vault, { recursive: true, force: true });
  });
  await check('ops hub seeded: SOPs owned by absorbing people, responsibilities on people, legacy roles as documents', async () => {
    const s = (await call('GET', '/api/state')).body;
    // 24 of the 25 are live; the framed-mirror one is retired and archived, so it drops out of the board
    // and out of the published hub without being deleted.
    const hub = s.tasks.filter(t => t.id.startsWith('hub-')); assert.equal(hub.length, 24);
    assert.equal(hub.filter(t => t.lifecycle === 'stale').length, 4, 'somebody should, nobody does');
    // Rewritten 9 November from the meetings: the 2006 text is gone, nothing points at the purchasing list,
    // and the two steps nobody confirmed are recorded as dropped rather than published as fact.
    const nwo = s.tasks.find(t => t.id === 'hub-new_work_order');
    assert.equal(nwo.owner_id, 'lonnie'); assert.equal(nwo.backup_id, 'james'); assert.equal(nwo.department_id, 'purchasing');
    assert.ok(!/Red-lined plans are received by CA/.test(nwo.steps), 'the 2006 steps are not published any more');
    assert.match(nwo.steps, /approved master plans/); assert.match(nwo.steps, /Lonnie reviews the price/);
    assert.equal(nwo.documented, 1); assert.equal(nwo.proposed, 0); assert.equal(nwo.content_locked, 1);
    assert.ok(!s.tasks.some(t => t.owner_id === 'ernesto' || t.backup_id === 'ernesto'), 'no procedure is left pointing at the purchasing list');
    // Maria's list was emptied on 8 November once all three handover transcripts were applied.
    assert.equal(JSON.parse(s.people.find(p => p.id === 'maria').responsibilities).length, 0);
    assert.equal(JSON.parse(s.people.find(p => p.id === 'maria').crossed_off).length, 24, 'what she struck off on her last day'); assert.deepEqual(JSON.parse(s.people.find(p => p.id === 'kenneth').legacy_roles), ['CFO']);
    assert.equal(s.documents.filter(d => d.id.startsWith('doc-legacy-role')).length, 16);
    const dbp = s.tasks.find(t => t.id === 'obs-procedures-for-the-mch-database'); assert.match(dbp.steps, /Work orders must be in the database prior to work commencing/); assert.equal(dbp.owner_id, 'james', 'the work-order guide moved off Maria: entry is James\'s, Lonnie backs it up');
    assert.equal(dbp.backup_id, 'lonnie');
    await call('POST', '/api/tasks/hub-new_work_order', { proposed: 0, owner_id: 'maria' });
    const r = (await call('POST', '/api/import/opshub', { filename: 'hub.json', content: fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.json'), 'utf8') })).body; assert.equal(r.tasks, 17, 'the 17 the snapshot may refresh');
    assert.equal(r.procedures_kept.length, 8, 'the 8 decided here — one retired, four stale, three rewritten — are not overwritten by the old file');
    assert.ok(r.procedures_kept.some(x => x.id === 'hub-framed_mirror_purchase' && x.lifecycle === 'retired'));
    const again = (await call('GET', '/api/state')).body.tasks.find(t => t.id === 'hub-new_work_order'); assert.equal(again.proposed, 0, 'review kept'); assert.equal(again.owner_id, 'maria', 'owner change kept');
  });
  await check('succession pass: meetings stored with provenance, step reviews, flows, job status, handover sorted no-backup first, agenda', async () => {
    const s = (await call('GET', '/api/state')).body;
    const m = s.documents.filter(d => d.kind === 'meeting'); assert.equal(m.length, 7); assert.ok(m.every(d => d.meeting_date && JSON.parse(d.attendees).length >= 2 && d.source));
    const wo = s.tasks.find(t => t.id === 'hub-work_order_ap'); const rev = JSON.parse(wo.step_review); assert.equal(rev.length, 10); assert.ok(rev.every(r => r.verdict !== 'match' || r.cite)); assert.match(wo.verification_result, /Reconciled against meetings/); assert.match(wo.missing_info, /Not mentioned/); assert.ok(JSON.parse(wo.flow).nodes.length > 5);
    assert.ok(s.tasks.find(t => t.id === 'tr-leander-arc-review' && t.proposed === 0 && t.backup_id === 'teresa'));
    const h = s.homes.find(h => h.address === '11603 Royal Parkside Place'); assert.match(h.stage, /Framing/);
    // The citation moves to the most recent meeting that spoke about the house: 10/16 then 11/03.
    assert.match(h.status_cite, /J 11\/03/);
    const ho = (await call('GET', '/api/handover?person=maria')).body; assert.equal(ho.items.length, 23); assert.ok(ho.items[0].no_backup && ho.items[0].risk === 'high'); const firstBackup = ho.items.findIndex(i => !i.no_backup); assert.ok(ho.items.slice(firstBackup).every(i => !i.no_backup), 'no-backup items come first');
    // Her procedures moved to Lonnie when Director of Construction merged into Construction, so the steps
    // no meeting confirmed follow the work: they are his to check now, not hers.
    // Only the one procedure an earlier test parked on her on purpose is left against her.
    assert.ok(ho.not_mentioned.every(x => x.task_id === 'hub-new_work_order'), 'nothing else is left against Maria');
    const hl = (await call('GET', '/api/handover?person=lonnie')).body;
    assert.ok(hl.not_mentioned.length > 5, 'the unconfirmed steps are with whoever holds the work');
    assert.equal(ho.person.crossed_off.length, 24);
    const agenda = (await call('GET', '/api/handover/agenda?person=maria')).body; assert.match(agenda, /walk me through how you do this today/); assert.match(agenda, /11603 Royal Parkside Place/); assert.match(agenda, /\[M \d/);
    await call('POST', '/api/handover_items/ho-leander', { status: 'reassigned', note: 'Teresa' }); assert.equal((await call('GET', '/api/state')).body.handover_items.find(i => i.id === 'ho-leander').status, 'reassigned');
  });
  await check('handover items link processes and documents; upload attaches a file that can be opened', async () => {
    const ho = (await call('GET', '/api/handover?person=maria')).body; const wo = ho.items.find(i => i.id === 'ho-wo-approval');
    assert.ok(wo.why && /three approvers/.test(wo.why)); assert.deepEqual(wo.task_ids, ['tr-wo-approval-single-point', 'hub-work_order_ap']);
    const walk = ho.items.find(i => i.id === 'ho-walkthrough'); assert.deepEqual(walk.doc_ids, ['doc-homeowner-walkthrough-checklist']);
    let d = (await call('GET', '/api/state')).body.documents.find(x => x.id === 'doc-homeowner-walkthrough-checklist'); assert.equal(d.underlying_status, 'not_attached');
    const r = (await call('POST', '/api/documents/upload', { name: 'walkthrough.md', data: Buffer.from('# Walkthrough\n- faucet\n').toString('base64'), doc_id: 'doc-homeowner-walkthrough-checklist', handover_id: 'ho-walkthrough' })).body; assert.equal(r.underlying_status, 'extracted');
    d = (await call('GET', '/api/state')).body.documents.find(x => x.id === 'doc-homeowner-walkthrough-checklist'); assert.match(d.content, /faucet/); assert.equal(d.mime, 'text/markdown');
    const f = await fetch(B + '/files/doc-homeowner-walkthrough-checklist', { headers: { Cookie: cookie } }); assert.equal(f.status, 200); assert.match(await f.text(), /faucet/);
    const anon = await fetch(B + '/files/doc-homeowner-walkthrough-checklist'); assert.equal(anon.status, 401);
    const bad = await call('POST', '/api/documents/upload', { name: 'x.exe', data: 'AAAA' }); assert.equal(bad.status, 400);
    assert.ok((await call('GET', '/api/state')).body.tasks.find(t => t.id === 'tr-punch-out' && t.flow));
  });
  await check('meeting 3 applied: third transcript, merged step reviews, supersedes links, 11607 active, new handover item', async () => {
    const s = (await call('GET', '/api/state')).body;
    assert.equal(s.documents.filter(d => d.kind === 'meeting').length, 7);
    const co = s.tasks.find(t => t.id === 'hub-change_order_budget'); const rows = JSON.parse(co.step_review); assert.ok(rows.some(r => String(r.n) === '2–3' && r.verdict === 'no_longer' && /M3/.test(r.cite))); assert.ok(!rows.some(r => String(r.n) === '2'), 'earlier per-step rows replaced by the later finding'); assert.match(co.verification_result, /2026-10-20 call/);
    const tco = s.tasks.find(t => t.id === 'tr-change-orders'); assert.deepEqual(JSON.parse(tco.supersedes), ['hub-change_order_request', 'hub-change_order_budget']);
    assert.ok(JSON.parse(s.tasks.find(t => t.id === 'tr-permit-per-address').supersedes).includes('hub-permitting'));
    const h = s.homes.find(h => h.address === '11607 Royal Parkside Place'); assert.equal(h.active, 'active'); assert.match(h.notes, /Plan 3A/);
    const ho = (await call('GET', '/api/handover?person=maria')).body; assert.ok(ho.items.find(i => i.id === 'ho-inspection-binder' && i.no_backup)); assert.match(ho.items.find(i => i.id === 'ho-vendor-insurance').backup, /James/);
    assert.match(s.people.find(p => p.id === 'maria').notes, /DEPARTED 6 November 2026/);
  });
  await check('SOW Excel → vendors (restricted contacts); regenerated ops hub parses back with current + superseded SOPs', async () => {
    const s = (await call('GET', '/api/state')).body; assert.ok(s.vendors.length >= 40);
    const pl = s.vendors.find(v => v.trade === 'PLUMBING'); assert.equal(pl.vendor, 'GT Plumbing'); assert.ok(JSON.parse(pl.contacts).some(c => /Mauricio/.test(c.name)));
    const fx = s.vendors.find(v => v.trade === 'PLUMBING FIXTURES'); assert.match(fx.vendor, /Ferguson/);
    const fd = s.vendors.find(v => v.trade === 'FOUNDATION'); assert.equal(fd.vendor, 'Andrade Concrete'); assert.match(fd.rate, /10\.50/);
    const sow = s.documents.find(d => d.id === 'doc-sow-excel'); assert.equal(sow.sensitive, 1); assert.ok(sow.file_path);
    const html = (await call('GET', '/api/export/opshub')).body; assert.match(html, /regenerated by McVaugh Operations World/);
    const imp = require(path.join(__dirname, '..', 'server', 'imports.js')); const hub = imp.parseOpsHub(html);
    assert.ok(hub.processes.filter(p => p.status === 'current').length >= 15); const cob = hub.processes.find(p => p.id === 'change_order_budget');
    // Rewritten here, so it publishes as current in its own right, with the procedures that corrected it
    // listed as the detail rather than as having replaced it.
    assert.equal(cob.status, 'current'); assert.equal((cob.supersededBy || []).length, 0);
    assert.ok(cob.detailed_by.includes('tr-change-orders'));
    // A procedure is published under whoever holds it, as long as that person is still here. This one was
    // parked on Maria by an earlier test, so it falls back to the 2006 role — which is the point of the
    // fallback: nobody current holds it.
    const nw = hub.processes.find(p => p.id === 'new_work_order');
    assert.equal(nw.status, 'current'); assert.equal(nw.owner, 'purchasing_mgr', 'parked on someone who has left, so the old role shows');
    const perm = hub.processes.find(p => p.id === 'permitting');
    assert.equal(perm.owner, 'lonnie', 'a procedure someone holds is published under their name');
    // The published hub carries only what people actually hold: struck-off work is removed from it, with
    // a count left behind, and the history stays in the world against whoever used to hold it.
    const mh = hub.team.find(t => t.id === 'maria');
    assert.ok(!mh.responsibilities.some(r => r.startsWith('[N/A]')), 'nothing struck off is published');
    assert.ok(mh.removed > 0, 'but the hub says how many were removed');
    assert.equal(mh.departed, true);
    const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.construction });
    const c = (await call('GET', '/api/state')).body; assert.ok(c.vendors.every(v => v.restricted && v.contacts === '[]')); const f = await fetch(B + '/files/doc-sow-excel', { headers: { Cookie: cookie } }); assert.equal(f.status, 403); cookie = admin;
  });
  await check('WO entry skill: Johnston reusable, other vendors flagged for review, skill recorded as drafting only', async () => {
    const s = (await call('GET', '/api/state')).body;
    const jw = s.vendors.find(v => /johnston/i.test(v.vendor || ''));
    assert.ok(jw, 'Johnston Waterproofing vendor exists'); assert.equal(jw.wo_review, 'reviewed', 'the hub vendor rules reviewed it on 3 November');
    assert.ok(s.vendors.filter(v => v.wo_review === 'needs_review').length > 20, 'other vendors need a review first');
    const framer = s.vendors.find(v => v.trade === 'FRAMING'); assert.equal(framer.pricing_basis, 'per_sqft'); assert.match(framer.wo_instructions, /square footage/i);
    const t = s.tasks.find(t => t.id === 'tr-wo-entry-from-bid');
    assert.equal(t.documented, 1); assert.equal(t.verified, 0, 'verified only for one vendor, so not verified overall');
    assert.equal(t.automated, 0, 'the ChatGPT skill drafts by hand today; the agent loop is designed, not built');
    assert.deepEqual(JSON.parse(t.supersedes), ['hub-new_work_order']);
    const ai = s.ai_configs.find(a => a.id === 'ai-wo-entry-from-bid'); assert.match(ai.approval, /the agent cannot send, approve or price/i);
  });
  await check('build sequence: ordered steps, phases, hold points, vendors matched, MCH steps flagged', async () => {
    const s = (await call('GET', '/api/state')).body;
    const bs = s.build_steps; assert.ok(bs.length > 100, 'over 100 rows imported');
    const steps = bs.filter(b => b.kind === 'step');
    assert.ok(steps.length >= 100);
    assert.equal(steps[0].description.toLowerCase(), 'lot stake');
    assert.match(steps[steps.length - 1].description, /grade and fill inspection/i);
    for (let i = 1; i < steps.length; i++) assert.equal(steps[i].seq, steps[i - 1].seq + 1, 'steps are numbered in order');
    assert.ok(new Set(bs.map(b => b.phase)).size >= 5, 'grouped into phases');
    assert.ok(bs.some(b => b.kind === 'hold' && /DO NOT POUR/i.test(b.description)), 'the pour hold point is kept, not treated as a step');
    assert.ok(bs.filter(b => b.kind === 'notify').length >= 2);
    assert.ok(steps.filter(b => b.is_mch).length >= 10, 'MCH-performed steps flagged');
    assert.ok(bs.filter(b => b.inspection === 'city').length >= 5 && bs.filter(b => b.inspection === 'third_party').length >= 4);
    assert.ok(steps.filter(b => b.gap).length >= 1, 'steps with no contractor chosen are flagged');
    assert.ok(steps.filter(b => b.vendor_id).length >= 80, 'responsible parties matched to vendor records');
    const slab = steps.find(b => /^set forms/i.test(b.description)); assert.equal(s.vendors.find(v => v.id === slab.vendor_id).vendor, 'Andrade Concrete');
  });
  await check('logins written into the build sheet are never stored; the original file stays restricted', async () => {
    const s = (await call('GET', '/api/state')).body;
    const blob = JSON.stringify({ b: s.build_steps, d: s.documents, t: s.tasks, h: s.handover_items, e: s.events });
    for (const secret of ['Reliant1', 'Pershing26!', 'Pershing1!', 'username:mabney', 'UserID: mcvaugh'])
      assert.ok(!blob.includes(secret), `password ${secret} must not be stored`);
    const cred = s.build_steps.filter(b => b.credential_note); assert.ok(cred.length >= 4, 'the steps still say a login is needed');
    assert.match(cred[0].notes, /login removed/);
    const doc = s.documents.find(d => d.id === 'doc-how-to-build-a-house');
    assert.equal(doc.sensitive, 1, 'the source file still contains the passwords, so it is restricted');
    assert.ok(!String(doc.content || '').includes('Reliant1'));
    const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.construction });
    const c = (await call('GET', '/api/state')).body;
    assert.ok(c.build_steps.length === s.build_steps.length, 'the build order itself is open to construction');
    assert.equal(c.build_steps.find(b => b.id === cred[0].id).credential_note, '(restricted: ask Brittany)');
    const f = await fetch(B + '/files/doc-how-to-build-a-house', { headers: { Cookie: cookie } }); assert.equal(f.status, 403);
    cookie = admin;
  });
  await check('build sequence feeds the handover: build order documented, logins and MCH-only steps raised', async () => {
    const ho = (await call('GET', '/api/handover?person=maria')).body;
    const own = ho.items.find(i => i.id === 'ho-builder-own-steps'); assert.ok(own); assert.equal(own.risk, 'high'); assert.ok(own.no_backup);
    assert.ok(own.doc_ids.includes('doc-how-to-build-a-house'));
    const log = ho.items.find(i => i.id === 'ho-portal-logins'); assert.ok(log); assert.match(log.why, /not stored here/i);
    const sch = ho.items.find(i => i.id === 'ho-scheduling'); assert.match(sch.note, /How to build a house/); assert.match(sch.documented, /build order/i);
    const s = (await call('GET', '/api/state')).body;
    const t = s.tasks.find(t => t.id === 'tr-schedule-and-trade-coordination'); assert.equal(t.documented, 1); assert.match(t.missing_info, /no vendor record/);
  });
  await check('purchasing agent: drafts a work order and waits for a named human; nothing is released until then', async () => {
    const ask = () => call('POST', '/api/webhooks/approval', { agent_id: 'agent-purchasing', task_id: 'tr-wo-entry-from-bid', execution_id: 'bid-1',
      subject: 'WO draft — Johnston Waterproofing — 11603', vendor_id: 'vendor-waterproofing', amount: '$4,850.00',
      evidence: 'Bid PDF 10/23', draft: { vendor: 'Johnston Waterproofing', cost_code: '07-100', amount: '$4,850.00' } }, { Cookie: '', 'X-MOW-Secret': 's3cret' });
    const bad = await call('POST', '/api/webhooks/approval', { subject: 'x' }, { Cookie: '', 'X-MOW-Secret': 'wrong' }); assert.equal(bad.status, 401, 'approval requests need the shared secret');
    const r = await ask(); assert.equal(r.status, 200); const id = r.body.id;
    assert.match(r.body.question, /do you approve/i);
    const again = await ask(); assert.equal(again.body.deduplicated, true, 'a retried n8n execution does not ask twice');
    const s = (await call('GET', '/api/state')).body;
    const a = s.approvals.find(x => x.id === id);
    assert.equal(a.status, 'pending'); assert.equal(a.released, 0, 'nothing is released while it is pending');
    assert.equal(a.requested_from, 'james', 'the work order goes to James, who raises it once a price is agreed');
    assert.ok(a.token === undefined, 'the approval token is never sent to the browser');
    assert.equal(s.agents.find(g => g.id === 'agent-purchasing').runtime.status, 'waiting');
    assert.equal(s.integrations.find(i => i.id === 'teams').status, 'disconnected', 'Teams is not connected until Brittany sets the webhook');
  });
  await check('an approval link that is only previewed never decides; a bad token is refused', async () => {
    const row = (await call('GET', '/api/state')).body.approvals.find(a => a.status === 'pending');
    const tok = (await call('GET', `/api/approvals`)).body.find(a => a.id === row.id); assert.ok(tok.token === undefined, 'tokens stay server-side');
    const link = await fetch(`${B}/approve/${row.id}?t=anything&d=approve`); assert.equal(link.status, 403, 'a wrong token cannot decide');
    // the real token, fetched the way Teams would when it builds a link preview: a GET must not decide
    const dbFile = require('node:sqlite'); const raw = new dbFile.DatabaseSync(path.join(dataDir, 'mcvaugh-world.sqlite'));
    const t = raw.prepare('SELECT token FROM approvals WHERE id = ?').get(row.id).token; raw.close();
    const preview = await fetch(`${B}/approve/${row.id}?t=${t}&d=approve`); assert.equal(preview.status, 200);
    assert.match(await preview.text(), /Approve and enter the work order/, 'a GET shows the page, it does not approve');
    const still = (await call('GET', '/api/state')).body.approvals.find(a => a.id === row.id);
    assert.equal(still.status, 'pending'); assert.equal(still.released, 0);
  });
  await check('only accounting/admin may approve; the decision is named, released and cannot be made twice', async () => {
    const row = (await call('GET', '/api/state')).body.approvals.find(a => a.status === 'pending');
    const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.construction });
    const denied = await call('POST', `/api/approvals/${row.id}/approve`, {}); assert.equal(denied.status, 403, 'construction cannot commit money');
    const seen = (await call('GET', '/api/state')).body.approvals.find(a => a.id === row.id);
    assert.equal(seen.can_decide, false, 'the UI is told not to offer the button'); assert.equal(seen.status, 'pending', 'and nothing changed');
    cookie = admin;
    const ok = await call('POST', `/api/approvals/${row.id}/approve`, { note: 'checked against the bid' });
    assert.equal(ok.status, 200);
    const after = (await call('GET', '/api/state')).body;
    const a = after.approvals.find(x => x.id === row.id);
    assert.equal(a.status, 'approved'); assert.equal(a.released, 1, 'approval is what releases it');
    assert.equal(a.decided_by, 'admin'); assert.equal(a.decided_via, 'app'); assert.equal(a.decision_note, 'checked against the bid');
    const twice = await call('POST', `/api/approvals/${row.id}/reject`, {}); assert.equal(twice.status, 409, 'a decided approval cannot be re-decided');
    assert.ok(after.events.some(e => /approved:.*Johnston/i.test(e.label) && e.entity_id === 'agent-purchasing'), 'the decision is in the history');
    assert.notEqual(after.agents.find(g => g.id === 'agent-purchasing').runtime.status, 'waiting', 'the agent stops waiting once decided');
  });
  await check('rejecting sends nothing and records why', async () => {
    const r = await call('POST', '/api/webhooks/approval', { agent_id: 'agent-purchasing', execution_id: 'bid-2', subject: 'WO draft — Andrade Concrete — 11607', amount: '$12,000' }, { Cookie: '', 'X-MOW-Secret': 's3cret' });
    const out = await call('POST', `/api/approvals/${r.body.id}/reject`, { note: 'square footage missing' });
    assert.equal(out.status, 200);
    const a = (await call('GET', '/api/state')).body.approvals.find(x => x.id === r.body.id);
    assert.equal(a.status, 'rejected'); assert.equal(a.released, 0, 'a rejected work order is never released');
    assert.match(a.decision_note, /square footage/);
  });
  await check('the agent job is recorded honestly: a person starts it, not yet run against a real bid', async () => {
    const s = (await call('GET', '/api/state')).body;
    const ag = s.agents.find(a => a.id === 'agent-purchasing');
    assert.equal(ag.enabled, 0, 'not switched on until it has been run against a real bid');
    assert.match(ag.purpose, /never starts a work order by itself/i);
    assert.match(ag.human_authority, /cannot start, price, award or accept/i);
    assert.equal(ag.n8n_workflow_id, 'mow-wo-approval');
    const t = s.tasks.find(t => t.id === 'tr-wo-entry-from-bid');
    assert.equal(t.automated, 0, 'the loop is built here but has not run against the real database');
    // Settled by Maria on 10/24: entering the work order is what notifies and approves the sub, so the agent asks first.
    assert.equal(t.blocker, null, 'the draft-state question fell away once the agent asks before entering');
    assert.ok(s.decisions.some(d => d.id === 'dec-wo-agent-draft-first' && d.status === 'accepted'));
    assert.match(t.steps, /M-chat 10\/24/, "Maria's answer is cited where the procedure says entering notifies the sub");
    assert.match(t.trigger, /price has been reviewed and agreed by Lonnie/, 'Lonnie agrees the price, then James raises it');
    assert.equal(t.owner_id, 'james'); assert.equal(t.backup_id, 'lonnie');
    for (const f of ['mow-wo-approval', 'mow-bid-requests']) {
      const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', f + '.json'), 'utf8'));
      assert.equal(wf.active, false, f + ' ships switched off');
    }
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'mow-wo-approval.json'), 'utf8'));
    assert.ok(JSON.stringify(wf).includes('/api/webhooks/bid'), 'bids are recorded against a request');
    assert.ok(JSON.stringify(wf).includes('asked_for_decision'), 'the Teams card only posts when all bids are in');
  });
  await check('a work order starts when a person asks; the agent never starts one, and it is entered only after confirming', async () => {
    const before = (await call('GET', '/api/state')).body.approvals.filter(a => a.kind === 'work_order' && a.status === 'pending').length;
    const bad = await call('POST', '/api/work-orders/request', { amount: '$1' });
    assert.equal(bad.status, 400, 'a work order needs a vendor');
    const ghost = await call('POST', '/api/work-orders/request', { vendor_id: 'vendor-framing', home_id: 'job-does-not-exist' });
    assert.equal(ghost.status, 400, 'a work order against a job that does not exist is refused, not silently filed with no job');
    // a per-square-foot vendor with no square footage is flagged rather than quietly entered
    const sq = await call('POST', '/api/work-orders/request', { vendor_id: 'vendor-framing', home_id: JOB, amount: '$92,000' });
    assert.equal(sq.body.needs_sqft, true);
    const a0 = (await call('GET', '/api/state')).body.approvals.find(a => a.id === sq.body.id);
    assert.match(a0.question, /prices per square foot/i);
    assert.match(a0.draft, /MISSING/);
    assert.equal(a0.requested_by, 'admin', 'who asked is recorded');
    assert.equal(a0.released, 0, 'nothing is entered just because someone asked');
    // over the budget line it goes to Jim
    const over = await call('POST', '/api/work-orders/request', { vendor_id: 'vendor-stucco', amount: '$99,000', over_budget: true });
    assert.equal((await call('GET', '/api/state')).body.approvals.find(a => a.id === over.body.id).requested_from, 'jim');
    // confirming releases it; n8n picks it up and reports the number back
    const ok = await call('POST', `/api/approvals/${sq.body.id}/approve`, { note: 'sqft added on the order' });
    assert.equal(ok.status, 200);
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const queue = (await call('GET', '/api/webhooks/work', null, H)).body.enter_work_orders;
    assert.ok(queue.some(w => w.id === sq.body.id && w.from === 'request'), 'the confirmed request is queued for entry');
    assert.ok(queue.every(w => w.token === undefined), 'the approval token never leaves the server');
    const done = await call('POST', '/api/webhooks/bid/entered', { approval_id: sq.body.id, wo_ref: 'WO-5100' }, H);
    assert.equal(done.status, 200);
    const again = await call('POST', '/api/webhooks/bid/entered', { approval_id: sq.body.id, wo_ref: 'WO-5101' }, H);
    assert.equal(again.status, 409, 'it cannot be entered twice');
    const s = (await call('GET', '/api/state')).body;
    assert.equal(s.approvals.find(a => a.id === sq.body.id).wo_ref, 'WO-5100');
    assert.ok(s.events.some(e => /WO-5100 entered/.test(e.label)));
    const unconfirmed = await call('POST', '/api/webhooks/bid/entered', { approval_id: over.body.id, wo_ref: 'WO-5102' }, H);
    assert.equal(unconfirmed.status, 409, 'an unconfirmed request can never be entered');
    assert.ok((await call('GET', '/api/state')).body.approvals.filter(a => a.kind === 'work_order' && a.status === 'pending').length > before);
  });
  await check('the bid flow is parked: nothing requests or collects bids until a bid process exists', async () => {
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const s0 = (await call('GET', '/api/state')).body;
    assert.equal(s0.bid_flow, 'parked');
    const r = await call('POST', '/api/webhooks/bid-request', { line_item: 'FRAMING', execution_id: 'parked-1' }, H);
    assert.equal(r.status, 410, 'asking for bids is switched off');
    assert.match(r.body.detail, /needs its own process and agent first/);
    const b = await call('POST', '/api/webhooks/bid', { line_item: 'FRAMING', amount: '$1' }, H);
    assert.equal(b.status, 410, 'collecting bids is switched off too');
    const t = s0.tasks.find(t => t.id === 'tr-bid-requests');
    assert.match(t.title, /PARKED/); assert.match(t.blocker, /too varied between trades/i);
    assert.ok(s0.decisions.some(d => d.id === 'dec-park-bid-flow' && d.status === 'accepted'));
    // the work it parks is kept, not deleted
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'mow-bid-requests.json'), 'utf8'));
    assert.equal(wf.active, false);
  });
  // The parked flow still has to work the day it is switched back on, so the rest of these run with it enabled.
  const setBidFlow = v => { const d = require('node:sqlite'); const raw = new d.DatabaseSync(path.join(dataDir, 'mcvaugh-world.sqlite')); raw.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('bid_flow', ?)").run(v); raw.close(); };
  setBidFlow('active');
  await check('bid request: built from the vendor contact list, sole source flagged, nothing sent before approval', async () => {
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const r = await call('POST', '/api/webhooks/bid-request', { line_item: 'WATERPROOFING AND OVERLAY', home_id: JOB, execution_id: 'br-1', due_days: 3 }, H);
    assert.equal(r.status, 200);
    assert.equal(r.body.sole_source, true, 'only Johnston is on the contact list for that trade');
    assert.deepEqual(r.body.vendors, ['Johnston Waterproofing'], 'vendors came from the contact list, not the caller');
    const s = (await call('GET', '/api/state')).body;
    const br = s.bid_requests.find(x => x.id === r.body.bid_request_id);
    assert.equal(br.status, 'draft', 'nothing goes out before a human approves');
    assert.equal(br.expected, 1); assert.equal(br.sole_source, 1); assert.ok(br.due_by);
    const ap = s.approvals.find(a => a.id === r.body.id);
    assert.equal(ap.kind, 'bid_request');
    assert.match(ap.question, /more than one bid/i, 'a single-vendor trade says so, per Maria');
    const unknown = await call('POST', '/api/webhooks/bid-request', { line_item: 'UNDERWATER BASKET WEAVING', execution_id: 'br-x' }, H);
    assert.equal(unknown.status, 400, 'a trade with no vendor on the list is refused, not guessed');
  });
  await check('a bid cannot be recorded against a line item nobody asked for', async () => {
    const r = await call('POST', '/api/webhooks/bid', { line_item: 'FRAMING', amount: '$90,000' }, { Cookie: '', 'X-MOW-Secret': 's3cret' });
    assert.equal(r.status, 409, 'the request has to exist first — that is what makes "all bids in" answerable');
  });
  await check('several bids: nobody is asked until the last one is in, then it is a choice not a yes/no', async () => {
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const req = await call('POST', '/api/webhooks/bid-request', { line_item: 'FRAMING', home_id: JOB, execution_id: 'br-2',
      vendors: ['vendor-framing', 'vendor-foundation', 'vendor-plumbing'], expected: 3 }, H);
    const brId = req.body.bid_request_id;
    await call('POST', `/api/approvals/${req.body.id}/approve`, { note: 'send it' });
    assert.equal((await call('GET', '/api/state')).body.bid_requests.find(b => b.id === brId).status, 'sent');

    const first = await call('POST', '/api/webhooks/bid', { bid_request_id: brId, vendor_id: 'vendor-framing', amount: '$92,000', external_id: 'b1' }, H);
    assert.equal(first.body.asked_for_decision, false, '1 of 3 in — no one is bothered yet');
    const dupe = await call('POST', '/api/webhooks/bid', { bid_request_id: brId, vendor_id: 'vendor-framing', amount: '$92,000', external_id: 'b1' }, H);
    assert.equal(dupe.body.deduplicated, true);
    const second = await call('POST', '/api/webhooks/bid', { bid_request_id: brId, vendor_id: 'vendor-foundation', amount: '$88,500', external_id: 'b2' }, H);
    assert.equal(second.body.asked_for_decision, false, '2 of 3 in — still waiting');
    assert.equal((await call('GET', '/api/state')).body.approvals.filter(a => a.bid_request_id === brId && a.status === 'pending').length, 0);

    const third = await call('POST', '/api/webhooks/bid', { bid_request_id: brId, vendor_id: 'vendor-plumbing', amount: '$95,000', external_id: 'b3' }, H);
    assert.equal(third.body.asked_for_decision, true, 'the last bid is what triggers the question');
    const s = (await call('GET', '/api/state')).body;
    const ap = s.approvals.find(a => a.id === third.body.approval_id);
    assert.equal(ap.kind, 'bid_award');
    const opts = JSON.parse(ap.options);
    assert.equal(opts.length, 3); assert.equal(opts[0].amount, '$88,500', 'cheapest first, but the human still picks');
    assert.match(ap.question, /which one/i);

    const vague = await call('POST', `/api/approvals/${ap.id}/approve`, {});
    assert.equal(vague.status, 409, 'approving without saying which bid is not a decision');
    const ok = await call('POST', `/api/approvals/${ap.id}/approve`, { chosen: opts[0].id, note: 'best price, scope matches' });
    assert.equal(ok.status, 200);
    const after = (await call('GET', '/api/state')).body.bid_requests.find(b => b.id === brId);
    assert.equal(after.status, 'awarded'); assert.equal(after.awarded_bid_id, opts[0].id);
    assert.equal(after.bids.find(b => b.id === opts[0].id).status, 'approved');
    assert.ok(after.bids.filter(b => b.status === 'superseded').length === 2, 'losing bids are kept, marked not chosen');
  });
  await check('the work order is only entered for a bid that was approved, and the number comes back', async () => {
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const work = (await call('GET', '/api/webhooks/work', null, H)).body;
    const todo = work.enter_work_orders; assert.ok(todo.length >= 1, 'n8n is told which approved bid to enter');
    const notApproved = (await call('GET', '/api/state')).body.bid_requests.flatMap(b => b.bids).find(b => b.status === 'superseded');
    const refused = await call('POST', '/api/webhooks/bid/entered', { bid_id: notApproved.id, wo_ref: '9999' }, H);
    assert.equal(refused.status, 409, 'a losing bid can never become a work order');
    const done = await call('POST', '/api/webhooks/bid/entered', { bid_id: todo[0].id, wo_ref: 'WO-4821' }, H);
    assert.equal(done.status, 200);
    const s = (await call('GET', '/api/state')).body;
    assert.equal(s.bid_requests.flatMap(b => b.bids).find(b => b.id === todo[0].id).wo_ref, 'WO-4821');
    assert.ok(s.events.some(e => /WO-4821 entered/.test(e.label) && /notified/.test(e.label)));
  });
  await check('rejecting a line item sends nothing, keeps the reason, and hands it back to a human', async () => {
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const req = await call('POST', '/api/webhooks/bid-request', { line_item: 'INSULATION', home_id: JOB, execution_id: 'br-3' }, H);
    await call('POST', `/api/approvals/${req.body.id}/approve`, {});
    const bid = await call('POST', '/api/webhooks/bid', { bid_request_id: req.body.bid_request_id, vendor_id: 'vendor-insulation', amount: '$31,000', external_id: 'b9' }, H);
    assert.equal(bid.body.asked_for_decision, true, 'a sole-sourced request is complete on the first bid');
    const bare = await call('POST', `/api/approvals/${bid.body.approval_id}/reject`, {});
    assert.equal(bare.status, 400, 'a rejection with no reason is refused by the server, not just the page');
    const out = await call('POST', `/api/approvals/${bid.body.approval_id}/reject`, { note: 'scope is missing the garage' });
    assert.equal(out.status, 200);
    const br = (await call('GET', '/api/state')).body.bid_requests.find(b => b.id === req.body.bid_request_id);
    assert.equal(br.status, 'partial', 'the line item goes back to a human until another bid arrives');
    assert.notEqual(br.status, 'awarded');
    assert.ok(br.bids.every(b => b.status === 'rejected' && !b.wo_ref), 'nothing entered');
    assert.match(br.notes || br.bids[0].reject_reason, /garage/);
  });
  await check('an overdue request is chased, never left silent', async () => {
    const dbFile = require('node:sqlite'); const raw = new dbFile.DatabaseSync(path.join(dataDir, 'mcvaugh-world.sqlite'));
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const req = await call('POST', '/api/webhooks/bid-request', { line_item: 'ELECTRICAL', home_id: JOB, execution_id: 'br-4',
      vendors: ['vendor-electrical', 'vendor-low-voltage'], expected: 2 }, H);
    await call('POST', `/api/approvals/${req.body.id}/approve`, {});
    await call('POST', '/api/webhooks/bid', { bid_request_id: req.body.bid_request_id, vendor_id: 'vendor-electrical', amount: '$60,000', external_id: 'b10' }, H);
    raw.prepare("UPDATE bid_requests SET due_by = ? WHERE id = ?").run(new Date(Date.now() - 864e5).toISOString(), req.body.bid_request_id);
    raw.close();
    await call('POST', '/api/bids/sweep', {});
    const s = (await call('GET', '/api/state')).body;
    const br = s.bid_requests.find(b => b.id === req.body.bid_request_id);
    assert.equal(br.status, 'overdue');
    const ap = s.approvals.find(a => a.bid_request_id === br.id && a.kind === 'bid_chase' && a.status === 'pending');
    assert.ok(ap, 'a passed date raises a question instead of stalling quietly');
    assert.match(ap.question, /chase/i);
    const opts = JSON.parse(ap.options); assert.ok(opts.some(o => o.id === 'decide') && opts.some(o => o.id === 'chase'));
    await call('POST', `/api/approvals/${ap.id}/approve`, { chosen: 'decide' });
    const after = (await call('GET', '/api/state')).body;
    assert.ok(after.approvals.some(a => a.bid_request_id === br.id && a.kind !== 'bid_chase' && a.status === 'pending'), 'deciding early asks about the bid that did arrive');
  });
  setBidFlow('parked');
  await check('a Teams-channel decision must carry a name and a reason, recorded as self-declared', async () => {
    const r = await call('POST', '/api/work-orders/request', { vendor_id: 'vendor-stucco', home_id: JOB, amount: '$18,000', description: 'courtyard walls' });
    assert.equal(r.status, 200);
    const dbFile = require('node:sqlite'); const raw = new dbFile.DatabaseSync(path.join(dataDir, 'mcvaugh-world.sqlite'));
    const t = raw.prepare('SELECT token FROM approvals WHERE id = ?').get(r.body.id).token; raw.close();
    const post = (body) => fetch(`${B}/approve/${r.body.id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    assert.match(await (await post(`t=${t}&d=approve`)).text(), /Choose your name/, 'the purchasing channel is not a person');
    assert.match(await (await post(`t=${t}&d=reject&by=brittany`)).text(), /Say why/, 'a rejection without a reason is refused');
    assert.equal((await post(`t=${t}&d=approve&by=brittany`)).status, 200);
    const a = (await call('GET', '/api/state')).body.approvals.find(x => x.id === r.body.id);
    assert.equal(a.decided_by, 'brittany'); assert.equal(a.identity, 'self_declared'); assert.equal(a.decided_via, 'teams-link');
  });
  await check("Maria's answer is stored with provenance and linked to both procedures", async () => {
    const s = (await call('GET', '/api/state')).body;
    const d = s.documents.find(x => x.id === 'doc-maria-bid-process-answer');
    assert.equal(d.meeting_date, '2026-10-24'); assert.equal(d.cite_key, 'M-chat 10/24');
    assert.match(d.content, /work order entered\/ approved/);
    assert.match(d.summary, /more than one bid/);
    for (const t of ['tr-wo-entry-from-bid', 'tr-bid-requests'])
      assert.ok(JSON.parse(s.tasks.find(x => x.id === t).doc_ids || '[]').includes('doc-maria-bid-process-answer'), t + ' cites her answer');
    assert.ok(s.decisions.some(x => x.id === 'dec-bid-rule' && /due date/i.test(x.reason)));
  });
  await check('a pasted ChatGPT skill becomes a procedure, keeps its text, and reaches the ops hub', async () => {
    const skill = `# Enter a Work Order from an Approved Bid\n\n## When to use\nA subcontractor has sent an approved bid and it needs to go into the MCH database.\n\n## You will need\n- The bid PDF\n- The job address\n\n## Steps\n1. Confirm the bid is within the budget line.\n2. Open the database and start a new work order.\n3. Enter vendor, job, cost code, description and amount.\n4. For per-square-foot vendors enter the square footage.\n5. Save. Johnston Waterproofing gets an email saying it is approved.\n\n## Approval\nBrittany or Ernesto confirms before saving. Over budget goes to Jim.\n\n## Notes\nJohnston Waterproofing is standard pricing, no square footage needed.`;
    const r = await call('POST', '/api/procedures/paste', { text: skill });
    assert.equal(r.status, 200); assert.equal(r.body.updated, false);
    const p = r.body.parsed;
    assert.equal(p.title, 'Enter a Work Order from an Approved Bid');
    assert.match(p.trigger, /subcontractor has sent an approved bid/);
    assert.equal(p.steps.length, 5);
    assert.match(p.approval_rules, /Over budget goes to Jim/);
    assert.ok(r.body.vendors.some(v => /Johnston/i.test(v.name || '')), 'the vendor it names is linked');
    assert.deepEqual(r.body.vendors.map(v => v.id), ['vendor-waterproofing-and-overlay'],
      'only the vendor actually named: a substring test would also match the roofer inside "waterproofing"');
    assert.match(p.inputs, /bid PDF\n/, 'listed inputs stay one per line');
    const s = (await call('GET', '/api/state')).body;
    const t = s.tasks.find(x => x.id === r.body.id);
    assert.equal(t.documented, 1); assert.equal(t.owner_id, 'brittany'); assert.equal(t.board, 'working');
    assert.match(t.steps, /^1\. Confirm the bid/);
    assert.match(t.missing_info, /standard pricing/, 'anything it could not place is kept, not dropped');
    const d = s.documents.find(x => x.id === r.body.doc_id);
    assert.equal(d.content, skill, 'the skill text is kept word for word so it can be rebuilt');
    assert.ok(JSON.parse(t.doc_ids || '[]').includes(r.body.doc_id));
    // it shows up in the regenerated ops hub as a current process
    const html = (await call('GET', '/api/export/opshub')).body;
    const hub = require(path.join(__dirname, '..', 'server', 'imports.js')).parseOpsHub(html);
    const proc = hub.processes.find(x => x.id === r.body.id);
    assert.ok(proc, 'the pasted procedure reaches the MCH ops page');
    assert.equal(proc.status, 'current'); assert.equal(proc.steps.length, 5);
  });
  await check('pasting the same procedure again updates it instead of making a second one', async () => {
    const before = (await call('GET', '/api/state')).body.tasks.length;
    const r = await call('POST', '/api/procedures/paste', { text: `# Enter a Work Order from an Approved Bid\n\n## Steps\n1. Only one step now.` });
    assert.equal(r.body.updated, true);
    const s = (await call('GET', '/api/state')).body;
    assert.equal(s.tasks.length, before, 'no duplicate procedure');
    assert.match(s.tasks.find(t => t.id === r.body.id).steps, /Only one step now/);
  });
  await check('a plain skill with no headings still yields steps', async () => {
    const r = await call('POST', '/api/procedures/paste', { text: 'Back charge a subcontractor\n\n1. Photograph the damage.\n2. Get a repair price.\n3. Tell the sub in writing before deducting.\n4. Enter the back charge against their next draw.' });
    assert.equal(r.body.parsed.title, 'Back charge a subcontractor');
    assert.equal(r.body.parsed.steps.length, 4);
  });
  await check('the running log lands on the vendors it names and becomes their work-order instruction', async () => {
    const log = `| Vendor | Job | Detail | Updated |\n|---|---|---|---|\n| Johnston Waterproofing | | standard pricing, reusable, no square footage | 10/21 |\n| Dependable Home Builders | | work order needs total covered square footage | 10/26 |\nNot A Real Vendor Ltd — something special`;
    const r = await call('POST', '/api/specifics/paste', { text: log });
    assert.equal(r.status, 200); assert.equal(r.body.count, 3); assert.equal(r.body.matched, 2);
    const s = (await call('GET', '/api/state')).body;
    const jw = s.vendors.find(v => /johnston/i.test(v.vendor || ''));
    assert.match(jw.wo_instructions, /no square footage/, 'a vendor-wide note becomes the work-order instruction');
    assert.equal(jw.wo_review, 'reviewed');
    assert.ok(s.wo_specifics.some(x => x.vendor_id === jw.id && x.scope === 'vendor' && x.noted_on === '10/21'));
    assert.ok(s.wo_specifics.some(x => !x.vendor_id && /Not A Real Vendor/.test(x.vendor_name)), 'an unmatched row is kept, not dropped');
    // re-pasting updates rather than duplicating
    const again = await call('POST', '/api/specifics/paste', { text: `Johnston Waterproofing — standard pricing, now also does overlays` });
    assert.equal(again.body.count, 1);
    const s2 = (await call('GET', '/api/state')).body;
    const logRows = s2.wo_specifics.filter(x => x.vendor_id === jw.id && x.id.startsWith('ws-vendor-'));
    assert.equal(logRows.length, 1, 'one row per vendor from the log, updated in place');
    assert.match(logRows[0].detail, /overlays/);
  });
  await check('a per-job specific is kept against that job, separately from the vendor-wide one', async () => {
    const r = await call('POST', '/api/specifics/paste', { text: `Vendor\tJob\tDetail\nDependable Home Builders\t${(await call('GET', '/api/state')).body.homes.find(h => h.active === 'active').address}\tbalcony framing is excluded on this one` });
    assert.equal(r.body.matched, 1);
    const row = (await call('GET', '/api/state')).body.wo_specifics.find(x => /balcony framing/.test(x.detail));
    assert.equal(row.scope, 'vendor_job'); assert.ok(row.home_id && row.vendor_id);
  });
  await check('pasting a procedure needs write access and an actual paste', async () => {
    const thin = await call('POST', '/api/procedures/paste', { text: 'too short' });
    assert.equal(thin.status, 400);
    const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.viewer });
    const denied = await call('POST', '/api/procedures/paste', { text: 'x'.repeat(40) });
    assert.equal(denied.status, 403);
    cookie = admin;
  });
  await check('a skill pasted straight out of the ChatGPT dialog loses the UI chrome and keeps its phases', async () => {
    const imp = require(path.join(__dirname, '..', 'server', 'imports.js'));
    const text = fs.readFileSync(path.join(__dirname, '..', 'seed', 'skills', 'update-gl-insurance.txt'), 'utf8');
    const p = imp.parseSkill(text);
    assert.equal(p.title, 'Update GL Insurance', 'the name comes from the line above the word "Skill", not the dialog heading');
    assert.equal(p.subtitle, 'Update vendor insurance records and file renewals');
    assert.ok(!/^Skills?$/i.test(p.title) && !/Extend ChatGPT/.test(JSON.stringify(p)), 'dialog furniture is dropped');
    assert.match(p.trigger, /Follow Maria's insurance certificate procedure/);
    assert.match(p.inputs, /Copy of GL Insurance and workers comp/, 'the authoritative locations land as inputs');
    assert.equal(p.step_count, 14);
    const phases = p.steps.filter(x => !/^\d+\./.test(x));
    assert.deepEqual(phases, ['Certificate and register', 'Certificate filing', 'BuildConnect legacy contact update', 'Accounting handoff', 'Finish: save, verify, and close Excel']);
    assert.ok(p.steps.indexOf('Certificate filing') > p.steps.findIndex(x => /^1\./.test(x)), 'phases stay in place among the steps');
  });
  await check('the GL insurance procedure is filed, supersedes the stub, and reaches the ops page', async () => {
    const s = (await call('GET', '/api/state')).body;
    const t = s.tasks.find(x => x.id === 'sop-update-gl-insurance');
    assert.ok(t); assert.equal(t.documented, 1); assert.equal(t.backup_id, 'kenneth');
    assert.deepEqual(JSON.parse(t.supersedes), ['tr-vendor-onboarding-insurance']);
    assert.match(t.steps, /BuildConnect legacy contact update/);
    assert.match(t.missing_info, /four places/, 'the four-system gap is recorded, not glossed');
    const d = s.documents.find(x => x.id === 'doc-sop-update-gl-insurance');
    assert.equal(d.content, fs.readFileSync(path.join(__dirname, '..', 'seed', 'skills', 'update-gl-insurance.txt'), 'utf8'));
    // the L: files it depends on are named but honestly marked unreachable
    for (const id of ['doc-insurance-procedure-docx', 'doc-gl-register-xls']) {
      const doc = s.documents.find(x => x.id === id);
      assert.equal(doc.underlying_status, 'not_attached'); assert.match(doc.path, /^L:\\/);
    }
    // the quirks a successor would otherwise rediscover
    assert.equal(s.wo_specifics.filter(x => x.task_id === 'sop-update-gl-insurance').length, 3);
    assert.ok(s.wo_specifics.some(x => /blue text means the UI accepted it, not that it saved/.test(x.detail)));
    const html = (await call('GET', '/api/export/opshub')).body;
    const hub = require(path.join(__dirname, '..', 'server', 'imports.js')).parseOpsHub(html);
    const proc = hub.processes.find(x => x.id === 'sop-update-gl-insurance');
    assert.ok(proc, 'it reaches the MCH ops page'); assert.equal(proc.status, 'current');
    assert.ok(hub.processes.find(x => x.id === 'vendor_onboarding_insurance' || x.id === 'tr-vendor-onboarding-insurance'));
  });
  await check('what the insurance skill settles and what it leaves open is recorded', async () => {
    const ho = (await call('GET', '/api/handover?person=maria')).body;
    const h = ho.items.find(i => i.id === 'ho-vendor-insurance');
    assert.match(h.documented, /yes for renewals/);
    assert.match(h.why, /Owner settled on 3 November: James/, 'the owner question is closed, the warning gap is not');
    assert.match(h.why, /nothing tells anyone a certificate is about to lapse/);
    assert.ok(h.doc_ids.includes('doc-sop-update-gl-insurance') && h.task_ids.includes('sop-update-gl-insurance'));
    const s = (await call('GET', '/api/state')).body;
    assert.ok(s.decisions.some(d => d.id === 'dec-insurance-owner' && d.status === 'accepted'), 'James owns it from 3 November');
    assert.equal(s.tasks.find(t => t.id === 'sop-update-gl-insurance').owner_id, 'james');
    const stub = s.tasks.find(t => t.id === 'tr-vendor-onboarding-insurance');
    assert.equal(stub.documented, 0, 'signing up a NEW vendor is still undocumented');
    assert.match(stub.missing_info, /still only in Maria/);
  });
  await check('an ops hub that this app did not generate is never overwritten', async () => {
    const imp = require(path.join(__dirname, '..', 'server', 'imports.js'));
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.template.html'), 'utf8');
    const generated = (await call('GET', '/api/export/opshub')).body;
    assert.match(generated, /regenerated by McVaugh Operations World/, 'what this app writes carries a marker');
    const handBuilt = '<html><head></head><body>vendor rules, ROCC toggle, historical records</body></html>';
    assert.ok(!handBuilt.includes('regenerated by McVaugh Operations World'),
      'a hub edited elsewhere has no marker, which is how the writer knows to leave it alone');
    assert.ok(tpl.length > 0);
  });
  await check('the hub session of 3 November is recorded: Lonnie, Maria\'s date, vendor rules, SOPs still to paste', async () => {
    const s = (await call('GET', '/api/state')).body;
    const lonnie = s.people.find(p => p.id === 'lonnie');
    assert.ok(lonnie, 'Maria has a named successor now'); assert.equal(lonnie.confirmed, 0, 'not verified with Lonnie directly');
    assert.match(lonnie.notes, /surname and email are the outstanding piece/, 'still the one gap on Lonnie');
    assert.match(s.people.find(p => p.id === 'maria').notes, /DEPARTED 6 November 2026/, 'she has now left');
    assert.ok(s.tasks.filter(t => t.backup_id === 'lonnie').length >= 10, 'Maria\'s construction work has a backup at last');
    // The hub's short rules were replaced by the fuller running log on 4 November; the codes survive.
    const byVendor = n => s.wo_specifics.find(x => new RegExp(n, 'i').test(x.vendor_name || ''));
    assert.match(byVendor('Autumn').detail, /60%\/30%\/10%/);
    // Johnston's row is rewritten by the running-log test above, so assert the codes where they are stable.
    assert.match(s.documents.find(d => d.id === 'doc-running-log-2026-11-03').content, /code 409/);
    assert.equal(s.vendors.find(v => v.id === 'vendor-lowes').vendor, 'Lowes Home Centers, Inc.',
      'Lowes was in the rules but had no vendor record for them to attach to');
    assert.ok(s.wo_specifics.some(x => x.id === 'ws-rule-hoa-all'), 'the HOA-wide rule has no single vendor, so it stays');
    // the clash turned out to be two real plumbing vendors, so it was resolved rather than left flagged
    assert.ok(!s.wo_specifics.some(x => x.id === 'ws-rule-plumbing-conflict'), 'the conflict row is cleared once answered');
    const plumbers = s.vendors.filter(v => v.trade === 'PLUMBING').map(v => v.vendor).sort();
    assert.deepEqual(plumbers, ['GT Plumbing', 'Reece Plumbing'], 'both are current plumbing vendors');
    assert.match(s.wo_specifics.find(x => x.vendor_id === 'vendor-plumbing-reece').detail, /601/);
    assert.match(s.wo_specifics.find(x => x.id === 'ws-rule-plumbing-two-vendors').detail, /not interchangeable/);
    // the seven the hub named now carry their steps, read out of the hub export
    assert.equal(s.tasks.filter(t => t.id.startsWith('sop-') && !t.steps).length, 0, 'none left waiting for a paste');
    const wo = s.tasks.find(t => t.id === 'sop-pur-01-wo-entry-buildconnect');
    assert.equal(wo.documented, 1); assert.match(wo.steps, /^1\. Read the source estimate/);
    assert.equal(wo.owner_id, 'james', 'the 3 November session moved WO/PO entry to James');
    assert.equal(s.tasks.find(t => t.id === 'sop-permitting-ipermits-projectdox').owner_id, 'lonnie');
    assert.equal(s.tasks.find(t => t.id === 'sop-fin-01-cash-flow-rollover').owner_id, 'brittany');
    assert.ok(s.documents.some(d => d.id === 'doc-hub-gl-insurance-steps'), 'the hub\'s longer GL version is kept beside the skill, not merged over it');
    assert.match(s.tasks.find(t => t.id === 'sop-update-gl-insurance').missing_info, /21 steps and the ChatGPT skill as 14/);
    assert.equal(s.people.find(p => p.id === 'maria').full_name, 'Maria Abney', 'full names came from the hub');
    // Left open on 3 November, answered by Maria on the 4th.
    assert.ok(s.decisions.some(d => d.id === 'dec-purchasing-split-lonnie-james' && d.status === 'accepted'));
  });
  await check('GL insurance: James owns it, and the register mirror warns before a certificate lapses', async () => {
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10);
    const r = await call('POST', '/api/insurance/paste', { text:
      `Vendor\tGL Expires\tWC Expires\nJohnston Waterproofing\t${soon}\t${far}\nSynergy Roofing\t${past}\t\nNot On File Ltd\t${far}\t` });
    assert.equal(r.status, 200); assert.equal(r.body.count, 3); assert.equal(r.body.matched, 2);
    const s = (await call('GET', '/api/state')).body;
    const jw = s.insurance.find(x => /Johnston/i.test(x.vendor));
    assert.equal(jw.standing, 'expiring'); assert.ok(jw.days > 0 && jw.days <= 30);
    assert.equal(s.insurance.find(x => /Synergy/i.test(x.vendor)).standing, 'expired');
    assert.equal(s.insurance[0].standing, 'expired', 'worst first');
    assert.ok(s.insurance_unknown > 0, 'vendors with no date are counted, so the gap is visible');
    // dates survive a re-paste and update in place
    const again = await call('POST', '/api/insurance/paste', { text: `Synergy Roofing ${far}` });
    assert.equal(again.body.matched, 1);
    assert.equal((await call('GET', '/api/state')).body.insurance.find(x => /Synergy/i.test(x.vendor)).standing, 'ok');
    assert.equal((await call('POST', '/api/insurance/paste', { text: 'nothing here' })).status, 400);
  });
  await check('a GL expiry inside 60 days raises the renewal once, and approving releases the four updates', async () => {
    const soon = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 320 * 864e5).toISOString().slice(0, 10);
    await call('POST', '/api/insurance/paste', { text: `Reece Plumbing\t${soon}` });
    let s = (await call('GET', '/api/state')).body;
    const ap = s.approvals.find(a => a.kind === 'insurance_renewal' && /Reece/.test(a.subject));
    assert.ok(ap, 'the warning raises the renewal by itself');
    assert.match(ap.question, /expires in 4[0-9] days/);
    assert.match(ap.question, /Nothing is written anywhere until then/);
    assert.equal(ap.requested_from, 'james');
    assert.match(ap.draft, /Then update/, 'the card names all four places');
    assert.equal(s.agents.find(a => a.id === 'agent-vendor-compliance').runtime.status, 'waiting');
    // raised once per renewal cycle, not every sweep
    await call('POST', '/api/insurance/sweep', {});
    await call('POST', '/api/insurance/sweep', {});
    s = (await call('GET', '/api/state')).body;
    assert.equal(s.approvals.filter(a => a.kind === 'insurance_renewal' && /Reece/.test(a.subject)).length, 1, 'asked once, not every sweep');
    // n8n cannot write anything before a person approves
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const early = await call('POST', '/api/webhooks/insurance/updated', { approval_id: ap.id, updated: ['GL register spreadsheet'] }, H);
    assert.equal(early.status, 409, `nothing is written on an unapproved renewal (got ${early.status}: ${JSON.stringify(early.body)})`);
    await call('POST', `/api/approvals/${ap.id}/approve`, { note: 'certificate checked against the PDF' });
    const queue = (await call('GET', '/api/webhooks/work', null, H)).body.update_insurance;
    assert.ok(queue.some(q => q.id === ap.id), 'only now is it queued for the four updates');
    assert.equal(queue.find(q => q.id === ap.id).targets.length, 4);
    // a half-finished update is reported as such, not as success
    const partial = await call('POST', '/api/webhooks/insurance/updated', { approval_id: ap.id, updated: ['GL register spreadsheet', 'Certificate folder'], gl_expiry: far }, H);
    assert.equal(partial.status, 200);
    assert.equal(partial.body.still_missing.length, 2);
    s = (await call('GET', '/api/state')).body;
    assert.ok(s.events.some(e => /updated 2 of 4/.test(e.label) && e.status === 'failed'), 'a partial update shows as failed, not finished');
    assert.equal(s.insurance.find(x => /Reece/i.test(x.vendor)).gl_expiry, far, 'the new expiry is recorded');
  });
  await check('the insurance renewal is recorded as an automation with one human gate, not as a consolidation', async () => {
    const s = (await call('GET', '/api/state')).body;
    const t = s.tasks.find(x => x.id === 'sop-update-gl-insurance');
    assert.match(t.missing_info, /has to appear in all four places/, 'four systems is by design, not a defect');
    assert.match(t.automation_approach, /legacy \.xls/); assert.match(t.automation_approach, /blue text is not proof/);
    const ag = s.agents.find(a => a.id === 'agent-vendor-compliance');
    assert.equal(ag.enabled, 0); assert.match(ag.human_authority, /checks the extracted dates against the certificate/);
    assert.ok(s.decisions.some(d => d.id === 'dec-insurance-four-places' && d.status === 'accepted'));
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'mow-gl-insurance.json'), 'utf8'));
    assert.equal(wf.active, false);
    assert.ok(JSON.stringify(wf).includes('/api/webhooks/insurance/updated'));
  });
  await check('the 3 November house-by-house meeting is stored and the four villas carry its status', async () => {
    const s = (await call('GET', '/api/state')).body;
    const d = s.documents.find(x => x.id === 'doc-meeting-james-2026-11-03');
    assert.ok(d); assert.equal(d.meeting_date, '2026-11-03'); assert.equal(d.cite_key, 'J 11/03');
    assert.deepEqual(JSON.parse(d.attendees).sort(), ['brittany', 'james', 'lonnie']);
    assert.match(d.summary, /automatic transcript with heavy crosstalk/i, 'the transcript\'s reliability is stated, not glossed');
    const cited = s.homes.filter(h => h.status_cite === '[J 11/03]');
    assert.equal(cited.length, 5); assert.ok(cited.every(h => h.active === 'active' && h.stage && h.next_milestone));
    const h607 = s.homes.find(h => /11607 Royal Parkside/.test(h.address));
    assert.match(h607.issues, /no mechanical work order/);
    assert.match(h607.next_milestone, /Trusses arrive 4 Nov/);
    assert.match(s.homes.find(h => /11602 Royal Parkside/.test(h.address)).issues, /oven handle/);
    // six follow-ups, each owned by a person rather than left in the transcript
    const f = s.tasks.filter(t => t.id.startsWith('j1103-'));
    assert.equal(f.length, 6); assert.ok(f.every(t => t.owner_id && t.next_action));
    assert.equal(f.find(t => t.id === 'j1103-townhome-permits').owner_id, 'lonnie');
    // and the duplicate vendor lists are raised rather than one being picked
    assert.match(s.wo_specifics.find(x => x.id === 'ws-vendor-list-duplication').detail, /neither is wrong/);
    assert.match(s.people.find(p => p.id === 'lonnie').role_summary, /11603 and 11607/);
  });
  await check('Maria\'s split holds: Lonnie judges the bid, James raises the work order', async () => {
    const s = (await call('GET', '/api/state')).body;
    const d = s.decisions.find(x => x.id === 'dec-purchasing-split-lonnie-james');
    assert.equal(d.status, 'accepted'); assert.match(d.reason, /judgment versus entry/);
    assert.match(s.documents.find(x => x.id === 'doc-maria-purchasing-split').content, /matches the specifications provided/);
    // judgment follows Lonnie, entry follows James
    for (const id of ['tr-bids-and-sqft-rates', 'tr-schedule-and-trade-coordination', 'tr-field-verification-and-draws'])
      assert.equal(s.tasks.find(t => t.id === id).owner_id, 'lonnie', id + ' is judgment');
    for (const id of ['tr-purchase-orders-materials', 'tr-wo-entry-from-bid'])
      assert.equal(s.tasks.find(t => t.id === id).owner_id, 'james', id + ' is entry');
    // the routing follows the rule, not just the text
    const r = await call('POST', '/api/work-orders/request', { vendor_id: 'vendor-plumbing', amount: '$1,000' });
    assert.equal(s.tasks.find(t => t.id === 'tr-wo-entry-from-bid').backup_id, 'lonnie');
    const ap = (await call('GET', '/api/state')).body.approvals.find(a => a.id === r.body.id);
    assert.equal(ap.requested_from, 'james');
    const over = await call('POST', '/api/work-orders/request', { vendor_id: 'vendor-plumbing', amount: '$99,000', over_budget: true });
    assert.equal((await call('GET', '/api/state')).body.approvals.find(a => a.id === over.body.id).requested_from, 'jim');
    // and the gap it opens is recorded rather than assumed away
    const cap = s.tasks.find(t => t.id === 'tr-lonnie-bid-review-handover');
    assert.ok(cap); assert.match(cap.missing_info, /only in her head/);
    assert.equal(s.handover_items.find(h => h.id === 'ho-bids-vendors').risk, 'high');
  });
  await check('the Landing scope is filed with McVaugh\'s own items and the contradictions raised, not smoothed over', async () => {
    const s = (await call('GET', '/api/state')).body;
    const d = s.documents.find(x => x.id === 'doc-rol-scope-2026-10-14');
    assert.ok(d); assert.equal(d.cite_key, 'ROL SOW 10/14'); assert.match(d.content, /REMAINING ALLOWANCES/);
    // the four (by owner) items are McVaugh's scope
    const scope = s.tasks.find(t => t.id === 'tr-landing-frank-scope');
    assert.equal(scope.documented, 1); assert.equal(scope.owner_id, 'lonnie');
    for (const bit of [/Geotechnical/, /Form survey and final survey/, /impact fees/])
      assert.match(scope.steps, bit);
    assert.match(scope.missing_info, /applies to what comes before it or everything after/, 'the ambiguous marker is flagged, not resolved by guessing');
    // the money question is an open decision rather than an answer
    const dec = s.decisions.find(x => x.id === 'dec-rol-allowance-or-standard');
    assert.equal(dec.status, 'open'); assert.match(dec.reason, /\$98,700/); assert.match(dec.reason, /Both cannot be true/);
    // the document errors are listed for one message to Frank
    const errs = s.tasks.find(t => t.id === 'tr-rol-document-errors');
    assert.match(errs.steps, /ten items" introduces a list of eleven/);
    assert.match(errs.steps, /second to third floor/, 'the three-storey carpet line on a two-storey plan is caught');
    assert.match(errs.steps, /lot and block/);
    // and it closes something Maria owed
    const h = s.handover_items.find(x => x.id === 'ho-landing-frank');
    assert.equal(h.status, 'captured'); assert.match(h.note, /RECEIVED 4 November/);
    assert.ok(JSON.parse(h.doc_ids).includes('doc-rol-scope-2026-10-14'));
  });
  await check('the hub parser reads the data even when new components are declared before the app', async () => {
    const imp = require(path.join(__dirname, '..', 'server', 'imports.js'));
    const seedDir = path.join(__dirname, '..', 'seed');
    // Codex added ReviewDocument and CurrentReview, both JSX, above MCHOpsHub on 4 November. Slicing the
    // script up to the component then evaluating it chokes on the JSX, so each constant is read on its own.
    const nov4 = imp.parseOpsHub(fs.readFileSync(path.join(seedDir, 'mch-ops-hub-2026-11-04.html'), 'utf8'));
    assert.ok(nov4, 'the 4 November hub parses');
    assert.equal(nov4.processes.length, 35); assert.equal(nov4.team.length, 9);
    assert.equal(nov4.review_documents.length, 3, 'the new review-documents panel is read too');
    assert.ok(nov4.vendor_rules.length >= 8);
    const nov3 = imp.parseOpsHub(fs.readFileSync(path.join(seedDir, 'mch-ops-hub-2026-11-03.html'), 'utf8'));
    assert.equal(nov3.processes.length, 33, 'the earlier hub still parses the same way');
    // nothing was dropped between the two
    const before = new Set(nov3.processes.map(p => p.id));
    assert.equal(nov3.processes.filter(p => !nov4.processes.some(q => q.id === p.id)).length, 0, 'no SOP was removed');
    assert.deepEqual([...nov4.processes.filter(p => !before.has(p.id)).map(p => p.id)].sort(), ['cbusa_current', 'changes_current']);
    // and a hub regenerated from the current template still parses back
    const html = (await call('GET', '/api/export/opshub')).body;
    const back = imp.parseOpsHub(html);
    assert.ok(back && back.processes.length > 30, 'the regenerated hub round-trips');
    assert.match(html, /regenerated by McVaugh Operations World/);
  });
  await check('the permitting procedure is marked unverified, with the invented jurisdictions recorded', async () => {
    const s = (await call('GET', '/api/state')).body;
    const t = s.tasks.find(x => x.id === 'sop-permitting-ipermits-projectdox');
    assert.equal(t.documented, 0, 'drafted from review notes is not documented');
    assert.match(t.title, /not yet verified/);
    assert.match(t.missing_info, /Cedar Park appears nowhere/);
    assert.match(t.missing_info, /City of Houston iPermits/);
    assert.match(t.next_action, /Do not restore the 14-step version/);
    assert.ok(s.decisions.some(d => d.id === 'dec-permitting-source-of-truth' && d.status === 'open'));
    // the 2004 legacy one is the only permitting procedure checked against Maria
    const legacy = s.tasks.find(x => x.id === 'hub-permitting');
    assert.ok(legacy.step_review, 'the legacy SOP carries its reconciliation');
    assert.equal(t.step_review, null, 'the current one does not');
  });
  await check('the merge is recorded on each procedure, with what was put back and what is still open', async () => {
    const s = (await call('GET', '/api/state')).body;
    const wo = s.tasks.find(t => t.id === 'sop-pur-01-wo-entry-buildconnect');
    assert.match(wo.missing_info, /^Merged 8 November/);
    assert.match(wo.missing_info, /calendar-persistence workaround/, 'names what was restored');
    assert.match(wo.missing_info, /Not yet walked through with James/, 'and what is still unverified');
    assert.equal(wo.verified, 0);
    const po = s.tasks.find(t => t.id === 'sop-pur-02-material-po-entry');
    assert.match(po.missing_info, /^Merged 8 November/);
    assert.match(po.missing_info, /996/);
    assert.match(po.blocker, /no spending authority boundary has been set/);
    // the question the rewrite deleted survives both as a step and as a decision
    assert.ok(s.decisions.some(d => d.id === 'dec-material-po-authority' && d.status === 'open'));
  });
  await check('both purchasing procedures are merged: mechanics restored, 4 November caveats kept', async () => {
    const s = (await call('GET', '/api/state')).body;
    const wo = s.tasks.find(t => t.id === 'sop-pur-01-wo-entry-buildconnect');
    const po = s.tasks.find(t => t.id === 'sop-pur-02-material-po-entry');
    assert.equal(wo.documented, 1); assert.equal(po.documented, 1);
    assert.equal(wo.steps.split(/\n(?=\d+\. )/).length, 15);
    assert.equal(po.steps.split(/\n(?=\d+\. )/).length, 14);
    // the mechanics the rewrite dropped are back
    for (const bit of ['New Work Order in the BuildConnect frame', 'reloads the form', 'passcode-box Enter step',
      'completion and payment flags unset', 'Never create a duplicate', 'failed to persist',
      'Synergy roofing: 30/50/20', 'code 620', 'code 601'])
      assert.ok(wo.steps.includes(bit), 'work order kept: ' + bit);
    for (const bit of ['New Purchase Order', '996 for Lowe', 'single draw for a standalone',
      'recalculates after blur', 'proposal date for proposal-based orders', 'and the cost code',
      'separate thing from Received'])
      assert.ok(po.steps.includes(bit), 'material PO kept: ' + bit);
    // and the caveats the rewrite added are still there
    for (const bit of ['not spending approval', 'Do not substitute the bill-to address', 'never agreed as a standing commitment'])
      assert.ok(wo.steps.includes(bit), 'work order kept the new caveat: ' + bit);
    for (const bit of ['rather than copying Maria out of habit', 'does not establish that a PO was delivered', 'before 9 AM'])
      assert.ok(po.steps.includes(bit), 'material PO kept the new caveat: ' + bit);
    // the question the rewrite deleted is visible in the procedure, not just in a decision
    assert.match(po.steps, /STILL OPEN/);
    assert.match(po.blocker, /no spending authority boundary/);
    assert.ok(s.decisions.some(d => d.id === 'dec-material-po-authority' && d.status === 'open'));
  });
  await check('the 6 November all-office handover is stored with its follow-ups and the portal identity gap', async () => {
    const s = (await call('GET', '/api/state')).body;
    const d = s.documents.find(x => x.id === 'doc-meeting-alloffice-2026-11-06');
    assert.ok(d); assert.equal(d.cite_key, 'ALL 11/06');
    assert.equal(JSON.parse(d.attendees).length, 6);
    assert.match(d.summary, /speaker labels in this transcript are wrong/i, 'the transcript\'s reliability is stated');
    // six follow-ups, each with an owner
    const f = s.tasks.filter(t => t.id.startsWith('a1106-'));
    assert.equal(f.length, 6); assert.ok(f.every(t => t.owner_id && t.next_action));
    assert.equal(f.find(t => t.id === 'a1106-hub-access').board, 'working');
    // the portal identity problem is now high risk and names the cause
    const ho = (await call('GET', '/api/handover?person=maria')).body.items.find(i => i.id === 'ho-portal-logins');
    assert.equal(ho.risk, 'high'); assert.equal(ho.status, 'open');
    assert.match(ho.why, /registered to M\. Abney/);
    assert.match(ho.capture, /single most urgent item/);
    // the GL check Maria described is on the procedure
    const gl = s.tasks.find(t => t.id === 'sop-update-gl-insurance');
    assert.match(gl.trigger, /every other week/); assert.match(gl.trigger, /yellow/);
    assert.match(gl.evidence, /builder.s risk only/);
    // and the two-approval rule is recorded
    assert.ok(s.decisions.some(x => x.id === 'dec-budget-increase-approvals' && x.status === 'accepted'));
  });
  await check('nothing is left with Maria or on the purchasing list; every item went somewhere or was struck off', async () => {
    const s = (await call('GET', '/api/state')).body;
    const R = id => JSON.parse(s.people.find(p => p.id === id).responsibilities || '[]');
    const X = id => JSON.parse(s.people.find(p => p.id === id).crossed_off || '[]');
    assert.equal(R('maria').length, 0, 'Maria holds nothing, even after the hub was re-imported');
    assert.equal(R('ernesto').length, 0, 'and neither does the purchasing list');
    assert.equal(R('ernesto').length, 0, 'the purchasing list is empty');
    assert.equal(X('maria').length, 24); assert.equal(X('ernesto').length, 7, 'what was struck off is kept, not deleted');
    // Earlier tests in this run import a pre-handover hub snapshot, and an import overrides by design,
    // so the live lists here reflect that file. What must survive either way is the protection and the
    // record: a departed person is never handed work back, and the removals stay removed.
    assert.ok(X('maria').some(x => /change order budget log/i.test(x)), 'what was struck off is still struck off');
    assert.match(s.people.find(p => p.id === 'maria').notes, /100% overkill/, 'her own verdict on the lists is kept');
    assert.match(s.people.find(p => p.id === 'ernesto').notes, /Nothing remains assigned here/);
    assert.ok(s.decisions.some(d => d.id === 'dec-responsibilities-reassigned' && d.status === 'accepted'));
    assert.ok(s.documents.some(d => d.id === 'doc-meeting-maria-final-2026-11-06'));
  });
  await check('a retired procedure takes its work off every person, not just the SOP list', async () => {
    const s = (await call('GET', '/api/state')).body;
    const R = id => JSON.parse(s.people.find(p => p.id === id).responsibilities || '[]');
    const X = id => JSON.parse(s.people.find(p => p.id === id).crossed_off || '[]');
    const live = s.people.flatMap(p => JSON.parse(p.responsibilities || '[]'));
    assert.ok(!live.some(r => /framed mirror/i.test(r)), 'framed mirrors are gone from everybody, not only from the procedure');
    assert.ok(!live.some(r => /change order log/i.test(r)), 'nobody still reviews or forwards a change order log');
    assert.ok(X('pam').some(r => /framed mirror/i.test(r)), 'and it is struck off, not deleted, so the history reads');
    assert.ok(X('jim').concat(X('kenneth')).some(r => /change order log/i.test(r)));
    const co = s.tasks.find(t => t.id === 'hub-change_order_budget');
    assert.ok(co, 'the replacement procedure is still on the books');
    assert.ok(/2 and \.3 extension/.test(co.steps || ''), 'and a hub snapshot import never puts the 2022 change order log steps back');
    assert.ok(!s.tasks.some(t => t.lifecycle === 'retired' && !t.archived), 'a retired procedure stays retired across an import');
  });
  await check('every hub panel comes from the world — none is left frozen in the template', async () => {
    const fsx = require('fs');
    const html = (await call('GET', '/api/export/opshub')).body;
    const tpl = fsx.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.template.html'), 'utf8');
    // Four panels used to be carried through untouched, so the page showed whatever the 4 November file held.
    const span = (src, name) => {
      const m = new RegExp('const\\s+' + name + '\\s*=\\s*').exec(src); if (!m) return null;
      let i = m.index + m[0].length; const o = src[i]; let depth = 0, inStr = null, esc = false;
      for (let j = i; j < src.length; j++) { const c = src[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'" || c === '`') inStr = c;
        else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') { if (--depth === 0) return src.slice(i, j + 1); } }
      return null;
    };
    for (const name of ['VENDOR_RULES', 'COMPLETED_RECORDS', 'CURRENT_ASSIGNMENTS', 'REVIEW_DOCUMENTS'])
      assert.notEqual(span(html, name), span(tpl, name), `${name} is still the template's copy`);
    const rules = JSON.parse(span(html, 'VENDOR_RULES'));
    assert.ok(rules.some(r => /change orders/i.test(r.vendor) && /\.2 and \.3/.test(r.rules)), 'a rule added today reaches the panel');
    const recs = JSON.parse(span(html, 'COMPLETED_RECORDS'));
    assert.ok(recs.some(r => r.id === 'WO 40184'), 'the entered work orders come out of the world now');
    const asg = JSON.parse(span(html, 'CURRENT_ASSIGNMENTS'));
    assert.deepEqual(asg['sop-pur-01-wo-entry-buildconnect'].owners, ['james']);
    assert.match(asg['sop-pur-01-wo-entry-buildconnect'].label, /backup/);
    // An earlier test parks this one on Maria on purpose; the panel must say she has left, not show her as owner.
    assert.deepEqual(asg['new_work_order'].owners, []);
    assert.match(asg['new_work_order'].label, /has left/);
    assert.ok(Object.values(asg).every(a => a.owners.length || /Nobody holds this|has left/.test(a.label)),
      'an unowned procedure says so rather than showing an empty row');
    // What is left over and not answered — the part the page never carried.
    const docs = JSON.parse(span(html, 'REVIEW_DOCUMENTS'));
    assert.match(docs[0].title, /not settled yet/);
    assert.match(docs[0].markdown, /Waiting on a decision/);
    assert.match(docs[0].markdown, /Procedures with something missing/);
    assert.match(docs[0].markdown, /Proforma/, 'an open decision raised today is on the page');
    assert.ok(docs.length > 1, 'the written review documents are kept underneath it');
  });
  await check('"Construction Assistant" is gone from the hub entirely — the role is Construction and Lonnie holds it', async () => {
    const html = (await call('GET', '/api/export/opshub')).body;
    assert.equal((html.match(/Construction Assistant/gi) || []).length, 0, 'not in the role list, a step, a responsibility or a review document');
    assert.equal((html.match(/construction_asst/g) || []).length, 0, 'and not as an id, including the page\'s own role-matching table');
    assert.equal((html.match(/\bCA\b(?!\w)/g) || []).length, 0, 'nor abbreviated');
    assert.match(html, /"id": "construction",\s*\n\s*"title": "Construction"/);
    const s2 = (await call('GET', '/api/state')).body;
    const lonnie = s2.people.find(p => p.id === 'lonnie');
    assert.deepEqual(JSON.parse(lonnie.legacy_roles), ['Construction']);
    assert.ok(!s2.tasks.some(t => /Construction Assistant|\bCA\b(?!\w)/.test((t.steps || '') + (t.inputs || ''))),
      'no procedure still names it, including after an old hub snapshot has been re-imported');
    assert.ok(!s2.people.some(p => /Construction Assistant/.test(p.legacy_roles || '')), 'and no snapshot hands the role back to someone who has left');
  });
  await check('work nobody owns sits on the Unclassified tab, not on a real list', async () => {
    const s2 = (await call('GET', '/api/state')).body;
    const R = id => JSON.parse(s2.people.find(p => p.id === id).responsibilities || '[]');
    // An earlier test in this run re-imports a pre-handover hub, and an import overrides by design, so his
    // live count here reflects that file. What must hold either way: nothing moved off him comes back.
    const X = id => JSON.parse(s2.people.find(p => p.id === id).crossed_off || '[]');
    assert.equal(X('james').length, 27, 'every removal from his list is recorded, so a stale file cannot undo it');
    // Five were struck off as saying again what another line already says, not reassigned anywhere.
    assert.ok(X('james').some(r => /Maintain Purchasing database items/.test(r)));
    assert.ok(!R('unclassified').concat(R('pam'), R('lonnie')).some(r => /Maintain Purchasing database items/.test(r)));
    assert.ok(s2.decisions.some(d => d.id === 'dec-james-list-removals' && d.status === 'accepted'));
    // The thirteen buyer-facing ones were placed with Pam the next day; the bid work is still unplaced.
    assert.equal(R('unclassified').length, 8, 'the bid work, the budget line, and marketing/MLS');
    assert.ok(R('unclassified').every(r => /was on James's list/.test(r)), 'where each came from is kept');
    assert.ok(!R('james').some(r => /Schedules New Home Orientation|Collects bids from subcontractors/.test(r)));
    assert.ok(R('unclassified').some(r => /Calls subcontractors for bids/.test(r)), 'the bid-request work is still nobody\'s');
    // Pam's live list here is whatever the re-imported snapshot held, since an import overrides by design.
    // What survives either way is the record of the placement.
    assert.match(s2.people.find(p => p.id === 'pam').notes, /13 buyer-facing responsibilities placed with her/);
    const html = (await call('GET', '/api/export/opshub')).body;
    const team = JSON.parse(/const CURRENT_TEAM = (\[[\s\S]*?\n\]);/.exec(html)[1]);
    const un = team.find(t => t.id === 'unclassified');
    assert.ok(un && un.unclassified === true, 'it publishes as its own tab');
    assert.equal(un.responsibilities.length, 8);
    assert.equal(team[team.length - 1].id === 'unclassified' || team.indexOf(un) > team.findIndex(t => t.id === 'james'), true, 'and never ahead of a real person');
    assert.ok(s2.decisions.some(d => d.id === 'dec-unclassified-owners' && d.status === 'proposed'), 'finding each an owner is on Brittany\'s list');
  });
  await check('a responsibility that is really several steps carries them, hidden until it is clicked', async () => {
    const s2 = (await call('GET', '/api/state')).body;
    const j = s2.people.find(p => p.id === 'james');
    const steps = JSON.parse(j.responsibility_steps || '{}');
    const parent = 'Handles backcharges when reported by construction';
    assert.deepEqual(Object.keys(steps), [parent]);
    assert.equal(steps[parent].length, 3);
    assert.match(steps[parent][0], /^Notifies the subcontractor/, 'the subcontractor is told before it is entered');
    // And the procedure behind it: the notification is recorded in the database, and James runs all of it
    // once construction reports it.
    const bc = s2.tasks.find(t => t.id === 'hub-back_charge');
    assert.equal(bc.owner_id, 'james');
    assert.match(bc.steps, /who was notified and the date they were notified, in the database/);
    assert.match(bc.steps, /Everything after this is James/);
    assert.match(bc.inputs, /Purchasing assistant \(James\)/);
    assert.ok(!/Superintendent → Maria/.test(bc.inputs), 'the 2006 participant list is gone');
    assert.equal(bc.hub_category, 'Operations', 'a back charge is not a financial procedure');
    assert.match(bc.inputs, /QuickBooks/, 'what accounting does after it is recorded, outside the procedure');
    const hub2 = (await call('GET', '/api/export/opshub')).body;
    const procs = JSON.parse(/const INITIAL_PROCESSES = (\[[\s\S]*?\n\]);/.exec(hub2)[1]);
    assert.equal(procs.find(p => p.id === 'back_charge').category, 'Operations', 'and the hub files it there');
    const live = JSON.parse(j.responsibilities || '[]');
    assert.ok(!live.some(r => /^Fills out database backcharges|^Must notify subcontractors|^Clicks back ?charge approval/.test(r)),
      'the three lines are gone from the list itself, and a pre-fold snapshot cannot list them beside their own parent');
    const html = (await call('GET', '/api/export/opshub')).body;
    const team = JSON.parse(/const CURRENT_TEAM = (\[[\s\S]*?\n\]);/.exec(html)[1]);
    const jh = team.find(t => t.id === 'james');
    assert.equal((jh.resp_steps || {})[parent].length, 3, 'and they reach the hub');
    assert.ok(/stepsFor\(resp\)\.length > 0/.test(html), 'which renders them behind the responsibility');
  });
  await check('folder import is admin/accounting only', async () => { const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.construction }); const r = await call('POST', '/api/import/folder', { dir: '/' }); assert.equal(r.status, 403); cookie = admin; });
  await check('every write route sits behind the session and write check', async () => {
    // A route accidentally placed above the session gate would answer a signed-out caller. This catches that.
    const admin = cookie;
    const routes = [['/api/work-orders/request', { vendor_id: 'vendor-plumbing' }], ['/api/procedures/paste', { text: 'x'.repeat(40) }],
      ['/api/specifics/paste', { text: 'Some Vendor — a detail' }], ['/api/insurance/paste', { text: 'Some Vendor 1/1/2030' }],
      ['/api/insurance/sweep', {}], ['/api/bids/sweep', {}], ['/api/events', { entity_type: 'task', entity_id: 'x' }]];
    cookie = '';
    for (const [r, body] of routes) {
      const out = await call('POST', r, body);
      assert.equal(out.status, 401, `${r} must require a session, got ${out.status}`);
    }
    await call('POST', '/api/login', { passphrase: creds.viewer });
    for (const [r, body] of routes) {
      const out = await call('POST', r, body);
      assert.ok(out.status === 403, `${r} must refuse a read-only role, got ${out.status}`);
    }
    cookie = admin;
  });
  await check('export contains everything', async () => { const x = (await call('GET', '/api/export')).body; assert.equal(x.format, 'mcvaugh-operations-world/1'); assert.ok(x.tasks.length > 0 && x.events.length > 0 && x.checkpoints.length > 0); });
  await stop(); await start();
  await check('everything survives a server restart', async () => { const s = (await call('GET', '/api/state')).body; assert.ok(s.tasks.find(t => t.id === 'acceptance-task')); assert.equal(s.checkpoint.next_action, 'Verify Maria'); assert.equal(s.agents.find(a => a.id === 'agent-trade-commitments').runtime.status, 'failed'); assert.equal(s.agents.find(a => a.id === 'agent-budget-exceptions').setup_stage, 'ready'); });
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  for (const [s, n] of results) console.log(s, n);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); if (proc) proc.kill(); process.exit(1); });
