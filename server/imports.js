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


// ---------- index cards (vault notes that point at a real file on the local server) ----------
// Format seen in Brittany's vault (2026-10-06): frontmatter type: document / source: localserver,
// "> [!info] Document · [`file.docx`](../_Inbox/...)", then ## Why it matters / ## Open / ## Part of / ## Topic hubs / ## Entities.
function parseIndexCard(text) {
  const { fm, body } = parseFrontmatter(text);
  if (fm.type !== 'document' && !/\[!info\]\s*Document/i.test(body)) return null;
  const link = body.match(/\[!info\][^\n]*?\[`([^`]+)`\]\(([^)]+)\)/) || body.match(/##\s*Open\s*\n-\s*\[[^\]]*\]\(([^)]+)\)/);
  const file = link ? decodeURIComponent(link[2] || link[1]) : null;
  const sec = name => { const m = body.match(new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')); return m ? m[1].trim() : ''; };
  const links = t => [...t.matchAll(/\[\[([^\]|]+)/g)].map(m => m[1].trim());
  return { title: fm.title || (body.match(/^#\s+(.+)$/m) || [])[1], why: sec('Why it matters'), file, hubs: links(sec('Topic hubs')), partOf: links(sec('Part of')), entities: links(sec('Entities')), primary_hub: fm.primary_hub || null };
}
// Topic hub → department guess. Editable via meta.hub_departments.
// 'construction financials & budget vs actual' appears on nearly every card, so it is treated as generic (no department).
const DEFAULT_HUBS = { 'construction financials & budget vs actual': null, 'database & reconciliation': 'accounting', 'royal oaks water billing & hoa': 'hoa', 'finance': 'accounting', 'accounting': 'accounting', 'sales': 'marketing', 'design': 'design', 'permits': 'permits', 'construction': 'construction', 'purchasing': 'purchasing' };
function hubMap(db) { const extra = db ? safeJson(db.prepare("SELECT value FROM meta WHERE key = 'hub_departments'").get()?.value) : null; return { ...DEFAULT_HUBS, ...(extra || {}) }; }
// primary hub wins; otherwise only an unambiguous secondary hub assigns a department.
function deptFromHubs(primary, hubs, map) {
  const m = h => (h && map[String(h).toLowerCase()]) || null;
  if (m(primary)) return m(primary);
  const found = [...new Set((hubs || []).map(m).filter(Boolean))];
  return found.length === 1 ? found[0] : null;
}

// Minimal zip reader (enough for .docx): central directory → entry → inflateRaw. No dependencies.
function zipEntry(buf, wanted) {
  const zlib = require('node:zlib');
  let eocd = buf.length - 22; while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20), nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32), lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    if (name === wanted) {
      const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28); const start = lho + 30 + lnlen + lelen; const data = buf.subarray(start, start + csize);
      return method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : (() => { throw new Error('unsupported zip method ' + method); })();
    }
    off += 46 + nlen + elen + clen;
  }
  return null;
}
const NAMED = { ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', copy: '©', reg: '®', trade: '™' };
const decodeEntities = t => t.replace(/&([a-z]+);/g, (m, n) => NAMED[n] || m).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&nbsp;/g, ' ');
function docxText(buf) {
  const xml = zipEntry(buf, 'word/document.xml'); if (!xml) throw new Error('no word/document.xml');
  return decodeEntities(xml.toString('utf8').replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br[^>]*\/>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}
function htmlText(buf) {
  return decodeEntities(buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<\/(p|div|li|tr|h\d|section|article|br)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
// Minimal .xlsx reader (shared strings + inline values); enough to turn a sheet into rows of text. No formulas evaluated.
function xlsxSheets(buf) {
  const wbXml = zipEntry(buf, 'xl/workbook.xml')?.toString('utf8') || '';
  const relsXml = zipEntry(buf, 'xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const ssXml = zipEntry(buf, 'xl/sharedStrings.xml')?.toString('utf8') || '';
  const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decodeEntities(m[1].replace(/<[^>]+>/g, '')));
  const rels = Object.fromEntries([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2].replace(/^\/?xl\//, '').replace(/^\//, '')]));
  const sheets = [...wbXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(m => ({ name: decodeEntities(m[1]), target: rels[m[2]] || '' }));
  return sheets.map(sh => {
    const xml = zipEntry(buf, sh.target.startsWith('worksheets') ? 'xl/' + sh.target : sh.target)?.toString('utf8') || '';
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = cm[1], attrs = cm[2] || '', inner = cm[3] || '';
        const t = (attrs.match(/t="([^"]+)"/) || [])[1]; let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (t === 's') v = shared[+v]; else if (t === 'inlineStr') v = decodeEntities(inner.replace(/<[^>]+>/g, '')); else if (v !== undefined) v = decodeEntities(v);
        if (v !== undefined && v !== '') cells[col] = v;
      }
      if (Object.keys(cells).length) rows.push(cells);
    }
    return { name: sh.name, rows };
  });
}
function xlsxText(buf) { return xlsxSheets(buf).map(s => `## ${s.name}\n` + s.rows.map(r => Object.keys(r).sort((a, b) => a.length - b.length || a.localeCompare(b)).map(k => r[k]).join(' | ')).join('\n')).join('\n\n'); }
const MAX_CONTENT = 200 * 1024;
// Resolve an index card's link relative to the note and extract text when the format allows.
function followLink(noteFullPath, rel) {
  if (!rel) return { status: 'not_followed', text: null, resolved: null };
  const resolved = path.resolve(path.dirname(noteFullPath), rel);
  if (!fs.existsSync(resolved)) return { status: 'not_found', text: null, resolved };
  const ext = path.extname(resolved).toLowerCase();
  try {
    if (ext === '.docx') return { status: 'extracted', text: docxText(fs.readFileSync(resolved)).slice(0, MAX_CONTENT), resolved };
    if (ext === '.xlsx') return { status: 'extracted', text: xlsxText(fs.readFileSync(resolved)).slice(0, MAX_CONTENT), resolved };
    if (ext === '.html' || ext === '.htm') return { status: 'extracted', text: htmlText(fs.readFileSync(resolved)).slice(0, MAX_CONTENT), resolved };
    if (ext === '.md' || ext === '.txt' || ext === '.csv') return { status: 'extracted', text: fs.readFileSync(resolved, 'utf8').slice(0, MAX_CONTENT), resolved };
    return { status: 'needs_conversion', text: null, resolved }; // .doc, .pdf, .xlsx …: save as .docx/.html/.csv or paste
  } catch (e) { return { status: 'error: ' + e.message, text: null, resolved }; }
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
  const card = parseIndexCard(file.content);
  const cls = classifyNote(card?.file ? `${file.name} ${path.basename(card.file)}` : file.name, file.content);
  if (card) warnings.unshift(`Index card → real file: ${card.file || '(no link)'}${file.linked ? ' — ' + file.linked.status.replace('_', ' ') : ''}${card.hubs.length ? ' · hubs: ' + card.hubs.join(', ') : ''}`);
  if (cls.kind !== 'procedure') warnings.unshift(`Classified as ${cls.kind} (${cls.reason}) — will be stored as a document, not a task`);
  if (cls.sensitive) warnings.push('Flagged restricted (financial)');
  if (card) { row.title = card.title || row.title; row.source_link = card.file || null; row.steps = file.linked?.text ? file.linked.text.slice(0, 4000) : null; row.documented = file.linked?.text ? 1 : 0; }
  return { row, card: card ? { file: card.file, hubs: card.hubs, entities: card.entities, linked: file.linked?.status } : null, classification: cls, mapping: { frontmatter: Object.keys(fm), mapped, unmapped }, warnings };
}

function importMarkdown(db, files, role, opts = {}) {
  const ts = nowIso(); let imported = 0; const results = []; const overrides = opts.overrides || {};
  const people = db.prepare('SELECT id, name FROM people').all(), departments = db.prepare('SELECT id, name, short FROM departments').all();
  const headings = headingMap(db);
  const hubs = hubMap(db);
  for (const f of files) {
    const card = parseIndexCard(f.content);
    const cls = classifyNote(card?.file ? `${f.name} ${path.basename(card.file)}` : f.name, f.content); const kind = overrides[f.name] || cls.kind;
    const source = `Obsidian import: ${f.name} (${ts.slice(0, 10)})`;
    if (card) { // index card → document that points at the real file; task only if procedure AND content was extracted
      const link = f.linked || { status: 'not_followed', text: null };
      const department_id = deptFromHubs(card.primary_hub, card.hubs, hubs);
      const docId = 'doc-' + slug(card.title || cls.base);
      let task_id = null;
      if (kind === 'procedure') {
        task_id = 'obs-' + slug(card.title || cls.base);
        const existing = db.prepare('SELECT id, owner_id, steps, department_id, title FROM tasks WHERE id = ?').get(task_id);
        const row = { id: task_id, source_link: card.file || null, sensitive: cls.sensitive || undefined };
        if (!existing) Object.assign(row, { title: card.title || cls.base, department_id, source, proposed: 1, board: 'next' });
        else { if (!existing.department_id && department_id) row.department_id = department_id; row.source = existing.steps ? undefined : source; }
        if (link.text) Object.assign(row, { steps: link.text.slice(0, 4000), documented: 1, missing_info: null, source });
        else if (!existing?.steps) Object.assign(row, { steps: null, documented: 0, missing_info: `Procedure content lives in "${card.file || 'linked file'}" (${link.status.replace('_', ' ')}). ${link.status === 'needs_conversion' ? 'Save it as .docx/.html and re-run the folder import, or paste the steps.' : ''}`.trim() });
        // a card whose file cannot be read never downgrades a task that already has steps (e.g. text supplied another way)
        upsert(db, 'tasks', row);
        addEvent(db, { entity_type: 'task', entity_id: task_id, kind: 'import', status: 'info', label: `${existing ? 'Re-imported' : 'Imported'} index card: ${f.name} (${link.status})`, source: 'import', actor: role, external_id: 'obs-' + crypto.randomUUID() });
      }
      const exDoc = db.prepare('SELECT content, underlying_status FROM documents WHERE id = ?').get(docId);
      const keep = !link.text && exDoc?.content; // keep previously extracted content when this pass could not read the file
      upsert(db, 'documents', { id: docId, title: card.title || cls.base, path: f.name, kind, kind_reason: (overrides[f.name] ? 'set by reviewer' : cls.reason) + ' · index card', sensitive: cls.sensitive, task_id, department_id: department_id || undefined,
        summary: card.why || summarize(f.content), size: link.text ? link.text.length : undefined, source: keep ? undefined : source, imported_at: ts, underlying_path: card.file, underlying_status: keep ? exDoc.underlying_status : link.status, content: keep ? undefined : link.text, hubs: JSON.stringify(card.hubs), entities: JSON.stringify(card.entities) });
      imported++; results.push({ id: task_id || docId, title: card.title, kind, warnings: link.text ? [] : [`Underlying file ${link.status.replace('_', ' ')}: ${card.file || '?'}`] }); continue;
    }
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
    else if (/\.(md|markdown|csv|jsx|js|docx|xlsx|pdf|html|htm|txt)$/i.test(e.name) && !/^~\$/.test(e.name)) out.push(full);
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
    const entry = { path: rel, changed: !prev || prev.hash !== hash, kind: /\.csv$/i.test(full) ? 'csv' : /\.(jsx|js)$/i.test(full) ? 'hub' : /\.(docx|xlsx|pdf|html|htm|txt)$/i.test(full) ? 'file' : 'md' };
    if (!entry.changed && !force) { report.skipped_unchanged++; entry.status = 'unchanged'; report.files.push(entry); continue; }
    const text = buf.toString('utf8');
    try {
      if (entry.kind === 'file') { // Word / Excel / PDF / HTML straight from the folder (e.g. the "Maria leaving" folder)
        if (/\.html?$/i.test(full) && parseOpsHub(text)) { entry.kind = 'hub'; const hub = parseOpsHub(text); entry.preview = { target: 'ops hub', rows: hub.processes.length, mapping: { target: 'ops hub', columns: { processes: String(hub.processes.length) }, unmapped: [] }, warnings: [] }; if (!dryRun) { importOpsHub(db, { filename: rel, content: text }, role); entry.status = prev ? 're-imported' : 'imported'; } }
        else {
          const r = describeOfficeFile(db, rel, buf);
          entry.preview = { title: r.title, kind: r.kind, kind_reason: r.reason, sensitive: r.sensitive, mapping: { mapped: [], unmapped: [] }, warnings: r.warnings, linked: { file: rel, status: r.status, chars: r.text ? r.text.length : 0 }, attaches_to: r.attachTo ? r.attachTo.title : null };
          if (!dryRun) { importOfficeFile(db, { rel, full, buf, parsed: r }, role, overrides[rel]); entry.status = prev ? 're-imported' : 'imported'; }
        }
      } else if (entry.kind === 'hub') {
        const hub = parseOpsHub(text);
        if (!hub) { entry.status = 'skipped: not an ops-hub file'; report.files.push(entry); continue; }
        entry.preview = { target: 'ops hub', rows: hub.processes.length, mapping: { target: 'ops hub', columns: { processes: String(hub.processes.length), legacy_roles: String(hub.roles.length), team: String(hub.team.length) }, unmapped: [] }, warnings: [] };
        if (!dryRun) { importOpsHub(db, { filename: rel, content: text }, role); entry.status = prev ? 're-imported' : 'imported'; }
      } else if (entry.kind === 'md') {
        const card = parseIndexCard(text); const linked = card ? followLink(full, card.file) : undefined;
        const p = parseNote({ name: rel, content: text, linked }, { headings, people, departments });
        const kind = overrides[rel] || p.classification.kind;
        entry.preview = { title: p.row.title, id: kind === 'procedure' ? p.row.id : 'doc-' + slug(p.classification.base), kind, kind_reason: overrides[rel] ? 'set by reviewer' : p.classification.reason, sensitive: p.classification.sensitive, versionOf: p.classification.versionOf, mapping: p.mapping, warnings: p.warnings.filter(w => !w.startsWith('Classified')) };
        if (linked) entry.preview.linked = { file: card.file, status: linked.status, chars: linked.text ? linked.text.length : 0 };
        if (!dryRun) { importMarkdown(db, [{ name: rel, content: text, linked }], role, { overrides: { [rel]: kind } }); entry.status = prev ? 're-imported' : 'imported'; }
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


// ---------- old operations hub (mch-ops-hub.jsx / .html): roles, SOPs and the current-team map ----------
// The old dashboard keeps its data as JS constants (INITIAL_ROLES, INITIAL_PROCESSES, CURRENT_TEAM). They are
// evaluated in an isolated VM context with no require/globals, then turned into tasks, documents and responsibilities.
const vm = require('node:vm');
const HUB_CATEGORY_DEPT = { preconstruction: 'construction', construction: 'construction', 'change management': 'estimating', financial: 'accounting', operations: 'purchasing', sales: 'marketing', design: 'design', 'hr / admin': 'exec' };
const HUB_PROCESS_DEPT = { budget_review: 'estimating', budget_revision: 'estimating', budget_spec: 'estimating', change_order_budget: 'estimating', permitting: 'permits', president_plan_selection: 'permits', back_charge: 'accounting', work_order_ap: 'accounting', new_work_order: 'purchasing', framed_mirror_purchase: 'purchasing', interior_designer_hoa_rocc: 'hoa' };
function parseOpsHub(text) {
  let src = String(text || '');
  if (/^\s*<!DOCTYPE|<html/i.test(src)) { // the built hub is an .html with the data inside a <script type="text/babel"> block
    const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    src = blocks.find(b => /const\s+INITIAL_PROCESSES\s*=/.test(b)) || '';
  }
  if (!/const\s+INITIAL_PROCESSES\s*=/.test(src)) return null;
  const end = src.search(/export\s+default|function\s+MCHOpsHub/); const body = (end > 0 ? src.slice(0, end) : src).replace(/^\s*import[^\n]*\n/gm, '');
  const ctx = vm.createContext(Object.assign(Object.create(null), { React: { useState() {}, useEffect() {}, useRef() {} }, window: {}, document: {} })); // the built hub destructures React at the top; stubbed, never rendered
  vm.runInContext(body + '\n;this.__out = { roles: typeof INITIAL_ROLES !== "undefined" ? INITIAL_ROLES : [], processes: INITIAL_PROCESSES, team: typeof CURRENT_TEAM !== "undefined" ? CURRENT_TEAM : [] };', ctx, { timeout: 2000 });
  const out = ctx.__out;
  return { roles: out.roles || [], processes: out.processes || [], team: out.team || [] };
}
function importOpsHub(db, { filename, content }, role) {
  let hub = null; try { const j = JSON.parse(content); if (j && Array.isArray(j.processes)) hub = { roles: j.roles || [], processes: j.processes, team: j.team || [] }; } catch { /* not JSON */ }
  if (!hub) hub = parseOpsHub(content); if (!hub) return { error: 'Not an ops-hub file (no INITIAL_PROCESSES constant found)' };
  const ts = nowIso(); const src = `Old ops hub import: ${filename || 'mch-ops-hub'} (${ts.slice(0, 10)})`;
  const people = db.prepare('SELECT id, name FROM people').all();
  const idFor = t => { const byId = people.find(p => p.id === t.id); if (byId) return byId.id; const first = String(t.name || '').split(' ')[0].toLowerCase(); return people.find(p => p.name.toLowerCase() === first)?.id || slug(t.name || t.id); };
  const roleOwner = {}; // legacy role id → current person id
  const roleTitle = Object.fromEntries(hub.roles.map(r => [r.id, r.title]));
  let peopleUpdated = 0, tasks = 0, docs = 0;
  for (const t of hub.team) {
    const pid = idFor(t); const ex = db.prepare('SELECT id FROM people WHERE id = ?').get(pid);
    for (const r of t.absorbs || []) roleOwner[r] = pid;
    const all = t.responsibilities || [];
    const crossed = all.filter(r => /^\s*\[N\/A\]/i.test(r)).map(r => r.replace(/^\s*\[N\/A\]\s*/i, ''));
    const row = { id: pid, responsibilities: JSON.stringify(all.filter(r => !/^\s*\[N\/A\]/i.test(r))), crossed_off: JSON.stringify(crossed), legacy_roles: JSON.stringify((t.absorbs || []).map(r => roleTitle[r] || r)) };
    if (!ex) Object.assign(row, { name: String(t.name || t.id).split(' ')[0], full_name: t.name, title: t.title, confirmed: 0, review_status: 'not_reviewed', departments: [normalizeDept(t.department, db.prepare('SELECT id, name, short FROM departments').all())].filter(d => db.prepare('SELECT 1 FROM departments WHERE id = ?').get(d)), source: src, notes: 'Imported from the old ops hub; not in the handoff or org chart.' });
    upsert(db, 'people', row); peopleUpdated++;
  }
  for (const r of hub.roles) { // legacy role definitions are kept as documents so the "who used to do this" history survives
    upsertDocument(db, { name: `legacy-role-${r.id}.md`, content: `# Legacy role: ${r.title}${r.name ? ' (' + r.name + ')' : ''}\nDepartment: ${r.department}\nNow absorbed by: ${roleOwner[r.id] ? personNameFromDb(db, roleOwner[r.id]) : 'nobody (unassigned)'}\n\n## Responsibilities\n${(r.responsibilities || []).map(x => '- ' + x).join('\n')}\n\n## Processes\n${(r.processes || []).map(x => '- ' + x).join('\n')}`, kind: 'org_chart', reason: 'legacy role from old ops hub', sensitive: 0, source: src });
    docs++;
  }
  for (const p of hub.processes) {
    const id = 'hub-' + p.id; const ex = db.prepare('SELECT id, proposed, board, owner_id, missing_info, verification_result, next_action, step_review FROM tasks WHERE id = ?').get(id);
    const owner_id = roleOwner[p.owner] || null;
    const participants = (p.participants || []).map(r => `${roleTitle[r] || r}${roleOwner[r] ? ' → ' + personNameFromDb(db, roleOwner[r]) : ' → unassigned'}`);
    const department_id = HUB_PROCESS_DEPT[p.id] || HUB_CATEGORY_DEPT[String(p.category || '').toLowerCase()] || null;
    const steps = (p.steps || []).map((x, i) => `${i + 1}. ${x}`).join('\n');
    const old = /\b(200\d|201\d)\b/.test(p.date || '');
    const row = { id, title: p.name, department_id, owner_id: ex?.owner_id || owner_id, trigger: p.description || null, steps, inputs: participants.length ? 'Participants (legacy role → current person):\n' + participants.join('\n') : null,
      documented: steps ? 1 : 0, source: `${src} — SOP dated ${p.date || 'unknown'}`, source_link: `${filename || 'mch-ops-hub.jsx'}#${p.id}`,
      missing_info: [old ? `SOP dated ${p.date}: written for the old org (DOC/DOP/CFO roles). Confirm which steps still apply.` : null, !owner_id ? `Legacy owner "${roleTitle[p.owner] || p.owner}" is not absorbed by anyone on the current team.` : null].filter(Boolean).join(' ') || null,
      next_action: 'Review with ' + (owner_id ? personNameFromDb(db, owner_id) : 'the team') + ': confirm the steps still match how it is done today.' };
    if (!ex) Object.assign(row, { proposed: 1, board: 'next' });
    else if (ex.step_review || ex.verification_result) { delete row.missing_info; delete row.next_action; } // a re-import refreshes SOP content but never overwrites a written review
    upsert(db, 'tasks', row);
    upsertDocument(db, { name: `hub-process-${p.id}.md`, content: `# ${p.name}\n${p.description || ''}\n\n${steps}`, kind: 'procedure', reason: 'SOP from old ops hub', sensitive: 0, task_id: id, department_id, source: src });
    addEvent(db, { entity_type: 'task', entity_id: id, kind: 'import', status: 'info', label: `${ex ? 'Re-imported' : 'Imported'} SOP from old ops hub: ${p.name}`, source: 'import', actor: role, external_id: 'hub-' + crypto.randomUUID() });
    tasks++;
  }
  addEvent(db, { entity_type: 'integration', entity_id: 'dashboard', kind: 'import', status: 'info', label: `Snapshot import: old ops hub (${tasks} SOPs, ${hub.roles.length} legacy roles, ${hub.team.length} people)`, source: 'import', actor: role, external_id: 'hub-' + crypto.randomUUID() });
  return { imported: tasks + docs + peopleUpdated, tasks, legacy_roles: hub.roles.length, people: peopleUpdated, unassigned_roles: hub.roles.filter(r => !roleOwner[r.id]).map(r => r.title), imported_at: ts };
}
function personNameFromDb(db, id) { return db.prepare('SELECT name FROM people WHERE id = ?').get(id)?.name || id; }


// ---------- SOW_subs_pricing_contractor_info.xlsx → vendors (trade, sub, docs to provide, $/sf, contacts) ----------
function parseSowWorkbook(buf) {
  const sheets = xlsxSheets(buf); const byTrade = {};
  const key = t => String(t || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const purch = sheets.find(s => /purchas/i.test(s.name)), cons = sheets.find(s => /construct/i.test(s.name));
  let cur = null;
  for (const r of (purch?.rows || []).slice(1)) {
    if (r.A) { cur = key(r.A); byTrade[cur] = byTrade[cur] || { trade: r.A.trim(), docs: [], contacts: [] }; Object.assign(byTrade[cur], { sub_type: r.B || byTrade[cur].sub_type, rate: r.D || byTrade[cur].rate, notes: [byTrade[cur].notes, r.E].filter(Boolean).join(' ') }); }
    if (cur && r.C) byTrade[cur].docs.push(String(r.C).trim());
  }
  cur = null;
  for (const r of (cons?.rows || []).slice(1)) {
    if (r.A) { // a Construction row may name several trades ("LOT SCRAPE, FOUNDATION, FLATWORK"): the vendor and contacts apply to each
      const parts = key(r.A).split(/\s*[,/]\s*/).filter(Boolean);
      cur = parts.map(pt => Object.keys(byTrade).find(t => t === pt) || Object.keys(byTrade).find(t => t.startsWith(pt) || pt.startsWith(t)) || pt);
      cur = [...new Set(cur)];
      for (const k of cur) { byTrade[k] = byTrade[k] || { trade: k, docs: [], contacts: [] }; byTrade[k].vendor = r.B || byTrade[k].vendor; }
    }
    if (cur && (r.C || r.D)) for (const k of cur) { const last = byTrade[k].contacts[byTrade[k].contacts.length - 1]; if (!r.C && last) { last.info = [last.info, r.D].filter(Boolean).join(' / '); if (r.E) last.note = [last.note, r.E].filter(Boolean).join(' '); } else byTrade[k].contacts.push({ name: r.C || '', info: r.D || '', note: r.E || '' }); }
  }
  return Object.values(byTrade);
}
function importSow(db, buf, source) {
  const ts = nowIso(); let n = 0;
  for (const v of parseSowWorkbook(buf)) {
    upsert(db, 'vendors', { id: 'vendor-' + slug(v.trade), trade: v.trade, vendor: v.vendor || v.sub_type || null, contacts: JSON.stringify(v.contacts), rate: v.rate || null, docs_needed: v.docs.join('\n'), notes: v.notes || null, source, imported_at: ts }); n++;
  }
  return n;
}

// ---------- "How to build a house" (Maria): the ordered build sequence ----------
// A 100+ row worksheet: Description | Responsible Party | Notes. It is the only written description of the
// order a McVaugh house is built in, so it is imported as ordered steps rather than one blob of text:
// every step keeps its responsible party (matched to a SOW vendor where one exists), whether it is an
// inspection (city vs third party), whether MCH itself does it (= the builder's own action, i.e. Maria's),
// and whether the responsible party is still unresolved.

// Phase boundaries: the first step whose description matches starts a new phase.
const BUILD_PHASES = [
  [/^lot stake/i, 'Site & slab'],
  [/^form wreck/i, 'Frame & dry-in'],
  [/^exterior top coat/i, 'Exterior envelope'],
  [/^texture walls/i, 'Interior trim & mechanical trim'],
  [/^hardwood floor/i, 'Floors, cabinets & fixtures'],
  [/^balcony overlay/i, 'Landscape, final trims & finals'],
];

// Logins written into the sheet are never stored. The step keeps a pointer to the system, not the secret.
const CRED_RE = /\b(user\s*-?\s*id|username|user|login|pass(?:word)?|pw)\s*[:=]\s*\S+/gi;
function redactCredentials(text) {
  const t = String(text || '');
  if (!CRED_RE.test(t)) { CRED_RE.lastIndex = 0; return { notes: t, credential: null }; }
  CRED_RE.lastIndex = 0;
  const systems = [...t.matchAll(/https?:\/\/([^\s/]+)/gi)].map(m => m[1]);
  return {
    notes: t.replace(CRED_RE, '[login removed — kept in the password manager]').replace(/\s{2,}/g, ' ').trim(),
    credential: 'A username and password for ' + (systems.length ? systems.join(', ') : 'this system') + ' was written in the source sheet. It is not stored here — move it to the password manager and give the successor access.',
  };
}

function matchVendor(db, responsible) {
  const name = String(responsible || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || name === 'mch' || name.includes('?')) return null;
  const words = name.split(' ').filter(w => w.length > 2 && !/^(the|and|of|inc|llc|co|services|service)$/.test(w));
  let best = null, bestScore = 0;
  for (const v of db.prepare('SELECT id, vendor, trade FROM vendors').all()) {
    for (const field of [v.vendor, v.trade]) {
      const f = String(field || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
      if (!f.trim()) continue;
      const hits = words.filter(w => f.includes(w)).length;
      const score = hits / Math.max(words.length, 1);
      if (hits && score > bestScore) { bestScore = score; best = v.id; }
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function parseBuildSequence(buf) {
  const sheet = xlsxSheets(buf)[0];
  if (!sheet) return [];
  const rows = sheet.rows.filter(r => String(r.A || '').trim() || String(r.B || '').trim());
  const out = []; let phase = 'Site & slab', seq = 0;
  for (const r of rows) {
    const desc = String(r.A || '').trim(), responsible = String(r.B || '').trim(), rawNotes = String(r.C || '').trim();
    if (/^how to build a house$/i.test(desc) || /^description$/i.test(desc)) continue;   // title and header
    for (const [re, name] of BUILD_PHASES) if (re.test(desc)) phase = name;
    // Rows with no responsible party are not steps: they are the hold points and notifications Maria wrote in caps.
    let kind = 'step';
    if (!responsible) kind = /^do not|^no work|until/i.test(desc) ? 'hold' : /^notify|^inform/i.test(desc) ? 'notify' : 'note';
    const { notes, credential } = redactCredentials(rawNotes);
    const inspection = /inspection/i.test(desc)
      ? (/city of houston|^city\b/i.test(desc) ? 'city' : /third.?party/i.test(desc) ? 'third_party' : 'other')
      : null;
    out.push({
      seq: kind === 'step' ? ++seq : seq,     // hold/notify rows hang off the step above them
      row: out.length + 1, phase, description: desc.replace(/[.…]+$/, '').trim(), responsible: responsible || null,
      kind, is_mch: /^mch$/i.test(responsible) ? 1 : 0, inspection, notes: notes || null, credential,
      gap: kind === 'step' && (!responsible || responsible.includes('?')) ? 1 : 0,
    });
  }
  return out;
}

function importBuildSequence(db, buf, source) {
  const ts = nowIso(); const steps = parseBuildSequence(buf); let n = 0;
  for (const s of steps) {
    const id = 'bs-' + String(s.row).padStart(3, '0');
    upsert(db, 'build_steps', {
      id, seq: s.seq, row_no: s.row, phase: s.phase, description: s.description, responsible: s.responsible,
      vendor_id: s.kind === 'step' ? matchVendor(db, s.responsible) : null, kind: s.kind, is_mch: s.is_mch,
      inspection: s.inspection, notes: s.notes, credential_note: s.credential, gap: s.gap,
      sensitive: s.credential ? 1 : 0, source, imported_at: ts, updated_at: ts,
    });
    n++;
  }
  return { steps: n, holds: steps.filter(s => s.kind !== 'step').length, gaps: steps.filter(s => s.gap).length, credentials: steps.filter(s => s.credential).length };
}

// ---------- pasted procedures (the ChatGPT skills Brittany writes, one per process) ----------
// Deliberately forgiving: she pastes the skill exactly as it is in ChatGPT and this works out what is what.
// Anything it cannot place is kept verbatim in `notes` and in the attached document, so nothing is lost.
const SKILL_SECTIONS = [
  ['trigger', /^(trigger|when to use|use (this )?when|when this runs|purpose|goal|objective)\b/i],
  ['inputs', /^(inputs?|you\s*('?ll|will)\s*need|what you need|what.s needed|requirements?|prerequisites?|data needed)\b/i],
  ['steps', /^(steps?|instructions?|process|procedure|how to|workflow|what to do)\b/i],
  ['approval_rules', /^(approvals?|approval rules?|authority|who approves|sign.?off|guardrails?|rules?|never|do not)\b/i],
  ['evidence', /^(output|result|evidence|done when|definition of done|deliverable)\b/i],
  ['notes', /^(notes?|exceptions?|special cases?|gotchas?|watch out|examples?)\b/i],
];
const headingOf = line => {
  const t = line.trim();
  if (!t) return null;
  // "## Steps", "**Steps**", "STEPS", "Steps:" — all heading shapes people actually use
  let m = t.match(/^#{1,6}\s*(.+?)\s*:?\s*$/) || t.match(/^\*\*(.+?)\*\*\s*:?\s*$/)
    || (/^[A-Z][A-Za-z '/&-]{2,40}:\s*$/.test(t) && [null, t.replace(/:\s*$/, '')])
    || (/^[A-Z][A-Z '/&-]{2,40}$/.test(t) && [null, t]);
  if (!m) return null;
  const label = String(m[1] || '').trim();
  for (const [key, re] of SKILL_SECTIONS) if (re.test(label)) return { key, label };
  return { key: null, label };
};
const stripBullet = l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();

function parseSkill(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = { title: null, trigger: '', inputs: '', steps: [], approval_rules: '', evidence: '', notes: [] };
  let cur = null, seenAny = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = headingOf(line);
    if (h) {
      // the first heading before any section is the title, unless it names a section
      if (!out.title && !h.key && !seenAny) { out.title = h.label; continue; }
      if (h.key) { cur = h.key; seenAny = true; continue; }
      cur = 'notes'; out.notes.push(h.label + ':'); seenAny = true; continue;
    }
    if (!line.trim()) continue;
    if (!out.title && !cur) { out.title = line.replace(/^#+\s*/, '').trim().slice(0, 160); continue; }
    if (!cur) { out.notes.push(line.trim()); continue; }
    if (cur === 'steps') out.steps.push(stripBullet(line));
    else if (cur === 'notes') out.notes.push(line.trim());
    else out[cur] = [out[cur], stripBullet(line)].filter(Boolean).join(cur === 'inputs' ? '\n' : ' ');
  }
  // No "Steps" heading anywhere: treat a run of numbered or bulleted lines as the steps.
  if (!out.steps.length) {
    const listed = lines.filter(l => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)).map(stripBullet);
    if (listed.length >= 2) out.steps = listed;
  }
  return { ...out, steps: out.steps.filter(Boolean), notes: out.notes.join('\n') };
}

// Which vendors and jobs a pasted procedure mentions, so it files itself against them.
function mentionsIn(db, text) {
  const hay = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  // Whole words only: a plain substring test matches "roofing" inside "waterproofing".
  const says = n => {
    const s = String(n || '').toLowerCase().trim();
    if (s.length <= 3) return false;
    return new RegExp('(^|[^a-z0-9])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(hay);
  };
  const vendors = db.prepare('SELECT id, vendor, trade FROM vendors').all()
    .filter(v => [v.vendor, v.trade].some(says))
    .map(v => v.id);
  const homes = db.prepare('SELECT id, address FROM homes').all()
    .filter(h => { const a = String(h.address || '').toLowerCase(); const num = a.match(/^\d{3,6}/); return a.length > 6 && (hay.includes(a) || (num && hay.includes(num[0] + ' ') && hay.includes(a.split(' ')[1] || '~'))); })
    .map(h => h.id);
  return { vendors: [...new Set(vendors)], homes: [...new Set(homes)] };
}

// ---------- the running log: "what is special about this vendor / this job" ----------
// Accepts a markdown table, a TSV/CSV paste, or "Vendor — detail" lines. Column names are matched loosely
// because the log lives in a chat and its headings move around.
const LOG_COLS = [
  ['vendor', /^(vendor|sub|subcontractor|company|trade)$/i],
  ['job', /^(job|address|house|property|site|lot)$/i],
  ['detail', /^(detail|details|note|notes|special|instruction|instructions|what|requirement|requirements)$/i],
  ['updated', /^(updated|date|as of|last updated|changed)$/i],
];
function parseSpecificsLog(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const split = l => l.includes('|') ? l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    : l.includes('\t') ? l.split('\t').map(c => c.trim()) : null;
  const rows = [];
  let cols = null;
  for (const l of lines) {
    if (/^\|?[\s:|-]+\|?$/.test(l) && l.includes('-')) continue;      // markdown separator row
    const cells = split(l);
    if (cells && cells.length >= 2) {
      if (!cols) {
        const mapped = cells.map(c => (LOG_COLS.find(([, re]) => re.test(c)) || [null])[0]);
        if (mapped.filter(Boolean).length >= 2) { cols = mapped; continue; }
        cols = ['vendor', 'detail', 'job', 'updated'].slice(0, cells.length);   // no header: assume this order
      }
      const row = {};
      cells.forEach((c, i) => { if (cols[i] && c) row[cols[i]] = c; });
      if (row.vendor || row.job) rows.push(row);
      continue;
    }
    // "Johnston Waterproofing — standard pricing, no square footage needed"
    const m = l.match(/^(.{2,60}?)\s*[—–:-]\s+(.{4,})$/);
    if (m) rows.push({ vendor: m[1].trim(), detail: m[2].trim() });
  }
  return rows;
}

// ---------- regenerate the old MCH Operations Hub from the world's current data ----------
// Keeps the hub's own UI (seed/mch-ops-hub.template.html) and replaces its data constants, so the old dashboard
// stays in step with the world: SOPs (old + confirmed new, with supersedes), current-team responsibilities, cross-offs.
function regenerateOpsHub(db, templateHtml) {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'mch-ops-hub.json'), 'utf8'));
  const people = db.prepare('SELECT * FROM people').all(), tasks = db.prepare('SELECT * FROM tasks WHERE archived = 0').all();
  const roleIdByTitle = Object.fromEntries(base.roles.map(r => [r.title, r.id]));
  const personLegacy = p => JSON.parse(p.legacy_roles || '[]').map(t => roleIdByTitle[t]).filter(Boolean);
  const ownerRole = id => { const p = people.find(x => x.id === id); return p ? (personLegacy(p)[0] || p.id) : 'doc'; };
  const steps = t => String(t.steps || '').split(/\n/).map(x => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  const processes = [];
  for (const bp of base.processes) { // old SOPs keep their original structure; steps/description refreshed from the task if edited
    const t = tasks.find(x => x.id === 'hub-' + bp.id); const by = tasks.filter(x => JSON.parse(x.supersedes || '[]').includes('hub-' + bp.id));
    processes.push({ ...bp, status: by.length ? 'superseded' : 'legacy', supersededBy: by.map(x => x.id), reviewed: t?.step_review ? 'reviewed against meetings' : 'not reviewed', ...(t && t.steps && steps(t).length ? { steps: steps(t) } : {}) });
  }
  for (const t of tasks.filter(x => x.id.startsWith('tr-') || x.id.startsWith('sop-'))) {
    processes.push({ id: t.id, name: t.title, owner: ownerRole(t.owner_id), date: (t.source || '').replace(/\s*\(transcript\)/, ''), category: 'Current (confirmed)', description: t.trigger ? 'Trigger: ' + t.trigger : (t.verification_result || ''), steps: steps(t), participants: [ownerRole(t.owner_id), ...(t.backup_id ? [ownerRole(t.backup_id)] : [])], status: 'current', supersedes: JSON.parse(t.supersedes || '[]').map(id => id.replace(/^hub-/, '')), missing: t.missing_info || '' });
  }
  const team = base.team.map(bt => {
    const p = people.find(x => x.id === bt.id) || people.find(x => (x.full_name || '').toLowerCase() === String(bt.name || '').toLowerCase()); if (!p) return bt;
    return { ...bt, name: p.full_name || bt.name, title: p.title || bt.title, email: p.email || bt.email, absorbs: personLegacy(p).length ? personLegacy(p) : bt.absorbs,
      responsibilities: [...JSON.parse(p.responsibilities || '[]'), ...JSON.parse(p.crossed_off || '[]').map(r => '[N/A] ' + r)], review_status: p.review_status, leaving: /LEAVING/.test(p.notes || '') };
  });
  for (const p of people) if (!team.find(t => t.id === p.id) && JSON.parse(p.responsibilities || '[]').length) team.push({ id: p.id, name: p.full_name || p.name, title: p.title || '', department: '', color: '#64748B', email: p.email || '', absorbs: personLegacy(p), responsibilities: JSON.parse(p.responsibilities || '[]') });
  const lit = v => JSON.stringify(v, null, 2);
  let html = templateHtml;
  const replaceConst = (name, value) => { const re = new RegExp(`const ${name} = \\[[\\s\\S]*?\\n\\];`); if (!re.test(html)) throw new Error('template missing ' + name); html = html.replace(re, () => `const ${name} = ${lit(value)};`); };
  replaceConst('INITIAL_PROCESSES', processes); replaceConst('CURRENT_TEAM', team);
  html = html.replace(/<\/head>/, `<!-- regenerated by McVaugh Operations World on ${nowIso()}; data constants come from the world's database. Edit in the world, not here. -->\n</head>`);
  return html;
}

// ---------- office files from a folder: extract, classify, attach to the placeholder they match ----------
function extractOffice(name, buf) {
  const ext = path.extname(name).toLowerCase();
  try {
    if (ext === '.docx') return { status: 'extracted', text: docxText(buf) };
    if (ext === '.xlsx') return { status: 'extracted', text: xlsxText(buf) };
    if (ext === '.html' || ext === '.htm') return { status: 'extracted', text: htmlText(buf) };
    if (ext === '.txt' || ext === '.md') return { status: 'extracted', text: buf.toString('utf8') };
    return { status: 'needs_conversion', text: null }; // .pdf, .doc, .xls: stored, viewable in the browser, no text
  } catch (e) { return { status: 'error: ' + e.message, text: null }; }
}
function describeOfficeFile(db, rel, buf) {
  const name = path.basename(rel); const base = name.replace(/\.[^.]+$/, '');
  const { status, text } = extractOffice(name, buf);
  const cls = classifyNote(name, text || '');
  const docs = db.prepare("SELECT id, title, task_id, underlying_status FROM documents WHERE underlying_status = 'not_attached' OR file_path IS NULL").all();
  let attachTo = null, best = 0;
  for (const d of docs) { const sc = similarity(d.title, base); if (sc > best) { best = sc; attachTo = d; } }
  if (best < 0.5) attachTo = null;
  const warnings = [];
  if (status === 'needs_conversion') warnings.push('Stored for viewing; no text extracted (PDF/.doc/.xls). Save as .docx/.xlsx for searchable text.');
  if (attachTo) warnings.push(`Attaches to the waiting card "${attachTo.title}"`);
  return { title: base, kind: cls.kind, reason: cls.reason, sensitive: cls.sensitive, status, text, attachTo, warnings };
}
function importOfficeFile(db, { rel, full, buf, parsed }, role, kindOverride) {
  const name = path.basename(rel); const ext = path.extname(name).toLowerCase();
  const id = parsed.attachTo ? parsed.attachTo.id : 'doc-' + slug(parsed.title);
  const dir = path.join(require('./db').DATA_DIR, 'uploads'); fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, id + ext); fs.writeFileSync(fp, buf); // snapshot copy; the original stays on the drive
  const mime = { '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html', '.txt': 'text/plain', '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel' }[ext] || 'application/octet-stream';
  const ex = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  upsert(db, 'documents', { id, title: ex?.title || parsed.title, path: rel, kind: kindOverride || ex?.kind || parsed.kind, kind_reason: ex ? undefined : parsed.reason + ' · folder import', sensitive: ex ? undefined : parsed.sensitive, task_id: ex?.task_id || null,
    summary: ex?.summary || (parsed.text ? parsed.text.replace(/\s+/g, ' ').slice(0, 280) : `${name} (${buf.length} bytes)`), size: buf.length, source: `Folder import: ${rel} (${nowIso().slice(0, 10)})`, imported_at: nowIso(),
    file_path: fp, mime, content: parsed.text ? parsed.text.slice(0, MAX_CONTENT) : undefined, underlying_status: parsed.status, underlying_path: full });
  if (ex?.task_id && parsed.text && (kindOverride || ex.kind) === 'procedure') { const t = db.prepare('SELECT steps, documented FROM tasks WHERE id = ?').get(ex.task_id); if (t && !t.steps) upsert(db, 'tasks', { id: ex.task_id, steps: parsed.text.slice(0, 4000), documented: 1, missing_info: null }); }
  addEvent(db, { entity_type: 'document', entity_id: id, kind: 'import', status: 'info', label: `${ex ? 'Attached to waiting card' : 'Imported'}: ${name} (${parsed.status})`, source: 'import', actor: role, external_id: 'file-' + crypto.randomUUID() });
  return id;
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

module.exports = { parseSkill, parseSpecificsLog, mentionsIn, redactCredentials, parseBuildSequence, importBuildSequence, describeOfficeFile, importOfficeFile, parseSowWorkbook, importSow, regenerateOpsHub, xlsxSheets, xlsxText, parseOpsHub, importOpsHub, parseIndexCard, followLink, docxText, htmlText, hubMap, classifyNote, normalizeDept, importMarkdown, importCsv, importFolder, parseNote, parseCsvFile, parseCsv, duplicateCandidates, mergeTasks, pagesMarkdown, DEFAULT_HEADINGS, DEFAULT_ALIASES, headingMap, aliasMap };
