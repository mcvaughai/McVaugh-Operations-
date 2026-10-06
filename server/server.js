#!/usr/bin/env node
// McVaugh Operations World — zero-dependency Node server.
//   node server/server.js            (http://localhost:8787)
// Env: MOW_PORT, MOW_DATA_DIR, MOW_N8N_SECRET, MOW_MCHDB_URL
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const dbm = require('./db');
const { seedIfEmpty } = require('./seed');
const imports = require('./imports');

const PORT = Number(process.env.MOW_PORT || 8787);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STALE_MINUTES = 30;

const db = dbm.open();
const seeded = seedIfEmpty(db);

// ---------- roles & credentials (never shipped to the browser) ----------
const ROLES = ['admin', 'accounting', 'construction', 'design_sales', 'viewer'];
const CRED_PATH = path.join(dbm.DATA_DIR, 'credentials.json');
function loadCredentials() {
  if (!fs.existsSync(CRED_PATH)) {
    const creds = {};
    for (const r of ROLES) creds[r] = crypto.randomBytes(6).toString('base64url');
    fs.writeFileSync(CRED_PATH, JSON.stringify({ _note: 'Role passphrases for McVaugh Operations World. Edit freely; keep this file out of git and shared pages.', ...creds }, null, 2));
    console.log(`Created role passphrases in ${CRED_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
}
const N8N_SECRET = process.env.MOW_N8N_SECRET || '';

const can = {
  write: role => role && role !== 'viewer',
  sensitive: role => role === 'admin' || role === 'accounting',
  integrationConfig: role => role === 'admin',
  audit: role => role === 'admin',
};

// ---------- http helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : (headers['Content-Type'] || 'text/plain'), 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; }
function cookies(req) {
  const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const [k, ...v] = p.trim().split('='); if (k) out[k] = decodeURIComponent(v.join('=')); }); return out;
}
function roleOf(req) {
  const tok = cookies(req).mow_session;
  if (!tok) return null;
  const row = db.prepare('SELECT role FROM sessions WHERE token = ?').get(tok);
  return row ? row.role : null;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };

// ---------- derived runtime state ----------
function minutesAgo(ts) { return (Date.now() - new Date(ts).getTime()) / 60000; }

function latestRunEvents() {
  // Latest run-kind event per entity, excluding demo unless demo mode is on (the client separates demo anyway).
  const rows = db.prepare(`SELECT e.* FROM events e JOIN (
      SELECT entity_type, entity_id, MAX(id) AS mid FROM events WHERE kind = 'run' GROUP BY entity_type, entity_id
    ) m ON m.mid = e.id`).all();
  const map = {};
  for (const r of rows) map[r.entity_type + ':' + r.entity_id] = r;
  return map;
}

function runtimeFor(entityType, entity, latest, integ) {
  const ev = latest[entityType + ':' + entity.id];
  const base = { status: 'idle', label: null, source: null, since: null, event_id: null };
  if (entityType === 'agent') {
    if (entity.paused) return { ...base, status: 'paused', label: 'Paused' };
    if (!ev) return { ...base, status: entity.setup_stage === 'ready' ? 'idle' : 'not_setup', label: entity.setup_stage === 'ready' ? 'Ready, idle' : 'Not set up yet' };
  } else if (!ev) {
    return { ...base, status: 'workflow_not_reviewed', label: 'Workflow not reviewed' };
  }
  const out = { ...base, label: ev.label, source: ev.source, since: ev.ts, event_id: ev.id };
  if (ev.status === 'started') {
    if (minutesAgo(ev.ts) > STALE_MINUTES) return { ...out, status: 'stale', label: `Stale: no finish after ${STALE_MINUTES} min (${ev.label || 'run'})` };
    return { ...out, status: 'running' };
  }
  if (ev.status === 'failed') return { ...out, status: 'failed' };
  if (ev.status === 'waiting_approval') return { ...out, status: 'waiting' };
  if (ev.source === 'n8n' && integ.n8n && integ.n8n.status === 'failing') return { ...out, status: 'disconnected', label: 'n8n connection failing' };
  return { ...out, status: entityType === 'agent' ? (entity.setup_stage === 'ready' ? 'idle' : 'not_setup') : 'idle', label: ev.label ? `Last: ${ev.label}` : null };
}

function stateFor(role) {
  const sens = can.sensitive(role);
  const latest = latestRunEvents();
  const integrations = db.prepare('SELECT * FROM integrations ORDER BY name').all().map(i => can.integrationConfig(role) ? i : { ...i, config: i.config ? '(restricted)' : null });
  const integ = Object.fromEntries(integrations.map(i => [i.id, i]));
  const people = db.prepare('SELECT * FROM people ORDER BY name').all().map(p => ({ ...p, departments: JSON.parse(p.departments || '[]'), runtime: runtimeFor('person', p, latest, integ) }));
  const agents = db.prepare('SELECT * FROM agents ORDER BY name').all().map(a => ({ ...a, runtime: runtimeFor('agent', a, latest, integ) }));
  let tasks = db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all();
  tasks = tasks.map(t => (t.sensitive && !sens) ? { id: t.id, title: '(restricted: accounting/cash)', department_id: t.department_id, owner_id: t.owner_id, board: t.board, sensitive: 1, restricted: true, documented: t.documented, automated: t.automated, verified: t.verified, proposed: t.proposed, project_stage: t.project_stage } : t);
  const departments = db.prepare('SELECT * FROM departments ORDER BY sort').all().map(d => ({ ...d, runtime: runtimeFor('department', d, latest, integ) }));
  const homes = db.prepare('SELECT * FROM homes ORDER BY address').all().map(h => ({ ...h, runtime: runtimeFor('home', h, latest, integ) }));
  const decisions = db.prepare('SELECT * FROM decisions ORDER BY date DESC, created_at DESC').all();
  const checkpoint = db.prepare('SELECT * FROM checkpoints ORDER BY id DESC LIMIT 1').get() || null;
  const checkpoints = db.prepare('SELECT * FROM checkpoints ORDER BY id DESC LIMIT 20').all();
  const events = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 300').all();
  const ai_configs = db.prepare('SELECT * FROM ai_configs ORDER BY agent_id').all();
  const audit = can.audit(role) ? db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all() : [];
  const demo = db.prepare("SELECT value FROM meta WHERE key = 'demo_mode'").get()?.value === 'on';
  return { role, permissions: { write: can.write(role), sensitive: sens, integrationConfig: can.integrationConfig(role), audit: can.audit(role) },
    departments, people, agents, tasks, homes, decisions, checkpoint, checkpoints, events, integrations, ai_configs, audit, demo,
    server: { now: dbm.nowIso(), db_path: can.integrationConfig(role) ? dbm.DB_PATH : undefined, stale_minutes: STALE_MINUTES, n8n_secret_set: !!N8N_SECRET } };
}

// ---------- demo mode (clearly labeled; source = 'demo') ----------
let demoTimer = null;
function demoTick() {
  const agents = db.prepare('SELECT id, name FROM agents').all();
  const a = agents[Math.floor(Math.random() * agents.length)];
  const latest = latestRunEvents()['agent:' + a.id];
  if (latest && latest.source === 'demo' && latest.status === 'started') {
    const fail = Math.random() < 0.2;
    dbm.addEvent(db, { entity_type: 'agent', entity_id: a.id, kind: 'run', status: fail ? 'failed' : 'finished', label: `DEMO ${fail ? 'failed' : 'finished'}: ${a.name}`, source: 'demo', external_id: 'demo-' + crypto.randomUUID() });
  } else {
    dbm.addEvent(db, { entity_type: 'agent', entity_id: a.id, kind: 'run', status: 'started', label: `DEMO: simulated ${a.name} check`, source: 'demo', external_id: 'demo-' + crypto.randomUUID() });
  }
}
function setDemo(on) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_mode', ?)").run(on ? 'on' : 'off');
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  if (on) { demoTick(); demoTimer = setInterval(demoTick, 6000); }
  else { // close any open demo runs and purge demo events so they never mix with real history
    db.prepare("DELETE FROM events WHERE source = 'demo'").run();
  }
}
if (db.prepare("SELECT value FROM meta WHERE key = 'demo_mode'").get()?.value === 'on') setDemo(false);

// ---------- integration checks (server-side, no credentials in browser) ----------
function setIntegration(id, status, message, extra = {}) {
  dbm.upsert(db, 'integrations', { id, status, last_checked: dbm.nowIso(), last_message: message, ...extra });
}
async function checkIntegrations() {
  const mch = process.env.MOW_MCHDB_URL || 'http://db.mcvaugh.com/buildconnect/NewStuff/wotracking.html';
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(mch, { method: 'GET', signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(t);
    const text = r.status === 200 ? await r.text() : '';
    if (r.status === 200 && /buildconnect|<select|<form/i.test(text)) setIntegration('mchdb', 'connected', 'Reachable (HTTP 200). Read-only; data pulls still need an authenticated browser session or a server credential (not configured).');
    else setIntegration('mchdb', 'disconnected', `Not verified: HTTP ${r.status} from ${new URL(mch).host} (may be a proxy or login page). No data was read.`);
  } catch (e) {
    setIntegration('mchdb', 'disconnected', `Not reachable from this server: ${e.cause?.code || e.name || e.message}`);
  }
  const n8nSeen = db.prepare("SELECT MAX(ts) AS ts FROM events WHERE source = 'n8n'").get().ts;
  if (!N8N_SECRET) setIntegration('n8n', 'disconnected', 'MOW_N8N_SECRET not set; webhook refuses all calls.');
  else if (!n8nSeen) setIntegration('n8n', 'disconnected', 'Secret set; no authenticated event received yet.');
  else setIntegration('n8n', minutesAgo(n8nSeen) > 24 * 60 ? 'failing' : 'connected', `Last authenticated event ${n8nSeen}`);
  setIntegration('pages', 'disconnected', 'No supported API verified for ChatGPT Business Pages; use Export → paste.');
  return db.prepare('SELECT * FROM integrations').all();
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const role = roleOf(req);
  try {
    if (p.startsWith('/api/')) return await api(req, res, url, p, role);
    // static
    let f = p === '/' ? '/index.html' : p;
    if (f.startsWith('/docs/')) { const fp = path.join(__dirname, '..', f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return send(res, 200, fs.readFileSync(fp), { 'Content-Type': MIME['.md'] }); }
    const fp = path.normalize(path.join(PUBLIC_DIR, f));
    if (!fp.startsWith(PUBLIC_DIR) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return send(res, 404, 'not found');
    return send(res, 200, fs.readFileSync(fp), { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    return send(res, e.status || 500, { error: e.message });
  }
});

const VAULT_DIR = path.join(dbm.DATA_DIR, 'vault');
function vaultState() {
  const sp = path.join(VAULT_DIR, 'state.json');
  let cfg = null; try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'bots.json'), 'utf8')); } catch { cfg = null; }
  const configWorkers = cfg ? cfg.workers.map(w => ({ id: w.id, name: w.name, symbol: w.symbol, strategy: w.strategy, enabled: w.enabled !== false, risk: { daily_brake: w.daily_brake, lock_pct: w.lock_pct, qty: w.qty, dte: w.dte } })) : [];
  const base = { config_workers: configWorkers, server_now: dbm.nowIso() };
  if (!fs.existsSync(sp)) return { runner: false, ...base };
  try {
    const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const ageSec = (Date.now() - fs.statSync(sp).mtimeMs) / 1000;
    return { runner: true, stale: ageSec > 90, age_seconds: Math.round(ageSec), ...base, ...st };
  } catch (e) { return { runner: false, error: 'state.json unreadable: ' + e.message, ...base }; }
}

function requireWrite(role) { if (!can.write(role)) { const e = new Error(role ? 'read-only role' : 'login required'); e.status = 403; throw e; } }

async function api(req, res, url, p, role) {
  const m = req.method;
  // --- auth ---
  if (p === '/api/login' && m === 'POST') {
    const { passphrase } = await readJson(req);
    const creds = loadCredentials();
    const r = ROLES.find(r => creds[r] && creds[r] === passphrase);
    if (!r) return send(res, 401, { error: 'Unknown passphrase' });
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO sessions (token, role, created_at) VALUES (?,?,?)').run(token, r, dbm.nowIso());
    dbm.audit(db, r, 'login');
    return send(res, 200, { role: r }, { 'Set-Cookie': `mow_session=${token}; Path=/; HttpOnly; SameSite=Lax` });
  }
  if (p === '/api/logout' && m === 'POST') {
    const tok = cookies(req).mow_session; if (tok) db.prepare('DELETE FROM sessions WHERE token = ?').run(tok);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'mow_session=; Path=/; Max-Age=0' });
  }
  // --- n8n webhook (authenticated callback; no login cookie) ---
  if (p === '/api/webhooks/n8n' && m === 'POST') {
    const given = req.headers['x-mow-secret'] || url.searchParams.get('secret');
    if (!N8N_SECRET || given !== N8N_SECRET) { setIntegration('n8n', 'failing', 'Rejected a webhook call with a bad or missing secret at ' + dbm.nowIso()); return send(res, 401, { error: 'bad secret' }); }
    const b = await readJson(req);
    const agentId = b.agent_id || db.prepare('SELECT id FROM agents WHERE n8n_workflow_id = ?').get(String(b.workflow_id || ''))?.id;
    if (!agentId) return send(res, 400, { error: 'agent_id or a mapped workflow_id required' });
    const status = ['started', 'finished', 'failed', 'waiting_approval'].includes(b.status) ? b.status : 'finished';
    const r = dbm.addEvent(db, { entity_type: 'agent', entity_id: agentId, kind: 'run', status, label: b.label || `n8n ${status}`, source: 'n8n',
      external_id: `${b.execution_id || crypto.randomUUID()}:${status}`, payload: b, actor: 'n8n', ts: b.ts });
    setIntegration('n8n', 'connected', `Last authenticated event ${dbm.nowIso()}`);
    return send(res, 200, { ok: true, deduplicated: !r.inserted });
  }
  // --- everything else needs a session ---
  if (!role) return send(res, 401, { error: 'login required' });

  if (p === '/api/state' && m === 'GET') return send(res, 200, stateFor(role));
  // --- The Vault: read-only view of data/vault/state.json, written by bots/runner.py ---
  if (p === '/api/vault/state' && m === 'GET') return send(res, 200, { can_command: can.write(role), ...vaultState() });
  // Queue a command for the runner (it drains data/vault/commands.json on its next pass). Write roles only.
  if (p === '/api/vault/command' && m === 'POST') {
    requireWrite(role);
    const b = await readJson(req);
    if (!['on', 'off', 'flatten'].includes(b.action) || typeof b.bot !== 'string' || !b.bot) return send(res, 400, { error: 'bot and action (on | off | flatten) required' });
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    const cp = path.join(VAULT_DIR, 'commands.json');
    let q = []; try { q = JSON.parse(fs.readFileSync(cp, 'utf8')); if (!Array.isArray(q)) q = []; } catch { q = []; }
    q.push({ id: crypto.randomUUID(), bot: b.bot, action: b.action, by: role, ts: dbm.nowIso() });
    fs.writeFileSync(cp + '.tmp', JSON.stringify(q)); fs.renameSync(cp + '.tmp', cp);
    dbm.audit(db, role, `vault ${b.action} ${b.bot}`);
    return send(res, 200, { ok: true, queued: q.length });
  }
  if (p === '/api/export' && m === 'GET') { if (!can.sensitive(role)) return send(res, 403, { error: 'restricted' }); dbm.audit(db, role, 'export'); return send(res, 200, dbm.exportAll(db), { 'Content-Disposition': `attachment; filename="mcvaugh-world-${new Date().toISOString().slice(0, 10)}.json"` }); }
  if (p === '/api/export/pages' && m === 'GET') return send(res, 200, imports.pagesMarkdown(stateFor(role)), { 'Content-Type': MIME['.md'] });

  if (m === 'GET') return send(res, 404, { error: 'not found' });
  requireWrite(role);

  if (p === '/api/import/backup' && m === 'POST') { if (role !== 'admin') return send(res, 403, { error: 'admin only' }); dbm.importBackup(db, await readJson(req)); dbm.audit(db, role, 'import_backup'); return send(res, 200, { ok: true }); }

  if (p === '/api/events' && m === 'POST') {
    const b = await readJson(req);
    const r = dbm.addEvent(db, { ...b, source: 'manual', actor: role, external_id: 'manual-' + crypto.randomUUID(), label: b.label ? `Manual: ${b.label}` : 'Manual update' });
    dbm.audit(db, role, 'event', b.entity_type, b.entity_id, b.label);
    return send(res, 200, { ok: true, id: String(r.id) });
  }
  if (p === '/api/checkpoints' && m === 'POST') {
    const b = await readJson(req);
    const prev = db.prepare('SELECT * FROM checkpoints ORDER BY id DESC LIMIT 1').get() || {};
    const row = { ...prev, ...b };
    db.prepare(`INSERT INTO checkpoints (created_at, stage, current_step, last_completed, next_action, waiting_on, decisions_needed, note, author) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(dbm.nowIso(), row.stage || 'gather', row.current_step || null, row.last_completed || null, row.next_action || null, row.waiting_on || null, row.decisions_needed || null, row.note || null, role);
    dbm.audit(db, role, 'checkpoint');
    return send(res, 200, db.prepare('SELECT * FROM checkpoints ORDER BY id DESC LIMIT 1').get());
  }
  if (p === '/api/demo' && m === 'POST') { const { on } = await readJson(req); setDemo(!!on); dbm.audit(db, role, 'demo', null, null, on ? 'on' : 'off'); return send(res, 200, { demo: !!on }); }
  if (p === '/api/integrations/check' && m === 'POST') return send(res, 200, await checkIntegrations());
  if (p === '/api/import/obsidian' && m === 'POST') { const b = await readJson(req); const r = imports.importMarkdown(db, b.files || [], role); setIntegration('obsidian', 'connected', `Snapshot import: ${r.imported} notes`, { last_import_at: dbm.nowIso() }); return send(res, 200, r); }
  if (p === '/api/import/csv' && m === 'POST') {
    const b = await readJson(req); const r = imports.importCsv(db, b, role);
    setIntegration(b.target === 'dashboard' ? 'dashboard' : 'excel', 'connected', `Snapshot import: ${b.filename || 'csv'} (${r.imported} rows)`, { last_import_at: dbm.nowIso() });
    return send(res, 200, r);
  }
  if (p === '/api/export/pages/mark' && m === 'POST') { dbm.addEvent(db, { entity_type: 'integration', entity_id: 'pages', kind: 'import', status: 'info', label: 'Manual: handbook export pasted into ChatGPT Pages', source: 'manual', actor: role, external_id: 'pages-' + crypto.randomUUID() }); setIntegration('pages', 'disconnected', 'Manual export workflow; last export ' + dbm.nowIso(), { last_import_at: dbm.nowIso() }); return send(res, 200, { ok: true }); }
  // generic table upsert / delete: /api/<table>[/<id>]
  const mt = p.match(/^\/api\/(departments|people|agents|tasks|homes|decisions|integrations|ai_configs)(?:\/([^/]+))?$/);
  if (mt) {
    const [, table, id] = mt;
    if (m === 'DELETE' && id) {
      if (table === 'integrations' || table === 'departments') return send(res, 400, { error: 'cannot delete' });
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id); dbm.audit(db, role, 'delete', table, id); return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    if (id) body.id = id;
    if (table === 'tasks' && body.sensitive && !can.sensitive(role)) return send(res, 403, { error: 'restricted' });
    if (table === 'tasks' && body.id) { const ex = db.prepare('SELECT sensitive FROM tasks WHERE id = ?').get(body.id); if (ex?.sensitive && !can.sensitive(role)) return send(res, 403, { error: 'restricted' }); }
    if (table === 'integrations' && !can.integrationConfig(role)) delete body.config;
    const before = body.id ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(body.id) : null;
    const row = dbm.upsert(db, table, body);
    dbm.audit(db, role, before ? 'update' : 'create', table, row.id, JSON.stringify(body).slice(0, 500));
    // setup milestone changes are recorded as events so history shows who/when
    const milestoneKeys = ['setup_stage', 'review_status', 'documented', 'automated', 'verified', 'board', 'active', 'pilot'];
    const changed = milestoneKeys.filter(k => body[k] !== undefined && (!before || String(before[k]) !== String(body[k])));
    if (changed.length) dbm.addEvent(db, { entity_type: table.replace(/s$/, '').replace('people', 'person'), entity_id: row.id, kind: 'setup', status: 'info', source: 'manual', actor: role,
      label: `Manual: ${changed.map(k => `${k} → ${body[k]}`).join(', ')}`, external_id: 'manual-' + crypto.randomUUID() });
    return send(res, 200, row);
  }
  return send(res, 404, { error: 'not found' });
}

server.listen(PORT, () => {
  loadCredentials();
  console.log(`McVaugh Operations World → http://localhost:${PORT}  (db: ${dbm.DB_PATH}${seeded ? ', seeded from handoff' : ''})`);
  console.log(`Role passphrases: ${CRED_PATH}`);
});
