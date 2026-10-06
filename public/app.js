// McVaugh Operations World — UI. All state comes from /api/state; all writes go through the server.
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = ts => ts ? new Date(ts).toLocaleString() : '—';
  const STAGES = ['gather', 'map', 'simplify', 'choose', 'pilot', 'expand'];
  const BOARD = { next: 'Next', working: 'Working', waiting: 'Waiting', done: 'Done' };
  const SETUP_STAGES = Object.keys(World.SETUP);
  let S = null, selected = null, pollTimer = null;

  // ---------- api ----------
  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { showLogin(); throw new Error('login required'); }
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    if (!r.ok) { toast(data.error || 'Request failed'); throw new Error(data.error || r.status); }
    return data;
  }
  async function refresh(keepSelection = true) {
    S = await api('GET', '/api/state');
    renderAll();
    if (keepSelection && selected) openDetail(selected.type, selected.id, false);
  }
  async function save(table, row) { const r = await api('POST', `/api/${table}`, row); toast('Saved'); await refresh(); return r; }

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, 2200); }
  function showLogin() { $('#login').hidden = false; $('#passphrase').focus(); }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: $('#passphrase').value }) });
    if (!r.ok) { $('#loginError').textContent = 'Unknown passphrase. Check data/credentials.json on the server.'; $('#loginError').hidden = false; return; }
    $('#login').hidden = true; $('#passphrase').value = ''; refresh();
  });
  $('#logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };

  // ---------- lookups ----------
  const person = id => S.people.find(p => p.id === id);
  const dept = id => S.departments.find(d => d.id === id);
  const agent = id => S.agents.find(a => a.id === id);
  const personName = id => person(id)?.name || (id ? id : 'to confirm');
  const deptName = id => dept(id)?.name || (id || '—');
  const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
  const setupChip = st => { const s = World.SETUP[st] || World.SETUP.not_reviewed; return chip(s.label, s.ready ? 'ok' : s.purple ? 'purple' : s.amber ? 'amber' : s.sat ? 'blue' : 'gray'); };
  const runtimeChip = rt => { if (!rt) return ''; const map = { running: 'ok', waiting: 'amber', failed: 'red', stale: 'red', disconnected: 'red', paused: 'gray' }; return chip((World.RUNTIME[rt.status]?.label || rt.status) + (rt.label && rt.status !== 'workflow_not_reviewed' ? ' — ' + rt.label : ''), map[rt.status] || 'gray') + (rt.source ? chip(rt.source.toUpperCase(), rt.source) : ''); };
  const srcChip = src => chip(src === 'demo' ? 'DEMO' : src, src);

  // ---------- render ----------
  function renderAll() {
    $('#rolePill').textContent = 'Role: ' + S.role + (S.permissions.write ? '' : ' (read-only)');
    $('#demoToggle').checked = S.demo; $('#demoBanner').hidden = !S.demo;
    $('#addBtn').hidden = !S.permissions.write;
    $('#stagePill').textContent = 'Stage: ' + (S.checkpoint?.stage || 'gather');
    renderStartHere(); World.render(S); renderLegend(); renderBoard(); renderRegistry(); renderIntegrations(); renderAi(); renderHistory();
    const fs = $('#focusSelect'); const cur = fs.value;
    fs.innerHTML = '<option value="">Focus department…</option>' + S.departments.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('') + '<option value="neighborhood">Project neighborhood</option>';
    fs.value = cur;
  }

  function renderStartHere() {
    const cp = S.checkpoint || {};
    const idx = STAGES.indexOf(cp.stage || 'gather');
    const tasksBy = col => S.tasks.filter(t => t.board === col && !t.restricted).slice(0, 5);
    const waiting = S.tasks.filter(t => t.board === 'waiting' && t.waiting_on).map(t => t.waiting_on);
    const decisionsNeeded = S.decisions.filter(d => d.status === 'proposed');
    $('#startHere').innerHTML = `
      <div class="sh-title"><h2>Start here, Brittany</h2>${S.permissions.write ? '<button class="small" id="cpBtn">Save checkpoint</button>' : ''}</div>
      <div class="stages">${STAGES.map((s, i) => `<span class="${i < idx ? 'done' : i === idx ? 'current' : ''}">${s}</span>`).join('')}</div>
      <dl class="kv">
        <dt>Current step</dt><dd>${esc(cp.current_step || '—')}</dd>
        <dt>Last completed</dt><dd>${esc(cp.last_completed || '—')}</dd>
      </dl>
      <div class="next-action"><b>Recommended next action</b><br>${esc(cp.next_action || 'Set one in the checkpoint.')}</div>
      <dl class="kv">
        <dt>Waiting on</dt><dd>${esc(cp.waiting_on || (waiting.length ? [...new Set(waiting)].join('; ') : 'Nobody'))}</dd>
        <dt>Decisions needed</dt><dd>${esc(cp.decisions_needed || '')}${decisionsNeeded.length ? `<ul style="margin:4px 0 0 16px;padding:0">${decisionsNeeded.map(d => `<li><a href="#" data-open="decision:${d.id}">${esc(d.title)}</a></li>`).join('')}</ul>` : ''}</dd>
      </dl>
      <div class="mini-board">${Object.entries(BOARD).map(([k, v]) => `<div><b>${v} (${S.tasks.filter(t => t.board === k).length})</b>${tasksBy(k).map(t => `<a data-open="task:${t.id}">${esc(t.title.slice(0, 40))}</a>`).join('') || '<span class="empty">—</span>'}</div>`).join('')}</div>
      <p class="checkpoint-meta">Last session checkpoint: ${fmt(cp.created_at)} by ${esc(cp.author || '—')}${cp.note ? '<br>' + esc(cp.note) : ''}</p>`;
    $('#cpBtn')?.addEventListener('click', () => checkpointForm());
  }

  function renderLegend() {
    $('#legend').innerHTML = `<b>Setup:</b> <span><i style="border-style:dashed"></i>Not reviewed</span><span><i style="border-color:var(--amber)"></i>Under review</span><span><i style="border-color:var(--brand);background:#c7d3ff"></i>1/3 documented · 2/3 automated</span><span><i style="border-color:var(--purple);background:#e7dcff"></i>Verification pending</span><span><i style="border-color:var(--ok);background:#b8f0d8"></i>✓ Ready</span>
      &nbsp;<b>Activity:</b> <span>⚙ Running (animated)</span><span style="color:var(--amber)">⏳ Waiting approval</span><span style="color:var(--red)">! Blocked/failed</span><span>⏸ Paused</span><span style="color:var(--red)">⚠ Stale/disconnected</span><span>People: "workflow not reviewed" ≠ inactive</span>`;
  }

  function taskCard(t) {
    const cls = t.restricted ? 'restricted' : t.verified ? 'verified' : t.proposed ? 'proposed' : '';
    return `<div class="card-t ${cls}" data-open="task:${t.id}"><div>${esc(t.title)}</div><small>${esc(personName(t.owner_id))} · ${esc(dept(t.department_id)?.short || '—')}${t.proposed ? ' · PROPOSED' : ''}${t.project_stage ? ' · ' + t.project_stage : ''}</small><small>${t.documented ? '📄' : '▫'} doc ${t.automated ? '⚙' : '▫'} auto ${t.verified ? '✓' : '▫'} verified</small></div>`;
  }
  function renderBoard() {
    $('#viewBoard').innerHTML = `<div class="board">${Object.entries(BOARD).map(([k, v]) => `<div class="col"><h3>${v} <span>${S.tasks.filter(t => t.board === k).length}</span></h3>${S.tasks.filter(t => t.board === k).map(taskCard).join('') || '<p class="empty">Nothing here</p>'}</div>`).join('')}</div>`;
  }

  function renderRegistry() {
    const rows = (items, cols, type) => `<table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${items.map(i => `<tr class="clickable" data-open="${type}:${i.id}">${cols.map(c => `<td>${c[1](i)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $('#viewRegistry').innerHTML = `<div class="table-wrap">
      <h2>People (${S.people.length})</h2>${rows(S.people, [['Name', p => esc(p.name)], ['Responsibilities', p => esc(p.role_summary)], ['Departments', p => p.departments.map(deptName).map(esc).join(', ')], ['Confirmed', p => p.confirmed ? chip('confirmed', 'ok') : chip('unconfirmed', 'amber')], ['Review', p => chip(p.review_status.replace('_', ' '), p.review_status === 'verified' ? 'ok' : p.review_status === 'under_review' ? 'amber' : 'gray')], ['Activity', p => runtimeChip(p.runtime)]], 'person')}
      <h2 style="margin-top:18px">Agents (${S.agents.length}) — proposed functions</h2>${rows(S.agents, [['Agent', a => esc(a.name)], ['Department', a => esc(deptName(a.department_id))], ['Approach', a => chip(a.approach, a.approach === 'rules' ? 'ok' : a.approach === 'ai' ? 'purple' : 'gray') + ' <span class="src">' + esc(a.approach_note || '') + '</span>'], ['Setup', a => setupChip(a.setup_stage)], ['Activity', a => runtimeChip(a.runtime)]], 'agent')}
      <h2 style="margin-top:18px">Tasks & procedures (${S.tasks.length})</h2>${rows(S.tasks, [['Title', t => esc(t.title) + (t.proposed ? ' ' + chip('PROPOSED', 'amber') : '')], ['Owner', t => esc(personName(t.owner_id))], ['Dept', t => esc(dept(t.department_id)?.short || '—')], ['Board', t => esc(BOARD[t.board])], ['Milestones', t => (t.documented ? chip('documented', 'blue') : '') + (t.automated ? chip('automated', 'blue') : '') + (t.verified ? chip('verified', 'ok') : '')], ['Source', t => `<span class="src">${esc(t.source || '')}</span>`]], 'task')}
      <h2 style="margin-top:18px">Departments</h2>${rows(S.departments, [['Department', d => esc(d.name)], ['Setup', d => setupChip(d.setup_stage)], ['People', d => S.people.filter(p => p.departments.includes(d.id)).map(p => esc(p.name)).join(', ') || '—'], ['Agents', d => S.agents.filter(a => a.department_id === d.id).length]], 'department')}
      <h2 style="margin-top:18px">Homes / jobs (${S.homes.length})</h2>${rows(S.homes, [['Address', h => esc(h.address)], ['Job ID', h => esc(h.job_id)], ['Kind', h => esc(h.kind)], ['Active', h => chip(h.active, h.active === 'active' ? 'ok' : h.active === 'inactive' ? 'gray' : 'amber')], ['Pilot', h => h.pilot ? '★' : ''], ['Source', h => `<span class="src">${esc(h.source || '')} ${h.imported_at ? fmt(h.imported_at) : ''}</span>`]], 'home')}
      <h2 style="margin-top:18px">Decisions (${S.decisions.length})</h2>${rows(S.decisions, [['Date', d => esc(d.date)], ['Decision', d => esc(d.title)], ['Status', d => chip(d.status, d.status === 'approved' ? 'ok' : 'amber')], ['By', d => esc(d.decided_by)], ['Reason', d => esc(d.reason)]], 'decision')}
    </div>`;
  }

  function renderIntegrations() {
    const w = S.permissions.write;
    if ($('#obsFiles')?.files.length || $('#csvFile')?.files.length || $('#restoreFile')?.files.length) return; // don't wipe a chosen file during polling
    $('#viewIntegrations').innerHTML = `<div class="section">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><h2 style="margin:0">Integrations</h2>${w ? '<button class="small" id="checkInt">Check connections</button>' : ''}<span class="hint">Snapshot imports are never shown as live connections.</span></div>
      <div class="grid-2">${S.integrations.map(i => `<div class="card int-card" data-open="integration:${i.id}"><div class="dot ${i.status}"></div><div><b>${esc(i.name)}</b> ${chip(i.kind, 'gray')} ${chip(i.status, i.status === 'connected' ? 'ok' : i.status === 'failing' ? 'red' : 'gray')}<br><span class="src">${esc(i.notes || '')}</span><br><span class="src">Checked: ${fmt(i.last_checked)}${i.last_import_at ? ' · last import ' + fmt(i.last_import_at) : ''}${i.last_message ? ' · ' + esc(i.last_message) : ''}</span></div></div>`).join('')}</div>
      <h2 style="margin-top:20px">Import (snapshot)</h2>
      <div class="grid-2">
        <div class="card"><h3>Obsidian notes (.md)</h3><p class="src">Headings like <code>## Trigger</code>, <code>## Inputs</code>, <code>## Steps</code>, <code>## Owner</code>, <code>## Approval rules</code> map to task fields. Frontmatter <code>owner:</code>, <code>department:</code>, <code>status: approved</code> are honored.</p><input type="file" id="obsFiles" multiple accept=".md,.markdown,.txt" ${w ? '' : 'disabled'}><button class="small" id="obsImport" ${w ? '' : 'disabled'}>Import notes</button></div>
        <div class="card"><h3>CSV (old dashboard / Excel saved as CSV)</h3><p class="src">Dashboard columns: person, responsibility, department. Schedule: address, stage. Selections/tasks: title, owner, deadline.</p><select id="csvTarget"><option value="dashboard">Old people/responsibilities dashboard</option><option value="schedule">Excel schedule (homes & stages)</option><option value="selections">Excel selection guide</option><option value="tasks">Generic task list</option></select><input type="file" id="csvFile" accept=".csv,.txt" ${w ? '' : 'disabled'}><button class="small" id="csvImport" ${w ? '' : 'disabled'}>Import CSV</button></div>
      </div>
      <h2 style="margin-top:20px">Export / recovery</h2>
      <div class="actions">${S.permissions.sensitive ? '<a class="small" href="/api/export" download><button class="small">Download full backup (JSON)</button></a>' : ''}<a href="/api/export/pages" target="_blank"><button class="small">Handbook export for ChatGPT Pages (Markdown)</button></a>${w ? '<button class="small" id="pagesMark">Mark "pasted into Pages"</button>' : ''}${S.role === 'admin' ? '<input type="file" id="restoreFile" accept=".json" style="width:auto"><button class="small danger" id="restoreBtn">Restore backup (replaces everything)</button>' : ''}</div>
      <p class="src">Canonical store: <code>${esc(S.server.db_path || 'data/mcvaugh-world.sqlite (path visible to admin)')}</code>. Back up by copying that file or downloading the JSON. n8n webhook: <code>POST /api/webhooks/n8n</code> with header <code>X-MOW-Secret</code> — secret ${S.server.n8n_secret_set ? 'is set' : 'NOT set (MOW_N8N_SECRET)'}.</p>
      <p class="src">Not accessible from this build environment (nothing was inspected): <code>C:\\Users\\bmcvaugh\\Documents</code>, <code>L:\\AI Tools Shared</code>, <code>C:\\Users\\bmcvaugh\\Documents\\MCH-DB</code>, the old dashboard, Obsidian vault, BuildConnect 2.0.</p>
    </div>`;
    $('#checkInt')?.addEventListener('click', async () => { await api('POST', '/api/integrations/check'); toast('Checked'); refresh(); });
    $('#obsImport')?.addEventListener('click', async () => { const files = [...$('#obsFiles').files]; if (!files.length) return toast('Choose .md files first'); const payload = await Promise.all(files.map(async f => ({ name: f.name, content: await f.text() }))); const r = await api('POST', '/api/import/obsidian', { files: payload }); toast(`Imported ${r.imported} notes`); refresh(); });
    $('#csvImport')?.addEventListener('click', async () => { const f = $('#csvFile').files[0]; if (!f) return toast('Choose a CSV first'); const r = await api('POST', '/api/import/csv', { target: $('#csvTarget').value, filename: f.name, content: await f.text() }); toast(`Imported ${r.imported} of ${r.rows} rows`); refresh(); });
    $('#pagesMark')?.addEventListener('click', async () => { await api('POST', '/api/export/pages/mark'); toast('Logged'); refresh(); });
    $('#restoreBtn')?.addEventListener('click', async () => { const f = $('#restoreFile').files[0]; if (!f) return toast('Choose a backup file'); if (!confirm('Replace ALL current data with this backup?')) return; await api('POST', '/api/import/backup', JSON.parse(await f.text())); toast('Restored'); refresh(); });
  }

  function renderAi() {
    $('#viewAi').innerHTML = `<div class="table-wrap"><h2>AI task configuration</h2><p class="src">Deterministic logic for arithmetic, matching, status changes and reminders — no model calls. Model IDs stay configurable (<code>config/models.json</code>); verify availability before choosing. Existing subscriptions (ChatGPT Business, Claude Team) do not include API usage; nothing is purchased automatically.</p>
      <table><thead><tr><th>Agent</th><th>Purpose</th><th>Needs AI?</th><th>Provider / model</th><th>Why</th><th>Expected cost</th><th>Approval</th><th>Eval examples</th><th>Fallback</th></tr></thead><tbody>
      ${S.ai_configs.map(c => `<tr class="clickable" data-open="ai:${c.id}"><td>${esc(agent(c.agent_id)?.name || c.agent_id)}</td><td>${esc(c.purpose)}</td><td>${chip(c.needs_ai === 'no_rules' ? 'No — rules' : c.needs_ai === 'yes' ? 'Yes' : 'Undecided', c.needs_ai === 'no_rules' ? 'ok' : c.needs_ai === 'yes' ? 'purple' : 'gray')}</td><td>${esc(c.provider)}<br><code>${esc(c.model || '—')}</code></td><td>${esc(c.why)}</td><td>${esc(c.expected_cost)}</td><td>${esc(c.approval)}</td><td>${esc(c.eval_examples)}</td><td>${esc(c.fallback)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderHistory() {
    $('#viewHistory').innerHTML = `<div class="table-wrap"><h2>Activity events (latest 300)</h2>
      <table><thead><tr><th>When</th><th>Entity</th><th>Kind</th><th>Status</th><th>Label</th><th>Source</th></tr></thead><tbody>${S.events.map(e => `<tr class="clickable" data-open="${e.entity_type}:${e.entity_id}"><td>${fmt(e.ts)}</td><td>${esc(e.entity_type)} · ${esc(entityName(e.entity_type, e.entity_id))}</td><td>${esc(e.kind)}</td><td>${esc(e.status)}</td><td>${esc(e.label)}</td><td>${srcChip(e.source)}</td></tr>`).join('')}</tbody></table>
      <h2 style="margin-top:18px">Checkpoint history</h2><table><thead><tr><th>Saved</th><th>Stage</th><th>Current step</th><th>Next action</th><th>Waiting on</th><th>By</th></tr></thead><tbody>${S.checkpoints.map(c => `<tr><td>${fmt(c.created_at)}</td><td>${esc(c.stage)}</td><td>${esc(c.current_step)}</td><td>${esc(c.next_action)}</td><td>${esc(c.waiting_on)}</td><td>${esc(c.author)}</td></tr>`).join('')}</tbody></table>
      ${S.permissions.audit ? `<h2 style="margin-top:18px">Audit (admin)</h2><table><thead><tr><th>When</th><th>Role</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead><tbody>${S.audit.map(a => `<tr><td>${fmt(a.ts)}</td><td>${esc(a.role)}</td><td>${esc(a.action)}</td><td>${esc(a.entity_type)} ${esc(a.entity_id)}</td><td class="src">${esc(a.detail)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
  }
  function entityName(type, id) { return ({ person: () => personName(id), agent: () => agent(id)?.name, department: () => deptName(id), home: () => S.homes.find(h => h.id === id)?.address, task: () => S.tasks.find(t => t.id === id)?.title, integration: () => S.integrations.find(i => i.id === id)?.name }[type] || (() => id))() || id; }

  // ---------- forms ----------
  function field(f, v) {
    const val = v?.[f.key] ?? f.default ?? '';
    if (f.type === 'textarea') return `<label class="field"><span>${f.label}</span><textarea name="${f.key}">${esc(val)}</textarea></label>`;
    if (f.type === 'select') return `<label class="field"><span>${f.label}</span><select name="${f.key}">${f.options.map(o => `<option value="${esc(o[0])}" ${String(val) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
    if (f.type === 'checkbox') return `<label class="field"><input type="checkbox" name="${f.key}" style="width:auto" ${val ? 'checked' : ''}> ${f.label}</label>`;
    if (f.type === 'multiselect') return `<label class="field"><span>${f.label}</span><select name="${f.key}" multiple size="4">${f.options.map(o => `<option value="${esc(o[0])}" ${(val || []).includes(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
    return `<label class="field"><span>${f.label}</span><input name="${f.key}" value="${esc(val)}"></label>`;
  }
  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      const e = form.elements[f.key]; if (!e) continue;
      if (f.type === 'checkbox') out[f.key] = e.checked ? 1 : 0;
      else if (f.type === 'multiselect') out[f.key] = [...e.selectedOptions].map(o => o.value);
      else out[f.key] = e.value;
    }
    return out;
  }
  function modal(title, fields, values, onSave, extra = '') {
    const m = $('#modal'), c = $('#modalCard');
    c.innerHTML = `<h2>${esc(title)}</h2><form id="mform">${fields.map(f => field(f, values)).join('')}${extra}<div class="actions"><button type="submit" class="primary">Save</button><button type="button" id="mcancel">Cancel</button></div></form>`;
    m.hidden = false;
    $('#mcancel').onclick = () => m.hidden = true;
    $('#mform').onsubmit = async e => { e.preventDefault(); await onSave(readForm(e.target, fields)); m.hidden = true; };
  }
  const peopleOpts = () => [['', '— none —'], ...S.people.map(p => [p.id, p.name])];
  const deptOpts = () => [['', '— none —'], ...S.departments.map(d => [d.id, d.name])];
  const FIELDS = {
    person: () => [{ key: 'name', label: 'Name' }, { key: 'role_summary', label: 'Responsibilities (summary)', type: 'textarea' }, { key: 'departments', label: 'Departments', type: 'multiselect', options: S.departments.map(d => [d.id, d.name]) }, { key: 'confirmed', label: 'Confirmed by Brittany/Jim', type: 'checkbox' }, { key: 'review_status', label: 'Responsibility review', type: 'select', options: [['not_reviewed', 'Not reviewed'], ['under_review', 'Under review'], ['verified', 'Verified']] }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'source', label: 'Source' }],
    task: () => [{ key: 'title', label: 'Title' }, { key: 'department_id', label: 'Department', type: 'select', options: deptOpts() }, { key: 'owner_id', label: 'Owner', type: 'select', options: peopleOpts() }, { key: 'backup_id', label: 'Backup', type: 'select', options: peopleOpts() }, { key: 'agent_id', label: 'Linked agent', type: 'select', options: [['', '— none —'], ...S.agents.map(a => [a.id, a.name])] }, { key: 'board', label: 'Board column', type: 'select', options: Object.entries(BOARD) }, { key: 'project_stage', label: 'Project stage (implementation tasks)', type: 'select', options: [['', '—'], ...STAGES.map(s => [s, s])] }, { key: 'trigger', label: 'Trigger' }, { key: 'inputs', label: 'Inputs', type: 'textarea' }, { key: 'steps', label: 'Steps', type: 'textarea' }, { key: 'deadline', label: 'Deadline' }, { key: 'evidence', label: 'Completion evidence' }, { key: 'approval_rules', label: 'Approval rules', type: 'textarea' }, { key: 'automation_approach', label: 'Automation approach', type: 'textarea' }, { key: 'verification_result', label: 'Verification result' }, { key: 'source_link', label: 'Source-system link' }, { key: 'missing_info', label: 'Missing information', type: 'textarea' }, { key: 'blocker', label: 'Blocker / approval needed' }, { key: 'waiting_on', label: 'Waiting on (who)' }, { key: 'next_action', label: 'Next small action' }, { key: 'proposed', label: 'Proposed (not yet verified with the team)', type: 'checkbox' }, ...(S.permissions.sensitive ? [{ key: 'sensitive', label: 'Sensitive (cash/accounting — restricted roles only)', type: 'checkbox' }] : []), { key: 'source', label: 'Source' }],
    agent: () => [{ key: 'name', label: 'Agent name' }, { key: 'department_id', label: 'Department', type: 'select', options: deptOpts() }, { key: 'purpose', label: 'Purpose', type: 'textarea' }, { key: 'initial_output', label: 'Initial output (read/flag/draft)' }, { key: 'human_authority', label: 'Human authority retained' }, { key: 'approach', label: 'Approach', type: 'select', options: [['rules', 'Ordinary rules are sufficient'], ['ai', 'AI model needed'], ['hybrid', 'Hybrid: rules + model drafting'], ['undecided', 'Undecided']] }, { key: 'approach_note', label: 'Why', type: 'textarea' }, { key: 'setup_stage', label: 'Setup maturity', type: 'select', options: SETUP_STAGES.map(s => [s, World.SETUP[s].label]) }, { key: 'enabled', label: 'Enabled (does not mean running)', type: 'checkbox' }, { key: 'paused', label: 'Paused', type: 'checkbox' }, { key: 'n8n_workflow_id', label: 'n8n workflow id (maps callbacks to this agent)' }, { key: 'next_run', label: 'Next scheduled run' }, { key: 'proposed', label: 'Proposed placeholder', type: 'checkbox' }],
    home: () => [{ key: 'address', label: 'Address' }, { key: 'job_id', label: 'MCH Job ID' }, { key: 'kind', label: 'Kind', type: 'select', options: [['home', 'Home'], ['lot', 'Lot'], ['hoa', 'HOA entity'], ['office', 'Office'], ['other', 'Other'], ['unknown', 'Unknown']] }, { key: 'active', label: 'Active', type: 'select', options: [['unknown', 'Unknown (not confirmed)'], ['active', 'Active'], ['inactive', 'Inactive / finished']] }, { key: 'stage', label: 'Construction stage' }, { key: 'pilot', label: 'Pilot home', type: 'checkbox' }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'source', label: 'Source' }],
    decision: () => [{ key: 'date', label: 'Date (YYYY-MM-DD)', default: new Date().toISOString().slice(0, 10) }, { key: 'title', label: 'Decision' }, { key: 'reason', label: 'Reason', type: 'textarea' }, { key: 'decided_by', label: 'Decided by' }, { key: 'status', label: 'Status', type: 'select', options: [['approved', 'Approved'], ['proposed', 'Proposed'], ['superseded', 'Superseded']] }, { key: 'source', label: 'Source' }],
    department: () => [{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'setup_stage', label: 'Setup maturity', type: 'select', options: SETUP_STAGES.map(s => [s, World.SETUP[s].label]) }],
    integration: () => [{ key: 'status', label: 'Status (manual override)', type: 'select', options: [['disconnected', 'Disconnected'], ['connected', 'Connected'], ['failing', 'Failing']] }, { key: 'notes', label: 'Notes', type: 'textarea' }, ...(S.permissions.integrationConfig ? [{ key: 'config', label: 'Config (JSON; no secrets — use env vars)', type: 'textarea' }] : [])],
    ai: () => [{ key: 'purpose', label: 'Purpose' }, { key: 'needs_ai', label: 'Needs AI?', type: 'select', options: [['no_rules', 'No — deterministic rules'], ['yes', 'Yes'], ['undecided', 'Undecided']] }, { key: 'provider', label: 'Provider' }, { key: 'model', label: 'Model id (verify availability first)' }, { key: 'why', label: 'Why appropriate', type: 'textarea' }, { key: 'expected_cost', label: 'Expected cost' }, { key: 'approval', label: 'Approval requirement' }, { key: 'eval_examples', label: 'Evaluation examples', type: 'textarea' }, { key: 'fallback', label: 'Fallback' }],
  };
  const TABLE = { person: 'people', task: 'tasks', agent: 'agents', home: 'homes', decision: 'decisions', department: 'departments', integration: 'integrations', ai: 'ai_configs' };

  function editEntity(type, obj) { modal((obj ? 'Edit ' : 'Add ') + type, FIELDS[type](), obj, async v => { if (obj) v.id = obj.id; await save(TABLE[type], v); }); }
  function checkpointForm() {
    const cp = S.checkpoint || {};
    modal('Save session checkpoint', [{ key: 'stage', label: 'Project stage', type: 'select', options: STAGES.map(s => [s, s]) }, { key: 'current_step', label: 'Current step', type: 'textarea' }, { key: 'last_completed', label: 'Last completed', type: 'textarea' }, { key: 'next_action', label: 'One recommended next action', type: 'textarea' }, { key: 'waiting_on', label: 'Waiting on whom' }, { key: 'decisions_needed', label: 'Decisions needed', type: 'textarea' }, { key: 'note', label: 'Note for future you', type: 'textarea' }], cp, async v => { await api('POST', '/api/checkpoints', v); toast('Checkpoint saved'); refresh(); });
  }
  $('#addBtn').onclick = () => modal('Add', [{ key: 'kind', label: 'What do you want to add?', type: 'select', options: [['task', 'Task / procedure'], ['person', 'Person'], ['agent', 'Agent (proposed function)'], ['home', 'Home / job'], ['decision', 'Decision']] }], {}, async v => setTimeout(() => editEntity(v.kind, null), 0));

  // ---------- detail panel ----------
  function openDetail(type, id, focusWorld = true) {
    const w = S.permissions.write;
    const obj = { person: () => person(id), agent: () => agent(id), department: () => dept(id), home: () => S.homes.find(h => h.id === id), task: () => S.tasks.find(t => t.id === id), decision: () => S.decisions.find(d => d.id === id), integration: () => S.integrations.find(i => i.id === id), ai: () => S.ai_configs.find(a => a.id === id), system: () => null }[type]?.();
    if (!obj) { $('#detail').hidden = true; selected = null; return; }
    selected = { type, id };
    const evs = S.events.filter(e => e.entity_type === type && e.entity_id === id);
    const tasksFor = type === 'person' ? S.tasks.filter(t => t.owner_id === id || t.backup_id === id) : type === 'department' ? S.tasks.filter(t => t.department_id === id) : type === 'agent' ? S.tasks.filter(t => t.agent_id === id) : [];
    const lastVerified = evs.find(e => e.kind === 'run' && e.status === 'finished') || null;
    const section = (title, body) => body ? `<h4>${title}</h4><div>${body}</div>` : '';
    const taskList = list => list.length ? list.map(t => `<div class="card-t ${t.restricted ? 'restricted' : t.verified ? 'verified' : t.proposed ? 'proposed' : ''}" data-open="task:${t.id}">${esc(t.title)}<small>${esc(BOARD[t.board])} · ${t.documented ? 'documented' : 'not documented'}${t.proposed ? ' · PROPOSED' : ''}</small></div>`).join('') : '<p class="empty">No tasks linked yet.</p>';
    const history = `<ul class="history">${evs.slice(0, 25).map(e => `<li><time>${fmt(e.ts)}</time>${esc(e.label || e.kind)} ${chip(e.status, e.status === 'failed' ? 'red' : e.status === 'started' ? 'ok' : 'gray')} ${srcChip(e.source)}</li>`).join('') || '<li class="empty">No recorded activity yet.</li>'}</ul>`;
    const manualActivity = (w && (type === 'agent' || type === 'person' || type === 'department' || type === 'home')) ? `<h4>Record verified activity (manual)</h4><div class="actions"><button class="small" data-ev="started">Start</button><button class="small" data-ev="finished">Finish</button><button class="small" data-ev="waiting_approval">Waiting approval</button><button class="small" data-ev="failed">Failed / blocked</button></div><p class="src">Manual entries are labeled "Manual". Real n8n runs arrive through the authenticated webhook.</p>` : '';
    let body = '';
    if (type === 'person') {
      body = `<p>${esc(obj.role_summary)}</p>${obj.confirmed ? chip('Confirmed person', 'ok') : chip('Unconfirmed', 'amber')} ${chip('Review: ' + obj.review_status.replace('_', ' '), obj.review_status === 'verified' ? 'ok' : obj.review_status === 'under_review' ? 'amber' : 'gray')}
        ${section('Departments', obj.departments.map(deptName).map(esc).join(', ') || '—')}
        ${w ? `<h4>Responsibility review</h4><div class="milestones">${[['not_reviewed', 'Not reviewed'], ['under_review', 'Under review'], ['verified', 'Verified']].map(([k, l]) => `<button class="${obj.review_status === k ? 'on' : ''}" data-set="review_status:${k}">${l}</button>`).join('')}</div>` : ''}
        ${section('Current activity', runtimeChip(obj.runtime))}
        ${section('Tasks (owner or backup)', taskList(tasksFor))}
        ${section('Notes', esc(obj.notes))}${section('Source', esc(obj.source))}`;
    } else if (type === 'agent') {
      const ai = S.ai_configs.find(c => c.agent_id === id);
      body = `<p>${esc(obj.purpose)}</p>${chip(obj.proposed ? 'Proposed function' : 'Active', obj.proposed ? 'amber' : 'ok')} ${setupChip(obj.setup_stage)} ${chip('Approach: ' + obj.approach, obj.approach === 'rules' ? 'ok' : obj.approach === 'ai' ? 'purple' : 'gray')} ${obj.enabled ? chip('enabled', 'blue') : chip('not enabled', 'gray')}
        <p class="src">${esc(obj.approach_note)}</p>
        ${section('Department / owner', esc(deptName(obj.department_id)) + ' · human authority: ' + esc(obj.human_authority || 'to confirm'))}
        ${w ? `<h4>Setup maturity</h4><div class="milestones">${SETUP_STAGES.map(k => `<button class="${obj.setup_stage === k ? 'on' : ''}" data-set="setup_stage:${k}" title="${World.SETUP[k].label}">${World.SETUP[k].badge || '○'}</button>`).join('')}</div><p class="src">${SETUP_STAGES.map(k => `${World.SETUP[k].badge || '○'} ${World.SETUP[k].label}`).join(' · ')}</p>` : ''}
        ${section('Current activity', runtimeChip(obj.runtime) + (obj.runtime?.since ? `<div class="src">since ${fmt(obj.runtime.since)}</div>` : ''))}
        ${section('Last verified result', lastVerified ? `${esc(lastVerified.label)} — ${fmt(lastVerified.ts)} ${srcChip(lastVerified.source)}` : '<span class="empty">None recorded. Missing data is not a clean bill of health.</span>')}
        ${section('Next run', esc(obj.next_run || 'not scheduled'))}
        ${section('AI configuration', ai ? `${chip(ai.needs_ai === 'no_rules' ? 'Rules sufficient' : ai.needs_ai === 'yes' ? 'Model needed' : 'Undecided', ai.needs_ai === 'no_rules' ? 'ok' : 'purple')} ${esc(ai.provider)} <code>${esc(ai.model || '—')}</code> <a href="#" data-open="ai:${ai.id}">edit</a>` : '')}
        ${section('Linked tasks', taskList(tasksFor))}${manualActivity}`;
    } else if (type === 'department') {
      const ppl = S.people.filter(p => p.departments.includes(id)), ags = S.agents.filter(a => a.department_id === id);
      body = `<p>${esc(obj.description)}</p>${setupChip(obj.setup_stage)}
        ${w ? `<h4>Setup maturity</h4><div class="milestones">${SETUP_STAGES.map(k => `<button class="${obj.setup_stage === k ? 'on' : ''}" data-set="setup_stage:${k}" title="${World.SETUP[k].label}">${World.SETUP[k].badge || '○'}</button>`).join('')}</div>` : ''}
        ${section('People', ppl.map(p => `<a href="#" data-open="person:${p.id}">${esc(p.name)}</a>`).join(', ') || '<span class="empty">Nobody assigned yet</span>')}
        ${section('Agents (proposed)', ags.map(a => `<a href="#" data-open="agent:${a.id}">${esc(a.name)}</a> ${setupChip(a.setup_stage)}`).join('<br>') || '—')}
        ${section('Tasks & procedures', taskList(tasksFor))}${manualActivity}`;
    } else if (type === 'task') {
      if (obj.restricted) body = `<p class="error">Restricted: accounting/cash detail. Sign in with an accounting or admin passphrase.</p>`;
      else body = `${obj.proposed ? chip('PROPOSED — not yet verified with the team', 'amber') : chip('Reviewed', 'ok')} ${obj.sensitive ? chip('Restricted', 'red') : ''} ${chip(BOARD[obj.board], 'blue')}
        ${w ? `<h4>Milestones (distinct)</h4><div class="milestones">${[['documented', 'Documented'], ['automated', 'Automated'], ['verified', 'Verified']].map(([k, l]) => `<button class="${obj[k] ? 'on' : ''}" data-toggle="${k}">${obj[k] ? '✓ ' : ''}${l}</button>`).join('')}</div>
        <h4>Board</h4><div class="milestones">${Object.entries(BOARD).map(([k, l]) => `<button class="${obj.board === k ? 'on' : ''}" data-set="board:${k}">${l}</button>`).join('')}</div>` : ''}
        ${section('Owner / backup', esc(personName(obj.owner_id)) + ' / ' + esc(obj.backup_id ? personName(obj.backup_id) : '—') + ' · ' + esc(deptName(obj.department_id)))}
        ${section('Trigger', esc(obj.trigger))}${section('Inputs', esc(obj.inputs))}${section('Steps', esc(obj.steps))}${section('Deadline', esc(obj.deadline))}
        ${section('Completion evidence', esc(obj.evidence))}${section('Approval rules', esc(obj.approval_rules))}${section('Automation approach', esc(obj.automation_approach))}
        ${section('Verification result', esc(obj.verification_result))}${section('Source-system link', obj.source_link ? `<a href="${esc(obj.source_link)}" target="_blank" rel="noopener">${esc(obj.source_link)}</a>` : '')}
        ${section('Missing information', esc(obj.missing_info))}${section('Blocker / approval needed', esc(obj.blocker))}${section('Waiting on', esc(obj.waiting_on))}
        ${obj.next_action ? `<div class="next-action"><b>Next small action</b><br>${esc(obj.next_action)}</div>` : ''}
        ${section('Linked agent', obj.agent_id ? `<a href="#" data-open="agent:${obj.agent_id}">${esc(agent(obj.agent_id)?.name || obj.agent_id)}</a>` : '')}
        ${section('Source', esc(obj.source))}`;
    } else if (type === 'home') {
      body = `${chip('Active: ' + obj.active, obj.active === 'active' ? 'ok' : obj.active === 'inactive' ? 'gray' : 'amber')} ${chip(obj.kind, 'gray')} ${obj.pilot ? chip('★ Pilot home', 'amber') : ''}
        ${section('MCH Job ID', obj.job_id ? `<code>${esc(obj.job_id)}</code> · <a href="http://db.mcvaugh.com/buildconnect/NewStuff/budgetform.html?ID=${esc(obj.job_id)}" target="_blank" rel="noopener">budget form</a> · <a href="http://db.mcvaugh.com/buildconnect/NewStuff/wotracking.html?archive=0&perfID=${esc(obj.job_id)}&subconid=0&filterchange=1" target="_blank" rel="noopener">work orders</a> (live McVaugh database; needs your login)` : '—')}
        ${w ? `<h4>Status</h4><div class="milestones">${[['unknown', 'Unknown'], ['active', 'Active'], ['inactive', 'Inactive']].map(([k, l]) => `<button class="${obj.active === k ? 'on' : ''}" data-set="active:${k}">${l}</button>`).join('')}<button class="${obj.pilot ? 'on' : ''}" data-toggle="pilot">★ Pilot</button></div>` : ''}
        ${section('Stage', esc(obj.stage))}${section('Current activity', runtimeChip(obj.runtime))}${section('Notes', esc(obj.notes))}
        ${section('Source', esc(obj.source) + (obj.imported_at ? ' · imported ' + fmt(obj.imported_at) : ''))}${manualActivity}`;
    } else if (type === 'decision') {
      body = `${chip(obj.status, obj.status === 'approved' ? 'ok' : 'amber')} <b>${esc(obj.date)}</b><p>${esc(obj.reason)}</p>${section('Decided by', esc(obj.decided_by))}${section('Source', esc(obj.source))}
        ${w && obj.status === 'proposed' ? `<div class="actions"><button class="small primary" data-set="status:approved">Approve this decision</button></div>` : ''}`;
    } else if (type === 'integration') {
      body = `${chip(obj.kind, 'gray')} ${chip(obj.status, obj.status === 'connected' ? 'ok' : obj.status === 'failing' ? 'red' : 'gray')}<p>${esc(obj.notes)}</p>${section('Last checked', fmt(obj.last_checked) + (obj.last_message ? ' — ' + esc(obj.last_message) : ''))}${section('Last import', fmt(obj.last_import_at))}${section('Config', obj.config ? `<code>${esc(obj.config)}</code>` : '')}`;
    } else if (type === 'ai') {
      body = `<p>${esc(obj.purpose)}</p>${section('Needs AI', esc(obj.needs_ai))}${section('Provider / model', esc(obj.provider) + ' ' + esc(obj.model))}${section('Why', esc(obj.why))}${section('Expected cost', esc(obj.expected_cost))}${section('Approval', esc(obj.approval))}${section('Eval examples', esc(obj.eval_examples))}${section('Fallback', esc(obj.fallback))}`;
    }
    const title = obj.name || obj.title || obj.address || obj.purpose || id;
    $('#detail').innerHTML = `<header><div><div class="kind">${esc(type)}</div><h2>${esc(title)}</h2></div><div><button class="small ghost" id="closeDetail" aria-label="Close">✕</button></div></header>
      ${body}
      <h4>Activity history</h4>${history}
      <div class="actions">${w && FIELDS[type] ? `<button class="small" id="editBtn">Edit</button>` : ''}${w && ['person', 'task', 'agent', 'home', 'decision'].includes(type) ? `<button class="small danger" id="delBtn">Delete</button>` : ''}${type === 'department' ? `<button class="small" id="focusBtn">Focus in world</button>` : ''}</div>`;
    $('#detail').hidden = false;
    $('#closeDetail').onclick = () => { $('#detail').hidden = true; selected = null; };
    $('#editBtn')?.addEventListener('click', () => editEntity(type, obj));
    $('#focusBtn')?.addEventListener('click', () => { showView('world'); World.focus(id); });
    $('#delBtn')?.addEventListener('click', async () => { if (!confirm('Delete this record?')) return; await api('DELETE', `/api/${TABLE[type]}/${id}`); selected = null; $('#detail').hidden = true; toast('Deleted'); refresh(); });
    $('#detail').querySelectorAll('[data-set]').forEach(b => b.onclick = async () => { const [k, v] = b.dataset.set.split(':'); await save(TABLE[type], { id, [k]: v }); });
    $('#detail').querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => { const k = b.dataset.toggle; await save(TABLE[type], { id, [k]: obj[k] ? 0 : 1 }); });
    $('#detail').querySelectorAll('[data-ev]').forEach(b => b.onclick = async () => { const label = prompt('What happened? (short label)', ''); if (label === null) return; await api('POST', '/api/events', { entity_type: type, entity_id: id, kind: 'run', status: b.dataset.ev, label }); toast('Recorded (manual)'); refresh(); });
    if (focusWorld && type === 'department' && !$('#viewWorld').hidden) World.focus(id);
  }

  // ---------- views & global events ----------
  function showView(v) {
    document.querySelectorAll('.views button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    for (const [k, el] of Object.entries({ world: '#viewWorld', board: '#viewBoard', registry: '#viewRegistry', integrations: '#viewIntegrations', ai: '#viewAi', history: '#viewHistory' })) $(el).hidden = k !== v;
    if (v === 'world') World.overview();
    localStorage.setItem('mow_view', v);
  }
  document.querySelectorAll('.views button').forEach(b => b.onclick = () => showView(b.dataset.view));
  document.addEventListener('click', e => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); const [t, ...rest] = a.dataset.open.split(':'); openDetail(t, rest.join(':'), false); } });
  $('#overviewBtn').onclick = () => World.overview();
  $('#zoomIn').onclick = () => World.zoom(1 / 1.3);
  $('#zoomOut').onclick = () => World.zoom(1.3);
  $('#focusSelect').onchange = e => { if (e.target.value) World.focus(e.target.value); };
  $('#demoToggle').onchange = async e => { if (e.target.checked && !confirm('Turn on DEMO mode? Simulated activity will be shown with a DEMO tag and deleted when demo is turned off.')) { e.target.checked = false; return; } await api('POST', '/api/demo', { on: e.target.checked }); refresh(); };
  $('#motionToggle').checked = localStorage.getItem('mow_motion') === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const applyMotion = () => { document.body.classList.toggle('reduce-motion', $('#motionToggle').checked); localStorage.setItem('mow_motion', $('#motionToggle').checked ? 'reduce' : 'full'); };
  $('#motionToggle').onchange = applyMotion; applyMotion();
  window.addEventListener('resize', () => { if (S && !$('#viewWorld').hidden) World.overview(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').hidden = true; if (!$('#detail').hidden) { $('#detail').hidden = true; selected = null; } } });

  World.init($('#world'), { onSelect: (t, id) => openDetail(t, id, false) });
  refresh(false).then(() => { showView(localStorage.getItem('mow_view') || 'world'); }).catch(() => {});
  pollTimer = setInterval(() => { if (S && $('#modal').hidden) refresh().catch(() => {}); }, 5000);
})();
