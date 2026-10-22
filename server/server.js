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
  const import_files = can.write(role) ? db.prepare('SELECT * FROM import_files ORDER BY imported_at DESC LIMIT 500').all() : [];
  const import_dir = db.prepare("SELECT value FROM meta WHERE key = 'import_dir'").get()?.value || process.env.MOW_IMPORT_DIR || null;
  const mapping = { headings: imports.headingMap(db), aliases: imports.aliasMap(db), hubs: imports.hubMap(db) };
  return { role, permissions: { write: can.write(role), sensitive: sens, integrationConfig: can.integrationConfig(role), audit: can.audit(role) },
    departments, people, agents, tasks, archived_count, homes, documents, handover_items, vendors, build_steps, decisions, checkpoint, checkpoints, events, integrations, ai_configs, audit, demo, import_files, import_dir, mapping,
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
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const role = roleOf(req);
  try {
    if (p.startsWith('/api/')) return await api(req, res, url, p, role);
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
  // --- everything else needs a session ---
  if (!role) return send(res, 401, { error: 'login required' });

  if (p === '/api/state' && m === 'GET') return send(res, 200, stateFor(role));
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
