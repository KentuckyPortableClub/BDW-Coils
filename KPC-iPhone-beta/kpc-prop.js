/* KPC app: BAND CONDITIONS + THE DAY / NIGHT MAP (Opus, Oct 24; on the to-do list from POTACAT's 'propagation/solar panel; map
   with day/night line'). SPOTS → ☀ CONDITIONS opens one sheet:
   - solar flux + Kp from NOAA SWPC (free, no key; the same two numbers the website's Activation Kit and Activators Lounge read),
     kept on the device so the last reading shows with no signal (with its age);
   - a rough band-by-band guess for right now at MY grid (day or night here, flux, Kp) — a guide, not a promise;
   - sunrise / sunset at my grid and the grey line times;
   - a world map with the night side shaded, me, and the spots shown on the SPOTS tab (satellite picture with signal, plain grid without). */
(function (G) {
  'use strict';
  const AP = G.KPCApp, $ = id => document.getElementById(id), esc = AP.esc;
  const RAD = Math.PI / 180;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  /* the sun: declination + equation of time (NOAA's short formulas), subsolar point, sunrise/sunset */
  function sunPos(t) {
    const d = new Date(t), jd = t / 864e5 + 2440587.5, n = jd - 2451545.0;
    const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * RAD;
    const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, eps = (23.439 - 0.0000004 * n) * RAD;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    let eot = (L * RAD - ra); eot = ((eot + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;   /* radians */
    const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const lon = -15 * (utcH - 12 + eot * 12 / Math.PI);   /* subsolar longitude */
    return { dec, lat: dec / RAD, lon: ((lon + 540) % 360) - 180, eot };
  }
  const elev = (la, lo, t) => { const s = sunPos(t), H = (lo - s.lon) * RAD; return Math.asin(Math.sin(la * RAD) * Math.sin(s.dec) + Math.cos(la * RAD) * Math.cos(s.dec) * Math.cos(H)) / RAD; };
  /* sunrise / sunset today (UTC ms) by stepping the sun's height; good to a minute or two */
  function riseSet(la, lo, t) {
    const d0 = new Date(t); d0.setUTCHours(0, 0, 0, 0); let rise = null, set = null, prev = elev(la, lo, +d0);
    for (let m = 2; m <= 1440; m += 2) { const tt = +d0 + m * 60000, e = elev(la, lo, tt); if (prev < -0.833 && e >= -0.833 && rise == null) rise = tt; if (prev >= -0.833 && e < -0.833 && set == null) set = tt; prev = e; }
    return { rise, set };
  }
  const hm = t => t == null ? '—' : new Date(t).toISOString().slice(11, 16) + 'Z';
  const loc = t => t == null ? '' : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  /* NOAA numbers, at most once every 30 minutes */
  async function solar(force) {
    const c = LS('kpcAppSun', null);
    if (!force && c && Date.now() - c.t < 30 * 60000) return c;
    try {
      const j = async u => { const r = AP.net.raw ? await AP.net.raw(u, { ms: 12000 }) : null; if (r && r.ok) return JSON.parse(r.text); const x = await fetch(u); return x.json(); };
      const [k, f] = await Promise.all([j('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'), j('https://services.swpc.noaa.gov/products/summary/10cm-flux.json')]);
      let kp = null, sfi = null;
      try { const r = k[k.length - 1]; kp = Number(Array.isArray(r) ? r[1] : r.Kp); } catch (e) {}
      try { sfi = Number((Array.isArray(f) ? f[0] : f).flux); } catch (e) {}
      if (!isFinite(kp)) kp = null; if (!isFinite(sfi)) sfi = null;
      if (kp == null && sfi == null) return c;
      const v = { kp, sfi, t: Date.now() }; SV('kpcAppSun', v); return v;
    } catch (e) { return c; }
  }
  /* a rough guess per band: 2 good, 1 fair, 0 poor */
  function bands(sfi, kp, day) {
    sfi = sfi == null ? 100 : sfi; kp = kp == null ? 2 : kp;
    const g = {
      '80m': day ? 1 : 2, '40m': day ? (sfi >= 90 ? 2 : 1) : 2, '30m': 2,
      '20m': day ? 2 : sfi >= 120 ? 2 : 1, '17m': day ? (sfi >= 100 ? 2 : 1) : sfi >= 150 ? 1 : 0,
      '15m': day ? (sfi >= 110 ? 2 : sfi >= 85 ? 1 : 0) : sfi >= 170 ? 1 : 0, '12m': day ? (sfi >= 130 ? 2 : sfi >= 100 ? 1 : 0) : 0, '10m': day ? (sfi >= 140 ? 2 : sfi >= 105 ? 1 : 0) : 0
    };
    if (kp >= 5) ['20m', '17m', '15m', '12m', '10m'].forEach(b => { g[b] = Math.max(0, g[b] - 1); });
    if (kp >= 4) ['15m', '12m', '10m'].forEach(b => { g[b] = Math.max(0, g[b] - 1); });
    if (kp >= 6) ['80m', '40m'].forEach(b => { g[b] = Math.max(0, g[b] - 1); });
    return g;
  }

  /* the night side, drawn on a KPCMap (Web Mercator) */
  function drawNight(ctx, P, t) {
    const s = sunPos(t), tanD = Math.tan(s.dec), pts = [];
    for (let lo = -180; lo <= 180; lo += 2) { const H = (lo - s.lon) * RAD; let la = Math.atan(-Math.cos(H) / (tanD || 1e-9)) / RAD; la = Math.max(-84, Math.min(84, la)); pts.push([la, lo]); }
    const pole = s.dec > 0 ? -84 : 84;   /* the dark pole */
    ctx.save(); ctx.beginPath();
    pts.forEach(([a, b], i) => { const [x, y] = P(a, b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    let [x, y] = P(pole, 180); ctx.lineTo(x, y); [x, y] = P(pole, -180); ctx.lineTo(x, y); ctx.closePath();
    ctx.fillStyle = 'rgba(3,6,20,.6)'; ctx.fill();
    ctx.beginPath(); pts.forEach(([a, b], i) => { const [x2, y2] = P(a, b); if (i) ctx.lineTo(x2, y2); else ctx.moveTo(x2, y2); });
    ctx.strokeStyle = 'rgba(232,184,74,.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    const [sx, sy] = P(s.lat, s.lon); ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 7); ctx.fill();
    ctx.restore();
  }
  function grid(ctx, P) {
    ctx.save(); ctx.strokeStyle = 'rgba(140,160,190,.25)'; ctx.lineWidth = 1;
    for (let lo = -180; lo <= 180; lo += 30) { ctx.beginPath(); let [x, y] = P(80, lo); ctx.moveTo(x, y); [x, y] = P(-80, lo); ctx.lineTo(x, y); ctx.stroke(); }
    for (let la = -60; la <= 80; la += 20) { ctx.beginPath(); let [x, y] = P(la, -180); ctx.moveTo(x, y); [x, y] = P(la, 180); ctx.lineTo(x, y); ctx.stroke(); }
    ctx.restore();
  }

  async function open() {
    const me = AP.gridLL ? AP.gridLL(AP.myGrid()) : null, now = Date.now();
    const day = me ? elev(me.la, me.lo, now) > -0.833 : new Date().getHours() >= 7 && new Date().getHours() < 19;
    AP.sheet('☀ Band conditions', `<div id="prTop" class="hint">Reading the sun…</div><div id="prBands" class="prb"></div>
      <h3 class="sh">Day and night right now</h3><canvas id="prMap" class="prmap" aria-label="World map with the night side shaded"></canvas>
      <p class="hint" id="prSun"></p>
      <p class="hint">A rough guide from the solar flux, the Kp index and whether it is day or night where you are. The real test is the band: look at SPOTS and 📡 WHO HEARD ME. Numbers from NOAA's Space Weather Prediction Center.</p>`);
    const v = await solar();
    const kp = v && v.kp, sfi = v && v.sfi, ageM = v ? Math.round((Date.now() - v.t) / 60000) : null;
    const storm = kp != null && kp >= 5, lvl = storm ? 'ROUGH (storm)' : sfi == null ? '?' : sfi >= 150 ? 'GREAT' : sfi >= 100 ? 'GOOD' : sfi >= 80 ? 'FAIR' : 'SO-SO';
    if ($('prTop')) $('prTop').innerHTML = v ? `<b class="prl">HF ${lvl}</b> Solar flux <b>${sfi != null ? Math.round(sfi) : '?'}</b> · Kp <b>${kp != null ? (+kp).toFixed(kp % 1 ? 1 : 0) : '?'}</b> · ${day ? '☀ daytime' : '🌙 night'} at ${esc(AP.myGrid() || 'your grid (set it in STATION)')}${ageM > 45 ? ' · <i>last reading ' + (ageM < 120 ? ageM + ' min' : Math.round(ageM / 60) + ' h') + ' old (no signal)</i>' : ''}` : 'No solar numbers yet: they need signal once. The day / night map works anyway.';
    const g = bands(sfi, kp, day), W = ['poor', 'fair', 'good'];
    if ($('prBands')) $('prBands').innerHTML = Object.entries(g).map(([b, x]) => `<span class="pb q${x}"><b>${b}</b>${W[x]}</span>`).join('');
    if (me && $('prSun')) { const rs = riseSet(me.la, me.lo, now); $('prSun').innerHTML = `At ${esc(AP.myGrid())}: sunrise <b>${loc(rs.rise)}</b> (${hm(rs.rise)}) · sunset <b>${loc(rs.set)}</b> (${hm(rs.set)}). The grey line (half an hour either side) often opens long paths on 40 and 80 m.`; }
    const cv = $('prMap'); if (!cv || !G.KPCMap) return;
    const spots = G.KPCSpots ? KPCSpots.shown().filter(s => isFinite(s.la) && isFinite(s.lo)).slice(0, 300) : [];
    const m = KPCMap.create(cv, { sat: AP.net.online(), draw(ctx, P) {
      if (!AP.net.online()) { ctx.fillStyle = '#23466e'; ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight); }
      grid(ctx, P);
      drawNight(ctx, P, Date.now());
      ctx.fillStyle = '#58a6ff'; spots.forEach(s => { const [x, y] = P(s.la, s.lo); ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); });
      if (me) { const [x, y] = P(me.la, me.lo); ctx.fillStyle = '#e8b84a'; ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.stroke(); }
    } });
    setTimeout(() => { m.view(me ? Math.max(-30, Math.min(50, me.la)) : 30, me ? me.lo : -40, cv.clientWidth > 700 ? 2 : 1); m.redraw(); }, 30);
  }
  G.KPCProp = { open, sunPos, elev, riseSet, bands, solar };
  const b = $('spProp'); if (b) b.onclick = open;
})(window);
