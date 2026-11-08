/* KPC app: 📡 SKIMMERS BY REGION + 🌊 BAND MAP / WATERFALL for the 🏆 CONTEST tab (Nov 5 2026, Opus; Brandon: 'spot list with all
   skimmers for US and Canada … broke down by regions' + 'add the waterfall where you can see who is where').

   WHERE THE SKIMMER SPOTS COME FROM
     Windows app: the Reverse Beacon Network itself, telnet.reversebeacon.net port 7000 (CW + RTTY; 7001 = FT8 / FT4 when that
       switch is on) through kpcNet.tcpOpen (the same TCP bridge rigctld uses). Every skimmer, every spot, live.
     Phone / browser (no raw TCP there): the RBN part of spothole.app every 3 minutes (the same service kpc-sources.js reads).
   Started only while 🏆 CONTESTING has the skimmer list or the band map switched on and the CONTEST tab has been opened.

   THE SKIMMER LIST is learned, not typed in (RBN nodes come and go every day): a spotter call ending '-#' = a skimmer. Where it
   is: 📍 a place the member typed (localStorage kpcSkimLoc) → the grid/position the spot carries → callook.info (US calls: grid +
   state, cached 30 days) → the call itself (Canadian prefix = province; US call area only, marked '?', because US calls have not
   been tied to a district since 1978). Then the ARRL/RAC section (kpc-contest.js), its ARRL division (RAC region in Canada) and
   call area. Levels: division · call area · section · country.

   WHO HEARS ME = every skimmer that copied MY call, by region, with the signal (dB) — call CQ and look.
   BAND MAP = one label per station at its frequency (RBN + the SPOTS tab's spots), coloured by kpc-contest status (⭐ new mult,
   needed, dupe, busted?), with a 10-minute waterfall of every skimmer report under it (bright = loud). Tap = tune + log line.
   A 'busted?' call = 1-2 skimmers only, not a human spot, and either not in MASTER.SCP or a call 1-2 letters away on the same
   frequency that many more skimmers copy. */
(function (G) {
  'use strict';
  const AP = G.KPCApp, CX = G.KPCContest; if (!AP || !CX) return;
  const $ = id => document.getElementById(id), esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = Object.assign({ level: 'division', win: 15, ft8: false, band: '20m' }, LS('kpcAppSkim', {}));
  const save = () => SV('kpcAppSkim', S);
  const LOC = LS('kpcSkimLoc', {});   /* call → {grid, st, la, lo, src: 'me'|'callook'|'spot', t} */
  const saveLoc = () => SV('kpcSkimLoc', LOC);
  const BANDS = [['160m', 1800, 2000], ['80m', 3500, 4000], ['40m', 7000, 7300], ['30m', 10100, 10150], ['20m', 14000, 14350], ['17m', 18068, 18168], ['15m', 21000, 21450], ['12m', 24890, 24990], ['10m', 28000, 29700], ['6m', 50000, 54000]];
  const bandOf = k => (BANDS.find(b => k >= b[1] && k <= b[2]) || [''])[0];
  const MAXAGE = 15 * 60000;

  /* ======================================================================== parsing a DX-cluster / RBN line
     DX de W3LPL-#:   14025.0  K1ABC          CW    24 dB  27 WPM  CQ      2315Z
     DX de KM3T-#:    14074.0  W1XYZ          FT8   -12 dB  CQ      2315Z */
  const LINE = /^DX de ([A-Z0-9/#-]+):\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Z0-9/]+)\s+(.*?)\s*([0-9]{4})Z(?:\s+([A-R]{2}[0-9]{2}(?:[A-X]{2})?))?\s*$/i;
  const MODES = ['CW', 'RTTY', 'FT8', 'FT4', 'PSK31', 'SSB', 'USB', 'LSB', 'FM', 'AM'];
  function parse(line, now) {
    const m = LINE.exec(String(line).trim()); if (!m) return null;
    const raw = m[1].toUpperCase(), up = m[4].toUpperCase(), sn = /(-?\d+)\s*DB/.exec(up), wp = /(\d+)\s*WPM/.exec(up);
    const mode = up.split(/\s+/).find(t => MODES.includes(t)) || '';
    return { spotter: raw.replace(/-#$/, '').replace(/-\d+$/, ''), skim: raw.endsWith('-#'), khz: +m[2], call: m[3].toUpperCase(), mode: mode || (+m[2] % 1000 < 70 ? 'CW' : ''),
      snr: sn ? +sn[1] : null, wpm: wp ? +wp[1] : null, beacon: /BEACON|NCDXF/.test(up), t: now || Date.now(), grid: (m[6] || '').toUpperCase() };
  }

  /* ======================================================================== the skimmers and what they hear */
  const SK = new Map();          /* call → skimmer */
  const AG = new Map();          /* 'CALL|band' → {call, band, mode, khz, reps: Map(spotter → {snr, wpm, t, khz}), last, bust} */
  let MARKS = [];                /* waterfall marks {khz, band, t, snr, call} */
  let FEED = { how: '', on: false, err: '', n: 0, last: 0 };
  const km = (a, b) => { const r = Math.PI / 180, dl = (b.lo - a.lo) * r, x = Math.sin((b.la - a.la) * r / 2) ** 2 + Math.cos(a.la * r) * Math.cos(b.la * r) * Math.sin(dl / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(x)); };
  const brg = (a, b) => { const r = Math.PI / 180, y = Math.sin((b.lo - a.lo) * r) * Math.cos(b.la * r), x = Math.cos(a.la * r) * Math.sin(b.la * r) - Math.sin(a.la * r) * Math.cos(b.la * r) * Math.cos((b.lo - a.lo) * r); return Math.round((Math.atan2(y, x) / r + 360) % 360); };
  const myPos = () => { const g = AP.myGrid(); return g && AP.gridLL ? AP.gridLL(g) : null; };

  /* where is it → {country, div, area, sec, how} */
  function locate(call, loc) {
    loc = loc || {};
    const tag = (s, how) => ({ country: s.country === 'CA' ? 'Canada' : 'US', div: s.div, area: s.country === 'US' ? 'W' + s.area : s.area, sec: s.abbr, how });
    const near = (list, la, lo) => list.reduce((b, s) => { const d = km({ la, lo }, s); return d < b.d ? { s, d } : b; }, { s: list[0], d: 1e9 }).s;
    if (loc.sec && CX.section(loc.sec)) return tag(CX.section(loc.sec), 'exact');
    const pos = isFinite(+loc.la) && isFinite(+loc.lo) && (loc.la || loc.lo);
    if (loc.st) { const c = CX.secsOfState(loc.st); if (c.length === 1) return tag(c[0], 'exact'); if (c.length > 1 && pos) return tag(near(c, +loc.la, +loc.lo), 'state+place'); }
    if (loc.st && !pos) { const c = CX.secsOfState(loc.st); if (c.length > 1) { const one = k => c.every(x => x[k] === c[0][k]) ? c[0][k] : '?'; return { country: c[0].country === 'CA' ? 'Canada' : 'US', div: one('div'), area: c[0].country === 'US' ? 'W' + one('area') : one('area'), sec: '?', how: 'state' }; } }   /* a state with two or more sections (MA, NY, CA, TX…) and no grid: the division is still sure */
    const i = CX.info(call);
    if (pos && (i.us || i.ca || (+loc.la > 15 && +loc.lo < -50 && +loc.lo > -170))) return tag(near(CX.sections.filter(s => !(i.us || i.ca) || s.country === (i.us ? 'US' : 'CA')), +loc.la, +loc.lo), 'place');
    if (!i.us && !i.ca) return null;
    const sp = CX.specialSec(i.area); if (sp) return tag(CX.section(sp), 'call');
    if (i.ca) { const c = CX.secsOfState(i.prov); if (c.length) return Object.assign(tag(c[0], 'call'), c.length > 1 ? { sec: '?' } : {}); return null; }
    const a = CX.sections.find(s => s.country === 'US' && s.area === i.area);
    return a ? { country: 'US', div: '?', area: 'W' + i.area, sec: '?', how: 'call' } : null;
  }
  function place(sk) {
    const l = Object.assign({}, sk.spotLoc || {}, LOC[sk.call] || {});
    if (l.grid && !(isFinite(+l.la) && (l.la || l.lo)) && AP.gridLL) { const p = AP.gridLL(l.grid); if (p) { l.la = p.la; l.lo = p.lo; } }
    sk.loc = l; sk.reg = locate(sk.call, l);
    const me = myPos(); if (me && isFinite(+l.la) && (l.la || l.lo)) { sk.km = Math.round(km(me, { la: +l.la, lo: +l.lo })); sk.brg = brg(me, { la: +l.la, lo: +l.lo }); }
  }
  /* callook.info for US skimmers with no place yet: one at a time, 30-day cache */
  const LQ = []; let lBusy = false;
  async function lookNext() {
    if (lBusy || !LQ.length) return; lBusy = true;
    const call = LQ.shift();
    try {
      const r = await AP.net.raw('https://callook.info/' + encodeURIComponent(call) + '/json', { ms: 12000 });
      const j = r && r.ok ? JSON.parse(r.text || 'null') : null;
      if (j && j.status === 'VALID') { const st = (/,\s*([A-Z]{2})\s+\d{5}/.exec((j.address || {}).line2 || '') || [])[1] || ''; LOC[call] = Object.assign({ grid: (j.location || {}).gridsquare || '', la: +(j.location || {}).latitude, lo: +(j.location || {}).longitude, st, src: 'callook', t: Date.now() }, LOC[call] && LOC[call].src === 'me' ? LOC[call] : {}); saveLoc(); }
      else if (!LOC[call]) { LOC[call] = { src: 'none', t: Date.now() }; saveLoc(); }
      const sk = SK.get(call); if (sk) { place(sk); later(); }
    } catch (e) {}
    lBusy = false; setTimeout(lookNext, 1500);
  }
  function skimmer(s) {
    let k = SK.get(s.spotter);
    if (!k) {
      k = { call: s.spotter, first: s.t, last: s.t, n: 0, bands: new Set(), modes: new Set(), spotLoc: s.grid ? { grid: s.grid } : (s.la ? { la: s.la, lo: s.lo, grid: s.dgrid || '' } : null) };
      SK.set(k.call, k); place(k);
      const cached = LOC[k.call], i = CX.info(k.call);
      if (i.us && (!cached || (cached.src !== 'me' && Date.now() - (cached.t || 0) > 30 * 86400000)) && !(k.spotLoc && k.spotLoc.grid)) { LQ.push(k.call); lookNext(); }
    }
    k.last = Math.max(k.last, s.t); k.n++; if (s.band) k.bands.add(s.band); if (s.mode) k.modes.add(s.mode);
    return k;
  }
  function add(s) {
    if (!s || !s.skim || s.beacon || !(s.khz > 100)) return;
    s.band = bandOf(s.khz); if (!s.band) return;
    skimmer(s);
    const key = s.call + '|' + s.band; let a = AG.get(key);
    if (!a) { a = { call: s.call, band: s.band, mode: s.mode, khz: s.khz, reps: new Map(), last: s.t }; AG.set(key, a); }
    a.reps.set(s.spotter, { snr: s.snr, wpm: s.wpm, t: s.t, khz: s.khz }); a.last = Math.max(a.last, s.t); if (s.mode) a.mode = s.mode;
    const fs = [...a.reps.values()].map(r => r.khz).sort((x, y) => x - y); a.khz = fs[Math.floor(fs.length / 2)];
    bustCheck(a);
    MARKS.push({ khz: s.khz, band: s.band, t: s.t, snr: s.snr == null ? 10 : s.snr, call: s.call });
    FEED.n++; FEED.last = Date.now();
  }
  function bustCheck(a) {
    a.bust = '';
    if (a.reps.size > 2) return;
    const inScp = CX.inScp(a.call);
    for (const b of AG.values()) {
      if (b === a || b.band !== a.band || Math.abs(b.khz - a.khz) > 0.3) continue;
      if (CX.edits(a.call, b.call, 2) > 2) continue;
      if (b.reps.size >= Math.max(3, a.reps.size * 3) || (!inScp && CX.inScp(b.call))) { a.bust = b.call; return; }
    }
    if (CX.scpSize() > 0 && !inScp && a.reps.size === 1) a.bust = '?';
  }
  function prune() {
    const cut = Date.now() - MAXAGE;
    for (const [k, a] of AG) { for (const [sp, r] of a.reps) if (r.t < cut) a.reps.delete(sp); if (!a.reps.size) AG.delete(k); }
    if (MARKS.length > 6000 || (MARKS[0] && MARKS[0].t < Date.now() - 10 * 60000)) MARKS = MARKS.filter(m => m.t >= Date.now() - 10 * 60000);
  }
  setInterval(prune, 30000);

  /* ======================================================================== the feeds */
  let WANT = false, sock = null, sockFt = null, holeT = null, rbnBuf = { 7000: '', 7001: '' };
  const KN = () => (G.kpcNet && kpcNet.tcpOpen) ? G.kpcNet : null;
  const want = () => WANT && CX.S.on && (CX.on('skim') || CX.on('map'));
  async function tcp(port) {
    const kn = KN(); if (!kn || !want()) return;
    const me = AP.me().station || AP.me().call; if (!me) { FEED.err = 'put your call sign in STATION → My station (RBN asks for it)'; return; }
    FEED.how = 'RBN direct (telnet.reversebeacon.net)';
    const r = await kn.tcpOpen({ host: 'telnet.reversebeacon.net', port, ms: 8000 });
    if (!r.ok) { FEED.err = r.err || 'no answer'; FEED.on = false; setTimeout(() => tcp(port), 30000); later(); return; }
    if (port === 7000) sock = r.id; else sockFt = r.id;
    FEED.on = true; FEED.err = ''; let logged = false;
    rbnBuf[port] = '';
    tcp.handlers = tcp.handlers || {};
    tcp.handlers[r.id] = d => {
      if (!logged && /call|login/i.test(d)) { logged = true; kn.tcpWrite(r.id, me + '\r\n'); }
      rbnBuf[port] += d; const lines = rbnBuf[port].split(/\r?\n/); rbnBuf[port] = lines.pop();
      lines.forEach(l => add(parse(l)));
    };
    if (!tcp.wired) {
      tcp.wired = true;
      kn.onTcpData(d => { const h = tcp.handlers && tcp.handlers[d.id]; if (h) h(d.data); });
      kn.onTcpClose(d => { if (!tcp.handlers || !tcp.handlers[d.id]) return; delete tcp.handlers[d.id]; const p = d.id === sockFt ? 7001 : 7000; if (p === 7000) sock = null; else sockFt = null; FEED.on = !!(sock || sockFt); if (want()) setTimeout(() => tcp(p), 15000); later(); });
    }
    later();
  }
  function tcpStop() { const kn = KN(); [sock, sockFt].forEach(id => { if (id && kn) { if (tcp.handlers) delete tcp.handlers[id]; kn.tcpClose(id); } }); sock = sockFt = null; FEED.on = false; }
  const dbOf = t => { const m = /(-?\d+)\s*dB/i.exec(String(t || '')); return m ? +m[1] : null; };
  async function hole() {
    if (!want()) return;
    FEED.how = 'RBN through spothole.app (every 3 min)';
    try {
      const r = await AP.net.raw('https://spothole.app/api/v1/spots?max_age=900', { ms: 60000 });
      if (!r || !r.ok) throw new Error('HTTP ' + ((r && (r.status || r.err)) || '?'));
      const j = JSON.parse(r.text || '[]'), L = Array.isArray(j) ? j : (j && j.spots) || [];
      L.forEach(x => {
        if (!/RBN|SKIM/i.test(String(x.source || ''))) return;
        const f = +(x.freq != null ? x.freq : x.frequency); const khz = f < 1000 ? f * 1000 : f < 1e6 ? f : f / 1000;
        const t = typeof x.time === 'number' ? (x.time < 1e12 ? x.time * 1000 : x.time) : Date.parse(x.time) || Date.now();
        add({ spotter: String(x.de_call || '').toUpperCase().replace(/-#$/, '').replace(/-\d+$/, ''), skim: true, khz, call: String(x.dx_call || '').toUpperCase(), mode: String(x.mode || '').toUpperCase(),
          snr: x.snr != null ? +x.snr : dbOf(x.comment), wpm: x.speed != null ? +x.speed : null, t,
          grid: String(x.de_grid || x.de_locator || '').toUpperCase().slice(0, 6), la: +(x.de_latitude ?? NaN), lo: +(x.de_longitude ?? NaN) });
      });
      FEED.on = true; FEED.err = '';
    } catch (e) { FEED.on = false; FEED.err = String(e.message || e); }
    later();
  }
  function start() {
    if (!want()) { stop(); return; }
    if (KN()) { if (!sock) tcp(7000); if (S.ft8 && !sockFt) tcp(7001); if (!S.ft8 && sockFt) { const kn = KN(); if (tcp.handlers) delete tcp.handlers[sockFt]; kn.tcpClose(sockFt); sockFt = null; } }
    else if (!holeT) { hole(); holeT = setInterval(hole, 180000); }
  }
  function stop() { tcpStop(); if (holeT) { clearInterval(holeT); holeT = null; } }
  function wake() { WANT = true; start(); }

  /* ======================================================================== views */
  const LV = [['division', 'ARRL division / RAC region'], ['area', 'call area'], ['sec', 'section'], ['country', 'country']];
  const keyOf = (r, lv) => !r ? '' : lv === 'country' ? r.country : lv === 'division' ? r.country + ' · ' + (r.div === '?' ? r.area + ' (division not known)' : r.div) : lv === 'area' ? r.area : r.sec === '?' ? r.area + ' ?' : r.sec;
  function active(win) { const cut = win ? Date.now() - win * 60000 : 0; return [...SK.values()].filter(k => k.reg && k.last >= cut); }
  function byRegion(lv, win) {
    const g = {}; active(win).forEach(k => { const key = keyOf(k.reg, lv); (g[key] = g[key] || []).push(k); });
    return Object.keys(g).sort().map(k => [k, g[k].sort((a, b) => a.call.localeCompare(b.call))]);
  }
  let vT = null; const later = () => { clearTimeout(vT); vT = setTimeout(views, 400); };
  function views() { drawRegions($('cxSkim')); drawHeard($('cxHeard')); }
  setInterval(() => { if (document.body.dataset.screen === 'contest') views(); }, 15000);
  function drawRegions(el) {
    if (!el) return;
    const groups = byRegion(S.level, S.win), n = groups.reduce((a, g) => a + g[1].length, 0), dx = [...SK.values()].filter(k => !k.reg).length;
    el.innerHTML = `<div class="grid2"><label class="e">GROUP BY<select id="skLv">${LV.map(([v, t]) => `<option value="${v}"${S.level === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="e">HEARD IN THE LAST<select id="skWin">${[[15, '15 minutes'], [60, 'hour'], [0, 'since the app opened']].map(([v, t]) => `<option value="${v}"${+S.win === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <div class="st">${FEED.on ? '🟢 ' : FEED.err ? '🔴 ' : '⏳ '}${esc(FEED.how || 'starting…')}${FEED.err ? ' · ' + esc(FEED.err) : ''} · <b>${n}</b> US + Canada skimmers${dx ? ' (+' + dx + ' elsewhere)' : ''}${FEED.last ? ' · last spot ' + AP.utc(FEED.last) + 'z' : ''}</div>
      <div class="skgr">${groups.map(([k, L]) => `<div class="skg"><b>${esc(k)}</b> <small>${L.length}</small><div class="calls">${L.map(s => `<button type="button" class="skc${s.reg.how === 'call' ? ' guess' : ''}" data-sk="${esc(s.call)}" title="${esc(s.reg.sec)} · ${s.km != null ? AP.dist(s.km) + ' @ ' + s.brg + '°' : 'place not known'} · ${esc([...s.bands].join(' '))}">${esc(s.call)}${s.reg.how === 'call' ? '?' : ''}</button>`).join('')}</div></div>`).join('') || '<p class="hint">No skimmers heard yet.</p>'}</div>
      <div class="row">${KN() ? `<button type="button" class="b upsw${S.ft8 ? ' on' : ''}" id="skFt"><b>${S.ft8 ? 'ON' : 'OFF'}</b> <span>FT8 / FT4 skimmers too (RBN port 7001)</span></button>` : ''}<button type="button" class="b" id="skFix">📍 SET A SKIMMER'S PLACE</button></div>
      <p class="hint">A call with <b>?</b> = placed by its call sign only (US calls can move). Tap a skimmer to set where it is: it stays set on this device.</p>`;
    $('skLv').onchange = () => { S.level = $('skLv').value; save(); drawRegions(el); };
    $('skWin').onchange = () => { S.win = +$('skWin').value; save(); drawRegions(el); };
    if ($('skFt')) $('skFt').onclick = () => { S.ft8 = !S.ft8; save(); start(); drawRegions(el); };
    $('skFix').onclick = () => fixSheet('');
    el.querySelectorAll('[data-sk]').forEach(b => { b.onclick = () => fixSheet(b.dataset.sk); });
  }
  function fixSheet(call) {
    const l = LOC[call] || {};
    AP.sheet('Where is this skimmer?', `<div class="grid2"><label class="e">SKIMMER CALL<input id="skC" value="${esc(call)}" autocapitalize="characters"></label><label class="e">GRID (4 or 6)<input id="skG" value="${esc(l.grid || '')}" autocapitalize="characters" maxlength="6"></label>
      <label class="e">STATE / PROVINCE<input id="skS" value="${esc(l.st || '')}" autocapitalize="characters" maxlength="2"></label><label class="e">OR ITS SECTION<input id="skSec" value="${esc(l.sec || '')}" autocapitalize="characters" maxlength="3" list="cxSecL2"></label></div>
      <datalist id="cxSecL2">${CX.sections.map(s => `<option value="${s.abbr}">${esc(s.name)}</option>`).join('')}</datalist>
      <p class="hint">The RBN website lists each skimmer's grid. A section beats a state beats a grid.</p>`, () => {
      const c = String(($('skC') || {}).value || '').trim().toUpperCase().replace(/-#$/, ''); if (!c) return;
      LOC[c] = { grid: String($('skG').value || '').trim().toUpperCase(), st: String($('skS').value || '').trim().toUpperCase(), sec: String($('skSec').value || '').trim().toUpperCase(), src: 'me', t: Date.now() }; saveLoc();
      const sk = SK.get(c); if (sk) place(sk); views();
    });
  }
  function heardMe() {
    const me = String(AP.me().station || AP.me().call || '').toUpperCase(); if (!me) return [];
    const out = []; for (const a of AG.values()) if (a.call === me) for (const [sp, r] of a.reps) { const k = SK.get(sp); out.push({ spotter: sp, band: a.band, mode: a.mode, snr: r.snr, wpm: r.wpm, t: r.t, reg: k && k.reg, km: k && k.km }); }
    return out.sort((a, b) => b.t - a.t);
  }
  function drawHeard(el) {
    if (!el) return;
    const L = heardMe(), g = {}; L.forEach(r => { const k = r.reg ? keyOf(r.reg, S.level) : 'DX / place not known'; (g[k] = g[k] || []).push(r); });
    el.innerHTML = L.length ? `<div class="st">${L.length} skimmer report${L.length > 1 ? 's' : ''} of ${esc(AP.me().station || AP.me().call)} in the last 15 minutes</div><div class="skgr">${Object.keys(g).sort().map(k => `<div class="skg"><b>${esc(k)}</b><div class="calls">${g[k].map(r => `<span class="skc">${esc(r.spotter)} <b class="snr">${r.snr == null ? '?' : r.snr}dB</b> ${esc(r.band)}</span>`).join('')}</div></div>`).join('')}</div>`
      : '<p class="hint">Nobody has spotted you in the last 15 minutes. Call CQ (CW, RTTY, or FT8 with the FT8 skimmers on) and the skimmers that hear you show up here, by region, with your signal.</p>';
  }

  /* ======================================================================== BAND MAP + WATERFALL (canvas) */
  const COL = { mult: '#f5b301', need: '#3ddc84', dupe: '#6b7280', no: '#64748b', bust: '#ef4444', me: '#e879f9' };
  let MAP = null;
  /* Nov 6: o.follow = keep to the radio's band and dial (the DIGI screen's slim strip); o.slim = labels + a thin waterfall only */
  function mountMap(cv, chips, o) {
    if (!cv) return; o = o || {};
    if (MAP && MAP.cv === cv && !MAP.stop) return;
    if (MAP && MAP.cv !== cv) MAP.stop = true;
    const dk = (G.KPCLog && KPCLog.dock) || {}, radioBand = bandOf(+dk.khz);
    const band = (o.follow ? radioBand : '') || S.band || radioBand || '20m', e = BANDS.find(b => b[0] === band) || BANDS[4];
    const m = MAP = { cv, band, lo: e[1], hi: Math.min(e[2], e[1] + (e[2] - e[1] > 150 ? 110 : e[2] - e[1])), hits: [], stop: false, follow: !!o.follow, slim: !!o.slim };
    if (m.follow) aim(m, +dk.khz);
    const bandChips = () => {
      if (!chips) return;
      const cnt = {}; AG.forEach(a => { cnt[a.band] = (cnt[a.band] || 0) + 1; }); (G.KPCSpots ? KPCSpots.all() : []).forEach(s => { const b = bandOf(s.khz); if (b) cnt[b] = (cnt[b] || 0) + 1; });
      chips.innerHTML = BANDS.filter(b => b[0] !== '30m' && b[0] !== '17m' && b[0] !== '12m').map(b => `<button type="button" class="chip${b[0] === m.band ? ' on' : ''}" data-wb="${b[0]}">${b[0]}${cnt[b[0]] ? ' <small>' + cnt[b[0]] + '</small>' : ''}</button>`).join('') + '<button type="button" class="chip" data-wz="out">−</button><button type="button" class="chip" data-wz="in">＋</button>';
      chips.querySelectorAll('[data-wb]').forEach(b => { b.onclick = () => { S.band = b.dataset.wb; save(); m.stop = true; mountMap(cv, chips); }; });
      chips.querySelectorAll('[data-wz]').forEach(b => { b.onclick = () => zoom(b.dataset.wz === 'in' ? 1 / 1.5 : 1.5, (m.lo + m.hi) / 2); });
    };
    const edges = () => BANDS.find(b => b[0] === m.band);
    function zoom(k, fx) { const E = edges(); const lo = Math.max(E[1], fx - (fx - m.lo) * k), hi = Math.min(E[2], fx + (m.hi - fx) * k); if (hi - lo >= 2) { m.lo = lo; m.hi = hi; } }
    bandChips(); m.chipT = setInterval(() => { if (m.stop || !cv.isConnected) { clearInterval(m.chipT); return; } bandChips(); }, 20000);
    cv.onwheel = ev => { ev.preventDefault(); zoom(ev.deltaY > 0 ? 1.2 : 1 / 1.2, m.lo + (ev.offsetX / cv.clientWidth) * (m.hi - m.lo)); };
    let drag = null;
    cv.onpointerdown = ev => { drag = { x: ev.clientX, lo: m.lo, hi: m.hi, moved: false }; try { cv.setPointerCapture(ev.pointerId); } catch (x) {} };
    cv.onpointermove = ev => { if (!drag) return; const dx = ev.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; if (!drag.moved) return; const span = drag.hi - drag.lo, E = edges(); m.lo = Math.max(E[1], Math.min(E[2] - span, drag.lo - dx / cv.clientWidth * span)); m.hi = m.lo + span; };
    cv.onpointerup = ev => {
      const was = drag && drag.moved; drag = null; if (was) return;
      const h = m.hits.find(x => ev.offsetX >= x.x && ev.offsetX <= x.x + x.w && ev.offsetY >= x.y && ev.offsetY <= x.y + x.h);
      if (h && G.KPCSpots) KPCSpots.tune(h.s);
    };
    const loop = () => { if (m.stop || !cv.isConnected) return; if (m.follow) { const k = +((G.KPCLog && KPCLog.dock) || {}).khz, b = bandOf(k); if (b && (b !== m.band || k < m.lo || k > m.hi)) { m.band = b; aim(m, k); } } const now = performance.now(); if (cv.offsetParent !== null && !document.hidden && (!m.slim || now - (m.at || 0) > 250)) { m.at = now; drawMap(m); } requestAnimationFrame(loop); };   /* the slim DIGI strip: 4 frames a second is plenty (the decoders need the CPU) */
    requestAnimationFrame(loop);
  }
  /* a 30 kHz window around the dial (the whole band when it is narrower) */
  function aim(m, khz) { const E = BANDS.find(b => b[0] === m.band); if (!E) return; const w = Math.min(30, E[2] - E[1]); const k = khz >= E[1] && khz <= E[2] ? khz : E[1] + w / 2; m.lo = Math.max(E[1], Math.min(E[2] - w, k - w / 2)); m.hi = m.lo + w; }
  function mapSpots(band) {
    const out = new Map();
    AG.forEach(a => { if (a.band === band) out.set(a.call, { call: a.call, khz: a.khz, mode: a.mode || 'CW', n: a.reps.size, bust: a.bust, refs: [], src: 'rbn' }); });
    (G.KPCSpots ? KPCSpots.all() : []).forEach(s => { if (bandOf(s.khz) !== band || Date.now() - s.t > 30 * 60000) return; const o = out.get(s.call); if (o) { o.human = true; o.bust = ''; o.refs = s.refs; } else out.set(s.call, { call: s.call, khz: s.khz, mode: s.mode, n: 0, human: true, refs: s.refs || [], grid: s.grid, st: s.st }); });
    return [...out.values()].sort((a, b) => a.khz - b.khz);
  }
  function drawMap(m) {
    const cv = m.cv, dpr = G.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const light = document.documentElement.dataset.theme === 'light';
    c.fillStyle = light ? '#f4f2ec' : '#0b1020'; c.fillRect(0, 0, W, H);
    const BM = m.slim ? Math.max(24, H - 30) : Math.min(110, Math.max(74, H * 0.32)), AX = 16, top = BM + AX, wf = H - top, span = m.hi - m.lo, X = k => (k - m.lo) / span * W;
    /* CW / digital / phone shading */
    const E = BANDS.find(b => b[0] === m.band), cwTop = E[1] + (m.band === '160m' ? 40 : m.band === '6m' ? 100 : 70), dgTop = E[1] + ({ '160m': 43, '80m': 100, '40m': 125, '20m': 150, '15m': 200, '10m': 300, '6m': 300 }[m.band] || 100);
    [[E[1], cwTop, 'rgba(96,165,250,.10)'], [cwTop, dgTop, 'rgba(168,85,247,.10)'], [dgTop, E[2], 'rgba(52,211,153,.07)']].forEach(([a, b, f]) => { const x0 = Math.max(0, X(a)), x1 = Math.min(W, X(b)); if (x1 > x0) { c.fillStyle = f; c.fillRect(x0, 0, x1 - x0, H); } });
    /* Nov 6: the real RF scope (kpc-scope.js: the Icom's own scope, 2-second rows) under the skimmer marks, time-aligned */
    const rfOn = G.KPCScope ? KPCScope.underlay(c, m.lo, m.hi, top, W, wf, 10 * 60000) : false;
    m.rf = rfOn;
    /* frequency axis */
    c.strokeStyle = light ? '#d6d0c0' : '#1f2a44'; c.fillStyle = light ? '#6b6250' : '#64748b'; c.font = '11px ui-monospace, monospace'; c.textAlign = 'center';
    const step = [0.5, 1, 2, 5, 10, 25, 50, 100, 250].find(s => span / s <= W / 70) || 500;
    for (let f = Math.ceil(m.lo / step) * step; f <= m.hi; f += step) { const x = X(f); c.beginPath(); c.moveTo(x, BM); c.lineTo(x, H); c.stroke(); c.fillText(step < 1 ? f.toFixed(1) : String(Math.round(f)), x, BM + 12); }
    m.hits = [];
    const me = String(AP.me().station || AP.me().call || '').toUpperCase();
    const colOf = s => s.call === me ? COL.me : s.bust ? COL.bust : COL[CX.status(s.call, m.band, s.mode || 'CW')] || COL.need;
    /* waterfall: newest at the top */
    const now = Date.now(), depth = 10 * 60000, cache = {};
    for (const k of MARKS) {
      if (k.band !== m.band || k.khz < m.lo || k.khz > m.hi) continue;
      const y = top + (now - k.t) / depth * wf; if (y > H) continue;
      const col = cache[k.call] || (cache[k.call] = colOf({ call: k.call, mode: 'CW', bust: (AG.get(k.call + '|' + m.band) || {}).bust }));
      c.globalAlpha = Math.max(0.25, Math.min(1, ((k.snr == null ? 10 : k.snr) + 5) / 35)); c.fillStyle = col; c.fillRect(X(k.khz) - 3, y, 6, 3);
    }
    c.globalAlpha = 1;
    /* band map labels, stacked in lanes so they never cover each other */
    const lanes = [], laneH = 17, maxL = Math.max(1, Math.floor((BM - 4) / laneH));
    c.textAlign = 'left'; c.font = '600 12px ui-monospace, monospace';
    for (const s of mapSpots(m.band)) {
      if (s.khz < m.lo || s.khz > m.hi) continue;
      const x = X(s.khz), lab = s.call + (s.n ? ' ' + s.n : '') + (s.human ? '•' : ''), w = c.measureText(lab).width + 8;
      let ln = lanes.findIndex(end => end < x - 2); if (ln === -1) { if (lanes.length >= maxL) continue; ln = lanes.length; lanes.push(0); }
      lanes[ln] = x + w; const y = 3 + ln * laneH, col = colOf(s);
      c.fillStyle = col; c.fillRect(x, y, 2, laneH - 3);
      c.fillStyle = light ? 'rgba(255,255,255,.9)' : 'rgba(15,23,42,.88)'; c.fillRect(x + 2, y, w, laneH - 3);
      c.fillStyle = col; c.fillText(lab, x + 6, y + 11.5);
      if (s.bust) c.fillRect(x + 6, y + 7, w - 10, 1);
      m.hits.push({ x, y, w: w + 2, h: laneH - 3, s });
    }
    /* the radio's dial */
    const dk = (G.KPCLog && KPCLog.dock) || {}, rk = +dk.khz;
    if (rk >= m.lo && rk <= m.hi) { c.strokeStyle = '#f43f5e'; c.lineWidth = 2; c.beginPath(); c.moveTo(X(rk), 0); c.lineTo(X(rk), H); c.stroke(); c.lineWidth = 1; }
    /* a REAL waterfall from the radio's own scope can go under this later: kpc-digi.js already makes one for FT8 (its own FFT) */
  }

  G.KPCSkim = { S, wake, start, stop, add, parse, byRegion, heardMe, skimmers: () => [...SK.values()], spots: () => [...AG.values()], feed: () => FEED, locate, mountMap, drawRegions, drawHeard, mapSpots, _marks: () => MARKS, _hits: () => (MAP ? MAP.hits : []) };
})(window);
