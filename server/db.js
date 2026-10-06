// Canonical persistent store: a single SQLite file (data/mcvaugh-world.sqlite).
// Uses Node's built-in node:sqlite so the app has zero npm dependencies.
// Recovery: copy the .sqlite file, or use GET /api/export (JSON) and POST /api/import/backup.
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.MOW_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'mcvaugh-world.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, short TEXT, description TEXT,
  setup_stage TEXT NOT NULL DEFAULT 'not_reviewed',
  gx INTEGER, gy INTEGER, hue INTEGER, sort INTEGER
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role_summary TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,          -- 1 = confirmed by the handoff / Brittany
  departments TEXT NOT NULL DEFAULT '[]',        -- JSON array of department ids
  review_status TEXT NOT NULL DEFAULT 'not_reviewed', -- not_reviewed | under_review | verified
  notes TEXT, source TEXT, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, department_id TEXT, purpose TEXT,
  setup_stage TEXT NOT NULL DEFAULT 'not_reviewed',
  approach TEXT NOT NULL DEFAULT 'undecided',    -- rules | ai | hybrid | undecided
  approach_note TEXT,
  enabled INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
  human_authority TEXT, initial_output TEXT,
  n8n_workflow_id TEXT, next_run TEXT,
  proposed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, department_id TEXT,
  owner_id TEXT, backup_id TEXT, agent_id TEXT,
  trigger TEXT, inputs TEXT, steps TEXT, deadline TEXT, evidence TEXT,
  approval_rules TEXT, automation_approach TEXT, verification_result TEXT, source_link TEXT,
  documented INTEGER NOT NULL DEFAULT 0, automated INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0,
  board TEXT NOT NULL DEFAULT 'next',            -- next | working | waiting | done
  proposed INTEGER NOT NULL DEFAULT 1,           -- 1 = proposed procedure, not yet verified with the team
  project_stage TEXT,                            -- gather|map|simplify|choose|pilot|expand (for implementation tasks)
  missing_info TEXT, blocker TEXT, waiting_on TEXT, next_action TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,          -- cash/accounting detail: restricted roles only
  source TEXT, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS homes (
  id TEXT PRIMARY KEY, address TEXT NOT NULL, job_id TEXT,
  active TEXT NOT NULL DEFAULT 'unknown',        -- unknown | active | inactive
  kind TEXT NOT NULL DEFAULT 'unknown',          -- home | lot | hoa | office | other | unknown
  stage TEXT, pilot INTEGER NOT NULL DEFAULT 0, notes TEXT,
  source TEXT, imported_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, reason TEXT,
  decided_by TEXT, status TEXT NOT NULL DEFAULT 'approved', -- approved | proposed | superseded
  source TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
  stage TEXT NOT NULL, current_step TEXT, last_completed TEXT, next_action TEXT,
  waiting_on TEXT, decisions_needed TEXT, note TEXT, author TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- run | setup | note | import | approval
  status TEXT,                   -- started | finished | failed | waiting_approval | info
  label TEXT, source TEXT NOT NULL, -- manual | n8n | demo | import | system
  external_id TEXT, payload TEXT, actor TEXT,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, -- live | snapshot | callback | manual
  status TEXT NOT NULL DEFAULT 'disconnected',  -- disconnected | connected | failing
  last_checked TEXT, last_message TEXT, last_import_at TEXT, config TEXT, notes TEXT
);

CREATE TABLE IF NOT EXISTS ai_configs (
  id TEXT PRIMARY KEY, agent_id TEXT, purpose TEXT, needs_ai TEXT NOT NULL DEFAULT 'undecided', -- yes | no_rules | undecided
  provider TEXT, model TEXT, why TEXT, expected_cost TEXT, approval TEXT, eval_examples TEXT, fallback TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, role TEXT, action TEXT,
  entity_type TEXT, entity_id TEXT, detail TEXT
);

CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT, kind TEXT NOT NULL,   -- procedure | org_chart | reference | dashboard | plan | legal | script | financial | other
  kind_reason TEXT, sensitive INTEGER NOT NULL DEFAULT 0, task_id TEXT, department_id TEXT,
  summary TEXT, size INTEGER, source TEXT, imported_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS import_files (
  path TEXT PRIMARY KEY, hash TEXT NOT NULL, size INTEGER, imported_at TEXT NOT NULL, kind TEXT, status TEXT
);
`;

function nowIso() { return new Date().toISOString(); }

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Additive schema changes for databases created by earlier versions.
const MIGRATIONS = [
  ['tasks', 'archived', 'INTEGER NOT NULL DEFAULT 0'],      // rejected/merged imports leave the board but keep history
  ['tasks', 'merged_into', 'TEXT'],
  ['tasks', 'review_note', 'TEXT'],
  ['tasks', 'reviewed_at', 'TEXT'],
  ['tasks', 'reviewed_by', 'TEXT'],
  ['people', 'reviewed_at', 'TEXT'],
  ['people', 'reviewed_by', 'TEXT'],
  ['documents', 'underlying_path', 'TEXT'],   // the real file an index-card note points to
  ['documents', 'underlying_status', 'TEXT'], // extracted | not_found | needs_conversion | not_followed
  ['documents', 'content', 'TEXT'],           // extracted text (capped)
  ['documents', 'hubs', 'TEXT'],
  ['documents', 'entities', 'TEXT'],
];
function migrate(db) {
  for (const [table, column, type] of MIGRATIONS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// ---------- generic helpers ----------
const TABLES = {
  departments: ['id','name','short','description','setup_stage','gx','gy','hue','sort'],
  people: ['id','name','role_summary','confirmed','departments','review_status','notes','source','reviewed_at','reviewed_by','created_at','updated_at'],
  agents: ['id','name','department_id','purpose','setup_stage','approach','approach_note','enabled','paused','human_authority','initial_output','n8n_workflow_id','next_run','proposed','created_at','updated_at'],
  tasks: ['id','title','department_id','owner_id','backup_id','agent_id','trigger','inputs','steps','deadline','evidence','approval_rules','automation_approach','verification_result','source_link','documented','automated','verified','board','proposed','project_stage','missing_info','blocker','waiting_on','next_action','sensitive','source','archived','merged_into','review_note','reviewed_at','reviewed_by','created_at','updated_at'],
  homes: ['id','address','job_id','active','kind','stage','pilot','notes','source','imported_at','updated_at'],
  decisions: ['id','date','title','reason','decided_by','status','source','created_at'],
  integrations: ['id','name','kind','status','last_checked','last_message','last_import_at','config','notes'],
  documents: ['id','title','path','kind','kind_reason','sensitive','task_id','department_id','summary','size','source','imported_at','updated_at','underlying_path','underlying_status','content','hubs','entities'],
  ai_configs: ['id','agent_id','purpose','needs_ai','provider','model','why','expected_cost','approval','eval_examples','fallback','updated_at'],
};

function upsert(db, table, row) {
  const cols = TABLES[table];
  if (!cols) throw new Error('unknown table ' + table);
  const data = {};
  for (const c of cols) if (row[c] !== undefined) data[c] = row[c] === null ? null : (typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]);
  if (!data.id) data.id = slug(row.name || row.title || row.address || crypto.randomUUID());
  if (cols.includes('updated_at')) data.updated_at = nowIso();
  if (cols.includes('created_at') && !data.created_at) {
    const existing = db.prepare(`SELECT created_at FROM ${table} WHERE id = ?`).get(data.id);
    data.created_at = existing?.created_at || nowIso();
  }
  const keys = Object.keys(data);
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(data.id);
  if (exists) { // partial update: only the supplied columns change
    const set = keys.filter(k => k !== 'id');
    if (set.length) db.prepare(`UPDATE ${table} SET ${set.map(k => `${k} = ?`).join(',')} WHERE id = ?`).run(...set.map(k => data[k]), data.id);
  } else {
    db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => data[k]));
  }
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(data.id);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || crypto.randomUUID();
}

function addEvent(db, ev) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO events (ts, entity_type, entity_id, kind, status, label, source, external_id, payload, actor)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const r = stmt.run(ev.ts || nowIso(), ev.entity_type, ev.entity_id, ev.kind || 'note', ev.status || 'info',
    ev.label || null, ev.source || 'manual', ev.external_id || null,
    ev.payload ? (typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)) : null, ev.actor || null);
  return { inserted: r.changes > 0, id: r.lastInsertRowid };
}

function audit(db, role, action, entity_type, entity_id, detail) {
  db.prepare('INSERT INTO audit (ts, role, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?,?)')
    .run(nowIso(), role || null, action, entity_type || null, entity_id || null, detail ? String(detail).slice(0, 2000) : null);
}

function exportAll(db) {
  const out = { exported_at: nowIso(), format: 'mcvaugh-operations-world/1' };
  for (const t of [...Object.keys(TABLES), 'checkpoints', 'events', 'audit', 'meta', 'import_files']) {
    out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  return out;
}

function importBackup(db, dump) {
  if (!dump || dump.format !== 'mcvaugh-operations-world/1') throw new Error('Not a McVaugh Operations World backup');
  db.exec('BEGIN');
  try {
    for (const t of [...Object.keys(TABLES), 'checkpoints', 'events', 'audit', 'meta', 'import_files']) {
      if (!Array.isArray(dump[t])) continue;
      db.exec(`DELETE FROM ${t}`);
      for (const row of dump[t]) {
        const keys = Object.keys(row);
        db.prepare(`INSERT OR REPLACE INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, upsert, slug, addEvent, audit, exportAll, importBackup, nowIso, TABLES, DB_PATH, DATA_DIR };
