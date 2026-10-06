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
  await check('active jobs recorded from Brittany (data update applied once)', async () => { const s = (await call('GET', '/api/state')).body; const act = s.homes.filter(h => h.active === 'active'); assert.equal(act.length, 12); assert.equal(act.filter(h => /permits/i.test(h.stage)).length, 10); });
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
    const d = (await call('POST', '/api/review/duplicates', { id: 'dash-maria-issue-purchase-orders' })).body; assert.equal(d[0].id, 'obs-issue-a-purchase-order');
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
    fs.writeFileSync(path.join(vault, 'notes', 'Procedures for the MCH Database.md'), card('Procedures for the MCH Database', 'PROCEDURES.doc', ['Database & Reconciliation']));
    fs.writeFileSync(path.join(vault, 'notes', 'MCH Operations Hub.md'), card('MCH Operations Hub', 'mch-ops-hub.html', ['Construction Financials & Budget vs Actual']));
    fs.writeFileSync(path.join(vault, 'notes', 'Company Organizational Chart (10.24.25).md'), card('Company Organizational Chart (10.24.25)', 'Org Chart.pdf', []));
    // minimal docx (zip with word/document.xml), built without dependencies via zlib
    const zlib = require('node:zlib'); const xml = Buffer.from('<w:document><w:body><w:p><w:r><w:t>Step 1: Enter the bill &amp; job.</w:t></w:r></w:p></w:body></w:document>');
    const def = zlib.deflateRawSync(xml); const name = Buffer.from('word/document.xml'); const crc = 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(xml.length, 22); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(def.length, 20); cd.writeUInt32LE(xml.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
    const cdOff = lh.length + name.length + def.length; const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(cdOff, 16);
    fs.writeFileSync(path.join(vault, 'srv', 'MCH_Accounting_SOP.docx'), Buffer.concat([lh, name, def, cd, name, eocd]));
    fs.writeFileSync(path.join(vault, 'srv', 'PROCEDURES.doc'), 'binary'); fs.writeFileSync(path.join(vault, 'srv', 'mch-ops-hub.html'), '<html><body><h1>Hub</h1><p>Maria &ndash; Construction</p></body></html>');
    const r = (await call('POST', '/api/import/folder', { dir: path.join(vault, 'notes') })).body; assert.equal(r.imported, 4);
    const s = (await call('GET', '/api/state')).body; const doc = id => s.documents.find(d => d.id === id);
    assert.equal(doc('doc-mch-accounting-sop').underlying_status, 'extracted'); assert.match(doc('doc-mch-accounting-sop').content, /Step 1: Enter the bill & job/); assert.equal(doc('doc-mch-accounting-sop').department_id, 'accounting');
    assert.equal(doc('doc-procedures-for-the-mch-database').underlying_status, 'needs_conversion'); assert.equal(doc('doc-company-organizational-chart-10-24-25').underlying_status, 'not_found');
    assert.match(doc('doc-mch-operations-hub').content, /Maria – Construction/); assert.equal(doc('doc-mch-operations-hub').department_id, null, 'generic hub assigns no department');
    const t1 = s.tasks.find(t => t.id === 'obs-mch-accounting-sop'); assert.equal(t1.documented, 1); assert.match(t1.steps, /Step 1/); assert.equal(t1.proposed, 1);
    const t2 = s.tasks.find(t => t.id === 'obs-procedures-for-the-mch-database'); assert.equal(t2.documented, 0); assert.match(t2.missing_info, /needs conversion/);
    assert.ok(!s.tasks.find(t => /Operations Hub|Organizational Chart/.test(t.title)), 'non-procedures are not tasks');
    fs.rmSync(vault, { recursive: true, force: true });
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
