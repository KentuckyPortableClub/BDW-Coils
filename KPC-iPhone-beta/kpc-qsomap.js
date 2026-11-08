/* KPC app: THE QSO MAP tab (Opus, Oct 26; Brandon: 'MAP we forgot a tab for the qso map and qso information').
   Every contact of the open log (or today / all) as a line from where I was (the contact's own MY grid, so a rove draws from each park)
   to where they were: their grid (FT8, the call book), else their park's pin (a downloaded park pack, or a recent spot), else the
   middle of their state. Colour = band. Beside it (below on a phone) the contact list with distance + bearing + how the spot was found;
   tap a line or a dot = the contact's card (✏️ FIX IT opens the edit sheet). Plain map with no signal, satellite + streets with signal (KPCMap). */
(function (G) {
  'use strict';
  const AP = G.KPCApp, $ = id => document.getElementById(id); if (!AP || !G.KPCMap) return;
  const esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = Object.assign({ scope: 'log', sat: false }, LS('kpcAppQmap', {}));
  /* Nov 1 (Brandon: 'map use a sat map'): start on SATELLITE + STREETS (once for everyone; KPCMap shows the plain map when there is no signal) */
  if (S.satv !== 1) { S.sat = true; S.satv = 1; try { localStorage.setItem('kpcAppQmap', JSON.stringify(S)); } catch (e) {} }
  const save = () => SV('kpcAppQmap', S);
  /* state centres (rough, for a contact we only know the state of) */
  const ST = { AL: [32.8, -86.8], AK: [61.4, -152.3], AZ: [34.2, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.5], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4],
    GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2],
    MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
    NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5],
    SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.6] };
  const BC = { '160m': '#a78bfa', '80m': '#60a5fa', '60m': '#38bdf8', '40m': '#34d399', '30m': '#a3e635', '20m': '#facc15', '17m': '#fb923c', '15m': '#f87171', '12m': '#f472b6', '10m': '#e879f9', '6m': '#c084fc', '2m': '#22d3ee', '70cm': '#2dd4bf' };
  const bc = b => BC[b] || '#e3a24a';
  const R = Math.PI / 180;
  const geo = (a, b) => { const dLa = (b.la - a.la) * R, dLo = (b.lo - a.lo) * R, h = Math.sin(dLa / 2) ** 2 + Math.cos(a.la * R) * Math.cos(b.la * R) * Math.sin(dLo / 2) ** 2;
    const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))), y = Math.sin(dLo) * Math.cos(b.la * R), x = Math.cos(a.la * R) * Math.sin(b.la * R) - Math.sin(a.la * R) * Math.cos(b.la * R) * Math.cos(dLo);
    return { km, deg: (Math.atan2(y, x) / R + 360) % 360 }; };
  const card = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];

  /* the screen */
  const main = document.querySelector('main');
  if (main && !$('scrMap')) main.insertAdjacentHTML('beforeend', `<section class="scr" id="scrMap" aria-label="Map of my contacts">
    <div class="strip qmstrip"><span class="chips" id="qmScope"></span><button type="button" class="chip" id="qmSat"></button><button type="button" class="chip" id="qmFit">⤢ ALL ON THE MAP</button></div>
    <div class="qmstats" id="qmStats"></div>
    <div class="qmwrap"><div class="qmmap"><canvas id="qmCv" aria-label="Map: lines from me to each contact"></canvas><div class="qmleg" id="qmLeg"></div></div>
      <div class="qmside"><div class="qminfo" id="qmInfo"></div><div class="list log qmlist" id="qmList" role="table" aria-label="Contacts on the map"></div></div></div>
  </section>`);
  const tabs = document.querySelector('.tabs'); if (tabs && !tabs.querySelector('[data-go="map"]')) { const st = tabs.querySelector('[data-go="station"]'); st.insertAdjacentHTML('beforebegin', '<button type="button" data-go="map"><i>🗺</i><span>MAP</span></button>'); tabs.querySelector('[data-go="map"]').onclick = () => AP.go('map'); }

  /* where each contact was */
  let PINS = {};                                   /* park ref → {la, lo} from the downloaded packs */
  async function loadPins() { if (!G.KPCParks) return; const out = {}; for (const st of Object.keys(KPCParks.have() || {})) { try { const p = await KPCParks.get(st); (p && p.parks || []).forEach(x => { if (isFinite(x.la)) out[x.ref] = { la: x.la, lo: x.lo, name: x.name }; }); } catch (e) {} } PINS = out; }
  function spotPos(call) { if (!G.KPCSpots || !KPCSpots.all) return null; const s = KPCSpots.all().filter(x => x.call === String(call).toUpperCase() && isFinite(x.la) && (x.la || x.lo)).pop(); return s ? { la: s.la, lo: s.lo } : null; }
  function there(q) {
    const g = String(q.g || '').toUpperCase();
    if (/^[A-R]{2}\d{2}[A-X]{2}/.test(g)) { const p = AP.gridLL(g); if (p) return { la: p.la, lo: p.lo, how: 'grid ' + g.slice(0, 6) }; }
    for (const r of q.refs || []) { if (PINS[r]) return { la: PINS[r].la, lo: PINS[r].lo, how: 'park ' + r + (PINS[r].name ? ' · ' + PINS[r].name : '') }; }
    if ((q.refs || []).length) { const s = spotPos(q.call); if (s) return { la: s.la, lo: s.lo, how: 'park ' + q.refs[0] + ' (spot)' }; }
    if (/^[A-R]{2}\d{2}/.test(g)) { const p = AP.gridLL(g); if (p) return { la: p.la, lo: p.lo, how: 'grid ' + g.slice(0, 4) + ' (rough)' }; }
    const st = String(q.st || '').toUpperCase(); if (ST[st]) return { la: ST[st][0], lo: ST[st][1], how: 'state ' + st + ' (middle of it)' };
    return null;
  }
  function here(q) { const g = String(q.mg || AP.myGrid() || '').toUpperCase(); const p = AP.S.pos && AP.S.pos.g === g ? AP.S.pos : AP.gridLL(g); return p ? { la: p.la, lo: p.lo } : null; }
  function list() {
    const L = G.KPCLog; if (!L) return [];
    const day = new Date().toISOString().slice(0, 10);
    const src = S.scope === 'log' ? L.shown() : S.scope === 'today' ? L.qs().filter(q => new Date(q.t).toISOString().slice(0, 10) === day) : L.qs();
    return src.filter(q => !q.d).map(q => { const a = here(q), b = there(q), g = a && b ? geo(a, b) : null; return { q, a, b, g }; }).sort((x, y) => y.q.t - x.q.t);
  }
  let ROWS = [], SEL = null, MAP = null;
  function draw() {
    if (document.body.dataset.screen !== 'map') return;
    ROWS = list(); const on = ROWS.filter(r => r.a && r.b);
    $('qmScope').innerHTML = [['log', '📒 THIS LOG'], ['today', '📅 TODAY'], ['all', '📚 ALL']].map(([k, t]) => `<button type="button" class="chip${S.scope === k ? ' on' : ''}" data-qms="${k}">${t}</button>`).join('');
    $('qmSat').textContent = S.sat ? '🗺 PLAIN MAP' : '🛰 SATELLITE + STREETS';
    const sts = new Set(ROWS.map(r => String(r.q.st || '').toUpperCase()).filter(Boolean)), pks = new Set(ROWS.flatMap(r => r.q.refs || [])), far = on.slice().sort((a, b) => b.g.km - a.g.km)[0], tot = on.reduce((a, r) => a + r.g.km, 0);
    const bands = [...new Set(ROWS.map(r => r.q.band).filter(Boolean))];
    $('qmStats').innerHTML = `<span class="kv"><i>CONTACTS</i><b>${ROWS.length}</b></span><span class="kv"><i>ON THE MAP</i><b>${on.length}</b></span><span class="kv"><i>STATES</i><b>${sts.size}</b></span><span class="kv"><i>PARKS</i><b>${pks.size}</b></span>`
      + (far ? `<span class="kv"><i>FARTHEST</i><b>${esc(far.q.call)} · ${esc(AP.dist(far.g.km))}</b></span><span class="kv"><i>ALL THE MILES</i><b>${esc(AP.dist(tot))}</b></span>` : '');
    $('qmLeg').innerHTML = bands.map(b => `<span><i style="background:${bc(b)}"></i>${esc(b)}</span>`).join('');
    $('qmList').innerHTML = ROWS.length ? ROWS.slice(0, 400).map(r => `<div class="qmr${SEL === r.q.id ? ' on' : ''}" data-qm="${esc(r.q.id)}" role="row" tabindex="0"><span class="t">${esc(AP.utc(r.q.t).slice(0, 5))}</span><span class="c"><i style="background:${bc(r.q.band)}"></i>${esc(r.q.call)}</span><span class="m">${esc(r.q.band || '')} ${esc(r.q.mode || '')}</span><span class="d">${r.g ? esc(AP.dist(r.g.km)) + ' ' + card(r.g.deg) : '<em>not on the map</em>'}</span></div>`).join('')
      : '<div class="empty">No contacts in this log yet.</div>';
    if (!MAP) { MAP = KPCMap.create($('qmCv'), { sat: S.sat, draw: paint, tap, minZ: 1 }); fit(); } else MAP.redraw();
    info();
  }
  /* the plain map (no signal needed): Natural Earth land, country borders, US / Canada state lines (kpc-world.js, loaded on first use) */
  function world(ctx, P, o) {
    const Wd = G.KPC_WORLD; ctx.fillStyle = '#0c1a22'; ctx.fillRect(0, 0, o.w, o.h); if (!Wd) return; const q = Wd.q;
    const path = (L, close) => { for (const a of L) { ctx.beginPath(); for (let i = 0; i < a.length; i += 2) { const [x, y] = P(a[i + 1] * q, a[i] * q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } if (close) ctx.closePath(); close ? ctx.fill() : ctx.stroke(); } };
    ctx.fillStyle = '#2b2116'; path(Wd.land, true);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(227,162,74,.22)'; path(Wd.states, false);
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(227,162,74,.45)'; path(Wd.borders, false);
  }
  function paint(ctx, P, z, o) {
    if (!o.sat) world(ctx, P, o);
    const on = ROWS.filter(r => r.a && r.b);
    ctx.lineCap = 'round';
    for (const r of on) { const [x1, y1] = P(r.a.la, r.a.lo), [x2, y2] = P(r.b.la, r.b.lo), sel = SEL === r.q.id;
      ctx.strokeStyle = bc(r.q.band); ctx.globalAlpha = SEL && !sel ? 0.25 : 0.85; ctx.lineWidth = sel ? 3.5 : 1.8;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.12;   /* a gentle arc, like a path through the sky */
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (const r of on) { const [x, y] = P(r.b.la, r.b.lo), sel = SEL === r.q.id; ctx.fillStyle = bc(r.q.band); ctx.strokeStyle = '#140b05'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, sel ? 7 : 4.5, 0, 7); ctx.fill(); ctx.stroke();
      if (sel || z >= 6) { ctx.font = '700 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(r.q.call, x, y - 10); ctx.fillStyle = '#fff3d6'; ctx.fillText(r.q.call, x, y - 10); } }
    const homes = new Map(); on.forEach(r => homes.set(r.a.la.toFixed(3) + ',' + r.a.lo.toFixed(3), r.a));
    if (!homes.size) { const h = here({}); if (h) homes.set('me', h); }
    for (const h of homes.values()) { const [x, y] = P(h.la, h.lo); ctx.fillStyle = '#ffcf7a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#000'; ctx.font = '800 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('ME', x, y + 3); }
  }
  function tap(la, lo, tx, ty) { let best = 26, hit = null; for (const r of ROWS) { if (!r.b) continue; const [x, y] = MAP.P(r.b.la, r.b.lo), d = Math.hypot(x - tx, y - ty); if (d < best) { best = d; hit = r; } } SEL = hit ? hit.q.id : null; draw(); scrollSel(); }
  function fit() { const pts = []; ROWS.forEach(r => { if (r.a && r.b) { pts.push([r.a.la, r.a.lo]); pts.push([r.b.la, r.b.lo]); } }); if (!pts.length) { const h = here({}); if (h) MAP.view ? MAP.view(h.la, h.lo, 5) : 0; return; } MAP.fit(pts); }
  function scrollSel() { const e = document.querySelector('.qmr.on'); if (e) e.scrollIntoView({ block: 'nearest' }); }
  function info() {
    const el = $('qmInfo'), r = ROWS.find(x => x.q.id === SEL); if (!r) { el.innerHTML = '<p class="hint">Tap a dot or a contact for its card. Lines go from where you were (your grid at that contact) to where they were: their grid, their park\'s pin, or the middle of their state. Download your state in STATION → Parks to put park contacts on their pins.</p>'; return; }
    const q = r.q;
    el.innerHTML = `<div class="qmcard"><div class="h"><b>${esc(q.call)}</b><span>${esc(q.name || '')}</span><button type="button" class="chip sm" id="qmEdit">✏️ FIX IT</button></div>
      <div class="g"><span><i>WHEN</i>${esc(new Date(q.t).toISOString().slice(0, 10))} ${esc(AP.utc(q.t).slice(0, 5))}z</span><span><i>BAND · MODE</i>${esc(q.band || '')} ${q.khz ? (q.khz / 1000).toFixed(q.khz % 1 ? 4 : 3) : ''} ${esc(q.mode || '')}</span>
      <span><i>REPORTS</i>${esc(q.rs || '—')} / ${esc(q.rr || '—')}</span><span><i>THEIR PARK</i>${esc((q.refs || []).join(' + ') || '—')}</span><span><i>MY PARK</i>${esc((q.myrefs || []).join(' + ') || '—')}</span>
      <span><i>WHERE</i>${esc([q.cn, q.st].filter(Boolean).join(', ') || (q.g || '—'))}</span><span><i>DISTANCE</i>${r.g ? esc(AP.dist(r.g.km)) + ' · ' + Math.round(r.g.deg) + '° ' + card(r.g.deg) : '—'}</span><span><i>ON THE MAP BY</i>${esc(r.b ? r.b.how : 'not known yet')}</span></div>
      ${q.note ? '<p class="hint">📝 ' + esc(q.note) + '</p>' : ''}</div>`;
    $('qmEdit').onclick = () => { if (G.KPCLog && KPCLog.editSheet) KPCLog.editSheet(q.id); };
  }
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-qms]'); if (s) { S.scope = s.dataset.qms; save(); SEL = null; draw(); if (MAP) fit(); return; }
    const r = e.target.closest('[data-qm]'); if (r) { SEL = SEL === r.dataset.qm ? null : r.dataset.qm; draw(); const x = ROWS.find(y => y.q.id === SEL); if (x && x.a && x.b && MAP) MAP.fit([[x.a.la, x.a.lo], [x.b.la, x.b.lo]]); }
  });
  $('qmSat').onclick = () => { S.sat = !S.sat; save(); if (MAP) MAP.sat(S.sat); draw(); };
  $('qmFit').onclick = () => { SEL = null; draw(); if (MAP) fit(); };
  let WL = false; const loadWorld = () => { if (WL || G.KPC_WORLD) return; WL = true; const sc = document.createElement('script'); sc.src = 'kpc-world.js?v=20261026d'; sc.onload = () => { if (MAP) MAP.redraw(); }; document.head.appendChild(sc); };
  AP.on('screen', s => { if (s === 'map') { loadWorld(); loadPins().then(() => { draw(); if (MAP) { MAP.redraw(); fit(); } }); } });
  AP.on('log', () => { if (document.body.dataset.screen === 'map') draw(); });
  G.KPCQsoMap = { draw, rows: () => ROWS, there, S };
})(window);
