// Snapshot imports (Obsidian markdown, CSV from the old dashboard / Excel) and the Pages handbook export.
// Every imported record keeps `source` (file name) and `imported_at`. Imports are snapshots, never live links.
'use strict';
const { upsert, addEvent, slug, nowIso } = require('./db');
const crypto = require('node:crypto');

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
  return { fm, body: m ? text.slice(m[0].length) : text };
}

// Obsidian note → task/procedure. Recognizes headings like "## Trigger", "## Inputs", "## Steps", "## Owner", etc.
const FIELD_HEADINGS = { trigger: 'trigger', inputs: 'inputs', input: 'inputs', steps: 'steps', procedure: 'steps', owner: 'owner_name', backup: 'backup_name', deadline: 'deadline', evidence: 'evidence', 'completion evidence': 'evidence', approval: 'approval_rules', 'approval rules': 'approval_rules', automation: 'automation_approach', verification: 'verification_result', source: 'source_link', 'missing information': 'missing_info', missing: 'missing_info', blocker: 'blocker', 'next action': 'next_action', next: 'next_action' };

function importMarkdown(db, files, role) {
  const ts = nowIso(); let imported = 0; const results = [];
  const people = db.prepare('SELECT id, name FROM people').all();
  const findPerson = n => n && people.find(p => p.name.toLowerCase() === String(n).trim().toLowerCase())?.id;
  for (const f of files) {
    const { fm, body } = parseFrontmatter(String(f.content || ''));
    const title = fm.title || (body.match(/^#\s+(.+)$/m) || [])[1] || String(f.name || 'note').replace(/\.md$/i, '');
    const fields = {};
    let current = null, buf = [];
    const flush = () => { if (current) fields[current] = (fields[current] ? fields[current] + '\n' : '') + buf.join('\n').trim(); buf = []; };
    for (const line of body.split('\n')) {
      const h = line.match(/^#{2,4}\s+(.+?)\s*$/);
      if (h) { flush(); current = FIELD_HEADINGS[h[1].trim().toLowerCase()] || null; if (!current) current = '_other'; continue; }
      if (!line.match(/^#\s/)) buf.push(line);
    }
    flush();
    const id = fm.id || ('obs-' + slug(title));
    const row = {
      id, title, department_id: fm.department || fm.area || null,
      owner_id: findPerson(fm.owner || fields.owner_name) || null, backup_id: findPerson(fm.backup || fields.backup_name) || null,
      trigger: fields.trigger || fm.trigger || null, inputs: fields.inputs || null, steps: fields.steps || fields._other || body.trim().slice(0, 4000),
      deadline: fields.deadline || fm.deadline || null, evidence: fields.evidence || null, approval_rules: fields.approval_rules || null,
      automation_approach: fields.automation_approach || null, verification_result: fields.verification_result || null, source_link: fields.source_link || null,
      missing_info: fields.missing_info || null, blocker: fields.blocker || null, next_action: fields.next_action || null,
      documented: 1, proposed: fm.status === 'approved' ? 0 : 1, board: 'next',
      source: `Obsidian import: ${f.name} (${ts.slice(0, 10)})`, sensitive: /cash|accounting/i.test((fm.tags || '') + (fm.department || '')) ? 1 : 0,
    };
    upsert(db, 'tasks', row);
    addEvent(db, { entity_type: 'task', entity_id: id, kind: 'import', status: 'info', label: `Imported from Obsidian: ${f.name}`, source: 'import', actor: role, external_id: 'obs-' + crypto.randomUUID() });
    imported++; results.push({ id, title });
  }
  return { imported, results, imported_at: ts };
}

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
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
  return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

const pick = (o, ...names) => { for (const n of names) if (o[n] !== undefined && o[n] !== '') return o[n]; return null; };

// target: dashboard (people/responsibilities), schedule (homes/stages), selections (tasks per home), tasks (generic)
function importCsv(db, { target, filename, content }, role) {
  const ts = nowIso(); const rows = parseCsv(String(content || '')); let imported = 0;
  const src = `${target} import: ${filename || 'csv'} (${ts.slice(0, 10)})`;
  const people = db.prepare('SELECT id, name FROM people').all();
  const findPerson = n => n && people.find(p => p.name.toLowerCase() === String(n).trim().toLowerCase())?.id;
  for (const r of rows) {
    if (target === 'dashboard') {
      const name = pick(r, 'person', 'name', 'owner'); if (!name) continue;
      const existing = findPerson(name);
      const id = existing || slug(name);
      if (!existing) upsert(db, 'people', { id, name, role_summary: pick(r, 'role', 'responsibilities', 'responsibility', 'title') || '', confirmed: 0, review_status: 'not_reviewed', source: src, notes: 'Imported from old dashboard; not yet confirmed.' });
      const resp = pick(r, 'responsibility', 'task', 'responsibilities');
      if (resp) upsert(db, 'tasks', { id: 'dash-' + slug(name + '-' + resp), title: resp, owner_id: id, department_id: pick(r, 'department', 'area', 'function'), steps: pick(r, 'procedure', 'steps', 'notes'), proposed: 1, source: src, board: 'next' });
      imported++;
    } else if (target === 'schedule') {
      const address = pick(r, 'address', 'home', 'job', 'lot'); if (!address) continue;
      const existing = db.prepare('SELECT id FROM homes WHERE lower(address) = lower(?)').get(address);
      upsert(db, 'homes', { id: existing?.id || 'home-' + slug(address), address, job_id: pick(r, 'job id', 'job_id', 'id'), stage: pick(r, 'stage', 'phase', 'status'), kind: 'home', active: pick(r, 'active') ? 'active' : (existing ? undefined : 'unknown'), source: src, imported_at: ts, notes: pick(r, 'notes') });
      imported++;
    } else {
      const title = pick(r, 'title', 'task', 'item', 'selection', 'name'); if (!title) continue;
      upsert(db, 'tasks', { id: 'csv-' + slug(title), title, owner_id: findPerson(pick(r, 'owner', 'person')), department_id: pick(r, 'department', 'area') || (target === 'selections' ? 'design' : null), deadline: pick(r, 'deadline', 'due', 'order deadline'), steps: pick(r, 'steps', 'notes', 'description'), proposed: 1, source: src, board: 'next' });
      imported++;
    }
  }
  addEvent(db, { entity_type: 'integration', entity_id: target === 'dashboard' ? 'dashboard' : 'excel', kind: 'import', status: 'info', label: `Snapshot import: ${filename || 'csv'} (${imported} rows)`, source: 'import', actor: role, external_id: 'csv-' + crypto.randomUUID() });
  return { imported, imported_at: ts, rows: rows.length };
}

// Markdown handbook export for ChatGPT Pages (manual paste). Sensitive tasks are omitted unless the role may see them.
function pagesMarkdown(state) {
  const L = [];
  L.push(`# McVaugh Operations World — handbook export (${state.server.now.slice(0, 10)})`, '');
  L.push('Exported from the McVaugh Operations World app. Items marked PROPOSED are not yet verified with the team.', '');
  const cp = state.checkpoint;
  if (cp) L.push('## Start Here', `- Stage: ${cp.stage}`, `- Current step: ${cp.current_step || ''}`, `- Last completed: ${cp.last_completed || ''}`, `- Next action: ${cp.next_action || ''}`, `- Waiting on: ${cp.waiting_on || ''}`, `- Decisions needed: ${cp.decisions_needed || ''}`, `- Checkpoint saved: ${cp.created_at}`, '');
  L.push('## People (confirmed)');
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

module.exports = { importMarkdown, importCsv, pagesMarkdown, parseCsv };
