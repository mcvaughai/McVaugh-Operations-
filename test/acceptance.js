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
  await check('seeded confirmed people and proposed agents', async () => { const s = (await call('GET', '/api/state')).body; assert.equal(s.people.length, 9); assert.equal(s.people.find(p => p.id === 'ernesto').reports_to, 'maria'); assert.equal(s.people.find(p => p.id === 'brittany').title, 'Accounting Assistant'); assert.equal(s.agents.length, 14); assert.ok(s.agents.every(a => a.proposed === 1)); assert.ok(s.tasks.filter(t => t.proposed).length >= 13); });
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
  await check('active jobs recorded from Brittany (data update applied once)', async () => { const s = (await call('GET', '/api/state')).body; const act = s.homes.filter(h => h.active === 'active'); assert.equal(act.length, 13); assert.equal(act.filter(h => /permits/i.test(h.stage)).length, 10); });
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
    let s = (await call('GET', '/api/state')).body; assert.ok(!s.tasks.find(t => t.id === 'dash-maria-issue-purchase-orders')); assert.equal(s.archived_count, 1);
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
    assert.ok(!s.tasks.find(t => /lease|cash flow/i.test(t.title)), 'lease/cash flow must not be tasks');
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
    const hub = s.tasks.filter(t => t.id.startsWith('hub-')); assert.equal(hub.length, 25);
    const nwo = s.tasks.find(t => t.id === 'hub-new_work_order'); assert.equal(nwo.owner_id, 'ernesto'); assert.equal(nwo.department_id, 'purchasing'); assert.match(nwo.steps, /^1\. Red-lined plans/); assert.equal(nwo.documented, 1); assert.equal(nwo.proposed, 1);
    assert.equal(JSON.parse(s.people.find(p => p.id === 'maria').responsibilities).length, 63); assert.equal(JSON.parse(s.people.find(p => p.id === 'maria').crossed_off).length, 20); assert.deepEqual(JSON.parse(s.people.find(p => p.id === 'kenneth').legacy_roles), ['CFO']);
    assert.equal(s.documents.filter(d => d.id.startsWith('doc-legacy-role')).length, 16);
    const dbp = s.tasks.find(t => t.id === 'obs-procedures-for-the-mch-database'); assert.match(dbp.steps, /Work orders must be in the database prior to work commencing/); assert.equal(dbp.owner_id, 'maria');
    await call('POST', '/api/tasks/hub-new_work_order', { proposed: 0, owner_id: 'maria' });
    const r = (await call('POST', '/api/import/opshub', { filename: 'hub.json', content: fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.json'), 'utf8') })).body; assert.equal(r.tasks, 25);
    const again = (await call('GET', '/api/state')).body.tasks.find(t => t.id === 'hub-new_work_order'); assert.equal(again.proposed, 0, 'review kept'); assert.equal(again.owner_id, 'maria', 'owner change kept');
  });
  await check('succession pass: meetings stored with provenance, step reviews, flows, job status, handover sorted no-backup first, agenda', async () => {
    const s = (await call('GET', '/api/state')).body;
    const m = s.documents.filter(d => d.kind === 'meeting'); assert.equal(m.length, 3); assert.ok(m.every(d => d.meeting_date && JSON.parse(d.attendees).length >= 2 && d.source));
    const wo = s.tasks.find(t => t.id === 'hub-work_order_ap'); const rev = JSON.parse(wo.step_review); assert.equal(rev.length, 10); assert.ok(rev.every(r => r.verdict !== 'match' || r.cite)); assert.match(wo.verification_result, /Reconciled against meetings/); assert.match(wo.missing_info, /Not mentioned/); assert.ok(JSON.parse(wo.flow).nodes.length > 5);
    assert.ok(s.tasks.find(t => t.id === 'tr-leander-arc-review' && t.proposed === 0 && t.backup_id === 'teresa'));
    const h = s.homes.find(h => h.address === '11603 Royal Parkside Place'); assert.match(h.stage, /Framing/); assert.match(h.status_cite, /2026-10-16/);
    const ho = (await call('GET', '/api/handover?person=maria')).body; assert.equal(ho.items.length, 23); assert.ok(ho.items[0].no_backup && ho.items[0].risk === 'high'); const firstBackup = ho.items.findIndex(i => !i.no_backup); assert.ok(ho.items.slice(firstBackup).every(i => !i.no_backup), 'no-backup items come first');
    assert.ok(ho.not_mentioned.length > 5); assert.equal(ho.person.crossed_off.length, 20);
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
    assert.equal(s.documents.filter(d => d.kind === 'meeting').length, 3);
    const co = s.tasks.find(t => t.id === 'hub-change_order_budget'); const rows = JSON.parse(co.step_review); assert.ok(rows.some(r => String(r.n) === '2–3' && r.verdict === 'no_longer' && /M3/.test(r.cite))); assert.ok(!rows.some(r => String(r.n) === '2'), 'earlier per-step rows replaced by the later finding'); assert.match(co.verification_result, /2026-10-20 call/);
    const tco = s.tasks.find(t => t.id === 'tr-change-orders'); assert.deepEqual(JSON.parse(tco.supersedes), ['hub-change_order_request', 'hub-change_order_budget']);
    assert.ok(JSON.parse(s.tasks.find(t => t.id === 'tr-permit-per-address').supersedes).includes('hub-permitting'));
    const h = s.homes.find(h => h.address === '11607 Royal Parkside Place'); assert.equal(h.active, 'active'); assert.match(h.notes, /Plan 3A/);
    const ho = (await call('GET', '/api/handover?person=maria')).body; assert.ok(ho.items.find(i => i.id === 'ho-inspection-binder' && i.no_backup)); assert.match(ho.items.find(i => i.id === 'ho-vendor-insurance').backup, /James/);
    assert.match(s.people.find(p => p.id === 'maria').notes, /Nov 9/);
  });
  await check('SOW Excel → vendors (restricted contacts); regenerated ops hub parses back with current + superseded SOPs', async () => {
    const s = (await call('GET', '/api/state')).body; assert.ok(s.vendors.length >= 40);
    const pl = s.vendors.find(v => v.trade === 'PLUMBING'); assert.equal(pl.vendor, 'GT Plumbing'); assert.ok(JSON.parse(pl.contacts).some(c => /Mauricio/.test(c.name)));
    const fx = s.vendors.find(v => v.trade === 'PLUMBING FIXTURES'); assert.match(fx.vendor, /Ferguson/);
    const fd = s.vendors.find(v => v.trade === 'FOUNDATION'); assert.equal(fd.vendor, 'Andrade Concrete'); assert.match(fd.rate, /10\.50/);
    const sow = s.documents.find(d => d.id === 'doc-sow-excel'); assert.equal(sow.sensitive, 1); assert.ok(sow.file_path);
    const html = (await call('GET', '/api/export/opshub')).body; assert.match(html, /regenerated by McVaugh Operations World/);
    const imp = require(path.join(__dirname, '..', 'server', 'imports.js')); const hub = imp.parseOpsHub(html);
    assert.ok(hub.processes.filter(p => p.status === 'current').length >= 15); assert.ok(hub.processes.find(p => p.id === 'change_order_budget').supersededBy.includes('tr-change-orders'));
    assert.ok(hub.team.find(t => t.id === 'maria').responsibilities.some(r => r.startsWith('[N/A]')));
    const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.construction });
    const c = (await call('GET', '/api/state')).body; assert.ok(c.vendors.every(v => v.restricted && v.contacts === '[]')); const f = await fetch(B + '/files/doc-sow-excel', { headers: { Cookie: cookie } }); assert.equal(f.status, 403); cookie = admin;
  });
  await check('WO entry skill: Johnston reusable, other vendors flagged for review, skill recorded as drafting only', async () => {
    const s = (await call('GET', '/api/state')).body;
    const jw = s.vendors.find(v => /johnston/i.test(v.vendor || ''));
    assert.ok(jw, 'Johnston Waterproofing vendor exists'); assert.equal(jw.wo_review, 'reusable');
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
    assert.equal(a.requested_from, 'brittany', 'routed to the task owner');
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
  await check('the agent job is recorded honestly: asks before entering, not yet run against a real bid', async () => {
    const s = (await call('GET', '/api/state')).body;
    const ag = s.agents.find(a => a.id === 'agent-purchasing');
    assert.equal(ag.enabled, 0, 'not switched on until it has been run against a real bid');
    assert.match(ag.purpose, /never enters anything without a named person approving/i);
    assert.match(ag.human_authority, /cannot send, price, award or accept/i);
    assert.equal(ag.n8n_workflow_id, 'mow-wo-approval');
    const t = s.tasks.find(t => t.id === 'tr-wo-entry-from-bid');
    assert.equal(t.automated, 0, 'the loop is built here but has not run against the real database');
    // Settled by Maria on 10/24: entering the work order is what notifies and approves the sub, so the agent asks first.
    assert.equal(t.blocker, null, 'the draft-state question fell away once the agent asks before entering');
    assert.ok(s.decisions.some(d => d.id === 'dec-wo-agent-draft-first' && d.status === 'accepted'));
    assert.match(t.verification_result, /M-chat 10\/24/);
    for (const f of ['mow-wo-approval', 'mow-bid-requests']) {
      const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', f + '.json'), 'utf8'));
      assert.equal(wf.active, false, f + ' ships switched off');
    }
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'mow-wo-approval.json'), 'utf8'));
    assert.ok(JSON.stringify(wf).includes('/api/webhooks/bid'), 'bids are recorded against a request');
    assert.ok(JSON.stringify(wf).includes('asked_for_decision'), 'the Teams card only posts when all bids are in');
  });
  await check('bid request: built from the vendor contact list, sole source flagged, nothing sent before approval', async () => {
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const r = await call('POST', '/api/webhooks/bid-request', { line_item: 'WATERPROOFING AND OVERLAY', home_id: 'home-11603', execution_id: 'br-1', due_days: 3 }, H);
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
    const req = await call('POST', '/api/webhooks/bid-request', { line_item: 'FRAMING', home_id: 'home-11603', execution_id: 'br-2',
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
    const req = await call('POST', '/api/webhooks/bid-request', { line_item: 'INSULATION', home_id: 'home-11603', execution_id: 'br-3' }, H);
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
    const req = await call('POST', '/api/webhooks/bid-request', { line_item: 'ELECTRICAL', home_id: 'home-11603', execution_id: 'br-4',
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
  await check('a Teams-channel decision must carry a name and a reason, recorded as self-declared', async () => {
    const H = { Cookie: '', 'X-MOW-Secret': 's3cret' };
    const req = await call('POST', '/api/webhooks/bid-request', { line_item: 'STUCCO', home_id: 'home-11603', execution_id: 'br-5' }, H);
    const dbFile = require('node:sqlite'); const raw = new dbFile.DatabaseSync(path.join(dataDir, 'mcvaugh-world.sqlite'));
    const t = raw.prepare('SELECT token FROM approvals WHERE id = ?').get(req.body.id).token; raw.close();
    const anon = await fetch(`${B}/approve/${req.body.id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `t=${t}&d=approve` });
    assert.match(await anon.text(), /Choose your name/, 'the purchasing channel is not a person, so the approver names themselves');
    const noReason = await fetch(`${B}/approve/${req.body.id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `t=${t}&d=reject&by=brittany` });
    assert.match(await noReason.text(), /Say why/, 'a rejection without a reason is refused');
    const good = await fetch(`${B}/approve/${req.body.id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `t=${t}&d=approve&by=brittany` });
    assert.equal(good.status, 200);
    const a = (await call('GET', '/api/state')).body.approvals.find(x => x.id === req.body.id);
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
  await check('folder import is admin/accounting only', async () => { const admin = cookie; cookie = ''; await call('POST', '/api/login', { passphrase: creds.construction }); const r = await call('POST', '/api/import/folder', { dir: '/' }); assert.equal(r.status, 403); cookie = admin; });
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
