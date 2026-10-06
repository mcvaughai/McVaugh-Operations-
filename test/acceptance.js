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
  await check('seeded confirmed people and proposed agents', async () => { const s = (await call('GET', '/api/state')).body; assert.equal(s.people.length, 7); assert.equal(s.agents.length, 14); assert.ok(s.agents.every(a => a.proposed === 1)); assert.ok(s.tasks.filter(t => t.proposed).length >= 13); });
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
    const s = (await call('GET', '/api/state')).body; assert.equal(s.role, 'construction'); assert.ok(s.tasks.some(t => t.restricted)); assert.ok(!s.tasks.some(t => t.restricted && t.steps)); assert.equal(s.audit.length, 0); assert.equal(s.server.db_path, undefined);
    const r = await call('POST', '/api/tasks/proc-cash', { board: 'done' }); assert.equal(r.status, 403);
    const x = await call('GET', '/api/export'); assert.equal(x.status, 403);
    cookie = '';
    await call('POST', '/api/login', { passphrase: creds.viewer }); const w = await call('POST', '/api/tasks', { title: 'nope' }); assert.equal(w.status, 403);
    cookie = admin;
  });
  await check('obsidian import keeps source and date', async () => { const r0 = await call('POST', '/api/import/obsidian', { files: [{ name: 'Selections SOP.md', content: '---\nowner: Pam\ndepartment: design\n---\n# Selections SOP\n## Trigger\nSupplier sends sheet\n## Steps\n1. Maria signs\n2. Enter in Excel\n' }] }); const r = r0.body; assert.equal(r.imported, 1, JSON.stringify(r0)); const t = (await call('GET', '/api/state')).body.tasks.find(t => t.id === 'obs-selections-sop'); assert.equal(t.owner_id, 'pam'); assert.match(t.source, /Obsidian import: Selections SOP.md/); assert.equal(t.trigger, 'Supplier sends sheet'); });
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
