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
  async function save(table, row) { const r = await api('POST', `/api/${table}`, row); toast('Saved'); HO_dirty = true; await refresh(); return r; }

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
    renderStartHere(); World.render(S); renderLegend(); renderBoard(); renderReview(); renderHandover(); renderProcedures(); renderBuild(); renderWorkOrders(); renderApprovals(); renderRegistry(); renderIntegrations(); renderAi(); renderHistory();
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



  // ---------- flow charts (SVG from the task's flow JSON) ----------
  const FLAG = { gap: ['GAP', '#e24b4a'], agent: ['agent (rules)', '#1d9e75'], authority: ['human authority', '#8b5cf6'] };
  function flowSvg(flow) {
    if (!flow || !flow.nodes) return '';
    const W = 560, BW = 330, BH = 54, GAPY = 34, X0 = 40;
    const pos = {}; flow.nodes.forEach((n, i) => { pos[n.id] = { x: X0, y: 20 + i * (BH + GAPY) }; });
    const H = 20 + flow.nodes.length * (BH + GAPY) + 10;
    const shape = n => { const { x, y } = pos[n.id]; const col = n.status === 'confirmed' ? '#5b7cfa' : '#9aa5b8'; const dash = n.status === 'confirmed' ? '' : 'stroke-dasharray="5 4"';
      if (n.type === 'decision') return `<polygon points="${x + BW / 2},${y - 6} ${x + BW + 10},${y + BH / 2} ${x + BW / 2},${y + BH + 6} ${x - 10},${y + BH / 2}" fill="#fff8e1" stroke="${col}" stroke-width="2" ${dash}/>`;
      if (n.type === 'trigger' || n.type === 'end') return `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="27" fill="${n.type === 'trigger' ? '#eef1ff' : '#e6f7f0'}" stroke="${col}" stroke-width="2" ${dash}/>`;
      if (n.type === 'handoff') return `<polygon points="${x + 14},${y} ${x + BW},${y} ${x + BW - 14},${y + BH} ${x},${y + BH}" fill="#fdf2f8" stroke="${col}" stroke-width="2" ${dash}/>`;
      return `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="8" fill="#fff" stroke="${col}" stroke-width="2" ${dash}/>`; };
    const wrap = (t, max) => { const words = String(t).split(' '); const lines = ['']; for (const w of words) { if ((lines[lines.length - 1] + ' ' + w).trim().length > max) lines.push(w); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim(); } return lines.slice(0, 3); };
    const nodes = flow.nodes.map(n => { const { x, y } = pos[n.id]; const lines = wrap(n.label, 46);
      const text = lines.map((l, i) => `<text x="${x + BW / 2}" y="${y + 18 + i * 13 - (lines.length - 1) * 5}" text-anchor="middle" font-size="11" font-weight="600" fill="#1b2436">${esc(l)}</text>`).join('');
      const owner = `<text x="${x + BW + 18}" y="${y + 16}" font-size="11" fill="#5d6b85">${esc(n.owner || '')}</text>`;
      const flags = (n.flags || []).map((f, i) => `<rect x="${x + BW + 18 + i * 86}" y="${y + 24}" width="80" height="16" rx="8" fill="${FLAG[f][1]}"/><text x="${x + BW + 58 + i * 86}" y="${y + 35}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${FLAG[f][0]}</text>`).join('');
      const note = n.note ? `<text x="${x + BW + 18}" y="${y + 52}" font-size="9.5" fill="#a62828">${esc(n.note.slice(0, 48))}</text>` : '';
      const cite = n.cite ? `<text x="${x + BW / 2}" y="${y + BH - 6}" text-anchor="middle" font-size="9" fill="#5d6b85">${esc(n.cite)}</text>` : '';
      return `<g data-open="flownode">${shape(n)}${text}${cite}${owner}${flags}${note}</g>`; });
    const edges = flow.edges.map(([a, b, label]) => { const A = pos[a], B = pos[b]; if (!A || !B) return '';
      const back = B.y <= A.y; const x1 = A.x + BW / 2, y1 = A.y + BH + (flow.nodes.find(n => n.id === a).type === 'decision' ? 6 : 0), x2 = B.x + BW / 2, y2 = B.y - (flow.nodes.find(n => n.id === b).type === 'decision' ? 6 : 0);
      const d = back ? `M${A.x},${A.y + BH / 2} C${A.x - 40},${A.y + BH / 2} ${B.x - 40},${B.y + BH / 2} ${B.x},${B.y + BH / 2}` : (B.y - A.y > BH + GAPY + 1 ? `M${x1 + 120},${y1} C${x1 + 170},${y1 + 20} ${x2 + 170},${y2 - 20} ${x2 + 120},${y2}` : `M${x1},${y1} L${x2},${y2}`);
      const lx = back ? A.x - 36 : (B.y - A.y > BH + GAPY + 1 ? x1 + 150 : x1 + 6), ly = back ? (A.y + B.y) / 2 + BH / 2 : (y1 + y2) / 2 + 4;
      return `<path d="${d}" fill="none" stroke="#5d6b85" stroke-width="1.6" marker-end="url(#arr)"/>${label ? `<text x="${lx}" y="${ly}" font-size="10" fill="#5d6b85" font-weight="600">${esc(label)}</text>` : ''}`; }).join('');
    return `<svg viewBox="0 0 ${W + 220} ${H}" width="100%" style="background:#fbfcff;border:1px solid var(--line);border-radius:8px"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5d6b85"/></marker></defs>${edges}${nodes.join('')}</svg>
      <p class="src">Solid outline = confirmed in a transcript; dashed = from an old SOP, unconfirmed. Diamond = decision; slanted = handoff. Right column: who does it, then flags — <b style="color:#e24b4a">GAP</b> unowned or only in Maria's head · <b style="color:#1d9e75">agent (rules)</b> deterministic check candidate · <b style="color:#8b5cf6">human authority</b> approval/spending/acceptance.</p>`;
  }
  const VERDICT = { match: ['match', 'ok'], changed: ['changed', 'amber'], no_longer: ['no longer done', 'red'], not_mentioned: ['not mentioned — unconfirmed', 'gray'], new: ['new — confirmed', 'blue'] };
  function stepReviewTable(rows) {
    return `<table style="font-size:12px"><thead><tr><th>#</th><th>Old SOP step</th><th>Verdict</th><th>What was said</th><th>Cite</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.n)}</td><td>${esc(r.old)}</td><td>${chip(VERDICT[r.verdict]?.[0] || r.verdict, VERDICT[r.verdict]?.[1] || 'gray')}</td><td>${esc(r.said)}</td><td class="src">${esc(r.cite)}</td></tr>`).join('')}</tbody></table>`;
  }


  // ---------- documents, process and upload helpers for the side panel ----------
  const DOC_ICON = { pdf: '📕', docx: '📘', doc: '📘', xlsx: '📗', xls: '📗', csv: '📗', md: '📄', txt: '📄', html: '🌐', png: '🖼', jpg: '🖼', jpeg: '🖼' };
  function docCards(ids, { handover_id, task_id } = {}) {
    const w = S.permissions.write;
    const docs = (ids || []).map(id => S.documents.find(d => d.id === id)).filter(Boolean);
    if (!docs.length && !w) return '<p class="empty">No documents linked.</p>';
    return docs.map(d => { const ext = (d.mime ? d.path : d.path || '').split('.').pop().toLowerCase(); const attached = !!d.file_path || d.underlying_status === 'extracted' || !!d.content;
      return `<div class="doc-card ${attached ? '' : 'missing'}"><div class="ico">${attached ? (DOC_ICON[ext] || '📄') : '⬚'}</div><div style="flex:1"><b>${esc(d.restricted ? '(restricted)' : d.title)}</b><br><small class="src">${attached ? (d.file_path ? `${esc(ext.toUpperCase())} · ${Math.round((d.size || 0) / 1024)} KB · ${esc(d.source || '')}` : esc(d.source || '')) : 'Not attached yet — ' + esc((d.summary || '').slice(0, 120))}</small></div>
        <div style="display:flex;gap:4px;flex-direction:column">${d.file_path ? `<a href="/files/${encodeURIComponent(d.id)}" target="_blank" rel="noopener"><button class="small primary">Open</button></a>` : ''}${attached ? `<button class="small" data-open="document:${d.id}">Details</button>` : ''}${w ? `<button class="small" data-upload="${d.id}" data-upload-h="${handover_id || ''}" data-upload-t="${task_id || d.task_id || ''}">${attached ? 'Replace' : 'Upload'}</button>` : ''}</div></div>`; }).join('')
      + (w ? `<button class="small" data-upload="" data-upload-h="${handover_id || ''}" data-upload-t="${task_id || ''}">+ Attach another document</button>` : '');
  }
  function processBlock(t) {
    if (!t) return '';
    const flow = t.flow ? JSON.parse(t.flow) : null;
    const gaps = flow ? flow.nodes.filter(n => (n.flags || []).includes('gap')) : [];
    const steps = (t.steps || '').split(/\n/).map(x => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
    return `<div class="card" style="padding:12px;margin:8px 0"><div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(t.restricted ? '(restricted)' : t.title)}</b><span>${t.proposed ? chip('PROPOSED', 'amber') : chip('reviewed', 'ok')}${t.documented ? chip('documented', 'blue') : chip('not documented', 'red')}<a href="#" data-open="task:${t.id}" class="src">open task</a></span></div>
      ${t.trigger ? `<div class="trigger-box"><b>When it starts:</b> ${esc(t.trigger)}</div>` : ''}
      ${steps.length ? `<ol class="proc-steps">${steps.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join('')}${steps.length > 12 ? `<li class="src">… ${steps.length - 12} more on the task</li>` : ''}</ol>` : '<p class="empty">No steps written.</p>'}
      ${gaps.length ? `<h4 style="color:var(--red)">Gaps in this process</h4><ul class="gap-list">${gaps.map(g => `<li><b>${esc(g.label)}</b> — ${esc(g.note || 'unowned or only in Maria\'s head')} <span class="src">${esc(g.cite || '')}</span></li>`).join('')}</ul>` : ''}
      ${flow ? `<h4>Flow chart <button class="small" data-flow="${t.id}">Open large</button></h4>${flowSvg(flow)}` : ''}
      ${t.step_review ? `<details><summary class="src">Step-by-step review against the meetings (${JSON.parse(t.step_review).length} rows)</summary>${stepReviewTable(JSON.parse(t.step_review))}</details>` : ''}</div>`;
  }
  function flowModal(taskId) {
    const t = S.tasks.find(x => x.id === taskId); if (!t || !t.flow) return;
    const flow = JSON.parse(t.flow); const m = $('#modal'), c = $('#modalCard'); c.classList.add('wide');
    c.innerHTML = `<h2>${esc(flow.title)}</h2><p class="src">${esc(t.title)}</p>${flowSvg(flow)}<div class="actions"><button id="mcancel">Close</button></div>`;
    m.hidden = false; $('#mcancel').onclick = () => { m.hidden = true; c.classList.remove('wide'); };
  }
  function uploadModal(docId, handoverId, taskId) {
    const d = docId ? S.documents.find(x => x.id === docId) : null; const m = $('#modal'), c = $('#modalCard');
    c.innerHTML = `<h2>${d ? 'Attach the real file: ' + esc(d.title) : 'Attach a document'}</h2><p class="src">PDF, Word (.docx), Excel (.xlsx/.csv), Markdown or text. Stored in <code>data/uploads</code> on the server, never in git; viewable by anyone who can sign in (restricted documents stay restricted).${d && d.summary ? '<br>' + esc(d.summary) : ''}</p>
      <form id="mform"><input type="file" id="upFile" required>${d ? '' : '<label class="field"><span>Title (optional)</span><input id="upTitle"></label>'}<label class="field"><span>Note (where it came from, date)</span><input id="upNote" placeholder="e.g. from Maria, Teams 10/21"></label><div class="actions"><button type="submit" class="primary">Upload</button><button type="button" id="mcancel">Cancel</button></div></form>`;
    m.hidden = false; $('#mcancel').onclick = () => m.hidden = true;
    $('#mform').onsubmit = async e => { e.preventDefault(); const f = $('#upFile').files[0]; if (!f) return; const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(f); });
      const r = await api('POST', '/api/documents/upload', { name: f.name, data, doc_id: docId || undefined, handover_id: handoverId || undefined, task_id: taskId || undefined, note: $('#upNote').value });
      if (!docId && $('#upTitle')?.value) await api('POST', `/api/documents/${r.id}`, { title: $('#upTitle').value });
      m.hidden = true; toast(`Attached ${f.name} (${r.underlying_status})`); HO_dirty = true; await refresh(); };
  }
  document.addEventListener('click', e => { const u = e.target.closest('[data-upload]'); if (u) { e.preventDefault(); uploadModal(u.dataset.upload, u.dataset.uploadH, u.dataset.uploadT); return; } const f = e.target.closest('[data-flow]'); if (f) { e.preventDefault(); flowModal(f.dataset.flow); } });

  // ---------- Handover view: "if this person were gone tomorrow, what stops?" ----------
  let HO = null, HO_dirty = true;
  async function renderHandover(force) {
    const v = $('#viewHandover'); if (v.hidden) { HO_dirty = true; return; }
    if (!force && !HO_dirty && HO) return; // polling must not re-render a view the user is reading
    HO_dirty = false;
    HO = await api('GET', '/api/handover?person=maria').catch(() => null); if (!HO) { v.innerHTML = '<div class="section"><p class="empty">No handover data.</p></div>'; return; }
    const w = S.permissions.write;
    const P = HO.person, noBackup = HO.items.filter(i => i.no_backup), withBackup = HO.items.filter(i => !i.no_backup);
    const docChip = d => chip('documented: ' + d, /^yes/.test(d) ? 'ok' : /^no/.test(d) ? 'red' : 'amber');
    const itemRow = i => `<div class="card-t" style="border-left-color:${i.risk === 'high' ? 'var(--red)' : i.risk === 'medium' ? 'var(--amber)' : 'var(--gray)'};opacity:${i.status === 'open' ? 1 : .55}" data-open="handover:${i.id}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(i.item)}</b><span>${chip(i.risk + ' risk', i.risk === 'high' ? 'red' : i.risk === 'medium' ? 'amber' : 'gray')}${i.status !== 'open' ? chip(i.status, 'blue') : ''}</span></div>
      <small>${docChip(i.documented)} ${chip('current: ' + i.current, /^confirmed/.test(i.current) ? 'ok' : 'gray')} ${chip(i.no_backup ? 'NO BACKUP TODAY' : 'backup: ' + i.backup, i.no_backup ? 'red' : 'ok')}</small>
      <small><b>Capture from Maria:</b> ${esc(i.capture)}</small><small class="src">${(i.task_ids || []).length ? '🗺 ' + (i.task_ids || []).length + ' process' + ((i.task_ids || []).length > 1 ? 'es' : '') + ' · ' : ''}${(i.doc_ids || []).length ? '📄 ' + (i.doc_ids || []).filter(id => { const d = S.documents.find(x => x.id === id); return d && (d.file_path || d.content); }).length + '/' + (i.doc_ids || []).length + ' documents attached · ' : ''}${esc(i.basis)} · ${esc(i.cite)}${i.note ? ' · note: ' + esc(i.note) : ''}</small></div>`;
    v.innerHTML = `<div class="table-wrap">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h2 style="margin:0">If ${esc(P.full_name || P.name)} were gone tomorrow, what stops?</h2>${chip(P.title || '', 'gray')}${P.legacy_roles.map(r => chip(r, 'gray')).join('')}<span class="hint">Built from her ${HO.tasks.filter(t => t.role === 'owner').length} owned tasks, ${P.responsibilities.length} hub responsibilities (${P.crossed_off.length} crossed off), ${P.legacy_roles.length} legacy roles, ${HO.homes.length} active jobs, and the meetings of 10/12 and 10/16.</span>
        <a href="/api/handover/agenda?person=maria" target="_blank"><button class="small primary">Next-meeting agenda (Markdown)</button></a></div>
      <div class="grid-2" style="margin-top:12px"><div><h3>No backup today (${noBackup.length}) — sorted by risk</h3>${noBackup.map(itemRow).join('')}</div><div><h3>Someone could cover (${withBackup.length}) — confirm they can</h3>${withBackup.map(itemRow).join('')}</div></div>
      <h3 style="margin-top:18px">Her procedures (${HO.tasks.length})</h3><p class="src">Owner or backup. Step review = reconciled against the transcripts; Flow = chart drawn. Click to open.</p>
      <table><thead><tr><th>Task</th><th>Role</th><th>Backup</th><th>Documented</th><th>Step review</th><th>Flow</th></tr></thead><tbody>${HO.tasks.map(t => `<tr class="clickable" data-open="task:${t.id}"><td>${esc(t.restricted ? '(restricted)' : t.title)}${t.proposed ? ' ' + chip('PROPOSED', 'amber') : ''}</td><td>${t.role}</td><td>${t.role === 'owner' ? (t.backup_id ? esc(personName(t.backup_id)) : chip('none', 'red')) : esc(personName(t.owner_id))}</td><td>${t.documented ? '📄' : '▫'}</td><td>${t.review_counts ? Object.entries(t.review_counts).map(([k, n]) => chip(n + ' ' + (VERDICT[k]?.[0] || k).split(' —')[0], VERDICT[k]?.[1] || 'gray')).join('') : '<span class="src">—</span>'}</td><td>${t.has_flow ? '🗺' : ''}</td></tr>`).join('')}</tbody></table>
      <h3 style="margin-top:18px">Active jobs — where each stands</h3>
      <table><thead><tr><th>Address</th><th>Stage</th><th>Permits</th><th>Issues</th><th>Next milestone</th></tr></thead><tbody>${HO.homes.map(h => `<tr class="clickable" data-open="home:${h.id}"><td>${esc(h.address)}</td><td>${esc(h.stage || '')}</td><td class="src">${esc((h.permits || '').slice(0, 90))}</td><td class="src">${esc((h.issues || '').slice(0, 90))}</td><td class="src">${esc((h.next_milestone || '').slice(0, 90))}</td></tr>`).join('')}</tbody></table>
      <h3 style="margin-top:18px">Hub responsibilities (${P.responsibilities.length} current · ${P.crossed_off.length} crossed off by Maria)</h3>
      <div class="grid-2"><ol style="margin:0 0 0 18px;padding:0;font-size:12px;max-height:300px;overflow:auto">${P.responsibilities.map(r => `<li>${esc(r)}</li>`).join('')}</ol><ol style="margin:0 0 0 18px;padding:0;font-size:12px;max-height:300px;overflow:auto;color:var(--muted);text-decoration:line-through">${P.crossed_off.map(r => `<li>${esc(r)}</li>`).join('')}</ol></div>
    </div>`;
  }


  // ---------- Procedures: old (SOP / handoff) vs new (confirmed in meetings), linked by "supersedes" ----------
  let procFilter = localStorage.getItem('mow_procfilter') || 'both';
  const isNew = t => t.id.startsWith('tr-');
  const isOld = t => t.id.startsWith('hub-') || t.id.startsWith('proc-') || t.id.startsWith('obs-');
  function renderProcedures() {
    const v = $('#viewProcedures'); if (v.hidden) return;
    const tasks = S.tasks.filter(t => !t.restricted && (isNew(t) || isOld(t)));
    const byId = Object.fromEntries(S.tasks.map(t => [t.id, t]));
    const supersededBy = {}; for (const t of tasks) for (const old of JSON.parse(t.supersedes || '[]')) (supersededBy[old] = supersededBy[old] || []).push(t.id);
    // What is missing from a procedure, in the order it matters for the handover.
    const LEAVING = S.people.filter(x => /LEAVING/i.test(x.notes || '')).map(x => x.id);
    const gapsOf = t => {
      const g = [];
      if (!String(t.steps || '').trim()) g.push(['No steps written down', 'red']);
      if (LEAVING.includes(t.owner_id) && !t.backup_id) g.push(['Owner is leaving, no backup', 'red']);
      else if (!t.backup_id) g.push(['No backup', 'amber']);
      if (!t.owner_id) g.push(['No owner', 'red']);
      if (isOld(t) && !(supersededBy[t.id] || []).length) g.push(['Never confirmed in a meeting', 'amber']);
      if (isOld(t) && !t.step_review && (supersededBy[t.id] || []).length === 0) g.push(['Not reviewed against the transcripts', 'gray']);
      return g;
    };
    const severity = t => gapsOf(t).reduce((n, [, c]) => n + (c === 'red' ? 10 : c === 'amber' ? 3 : 1), 0);
    const reviewChips = t => t.step_review ? Object.entries(JSON.parse(t.step_review).reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {})).map(([k, n]) => chip(n + ' ' + (VERDICT[k]?.[0] || k).split(' —')[0], VERDICT[k]?.[1] || 'gray')).join('') : '';
    const card = (t, side) => `<div class="card-t ${t.proposed ? 'proposed' : 'verified'}" data-open="task:${t.id}" style="border-left-color:${side === 'new' ? 'var(--ok)' : 'var(--gray)'}"><div style="display:flex;justify-content:space-between;gap:6px"><b>${esc(t.title)}</b><span>${side === 'new' ? chip('NEW · confirmed in meetings', 'ok') : chip(t.id.startsWith('hub-') ? 'OLD · SOP ' + (t.source || '').replace(/.*SOP dated /, '').slice(0, 24) : 'OLD · handoff', 'gray')}</span></div>
      <small>${esc(personName(t.owner_id))} · ${esc(dept(t.department_id)?.short || '—')} · ${t.documented ? 'documented' : 'not documented'}${t.flow ? ' · 🗺 flow' : ''}</small>${reviewChips(t) ? `<small>${reviewChips(t)}</small>` : ''}
      ${side === 'new' && JSON.parse(t.supersedes || '[]').length ? `<small>Supersedes: ${JSON.parse(t.supersedes).map(id => `<a href="#" data-open="task:${id}">${esc(byId[id]?.title || id)}</a>`).join(' · ')}</small>` : ''}
      ${gapsOf(t).length ? `<small>${gapsOf(t).map(([l, c]) => chip(l, c)).join('')}</small>` : `<small>${chip('nothing missing', 'ok')}</small>`}
      ${side === 'old' && (supersededBy[t.id] || []).length ? `<small>Superseded by: ${supersededBy[t.id].map(id => `<a href="#" data-open="task:${id}">${esc(byId[id]?.title || id)}</a>`).join(' · ')}</small>` : side === 'old' ? `<small class="src">No confirmed replacement yet — still the only description of this process.</small>` : ''}</div>`;
    const news = tasks.filter(isNew).sort((a, b) => a.title.localeCompare(b.title)), olds = tasks.filter(isOld).sort((a, b) => a.title.localeCompare(b.title));
    let body = '';
    if (procFilter === 'todo') {
      const todo = tasks.filter(t => gapsOf(t).length).sort((a, b) => severity(b) - severity(a) || a.title.localeCompare(b.title));
      const worst = todo.filter(t => gapsOf(t).some(([, c]) => c === 'red'));
      body = `<p class="hint" style="margin:6px 0 10px">${todo.length} of ${tasks.length} procedures are missing something. ${worst.length} are urgent: no steps written down, or the person who owns them is leaving and nobody is named to take over.</p>
        <div class="board" style="grid-template-columns:1fr">${['red', 'rest'].map(band => {
          const rows = band === 'red' ? worst : todo.filter(t => !worst.includes(t));
          return rows.length ? `<div class="col"><h3>${band === 'red' ? 'Urgent' : 'The rest'} <span>${rows.length}</span></h3>${rows.map(t => card(t, isNew(t) ? 'new' : 'old')).join('')}</div>` : '';
        }).join('')}</div>`;
    }
    else if (procFilter === 'new') body = `<div class="board" style="grid-template-columns:1fr"><div class="col"><h3>New — confirmed in the meetings <span>${news.length}</span></h3>${news.map(t => card(t, 'new')).join('')}</div></div>`;
    else if (procFilter === 'old') body = `<div class="board" style="grid-template-columns:1fr"><div class="col"><h3>Old — SOPs and handoff placeholders <span>${olds.length}</span></h3>${olds.map(t => card(t, 'old')).join('')}</div></div>`;
    else { // both: pairs side by side, then unpaired on each side
      const paired = news.filter(t => JSON.parse(t.supersedes || '[]').length);
      const pairedOld = new Set(paired.flatMap(t => JSON.parse(t.supersedes)));
      body = `<div class="board" style="grid-template-columns:1fr 1fr"><div class="col"><h3>New (confirmed) <span>${news.length}</span></h3>${paired.map(t => card(t, 'new')).join('')}<h4>New with no old counterpart</h4>${news.filter(t => !JSON.parse(t.supersedes || '[]').length).map(t => card(t, 'new')).join('') || '<p class="empty">—</p>'}</div>
        <div class="col"><h3>Old (SOP / handoff) <span>${olds.length}</span></h3>${paired.map(t => JSON.parse(t.supersedes).map(id => byId[id] ? card(byId[id], 'old') : '').join('')).join('')}<h4>Old with no confirmed replacement</h4>${olds.filter(t => !pairedOld.has(t.id)).map(t => card(t, 'old')).join('') || '<p class="empty">—</p>'}</div></div>`;
    }
    v.innerHTML = `<div class="world-toolbar"><b>Procedures</b><span class="views">${[['todo', 'Needs work'], ['new', 'New'], ['old', 'Old'], ['both', 'Both']].map(([k, l]) => `<button class="${procFilter === k ? 'active' : ''}" data-procfilter="${k}">${l}</button>`).join('')}</span><span class="hint">Needs work = what is missing, worst first. New = confirmed in a meeting transcript (tr-). Old = hub SOP (2004–2022) or handoff placeholder. "Supersedes" links a new procedure to the old one it replaces; edit a task to change it.</span></div><div style="overflow:auto;flex:1">${body}</div>`;
    v.querySelectorAll('[data-procfilter]').forEach(b => b.onclick = () => { procFilter = b.dataset.procfilter; localStorage.setItem('mow_procfilter', procFilter); renderProcedures(); });
  }

  // ---------- pending approvals: shown in every view, because they block real work ----------
  function renderApprovals() {
    const bar = $('#approvalBar'); if (!bar) return;
    const pending = (S.approvals || []).filter(a => a.status === 'pending');
    bar.hidden = !pending.length;
    if (!pending.length) return;
    const vend = id => S.vendors.find(v => v.id === id);
    const home = id => S.homes.find(h => h.id === id);
    bar.innerHTML = pending.map(a => {
      const draft = (() => { try { return JSON.parse(a.draft || '{}'); } catch { return {}; } })();
      const opts = (() => { try { return JSON.parse(a.options || '[]'); } catch { return []; } })();
      const label = k => String(k).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
      const seen = new Map();
      for (const [k, v] of [['Vendor', vend(a.vendor_id)?.vendor], ['Job', home(a.home_id)?.address], ['Amount', a.amount],
        ...Object.entries(draft).map(([k, v]) => [label(k), v])])
        if (v != null && v !== '' && typeof v !== 'object') seen.set(k.toLowerCase(), [k, String(v)]);
      const facts = [...seen.values()];
      return `<div class="approval" data-ap="${esc(a.id)}">
        <div class="ap-main">
          <div class="ap-head"><span class="ap-icon" aria-hidden="true">⏳</span><b>${esc(a.subject)}</b>
            ${chip('Waiting for ' + personName(a.requested_from), 'amber')}${a.channel ? chip(a.channel === 'teams' ? 'asked in Teams' : a.channel, 'gray') : ''}</div>
          <p class="ap-q">${esc(a.question)}</p>
          ${facts.length ? `<dl class="ap-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
          ${a.evidence ? `<small class="src">From: ${esc(a.evidence)}</small>` : ''}
          <small class="src">Nothing has been sent to the subcontractor. Approving is what sends it.</small>
        </div>
        ${opts.length > 1 ? `<fieldset class="ap-opts"><legend>Pick one</legend>${opts.map(o => `<label><input type="radio" name="opt-${esc(a.id)}" value="${esc(o.id)}"> <b>${esc(o.label)}</b>${o.amount ? ` <span class="num">${esc(o.amount)}</span>` : ''}${o.note ? `<small>${esc(o.note)}</small>` : ''}</label>`).join('')}</fieldset>` : ''}
        <div class="ap-actions">${a.can_decide
          ? `<button class="primary small" data-apdo="approve">${opts.length > 1 ? 'Approve the one I picked' : a.kind === 'bid_request' ? 'Approve and send the request' : 'Approve and enter the work order'}</button><button class="small ghost" data-apdo="reject">${a.kind === 'bid_chase' ? 'Cancel the line item' : 'Reject'}</button>`
          : `<small class="src">Only accounting or admin can approve this.</small>`}</div>
      </div>`;
    }).join('');
    bar.querySelectorAll('[data-apdo]').forEach(b => b.onclick = async () => {
      const id = b.closest('[data-ap]').dataset.ap, d = b.dataset.apdo;
      const a = pending.find(x => x.id === id);
      const o = (() => { try { return JSON.parse(a.options || '[]'); } catch { return []; } })();
      const chosen = o.length > 1 ? (b.closest('[data-ap]').querySelector(`input[name="opt-${id}"]:checked`) || {}).value : null;
      if (d === 'approve' && o.length > 1 && !chosen) { toast('Pick which one you are approving'); return; }
      const what = a.kind === 'bid_request' ? 'This sends the bid request to those vendors.'
        : a.kind === 'bid_chase' ? 'This cancels the line item.'
        : 'This enters the work order, which emails the subcontractor to say it is approved.';
      if (d === 'approve' && !confirm(`Approve "${a.subject}"?\n\n${what}`)) return;
      const note = d === 'reject' ? prompt('Why? (recorded, so the next person knows what to do)', '') : null;
      if (d === 'reject' && !String(note || '').trim()) { if (note !== null) toast('A reason is required'); return; }
      b.disabled = true;
      await api('POST', `/api/approvals/${id}/${d}`, { note, chosen });
      toast(d === 'approve' ? 'Approved and released' : 'Rejected — nothing was sent');
      refresh();
    });
  }

  // ---------- Work orders: a person asks, the agent fills it in, a person confirms, then it is entered ----------
  function woModal() {
    const m = $('#modal'), c = $('#modalCard');
    const vopts = S.vendors.slice().sort((a, b) => (a.vendor || a.trade).localeCompare(b.vendor || b.trade))
      .map(v => `<option value="${esc(v.id)}">${esc(v.vendor || v.trade)} — ${esc(v.trade)}${v.pricing_basis === 'per_sqft' ? ' (per sq ft)' : ''}</option>`).join('');
    const hopts = S.homes.filter(h => h.active === 'active').map(h => `<option value="${esc(h.id)}">${esc(h.address)}</option>`).join('');
    c.innerHTML = `<h2>Create a work order</h2>
      <p class="src">You are asking the agent to create this. It fills in what it can, shows you the result, and enters it only after you confirm. Entering it emails the subcontractor to say it is approved.</p>
      <form id="mform">
        <label class="field"><span>Vendor</span><select id="woVendor" required><option value="">Choose…</option>${vopts}</select></label>
        <label class="field"><span>Job</span><select id="woHome"><option value="">(not set)</option>${hopts}</select></label>
        <label class="field"><span>What the work is</span><input id="woDesc" placeholder="e.g. balcony door pans + first coat"></label>
        <label class="field"><span>Amount</span><input id="woAmount" placeholder="e.g. $4,850.00"></label>
        <label class="field" id="woSqftRow" hidden><span>Square footage <small class="src">this vendor prices per square foot, so the order needs it</small></span><input id="woSqft"></label>
        <label class="field"><span>Cost code</span><input id="woCode" placeholder="optional"></label>
        <label class="field"><span>Where the bid came from</span><input id="woEvidence" placeholder="e.g. Johnston bid PDF, emailed 10/26"></label>
        <label class="toggle"><input type="checkbox" id="woOver"> <span>Over the budget line (Jim confirms)</span></label>
        <div class="actions"><button type="submit" class="primary">Ask the agent</button><button type="button" id="mcancel">Cancel</button></div></form>`;
    m.hidden = false; $('#mcancel').onclick = () => m.hidden = true;
    const sync = () => { const v = S.vendors.find(x => x.id === $('#woVendor').value); $('#woSqftRow').hidden = !(v && v.pricing_basis === 'per_sqft'); };
    $('#woVendor').onchange = sync; sync();
    $('#mform').onsubmit = async e => { e.preventDefault();
      await api('POST', '/api/work-orders/request', { vendor_id: $('#woVendor').value, home_id: $('#woHome').value || null,
        description: $('#woDesc').value, amount: $('#woAmount').value, sqft: $('#woSqft').value, cost_code: $('#woCode').value,
        evidence: $('#woEvidence').value, over_budget: $('#woOver').checked });
      m.hidden = true; toast('Asked — check it above and confirm'); refresh(); };
  }
  function renderWorkOrders() {
    const v = $('#viewWo'); if (v.hidden) return;
    const all = (S.approvals || []).filter(a => a.kind === 'work_order');
    const pending = all.filter(a => a.status === 'pending');
    const done = all.filter(a => a.status !== 'pending');
    const vend = id => S.vendors.find(x => x.id === id);
    const home = id => S.homes.find(h => h.id === id);
    const row = a => `<tr class="${a.status}">
      <td><b>${esc(a.subject.replace(/^Work order — /, '').replace(/ — .*$/, ''))}</b>${a.evidence ? `<small class="src">${esc(a.evidence)}</small>` : ''}</td>
      <td>${esc(home(a.home_id)?.address || '—')}</td>
      <td class="num">${esc(a.amount || '—')}</td>
      <td>${a.status === 'pending' ? chip('waiting to be confirmed', 'amber')
        : a.status === 'approved' ? (a.wo_ref ? chip(/^wo/i.test(a.wo_ref) ? a.wo_ref : 'WO ' + a.wo_ref, 'ok') : chip('confirmed — not entered yet', 'purple'))
        : chip(a.status, 'red')}</td>
      <td><small>${esc(a.requested_by || '—')}${a.decided_by ? ` → ${esc(a.decided_by)}` : ''}${a.identity === 'self_declared' ? ' (self-declared)' : ''}</small>
        ${a.decision_note ? `<small class="src">${esc(a.decision_note)}</small>` : ''}</td></tr>`;
    const parked = S.bid_flow !== 'active';
    const brs = S.bid_requests || [];
    v.innerHTML = `<div class="world-toolbar"><b>Work orders</b>
      ${S.permissions.write ? '<button class="primary small" id="woNew">+ Create a work order</button>' : ''}
      <span class="hint">A person asks for a work order; the agent fills it in and enters it only once a person confirms. The agent never starts one.</span></div>
      <div class="bscroll">
        ${pending.length ? `<h3>Waiting to be confirmed <span class="chip amber">${pending.length}</span></h3>
          <div class="table-wrap"><table><tbody>${pending.map(row).join('')}</tbody></table></div>` : ''}
        <h3 style="margin-top:${pending.length ? 18 : 0}px">${pending.length ? 'Decided' : 'Work orders'} <span class="chip gray">${done.length}</span></h3>
        ${done.length ? `<div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Job</th><th class="num">Amount</th><th>Status</th><th>Asked / confirmed by</th></tr></thead><tbody>${done.map(row).join('')}</tbody></table></div>`
          : '<p class="empty">None yet. Use <b>Create a work order</b> when you have an approved bid in hand.</p>'}
        ${parked ? `<div class="parked"><b>Requesting and comparing bids is parked.</b>
          <p>How a bid gets requested and compared varies too much between trades to automate before the process is written down, so none of it runs. Nothing was thrown away: the bid request and bid records, the "ask only once all bids are in" rule, the overdue chase and the n8n workflow are all still here, switched off. Turning them back on is one setting once a bid process and its own agent exist.</p>
          ${brs.length ? `<small class="src">${brs.length} bid request${brs.length === 1 ? '' : 's'} recorded before it was parked; the data is kept.</small>` : ''}</div>` : ''}
      </div>`;
    const b = $('#woNew'); if (b) b.onclick = woModal;
  }

  // ---------- Build view: Maria's "How to build a house" as an ordered, filterable sequence ----------
  let buildFilter = localStorage.getItem('mow_buildfilter') || 'all';
  const PHASE_HUE = { 'Site & slab': 28, 'Frame & dry-in': 200, 'Exterior envelope': 265, 'Interior trim & mechanical trim': 150, 'Floors, cabinets & fixtures': 330, 'Landscape, final trims & finals': 95 };
  function renderBuild() {
    const v = $('#viewBuild'); if (v.hidden) return;
    const all = (S.build_steps || []);
    if (!all.length) { v.innerHTML = `<div class="world-toolbar"><b>Build sequence</b></div><p class="empty">Maria's "How to build a house" has not been imported yet. Attach it on the Integrations page, or point Option 3 at the <code>MARIA LEAVING</code> folder.</p>`; return; }
    const steps = all.filter(b => b.kind === 'step');
    const vend = id => S.vendors.find(x => x.id === id);
    const counts = { mch: steps.filter(b => b.is_mch).length, insp: all.filter(b => b.inspection).length, gap: steps.filter(b => b.gap).length, cred: all.filter(b => b.credential_note).length, nov: steps.filter(b => !b.vendor_id && !b.is_mch).length };
    const keep = b => b.kind !== 'step' ? buildFilter === 'all'
      : buildFilter === 'all' ? true
      : buildFilter === 'mch' ? !!b.is_mch
      : buildFilter === 'inspections' ? !!b.inspection
      : /* decide */ !!(b.gap || (!b.vendor_id && !b.is_mch) || b.credential_note);
    const shown = all.filter(keep);

    const sentence = t => String(t || '').replace(/^\s*([a-z])/, (m, c) => c.toUpperCase());
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    const badges = b => [
      b.is_mch ? chip('MCH does this', 'amber') : '',
      b.inspection === 'city' ? chip('City of Houston inspection', 'purple') : b.inspection === 'third_party' ? chip('Third-party inspection', 'purple') : b.inspection ? chip('Inspection', 'purple') : '',
      b.credential_note ? chip('Login needed', 'red') : '',
      b.gap ? chip('No contractor chosen', 'red') : '',
      (b.kind === 'step' && !b.vendor_id && !b.is_mch && !b.gap) ? chip('Not in the vendor list', 'gray') : '',
    ].filter(Boolean).join('');

    const stepRow = b => {
      const vn = vend(b.vendor_id);
      return `<li class="bstep${b.is_mch ? ' mch' : ''}" style="--ph:${PHASE_HUE[b.phase] ?? 210}">
        <span class="bseq">${b.seq}</span>
        <div class="bbody">
          <div class="btitle"><b>${esc(sentence(b.description))}</b>${badges(b)}</div>
          <div class="bwho">${vn ? `<a href="#" data-open="vendor:${vn.id}" class="bvendor">${esc(b.responsible)}</a> <small class="src">· ${esc(vn.trade)}</small>`
            : b.is_mch ? '<span class="bvendor">McVaugh (the builder)</span>'
            : `<span class="bvendor">${esc(b.responsible || 'nobody named')}</span>`}</div>
          ${b.notes ? `<p class="bnotes">${esc(b.notes)}</p>` : ''}
          ${b.credential_note ? `<p class="bcred">🔑 ${esc(b.credential_note)}</p>` : ''}
        </div></li>`;
    };
    const holdRow = b => `<li class="bhold ${b.kind}"><span>${b.kind === 'hold' ? '⛔' : '📣'}</span><div><b>${esc(b.description)}</b>${b.notes ? `<p class="bnotes">${esc(b.notes)}</p>` : ''}</div></li>`;

    let body = '', phase = null;
    for (const b of shown) {
      if (b.phase !== phase) {
        if (phase !== null) body += '</ol></section>';
        phase = b.phase;
        const inPhase = shown.filter(x => x.phase === phase);
        body += `<section class="bphase" style="--ph:${PHASE_HUE[phase] ?? 210}"><h3><span class="bdot"></span>${esc(phase)} <span class="chip gray">${plural(inPhase.filter(x => x.kind === 'step').length, 'step')}</span></h3><ol class="bsteps">`;
      }
      body += b.kind === 'step' ? stepRow(b) : holdRow(b);
    }
    if (phase !== null) body += '</ol></section>';
    if (!shown.length) body = '<p class="empty">Nothing matches this filter.</p>';

    const doc = S.documents.find(d => d.id === 'doc-how-to-build-a-house');
    v.innerHTML = `<div class="world-toolbar"><b>Build sequence</b>
      <span class="views">${[['all', 'All steps'], ['mch', `MCH does it (${counts.mch})`], ['inspections', `Inspections (${counts.insp})`], ['decide', `Needs a decision (${counts.gap + counts.nov + counts.cred})`]].map(([k, l]) => `<button class="${buildFilter === k ? 'active' : ''}" data-bfilter="${k}">${l}</button>`).join('')}</span>
      <span class="hint">From Maria's "How to build a house" (10/22), written for the Villas. ${steps.length} steps in order. Logins that were typed into the sheet are not stored here.${doc && !doc.restricted ? ` <a href="/files/${doc.id}" target="_blank">Open the original file</a>` : doc ? ' The original file is restricted: it still has the passwords in it.' : ''}</span></div>
    <div class="bstats">
      <div><b>${steps.length}</b><span>steps, lot stake to final</span></div>
      <div class="amber"><b>${counts.mch}</b><span>MCH's own action — no sub to fall back on</span></div>
      <div class="purple"><b>${counts.insp}</b><span>inspections to schedule</span></div>
      <div class="red"><b>${counts.cred}</b><span>steps that need a portal login</span></div>
      <div class="${counts.gap + counts.nov ? 'red' : ''}"><b>${counts.gap + counts.nov}</b><span>steps with no vendor record</span></div>
    </div>
    <div class="bscroll">${body}</div>`;
    v.querySelectorAll('[data-bfilter]').forEach(b => b.onclick = () => { buildFilter = b.dataset.bfilter; localStorage.setItem('mow_buildfilter', buildFilter); renderBuild(); });
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
        ${o.title ? `<div class="src">${esc(o.full_name || '')} · ${esc(o.title)}${o.reports_to ? ' · reports to ' + esc(personName(o.reports_to)) : ''}</div>` : ''}
        <h4>Departments</h4>${o.departments.map(deptName).map(esc).join(', ') || '<span class="empty">none</span>'}
        ${JSON.parse(o.legacy_roles || '[]').length ? `<h4>Absorbed legacy roles (old ops hub)</h4>${JSON.parse(o.legacy_roles).map(r => chip(r, 'gray')).join('')}` : ''}
        ${JSON.parse(o.responsibilities || '[]').length ? `<h4>Responsibilities listed in the old ops hub (${JSON.parse(o.responsibilities).length})</h4><ol style="margin:4px 0 8px 18px;padding:0;max-height:260px;overflow:auto;font-size:13px">${JSON.parse(o.responsibilities).map(r => `<li>${esc(r)}</li>`).join('')}</ol><p class="src">These came from the hub's current-team map. Verifying the person means "this list is right"; use the note for anything that is wrong or missing.</p>` : ''}
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
      <h2 style="margin-top:18px">Vendors by trade (${S.vendors.length})</h2><p class="src">From the SOW Excel (Maria, 10/21): current vendor, who to call for bidding vs field scheduling, documents to provide, current $/sf. Contacts and rates are restricted to accounting/admin.</p>${rows(S.vendors, [['Trade', v => esc(v.trade)], ['Current vendor', v => esc(v.vendor || '—')], ['Rate', v => esc(v.rate || '')], ['Contacts', v => v.restricted ? chip('restricted', 'red') : JSON.parse(v.contacts || '[]').map(c => `<div><b>${esc(c.name)}</b> <span class="src">${esc(c.info)}</span>${c.note ? `<br><span class="src">${esc(c.note)}</span>` : ''}</div>`).join('')], ['Docs to provide', v => `<span class="src">${esc((v.docs_needed || '').replace(/\n/g, ' · '))}</span>`]], 'vendor')}
      <h2 style="margin-top:18px">Documents (${S.documents.length})</h2><p class="src">Imported vault files that are not procedures (and the source file of each procedure). Financial documents are restricted to accounting/admin.</p>${rows(S.documents, [['Title', d => esc(d.title)], ['Kind', d => chip(d.kind, d.kind === 'procedure' ? 'ok' : d.kind === 'financial' ? 'red' : d.kind === 'meeting' ? 'blue' : 'gray')], ['Linked task', d => d.task_id ? `<a href="#" data-open="task:${d.task_id}">${esc(S.tasks.find(t => t.id === d.task_id)?.title || d.task_id)}</a>` : '—'], ['Summary', d => `<span class="src">${esc(d.summary || '')}</span>`], ['Source', d => `<span class="src">${esc(d.source || '')}</span>`]], 'document')}
      <h2 style="margin-top:18px">Decisions (${S.decisions.length})</h2>${rows(S.decisions, [['Date', d => esc(d.date)], ['Decision', d => esc(d.title)], ['Status', d => chip(d.status, d.status === 'approved' ? 'ok' : 'amber')], ['By', d => esc(d.decided_by)], ['Reason', d => esc(d.reason)]], 'decision')}
    </div>`;
  }

  function renderIntegrations() {
    const w = S.permissions.write;
    if ($('#obsFiles')?.files.length || $('#hubFile')?.files.length || $('#csvFile')?.files.length || $('#restoreFile')?.files.length || $('#folderReport')?.innerHTML || (document.activeElement && $('#viewIntegrations').contains(document.activeElement))) return; // don't wipe a chosen file, a report, or a field being typed in during polling
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
      <div class="card" style="margin-bottom:12px"><h3>Old MCH Operations Hub (mch-ops-hub.html)</h3><p class="src">Two directions. <b>Import</b>: upload a newer copy to refresh SOPs/responsibilities here (review decisions kept). <b>Regenerate</b>: download the hub rebuilt from this world's current data — same page, its SOPs now include the confirmed new procedures (marked current/superseded) and each person's current responsibilities and cross-offs. ${S.server.opshub_path ? `Auto-write is on: every change rewrites <code>${esc(S.server.opshub_path)}</code> after 3 s.` : 'To keep the file updated automatically, set <code>MOW_OPSHUB_PATH</code> in <code>data\\n8n.env</code> to the hub file\'s path (e.g. the copy in <code>_Inbox\\_LocalServer</code>) and restart.'}</p><div class="actions"><a href="/api/export/opshub"><button class="small primary">Download regenerated mch-ops-hub.html</button></a></div><input type="file" id="hubFile" accept=".jsx,.js,.html,.json" ${w ? '' : 'disabled'}><button class="small primary" id="hubImport" ${w ? '' : 'disabled'}>Import ops hub</button><div id="hubReport"></div></div>
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
    const KINDS = ['procedure', 'org_chart', 'reference', 'dashboard', 'plan', 'legal', 'script', 'financial', 'meeting', 'other'];
    const kindSel = (path, kind) => `<select class="kind-override" data-path="${esc(path)}" style="width:auto;padding:2px 6px;font-size:11px">${KINDS.map(k => `<option value="${k}" ${k === kind ? 'selected' : ''}>${k === 'procedure' ? 'procedure → task' : k + ' → document'}</option>`).join('')}</select>`;
    const folderReport = r => `<p>${r.dry_run ? 'Dry run — nothing written.' : 'Imported.'} Scanned ${r.scanned}, ${r.dry_run ? 'would import' : 'imported'} ${r.dry_run ? r.files.filter(f => f.changed).length : r.imported}, unchanged ${r.skipped_unchanged}${r.errors.length ? `, errors ${r.errors.length}` : ''}.${r.kinds ? ' By kind: ' + Object.entries(r.kinds).map(([k, n]) => `${k} ${n}`).join(', ') + '.' : ''}</p><p class="src">Only <b>procedure</b> files become tasks; everything else is kept as a linked document. Change a file's kind below, then Preview again or Import.</p>${r.errors.map(e => `<div class="error">${esc(e)}</div>`).join('')}<div style="max-height:360px;overflow:auto">${r.files.filter(f => f.status !== 'unchanged').map(f => `<div class="card-t ${f.preview?.sensitive ? 'restricted' : ''}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(f.path)}</b>${f.kind === 'md' && f.preview ? kindSel(f.path, f.preview.kind) : ''}</div><small>${esc(f.status)}${f.preview?.kind_reason ? ' · ' + esc(f.preview.kind_reason) : ''}${f.preview?.sensitive ? ' · RESTRICTED (financial)' : ''}</small>${f.preview?.linked ? `<small>index card → <code>${esc(f.preview.linked.file || '?')}</code> · ${esc(String(f.preview.linked.status).replace('_', ' '))}${f.preview.linked.chars ? ` · ${f.preview.linked.chars} chars extracted` : ''}</small>` : ''}${f.preview ? (f.kind === 'md' ? (f.preview.kind === 'procedure' ? `<small>→ task "${esc(f.preview.title)}" · mapped: ${esc(f.preview.mapping.mapped.join('; ') || 'none')}${f.preview.mapping.unmapped.length ? ' · unmapped: ' + esc(f.preview.mapping.unmapped.join(', ')) : ''}</small>` : `<small>→ document "${esc(f.preview.title)}"</small>`) : `<small>→ ${esc(f.preview.target || 'UNKNOWN layout')} (${f.preview.rows} rows) · columns: ${esc(Object.entries(f.preview.mapping.columns).map(([k, v]) => `${k}=${v || '—'}`).join(', '))}${f.preview.mapping.unmapped.length ? ' · unmapped: ' + esc(f.preview.mapping.unmapped.join(', ')) : ''}</small>`) + (f.preview.warnings || []).map(x => `<small class="error">${esc(x)}</small>`).join('') : ''}</div>`).join('')}</div>`;
    const overrides = () => Object.fromEntries([...document.querySelectorAll('.kind-override')].map(e => [e.dataset.path, e.value]));
    $('#folderPreview')?.addEventListener('click', async () => { const r = await api('POST', '/api/import/preview', { dir: $('#folderPath').value, target: $('#folderCsvTarget').value, force: $('#folderForce').checked, overrides: overrides() }); $('#folderReport').innerHTML = r.error ? `<p class="error">${esc(r.error)}</p>` : folderReport(r); });
    $('#folderImport')?.addEventListener('click', async () => { const dir = $('#folderPath').value; if (!dir) return toast('Enter a folder path'); if (!confirm(`Import every changed .md/.csv under ${dir}?`)) return; const r = await api('POST', '/api/import/folder', { dir, target: $('#folderCsvTarget').value, force: $('#folderForce').checked, overrides: overrides() }); toast(`Imported ${r.imported}, unchanged ${r.skipped_unchanged}`); $('#folderReport').innerHTML = folderReport(r); setTimeout(refresh, 300); });
    $('#aliasSave')?.addEventListener('click', async () => { try { await api('POST', '/api/import/aliases', { headings: JSON.parse($('#aliasHeadings').value || '{}'), aliases: JSON.parse($('#aliasCols').value || '{}'), hubs: JSON.parse($('#aliasHubs').value || '{}') }); toast('Aliases saved'); refresh(); } catch (e) { toast('Invalid JSON: ' + e.message); } });
    $('#hubImport')?.addEventListener('click', async () => { const f = $('#hubFile').files[0]; if (!f) return toast('Choose the ops-hub file'); const r = await api('POST', '/api/import/opshub', { filename: f.name, content: await f.text() }); $('#hubReport').innerHTML = `<p>Imported ${r.tasks} SOPs, ${r.legacy_roles} legacy roles, ${r.people} people.${r.unassigned_roles.length ? ' Unassigned legacy roles: ' + esc(r.unassigned_roles.join(', ')) : ''}</p>`; setTimeout(refresh, 300); });
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
  function entityName(type, id) { return ({ person: () => personName(id), agent: () => agent(id)?.name, department: () => deptName(id), home: () => S.homes.find(h => h.id === id)?.address, task: () => S.tasks.find(t => t.id === id)?.title, vendor: () => S.vendors.find(v => v.id === id)?.trade, document: () => S.documents.find(d => d.id === id)?.title, integration: () => S.integrations.find(i => i.id === id)?.name }[type] || (() => id))() || id; }

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
    person: () => [{ key: 'name', label: 'Name (short)' }, { key: 'full_name', label: 'Full name' }, { key: 'title', label: 'Title (org chart)' }, { key: 'reports_to', label: 'Reports to', type: 'select', options: peopleOpts() }, { key: 'email', label: 'Email' }, { key: 'role_summary', label: 'Responsibilities (summary)', type: 'textarea' }, { key: 'departments', label: 'Departments', type: 'multiselect', options: S.departments.map(d => [d.id, d.name]) }, { key: 'responsibilities_text', label: 'Responsibilities (one per line)', type: 'textarea' }, { key: 'confirmed', label: 'Confirmed by Brittany/Jim', type: 'checkbox' }, { key: 'review_status', label: 'Responsibility review', type: 'select', options: [['not_reviewed', 'Not reviewed'], ['under_review', 'Under review'], ['verified', 'Verified']] }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'source', label: 'Source' }],
    task: () => [{ key: 'title', label: 'Title' }, { key: 'department_id', label: 'Department', type: 'select', options: deptOpts() }, { key: 'owner_id', label: 'Owner', type: 'select', options: peopleOpts() }, { key: 'backup_id', label: 'Backup', type: 'select', options: peopleOpts() }, { key: 'agent_id', label: 'Linked agent', type: 'select', options: [['', '— none —'], ...S.agents.map(a => [a.id, a.name])] }, { key: 'board', label: 'Board column', type: 'select', options: Object.entries(BOARD) }, { key: 'project_stage', label: 'Project stage (implementation tasks)', type: 'select', options: [['', '—'], ...STAGES.map(s => [s, s])] }, { key: 'trigger', label: 'Trigger' }, { key: 'inputs', label: 'Inputs', type: 'textarea' }, { key: 'steps', label: 'Steps', type: 'textarea' }, { key: 'deadline', label: 'Deadline' }, { key: 'evidence', label: 'Completion evidence' }, { key: 'approval_rules', label: 'Approval rules', type: 'textarea' }, { key: 'automation_approach', label: 'Automation approach', type: 'textarea' }, { key: 'verification_result', label: 'Verification result' }, { key: 'source_link', label: 'Source-system link' }, { key: 'missing_info', label: 'Missing information', type: 'textarea' }, { key: 'blocker', label: 'Blocker / approval needed' }, { key: 'waiting_on', label: 'Waiting on (who)' }, { key: 'next_action', label: 'Next small action' }, { key: 'supersedes_text', label: 'Supersedes (old task ids, comma separated)' }, { key: 'proposed', label: 'Proposed (not yet verified with the team)', type: 'checkbox' }, { key: 'review_note', label: 'Review note', type: 'textarea' }, { key: 'archived', label: 'Archived (hidden from board; history kept)', type: 'checkbox' }, ...(S.permissions.sensitive ? [{ key: 'sensitive', label: 'Sensitive (cash/accounting — restricted roles only)', type: 'checkbox' }] : []), { key: 'source', label: 'Source' }],
    agent: () => [{ key: 'name', label: 'Agent name' }, { key: 'department_id', label: 'Department', type: 'select', options: deptOpts() }, { key: 'purpose', label: 'Purpose', type: 'textarea' }, { key: 'initial_output', label: 'Initial output (read/flag/draft)' }, { key: 'human_authority', label: 'Human authority retained' }, { key: 'approach', label: 'Approach', type: 'select', options: [['rules', 'Ordinary rules are sufficient'], ['ai', 'AI model needed'], ['hybrid', 'Hybrid: rules + model drafting'], ['undecided', 'Undecided']] }, { key: 'approach_note', label: 'Why', type: 'textarea' }, { key: 'setup_stage', label: 'Setup maturity', type: 'select', options: SETUP_STAGES.map(s => [s, World.SETUP[s].label]) }, { key: 'enabled', label: 'Enabled (does not mean running)', type: 'checkbox' }, { key: 'paused', label: 'Paused', type: 'checkbox' }, { key: 'n8n_workflow_id', label: 'n8n workflow id (maps callbacks to this agent)' }, { key: 'next_run', label: 'Next scheduled run' }, { key: 'proposed', label: 'Proposed placeholder', type: 'checkbox' }],
    home: () => [{ key: 'address', label: 'Address' }, { key: 'job_id', label: 'MCH Job ID' }, { key: 'kind', label: 'Kind', type: 'select', options: [['home', 'Home'], ['lot', 'Lot'], ['hoa', 'HOA entity'], ['office', 'Office'], ['other', 'Other'], ['unknown', 'Unknown']] }, { key: 'active', label: 'Active', type: 'select', options: [['unknown', 'Unknown (not confirmed)'], ['active', 'Active'], ['inactive', 'Inactive / finished']] }, { key: 'stage', label: 'Construction stage' }, { key: 'permits', label: 'Permits', type: 'textarea' }, { key: 'trades', label: 'Trades', type: 'textarea' }, { key: 'issues', label: 'Open issues', type: 'textarea' }, { key: 'next_milestone', label: 'Next milestone' }, { key: 'status_cite', label: 'Status source (meeting/date)' }, { key: 'pilot', label: 'Pilot home', type: 'checkbox' }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'source', label: 'Source' }],
    decision: () => [{ key: 'date', label: 'Date (YYYY-MM-DD)', default: new Date().toISOString().slice(0, 10) }, { key: 'title', label: 'Decision' }, { key: 'reason', label: 'Reason', type: 'textarea' }, { key: 'decided_by', label: 'Decided by' }, { key: 'status', label: 'Status', type: 'select', options: [['approved', 'Approved'], ['proposed', 'Proposed'], ['superseded', 'Superseded']] }, { key: 'source', label: 'Source' }],
    department: () => [{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'setup_stage', label: 'Setup maturity', type: 'select', options: SETUP_STAGES.map(s => [s, World.SETUP[s].label]) }],
    integration: () => [{ key: 'status', label: 'Status (manual override)', type: 'select', options: [['disconnected', 'Disconnected'], ['connected', 'Connected'], ['failing', 'Failing']] }, { key: 'notes', label: 'Notes', type: 'textarea' }, ...(S.permissions.integrationConfig ? [{ key: 'config', label: 'Config (JSON; no secrets — use env vars)', type: 'textarea' }] : [])],
    vendor: () => [{ key: 'trade', label: 'Trade' }, { key: 'vendor', label: 'Current vendor' }, { key: 'rate', label: 'Current rate' }, { key: 'docs_needed', label: 'Documents to provide (one per line)', type: 'textarea' }, { key: 'notes', label: 'Notes / lead times', type: 'textarea' }],
    handover: () => [{ key: 'item', label: 'Item' }, { key: 'basis', label: 'Basis' }, { key: 'documented', label: 'Documented? (yes/partial/no/in progress)' }, { key: 'current', label: 'Current? (confirmed/unconfirmed)' }, { key: 'backup', label: 'Who else can do it today (blank = nobody)' }, { key: 'risk', label: 'Risk', type: 'select', options: [['high', 'high'], ['medium', 'medium'], ['low', 'low']] }, { key: 'why', label: 'Why this is here (what exists / what is missing)', type: 'textarea' }, { key: 'capture', label: 'Capture from Maria', type: 'textarea' }, { key: 'cite', label: 'Source / citation' }, { key: 'task_ids_text', label: 'Linked task ids (comma separated)' }, { key: 'doc_ids_text', label: 'Linked document ids (comma separated)' }, { key: 'note', label: 'Note', type: 'textarea' }],
    ai: () => [{ key: 'purpose', label: 'Purpose' }, { key: 'needs_ai', label: 'Needs AI?', type: 'select', options: [['no_rules', 'No — deterministic rules'], ['yes', 'Yes'], ['undecided', 'Undecided']] }, { key: 'provider', label: 'Provider' }, { key: 'model', label: 'Model id (verify availability first)' }, { key: 'why', label: 'Why appropriate', type: 'textarea' }, { key: 'expected_cost', label: 'Expected cost' }, { key: 'approval', label: 'Approval requirement' }, { key: 'eval_examples', label: 'Evaluation examples', type: 'textarea' }, { key: 'fallback', label: 'Fallback' }],
  };
  const TABLE = { vendor: 'vendors', handover: 'handover_items', document: 'documents', person: 'people', task: 'tasks', agent: 'agents', home: 'homes', decision: 'decisions', department: 'departments', integration: 'integrations', ai: 'ai_configs' };

  function editEntity(type, obj) {
    const values = obj ? { ...obj } : {};
    if (type === 'person') values.responsibilities_text = JSON.parse(obj?.responsibilities || '[]').join('\n');
    if (type === 'handover') { values.task_ids_text = JSON.parse(obj?.task_ids || '[]').join(', '); values.doc_ids_text = JSON.parse(obj?.doc_ids || '[]').join(', '); }
    if (type === 'task') values.supersedes_text = JSON.parse(obj?.supersedes || '[]').join(', ');
    modal((obj ? 'Edit ' : 'Add ') + type, FIELDS[type](), values, async v => { if (obj) v.id = obj.id; if (type === 'person') { v.responsibilities = v.responsibilities_text.split('\n').map(x => x.trim()).filter(Boolean); delete v.responsibilities_text; }
    if (type === 'task') { v.supersedes = (v.supersedes_text || '').split(',').map(x => x.trim()).filter(Boolean); delete v.supersedes_text; }
    if (type === 'handover') { v.task_ids = v.task_ids_text.split(',').map(x => x.trim()).filter(Boolean); v.doc_ids = v.doc_ids_text.split(',').map(x => x.trim()).filter(Boolean); delete v.task_ids_text; delete v.doc_ids_text; } await save(TABLE[type], v); });
  }
  function checkpointForm() {
    const cp = S.checkpoint || {};
    modal('Save session checkpoint', [{ key: 'stage', label: 'Project stage', type: 'select', options: STAGES.map(s => [s, s]) }, { key: 'current_step', label: 'Current step', type: 'textarea' }, { key: 'last_completed', label: 'Last completed', type: 'textarea' }, { key: 'next_action', label: 'One recommended next action', type: 'textarea' }, { key: 'waiting_on', label: 'Waiting on whom' }, { key: 'decisions_needed', label: 'Decisions needed', type: 'textarea' }, { key: 'note', label: 'Note for future you', type: 'textarea' }], cp, async v => { await api('POST', '/api/checkpoints', v); toast('Checkpoint saved'); refresh(); });
  }
  $('#addBtn').onclick = () => modal('Add', [{ key: 'kind', label: 'What do you want to add?', type: 'select', options: [['task', 'Task / procedure'], ['person', 'Person'], ['agent', 'Agent (proposed function)'], ['home', 'Home / job'], ['decision', 'Decision']] }], {}, async v => setTimeout(() => editEntity(v.kind, null), 0));

  // ---------- detail panel ----------
  function openDetail(type, id, focusWorld = true) {
    const w = S.permissions.write;
    const obj = { vendor: () => S.vendors.find(v => v.id === id), handover: () => S.handover_items.find(h => h.id === id), document: () => S.documents.find(d => d.id === id), person: () => person(id), agent: () => agent(id), department: () => dept(id), home: () => S.homes.find(h => h.id === id), task: () => S.tasks.find(t => t.id === id), decision: () => S.decisions.find(d => d.id === id), integration: () => S.integrations.find(i => i.id === id), ai: () => S.ai_configs.find(a => a.id === id), system: () => null }[type]?.();
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
        ${JSON.parse(obj.legacy_roles || '[]').length ? section('Absorbed legacy roles', JSON.parse(obj.legacy_roles).map(r => chip(r, 'gray')).join('')) : ''}
        ${JSON.parse(obj.responsibilities || '[]').length ? `<h4>Responsibilities (ops hub 10/20, ${JSON.parse(obj.responsibilities).length})</h4><ol style="margin:4px 0 8px 18px;padding:0;max-height:220px;overflow:auto;font-size:12px">${JSON.parse(obj.responsibilities).map(r => `<li>${esc(r)}</li>`).join('')}</ol>` : ''}${JSON.parse(obj.crossed_off || '[]').length ? `<h4>Crossed off by ${esc(obj.name)} (${JSON.parse(obj.crossed_off).length})</h4><ol style="margin:4px 0 8px 18px;padding:0;max-height:120px;overflow:auto;font-size:12px;color:var(--muted);text-decoration:line-through">${JSON.parse(obj.crossed_off).map(r => `<li>${esc(r)}</li>`).join('')}</ol>` : ''}
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
        ${id === 'purchasing' && S.vendors.length ? section('Vendors by trade (SOW Excel)', S.vendors.map(v => `<a href="#" data-open="vendor:${v.id}">${esc(v.trade)}</a>${v.vendor ? ' — ' + esc(v.vendor) : ''}`).join('<br>')) : ''}
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
        ${obj.step_review ? `<h4>Step-by-step review against the meetings</h4>${stepReviewTable(JSON.parse(obj.step_review))}` : ''}
        ${JSON.parse(obj.supersedes || '[]').length ? section('Supersedes (old procedure this replaces)', JSON.parse(obj.supersedes).map(id => `<a href="#" data-open="task:${id}">${esc(S.tasks.find(t => t.id === id)?.title || id)}</a>`).join('<br>')) : ''}
        ${(() => { const by = S.tasks.filter(t => JSON.parse(t.supersedes || '[]').includes(obj.id)); return by.length ? section('Superseded by (confirmed current procedure)', by.map(t => `<a href="#" data-open="task:${t.id}">${esc(t.title)}</a>`).join('<br>')) : ''; })()}
        <h4>Documents</h4>${docCards(JSON.parse(obj.doc_ids || '[]'), { task_id: obj.id })}
        ${obj.flow ? `<h4>Flow chart — ${esc(JSON.parse(obj.flow).title)} <button class="small" data-flow="${obj.id}">Open large</button></h4>${flowSvg(JSON.parse(obj.flow))}` : ''}
        ${obj.next_action ? `<div class="next-action"><b>Next small action</b><br>${esc(obj.next_action)}</div>` : ''}
        ${section('Linked agent', obj.agent_id ? `<a href="#" data-open="agent:${obj.agent_id}">${esc(agent(obj.agent_id)?.name || obj.agent_id)}</a>` : '')}
        ${section('Source', esc(obj.source))}${obj.reviewed_at ? section('Reviewed', fmt(obj.reviewed_at) + ' by ' + esc(obj.reviewed_by) + (obj.review_note ? ' — ' + esc(obj.review_note) : '')) : ''}`;
    } else if (type === 'home') {
      body = `${chip('Active: ' + obj.active, obj.active === 'active' ? 'ok' : obj.active === 'inactive' ? 'gray' : 'amber')} ${chip(obj.kind, 'gray')} ${obj.pilot ? chip('★ Pilot home', 'amber') : ''}
        ${section('MCH Job ID', obj.job_id ? `<code>${esc(obj.job_id)}</code> · <a href="http://db.mcvaugh.com/buildconnect/NewStuff/budgetform.html?ID=${esc(obj.job_id)}" target="_blank" rel="noopener">budget form</a> · <a href="http://db.mcvaugh.com/buildconnect/NewStuff/wotracking.html?archive=0&perfID=${esc(obj.job_id)}&subconid=0&filterchange=1" target="_blank" rel="noopener">work orders</a> (live McVaugh database; needs your login)` : '—')}
        ${w ? `<h4>Status</h4><div class="milestones">${[['unknown', 'Unknown'], ['active', 'Active'], ['inactive', 'Inactive']].map(([k, l]) => `<button class="${obj.active === k ? 'on' : ''}" data-set="active:${k}">${l}</button>`).join('')}<button class="${obj.pilot ? 'on' : ''}" data-toggle="pilot">★ Pilot</button></div>` : ''}
        ${section('Stage', esc(obj.stage))}${section('Permits', esc(obj.permits))}${section('Trades', esc(obj.trades))}${section('Open issues', esc(obj.issues))}${obj.next_milestone ? `<div class="next-action"><b>Next milestone</b><br>${esc(obj.next_milestone)}</div>` : ''}${section('Status source', esc(obj.status_cite))}${section('Current activity', runtimeChip(obj.runtime))}${section('Notes', esc(obj.notes))}
        ${section('Source', esc(obj.source) + (obj.imported_at ? ' · imported ' + fmt(obj.imported_at) : ''))}${manualActivity}`;
    } else if (type === 'decision') {
      body = `${chip(obj.status, obj.status === 'approved' ? 'ok' : 'amber')} <b>${esc(obj.date)}</b><p>${esc(obj.reason)}</p>${section('Decided by', esc(obj.decided_by))}${section('Source', esc(obj.source))}
        ${w && obj.status === 'proposed' ? `<div class="actions"><button class="small primary" data-set="status:approved">Approve this decision</button></div>` : ''}`;
    } else if (type === 'integration') {
      body = `${chip(obj.kind, 'gray')} ${chip(obj.status, obj.status === 'connected' ? 'ok' : obj.status === 'failing' ? 'red' : 'gray')}<p>${esc(obj.notes)}</p>${section('Last checked', fmt(obj.last_checked) + (obj.last_message ? ' — ' + esc(obj.last_message) : ''))}${section('Last import', fmt(obj.last_import_at))}${section('Config', obj.config ? `<code>${esc(obj.config)}</code>` : '')}`;
    } else if (type === 'vendor') {
      body = `${section('Current vendor', esc(obj.vendor || '—'))}${section('Current rate', obj.restricted ? chip('restricted', 'red') : esc(obj.rate || '—'))}
        ${section('Who to call', obj.restricted ? chip('restricted', 'red') : (JSON.parse(obj.contacts || '[]').map(c => `<div class="doc-card"><div class="ico">☎</div><div><b>${esc(c.name || '—')}</b><br><span class="src">${esc(c.info)}</span>${c.note ? `<br>${esc(c.note)}` : ''}</div></div>`).join('') || '<span class="empty">none listed</span>'))}
        ${section('Documents to provide for bidding', (obj.docs_needed || '').split('\n').filter(Boolean).map(d => `<li>${esc(d)}</li>`).join('') ? `<ul style="margin:4px 0 0 18px">${(obj.docs_needed || '').split('\n').filter(Boolean).map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '')}${section('Notes / lead times', esc(obj.notes))}${section('Source', esc(obj.source) + ' · ' + fmt(obj.imported_at))}`;
    } else if (type === 'handover') {
      const taskIds = JSON.parse(obj.task_ids || '[]'), docIds = JSON.parse(obj.doc_ids || '[]');
      const linkedTasks = taskIds.map(id => S.tasks.find(t => t.id === id)).filter(Boolean);
      const noBackup = !obj.backup || /^(none|nobody|n\/a|-)?\s*$/i.test(obj.backup) || /unconfirmed|nobody/i.test(obj.backup);
      body = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px">${chip(obj.risk + ' risk', obj.risk === 'high' ? 'red' : obj.risk === 'medium' ? 'amber' : 'gray')}${chip('documented: ' + obj.documented, /^yes/.test(obj.documented) ? 'ok' : /^no/.test(obj.documented) ? 'red' : 'amber')}${chip('current: ' + obj.current, /^confirmed/.test(obj.current) ? 'ok' : 'gray')}${chip(noBackup ? 'NO BACKUP TODAY' : 'backup: ' + obj.backup, noBackup ? 'red' : 'ok')}${chip(obj.status, obj.status === 'open' ? 'amber' : 'ok')}</div>
        ${obj.why ? `<h4>Why this is here — what exists and what is missing</h4><p style="margin:4px 0 8px">${esc(obj.why)}</p>` : ''}
        <div class="next-action"><b>Capture from Maria before she leaves</b><br>${esc(obj.capture)}</div>
        <h4>Documents (${docIds.length})</h4>${docCards(docIds, { handover_id: obj.id })}
        <h4>The process${linkedTasks.length > 1 ? 'es' : ''} (${linkedTasks.length})</h4>${linkedTasks.map(processBlock).join('') || '<p class="empty">No procedure linked yet — edit the item to add task ids.</p>'}
        ${section('Basis', esc(obj.basis))}${section('Source', esc(obj.cite))}${section('Note', esc(obj.note))}
        ${w ? `<h4>Status</h4><div class="milestones">${[['open', 'Open'], ['captured', 'Captured'], ['reassigned', 'Reassigned'], ['dropped', 'Dropped']].map(([k, l]) => `<button class="${obj.status === k ? 'on' : ''}" data-set="status:${k}">${l}</button>`).join('')}</div>` : ''}`;
    } else if (type === 'document') {
      body = obj.restricted ? `<p class="error">Restricted: financial document. Sign in with an accounting or admin passphrase.</p>` : `${chip(obj.kind, obj.kind === 'procedure' ? 'ok' : obj.kind === 'financial' ? 'red' : 'gray')} ${obj.sensitive ? chip('Restricted', 'red') : ''}<p class="src">${esc(obj.kind_reason || '')}</p>
        ${obj.kind === 'meeting' ? section('Meeting', `${esc(obj.meeting_date)} · attendees: ${JSON.parse(obj.attendees || '[]').map(esc).join(', ')} · cite as [${esc(obj.cite_key)} mm:ss]`) : ''}${section('Vault note', esc(obj.path))}${obj.underlying_path ? section('Real file', `<code>${esc(obj.underlying_path)}</code> — ${chip(String(obj.underlying_status || 'not followed').replace('_', ' '), obj.underlying_status === 'extracted' ? 'ok' : obj.underlying_status === 'needs_conversion' ? 'amber' : 'red')}${obj.underlying_status === 'needs_conversion' ? '<div class="src">.doc / .pdf cannot be read by the app. Save it as .docx (Word → Save As) or .html next to the original and re-run the folder import with "force".</div>' : obj.underlying_status === 'not_found' ? '<div class="src">The linked path does not exist relative to the vault on this server. Is the local-server folder mounted at the same path?</div>' : ''}`) : ''}
        ${section('Why it matters', esc(obj.summary))}${obj.hubs && JSON.parse(obj.hubs || '[]').length ? section('Topic hubs / entities', JSON.parse(obj.hubs).map(h => chip(h, 'gray')).join('') + JSON.parse(obj.entities || '[]').map(e => chip(e, 'blue')).join('')) : ''}
        ${obj.content ? `<h4>Extracted content${obj.size > 20000 ? ' (first 20,000 characters)' : ''}</h4><pre style="white-space:pre-wrap;font:12px/1.4 inherit;background:#f6f8fc;padding:8px;border-radius:8px;max-height:320px;overflow:auto">${esc(obj.content)}</pre>` : ''}${section('Linked task', obj.task_id ? `<a href="#" data-open="task:${obj.task_id}">${esc(S.tasks.find(t => t.id === obj.task_id)?.title || obj.task_id)}</a>` : '')}${section('Source', esc(obj.source) + (obj.imported_at ? ' · imported ' + fmt(obj.imported_at) : ''))}
        ${w ? `<h4>Change kind</h4><div class="milestones">${['procedure', 'org_chart', 'reference', 'dashboard', 'plan', 'legal', 'script', 'financial', 'other'].map(k => `<button class="${obj.kind === k ? 'on' : ''}" data-set="kind:${k}">${k}</button>`).join('')}</div><p class="src">Setting "procedure" here does not create a task; re-run the folder import (force) after changing kinds, or add the task manually and link it.</p>` : ''}`;
    } else if (type === 'ai') {
      body = `<p>${esc(obj.purpose)}</p>${section('Needs AI', esc(obj.needs_ai))}${section('Provider / model', esc(obj.provider) + ' ' + esc(obj.model))}${section('Why', esc(obj.why))}${section('Expected cost', esc(obj.expected_cost))}${section('Approval', esc(obj.approval))}${section('Eval examples', esc(obj.eval_examples))}${section('Fallback', esc(obj.fallback))}`;
    }
    const title = obj.name || obj.title || obj.item || obj.trade || obj.address || obj.purpose || id;
    $('#detail').innerHTML = `<header><div><div class="kind">${esc(type)}</div><h2>${esc(title)}</h2></div><div><button class="small ghost" id="closeDetail" aria-label="Close">✕</button></div></header>
      ${body}
      <h4>Activity history</h4>${history}
      <div class="actions">${w && FIELDS[type] ? `<button class="small" id="editBtn">Edit</button>` : ''}${w && ['person', 'task', 'agent', 'home', 'decision', 'document', 'vendor'].includes(type) ? `<button class="small danger" id="delBtn">Delete</button>` : ''}${type === 'department' ? `<button class="small" id="focusBtn">Focus in world</button>` : ''}</div>`;
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
    for (const [k, el] of Object.entries({ world: '#viewWorld', board: '#viewBoard', review: '#viewReview', handover: '#viewHandover', procedures: '#viewProcedures', build: '#viewBuild', workorders: '#viewWo', registry: '#viewRegistry', integrations: '#viewIntegrations', ai: '#viewAi', history: '#viewHistory' })) $(el).hidden = k !== v;
    if (v === 'world') World.overview();
    if (v === 'handover') renderHandover(true);
    if (v === 'procedures') renderProcedures();
    if (v === 'build') renderBuild();
    if (v === 'workorders') renderWorkOrders();
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
