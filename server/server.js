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
const { seedIfEmpty, applyUpdates } = require('./seed');
const imports = require('./imports');

const PORT = Number(process.env.MOW_PORT || 8787);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STALE_MINUTES = 30;

const db = dbm.open();
const seeded = seedIfEmpty(db);
applyUpdates(db);

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
// data/n8n.env (written by scripts/setup-n8n) supplies the shared secret and URLs when the env vars are not set.
(function loadEnvFile() {
  const f = path.join(dbm.DATA_DIR, 'n8n.env'); if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]; }
})();
const N8N_SECRET = (process.env.MOW_N8N_SECRET || '').trim();
if (process.env.MOW_N8N_SECRET !== undefined && !N8N_SECRET) console.warn('MOW_N8N_SECRET is present but blank (data/n8n.env) — delete the file and rerun scripts/setup-n8n, or type a value after the =');
const N8N_URL = process.env.MOW_N8N_URL || `http://localhost:${process.env.N8N_PORT || 5678}`;

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
const UPLOAD_MIME = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv', '.md': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
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
  const people = db.prepare('SELECT * FROM people ORDER BY name').all().map(p => ({ ...p, email: sens ? p.email : undefined, departments: JSON.parse(p.departments || '[]'), runtime: runtimeFor('person', p, latest, integ) }));
  const agents = db.prepare('SELECT * FROM agents ORDER BY name').all().map(a => ({ ...a, runtime: runtimeFor('agent', a, latest, integ) }));
  let tasks = db.prepare('SELECT * FROM tasks WHERE archived = 0 ORDER BY updated_at DESC').all();
  const archived_count = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE archived = 1').get().n;
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
  const documents = db.prepare('SELECT * FROM documents ORDER BY kind, title').all().map(d => (d.sensitive && !sens) ? { id: d.id, title: '(restricted: financial)', kind: d.kind, sensitive: 1, restricted: true, task_id: d.task_id } : { ...d, content: d.content ? d.content.slice(0, 20000) : null });
  const handover_items = db.prepare('SELECT * FROM handover_items ORDER BY id').all();
  const vendors = db.prepare('SELECT * FROM vendors ORDER BY trade').all().map(v => sens ? v : { ...v, contacts: '[]', rate: v.rate ? '(restricted)' : null, restricted: true });
  // The build sequence is open to everyone who can see the world; only the credential pointer is held back.
  const build_steps = db.prepare('SELECT * FROM build_steps ORDER BY row_no').all().map(b => sens ? b : { ...b, credential_note: b.credential_note ? '(restricted: ask Brittany)' : null });
  // Pending approvals are visible to everyone (so the team can see what is held up); only accounting/admin may decide.
  const approvals = db.prepare("SELECT * FROM approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, requested_at DESC LIMIT 100").all()
    .map(a => ({ ...a, token: undefined, can_decide: can.sensitive(role) }));
  const bid_requests = db.prepare('SELECT * FROM bid_requests ORDER BY requested_at DESC LIMIT 200').all()
    .map(r => ({ ...r, vendors: JSON.parse(r.vendors || '[]'), bids: db.prepare('SELECT * FROM bids WHERE bid_request_id = ? ORDER BY amount_value IS NULL, amount_value').all(r.id)
      .map(b => sens ? b : { ...b, amount: b.amount ? '(restricted)' : null, amount_value: null, restricted: true }) }));
    const wo_specifics = db.prepare('SELECT * FROM wo_specifics ORDER BY vendor_name, job_name').all();
  const bid_flow = db.prepare("SELECT value FROM meta WHERE key = 'bid_flow'").get()?.value || 'parked';
  const import_files = can.write(role) ? db.prepare('SELECT * FROM import_files ORDER BY imported_at DESC LIMIT 500').all() : [];
  const import_dir = db.prepare("SELECT value FROM meta WHERE key = 'import_dir'").get()?.value || process.env.MOW_IMPORT_DIR || null;
  const mapping = { headings: imports.headingMap(db), aliases: imports.aliasMap(db), hubs: imports.hubMap(db) };
  return { role, permissions: { write: can.write(role), sensitive: sens, integrationConfig: can.integrationConfig(role), audit: can.audit(role) },
    departments, people, agents, tasks, archived_count, homes, documents, handover_items, vendors, build_steps, approvals, bid_requests, bid_flow, wo_specifics, decisions, checkpoint, checkpoints, events, integrations, ai_configs, audit, demo, import_files, import_dir, mapping,
    server: { now: dbm.nowIso(), db_path: can.integrationConfig(role) ? dbm.DB_PATH : undefined, stale_minutes: STALE_MINUTES, n8n_secret_set: !!N8N_SECRET, n8n_url: N8N_URL, opshub_path: can.integrationConfig(role) ? (OPSHUB_PATH || null) : undefined } };
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
  let n8nUp = false, n8nMsg = '';
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000); const r = await fetch(N8N_URL + '/healthz', { signal: c.signal }); clearTimeout(t); n8nUp = r.ok; n8nMsg = `n8n at ${N8N_URL} ${r.ok ? 'is running' : 'answered HTTP ' + r.status}`; }
  catch (e) { n8nMsg = `n8n not reachable at ${N8N_URL} (${e.cause?.code || e.name}) — run scripts/start-all`; }
  if (!N8N_SECRET) setIntegration('n8n', 'disconnected', `${n8nMsg}. MOW_N8N_SECRET is ${process.env.MOW_N8N_SECRET !== undefined ? 'BLANK in data/n8n.env — type a value after the = and restart' : 'not set (run scripts/setup-n8n, then start with scripts/start-all)'}; webhook refuses all calls.`);
  else if (!n8nSeen) setIntegration('n8n', n8nUp ? 'disconnected' : 'disconnected', `${n8nMsg}. Secret set; no authenticated event received yet — import and activate n8n/mow-heartbeat.json, then open ${N8N_URL}/webhook/mow-heartbeat.`);
  else setIntegration('n8n', !n8nUp ? 'failing' : minutesAgo(n8nSeen) > 24 * 60 ? 'failing' : 'connected', `${n8nMsg}. Last authenticated event ${n8nSeen}${minutesAgo(n8nSeen) > 24 * 60 ? ' (over 24 h ago)' : ''}`);
  setIntegration('pages', 'disconnected', 'No supported API verified for ChatGPT Business Pages; use Export → paste.');
  return db.prepare('SELECT * FROM integrations').all();
}


// ---------- QuickBooks export folder watcher → n8n ----------
// n8n 2.x dropped the Local File Trigger, so the app (which has filesystem access anyway) watches the folder
// and hands the event to n8n's webhook. Deterministic: no model involved. Set MOW_QB_EXPORT_DIR to enable.
const QB_DIR = process.env.MOW_QB_EXPORT_DIR || '';
const seenFiles = new Map();
function startFolderWatch() {
  if (!QB_DIR) return;
  if (!fs.existsSync(QB_DIR)) { console.warn(`MOW_QB_EXPORT_DIR does not exist: ${QB_DIR}`); return; }
  const notify = async (name) => {
    const full = path.join(QB_DIR, name);
    let st; try { st = fs.statSync(full); } catch { return; }
    if (!st.isFile() || !/\.(csv|xlsx|xls|txt)$/i.test(name)) return;
    const key = `${name}:${st.size}:${st.mtimeMs}`; if (seenFiles.get(name) === key) return; seenFiles.set(name, key);
    dbm.addEvent(db, { entity_type: 'integration', entity_id: 'quickbooks', kind: 'import', status: 'info', label: `Export file detected: ${name} (${st.size} bytes) — handed to n8n`, source: 'system', external_id: 'qbfile-' + key });
    try {
      const r = await fetch(N8N_URL + '/webhook/mow-qb-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: name, path: full, size: st.size, detected_at: dbm.nowIso() }) });
      if (!r.ok) setIntegration('n8n', 'failing', `n8n webhook /webhook/mow-qb-export answered HTTP ${r.status} for ${name} — is the QB export workflow imported and Active?`);
    } catch (e) { setIntegration('n8n', 'failing', `Could not reach n8n to report ${name}: ${e.cause?.code || e.message}`); }
    setIntegration('quickbooks', 'connected', `Export folder watched: ${QB_DIR}. Last file ${name} at ${dbm.nowIso()}`, { last_import_at: dbm.nowIso() });
  };
  let timers = {};
  fs.watch(QB_DIR, (ev, name) => { if (!name) return; clearTimeout(timers[name]); timers[name] = setTimeout(() => notify(name), 2500); }); // debounce until the file is fully written
  setIntegration('quickbooks', 'connected', `Export folder watched: ${QB_DIR} (snapshot files; no QuickBooks API).`);
  console.log(`Watching QuickBooks export folder: ${QB_DIR}`);
}


// ---------- approvals ----------
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PUBLIC_URL = process.env.MOW_PUBLIC_URL || `http://localhost:${PORT}`;
const approvalLink = a => `${PUBLIC_URL}/approve/${a.id}?t=${a.token}`;
// Decide an approval. `via` records how (app / teams-link / n8n) and `by` who. Never auto-approves.
function decideApproval(a, decision, by, via, note, chosen, identity) {
  if (a.status !== 'pending') return { error: `already ${a.status}`, approval: a };
  const ok = decision === 'approve';
  const opts = JSON.parse(a.options || '[]');
  // When there is a choice to make, approving without naming the choice is not a decision.
  if (ok && opts.length > 1 && !opts.some(o => o.id === chosen)) return { error: 'pick which one you are approving', approval: a, options: opts };
  const pick = ok ? (chosen || (opts.length === 1 ? opts[0].id : null)) : null;
  dbm.upsert(db, 'approvals', { id: a.id, status: ok ? 'approved' : 'rejected', released: ok ? 1 : 0, chosen: pick,
    identity: identity || (via === 'app' ? 'authenticated' : 'self_declared'),
    decided_at: dbm.nowIso(), decided_by: by, decided_via: via, decision_note: note || null });
  const fresh = db.prepare('SELECT * FROM approvals WHERE id = ?').get(a.id);
  applyApprovalOutcome(fresh, ok);
  dbm.addEvent(db, { entity_type: 'agent', entity_id: a.agent_id, kind: 'run', status: ok ? 'finished' : 'failed',
    source: via === 'app' ? 'manual' : 'n8n', actor: by,
    label: ok ? `${by} approved: ${a.subject}${pick && opts.length > 1 ? ' → ' + (opts.find(o => o.id === pick) || {}).label : ''}` : `${by} rejected: ${a.subject}${note ? ' — ' + note : ''}`,
    external_id: a.external_id + ':' + decision, payload: { approval_id: a.id } });
  dbm.audit(db, by, 'approval_' + decision, 'approval', a.id, a.subject);
  return { ok: true, approval: db.prepare('SELECT * FROM approvals WHERE id = ?').get(a.id) };
}
const FIELD_LABEL = k => String(k).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
// The facts shown on an approval, with the draft's own fields taking precedence and no key repeated.
function approvalFacts(a) {
  let draft = {}; try { draft = JSON.parse(a.draft || '{}'); } catch {}
  const pairs = [['Vendor', a.vendor_id && (db.prepare('SELECT vendor FROM vendors WHERE id = ?').get(a.vendor_id) || {}).vendor],
    ['Job', a.home_id && (db.prepare('SELECT address FROM homes WHERE id = ?').get(a.home_id) || {}).address],
    ['Amount', a.amount], ...Object.entries(draft).map(([k, v]) => [FIELD_LABEL(k), v])];
  const seen = new Map();
  for (const [k, v] of pairs) { if (v == null || v === '' || typeof v === 'object') continue; seen.set(k.toLowerCase(), [k, String(v)]); }
  return [...seen.values()];
}
const APPROVE_PAGE = (a, token, msg) => { const opts = JSON.parse(a.options || '[]'); const choice = opts.length > 1; return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Approval — McVaugh purchasing</title><style>
body{font:15px/1.5 system-ui,Segoe UI,sans-serif;background:#eef3fb;color:#1b2436;margin:0;padding:24px;display:grid;place-items:start center}
.card{background:#fff;border:1px solid #d9e1ef;border-radius:12px;max-width:620px;width:100%;padding:20px 22px;box-shadow:0 6px 24px rgba(27,36,54,.1)}
h1{font-size:17px;margin:0 0 4px} .q{background:#fff8e6;border:1px solid #ecd9a3;border-radius:8px;padding:10px 12px;margin:12px 0;font-weight:600}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13.5px;margin:12px 0} dt{color:#5d6b85} dd{margin:0}
button{font:inherit;padding:9px 16px;border-radius:8px;border:1px solid transparent;cursor:pointer}
.ok{background:#1d9e75;color:#fff} .no{background:#fff;border-color:#e24b4a;color:#e24b4a} .row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
textarea,select{width:100%;font:inherit;border:1px solid #d9e1ef;border-radius:8px;padding:8px;margin-top:6px;background:#fff}
.done{background:#eef6f2;border:1px solid #bfe0d2;border-radius:8px;padding:12px}
label.opt{display:flex;gap:10px;align-items:flex-start;border:1px solid #d9e1ef;border-radius:8px;padding:10px 12px;margin:6px 0;cursor:pointer}
label.opt:hover{background:#f6f9ff} label.opt b{display:block} label.opt small{color:#5d6b85}
fieldset{border:0;padding:0;margin:12px 0} legend{font-weight:600;font-size:13.5px;padding:0}
small{color:#5d6b85}</style></head><body><div class="card"><h1>${esc(a.subject)}</h1>
<small>Asked by the purchasing agent · ${esc((a.requested_at || '').slice(0, 16).replace('T', ' '))}</small>
${msg ? `<div class="done">${msg}</div>` : `<div class="q">${esc(a.question)}</div>
${approvalFacts(a).length ? `<dl>${approvalFacts(a).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
<form method="POST" action="/approve/${a.id}"><input type="hidden" name="t" value="${esc(token)}">
${choice ? `<fieldset><legend>Pick one</legend>${opts.map((o, i) => `<label class="opt"><input type="radio" name="chosen" value="${esc(o.id)}"${opts.length === 1 ? ' checked' : ''}><span><b>${esc(o.label)}</b>${o.amount ? `<small>${esc(o.amount)}</small>` : ''}${o.note ? `<small>${esc(o.note)}</small>` : ''}</span></label>`).join('')}</fieldset>` : ''}
<label>Who is approving this?<select name="by" required><option value="">Choose your name…</option>${APPROVERS.map(id => `<option value="${esc(id)}"${id === a.requested_from ? ' selected' : ''}>${esc((db.prepare('SELECT name, full_name FROM people WHERE id = ?').get(id) || {}).full_name || id)}</option>`).join('')}</select></label>
<label>Note (optional; required if you reject)<textarea name="note" rows="2"></textarea></label>
<div class="row"><button class="ok" name="d" value="approve">${choice ? 'Approve the one I picked' : a.kind === 'bid_request' ? 'Approve and send the request' : 'Approve and enter the work order'}</button>
<button class="no" name="d" value="reject">${a.kind === 'bid_chase' ? 'Cancel this line item' : 'Reject'}</button></div></form>
<p><small>${a.kind === 'bid_request' ? 'Nothing has been sent to any vendor yet. Approving is what sends the request.' : a.kind === 'bid_chase' ? 'Nothing has been entered.' : 'Nothing has been entered and no subcontractor has been told anything. Approving is what enters the work order and notifies them.'} This page is in the purchasing channel, so it records the name you choose above as self-declared.</small></p>`}</div></body></html>`; };

// ---------- bids: request → receive → decide → enter ----------
// The rule Brittany set: do not ask a human to approve a line item until every bid asked for has come in.
// That is only answerable because the request is recorded first, with how many were expected.
// Bids are parked (Brittany, 2026-10-26): how a bid is requested and compared varies too much per trade to
// automate before a bid process exists on paper. The tables, endpoints and view stay so the work is not lost
// and anything already recorded is still readable, but nothing here runs until the flag is flipped back.
const bidFlowActive = () => db.prepare("SELECT value FROM meta WHERE key = 'bid_flow'").get()?.value === 'active';
const PARKED = { error: 'the bid flow is parked', detail: 'Requesting and comparing bids is not automated yet: it needs its own process and agent first. A work order is created when a person asks for one. See the Purchasing procedures.' };
const money = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
const APPROVERS = ['brittany', 'jim', 'kenneth', 'ernesto'];

function newApproval(fields) {
  const id = 'ap-' + crypto.randomUUID().slice(0, 8);
  const row = { id, token: crypto.randomBytes(16).toString('hex'), released: 0, status: 'pending',
    channel: 'teams', requested_at: dbm.nowIso(), ...fields };
  dbm.upsert(db, 'approvals', row);
  if (row.agent_id) dbm.addEvent(db, { entity_type: 'agent', entity_id: row.agent_id, kind: 'run', status: 'waiting_approval',
    source: row.source === 'manual' ? 'manual' : 'n8n', actor: row.source === 'manual' ? 'app' : 'n8n',
    label: `${row.subject} — waiting for ${row.requested_from || 'a decision'}`, external_id: (row.external_id || id) + ':waiting', payload: { approval_id: id } });
  return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
}

// Every bid asked for has arrived (or it was always a single, sole-sourced vendor).
function bidsComplete(br) {
  const n = db.prepare("SELECT COUNT(*) c FROM bids WHERE bid_request_id = ? AND status IN ('received','approved')").get(br.id).c;
  return n >= Math.max(1, br.expected);
}

// Ask the human to decide a line item. One bid is yes/no; several is "pick one", with the bids side by side.
function askToDecide(br, reason) {
  const open = db.prepare("SELECT * FROM approvals WHERE bid_request_id = ? AND status = 'pending'").get(br.id);
  if (open) return open;
  const bids = db.prepare("SELECT * FROM bids WHERE bid_request_id = ? AND status = 'received' ORDER BY amount_value IS NULL, amount_value").all(br.id);
  if (!bids.length) return null;
  const home = br.home_id && db.prepare('SELECT address FROM homes WHERE id = ?').get(br.home_id);
  const where = home ? ` — ${home.address}` : '';
  const vendorOf = id => db.prepare('SELECT * FROM vendors WHERE id = ?').get(id || '') || {};
  const sqftWarn = b => { const v = vendorOf(b.vendor_id); return v.pricing_basis === 'per_sqft' && !b.sqft ? ' (priced per square foot — the work order needs the square footage)' : ''; };
  const multi = bids.length > 1;
  const subject = multi ? `${bids.length} bids in for ${br.line_item}${where} — which one?` : `Bid received for ${br.line_item}${where} — ${bids[0].vendor_name || vendorOf(bids[0].vendor_id).vendor || 'vendor'}`;
  const question = multi
    ? `All ${br.expected} bids requested for ${br.line_item} have come in. Which one do you want? Approving enters the work order, which emails that subcontractor to say it is approved.`
    : `A bid was received for ${br.line_item}${br.sole_source ? ` (only vendor asked${br.sole_source_reason ? `: ${br.sole_source_reason}` : ''})` : ''}. Do you approve? Approving enters the work order, which emails ${bids[0].vendor_name || 'the subcontractor'} to say it is approved.`;
  const a = newApproval({ agent_id: 'agent-purchasing', task_id: 'tr-wo-entry-from-bid', kind: multi ? 'bid_award' : 'work_order',
    bid_request_id: br.id, subject, question, requested_from: br.requested_by || 'brittany',
    vendor_id: multi ? null : bids[0].vendor_id, home_id: br.home_id, amount: multi ? null : bids[0].amount,
    options: JSON.stringify(bids.map(b => ({ id: b.id, label: (b.vendor_name || vendorOf(b.vendor_id).vendor || b.vendor_id) + sqftWarn(b), amount: b.amount, note: b.scope_notes || null }))),
    evidence: reason || (multi ? `All ${bids.length} bids in` : br.sole_source ? 'Sole-sourced line item' : 'Bid received'),
    due_by: br.due_by, source: 'n8n', external_id: 'award:' + br.id });
  dbm.upsert(db, 'bid_requests', { id: br.id, status: 'complete', updated_at: dbm.nowIso() });
  return a;
}

// Called when a bid lands. Stays quiet until the request is complete — that is the whole point of the rule.
function onBidReceived(br) {
  const got = db.prepare("SELECT COUNT(*) c FROM bids WHERE bid_request_id = ? AND status IN ('received','approved')").get(br.id).c;
  if (bidsComplete(br)) return askToDecide(br);
  dbm.upsert(db, 'bid_requests', { id: br.id, status: 'partial', updated_at: dbm.nowIso() });
  dbm.addEvent(db, { entity_type: 'agent', entity_id: 'agent-purchasing', kind: 'run', status: 'finished', source: 'n8n', actor: 'n8n',
    label: `${br.line_item}: ${got} of ${br.expected} bids in — waiting for the rest before asking anyone`,
    external_id: `bidwait:${br.id}:${got}` });
  return null;
}

// A bid request past its due date is never left silent: the human is asked to chase or decide on what is in.
function sweepOverdueBids() {
  if (!bidFlowActive()) return;
  const now = Date.now();
  for (const br of db.prepare("SELECT * FROM bid_requests WHERE status IN ('sent','partial') AND due_by IS NOT NULL").all()) {
    if (new Date(br.due_by).getTime() > now) continue;
    const got = db.prepare("SELECT COUNT(*) c FROM bids WHERE bid_request_id = ? AND status = 'received'").get(br.id).c;
    dbm.upsert(db, 'bid_requests', { id: br.id, status: 'overdue', updated_at: dbm.nowIso() });
    if (db.prepare("SELECT 1 FROM approvals WHERE bid_request_id = ? AND status = 'pending'").get(br.id)) continue;
    const missing = db.prepare('SELECT vendors FROM bid_requests WHERE id = ?').get(br.id);
    const asked = JSON.parse(missing.vendors || '[]');
    const inIds = db.prepare('SELECT vendor_id FROM bids WHERE bid_request_id = ?').all(br.id).map(b => b.vendor_id);
    const late = asked.filter(v => !inIds.includes(v)).map(v => (db.prepare('SELECT vendor FROM vendors WHERE id = ?').get(v) || {}).vendor || v);
    newApproval({ agent_id: 'agent-purchasing', kind: 'bid_chase', bid_request_id: br.id,
      subject: `${br.line_item}: ${got} of ${br.expected} bids in and the date has passed`,
      question: `${late.length ? late.join(', ') + ' have not sent a bid. ' : ''}Do you want to chase them, or decide on the ${got} you have? Nothing has been entered.`,
      options: JSON.stringify([{ id: 'chase', label: 'Chase the missing bids' }, ...(got ? [{ id: 'decide', label: `Decide on the ${got} bid${got === 1 ? '' : 's'} already in` }] : []), { id: 'cancel', label: 'Cancel this line item' }]),
      requested_from: br.requested_by || 'brittany', home_id: br.home_id, due_by: br.due_by, source: 'manual', external_id: 'chase:' + br.id });
    dbm.addEvent(db, { entity_type: 'agent', entity_id: 'agent-purchasing', kind: 'run', status: 'waiting_approval', source: 'manual', actor: 'app',
      label: `${br.line_item} overdue: ${got} of ${br.expected} bids in`, external_id: `overdue:${br.id}` });
  }
}

// What happens once a human has decided. Nothing here contacts a vendor: it records the decision and
// leaves the work for n8n to pick up, so the act of sending is always downstream of a recorded approval.
function applyApprovalOutcome(a, approved) {
  const ts = dbm.nowIso();
  if (a.kind === 'bid_request' && approved) {
    dbm.upsert(db, 'bid_requests', { id: a.bid_request_id, status: 'sent', sent_at: ts, updated_at: ts });
  } else if (a.kind === 'bid_request') {
    dbm.upsert(db, 'bid_requests', { id: a.bid_request_id, status: 'cancelled', closed_at: ts, updated_at: ts });
  } else if (a.kind === 'bid_chase') {
    const br = db.prepare('SELECT * FROM bid_requests WHERE id = ?').get(a.bid_request_id || '');
    if (!br) return;
    if (a.chosen === 'cancel') dbm.upsert(db, 'bid_requests', { id: br.id, status: 'cancelled', closed_at: ts, updated_at: ts });
    else if (a.chosen === 'decide') { dbm.upsert(db, 'bid_requests', { id: br.id, status: 'partial', updated_at: ts }); askToDecide(br, 'Decided early: the rest did not come in'); }
    else dbm.upsert(db, 'bid_requests', { id: br.id, status: 'partial', due_by: new Date(Date.now() + 5 * 864e5).toISOString(), updated_at: ts });
  } else if (a.kind === 'work_order' || a.kind === 'bid_award') {
    const br = a.bid_request_id && db.prepare('SELECT * FROM bid_requests WHERE id = ?').get(a.bid_request_id);
    const opts = JSON.parse(a.options || '[]');
    const winner = a.chosen || (opts.length === 1 ? opts[0].id : null);
    if (!approved) {
      // Rejected: nothing is entered and nothing is sent. The reason is kept, and the line item goes back to a human.
      for (const o of opts) dbm.upsert(db, 'bids', { id: o.id, status: 'rejected', reject_reason: a.decision_note || 'rejected without a reason given', updated_at: ts });
      if (br) dbm.upsert(db, 'bid_requests', { id: br.id, status: 'partial', notes: [br.notes, `${ts.slice(0, 10)}: rejected — ${a.decision_note || 'no reason given'}`].filter(Boolean).join('\n'), updated_at: ts });
      return;
    }
    for (const o of opts) dbm.upsert(db, 'bids', { id: o.id, status: o.id === winner ? 'approved' : 'superseded', updated_at: ts });
    if (br && winner) dbm.upsert(db, 'bid_requests', { id: br.id, status: 'awarded', awarded_bid_id: winner, closed_at: ts, updated_at: ts });
  }
}

// ---------- succession: "if this person were gone tomorrow, what stops?" ----------
const BACKUP_NONE = v => !v || /^(none|nobody|n\/a|-)?\s*$/i.test(v) || /nobody assigned|nobody else/i.test(v);
function handoverView(pid, role) {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(pid); if (!person) return { error: 'no such person' };
  const items = db.prepare('SELECT * FROM handover_items WHERE person_id = ? ORDER BY id').all(pid)
    .map(i => ({ ...i, task_ids: JSON.parse(i.task_ids || '[]'), doc_ids: JSON.parse(i.doc_ids || '[]'), no_backup: BACKUP_NONE(i.backup) || /unconfirmed/i.test(i.backup || '') }));
  const riskRank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => (a.no_backup === b.no_backup ? 0 : a.no_backup ? -1 : 1) || (riskRank[a.risk] ?? 3) - (riskRank[b.risk] ?? 3) || a.item.localeCompare(b.item));
  const tasks = db.prepare('SELECT * FROM tasks WHERE archived = 0 AND (owner_id = ? OR backup_id = ?) ORDER BY title').all(pid, pid)
    .map(t => ({ id: t.id, title: t.title, role: t.owner_id === pid ? 'owner' : 'backup', backup_id: t.backup_id, owner_id: t.owner_id, documented: t.documented, verified: t.verified, proposed: t.proposed, department_id: t.department_id, has_flow: !!t.flow, has_review: !!t.step_review,
      review_counts: t.step_review ? JSON.parse(t.step_review).reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {}) : null, sensitive: t.sensitive, restricted: t.sensitive && !can.sensitive(role) }));
  const homes = db.prepare("SELECT * FROM homes WHERE active = 'active' ORDER BY address").all();
  const notMentioned = []; for (const t of db.prepare('SELECT id, title, step_review FROM tasks WHERE step_review IS NOT NULL AND owner_id = ?').all(pid)) for (const r of JSON.parse(t.step_review)) if (r.verdict === 'not_mentioned') notMentioned.push({ task_id: t.id, task: t.title, step: r.n, old: r.old });
  // Questions the build sequence raises for this person: steps MCH does itself, steps with nobody chosen,
  // steps that need a login in her name, and parties with no vendor record.
  const bs = db.prepare("SELECT * FROM build_steps WHERE kind = 'step' ORDER BY seq").all();
  const build = bs.length ? { total: bs.length, mch: bs.filter(b => b.is_mch), gaps: bs.filter(b => b.gap),
    logins: bs.filter(b => b.credential_note), no_vendor: bs.filter(b => !b.vendor_id && !b.is_mch && !b.gap) } : null;
  return { person: { ...person, departments: JSON.parse(person.departments || '[]'), responsibilities: JSON.parse(person.responsibilities || '[]'), crossed_off: JSON.parse(person.crossed_off || '[]'), legacy_roles: JSON.parse(person.legacy_roles || '[]'), email: can.sensitive(role) ? person.email : undefined },
    items, tasks, homes, build, not_mentioned: notMentioned, generated_at: dbm.nowIso() };
}
function agendaMarkdown(h) {
  const L = [`# Handover meeting agenda — ${h.person.full_name || h.person.name}`, `Generated ${h.generated_at.slice(0, 10)} from the Handover view. Ordered by risk: items nobody else can do today come first. Each line cites where the gap was found.`, '',
    '## A. Walk me through what only you do (no backup today)'];
  let n = 1;
  for (const i of h.items.filter(i => i.no_backup && i.status === 'open')) L.push(`${n++}. **${i.item}** — walk me through how you do this today, step by step. Who else could do this today? What would someone need to know on day one? *(to capture: ${i.capture})* ${i.cite}`);
  L.push('', '## B. Steps in the old procedures you did not mention — still done, changed, or gone?');
  const byTask = {}; for (const x of h.not_mentioned) (byTask[x.task] = byTask[x.task] || []).push(x);
  for (const [task, rows] of Object.entries(byTask)) { L.push(`- **${task}**:`); for (const r of rows) L.push(`  - step ${r.step}: "${r.old}" — is this still done? by whom? If gone, what replaced it?`); }
  L.push('', '## C. Items with a possible backup — confirm the person can actually do it');
  for (const i of h.items.filter(i => !i.no_backup && i.status === 'open')) L.push(`- **${i.item}** — you said ${i.backup || 'someone'} could cover this. Have they done it alone? What would you show them first? ${i.cite}`);
  L.push('', '## D. Each active job: where does it stand on the day you leave?');
  for (const hm of h.homes) L.push(`- **${hm.address}** — stage: ${hm.stage || '?'}; next milestone: ${hm.next_milestone || '?'}; open issues: ${hm.issues || 'none recorded'}. Who is the trade contact for the next step?`);
  if (h.build) {
    L.push('', '## E. The build order you wrote — the questions it does not answer',
      `Your "How to build a house" gives ${h.build.total} steps in order. Walking it once, these are the gaps:`,
      `- **How long does each step take?** The sheet gives the order but no durations, so the schedule is still in your head. Can we put a working day count against each step?`);
    if (h.build.mch.length) L.push(`- **The ${h.build.mch.length} steps McVaugh does itself** (no sub to fall back on) — who does each of these after you leave? ${h.build.mch.slice(0, 6).map(b => b.description).join('; ')}${h.build.mch.length > 6 ? '; …' : ''}`);
    if (h.build.logins.length) L.push(`- **The ${h.build.logins.length} steps that need a portal login in your name** (${[...new Set(h.build.logins.map(b => (b.notes || '').match(/https?:\/\/([^\s/]+)/)?.[1]).filter(Boolean))].join(', ')}) — the CenterPoint portal has two-factor tied to your email and phone. Who do we re-register these to, and when?`);
    if (h.build.gaps.length) L.push(`- **${h.build.gaps.length} steps still have no contractor chosen**: ${h.build.gaps.map(b => b.description).join('; ')}. Who are you leaning toward?`);
    if (h.build.no_vendor.length) L.push(`- **${h.build.no_vendor.length} steps name someone who is not on the vendor list**: ${[...new Set(h.build.no_vendor.map(b => b.responsible))].join(', ')}. Can we get their contact details and pricing onto the SOW?`);
    L.push(`- **Is this list the Villas only, or does it hold for the Landing and Royal Oaks Run too?** What changes between them?`);
  }
  L.push('', '## F. Documents you said you would leave', '- Permit step-by-step document; per-lot permit status list (which 7 villa lots are permitted)', '- Schedule document with durations; copy of the 11603 calendar (the order-of-construction document arrived 10/22)', '- Vendor list with $/sq ft rates; square footage per plan per trade', '- Frank scope document (Landing); CBUSA reporting process; insurance spreadsheet path; walkthrough checklist location; warranty procedure location');
  return L.join('\n');
}

// ---------- keep the old ops hub file in step with the world (MOW_OPSHUB_PATH) ----------
const OPSHUB_PATH = process.env.MOW_OPSHUB_PATH || '';
let opshubTimer = null;
function scheduleOpsHubWrite(reason) {
  if (!OPSHUB_PATH) return;
  clearTimeout(opshubTimer);
  opshubTimer = setTimeout(() => {
    try {
      const html = imports.regenerateOpsHub(db, fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.template.html'), 'utf8'));
      fs.writeFileSync(OPSHUB_PATH, html);
      setIntegration('dashboard', 'connected', `Ops hub file rewritten ${dbm.nowIso()} (${reason}) → ${OPSHUB_PATH}`);
    } catch (e) { setIntegration('dashboard', 'failing', `Could not rewrite ${OPSHUB_PATH}: ${e.message}`); }
  }, 3000);
}

// ---------- router ----------
setInterval(() => { try { sweepOverdueBids(); } catch (e) { console.error('bid sweep', e.message); } }, 5 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const role = roleOf(req);
  try {
    if (p.startsWith('/api/')) return await api(req, res, url, p, role);
    // The Approve/Reject links in the Teams message land here. A GET only *shows* the decision page:
    // Teams and Outlook fetch links to build previews, so a GET must never decide anything.
    if (p.startsWith('/approve/') && (req.method === 'GET' || req.method === 'POST')) {
      const id = p.slice('/approve/'.length);
      const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
      const html = (code, body) => send(res, code, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      if (!a) return html(404, '<p>That approval request no longer exists.</p>');
      const q = req.method === 'POST' ? new URLSearchParams((await readBody(req)).toString('utf8')) : url.searchParams;
      const token = q.get('t') || url.searchParams.get('t');
      if (!a.token || token !== a.token) return html(403, '<p>That approval link is not valid. Open the world and approve it there.</p>');
      if (a.status !== 'pending') return html(200, APPROVE_PAGE(a, token, `Already <b>${esc(a.status)}</b> by ${esc(a.decided_by || 'someone')} on ${esc((a.decided_at || '').slice(0, 16).replace('T', ' '))}.`));
      if (req.method === 'GET') return html(200, APPROVE_PAGE(a, token));
      const d = q.get('d') === 'approve' ? 'approve' : 'reject';
      // The message goes to the purchasing channel, so the link proves someone in that channel opened it,
      // not which person. They name themselves and it is recorded as self-declared.
      const by = q.get('by');
      if (!by || !APPROVERS.includes(by)) return html(200, APPROVE_PAGE(a, token, 'Choose your name before approving, so the decision has someone\'s name on it. <a href="">Go back</a>.'));
      const note = q.get('note');
      if (d === 'reject' && !String(note || '').trim()) return html(200, APPROVE_PAGE(a, token, 'Say why you are rejecting it, so the next person knows what to do. <a href="">Go back</a>.'));
      const r = decideApproval(a, d, by, 'teams-link', note, q.get('chosen'), 'self_declared');
      if (!r.ok && r.options) return html(200, APPROVE_PAGE(a, token, 'Pick which bid you are approving. <a href="">Go back</a>.'));
      return html(200, APPROVE_PAGE(a, token, r.ok
        ? (d === 'approve'
          ? (a.kind === 'bid_request' ? 'Approved. The bid request goes out to those vendors.' : 'Approved. The work order will be entered and the subcontractor notified.')
          : 'Rejected. Nothing was sent and the reason is recorded.')
        : `Already ${esc(r.error)}.`));
    }
    if (p.startsWith('/files/')) { // uploaded documents; same role rules as the document record
      if (!role) return send(res, 401, 'login required');
      const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(decodeURIComponent(p.slice(7)));
      if (!d || !d.file_path || !fs.existsSync(d.file_path)) return send(res, 404, 'no file');
      if (d.sensitive && !can.sensitive(role)) return send(res, 403, 'restricted');
      return send(res, 200, fs.readFileSync(d.file_path), { 'Content-Type': d.mime || 'application/octet-stream', 'Content-Disposition': `inline; filename="${path.basename(d.file_path).replace(/"/g, '')}"` });
    }
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
  // ---------- approvals: an agent drafted something; a named human decides before it leaves ----------
  const secretOk = (rq, u) => !!N8N_SECRET && (rq.headers['x-mow-secret'] || u.searchParams.get('secret')) === N8N_SECRET;

  // n8n calls this when the purchasing agent has drafted a work order from a subcontractor's bid.
  // The work order is NOT sent to the sub here: it stays a draft until someone approves below.
  if (p === '/api/webhooks/approval' && m === 'POST') {
    const given = req.headers['x-mow-secret'] || url.searchParams.get('secret');
    if (!N8N_SECRET || given !== N8N_SECRET) { setIntegration('n8n', 'failing', 'Rejected an approval request with a bad or missing secret at ' + dbm.nowIso()); return send(res, 401, { error: 'bad secret' }); }
    const b = await readJson(req);
    if (!b.subject) return send(res, 400, { error: 'subject required' });
    const ext = 'approval:' + (b.external_id || b.execution_id || crypto.randomUUID());
    const existing = db.prepare('SELECT * FROM approvals WHERE external_id = ?').get(ext);
    if (existing) return send(res, 200, { ok: true, deduplicated: true, id: existing.id, url: approvalLink(existing) });
    const id = 'ap-' + crypto.randomUUID().slice(0, 8);
    const token = crypto.randomBytes(16).toString('hex');
    const agentId = b.agent_id || 'agent-purchasing';
    const who = b.requested_from || db.prepare('SELECT owner_id FROM tasks WHERE id = ?').get(b.task_id || '')?.owner_id || 'brittany';
    const row = { id, agent_id: agentId, task_id: b.task_id || null, kind: b.kind || 'work_order', subject: String(b.subject),
      vendor_id: b.vendor_id || null, home_id: b.home_id || null, amount: b.amount != null ? String(b.amount) : null,
      question: b.question || 'A work order was entered as a draft. Please verify it is correct. Do you approve sending it to the subcontractor?',
      draft: b.draft ? JSON.stringify(b.draft) : null, evidence: b.evidence || null, released: 0, status: 'pending',
      requested_from: who, channel: b.channel || 'teams', channel_ref: b.channel_ref || null, token,
      requested_at: dbm.nowIso(), source: b.source || 'n8n', external_id: ext };
    dbm.upsert(db, 'approvals', row);
    dbm.addEvent(db, { entity_type: 'agent', entity_id: agentId, kind: 'run', status: 'waiting_approval', source: 'n8n', actor: 'n8n',
      label: `Drafted ${row.subject} — waiting for ${who} to approve`, external_id: ext + ':waiting', payload: { approval_id: id } });
    setIntegration('n8n', 'connected', `Last authenticated event ${dbm.nowIso()}`);
    // One link only: the page is where the decision is made, so there is no one-click approve URL to leak.
    return send(res, 200, { ok: true, id, question: row.question, url: approvalLink(row) });
  }


  // The agent proposes a set of bid requests, built from the vendor contact list. Sending them to vendors
  // is outward-facing, so it is its own approval: nothing reaches a vendor before a human says so.
  if (p === '/api/webhooks/bid-request' && m === 'POST') {
    if (!bidFlowActive()) return send(res, 410, PARKED);
    if (!secretOk(req, url)) return send(res, 401, { error: 'bad secret' });
    const b = await readJson(req);
    if (!b.line_item) return send(res, 400, { error: 'line_item required' });
    const ext = 'bidreq:' + (b.external_id || b.execution_id || crypto.randomUUID());
    const dupe = db.prepare('SELECT * FROM approvals WHERE external_id = ?').get(ext);
    if (dupe) return send(res, 200, { ok: true, deduplicated: true, id: dupe.id, bid_request_id: dupe.bid_request_id, url: approvalLink(dupe) });
    // Vendors come from the contact list for that trade unless the agent named them explicitly.
    let vendors = Array.isArray(b.vendors) && b.vendors.length ? b.vendors
      : db.prepare('SELECT id FROM vendors WHERE UPPER(trade) = UPPER(?)').all(b.line_item).map(v => v.id);
    vendors = [...new Set(vendors)].filter(Boolean);
    if (!vendors.length) return send(res, 400, { error: `no vendor on the contact list for "${b.line_item}" — add one in Registry → Vendors` });
    if (b.home_id && !db.prepare('SELECT 1 FROM homes WHERE id = ?').get(b.home_id)) return send(res, 400, { error: 'no such job', detail: `"${b.home_id}" is not a job in the registry` });
    const names = vendors.map(v => (db.prepare('SELECT vendor, trade FROM vendors WHERE id = ?').get(v) || {}).vendor || v);
    const sole = vendors.length === 1;
    const ts = dbm.nowIso();
    const brId = 'br-' + crypto.randomUUID().slice(0, 8);
    const days = Number(b.due_days) > 0 ? Number(b.due_days) : 7;
    dbm.upsert(db, 'bid_requests', { id: brId, line_item: b.line_item, cost_code: b.cost_code || null, home_id: b.home_id || null,
      build_step_id: b.build_step_id || null, scope: b.scope || null,
      docs_provided: b.docs_provided || (db.prepare('SELECT docs_needed FROM vendors WHERE id = ?').get(vendors[0]) || {}).docs_needed || null,
      vendors: JSON.stringify(vendors), expected: Number(b.expected) || vendors.length,
      sole_source: sole ? 1 : 0, sole_source_reason: sole ? (b.sole_source_reason || 'only one vendor on the contact list for this trade') : null,
      due_by: new Date(Date.now() + days * 864e5).toISOString(), status: 'draft', requested_by: b.requested_by || 'brittany',
      requested_at: ts, source: b.source || 'agent-purchasing', updated_at: ts });
    const home = b.home_id && db.prepare('SELECT address FROM homes WHERE id = ?').get(b.home_id);
    const a = newApproval({ agent_id: 'agent-purchasing', task_id: 'tr-bid-requests', kind: 'bid_request', bid_request_id: brId,
      subject: `Request bids for ${b.line_item}${home ? ' — ' + home.address : ''}`,
      question: `Send a bid request to ${names.join(', ')}?${sole ? ' That is the only vendor on the contact list for this trade — Maria\'s note was that whoever takes this over should get more than one bid, so add another vendor if you want a comparison.' : ''} Nothing goes out until you approve.`,
      draft: JSON.stringify({ 'Line item': b.line_item, Vendors: names.join(', '), 'Documents to send': b.docs_provided || '(from the SOW)', 'Bids expected': String(Number(b.expected) || vendors.length), 'Due back': `${days} days` }),
      requested_from: b.requested_by || 'brittany', home_id: b.home_id || null, due_by: null, source: b.source || 'n8n', external_id: ext });
    setIntegration('n8n', 'connected', `Last authenticated event ${ts}`);
    return send(res, 200, { ok: true, id: a.id, bid_request_id: brId, sole_source: sole, vendors: names, url: approvalLink(a) });
  }

  // A bid came back from a vendor. Recorded against its request; the human is only asked once they are all in.
  if (p === '/api/webhooks/bid' && m === 'POST') {
    if (!bidFlowActive()) return send(res, 410, PARKED);
    if (!secretOk(req, url)) return send(res, 401, { error: 'bad secret' });
    const b = await readJson(req);
    const br = b.bid_request_id ? db.prepare('SELECT * FROM bid_requests WHERE id = ?').get(b.bid_request_id)
      : db.prepare("SELECT * FROM bid_requests WHERE UPPER(line_item) = UPPER(?) AND (home_id IS ? OR home_id = ?) AND status IN ('sent','partial','overdue') ORDER BY requested_at DESC").get(b.line_item || '', b.home_id || null, b.home_id || null);
    if (!br) return send(res, 409, { error: 'no open bid request for that line item — the agent must ask for bids before one can be recorded against it' });
    const ext = 'bid:' + (b.external_id || `${br.id}:${b.vendor_id || b.vendor_name}`);
    const dupe = db.prepare('SELECT id FROM bids WHERE source = ?').get(ext);
    if (dupe) return send(res, 200, { ok: true, deduplicated: true, id: dupe.id });
    const vend = b.vendor_id && db.prepare('SELECT * FROM vendors WHERE id = ?').get(b.vendor_id);
    const ts = dbm.nowIso();
    const id = 'bid-' + crypto.randomUUID().slice(0, 8);
    dbm.upsert(db, 'bids', { id, bid_request_id: br.id, vendor_id: b.vendor_id || null, vendor_name: b.vendor_name || (vend || {}).vendor || null,
      amount: b.amount != null ? String(b.amount) : null, amount_value: money(b.amount), basis: (vend || {}).pricing_basis || null,
      sqft: b.sqft != null ? String(b.sqft) : null, scope_notes: b.scope_notes || null, doc_id: b.doc_id || null,
      received_at: ts, status: 'received', source: ext, updated_at: ts });
    const a = onBidReceived(db.prepare('SELECT * FROM bid_requests WHERE id = ?').get(br.id));
    const got = db.prepare("SELECT COUNT(*) c FROM bids WHERE bid_request_id = ? AND status = 'received'").get(br.id).c;
    setIntegration('n8n', 'connected', `Last authenticated event ${ts}`);
    return send(res, 200, { ok: true, id, received: got, expected: br.expected, asked_for_decision: !!a, approval_id: a ? a.id : null, url: a ? approvalLink(a) : null });
  }

  // n8n reports back the work-order number after entering an approved bid into the MCH database.
  if (p === '/api/webhooks/bid/entered' && m === 'POST') {
    if (!secretOk(req, url)) return send(res, 401, { error: 'bad secret' });
    const b = await readJson(req);
    const ts = dbm.nowIso();
    const row = b.bid_id ? db.prepare('SELECT * FROM bids WHERE id = ?').get(b.bid_id)
      : db.prepare("SELECT * FROM approvals WHERE id = ? AND kind = 'work_order'").get(b.approval_id || '');
    if (!row) return send(res, 404, { error: 'no such bid or work-order request' });
    const approved = b.bid_id ? row.status === 'approved' : row.status === 'approved';
    if (!approved) return send(res, 409, { error: 'that was not approved, so no work order may be entered for it' });
    if (row.wo_ref) return send(res, 409, { error: 'a work order was already entered for this', wo_ref: row.wo_ref });
    const who = b.bid_id ? (row.vendor_name || row.vendor_id) : (db.prepare('SELECT vendor FROM vendors WHERE id = ?').get(row.vendor_id || '') || {}).vendor || row.subject;
    dbm.upsert(db, b.bid_id ? 'bids' : 'approvals', { id: row.id, wo_ref: b.wo_ref || null, entered_at: ts, entered_by: b.entered_by || 'n8n', ...(b.bid_id ? { updated_at: ts } : {}) });
    dbm.addEvent(db, { entity_type: 'agent', entity_id: 'agent-purchasing', kind: 'run', status: 'finished', source: 'n8n', actor: 'n8n',
      label: `Work order ${b.wo_ref || ''} entered for ${who} — the subcontractor has been notified`.replace(/\s+/g, ' '),
      external_id: `entered:${row.id}` });
    return send(res, 200, { ok: true });
  }

  // n8n polls these: what has been approved and is waiting to be acted on.
  if (p === '/api/webhooks/work' && m === 'GET') {
    if (!secretOk(req, url)) return send(res, 401, { error: 'bad secret' });
    return send(res, 200, {
      send_bid_requests: db.prepare("SELECT * FROM bid_requests WHERE status = 'sent' AND sent_at IS NOT NULL").all()
        .map(r => ({ ...r, vendors: JSON.parse(r.vendors || '[]').map(v => db.prepare('SELECT id, vendor, trade, contacts FROM vendors WHERE id = ?').get(v)).filter(Boolean) })),
      enter_work_orders: [
        ...db.prepare("SELECT * FROM bids WHERE status = 'approved' AND wo_ref IS NULL").all().map(b => ({ ...b, from: 'bid' })),
        ...db.prepare("SELECT * FROM approvals WHERE kind = 'work_order' AND status = 'approved' AND bid_request_id IS NULL AND wo_ref IS NULL").all()
          .map(a => ({ ...a, token: undefined, from: 'request' })),
      ],
    });
  }

  // --- everything else needs a session ---
  if (!role) return send(res, 401, { error: 'login required' });

  if (p === '/api/state' && m === 'GET') return send(res, 200, stateFor(role));
  if (p === '/api/approvals' && m === 'GET') return send(res, 200, db.prepare("SELECT * FROM approvals ORDER BY requested_at DESC LIMIT 200").all().map(a => ({ ...a, token: undefined })));
  if (p === '/api/export' && m === 'GET') { if (!can.sensitive(role)) return send(res, 403, { error: 'restricted' }); dbm.audit(db, role, 'export'); return send(res, 200, dbm.exportAll(db), { 'Content-Disposition': `attachment; filename="mcvaugh-world-${new Date().toISOString().slice(0, 10)}.json"` }); }
  if (p.startsWith('/api/handover') && m === 'GET') {
    const pid = url.searchParams.get('person') || 'maria';
    const h = handoverView(pid, role);
    if (p === '/api/handover/agenda') return send(res, 200, agendaMarkdown(h), { 'Content-Type': MIME['.md'] });
    return send(res, 200, h);
  }
  if (p === '/api/export/opshub' && m === 'GET') { // the old dashboard, regenerated from the world
    const html = imports.regenerateOpsHub(db, fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.template.html'), 'utf8'));
    dbm.audit(db, role, 'export_opshub'); return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="mch-ops-hub.html"' });
  }
  if (p === '/api/export/pages' && m === 'GET') return send(res, 200, imports.pagesMarkdown(stateFor(role)), { 'Content-Type': MIME['.md'] });

  if (m === 'GET') return send(res, 404, { error: 'not found' });
  requireWrite(role);

  // Deciding inside the world. Purchasing commitments are accounting/admin only, and the decision is named and audited.
  if (p.startsWith('/api/approvals/') && m === 'POST') {
    const [, , , id, action] = p.split('/');
    const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!a) return send(res, 404, { error: 'no such approval' });
    if (!can.sensitive(role)) return send(res, 403, { error: 'approving a work order is restricted to accounting/admin' });
    const b = await readJson(req);
    if (action === 'cancel') { dbm.upsert(db, 'approvals', { id, status: 'cancelled', decided_at: dbm.nowIso(), decided_by: role, decided_via: 'app', decision_note: b.note || null }); dbm.audit(db, role, 'approval_cancel', 'approval', id, a.subject); return send(res, 200, { ok: true }); }
    if (action !== 'approve' && action !== 'reject') return send(res, 404, { error: 'not found' });
    // Already decided beats every other complaint: re-deciding is the thing to refuse.
    if (a.status !== 'pending') return send(res, 409, { error: `already ${a.status}`, approval: a });
    // A rejection without a reason tells the next person nothing, so it is not accepted.
    if (action === 'reject' && !String(b.note || '').trim()) return send(res, 400, { error: 'say why you are rejecting it' });
    const r = decideApproval(a, action, b.by || role, 'app', b.note, b.chosen);
    return send(res, r.ok ? 200 : 409, r);
  }
  // Run the overdue check now (it also runs on a timer).
  if (p === '/api/bids/sweep' && m === 'POST') { sweepOverdueBids(); return send(res, 200, { ok: true }); }
  // A person asks the agent to create a work order. This is the only way one starts: the agent never
  // decides on its own that a work order is due. The person names the vendor, job and amount (or points at
  // the bid), the agent fills the rest in, and it is confirmed before anything is entered — because
  // entering is what emails the subcontractor to say it is approved [M-chat 10/24].
  if (p === '/api/work-orders/request' && m === 'POST') {
    const b = await readJson(req);
    if (!b.vendor_id) return send(res, 400, { error: 'which vendor?' });
    const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(b.vendor_id);
    if (!v) return send(res, 400, { error: 'no such vendor' });
    const home = b.home_id ? db.prepare('SELECT address FROM homes WHERE id = ?').get(b.home_id) : null;
    // A work order against the wrong job, or a job that does not exist, is worse than no work order.
    if (b.home_id && !home) return send(res, 400, { error: 'no such job', detail: `"${b.home_id}" is not a job in the registry` });
    const needsSqft = v.pricing_basis === 'per_sqft' && !String(b.sqft || '').trim();
    const over = !!b.over_budget;
    const a = newApproval({ agent_id: 'agent-purchasing', task_id: 'tr-wo-entry-from-bid', kind: 'work_order',
      subject: `Work order — ${v.vendor || v.trade}${home ? ' — ' + home.address : ''}`,
      question: `${role === 'admin' || role === 'accounting' ? 'You asked' : 'Someone asked'} for this work order. Check what will be entered. Entering it emails ${v.vendor || 'the subcontractor'} to say it is approved.${needsSqft ? ' This vendor prices per square foot, so the square footage has to be on the order.' : ''}${over ? ' It is over the budget line, so Jim approves this one.' : ''}`,
      draft: JSON.stringify({ Vendor: v.vendor || v.trade, Trade: v.trade, Job: home ? home.address : '(not set)',
        'Cost code': b.cost_code || '(not set)', Description: b.description || '(not set)', Amount: b.amount || '(not set)',
        ...(v.pricing_basis === 'per_sqft' ? { 'Square footage': b.sqft || 'MISSING — required for this vendor', Rate: v.rate || '(see Vendors)' } : {}),
        Draws: b.draws || '1' }),
      evidence: b.evidence || (b.bid_doc_id ? 'Bid document ' + b.bid_doc_id : 'Asked for by ' + role),
      vendor_id: b.vendor_id, home_id: b.home_id || null, amount: b.amount != null ? String(b.amount) : null,
      requested_by: role, requested_from: over ? 'jim' : 'brittany',
      channel: b.channel || 'app', source: 'manual', external_id: 'wo:' + crypto.randomUUID() });
    dbm.audit(db, role, 'work_order_requested', 'approval', a.id, a.subject);
    return send(res, 200, { ok: true, id: a.id, url: approvalLink(a), needs_sqft: needsSqft });
  }
  // Paste a procedure exactly as it is written in ChatGPT. Nothing has to be formatted first:
  // what can be recognised is filed, the rest is kept verbatim, and the original text is attached.
  if (p === '/api/procedures/paste' && m === 'POST') {
    const b = await readJson(req);
    const text = String(b.text || '').trim();
    if (text.length < 20) return send(res, 400, { error: 'paste the procedure text' });
    const parsed = imports.parseSkill(text);
    const title = String(b.title || parsed.title || '').trim() || 'Untitled procedure';
    const id = b.id || 'sop-' + dbm.slug(title).slice(0, 48);
    const existed = db.prepare('SELECT id, steps FROM tasks WHERE id = ?').get(id);
    const ts = dbm.nowIso();
    const { vendors, homes } = imports.mentionsIn(db, text);
    const src = b.source || 'ChatGPT skill, pasted by ' + role;
    dbm.upsert(db, 'tasks', { id, title, department_id: b.department_id || 'purchasing',
      owner_id: b.owner_id || 'brittany', backup_id: b.backup_id || null,
      trigger: parsed.trigger || null, inputs: parsed.inputs || null,
      steps: parsed.steps.map((x, i) => `${i + 1}. ${x}`).join('\n') || null,
      approval_rules: parsed.approval_rules || null, evidence: parsed.evidence || null,
      missing_info: parsed.notes || null, documented: parsed.steps.length ? 1 : 0, automated: 0, verified: 0,
      board: b.board || 'working', proposed: 0, agent_id: b.agent_id || null,
      source: src, supersedes: b.supersedes || undefined, updated_at: ts });
    // the skill text itself, kept word for word so a successor can rebuild the skill
    const docId = 'doc-' + id;
    dbm.upsert(db, 'documents', { id: docId, title: `${title} — skill text as written`, kind: 'procedure',
      kind_reason: 'the ChatGPT skill this procedure was written from', sensitive: 0, task_id: id,
      summary: `Pasted ${ts.slice(0, 10)}. ${parsed.steps.length} steps recognised${vendors.length ? `; mentions ${vendors.length} vendor${vendors.length === 1 ? '' : 's'}` : ''}.`,
      content: text, size: text.length, source: src, imported_at: ts, underlying_status: 'extracted' });
    const t = db.prepare('SELECT doc_ids FROM tasks WHERE id = ?').get(id);
    const ids = JSON.parse(t.doc_ids || '[]'); if (!ids.includes(docId)) dbm.upsert(db, 'tasks', { id, doc_ids: [...ids, docId] });
    dbm.addEvent(db, { entity_type: 'task', entity_id: id, kind: 'setup', status: 'info',
      label: `${existed ? 'Updated' : 'Added'} from a pasted ChatGPT skill: ${title}`, source: 'import', actor: role,
      external_id: `paste:${id}:${ts}` });
    dbm.audit(db, role, existed ? 'procedure_updated' : 'procedure_added', 'task', id, title);
    scheduleOpsHubWrite('pasted procedure');
    return send(res, 200, { ok: true, id, doc_id: docId, updated: !!existed,
      parsed: { title, trigger: parsed.trigger, inputs: parsed.inputs, steps: parsed.steps, approval_rules: parsed.approval_rules, notes: parsed.notes },
      vendors: vendors.map(v => ({ id: v, name: (db.prepare('SELECT vendor, trade FROM vendors WHERE id = ?').get(v) || {}).vendor })),
      homes: homes.map(h => ({ id: h, address: (db.prepare('SELECT address FROM homes WHERE id = ?').get(h) || {}).address })) });
  }

  // Paste the running log of per-vendor / per-job specifics. Re-pasting updates rows rather than piling up.
  if (p === '/api/specifics/paste' && m === 'POST') {
    const b = await readJson(req);
    const rows = imports.parseSpecificsLog(b.text || '');
    if (!rows.length) return send(res, 400, { error: 'nothing recognised', detail: 'A table with vendor / job / detail columns, or lines like "Johnston Waterproofing — standard pricing".' });
    const ts = dbm.nowIso(); const out = []; let matched = 0;
    for (const r of rows) {
      const v = r.vendor && (db.prepare('SELECT id, vendor FROM vendors WHERE LOWER(vendor) = LOWER(?) OR LOWER(trade) = LOWER(?)').get(r.vendor, r.vendor)
        || db.prepare("SELECT id, vendor FROM vendors WHERE LOWER(vendor) LIKE LOWER(?)").get('%' + r.vendor + '%'));
      const h = r.job && (db.prepare('SELECT id, address FROM homes WHERE LOWER(address) = LOWER(?)').get(r.job)
        || db.prepare("SELECT id, address FROM homes WHERE LOWER(address) LIKE LOWER(?)").get('%' + r.job + '%'));
      if (v || h) matched++;
      const scope = v && h ? 'vendor_job' : h ? 'job' : 'vendor';
      const id = 'ws-' + dbm.slug([v ? v.id : r.vendor, h ? h.id : r.job].filter(Boolean).join('-')).slice(0, 52);
      dbm.upsert(db, 'wo_specifics', { id, vendor_id: v ? v.id : null, vendor_name: r.vendor || null,
        home_id: h ? h.id : null, job_name: r.job || null, detail: r.detail || '', scope,
        task_id: b.task_id || null, source: b.source || 'ChatGPT running log, pasted by ' + role,
        noted_on: r.updated || null, updated_at: ts });
      // a vendor-wide note is also what a work order for that vendor must carry
      if (v && !h && r.detail) dbm.upsert(db, 'vendors', { id: v.id, wo_instructions: r.detail, wo_review: 'reviewed' });
      out.push({ id, vendor: v ? v.vendor : r.vendor, job: h ? h.address : r.job || null, detail: r.detail, matched: !!(v || h) });
    }
    dbm.addEvent(db, { entity_type: 'integration', entity_id: 'manual', kind: 'import', status: 'info',
      label: `Running log pasted: ${rows.length} specifics (${matched} matched a vendor or job on file)`, source: 'import', actor: role, external_id: `speclog:${ts}` });
    dbm.audit(db, role, 'specifics_pasted', 'wo_specifics', null, `${rows.length} rows`);
    return send(res, 200, { ok: true, count: rows.length, matched, rows: out });
  }
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
  if (p === '/api/import/obsidian' && m === 'POST') { const b = await readJson(req); const r = imports.importMarkdown(db, b.files || [], role, { overrides: b.overrides || {} }); setIntegration('obsidian', 'connected', `Snapshot import: ${r.imported} notes`, { last_import_at: dbm.nowIso() }); return send(res, 200, r); }
  if (p === '/api/import/csv' && m === 'POST') {
    const b = await readJson(req); const r = imports.importCsv(db, b, role);
    setIntegration(b.target === 'dashboard' ? 'dashboard' : 'excel', 'connected', `Snapshot import: ${b.filename || 'csv'} (${r.imported} rows)`, { last_import_at: dbm.nowIso() });
    return send(res, 200, r);
  }
  if (p === '/api/import/preview' && m === 'POST') {
    const b = await readJson(req); const people = db.prepare('SELECT id, name FROM people').all(), departments = db.prepare('SELECT id, name, short FROM departments').all();
    if (b.dir) return send(res, 200, imports.importFolder(db, { dir: b.dir, dryRun: true, force: !!b.force, csvTarget: b.target || 'auto', overrides: b.overrides || {} }, role));
    const out = (b.files || []).map(f => /\.csv$/i.test(f.name) ? { name: f.name, kind: 'csv', ...imports.parseCsvFile({ target: b.target || 'auto', filename: f.name, content: f.content }, { aliases: imports.aliasMap(db), people }) } : { name: f.name, kind: 'md', ...imports.parseNote(f, { headings: imports.headingMap(db), people }) });
    return send(res, 200, { files: out });
  }
  if (p === '/api/import/folder' && m === 'POST') {
    if (role !== 'admin' && role !== 'accounting') return send(res, 403, { error: 'admin or accounting only (reads the server filesystem)' });
    const b = await readJson(req); const r = imports.importFolder(db, { dir: b.dir, dryRun: false, force: !!b.force, csvTarget: b.target || 'auto', overrides: b.overrides || {} }, role);
    if (r.error) return send(res, 400, r);
    setIntegration('obsidian', 'connected', `Folder snapshot: ${r.imported} imported, ${r.skipped_unchanged} unchanged — ${b.dir}`, { last_import_at: dbm.nowIso() });
    dbm.audit(db, role, 'import_folder', 'integration', 'obsidian', b.dir);
    return send(res, 200, r);
  }
  if (p === '/api/documents/upload' && m === 'POST') { // attach a real file (walkthrough checklist, SOW Excel, permit doc…) to a task or handover item
    const b = await readJson(req);
    const name = path.basename(String(b.name || 'file')); const ext = path.extname(name).toLowerCase();
    if (!UPLOAD_MIME[ext]) return send(res, 400, { error: `File type ${ext || '(none)'} not accepted` });
    const buf = Buffer.from(String(b.data || ''), 'base64'); if (!buf.length || buf.length > 25 * 1024 * 1024) return send(res, 400, { error: 'empty or over 25 MB' });
    const id = b.doc_id || ('doc-' + dbm.slug(name.replace(ext, '')));
    const dir = path.join(dbm.DATA_DIR, 'uploads'); fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, id + ext); fs.writeFileSync(fp, buf);
    let text = null, status = 'stored';
    try { if (ext === '.docx') { text = imports.docxText(buf); status = 'extracted'; } else if (ext === '.html') { text = imports.htmlText(buf); status = 'extracted'; } else if (['.md', '.txt', '.csv'].includes(ext)) { text = buf.toString('utf8'); status = 'extracted'; } } catch (e) { status = 'stored (text extraction failed: ' + e.message + ')'; }
    const ex = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    const cls = imports.classifyNote(name, text || '');
    dbm.upsert(db, 'documents', { id, title: ex?.title || name.replace(ext, ''), path: name, kind: ex?.kind || (b.kind || cls.kind), kind_reason: ex ? undefined : 'uploaded by ' + role, sensitive: ex ? undefined : cls.sensitive, task_id: b.task_id || ex?.task_id || null,
      summary: ex?.summary || (text ? text.replace(/\s+/g, ' ').slice(0, 280) : `Uploaded ${name} (${buf.length} bytes)`), size: buf.length, source: `Uploaded by ${role} on ${dbm.nowIso().slice(0, 10)}${b.note ? ' — ' + b.note : ''}`, imported_at: dbm.nowIso(),
      file_path: fp, mime: UPLOAD_MIME[ext], content: text ? text.slice(0, 200 * 1024) : undefined, underlying_status: status, underlying_path: name });
    const link = (table, key) => { if (!b[key]) return; const row = db.prepare(`SELECT doc_ids FROM ${table} WHERE id = ?`).get(b[key]); if (!row) return; const ids = JSON.parse(row.doc_ids || '[]'); if (!ids.includes(id)) ids.push(id); dbm.upsert(db, table, { id: b[key], doc_ids: ids }); };
    link('handover_items', 'handover_id'); link('tasks', 'task_id');
    dbm.addEvent(db, { entity_type: 'document', entity_id: id, kind: 'import', status: 'info', label: `Manual: uploaded ${name}` + (b.handover_id ? ` for handover item ${b.handover_id}` : b.task_id ? ` for task ${b.task_id}` : ''), source: 'manual', actor: role, external_id: 'upload-' + crypto.randomUUID() });
    dbm.audit(db, role, 'upload', 'documents', id, name);
    return send(res, 200, db.prepare('SELECT id, title, kind, underlying_status, mime, size FROM documents WHERE id = ?').get(id));
  }
  if (p === '/api/import/opshub' && m === 'POST') {
    const b = await readJson(req); const r = imports.importOpsHub(db, { filename: b.filename, content: b.content }, role);
    if (r.error) return send(res, 400, r);
    setIntegration('dashboard', 'connected', `Snapshot import: ${b.filename || 'ops hub'} — ${r.tasks} SOPs, ${r.legacy_roles} legacy roles, ${r.people} people`, { last_import_at: dbm.nowIso() });
    dbm.audit(db, role, 'import_opshub', 'integration', 'dashboard', b.filename); return send(res, 200, r);
  }
  if (p === '/api/import/aliases' && m === 'POST') { // extend heading/column mappings once real files are seen
    const b = await readJson(req);
    if (b.headings) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('heading_aliases', ?)").run(JSON.stringify(b.headings));
    if (b.aliases) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('csv_aliases', ?)").run(JSON.stringify(b.aliases));
    if (b.hubs) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('hub_departments', ?)").run(JSON.stringify(b.hubs));
    dbm.audit(db, role, 'update_aliases'); return send(res, 200, { headings: imports.headingMap(db), aliases: imports.aliasMap(db) });
  }
  if (p === '/api/review/merge' && m === 'POST') { const b = await readJson(req); const t = imports.mergeTasks(db, b.source_id, b.target_id, role); dbm.audit(db, role, 'merge', 'tasks', b.target_id, b.source_id); scheduleOpsHubWrite('merge'); return send(res, 200, t); }
  if (p === '/api/review/duplicates' && m === 'POST') { const b = await readJson(req); const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(b.id); if (!task) return send(res, 404, { error: 'not found' }); return send(res, 200, imports.duplicateCandidates(db.prepare('SELECT * FROM tasks').all(), task)); }
  if (p === '/api/export/pages/mark' && m === 'POST') { dbm.addEvent(db, { entity_type: 'integration', entity_id: 'pages', kind: 'import', status: 'info', label: 'Manual: handbook export pasted into ChatGPT Pages', source: 'manual', actor: role, external_id: 'pages-' + crypto.randomUUID() }); setIntegration('pages', 'disconnected', 'Manual export workflow; last export ' + dbm.nowIso(), { last_import_at: dbm.nowIso() }); return send(res, 200, { ok: true }); }
  // generic table upsert / delete: /api/<table>[/<id>]
  const mt = p.match(/^\/api\/(departments|people|agents|tasks|homes|decisions|integrations|ai_configs|documents|handover_items|vendors)(?:\/([^/]+))?$/);
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
    if (table === 'people' && body.review_status === 'verified') { body.reviewed_at = dbm.nowIso(); body.reviewed_by = role; }
    if (table === 'tasks' && (body.proposed === 0 || body.proposed === '0' || body.archived)) { body.reviewed_at = dbm.nowIso(); body.reviewed_by = role; }
    const row = dbm.upsert(db, table, body);
    dbm.audit(db, role, before ? 'update' : 'create', table, row.id, JSON.stringify(body).slice(0, 500));
    if (['tasks', 'people'].includes(table)) scheduleOpsHubWrite(`${table} ${row.id} changed`);
    // setup milestone changes are recorded as events so history shows who/when
    const milestoneKeys = ['setup_stage', 'review_status', 'documented', 'automated', 'verified', 'board', 'active', 'pilot', 'proposed', 'archived'];
    const changed = milestoneKeys.filter(k => body[k] !== undefined && (!before || String(before[k]) !== String(body[k])));
    if (changed.length) dbm.addEvent(db, { entity_type: table.replace(/s$/, '').replace('people', 'person'), entity_id: row.id, kind: 'setup', status: 'info', source: 'manual', actor: role,
      label: `Manual: ${changed.map(k => `${k} → ${body[k]}`).join(', ')}`, external_id: 'manual-' + crypto.randomUUID() });
    return send(res, 200, row);
  }
  return send(res, 404, { error: 'not found' });
}

server.listen(PORT, () => {
  loadCredentials(); startFolderWatch(); if (OPSHUB_PATH) { console.log(`Ops hub file kept in step: ${OPSHUB_PATH}`); scheduleOpsHubWrite('startup'); }
  console.log(`McVaugh Operations World → http://localhost:${PORT}  (db: ${dbm.DB_PATH}${seeded ? ', seeded from handoff' : ''})`);
  console.log(`Role passphrases: ${CRED_PATH}`);
});
