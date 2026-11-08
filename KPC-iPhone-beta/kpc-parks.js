/* KPC app: OFFLINE PARK PACKS (Fable, Oct 22; Brandon: 'our biggest edge'). STATION → Parks: download a state once
   (Kentucky comes with every park's outline, labelled official or approximate; other states come with pins) and the app
   keeps it on the phone. AM I IN THE PARK then works from GPS with no signal; NEXT PARK lists what is close, with
   directions handed to the phone's maps app. The packs are built on the website side (.github/scripts/build_app_pack.js). */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const AP = G.KPCApp, esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const URL0 = 'https://kentuckyportableclub.github.io/KPC-Links/app/packs/';
  const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  const HAVE = LS('kpcPacks', {});                          /* state → {when, parks, outlines, bytes} */
  const PK = {};                                            /* state → the pack, once read */
  let IDB = null;
  function open() { return IDB ? Promise.resolve(IDB) : new Promise(res => { if (!G.indexedDB) { res(null); return; } let r; try { r = indexedDB.open('kpc-parks', 1); } catch (e) { res(null); return; } r.onupgradeneeded = () => { r.result.createObjectStore('pack'); }; r.onsuccess = () => { IDB = r.result; res(IDB); }; r.onerror = () => res(null); }); }
  async function get(st) { if (PK[st]) return PK[st]; const db = await open(); if (!db) return null; return new Promise(res => { try { const rq = db.transaction('pack').objectStore('pack').get(st); rq.onsuccess = () => { if (rq.result) PK[st] = rq.result; res(rq.result || null); }; rq.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function put(st, pack) { const db = await open(); if (!db) return false; PK[st] = pack; return new Promise(res => { try { const tx = db.transaction('pack', 'readwrite'); tx.objectStore('pack').put(pack, st); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } }); }
  async function del(st) { const db = await open(); delete PK[st]; delete HAVE[st]; SV('kpcPacks', HAVE); if (!db) return; await new Promise(res => { try { const tx = db.transaction('pack', 'readwrite'); tx.objectStore('pack').delete(st); tx.oncomplete = res; tx.onerror = res; } catch (e) { res(); } }); draw(); }

  /* ---------------- geometry ---------------- */
  function inRing(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi) ins = !ins; } return ins; }
  const polys = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  function inside(la, lo, g) { for (const p of polys(g)) { if (!p.length || !inRing(lo, la, p[0])) continue; if (p.slice(1).some(h => inRing(lo, la, h))) continue; return true; } return false; }
  function edgeKm(la, lo, g) {
    const sx = 111.195 * Math.cos(la * Math.PI / 180), sy = 111.195; let best = Infinity;
    for (const p of polys(g)) for (const r of p) for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i], dx = (b[0] - a[0]) * sx, dy = (b[1] - a[1]) * sy, x = (lo - a[0]) * sx, y = (la - a[1]) * sy, t = Math.max(0, Math.min(1, (x * dx + y * dy) / ((dx * dx + dy * dy) || 1))), d = Math.hypot(x - t * dx, y - t * dy); if (d < best) best = d; }
    return best;
  }
  const geo = (la1, lo1, la2, lo2) => G.KPCAX25 ? KPCAX25.geo(la1, lo1, la2, lo2) : { km: 111.195 * Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(la1 * Math.PI / 180)), deg: 0 };
  const dirOf = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];

  /* ---------------- what is here ---------------- */
  async function loaded() { const out = []; for (const st of Object.keys(HAVE)) { const p = await get(st); if (p) out.push(p); } return out; }
  async function whereAmI(la, lo) {
    const packs = await loaded(), inside_ = [], near = [];
    for (const pk of packs) {
      for (const p of pk.parks) {
        const g = geo(la, lo, p.la, p.lo), ol = pk.outlines[p.ref] || [];
        let inn = null, edge = Infinity;
        for (const o of ol) { if (inside(la, lo, o.g)) { inn = o; break; } const e = edgeKm(la, lo, o.g); if (e < edge) edge = e; }
        if (inn) inside_.push({ ref: p.ref, name: p.name, src: inn.src, layer: inn.layer, agency: inn.agency, note: inn.note, km: g.km });
        else if (g.km < 80) near.push({ ref: p.ref, name: p.name, km: g.km, deg: g.deg, edge: ol.length ? edge : null, hasOutline: !!ol.length, ap: p.ap || [], la: p.la, lo: p.lo, kind: p.kind });
      }
    }
    near.sort((a, b) => (a.edge != null ? Math.min(a.edge, a.km) : a.km) - (b.edge != null ? Math.min(b.edge, b.km) : b.km));
    return { inside: inside_, near: near.slice(0, 15), packs: packs.map(p => p.state) };
  }
  const worked = ref => G.KPCLog ? (KPCLog.hunted ? KPCLog.hunted(ref) : [...KPCLog.all().values()].some(q => !q.d && (q.refs || []).includes(ref))) : false;   /* + my POTA hunter file */
  const activated = ref => G.KPCLog ? (KPCLog.activated ? KPCLog.activated(ref) : [...KPCLog.all().values()].some(q => !q.d && (q.myrefs || []).includes(ref))) : false;
  async function name(ref) { for (const st of Object.keys(HAVE)) { const p = await get(st); const x = p && p.parks.find(q => q.ref === ref); if (x) return x.name; } return ''; }

  /* ---------------- download ---------------- */
  async function download(st) {
    st = String(st || '').toUpperCase(); if (!STATES.includes(st)) return false;
    AP.toast('Downloading ' + st + '…', 60000);
    try {
      /* Oct 22 (Brandon: the phone did not download, the PC did): the app's own HTTP first (no browser rules in the way), the page's fetch second */
      const url = URL0 + 'US-' + st + '.json?v=' + Date.now().toString(36).slice(0, 6);
      let txt = '', why = '';
      if (AP.net.canRaw()) { const r = await AP.net.raw(url, { ms: 90000 }); if (r.ok) txt = r.text; else why = r.err || ('HTTP ' + r.status); }
      if (!txt) { try { const r = await AP.net.fetch(url, {}, 90000); if (!r.ok) throw new Error('HTTP ' + r.status); txt = await r.text(); } catch (e) { throw new Error((why ? why + '; then ' : '') + (e.message || e)); } }
      let pack; try { pack = JSON.parse(txt); } catch (e) { throw new Error('the file came down broken (' + txt.length + ' bytes)'); }
      if (!pack || !pack.parks) throw new Error('not a park pack');
      await put(st, pack); HAVE[st] = { when: Date.now(), parks: pack.parks.length, outlines: Object.keys(pack.outlines || {}).length, bytes: JSON.stringify(pack).length }; SV('kpcPacks', HAVE);
      AP.toast('✅ ' + st + ' is on this device: ' + pack.parks.length + ' parks' + (HAVE[st].outlines ? ', ' + HAVE[st].outlines + ' with outlines' : ' (pins only)') + '. Works with no signal now.', 6000, 'log');
      draw(); return true;
    } catch (e) { AP.toast('Could not download ' + st + ': ' + esc(e.message || e) + (AP.net.online() ? '' : ' (this device says it is offline)'), 8000, 'bad'); console.warn('pack', st, e); return false; }
  }

  /* ---------------- the card ---------------- */
  function draw() {
    const el = $('pkList'); if (!el) return;
    const L = Object.keys(HAVE).sort();
    el.innerHTML = L.length ? L.map(st => `<div class="op"><b>${st}</b> <i>${HAVE[st].parks} parks${HAVE[st].outlines ? ' · ' + HAVE[st].outlines + ' outlines' : ' · pins only'} · ${(HAVE[st].bytes / 1e6).toFixed(1)} MB · ${new Date(HAVE[st].when).toISOString().slice(0, 10)}</i><button type="button" class="ic sm" data-pkdel="${st}">✕</button></div>`).join('')
      : '<p class="hint">Nothing downloaded yet. Pick a state and press DOWNLOAD while you have signal; it stays on this device.</p>';
    el.querySelectorAll('[data-pkdel]').forEach(b => { b.onclick = () => del(b.dataset.pkdel); });
    const sel = $('pkState'); if (sel && !sel.options.length) sel.innerHTML = STATES.map(s => `<option value="${s}"${s === 'KY' ? ' selected' : ''}>${s}${s === 'KY' ? ' (with outlines)' : ''}</option>`).join('');
    ['pkHere', 'pkNext', 'pkMap'].forEach(id => { const b = $(id); if (b) { b.disabled = !L.length; b.title = L.length ? '' : 'Download a state first.'; } });
  }
  /* where am I: the GPS, or on a PC with none, the grid square typed in MY STATION (its centre: rough, and the answer says so) */
  const gridCenter = g => { g = String(g || '').toUpperCase(); if (g.length < 4) return null; const lon = (g.charCodeAt(0) - 65) * 20 - 180 + (+g[2]) * 2 + (g.length >= 6 ? (g.charCodeAt(4) - 65) / 12 + 1 / 24 : 1), lat = (g.charCodeAt(1) - 65) * 10 - 90 + (+g[3]) + (g.length >= 6 ? (g.charCodeAt(5) - 65) / 24 + 1 / 48 : 0.5); return { la: lat, lo: lon, acc: g.length >= 6 ? 3000 : 50000, grid: g }; };
  async function gps() { try { return await AP.gps({ maxAge: 15000 }); } catch (e) { const c = gridCenter(AP.me().grid); if (c && AP.pc) return c; throw e; } }
  async function here() {
    const box = $('pkOut'); box.hidden = false; box.className = 'st'; box.innerHTML = '📍 Finding you…';
    let pos; try { pos = await gps(); } catch (e) { box.className = 'st bad'; box.textContent = '📍 ' + e.message; return; }
    const w = await whereAmI(pos.la, pos.lo);
    const line = p => `<b>${esc(p.ref)}</b> ${esc(p.name)}`;
    if (w.inside.length) {
      box.className = 'st ok';
      box.innerHTML = w.inside.map(p => `✅ You are inside ${line(p)} — ${p.src === 'official' ? 'official outline (' + esc(p.agency || p.layer) + ')' : '<b>approximate</b> outline (' + esc(p.layer) + ')'}${p.note ? ' · ' + esc(p.note) : ''}` + (w.inside.length > 1 ? '' : '')).join('<br>') +
        (w.inside.length > 1 ? '<br>🌲 More than one park here: a 2-fer if they are both POTA parks.' : '') +
        `<div class="row"><button type="button" class="b gold sm" id="pkUse">USE ${esc(w.inside.map(p => p.ref).join(' '))} AS MY PARK</button></div>` +
        `<small>${pos.grid ? 'From your grid square ' + esc(pos.grid) + ' (rough: no GPS on this computer)' : 'GPS ±' + Math.round(pos.acc || 0) + ' m'} · ${pos.la.toFixed(5)}, ${pos.lo.toFixed(5)}</small>`;
      $('pkUse').onclick = () => { AP.S.ref = w.inside.map(p => p.ref).join(' '); AP.save(); $('stRef').value = AP.S.ref; AP.fire('me'); AP.toast('My park = ' + esc(AP.S.ref), 3000, 'log'); };
      return;
    }
    const n = w.near[0];
    box.className = 'st';
    box.innerHTML = n ? `🚫 Not inside any park on file. Nearest: ${line(n)}, ${n.edge != null ? AP.dist(n.edge) + ' from its line' : AP.dist(n.km) + ' from its pin (no outline on file for this state: approximate)'}, ${dirOf(n.deg)}.` + `<small>GPS ±${Math.round(pos.acc || 0)} m · packs: ${w.packs.join(', ')}</small>`
      : `🚫 No park within 50 miles in the packs you have (${w.packs.join(', ') || 'none'}). Download the state you are in.`;
  }
  async function next() {
    let pos; try { pos = await gps(); } catch (e) { AP.toast('📍 ' + esc(e.message), 6000, 'bad'); return; }
    const w = await whereAmI(pos.la, pos.lo), L = w.near.filter(p => !w.inside.some(i => i.ref === p.ref)).slice(0, 12);
    AP.sheet('Next park', L.length ? `<div class="oplist">${L.map(p => { const ap = p.ap && p.ap[0], dest = ap ? ap[0] + ',' + ap[1] : p.la + ',' + p.lo, cl = G.KPCAlerts ? KPCAlerts.closuresFor(p.ref) : []; return `<div class="op"><b>${esc(p.ref)}</b> <span>${esc(p.name)}</span>${cl.length ? `<em class="bad" title="${esc(cl.map(c => c.details || c.kind).join(' · '))}"> 🚧 ${esc(String(cl[0].details || cl[0].kind || 'notice').slice(0, 70))}</em>` : ''}<i>${AP.dist(p.km)} ${dirOf(p.deg)}${p.edge != null ? ' · ' + AP.dist(p.edge) + ' to the line' : ''}${!activated(p.ref) ? ' · <b>NEW to activate</b>' : ''}${!worked(p.ref) ? ' · new to hunt' : ''}${ap ? ' · ' + esc(ap[2] || 'access point') : ''}</i><a class="ic sm" href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener" aria-label="Directions to ${esc(p.name)}">🧭</a></div>`; }).join('')}</div><p class="hint">🧭 opens directions in your maps app (to the access point when one is on file). Distances are straight lines.</p>`
      : '<p class="hint">No other park within 50 miles in the packs you have.</p>');
  }
  /* ---------------- the parks map (Brandon Oct 22: 'off line maps… no way to see them?') ----------------
     Everything downloaded, drawn on the device: outlines (solid = official, dashed = approximate), pins, me. Works with
     no signal; with signal, satellite pictures go underneath (the 🛰 button). Tap a park for what it is. */
  async function mapView() {
    const packs = await loaded();
    if (!packs.length) { AP.toast('Download a state first (DOWNLOAD, while you have signal).', 4000, 'bad'); return; }
    let sat = LS('kpcPkSat', false), me = null, pick = null;
    AP.sheet('Parks on this device', `<div class="pkmap"><canvas id="pkCv" aria-label="Map of the parks on this device"></canvas>
      <div class="pkbar"><button type="button" class="chip" id="pkSat">${sat ? '🗺 PLAIN' : '🛰 SATELLITE + STREETS'}</button><button type="button" class="chip" id="pkMe">📍 ME</button><span class="hint" id="pkCnt"></span></div></div>
      <div class="st" id="pkInfo">Tap a park. Solid line = official outline, dashed = approximate (not official), dot = a park with no outline on file.</div>`);
    const cv = $('pkCv'), all = packs.flatMap(pk => pk.parks.map(pp => ({ p: pp, ol: (pk.outlines || {})[pp.ref] || [] })));
    $('pkCnt').textContent = all.length + ' parks · ' + packs.map(pk => pk.state).join(' ');
    const m = G.KPCMap.create(cv, { sat, draw(ctx, P, z, o) {
      ctx.lineJoin = 'round';
      for (const x of all) for (const ol of x.ol) for (const poly of polys(ol.g)) {
        ctx.beginPath(); for (const r of poly) r.forEach((c, i) => { const [px, py] = P(c[1], c[0]); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        const off = ol.src !== 'official', on = pick && pick.p.ref === x.p.ref;
        if (on) { ctx.fillStyle = 'rgba(232,184,74,.22)'; ctx.fill('evenodd'); }   /* Brandon Oct 22: 'remove shading on the maps' — lines only (the picked park is lit) */
        ctx.setLineDash(off ? [6, 4] : []); ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = on ? '#E8B84A' : off ? '#ffaa3c' : '#3fb950'; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const x of all) {
        const [px, py] = P(x.p.la, x.p.lo); if (px < -20 || py < -20 || px > o.w + 20 || py > o.h + 20) continue;
        ctx.fillStyle = x.ol.length ? '#3fb950' : '#6DB4F5'; ctx.beginPath(); ctx.arc(px, py, z >= 9 ? 4 : 3, 0, 7); ctx.fill();
        if (z >= 10) { ctx.fillStyle = o.sat ? '#fff' : (o.dark ? '#E6EAF0' : '#1A1E24'); ctx.fillText(x.p.ref, px, py - 7); }
      }
      if (me) { const [px, py] = P(me.la, me.lo); ctx.fillStyle = '#E8B84A'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill(); ctx.stroke(); }
    }, tap(la, lo, tx, ty) {
      let hit = all.find(x => x.ol.some(ol => inside(la, lo, ol.g)));
      if (!hit) { let best = 24; for (const x of all) { const [px, py] = m.P(x.p.la, x.p.lo), d = Math.hypot(px - tx, py - ty); if (d < best) { best = d; hit = x; } } }
      pick = hit || null; m.redraw(); info();
    } });
    function info() {
      const el = $('pkInfo'); if (!el) return;
      if (!pick) { el.textContent = 'Tap a park.'; return; }
      const p = pick.p, ol = pick.ol[0], ap = p.ap && p.ap[0], dest = ap ? ap[0] + ',' + ap[1] : p.la + ',' + p.lo;
      const g = me ? geo(me.la, me.lo, p.la, p.lo) : null;
      el.innerHTML = `<b>${esc(p.ref)}</b> ${esc(p.name)}<br><small>${ol ? (ol.src === 'official' ? '✅ official outline' + (ol.agency ? ' (' + esc(ol.agency) + ')' : '') : '⚠ <b>approximate outline, not official</b>' + (ol.layer ? ' (' + esc(ol.layer) + ')' : '')) : 'no outline on file: the pin is where the program puts it'}${g ? ' · ' + AP.dist(g.km) + ' ' + dirOf(g.deg) : ''}${!activated(p.ref) ? ' · NEW to activate' : ''}${!worked(p.ref) ? ' · new to hunt' : ''}</small>
        <div class="row"><button type="button" class="b gold sm" id="pkMine">USE AS MY PARK</button><a class="b sm" href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener">🧭 DIRECTIONS</a></div>`;
      $('pkMine').onclick = () => { AP.S.ref = p.ref; AP.save(); const r = $('stRef'); if (r) r.value = AP.S.ref; AP.fire('me'); AP.toast('My park = ' + esc(p.ref), 3000, 'log'); };
    }
    /* fit to where most parks are (one stray pin must not zoom the whole map out) */
    const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.round(f * (b.length - 1))))]; };
    const las = all.map(x => x.p.la).filter(isFinite), los = all.map(x => x.p.lo).filter(isFinite);
    m.fit(las.length > 10 ? [[q(las, .03), q(los, .03)], [q(las, .97), q(los, .97)]] : all.map(x => [x.p.la, x.p.lo]));
    $('pkSat').onclick = () => { sat = !m.sat(); m.sat(sat); SV('kpcPkSat', sat); $('pkSat').textContent = sat ? '🗺 PLAIN' : '🛰 SATELLITE + STREETS'; if (sat && !AP.net.online()) AP.toast('No signal: satellite pictures need the internet. The outlines still show.', 4000); };
    $('pkMe').onclick = async () => { try { me = await gps(); m.view(me.la, me.lo, 12); info(); } catch (e) { AP.toast('📍 ' + esc(e.message), 5000, 'bad'); } };
    gps().then(p0 => { me = p0; m.redraw(); }).catch(() => {});
  }
  const b4 = $('pkMap'); if (b4) b4.onclick = mapView;

  const b1 = $('pkGet'), b2 = $('pkHere'), b3 = $('pkNext');
  if (b1) b1.onclick = () => download($('pkState').value);
  if (b2) b2.onclick = here;
  if (b3) b3.onclick = next;
  draw();
  G.KPCParks = { mapView, download, del, get, loaded, whereAmI, name, inside, edgeKm, have: () => HAVE, STATES, url: URL0 };
})(window);
