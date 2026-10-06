// Isometric campus renderer (plain SVG, no libraries).
// Setup maturity and runtime activity are drawn from server state only; nothing here invents activity.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const TW = 64, TH = 32;           // iso tile width/height in px
  const PLOT = 8, GAP = 3;        // plot size in tiles
  const iso = (x, y, z = 0) => [(x - y) * TW / 2, (x + y) * TH / 2 - z];

  const SETUP = {
    not_reviewed:         { label: 'Not reviewed',          badge: null,  sat: 0,   dashed: true },
    under_review:         { label: 'Under review',          badge: '…',   sat: 0,   dashed: false, amber: true },
    documented:           { label: 'Procedure documented',  badge: '1/3', sat: .45 },
    automation_built:     { label: 'Automation built',      badge: '2/3', sat: .7 },
    verification_pending: { label: 'Verification pending',  badge: '⧗',   sat: .85, purple: true },
    ready:                { label: 'Ready',                 badge: '✓',   sat: 1,   ready: true },
  };
  const RUNTIME = {
    idle: { label: 'Idle' }, not_setup: { label: 'Not set up' }, running: { label: 'Running' }, waiting: { label: 'Waiting for approval', color: '#e0a21b', icon: '⏳' },
    failed: { label: 'Blocked / failed', color: '#e24b4a', icon: '!' }, paused: { label: 'Paused', icon: '⏸' }, stale: { label: 'Stale data', color: '#e24b4a', icon: '⚠' },
    disconnected: { label: 'Disconnected', color: '#e24b4a', icon: '⚠' }, workflow_not_reviewed: { label: 'Workflow not reviewed' },
  };

  let svg, root, onSelect, view = { x: 0, y: 0, w: 1000, h: 600 }, bounds = {}, state = null, dragging = null;

  function el(tag, attrs = {}, children = []) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
    for (const c of children) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }
  const poly = (pts, attrs) => el('polygon', { points: pts.map(p => p.join(',')).join(' '), ...attrs });
  const hsl = (h, s, l) => `hsl(${h} ${Math.round(s * 100)}% ${l}%)`;
  const colorFor = (hue, stage) => { const s = SETUP[stage] || SETUP.not_reviewed; return s.sat === 0 ? { top: '#e9edf4', left: '#cfd6e2', right: '#dde3ec', stroke: '#9aa5b8' } : { top: hsl(hue, .55 * s.sat + .05, 72), left: hsl(hue, .5 * s.sat + .05, 48), right: hsl(hue, .5 * s.sat + .05, 60), stroke: hsl(hue, .5, 38) }; };

  // ----- primitives -----
  function box(x, y, w, d, h, c, dashed) {
    const g = el('g');
    const stroke = { stroke: c.stroke, 'stroke-width': 1.2, 'stroke-dasharray': dashed ? '4 3' : null, 'stroke-linejoin': 'round' };
    g.appendChild(poly([iso(x, y + d, 0), iso(x + w, y + d, 0), iso(x + w, y + d, h), iso(x, y + d, h)], { fill: c.left, ...stroke }));
    g.appendChild(poly([iso(x + w, y, 0), iso(x + w, y + d, 0), iso(x + w, y + d, h), iso(x + w, y, h)], { fill: c.right, ...stroke }));
    g.appendChild(poly([iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h)], { fill: c.top, ...stroke }));
    return g;
  }
  function house(x, y, size, c, dashed, pitched = true) {
    const g = box(x, y, size, size, size * 18, c, dashed);
    if (pitched) {
      const h = size * 18, r = size * 14;
      const [ax, ay] = iso(x, y, h), [bx, by] = iso(x + size, y, h), [cx, cy] = iso(x + size, y + size, h), [dx, dy] = iso(x, y + size, h);
      const [rx1, ry1] = iso(x, y + size / 2, h + r), [rx2, ry2] = iso(x + size, y + size / 2, h + r);
      g.appendChild(poly([[ax, ay], [bx, by], [rx2, ry2], [rx1, ry1]], { fill: c.left, stroke: c.stroke, 'stroke-width': 1, 'stroke-dasharray': dashed ? '4 3' : null }));
      g.appendChild(poly([[dx, dy], [cx, cy], [rx2, ry2], [rx1, ry1]], { fill: c.top, stroke: c.stroke, 'stroke-width': 1, 'stroke-dasharray': dashed ? '4 3' : null }));
    }
    return g;
  }
  function badge(cx, cy, text, fill, textColor = '#fff') {
    return el('g', {}, [el('circle', { cx, cy, r: 9, fill, stroke: '#fff', 'stroke-width': 1.5 }), el('text', { x: cx, y: cy + 3.5, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: textColor }, [text])]);
  }
  function label(x, y, text, cls = 'lbl', anchor = 'middle') { return el('text', { x, y, class: cls, 'text-anchor': anchor }, [text]); }
  function setupBadge(cx, cy, stage) {
    const s = SETUP[stage] || SETUP.not_reviewed; if (!s.badge) return null;
    return badge(cx, cy, s.badge, s.ready ? '#1d9e75' : s.purple ? '#8b5cf6' : s.amber ? '#e0a21b' : '#5b7cfa');
  }
  function runtimeOverlay(cx, cy, rt, r = 14) {
    const g = el('g');
    const R = RUNTIME[rt.status] || RUNTIME.idle;
    if (['waiting', 'failed', 'stale', 'disconnected'].includes(rt.status)) g.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: R.color, 'stroke-width': 3, class: 'ring' }));
    if (R.icon) g.appendChild(badge(cx + r - 2, cy - r + 2, R.icon, R.color || '#9aa5b8'));
    if (rt.status === 'running') {
      const gear = el('g', { class: 'gear' }, [el('circle', { cx: cx + r - 2, cy: cy - r + 2, r: 7, fill: '#1d9e75', stroke: '#fff', 'stroke-width': 1.5 }), el('path', { d: `M${cx + r - 2 - 4},${cy - r + 2} h8 M${cx + r - 2},${cy - r + 2 - 4} v8`, stroke: '#fff', 'stroke-width': 2 })]);
      g.appendChild(gear);
      if (rt.label) g.appendChild(label(cx, cy - r - 10, (rt.source === 'demo' ? 'DEMO · ' : rt.source === 'manual' ? 'Manual · ' : rt.source === 'n8n' ? 'n8n · ' : '') + rt.label.slice(0, 34), 'lbl small'));
    }
    return g;
  }

  // ----- tokens -----
  function personToken(p, px, py, hue) {
    const rt = p.runtime || {};
    const g = el('g', { class: `entity token person ${rt.status || ''}`, tabindex: 0, 'data-type': 'person', 'data-id': p.id, transform: `translate(${px},${py})` });
    const body = el('g', { class: 'bob' });
    const verified = p.review_status === 'verified';
    body.appendChild(el('ellipse', { cx: 0, cy: 10, rx: 10, ry: 4, fill: 'rgba(0,0,0,.15)' }));
    body.appendChild(el('path', { d: 'M-8,8 Q-8,-6 0,-6 Q8,-6 8,8 Z', fill: hsl(hue, .55, 55), stroke: verified ? '#1d9e75' : '#3b4a66', 'stroke-width': verified ? 2 : 1.2 }));
    body.appendChild(el('circle', { cx: 0, cy: -12, r: 6.5, fill: '#f6d8c0', stroke: '#3b4a66', 'stroke-width': 1.2 }));
    g.appendChild(body);
    g.appendChild(el('circle', { class: 'hitbox', cx: 0, cy: -2, r: 14, fill: 'transparent', stroke: 'transparent' }));
    g.appendChild(runtimeOverlay(0, -2, rt, 14));
    if (verified) g.appendChild(badge(10, 6, '✓', '#1d9e75'));
    else if (p.review_status === 'under_review') g.appendChild(badge(10, 6, '…', '#e0a21b'));
    g.appendChild(label(0, 24, p.name, 'lbl'));
    g.appendChild(label(0, 34, rt.status === 'workflow_not_reviewed' ? 'Person · workflow not reviewed' : 'Person · ' + (RUNTIME[rt.status]?.label || ''), 'lbl small'));
    return g;
  }
  function agentToken(a, px, py, hue) {
    const rt = a.runtime || {}; const s = SETUP[a.setup_stage] || SETUP.not_reviewed;
    const g = el('g', { class: `entity token agent ${rt.status || ''}`, tabindex: 0, 'data-type': 'agent', 'data-id': a.id, transform: `translate(${px},${py})`, opacity: rt.status === 'paused' ? .55 : 1 });
    const body = el('g', { class: 'bob' });
    const fill = s.sat === 0 ? '#eef1f6' : hsl(hue, .45 * s.sat + .1, 60);
    body.appendChild(el('ellipse', { cx: 0, cy: 10, rx: 11, ry: 4, fill: 'rgba(0,0,0,.15)' }));
    body.appendChild(poly([[-10, -4], [0, -10], [10, -4], [10, 6], [0, 12], [-10, 6]], { fill, stroke: s.sat === 0 ? '#9aa5b8' : hsl(hue, .5, 35), 'stroke-width': 1.5, 'stroke-dasharray': s.dashed ? '3 2' : null }));
    body.appendChild(el('rect', { x: -6, y: -3, width: 12, height: 5, rx: 2, fill: '#1b2436', opacity: s.sat === 0 ? .35 : .85 }));
    body.appendChild(el('circle', { cx: -3, cy: -.5, r: 1.3, fill: '#8ef0c8' })); body.appendChild(el('circle', { cx: 3, cy: -.5, r: 1.3, fill: '#8ef0c8' }));
    body.appendChild(el('line', { x1: 0, y1: -10, x2: 0, y2: -15, stroke: '#3b4a66', 'stroke-width': 1.5 })); body.appendChild(el('circle', { cx: 0, cy: -16, r: 2, fill: s.sat === 0 ? '#9aa5b8' : '#5b7cfa' }));
    g.appendChild(body);
    g.appendChild(el('circle', { class: 'hitbox', cx: 0, cy: 0, r: 15, fill: 'transparent', stroke: 'transparent' }));
    g.appendChild(runtimeOverlay(0, 0, rt, 15));
    const sb = setupBadge(-11, 8, a.setup_stage); if (sb) g.appendChild(sb);
    g.appendChild(label(0, 26, a.name, 'lbl'));
    g.appendChild(label(0, 36, `Agent (${a.proposed ? 'proposed' : 'active'}) · ${s.label}`, 'lbl small'));
    return g;
  }

  // ----- plots -----
  function departmentPlot(d, people, agents) {
    const ox = d.gx * (PLOT + GAP), oy = d.gy * (PLOT + GAP);
    const s = SETUP[d.setup_stage] || SETUP.not_reviewed;
    const c = colorFor(d.hue, d.setup_stage);
    const g = el('g', { class: 'plot' });
    // platform
    g.appendChild(poly([iso(ox, oy, 0), iso(ox + PLOT, oy, 0), iso(ox + PLOT, oy + PLOT, 0), iso(ox, oy + PLOT, 0)], { fill: s.sat === 0 ? '#e4e9f1' : hsl(d.hue, .35, 90), stroke: s.sat === 0 ? '#b8c2d3' : hsl(d.hue, .35, 70), 'stroke-width': 1.5, 'stroke-dasharray': s.dashed ? '6 4' : null }));
    g.appendChild(poly([iso(ox, oy + PLOT, 0), iso(ox + PLOT, oy + PLOT, 0), iso(ox + PLOT, oy + PLOT, -8), iso(ox, oy + PLOT, -8)], { fill: '#c9d2e0' }));
    g.appendChild(poly([iso(ox + PLOT, oy, 0), iso(ox + PLOT, oy + PLOT, 0), iso(ox + PLOT, oy + PLOT, -8), iso(ox + PLOT, oy, -8)], { fill: '#d7dfeb' }));
    // building (clickable department)
    const bg = el('g', { class: `entity ${d.runtime?.status || ''}`, tabindex: 0, 'data-type': 'department', 'data-id': d.id });
    const BX = ox + 1.5, BY = oy + 1, BW = 4, BD = 2.6, BH = 52;
    bg.appendChild(box(BX, BY, BW, BD, BH, c, s.dashed));
    // windows on the right-hand face and a door on the front face
    const win = (pts, op) => poly(pts, { fill: '#ffffff', opacity: op, stroke: c.stroke, 'stroke-width': .5 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const y0 = BY + .35 + i * .8, z0 = BH - 16 - j * 18; bg.appendChild(win([iso(BX + BW, y0, z0), iso(BX + BW, y0 + .45, z0), iso(BX + BW, y0 + .45, z0 + 11), iso(BX + BW, y0, z0 + 11)], s.sat === 0 ? .5 : .85)); }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const x0 = BX + .35 + i * .9, z0 = BH - 16 - j * 18; bg.appendChild(win([iso(x0, BY + BD, z0), iso(x0 + .45, BY + BD, z0), iso(x0 + .45, BY + BD, z0 + 11), iso(x0, BY + BD, z0 + 11)], s.sat === 0 ? .5 : .85)); }
    bg.appendChild(poly([iso(BX + BW - 1.1, BY + BD, 0), iso(BX + BW - .5, BY + BD, 0), iso(BX + BW - .5, BY + BD, 16), iso(BX + BW - 1.1, BY + BD, 16)], { fill: s.sat === 0 ? '#b8c2d3' : hsl(d.hue, .4, 30) }));
    const [tx, ty] = iso(BX + BW / 2, BY + BD / 2, BH);
    bg.appendChild(el('polygon', { class: 'hitbox', points: [iso(BX, BY, BH), iso(BX + BW, BY, BH), iso(BX + BW, BY + BD, BH), iso(BX + BW, BY + BD, 0), iso(BX, BY + BD, 0), iso(BX, BY, BH)].map(p => p.join(',')).join(' '), fill: 'transparent', stroke: 'transparent' }));
    const sb = setupBadge(tx + 44, ty - 6, d.setup_stage); if (sb) bg.appendChild(sb);
    if (s.amber) bg.appendChild(el('circle', { cx: tx + 44, cy: ty - 6, r: 12, fill: 'none', stroke: '#e0a21b', 'stroke-width': 3, 'stroke-dasharray': '38 38' }));
    bg.appendChild(runtimeOverlay(tx, ty - 44, d.runtime || {}, 0));
    // sign board on the roof
    bg.appendChild(el('rect', { x: tx - 92, y: ty - 44, width: 184, height: 34, rx: 8, fill: '#ffffffee', stroke: c.stroke, 'stroke-width': 1 }));
    bg.appendChild(label(tx, ty - 29, d.name, 'lbl dept'));
    bg.appendChild(label(tx, ty - 16, s.label + (d.id === 'accounting' ? ' · restricted' : ''), 'lbl small'));
    g.appendChild(bg);
    // tokens: people along the front row, agents along the right edge
    const tokens = [];
    people.forEach((p, i) => { const [px, py] = iso(ox + 1 + (i % 4) * 1.5, oy + 6.4 - Math.floor(i / 4) * 1.6, 0); tokens.push({ depth: py, node: personToken(p, px, py, d.hue) }); });
    agents.forEach((a, i) => { const [px, py] = iso(ox + 7, oy + 1 + i * 2.4, 0); tokens.push({ depth: py, node: agentToken(a, px, py, d.hue) }); });
    tokens.sort((a, b) => a.depth - b.depth).forEach(t => g.appendChild(t.node));
    const [bx0, by0] = iso(ox, oy, 60), [bx1, by1] = iso(ox + PLOT, oy + PLOT, -60);
    const [lx] = iso(ox, oy + PLOT), [rx] = iso(ox + PLOT, oy);
    bounds[d.id] = { x: lx - 40, y: by0 - 60, w: rx - lx + 80, h: by1 - by0 + 100 };
    return g;
  }

  function neighborhood(homes, originX, originY) {
    const g = el('g');
    const cols = 6, cell = 1.9;
    const rows = Math.ceil(homes.length / cols) || 1;
    const W = cols * cell + 1, H = rows * cell + 1;
    g.appendChild(poly([iso(originX, originY), iso(originX + W, originY), iso(originX + W, originY + H), iso(originX, originY + H)], { fill: '#e8f5e4', stroke: '#b7d8ae', 'stroke-width': 1.5 }));
    const [tx, ty] = iso(originX + W / 2, originY, 0);
    g.appendChild(label(tx, ty - 24, 'Project neighborhood', 'lbl dept'));
    g.appendChild(label(tx, ty - 12, `${homes.length} jobs from snapshot · active status unconfirmed unless marked`, 'lbl small'));
    homes.forEach((h, i) => {
      const x = originX + .5 + (i % cols) * cell, y = originY + .5 + Math.floor(i / cols) * cell;
      const hue = h.pilot ? 45 : h.active === 'active' ? 205 : 210;
      const stage = h.active === 'active' ? 'ready' : 'not_reviewed';
      const c = h.active === 'inactive' ? { top: '#f3f5f8', left: '#e3e7ee', right: '#eceff4', stroke: '#c5cdd9' } : colorFor(hue, stage);
      if (h.pilot) Object.assign(c, { top: '#ffe08a', left: '#e0a21b', right: '#f4c14b', stroke: '#9c6b00' });
      const eg = el('g', { class: `entity ${h.runtime?.status || ''}`, tabindex: 0, 'data-type': 'home', 'data-id': h.id });
      if (h.kind === 'lot') eg.appendChild(poly([iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], { fill: '#d9ead3', stroke: '#8fbf7f', 'stroke-dasharray': '3 2' }));
      else eg.appendChild(house(x, y, 1, c, stage === 'not_reviewed' && !h.pilot, h.kind !== 'other' && h.kind !== 'hoa'));
      const [cx, cy] = iso(x + .5, y + .5, 30);
      eg.appendChild(el('circle', { class: 'hitbox', cx, cy: cy + 8, r: 22, fill: 'transparent', stroke: 'transparent' }));
      if (h.pilot) eg.appendChild(badge(cx + 14, cy - 10, '★', '#e0a21b'));
      eg.appendChild(runtimeOverlay(cx, cy, h.runtime || {}, 16));
      eg.appendChild(label(cx, cy + 32, h.address.length > 22 ? h.address.slice(0, 21) + '…' : h.address, 'lbl small'));
      g.appendChild(eg);
    });
    const [lx, ly0] = iso(originX, originY + H), [rx] = iso(originX + W, originY), [, ty0] = iso(originX, originY, 60), [, by1] = iso(originX + W, originY + H);
    bounds.neighborhood = { x: lx - 40, y: ty0 - 40, w: rx - lx + 80, h: by1 - ty0 + 80 };
    return g;
  }

  // ----- public API -----
  function init(svgEl, opts) {
    svg = svgEl; onSelect = opts.onSelect;
    root = el('g'); svg.appendChild(root);
    // pointer capture retargets the click to the svg, so remember the entity under the pointer at pointerdown
    svg.addEventListener('click', e => { const t = (dragging && dragging.target) || e.target.closest('.entity'); if (t && !(dragging && dragging.moved)) onSelect(t.dataset.type, t.dataset.id); });
    svg.addEventListener('keydown', e => { const t = e.target.closest('.entity'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(t.dataset.type, t.dataset.id); } });
    svg.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target.closest('.entity') }; svg.classList.add('dragging'); svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (!dragging) return; const k = view.w / svg.clientWidth; const dx = (e.clientX - dragging.x) * k, dy = (e.clientY - dragging.y) * k; if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true; view.x = dragging.vx - dx; view.y = dragging.vy - dy; apply(); });
    const end = () => { svg.classList.remove('dragging'); setTimeout(() => { dragging = null; }, 0); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY > 0 ? 1.12 : 1 / 1.12; const r = svg.getBoundingClientRect(); const mx = view.x + (e.clientX - r.left) / r.width * view.w, my = view.y + (e.clientY - r.top) / r.height * view.h; view.w *= f; view.h *= f; view.x = mx - (mx - view.x) * f; view.y = my - (my - view.y) * f; apply(); }, { passive: false });
  }
  function apply() { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function fit(b, pad = 1) {
    const ar = svg.clientWidth / Math.max(1, svg.clientHeight);
    let w = b.w * pad, h = b.h * pad; if (w / h < ar) w = h * ar; else h = w / ar;
    view = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }; apply();
  }
  function render(s) {
    state = s; root.replaceChildren(); bounds = {};
    const byDept = id => ({ people: s.people.filter(p => (p.departments || []).includes(id)), agents: s.agents.filter(a => a.department_id === id) });
    // roads
    const maxGx = Math.max(...s.departments.map(d => d.gx)), maxGy = Math.max(...s.departments.map(d => d.gy));
    const roads = el('g');
    for (let gy = 0; gy <= maxGy + 1; gy++) { const y = gy * (PLOT + GAP) - GAP / 2; roads.appendChild(poly([iso(-GAP, y - .3), iso((maxGx + 1) * (PLOT + GAP), y - .3), iso((maxGx + 1) * (PLOT + GAP), y + .3), iso(-GAP, y + .3)], { fill: '#d5dced' })); }
    for (let gx = 0; gx <= maxGx + 1; gx++) { const x = gx * (PLOT + GAP) - GAP / 2; roads.appendChild(poly([iso(x - .3, -GAP), iso(x + .3, -GAP), iso(x + .3, (maxGy + 1) * (PLOT + GAP)), iso(x - .3, (maxGy + 1) * (PLOT + GAP))], { fill: '#d5dced' })); }
    root.appendChild(roads);
    const plots = [...s.departments].sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy) || a.gy - b.gy);
    for (const d of plots) { const { people, agents } = byDept(d.id); root.appendChild(departmentPlot(d, people, agents)); }
    // unassigned people/agents go to an "unassigned" lawn
    const unP = s.people.filter(p => !(p.departments || []).some(id => s.departments.find(d => d.id === id)));
    const unA = s.agents.filter(a => !s.departments.find(d => d.id === a.department_id));
    if (unP.length || unA.length) root.appendChild(departmentPlot({ id: '_unassigned', name: 'Unassigned', hue: 0, gx: maxGx + 1, gy: 0, setup_stage: 'not_reviewed', runtime: {} }, unP, unA));
    const homesVisible = s.homes.filter(h => h.active !== 'inactive');
    root.appendChild(neighborhood(homesVisible, (maxGx + 1) * (PLOT + GAP) + 1, 0));
    const all = Object.values(bounds);
    bounds._all = { x: Math.min(...all.map(b => b.x)), y: Math.min(...all.map(b => b.y)), w: 0, h: 0 };
    bounds._all.w = Math.max(...all.map(b => b.x + b.w)) - bounds._all.x; bounds._all.h = Math.max(...all.map(b => b.y + b.h)) - bounds._all.y;
    if (!svg.getAttribute('viewBox')) overview(); else apply();
  }
  function overview() { fit(bounds._all, 1.04); }
  function focus(id) { const b = bounds[id] || bounds._all; fit(b, 1.1); }
  function zoom(f) { const cx = view.x + view.w / 2, cy = view.y + view.h / 2; view.w *= f; view.h *= f; view.x = cx - view.w / 2; view.y = cy - view.h / 2; apply(); }

  window.World = { init, render, overview, focus, zoom, SETUP, RUNTIME };
})();
