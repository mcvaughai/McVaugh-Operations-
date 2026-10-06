// Snapshot imports (Obsidian markdown, CSV from the old dashboard / Excel, whole folders) and the Pages handbook export.
// Every imported record keeps `source` (file name) and `imported_at`. Imports are snapshots, never live links.
// Parsing (preview) is separated from committing so the mapping can be checked against real files first.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { upsert, addEvent, slug, nowIso } = require('./db');


// ---------- document classification (by file name, then content) ----------
// Only 'procedure' becomes a task. Everything else is kept as a linked document so the vault's leases,
// handbooks and cash statements never show up as PROPOSED procedures. Overridable per file in the preview.
const KIND_RULES = [
  ['financial', /cash flow|amex|bank.?balance|loan|budgets?\b|financing|lease dates|amounts|p&l|balance sheet|payable|receivable/i],
  ['org_chart', /org(anizational)? chart|org chart|who does what|responsibilit/i],
  ['script',    /\.py\b|\.js\b|\.ps1\b|script|generator|build_|updater/i],
  ['dashboard', /dashboard|hub\b|tracker/i],
  ['legal',     /lease|llc|agreement|contract|amended|signed|investor|sale proposal/i],
  ['plan',      /rollout|roadmap|modernization|pilot|plan\b|proposal|analysis|overview/i],
  ['reference', /handbook|chart of accounts|master|categorization|readme|guide|setup\b/i],
  ['procedure', /sop\b|procedure|process|how to|checklist|monthly|weekly|first-time|instructions/i],
];
const PROCEDURE_HEADINGS = /^#{1,4}\s*(trigger|steps?|procedure|process|how to|owner|responsible|approval|deadline|inputs?)\b/im;
function classifyNote(name, content) {
  const base = path.basename(String(name || '')).replace(/\.(md|markdown|txt)$/i, '');
  const text = String(content || '');
  let kind = null, reason = '';
  // procedure wins on name if it says so explicitly; financial wins over everything for sensitivity
  if (/sop\b|procedure|how to\b|monthly procedure|first-time setup/i.test(base)) { kind = 'procedure'; reason = 'name says SOP/procedure/how-to'; }
  for (const [k, re] of KIND_RULES) if (!kind && re.test(base)) { kind = k; reason = `name matches "${re.source.split('|')[0].replace(/\\b/g, '')}…"`; }
  if (!kind && PROCEDURE_HEADINGS.test(text)) { kind = 'procedure'; reason = 'has procedure headings (Trigger/Steps/Owner…)'; }
  if (!kind) { kind = 'other'; reason = 'no rule matched'; }
  const sensitive = /cash flow|amex|bank|loan|budget|financing|amounts|payable|balance/i.test(base) || kind === 'financial' ? 1 : 0;
  const version = base.match(/^(.*?)\s*\((\d+|\d{1,2}\.\d{1,2}\.\d{2,4}|signed|highlighted)\)\s*$/i);
  return { kind, reason, sensitive, base, versionOf: version ? version[1].trim() : null };
}
function summarize(text) { return String(text || '').replace(/^---[\s\S]*?---/, '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280); }
function upsertDocument(db, { name, content, kind, reason, sensitive, task_id, department_id, source, size }) {
  const id = 'doc-' + slug(path.basename(name).replace(/\.(md|markdown|txt)$/i, ''));
  upsert(db, 'documents', { id, title: path.basename(name).replace(/\.(md|markdown|txt)$/i, ''), path: name, kind, kind_reason: reason, sensitive, task_id: task_id || null, department_id: department_id || null, summary: summarize(content), size: Buffer.byteLength(String(content || '')), source, imported_at: nowIso() });
  return id;
}

// ---------- markdown ----------
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  return { fm, body: m ? text.slice(m[0].length) : text };
}

// Heading → task field. Keys are lower-cased heading text; add aliases here (or via meta.heading_aliases) as real notes reveal them.
const DEFAULT_HEADINGS = {
  trigger: 'trigger', 'when': 'trigger', inputs: 'inputs', input: 'inputs', steps: 'steps', procedure: 'steps', process: 'steps', 'how to': 'steps',
  owner: 'owner_name', 'responsible': 'owner_name', backup: 'backup_name', deadline: 'deadline', due: 'deadline', evidence: 'evidence', 'completion evidence': 'evidence', 'done when': 'evidence',
  approval: 'approval_rules', 'approval rules': 'approval_rules', approvals: 'approval_rules', automation: 'automation_approach', verification: 'verification_result', source: 'source_link', links: 'source_link',
  'missing information': 'missing_info', missing: 'missing_info', 'open questions': 'missing_info', blocker: 'blocker', blockers: 'blocker', 'next action': 'next_action', next: 'next_action', 'next steps': 'next_action',
};

function headingMap(db) {
  const extra = db ? safeJson(db.prepare("SELECT value FROM meta WHERE key = 'heading_aliases'").get()?.value) : null;
  return { ...DEFAULT_HEADINGS, ...(extra || {}) };
}
// Match a free-text department label ("Purchasing", "HOA", "Design & Selections") to a department id.
function normalizeDept(label, departments) {
  if (!label) return null; const l = String(label).trim().toLowerCase();
  const hit = departments.find(d => d.id === l || d.name.toLowerCase() === l || (d.short || '').toLowerCase() === l)
    || departments.find(d => d.name.toLowerCase().includes(l) || l.includes((d.short || '~').toLowerCase()));
  return hit ? hit.id : label; // unknown labels are kept verbatim so the review shows them
}
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// Parse one note into a task row + mapping report. Pure: no DB writes.
function parseNote(file, { headings = DEFAULT_HEADINGS, people = [], departments = [] } = {}) {
  const { fm, body } = parseFrontmatter(String(file.content || ''));
  const title = fm.title || (body.match(/^#\s+(.+)$/m) || [])[1] || path.basename(String(file.name || 'note')).replace(/\.md$/i, '');
  const fields = {}, mapped = [], unmapped = [];
  let current = null, buf = [];
  const flush = () => { if (current) fields[current] = (fields[current] ? fields[current] + '\n' : '') + buf.join('\n').trim(); buf = []; };
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (h) { flush(); const key = h[1].trim().toLowerCase().replace(/[:#]+$/, ''); current = headings[key] || null; if (current) mapped.push(`${h[1].trim()} → ${current}`); else { unmapped.push(h[1].trim()); current = '_other'; } continue; }
    if (!/^#\s/.test(line)) buf.push(line);
  }
  flush();
  const findPerson = n => n && people.find(p => p.name.toLowerCase() === String(n).trim().toLowerCase())?.id;
  const ownerName = fm.owner || fields.owner_name, backupName = fm.backup || fields.backup_name;
  const tags = String(fm.tags || '');
  const row = {
    id: fm.id || ('obs-' + slug(title)), title, department_id: normalizeDept(fm.department || fm.area, departments),
    owner_id: findPerson(ownerName) || null, backup_id: findPerson(backupName) || null,
    trigger: fields.trigger || fm.trigger || null, inputs: fields.inputs || null, steps: fields.steps || fields._other || body.trim().slice(0, 4000) || null,
    deadline: fields.deadline || fm.deadline || null, evidence: fields.evidence || null, approval_rules: fields.approval_rules || null,
    automation_approach: fields.automation_approach || null, verification_result: fields.verification_result || null, source_link: fields.source_link || null,
    missing_info: fields.missing_info || null, blocker: fields.blocker || null, next_action: fields.next_action || null,
    documented: 1, proposed: fm.status === 'approved' ? 0 : 1, board: 'next',
    sensitive: /cash|accounting/i.test(tags + ' ' + (fm.department || '')) ? 1 : 0,
  };
  const warnings = [];
  if (ownerName && !row.owner_id) warnings.push(`Owner "${ownerName}" is not a known person`);
  if (backupName && !row.backup_id) warnings.push(`Backup "${backupName}" is not a known person`);
  const clsEarly = classifyNote(file.name, file.content);
  if (clsEarly.kind === 'procedure' && !mapped.length && !Object.keys(fm).length) warnings.push('No recognized headings or frontmatter; whole note stored as Steps');
  const cls = classifyNote(file.name, file.content);
  if (cls.kind !== 'procedure') warnings.unshift(`Classified as ${cls.kind} (${cls.reason}) — will be stored as a document, not a task`);
  if (cls.sensitive) warnings.push('Flagged restricted (financial)');
  return { row, classification: cls, mapping: { frontmatter: Object.keys(fm), mapped, unmapped }, warnings };
}

function importMarkdown(db, files, role, opts = {}) {
  const ts = nowIso(); let imported = 0; const results = []; const overrides = opts.overrides || {};
  const people = db.prepare('SELECT id, name FROM people').all(), departments = db.prepare('SELECT id, name, short FROM departments').all();
  const headings = headingMap(db);
  for (const f of files) {
    const cls = classifyNote(f.name, f.content); const kind = overrides[f.name] || cls.kind;
    const source = `Obsidian import: ${f.name} (${ts.slice(0, 10)})`;
    if (kind !== 'procedure') { // stored as a document only — never a task
      const docId = upsertDocument(db, { name: f.name, content: f.content, kind, reason: overrides[f.name] ? 'set by reviewer' : cls.reason, sensitive: cls.sensitive, source });
      addEvent(db, { entity_type: 'document', entity_id: docId, kind: 'import', status: 'info', label: `Imported document (${kind}): ${f.name}`, source: 'import', actor: role, external_id: 'doc-' + crypto.randomUUID() });
      imported++; results.push({ id: docId, title: cls.base, kind, warnings: [] }); continue;
    }
    const { row, warnings } = parseNote(f, { headings, people, departments });
    row.source = source; if (cls.sensitive) row.sensitive = 1;
    const existing = db.prepare('SELECT proposed, board, verified, documented, automated, owner_id, backup_id FROM tasks WHERE id = ?').get(row.id);
    if (existing) { // re-import never undoes a review decision; only content fields refresh
      delete row.proposed; delete row.board; if (existing.owner_id) delete row.owner_id; if (existing.backup_id) delete row.backup_id;
    }
    upsert(db, 'tasks', row);
    upsertDocument(db, { name: f.name, content: f.content, kind: 'procedure', reason: overrides[f.name] ? 'set by reviewer' : cls.reason, sensitive: cls.sensitive, task_id: row.id, department_id: row.department_id, source });
    addEvent(db, { entity_type: 'task', entity_id: row.id, kind: 'import', status: 'info', label: `${existing ? 'Re-imported' : 'Imported'} from Obsidian: ${f.name}`, source: 'import', actor: role, external_id: 'obs-' + crypto.randomUUID() });
    imported++; results.push({ id: row.id, title: row.title, kind: 'procedure', warnings });
  }
  return { imported, results, imported_at: ts };
}

// ---------- csv ----------
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
  return { header, rows: rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()]))) };
}

// Column aliases per logical field. Extend via meta.csv_aliases ({ field: [names] }) once real exports are seen.
const DEFAULT_ALIASES = {
  person: ['person', 'name', 'owner', 'employee', 'who', 'team member', 'assigned to'],
  role: ['role', 'title', 'position', 'responsibilities', 'job title'],
  responsibility: ['responsibility', 'task', 'duty', 'function', 'item', 'selection', 'procedure name'],
  department: ['department', 'area', 'function area', 'dept', 'category'],
  steps: ['procedure', 'steps', 'notes', 'description', 'details', 'how'],
  address: ['address', 'home', 'job', 'lot', 'property', 'job name', 'project'],
  job_id: ['job id', 'job_id', 'id', 'jobid', 'mch job id'],
  stage: ['stage', 'phase', 'status', 'construction stage'],
  active: ['active', 'is active'],
  deadline: ['deadline', 'due', 'due date', 'order deadline', 'order by'],
  backup: ['backup', 'back-up', 'alternate'],
  title: ['title', 'task', 'item', 'selection', 'name', 'product'],
};
function aliasMap(db) {
  const extra = db ? safeJson(db.prepare("SELECT value FROM meta WHERE key = 'csv_aliases'").get()?.value) : null;
  const out = { ...DEFAULT_ALIASES };
  for (const [k, v] of Object.entries(extra || {})) out[k] = [...(out[k] || []), ...v];
  return out;
}
function col(header, aliases, field) { return aliases[field].find(a => header.includes(a)) || null; }

function guessTarget(header, aliases) {
  if (col(header, aliases, 'person') && (col(header, aliases, 'responsibility') || col(header, aliases, 'role'))) return 'dashboard';
  if (col(header, aliases, 'address')) return 'schedule';
  if (col(header, aliases, 'title')) return 'tasks';
  return null;
}

// Pure parse of a CSV into candidate rows + mapping report.
function parseCsvFile({ target, filename, content }, { aliases = DEFAULT_ALIASES, people = [], departments = [] } = {}) {
  const { header, rows } = parseCsv(content);
  const tgt = target && target !== 'auto' ? target : guessTarget(header, aliases);
  const needed = { dashboard: ['person', 'responsibility', 'role', 'department', 'steps'], schedule: ['address', 'job_id', 'stage', 'active', 'steps'], selections: ['title', 'person', 'department', 'deadline', 'steps'], tasks: ['title', 'person', 'department', 'deadline', 'steps', 'backup'] }[tgt] || [];
  const colmap = {}; for (const f of needed) colmap[f] = col(header, aliases, f);
  const used = new Set(Object.values(colmap).filter(Boolean));
  const mapping = { target: tgt, columns: colmap, unmapped: header.filter(h => h && !used.has(h)) };
  const findPerson = n => n && people.find(p => p.name.toLowerCase() === String(n).trim().toLowerCase())?.id;
  const get = (r, f) => colmap[f] ? (r[colmap[f]] || null) : null;
  const records = []; const warnings = [];
  if (!tgt) warnings.push(`Could not tell what this file is from its headers (${header.join(', ')}). Pick a target.`);
  for (const r of rows) {
    if (tgt === 'dashboard') {
      const name = get(r, 'person'); if (!name) continue;
      const pid = findPerson(name) || slug(name);
      const rec = { kind: 'person', id: pid, name, known: !!findPerson(name), role_summary: get(r, 'role'), department: normalizeDept(get(r, 'department'), departments) };
      const resp = get(r, 'responsibility');
      if (resp) rec.task = { id: 'dash-' + slug(name + '-' + resp), title: resp, owner_id: pid, department_id: rec.department, steps: get(r, 'steps') };
      records.push(rec);
    } else if (tgt === 'schedule') {
      const address = get(r, 'address'); if (!address) continue;
      records.push({ kind: 'home', address, job_id: get(r, 'job_id'), stage: get(r, 'stage'), active: get(r, 'active'), notes: get(r, 'steps') });
    } else if (tgt) {
      const title = get(r, 'title'); if (!title) continue;
      const owner = get(r, 'person');
      if (owner && !findPerson(owner)) warnings.push(`Owner "${owner}" is not a known person (row "${title}")`);
      records.push({ kind: 'task', id: 'csv-' + slug(title), title, owner_id: findPerson(owner), owner_name: owner, backup_id: findPerson(get(r, 'backup')), department_id: normalizeDept(get(r, 'department'), departments) || (tgt === 'selections' ? 'design' : null), deadline: get(r, 'deadline'), steps: get(r, 'steps') });
    }
  }
  return { mapping, records, rows: rows.length, warnings: [...new Set(warnings)].slice(0, 20) };
}

function importCsv(db, { target, filename, content }, role) {
  const ts = nowIso();
  const people = db.prepare('SELECT id, name FROM people').all(), departments = db.prepare('SELECT id, name, short FROM departments').all();
  const parsed = parseCsvFile({ target, filename, content }, { aliases: aliasMap(db), people, departments });
  const tgt = parsed.mapping.target; let imported = 0;
  const src = `${tgt} import: ${filename || 'csv'} (${ts.slice(0, 10)})`;
  for (const rec of parsed.records) {
    if (rec.kind === 'person') {
      const deptIds = db.prepare('SELECT id FROM departments').all().map(d => d.id);
      if (!rec.known) upsert(db, 'people', { id: rec.id, name: rec.name, role_summary: rec.role_summary || '', confirmed: 0, review_status: 'not_reviewed', departments: deptIds.includes(rec.department) ? [rec.department] : [], source: src, notes: 'Imported from old dashboard; not yet confirmed.' });
      else if (deptIds.includes(rec.department)) { const cur = JSON.parse(db.prepare('SELECT departments FROM people WHERE id = ?').get(rec.id).departments || '[]'); if (!cur.includes(rec.department)) upsert(db, 'people', { id: rec.id, departments: [...cur, rec.department] }); }
      if (rec.task) { const ex = db.prepare('SELECT proposed FROM tasks WHERE id = ?').get(rec.task.id); upsert(db, 'tasks', { ...rec.task, ...(ex ? {} : { proposed: 1, board: 'next' }), source: src }); }
      imported++;
    } else if (rec.kind === 'home') {
      const existing = db.prepare('SELECT id FROM homes WHERE lower(address) = lower(?)').get(rec.address);
      upsert(db, 'homes', { id: existing?.id || 'home-' + slug(rec.address), address: rec.address, job_id: rec.job_id || undefined, stage: rec.stage, kind: existing ? undefined : 'home', active: rec.active ? (/^(y|yes|true|1|active)$/i.test(rec.active) ? 'active' : 'inactive') : (existing ? undefined : 'unknown'), source: src, imported_at: ts, notes: rec.notes });
      imported++;
    } else if (rec.kind === 'task') {
      const ex = db.prepare('SELECT proposed FROM tasks WHERE id = ?').get(rec.id);
      const { kind, owner_name, ...row } = rec;
      upsert(db, 'tasks', { ...row, ...(ex ? {} : { proposed: 1, board: 'next' }), missing_info: owner_name && !row.owner_id ? `Owner in file: "${owner_name}" (not a known person)` : undefined, source: src });
      imported++;
    }
  }
  addEvent(db, { entity_type: 'integration', entity_id: tgt === 'dashboard' ? 'dashboard' : 'excel', kind: 'import', status: 'info', label: `Snapshot import: ${filename || 'csv'} (${imported} rows)`, source: 'import', actor: role, external_id: 'csv-' + crypto.randomUUID() });
  return { imported, imported_at: ts, rows: parsed.rows, target: tgt, mapping: parsed.mapping, warnings: parsed.warnings };
}

// ---------- folder bulk import (runs on the server's own filesystem, e.g. the Obsidian vault on L:) ----------
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules', '.smart-env']);
function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, out, depth + 1); }
    else if (/\.(md|markdown|csv)$/i.test(e.name)) out.push(full);
  }
  return out;
}
const hashOf = buf => crypto.createHash('sha256').update(buf).digest('hex');

// dryRun=true → mapping report only, nothing written. Otherwise imports changed/new files and records them in import_files.
function importFolder(db, { dir, dryRun = false, force = false, csvTarget = 'auto', overrides = {} }, role) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: `Folder not found on the server: ${dir}` };
  const files = walk(dir);
  const people = db.prepare('SELECT id, name FROM people').all(), departments = db.prepare('SELECT id, name, short FROM departments').all();
  const headings = headingMap(db), aliases = aliasMap(db);
  const seen = db.prepare('SELECT path, hash FROM import_files WHERE path = ?');
  const report = { dir, scanned: files.length, imported: 0, skipped_unchanged: 0, errors: [], files: [], dry_run: dryRun };
  for (const full of files) {
    const rel = path.relative(dir, full);
    let buf; try { buf = fs.readFileSync(full); } catch (e) { report.errors.push(`${rel}: ${e.message}`); continue; }
    const hash = hashOf(buf), prev = seen.get(full);
    const entry = { path: rel, changed: !prev || prev.hash !== hash, kind: /\.csv$/i.test(full) ? 'csv' : 'md' };
    if (!entry.changed && !force) { report.skipped_unchanged++; entry.status = 'unchanged'; report.files.push(entry); continue; }
    const text = buf.toString('utf8');
    try {
      if (entry.kind === 'md') {
        const p = parseNote({ name: rel, content: text }, { headings, people, departments });
        const kind = overrides[rel] || p.classification.kind;
        entry.preview = { title: p.row.title, id: kind === 'procedure' ? p.row.id : 'doc-' + slug(p.classification.base), kind, kind_reason: overrides[rel] ? 'set by reviewer' : p.classification.reason, sensitive: p.classification.sensitive, versionOf: p.classification.versionOf, mapping: p.mapping, warnings: p.warnings.filter(w => !w.startsWith('Classified')) };
        if (!dryRun) { importMarkdown(db, [{ name: rel, content: text }], role, { overrides: { [rel]: kind } }); entry.status = prev ? 're-imported' : 'imported'; }
      } else {
        const p = parseCsvFile({ target: csvTarget, filename: rel, content: text }, { aliases, people, departments });
        entry.preview = { target: p.mapping.target, mapping: p.mapping, rows: p.rows, warnings: p.warnings, sample: p.records.slice(0, 3) };
        if (!dryRun) { if (!p.mapping.target) { entry.status = 'skipped: unknown layout'; report.files.push(entry); continue; } importCsv(db, { target: p.mapping.target, filename: rel, content: text }, role); entry.status = prev ? 're-imported' : 'imported'; }
      }
      if (!dryRun) {
        db.prepare('INSERT OR REPLACE INTO import_files (path, hash, size, imported_at, kind, status) VALUES (?,?,?,?,?,?)').run(full, hash, buf.length, nowIso(), entry.kind, entry.status);
        report.imported++;
      } else entry.status = prev ? 'would re-import (changed)' : 'would import (new)';
    } catch (e) { entry.status = 'error'; report.errors.push(`${rel}: ${e.message}`); }
    report.files.push(entry);
  }
  // flag likely version pairs: "X" and "X (2)" / "X (10.24.25)"
  const bases = new Map(); for (const f of report.files) if (f.preview?.title) bases.set(path.basename(f.path).replace(/\.(md|markdown|txt)$/i, '').toLowerCase(), f);
  for (const f of report.files) { const v = f.preview?.versionOf; if (v && bases.has(v.toLowerCase())) { const other = bases.get(v.toLowerCase()); f.preview.warnings.push(`Looks like a version of "${other.path}" — decide which is current`); other.preview?.warnings.push(`Has another version: "${f.path}"`); } }
  report.kinds = {}; for (const f of report.files) if (f.preview?.kind) report.kinds[f.preview.kind] = (report.kinds[f.preview.kind] || 0) + 1;
  if (!dryRun) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('import_dir', ?)").run(dir);
    addEvent(db, { entity_type: 'integration', entity_id: 'obsidian', kind: 'import', status: 'info', label: `Folder import: ${report.imported} files imported, ${report.skipped_unchanged} unchanged (${dir})`, source: 'import', actor: role, external_id: 'folder-' + crypto.randomUUID() });
  }
  return report;
}

// ---------- review helpers ----------
const tokens = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'for', 'procedure', 'process'].includes(w)));
function similarity(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.min(A.size, B.size); }
function duplicateCandidates(tasks, task) {
  return tasks.filter(t => t.id !== task.id && !t.archived).map(t => ({ id: t.id, title: t.title, proposed: t.proposed, owner_id: t.owner_id, score: similarity(t.title, task.title) + (t.owner_id && t.owner_id === task.owner_id ? .15 : 0) }))
    .filter(c => c.score >= .5).sort((a, b) => b.score - a.score).slice(0, 4);
}
// Merge `source` into `target`: fill target's empty fields from source, archive source, keep a note of provenance.
function mergeTasks(db, sourceId, targetId, role) {
  const s = db.prepare('SELECT * FROM tasks WHERE id = ?').get(sourceId), t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(targetId);
  if (!s || !t) throw Object.assign(new Error('task not found'), { status: 404 });
  const fillable = ['owner_id', 'backup_id', 'department_id', 'trigger', 'inputs', 'steps', 'deadline', 'evidence', 'approval_rules', 'automation_approach', 'verification_result', 'source_link', 'missing_info', 'blocker', 'next_action'];
  const patch = { id: targetId };
  for (const k of fillable) if (!t[k] && s[k]) patch[k] = s[k];
  patch.source = [t.source, s.source].filter(Boolean).join(' + ');
  upsert(db, 'tasks', patch);
  upsert(db, 'tasks', { id: sourceId, archived: 1, merged_into: targetId, review_note: `Merged into ${t.title}` });
  addEvent(db, { entity_type: 'task', entity_id: targetId, kind: 'setup', status: 'info', label: `Manual: merged "${s.title}" into this task`, source: 'manual', actor: role, external_id: 'merge-' + crypto.randomUUID() });
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(targetId);
}

// ---------- Pages handbook export ----------
function pagesMarkdown(state) {
  const L = [];
  L.push(`# McVaugh Operations World — handbook export (${state.server.now.slice(0, 10)})`, '');
  L.push('Exported from the McVaugh Operations World app. Items marked PROPOSED are not yet verified with the team.', '');
  const cp = state.checkpoint;
  if (cp) L.push('## Start Here', `- Stage: ${cp.stage}`, `- Current step: ${cp.current_step || ''}`, `- Last completed: ${cp.last_completed || ''}`, `- Next action: ${cp.next_action || ''}`, `- Waiting on: ${cp.waiting_on || ''}`, `- Decisions needed: ${cp.decisions_needed || ''}`, `- Checkpoint saved: ${cp.created_at}`, '');
  L.push('## People');
  for (const p of state.people) L.push(`- **${p.name}** — ${p.role_summary || ''} (${p.confirmed ? 'confirmed' : 'unconfirmed'}; review: ${p.review_status})`);
  L.push('', '## Procedures and tasks');
  for (const t of state.tasks) { if (t.restricted) continue; L.push(`### ${t.title}${t.proposed ? ' (PROPOSED)' : ''}`, `- Owner: ${t.owner_id || 'to confirm'}${t.backup_id ? `; backup: ${t.backup_id}` : ''}`, `- Milestones: documented ${t.documented ? '✓' : '✗'}, automated ${t.automated ? '✓' : '✗'}, verified ${t.verified ? '✓' : '✗'}`, t.steps ? `- Steps: ${t.steps}` : '', t.missing_info ? `- Missing: ${t.missing_info}` : '', t.next_action ? `- Next: ${t.next_action}` : '', ''); }
  L.push('## Agents (proposed functions)');
  for (const a of state.agents) L.push(`- **${a.name}** — ${a.initial_output || ''}. Approach: ${a.approach} (${a.approach_note || ''}). Setup: ${a.setup_stage}. Human authority: ${a.human_authority || ''}`);
  L.push('', '## Decisions');
  for (const d of state.decisions) L.push(`- ${d.date} — **${d.title}** [${d.status}] — ${d.reason || ''} (${d.decided_by || ''}; source: ${d.source || ''})`);
  L.push('', '## Integrations');
  for (const i of state.integrations) L.push(`- ${i.name}: ${i.status}${i.last_message ? ' — ' + i.last_message : ''}`);
  return L.filter(x => x !== undefined).join('\n');
}

module.exports = { classifyNote, normalizeDept, importMarkdown, importCsv, importFolder, parseNote, parseCsvFile, parseCsv, duplicateCandidates, mergeTasks, pagesMarkdown, DEFAULT_HEADINGS, DEFAULT_ALIASES, headingMap, aliasMap };
