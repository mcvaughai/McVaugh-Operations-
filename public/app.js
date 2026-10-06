// McVaugh Operations World — UI. All state comes from /api/state; all writes go through the server.
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = ts => ts ? new Date(ts).toLocaleString() : '—';
  const STAGES = ['gather', 'map', 'simplify', 'choose', 'pilot', 'expand'];
  const DEFAULT_H = { trigger: 1, when: 1, inputs: 1, input: 1, steps: 1, procedure: 1, process: 1, 'how to': 1, owner: 1, responsible: 1, backup: 1, deadline: 1, due: 1, evidence: 1, 'completion evidence': 1, 'done when': 1, approval: 1, 'approval rules': 1, approvals: 1, automation: 1, verification: 1, source: 1, links: 1, 'missing information': 1, missing: 1, 'open questions': 1, blocker: 1, blockers: 1, 'next action': 1, next: 1, 'next steps': 1 };
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
    renderStartHere(); World.render(S); renderLegend(); renderBoard(); renderReview(); renderRegistry(); renderIntegrations(); renderAi(); renderHistory();
    const fs = $('#focusSelect'); const cur = fs.value;
    fs.innerHTML = '<option value="">Focus department…</option>' + S.departments.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('') + '<option value="neighborhood">Active jobs</option><option value="snapshot">Job list snapshot</option>';
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


  // ---------- Review queue: one person or task at a time ----------
  let reviewIdx = 0, reviewDupes = {};
  function reviewQueue() {
    const people = S.people.filter(p => p.review_status !== 'verified').map(p => ({ type: 'person', obj: p }));
    const tasks = S.tasks.filter(t => t.proposed && !t.restricted).map(t => ({ type: 'task', obj: t }));
    return [...people, ...tasks];
  }
  function renderReview() {
    const q = reviewQueue();
    $('#reviewCount').textContent = q.length || '';
    $('#reviewCount').hidden = !q.length;
    const v = $('#viewReview');
    if (!q.length) { v.innerHTML = `<div class="section"><h2>Review</h2><p class="empty">Nothing waiting for review. Every person is verified and no task is marked PROPOSED.</p></div>`; return; }
    if (reviewIdx >= q.length) reviewIdx = 0;
    const item = q[reviewIdx], o = item.obj, w = S.permissions.write;
    const nav = `<div class="actions" style="align-items:center"><button class="small" id="rvPrev">‹ Previous</button><span class="src">${reviewIdx + 1} of ${q.length} (${q.filter(i => i.type === 'person').length} people, ${q.filter(i => i.type === 'task').length} tasks)</span><button class="small" id="rvNext">Next ›</button><span class="hint">Verify one at a time; nothing changes until you click.</span></div>`;
    let body = '';
    if (item.type === 'person') {
      const owned = S.tasks.filter(t => t.owner_id === o.id), backup = S.tasks.filter(t => t.backup_id === o.id), imported = owned.filter(t => /import/i.test(t.source || ''));
      body = `<div class="card"><div class="kind">Person · responsibility review</div><h2>${esc(o.name)}</h2><p>${esc(o.role_summary || '')}</p>
        ${o.confirmed ? chip('Confirmed in handoff', 'ok') : chip('Not confirmed — came from an import', 'amber')} ${chip('Review: ' + o.review_status.replace('_', ' '), o.review_status === 'under_review' ? 'amber' : 'gray')}
        <div class="src">Source: ${esc(o.source || '')}</div>
        <h4>Departments</h4>${o.departments.map(deptName).map(esc).join(', ') || '<span class="empty">none</span>'}
        <h4>Tasks owned (${owned.length})${imported.length ? ` · ${imported.length} from imports` : ''}</h4>${owned.map(t => `<div class="card-t ${t.proposed ? 'proposed' : t.verified ? 'verified' : ''}" data-open="task:${t.id}">${esc(t.title)}<small>${esc(t.source || '')}</small></div>`).join('') || '<p class="empty">No tasks yet. If this person has responsibilities, add them or import the old dashboard.</p>'}
        ${backup.length ? `<h4>Backup for (${backup.length})</h4>${backup.map(t => `<div class="card-t" data-open="task:${t.id}">${esc(t.title)}</div>`).join('')}` : ''}
        <h4>Question for Brittany</h4><p>Is the summary above correct and complete for ${esc(o.name)}? If yes, mark <b>Verified</b>. If some of it needs checking with ${esc(o.name)} first, mark <b>Under review</b> and say what in the note.</p>
        ${w ? `<label class="field"><span>Review note (optional, saved with the decision)</span><textarea id="rvNote">${esc(o.notes || '')}</textarea></label>
        <div class="actions"><button class="primary" data-rv="person:verified">✓ Verified — responsibilities are right</button><button data-rv="person:under_review">Under review — need to check</button><button class="small" id="rvEdit">Edit details</button></div>` : ''}</div>`;
    } else {
      const dupes = reviewDupes[o.id];
      if (!dupes) { api('POST', '/api/review/duplicates', { id: o.id }).then(d => { reviewDupes[o.id] = d; renderReview(); }).catch(() => { reviewDupes[o.id] = []; }); }
      const field = (l, v) => v ? `<h4>${l}</h4><div>${esc(v)}</div>` : '';
      body = `<div class="card"><div class="kind">Task / procedure · ${esc(o.source || '')}</div><h2>${esc(o.title)}</h2>
        ${chip('PROPOSED', 'amber')} ${chip(deptName(o.department_id), 'gray')} ${o.documented ? chip('documented', 'blue') : ''}
        <h4>Owner / backup</h4>${esc(personName(o.owner_id))} / ${esc(o.backup_id ? personName(o.backup_id) : '—')}
        ${field('Trigger', o.trigger)}${field('Inputs', o.inputs)}${field('Steps', o.steps)}${field('Deadline', o.deadline)}${field('Completion evidence', o.evidence)}${field('Approval rules', o.approval_rules)}${field('Missing information', o.missing_info)}
        <h4>Possible duplicates</h4>${dupes === undefined ? '<p class="src">checking…</p>' : dupes.length ? dupes.map(d => `<div class="card-t ${d.proposed ? 'proposed' : ''}" style="display:flex;justify-content:space-between;align-items:center"><span data-open="task:${d.id}">${esc(d.title)} <small>${esc(personName(d.owner_id))} · match ${Math.round(d.score * 100)}%</small></span>${w ? `<button class="small" data-merge="${d.id}">Merge into this one</button>` : ''}</div>`).join('') : '<p class="empty">No similar task found.</p>'}
        <h4>Question for Brittany</h4><p>Is this a real procedure McVaugh follows (or should follow), with the right owner? <b>Verify</b> keeps it as a reviewed task. <b>Reject</b> archives it (history is kept). <b>Merge</b> folds it into an existing task.</p>
        ${w ? `<label class="field"><span>Review note (optional)</span><textarea id="rvNote">${esc(o.review_note || '')}</textarea></label>
        <div class="actions"><button class="primary" data-rv="task:verify">✓ Verify — real procedure, owner correct</button><button data-rv="task:reject">Reject / archive</button><button class="small" id="rvEdit">Edit details first</button></div>` : ''}</div>`;
    }
    v.innerHTML = `<div class="section"><h2>Review queue</h2>${nav}${body}</div>`;
    $('#rvPrev').onclick = () => { reviewIdx = (reviewIdx - 1 + q.length) % q.length; renderReview(); };
    $('#rvNext').onclick = () => { reviewIdx = (reviewIdx + 1) % q.length; renderReview(); };
    $('#rvEdit')?.addEventListener('click', () => editEntity(item.type, o));
    v.querySelectorAll('[data-rv]').forEach(b => b.onclick = async () => {
      const [, action] = b.dataset.rv.split(':'); const note = $('#rvNote')?.value || '';
      if (item.type === 'person') await save('people', { id: o.id, review_status: action, notes: note });
      else if (action === 'verify') await save('tasks', { id: o.id, proposed: 0, review_note: note });
      else if (action === 'reject') { if (!confirm('Archive this task? It leaves the board; history is kept.')) return; await save('tasks', { id: o.id, archived: 1, review_note: note }); }
    });
    v.querySelectorAll('[data-merge]').forEach(b => b.onclick = async () => { if (!confirm('Merge this proposed task into the selected existing task? Empty fields on the existing task are filled from this one; this one is archived.')) return; await api('POST', '/api/review/merge', { source_id: o.id, target_id: b.dataset.merge }); toast('Merged'); refresh(); });
  }

  function renderRegistry() {
    const rows = (items, cols, type) => `<table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${items.map(i => `<tr class="clickable" data-open="${type}:${i.id}">${cols.map(c => `<td>${c[1](i)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $('#viewRegistry').innerHTML = `<div class="table-wrap">
      <h2>People (${S.people.length})</h2>${rows(S.people, [['Name', p => esc(p.full_name || p.name) + (p.title ? `<br><span class="src">${esc(p.title)}</span>` : '')], ['Reports to', p => esc(p.reports_to ? personName(p.reports_to) : '—')], ['Responsibilities', p => esc(p.role_summary)], ['Departments', p => p.departments.map(deptName).map(esc).join(', ')], ['Confirmed', p => p.confirmed ? chip('confirmed', 'ok') : chip('unconfirmed', 'amber')], ['Review', p => chip(p.review_status.replace('_', ' '), p.review_status === 'verified' ? 'ok' : p.review_status === 'under_review' ? 'amber' : 'gray')], ['Activity', p => runtimeChip(p.runtime)]], 'person')}
      <h2 style="margin-top:18px">Agents (${S.agents.length}) — proposed functions</h2>${rows(S.agents, [['Agent', a => esc(a.name)], ['Department', a => esc(deptName(a.department_id))], ['Approach', a => chip(a.approach, a.approach === 'rules' ? 'ok' : a.approach === 'ai' ? 'purple' : 'gray') + ' <span class="src">' + esc(a.approach_note || '') + '</span>'], ['Setup', a => setupChip(a.setup_stage)], ['Activity', a => runtimeChip(a.runtime)]], 'agent')}
      <h2 style="margin-top:18px">Tasks & procedures (${S.tasks.length})</h2>${rows(S.tasks, [['Title', t => esc(t.title) + (t.proposed ? ' ' + chip('PROPOSED', 'amber') : '')], ['Owner', t => esc(personName(t.owner_id))], ['Dept', t => esc(dept(t.department_id)?.short || '—')], ['Board', t => esc(BOARD[t.board])], ['Milestones', t => (t.documented ? chip('documented', 'blue') : '') + (t.automated ? chip('automated', 'blue') : '') + (t.verified ? chip('verified', 'ok') : '')], ['Source', t => `<span class="src">${esc(t.source || '')}</span>`]], 'task')}
      <h2 style="margin-top:18px">Departments</h2>${rows(S.departments, [['Department', d => esc(d.name)], ['Setup', d => setupChip(d.setup_stage)], ['People', d => S.people.filter(p => p.departments.includes(d.id)).map(p => esc(p.name)).join(', ') || '—'], ['Agents', d => S.agents.filter(a => a.department_id === d.id).length]], 'department')}
      <h2 style="margin-top:18px">Homes / jobs (${S.homes.length})</h2>${rows(S.homes, [['Address', h => esc(h.address)], ['Job ID', h => esc(h.job_id)], ['Kind', h => esc(h.kind)], ['Active', h => chip(h.active, h.active === 'active' ? 'ok' : h.active === 'inactive' ? 'gray' : 'amber')], ['Pilot', h => h.pilot ? '★' : ''], ['Source', h => `<span class="src">${esc(h.source || '')} ${h.imported_at ? fmt(h.imported_at) : ''}</span>`]], 'home')}
      <h2 style="margin-top:18px">Documents (${S.documents.length})</h2><p class="src">Imported vault files that are not procedures (and the source file of each procedure). Financial documents are restricted to accounting/admin.</p>${rows(S.documents, [['Title', d => esc(d.title)], ['Kind', d => chip(d.kind, d.kind === 'procedure' ? 'ok' : d.kind === 'financial' ? 'red' : 'gray')], ['Linked task', d => d.task_id ? `<a href="#" data-open="task:${d.task_id}">${esc(S.tasks.find(t => t.id === d.task_id)?.title || d.task_id)}</a>` : '—'], ['Summary', d => `<span class="src">${esc(d.summary || '')}</span>`], ['Source', d => `<span class="src">${esc(d.source || '')}</span>`]], 'document')}
      <h2 style="margin-top:18px">Decisions (${S.decisions.length})</h2>${rows(S.decisions, [['Date', d => esc(d.date)], ['Decision', d => esc(d.title)], ['Status', d => chip(d.status, d.status === 'approved' ? 'ok' : 'amber')], ['By', d => esc(d.decided_by)], ['Reason', d => esc(d.reason)]], 'decision')}
    </div>`;
  }

  function renderIntegrations() {
    const w = S.permissions.write;
    if ($('#obsFiles')?.files.length || $('#csvFile')?.files.length || $('#restoreFile')?.files.length || $('#folderReport')?.innerHTML || (document.activeElement && $('#viewIntegrations').contains(document.activeElement))) return; // don't wipe a chosen file, a report, or a field being typed in during polling
    $('#viewIntegrations').innerHTML = `<div class="section">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><h2 style="margin:0">Integrations</h2>${w ? '<button class="small" id="checkInt">Check connections</button>' : ''}<span class="hint">Snapshot imports are never shown as live connections.</span></div>
      <div class="grid-2">${S.integrations.map(i => `<div class="card int-card" data-open="integration:${i.id}"><div class="dot ${i.status}"></div><div><b>${esc(i.name)}</b> ${chip(i.kind, 'gray')} ${chip(i.status, i.status === 'connected' ? 'ok' : i.status === 'failing' ? 'red' : 'gray')}<br><span class="src">${esc(i.notes || '')}</span><br><span class="src">Checked: ${fmt(i.last_checked)}${i.last_import_at ? ' · last import ' + fmt(i.last_import_at) : ''}${i.last_message ? ' · ' + esc(i.last_message) : ''}</span></div></div>`).join('')}</div>
      <h2 style="margin-top:20px">Import (snapshot)</h2>
      <div class="card" style="margin-bottom:12px"><h3>Option 3 — bulk-import a folder on this computer</h3>
        <p class="src">Point the app at a folder on the machine running the server (e.g. your Obsidian vault on L:). Every <code>.md</code> and <code>.csv</code> inside is imported; re-running skips files whose contents haven't changed. <b>Preview</b> shows how headings and columns map before anything is written.</p>
        <div style="display:flex;gap:8px;align-items:center"><input id="folderPath" placeholder="L:\\AI Tools Shared\\Obsidian\\McVaugh" value="${esc(S.import_dir || '')}" ${S.permissions.sensitive ? '' : 'disabled'}><select id="folderCsvTarget" style="width:auto"><option value="auto">CSV: detect from headers</option><option value="dashboard">CSV: old dashboard</option><option value="schedule">CSV: schedule</option><option value="selections">CSV: selections</option><option value="tasks">CSV: tasks</option></select><button class="small" id="folderPreview" ${S.permissions.sensitive ? '' : 'disabled'}>Preview (dry run)</button><button class="small primary" id="folderImport" ${S.permissions.sensitive ? '' : 'disabled'}>Import changed files</button><label class="toggle"><input type="checkbox" id="folderForce"> force re-import</label></div>
        ${S.permissions.sensitive ? '' : '<p class="src">Admin or accounting role required (reads the server filesystem).</p>'}
        <div id="folderReport"></div>
        ${S.import_files.length ? `<h4>Imported files (${S.import_files.length})</h4><div style="max-height:180px;overflow:auto"><table><thead><tr><th>File</th><th>Kind</th><th>Status</th><th>Imported</th></tr></thead><tbody>${S.import_files.map(f => `<tr><td class="src">${esc(f.path)}</td><td>${esc(f.kind)}</td><td>${esc(f.status)}</td><td>${fmt(f.imported_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>
      <div class="grid-2">
        <div class="card"><h3>Option 1 — Obsidian notes (.md) from this browser</h3><p class="src">Headings like <code>## Trigger</code>, <code>## Inputs</code>, <code>## Steps</code>, <code>## Owner</code>, <code>## Approval rules</code> map to task fields. Frontmatter <code>owner:</code>, <code>department:</code>, <code>status: approved</code> are honored. Re-importing a note refreshes its content but never undoes a review decision.</p><input type="file" id="obsFiles" multiple accept=".md,.markdown,.txt" ${w ? '' : 'disabled'}><div class="actions"><button class="small" id="obsPreview" ${w ? '' : 'disabled'}>Preview mapping</button><button class="small primary" id="obsImport" ${w ? '' : 'disabled'}>Import notes</button></div><div id="obsReport"></div></div>
        <div class="card"><h3>Option 2 — CSV (old dashboard / Excel saved as CSV)</h3><p class="src">Dashboard columns: person, responsibility, department. Schedule: address, stage. Selections/tasks: title, owner, deadline. Headers are matched by alias; unmatched columns are listed in the preview.</p><select id="csvTarget"><option value="auto">Detect from headers</option><option value="dashboard">Old people/responsibilities dashboard</option><option value="schedule">Excel schedule (homes & stages)</option><option value="selections">Excel selection guide</option><option value="tasks">Generic task list</option></select><input type="file" id="csvFile" accept=".csv,.txt" ${w ? '' : 'disabled'}><div class="actions"><button class="small" id="csvPreview" ${w ? '' : 'disabled'}>Preview mapping</button><button class="small primary" id="csvImport" ${w ? '' : 'disabled'}>Import CSV</button></div><div id="csvReport"></div></div>
      </div>
      <details style="margin-top:12px"><summary class="src">Mapping aliases (extend when a real file uses different headings or column names)</summary>
        <div class="grid-2" style="margin-top:8px"><label class="field"><span>Extra heading → field (JSON, e.g. {"what triggers it": "trigger"})</span><textarea id="aliasHeadings">${esc(JSON.stringify(Object.fromEntries(Object.entries(S.mapping.headings).filter(([k]) => !(k in DEFAULT_H))) , null, 1))}</textarea></label>
        <label class="field"><span>Extra column aliases (JSON, e.g. {"person": ["staff member"]})</span><textarea id="aliasCols">{}</textarea></label>
        <label class="field"><span>Topic hub → department (JSON; current: ${esc(JSON.stringify(S.mapping.hubs || {}))})</span><textarea id="aliasHubs">{}</textarea></label></div>
        <p class="src">Fields: ${Object.keys(S.mapping.aliases).join(', ')}. Built-in headings: ${Object.keys(S.mapping.headings).slice(0, 40).join(', ')}…</p>
        ${w ? '<button class="small" id="aliasSave">Save aliases</button>' : ''}</details>
      <h2 style="margin-top:20px">Export / recovery</h2>
      <div class="actions">${S.permissions.sensitive ? '<a class="small" href="/api/export" download><button class="small">Download full backup (JSON)</button></a>' : ''}<a href="/api/export/pages" target="_blank"><button class="small">Handbook export for ChatGPT Pages (Markdown)</button></a>${w ? '<button class="small" id="pagesMark">Mark "pasted into Pages"</button>' : ''}${S.role === 'admin' ? '<input type="file" id="restoreFile" accept=".json" style="width:auto"><button class="small danger" id="restoreBtn">Restore backup (replaces everything)</button>' : ''}</div>
      <p class="src">Canonical store: <code>${esc(S.server.db_path || 'data/mcvaugh-world.sqlite (path visible to admin)')}</code>. Back up by copying that file or downloading the JSON. n8n webhook: <code>POST /api/webhooks/n8n</code> with header <code>X-MOW-Secret</code> — secret ${S.server.n8n_secret_set ? 'is set' : 'NOT set (MOW_N8N_SECRET)'}.</p>
      <p class="src">Not accessible from this build environment (nothing was inspected): <code>C:\\Users\\bmcvaugh\\Documents</code>, <code>L:\\AI Tools Shared</code>, <code>C:\\Users\\bmcvaugh\\Documents\\MCH-DB</code>, the old dashboard, Obsidian vault, BuildConnect 2.0.</p>
    </div>`;
    $('#checkInt')?.addEventListener('click', async () => { await api('POST', '/api/integrations/check'); toast('Checked'); refresh(); });
    const reportFiles = files => files.map(f => `<div class="card-t"><b>${esc(f.name)}</b> ${f.kind === 'md' ? `→ task <code>${esc(f.row.id)}</code> "${esc(f.row.title)}"<small>mapped: ${esc(f.mapping.mapped.join('; ') || 'none')}</small>${f.mapping.unmapped.length ? `<small>unmapped headings: ${esc(f.mapping.unmapped.join(', '))}</small>` : ''}` : `→ ${esc(f.mapping.target || 'UNKNOWN layout')} (${f.rows} rows)<small>columns: ${esc(Object.entries(f.mapping.columns).map(([k, v]) => `${k}=${v || '—'}`).join(', '))}</small>${f.mapping.unmapped.length ? `<small>unmapped columns: ${esc(f.mapping.unmapped.join(', '))}</small>` : ''}`}${(f.warnings || []).map(x => `<small class="error">${esc(x)}</small>`).join('')}</div>`).join('');
    const readFiles = input => Promise.all([...input.files].map(async f => ({ name: f.name, content: await f.text() })));
    $('#obsPreview')?.addEventListener('click', async () => { const files = await readFiles($('#obsFiles')); if (!files.length) return toast('Choose .md files first'); const r = await api('POST', '/api/import/preview', { files }); $('#obsReport').innerHTML = reportFiles(r.files); });
    $('#csvPreview')?.addEventListener('click', async () => { const files = await readFiles($('#csvFile')); if (!files.length) return toast('Choose a CSV first'); const r = await api('POST', '/api/import/preview', { files, target: $('#csvTarget').value }); $('#csvReport').innerHTML = reportFiles(r.files) + (r.files[0]?.records?.length ? `<small>Sample: ${esc(JSON.stringify(r.files[0].records.slice(0, 2)))}</small>` : ''); });
    const KINDS = ['procedure', 'org_chart', 'reference', 'dashboard', 'plan', 'legal', 'script', 'financial', 'other'];
    const kindSel = (path, kind) => `<select class="kind-override" data-path="${esc(path)}" style="width:auto;padding:2px 6px;font-size:11px">${KINDS.map(k => `<option value="${k}" ${k === kind ? 'selected' : ''}>${k === 'procedure' ? 'procedure → task' : k + ' → document'}</option>`).join('')}</select>`;
    const folderReport = r => `<p>${r.dry_run ? 'Dry run — nothing written.' : 'Imported.'} Scanned ${r.scanned}, ${r.dry_run ? 'would import' : 'imported'} ${r.dry_run ? r.files.filter(f => f.changed).length : r.imported}, unchanged ${r.skipped_unchanged}${r.errors.length ? `, errors ${r.errors.length}` : ''}.${r.kinds ? ' By kind: ' + Object.entries(r.kinds).map(([k, n]) => `${k} ${n}`).join(', ') + '.' : ''}</p><p class="src">Only <b>procedure</b> files become tasks; everything else is kept as a linked document. Change a file's kind below, then Preview again or Import.</p>${r.errors.map(e => `<div class="error">${esc(e)}</div>`).join('')}<div style="max-height:360px;overflow:auto">${r.files.filter(f => f.status !== 'unchanged').map(f => `<div class="card-t ${f.preview?.sensitive ? 'restricted' : ''}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(f.path)}</b>${f.kind === 'md' && f.preview ? kindSel(f.path, f.preview.kind) : ''}</div><small>${esc(f.status)}${f.preview?.kind_reason ? ' · ' + esc(f.preview.kind_reason) : ''}${f.preview?.sensitive ? ' · RESTRICTED (financial)' : ''}</small>${f.preview?.linked ? `<small>index card → <code>${esc(f.preview.linked.file || '?')}</code> · ${esc(String(f.preview.linked.status).replace('_', ' '))}${f.preview.linked.chars ? ` · ${f.preview.linked.chars} chars extracted` : ''}</small>` : ''}${f.preview ? (f.kind === 'md' ? (f.preview.kind === 'procedure' ? `<small>→ task "${esc(f.preview.title)}" · mapped: ${esc(f.preview.mapping.mapped.join('; ') || 'none')}${f.preview.mapping.unmapped.length ? ' · unmapped: ' + esc(f.preview.mapping.unmapped.join(', ')) : ''}</small>` : `<small>→ document "${esc(f.preview.title)}"</small>`) : `<small>→ ${esc(f.preview.target || 'UNKNOWN layout')} (${f.preview.rows} rows) · columns: ${esc(Object.entries(f.preview.mapping.columns).map(([k, v]) => `${k}=${v || '—'}`).join(', '))}${f.preview.mapping.unmapped.length ? ' · unmapped: ' + esc(f.preview.mapping.unmapped.join(', ')) : ''}</small>`) + (f.preview.warnings || []).map(x => `<small class="error">${esc(x)}</small>`).join('') : ''}</div>`).join('')}</div>`;
    const overrides = () => Object.fromEntries([...document.querySelectorAll('.kind-override')].map(e => [e.dataset.path, e.value]));
    $('#folderPreview')?.addEventListener('click', async () => { const r = await api('POST', '/api/import/preview', { dir: $('#folderPath').value, target: $('#folderCsvTarget').value, force: $('#folderForce').checked, overrides: overrides() }); $('#folderReport').innerHTML = r.error ? `<p class="error">${esc(r.error)}</p>` : folderReport(r); });
    $('#folderImport')?.addEventListener('click', async () => { const dir = $('#folderPath').value; if (!dir) return toast('Enter a folder path'); if (!confirm(`Import every changed .md/.csv under ${dir}?`)) return; const r = await api('POST', '/api/import/folder', { dir, target: $('#folderCsvTarget').value, force: $('#folderForce').checked, overrides: overrides() }); toast(`Imported ${r.imported}, unchanged ${r.skipped_unchanged}`); $('#folderReport').innerHTML = folderReport(r); setTimeout(refresh, 300); });
    $('#aliasSave')?.addEventListener('click', async () => { try { await api('POST', '/api/import/aliases', { headings: JSON.parse($('#aliasHeadings').value || '{}'), aliases: JSON.parse($('#aliasCols').value || '{}'), hubs: JSON.parse($('#aliasHubs').value || '{}') }); toast('Aliases saved'); refresh(); } catch (e) { toast('Invalid JSON: ' + e.message); } });
    $('#obsImport')?.addEventListener('click', async () => { const files = [...$('#obsFiles').files]; if (!files.length) return toast('Choose .md files first'); const payload = await Promise.all(files.map(async f => ({ name: f.name, content: await f.text() }))); const r = await api('POST', '/api/import/obsidian', { files: payload }); toast(`Imported ${r.imported} notes`); refresh(); });
    $('#csvImport')?.addEventListener('click', async () => { const f = $('#csvFile').files[0]; if (!f) return toast('Choose a CSV first'); const r = await api('POST', '/api/import/csv', { target: $('#csvTarget').value, filename: f.name, content: await f.text() }); toast(`Imported ${r.imported} of ${r.rows} rows as ${r.target}`); $('#csvReport').innerHTML = (r.warnings || []).map(x => `<small class="error">${esc(x)}</small>`).join(''); setTimeout(refresh, 300); });
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
  function entityName(type, id) { return ({ person: () => personName(id), agent: () => agent(id)?.name, department: () => deptName(id), home: () => S.homes.find(h => h.id === id)?.address, task: () => S.tasks.find(t => t.id === id)?.title, document: () => S.documents.find(d => d.id === id)?.title, integration: () => S.integrations.find(i => i.id === id)?.name }[type] || (() => id))() || id; }

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
    person: () => [{ key: 'name', label: 'Name (short)' }, { key: 'full_name', label: 'Full name' }, { key: 'title', label: 'Title (org chart)' }, { key: 'reports_to', label: 'Reports to', type: 'select', options: peopleOpts() }, { key: 'email', label: 'Email' }, { key: 'role_summary', label: 'Responsibilities (summary)', type: 'textarea' }, { key: 'departments', label: 'Departments', type: 'multiselect', options: S.departments.map(d => [d.id, d.name]) }, { key: 'confirmed', label: 'Confirmed by Brittany/Jim', type: 'checkbox' }, { key: 'review_status', label: 'Responsibility review', type: 'select', options: [['not_reviewed', 'Not reviewed'], ['under_review', 'Under review'], ['verified', 'Verified']] }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'source', label: 'Source' }],
    task: () => [{ key: 'title', label: 'Title' }, { key: 'department_id', label: 'Department', type: 'select', options: deptOpts() }, { key: 'owner_id', label: 'Owner', type: 'select', options: peopleOpts() }, { key: 'backup_id', label: 'Backup', type: 'select', options: peopleOpts() }, { key: 'agent_id', label: 'Linked agent', type: 'select', options: [['', '— none —'], ...S.agents.map(a => [a.id, a.name])] }, { key: 'board', label: 'Board column', type: 'select', options: Object.entries(BOARD) }, { key: 'project_stage', label: 'Project stage (implementation tasks)', type: 'select', options: [['', '—'], ...STAGES.map(s => [s, s])] }, { key: 'trigger', label: 'Trigger' }, { key: 'inputs', label: 'Inputs', type: 'textarea' }, { key: 'steps', label: 'Steps', type: 'textarea' }, { key: 'deadline', label: 'Deadline' }, { key: 'evidence', label: 'Completion evidence' }, { key: 'approval_rules', label: 'Approval rules', type: 'textarea' }, { key: 'automation_approach', label: 'Automation approach', type: 'textarea' }, { key: 'verification_result', label: 'Verification result' }, { key: 'source_link', label: 'Source-system link' }, { key: 'missing_info', label: 'Missing information', type: 'textarea' }, { key: 'blocker', label: 'Blocker / approval needed' }, { key: 'waiting_on', label: 'Waiting on (who)' }, { key: 'next_action', label: 'Next small action' }, { key: 'proposed', label: 'Proposed (not yet verified with the team)', type: 'checkbox' }, { key: 'review_note', label: 'Review note', type: 'textarea' }, { key: 'archived', label: 'Archived (hidden from board; history kept)', type: 'checkbox' }, ...(S.permissions.sensitive ? [{ key: 'sensitive', label: 'Sensitive (cash/accounting — restricted roles only)', type: 'checkbox' }] : []), { key: 'source', label: 'Source' }],
    agent: () => [{ key: 'name', label: 'Agent name' }, { key: 'department_id', label: 'Department', type: 'select', options: deptOpts() }, { key: 'purpose', label: 'Purpose', type: 'textarea' }, { key: 'initial_output', label: 'Initial output (read/flag/draft)' }, { key: 'human_authority', label: 'Human authority retained' }, { key: 'approach', label: 'Approach', type: 'select', options: [['rules', 'Ordinary rules are sufficient'], ['ai', 'AI model needed'], ['hybrid', 'Hybrid: rules + model drafting'], ['undecided', 'Undecided']] }, { key: 'approach_note', label: 'Why', type: 'textarea' }, { key: 'setup_stage', label: 'Setup maturity', type: 'select', options: SETUP_STAGES.map(s => [s, World.SETUP[s].label]) }, { key: 'enabled', label: 'Enabled (does not mean running)', type: 'checkbox' }, { key: 'paused', label: 'Paused', type: 'checkbox' }, { key: 'n8n_workflow_id', label: 'n8n workflow id (maps callbacks to this agent)' }, { key: 'next_run', label: 'Next scheduled run' }, { key: 'proposed', label: 'Proposed placeholder', type: 'checkbox' }],
    home: () => [{ key: 'address', label: 'Address' }, { key: 'job_id', label: 'MCH Job ID' }, { key: 'kind', label: 'Kind', type: 'select', options: [['home', 'Home'], ['lot', 'Lot'], ['hoa', 'HOA entity'], ['office', 'Office'], ['other', 'Other'], ['unknown', 'Unknown']] }, { key: 'active', label: 'Active', type: 'select', options: [['unknown', 'Unknown (not confirmed)'], ['active', 'Active'], ['inactive', 'Inactive / finished']] }, { key: 'stage', label: 'Construction stage' }, { key: 'pilot', label: 'Pilot home', type: 'checkbox' }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'source', label: 'Source' }],
    decision: () => [{ key: 'date', label: 'Date (YYYY-MM-DD)', default: new Date().toISOString().slice(0, 10) }, { key: 'title', label: 'Decision' }, { key: 'reason', label: 'Reason', type: 'textarea' }, { key: 'decided_by', label: 'Decided by' }, { key: 'status', label: 'Status', type: 'select', options: [['approved', 'Approved'], ['proposed', 'Proposed'], ['superseded', 'Superseded']] }, { key: 'source', label: 'Source' }],
    department: () => [{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'setup_stage', label: 'Setup maturity', type: 'select', options: SETUP_STAGES.map(s => [s, World.SETUP[s].label]) }],
    integration: () => [{ key: 'status', label: 'Status (manual override)', type: 'select', options: [['disconnected', 'Disconnected'], ['connected', 'Connected'], ['failing', 'Failing']] }, { key: 'notes', label: 'Notes', type: 'textarea' }, ...(S.permissions.integrationConfig ? [{ key: 'config', label: 'Config (JSON; no secrets — use env vars)', type: 'textarea' }] : [])],
    ai: () => [{ key: 'purpose', label: 'Purpose' }, { key: 'needs_ai', label: 'Needs AI?', type: 'select', options: [['no_rules', 'No — deterministic rules'], ['yes', 'Yes'], ['undecided', 'Undecided']] }, { key: 'provider', label: 'Provider' }, { key: 'model', label: 'Model id (verify availability first)' }, { key: 'why', label: 'Why appropriate', type: 'textarea' }, { key: 'expected_cost', label: 'Expected cost' }, { key: 'approval', label: 'Approval requirement' }, { key: 'eval_examples', label: 'Evaluation examples', type: 'textarea' }, { key: 'fallback', label: 'Fallback' }],
  };
  const TABLE = { document: 'documents', person: 'people', task: 'tasks', agent: 'agents', home: 'homes', decision: 'decisions', department: 'departments', integration: 'integrations', ai: 'ai_configs' };

  function editEntity(type, obj) { modal((obj ? 'Edit ' : 'Add ') + type, FIELDS[type](), obj, async v => { if (obj) v.id = obj.id; await save(TABLE[type], v); }); }
  function checkpointForm() {
    const cp = S.checkpoint || {};
    modal('Save session checkpoint', [{ key: 'stage', label: 'Project stage', type: 'select', options: STAGES.map(s => [s, s]) }, { key: 'current_step', label: 'Current step', type: 'textarea' }, { key: 'last_completed', label: 'Last completed', type: 'textarea' }, { key: 'next_action', label: 'One recommended next action', type: 'textarea' }, { key: 'waiting_on', label: 'Waiting on whom' }, { key: 'decisions_needed', label: 'Decisions needed', type: 'textarea' }, { key: 'note', label: 'Note for future you', type: 'textarea' }], cp, async v => { await api('POST', '/api/checkpoints', v); toast('Checkpoint saved'); refresh(); });
  }
  $('#addBtn').onclick = () => modal('Add', [{ key: 'kind', label: 'What do you want to add?', type: 'select', options: [['task', 'Task / procedure'], ['person', 'Person'], ['agent', 'Agent (proposed function)'], ['home', 'Home / job'], ['decision', 'Decision']] }], {}, async v => setTimeout(() => editEntity(v.kind, null), 0));

  // ---------- detail panel ----------
  function openDetail(type, id, focusWorld = true) {
    const w = S.permissions.write;
    const obj = { document: () => S.documents.find(d => d.id === id), person: () => person(id), agent: () => agent(id), department: () => dept(id), home: () => S.homes.find(h => h.id === id), task: () => S.tasks.find(t => t.id === id), decision: () => S.decisions.find(d => d.id === id), integration: () => S.integrations.find(i => i.id === id), ai: () => S.ai_configs.find(a => a.id === id), system: () => null }[type]?.();
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
      const reports = S.people.filter(p => p.reports_to === obj.id);
      body = `${obj.title ? `<p><b>${esc(obj.full_name || obj.name)}</b> · ${esc(obj.title)}</p>` : ''}<p>${esc(obj.role_summary)}</p>${obj.confirmed ? chip('Confirmed person', 'ok') : chip('Unconfirmed', 'amber')}
        ${section('Reports to', obj.reports_to ? `<a href="#" data-open="person:${obj.reports_to}">${esc(personName(obj.reports_to))}</a>` : (obj.title ? '— (top of chart)' : ''))}${reports.length ? section('Direct reports', reports.map(p => `<a href="#" data-open="person:${p.id}">${esc(p.name)}</a>`).join(', ')) : ''}${S.permissions.sensitive && obj.email ? section('Email', esc(obj.email)) : ''} ${chip('Review: ' + obj.review_status.replace('_', ' '), obj.review_status === 'verified' ? 'ok' : obj.review_status === 'under_review' ? 'amber' : 'gray')}
        ${section('Departments', obj.departments.map(deptName).map(esc).join(', ') || '—')}
        ${w ? `<h4>Responsibility review</h4><div class="milestones">${[['not_reviewed', 'Not reviewed'], ['under_review', 'Under review'], ['verified', 'Verified']].map(([k, l]) => `<button class="${obj.review_status === k ? 'on' : ''}" data-set="review_status:${k}">${l}</button>`).join('')}</div>` : ''}
        ${section('Current activity', runtimeChip(obj.runtime))}
        ${section('Tasks (owner or backup)', taskList(tasksFor))}
        ${section('Notes', esc(obj.notes))}${section('Source', esc(obj.source))}${obj.reviewed_at ? section('Verified', fmt(obj.reviewed_at) + ' by ' + esc(obj.reviewed_by)) : ''}`;
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
        ${section('Verification result', esc(obj.verification_result))}${section('Source-system link / file', obj.source_link ? (/^https?:/.test(obj.source_link) ? `<a href="${esc(obj.source_link)}" target="_blank" rel="noopener">${esc(obj.source_link)}</a>` : `<code>${esc(obj.source_link)}</code>`) : '')}
        ${section('Missing information', esc(obj.missing_info))}${section('Blocker / approval needed', esc(obj.blocker))}${section('Waiting on', esc(obj.waiting_on))}
        ${obj.next_action ? `<div class="next-action"><b>Next small action</b><br>${esc(obj.next_action)}</div>` : ''}
        ${section('Linked agent', obj.agent_id ? `<a href="#" data-open="agent:${obj.agent_id}">${esc(agent(obj.agent_id)?.name || obj.agent_id)}</a>` : '')}
        ${section('Source', esc(obj.source))}${obj.reviewed_at ? section('Reviewed', fmt(obj.reviewed_at) + ' by ' + esc(obj.reviewed_by) + (obj.review_note ? ' — ' + esc(obj.review_note) : '')) : ''}`;
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
    } else if (type === 'document') {
      body = obj.restricted ? `<p class="error">Restricted: financial document. Sign in with an accounting or admin passphrase.</p>` : `${chip(obj.kind, obj.kind === 'procedure' ? 'ok' : obj.kind === 'financial' ? 'red' : 'gray')} ${obj.sensitive ? chip('Restricted', 'red') : ''}<p class="src">${esc(obj.kind_reason || '')}</p>
        ${section('Vault note', esc(obj.path))}${obj.underlying_path ? section('Real file', `<code>${esc(obj.underlying_path)}</code> — ${chip(String(obj.underlying_status || 'not followed').replace('_', ' '), obj.underlying_status === 'extracted' ? 'ok' : obj.underlying_status === 'needs_conversion' ? 'amber' : 'red')}${obj.underlying_status === 'needs_conversion' ? '<div class="src">.doc / .pdf cannot be read by the app. Save it as .docx (Word → Save As) or .html next to the original and re-run the folder import with "force".</div>' : obj.underlying_status === 'not_found' ? '<div class="src">The linked path does not exist relative to the vault on this server. Is the local-server folder mounted at the same path?</div>' : ''}`) : ''}
        ${section('Why it matters', esc(obj.summary))}${obj.hubs && JSON.parse(obj.hubs || '[]').length ? section('Topic hubs / entities', JSON.parse(obj.hubs).map(h => chip(h, 'gray')).join('') + JSON.parse(obj.entities || '[]').map(e => chip(e, 'blue')).join('')) : ''}
        ${obj.content ? `<h4>Extracted content${obj.size > 20000 ? ' (first 20,000 characters)' : ''}</h4><pre style="white-space:pre-wrap;font:12px/1.4 inherit;background:#f6f8fc;padding:8px;border-radius:8px;max-height:320px;overflow:auto">${esc(obj.content)}</pre>` : ''}${section('Linked task', obj.task_id ? `<a href="#" data-open="task:${obj.task_id}">${esc(S.tasks.find(t => t.id === obj.task_id)?.title || obj.task_id)}</a>` : '')}${section('Source', esc(obj.source) + (obj.imported_at ? ' · imported ' + fmt(obj.imported_at) : ''))}
        ${w ? `<h4>Change kind</h4><div class="milestones">${['procedure', 'org_chart', 'reference', 'dashboard', 'plan', 'legal', 'script', 'financial', 'other'].map(k => `<button class="${obj.kind === k ? 'on' : ''}" data-set="kind:${k}">${k}</button>`).join('')}</div><p class="src">Setting "procedure" here does not create a task; re-run the folder import (force) after changing kinds, or add the task manually and link it.</p>` : ''}`;
    } else if (type === 'ai') {
      body = `<p>${esc(obj.purpose)}</p>${section('Needs AI', esc(obj.needs_ai))}${section('Provider / model', esc(obj.provider) + ' ' + esc(obj.model))}${section('Why', esc(obj.why))}${section('Expected cost', esc(obj.expected_cost))}${section('Approval', esc(obj.approval))}${section('Eval examples', esc(obj.eval_examples))}${section('Fallback', esc(obj.fallback))}`;
    }
    const title = obj.name || obj.title || obj.address || obj.purpose || id;
    $('#detail').innerHTML = `<header><div><div class="kind">${esc(type)}</div><h2>${esc(title)}</h2></div><div><button class="small ghost" id="closeDetail" aria-label="Close">✕</button></div></header>
      ${body}
      <h4>Activity history</h4>${history}
      <div class="actions">${w && FIELDS[type] ? `<button class="small" id="editBtn">Edit</button>` : ''}${w && ['person', 'task', 'agent', 'home', 'decision', 'document'].includes(type) ? `<button class="small danger" id="delBtn">Delete</button>` : ''}${type === 'department' ? `<button class="small" id="focusBtn">Focus in world</button>` : ''}</div>`;
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
    for (const [k, el] of Object.entries({ world: '#viewWorld', board: '#viewBoard', review: '#viewReview', registry: '#viewRegistry', integrations: '#viewIntegrations', ai: '#viewAi', history: '#viewHistory' })) $(el).hidden = k !== v;
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
