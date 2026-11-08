/* KPC app: 🧭 ROTATOR (Nov 6 2026, Opus; Brandon: 'I am good with you doing the rotary option'; POTACAT turns the beam on a spot click).
   Talks to Hamlib's rotctld over TCP (Windows app: kpcNet.tcpOpen, the same bridge rigctld and RBN use). rotctld drives nearly every
   rotator controller: Yaesu G-x00 via GS-232, Hy-Gain DCU-1 / Rotor-EZ, SPID MD-01/02, Green Heron, ERC, PstRotator-style boxes …
     rotctld -m <model> -r COMx -t 4533      (rotctld -l lists the models: 603 = GS-232B, 401 = Rotor-EZ, 902 = SPID Rot2Prog …)
   Protocol (one line each): 'P <az> <el>' turn → 'RPRT 0'; 'p' → two lines az / el; 'S' stop.
   STATION → 🧭 Rotator: ON, where rotctld is, TURN TO, STOP, short / long path, and 'turn the beam when I tap a spot'
   (AP 'spot-tune' from kpc-spots.js). Bearing = great circle from MY grid to the spot's grid / position, else the call's
   country centre (CTY.DAT through kpc-contest.js), else it says it doesn't know where that is. Phones / browsers: no raw TCP,
   so the card says it needs the Windows app. Settings: localStorage kpcAppRot. */
(function (G) {
  'use strict';
  const AP = G.KPCApp; if (!AP) return;
  const $ = id => document.getElementById(id), esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const R = Object.assign({ on: false, host: '127.0.0.1', port: 4533, auto: false, lp: false, off: 0 }, LS('kpcAppRot', {}));
  const save = () => SV('kpcAppRot', R);
  const KN = () => (G.kpcNet && kpcNet.tcpOpen) ? G.kpcNet : null;
  const ST = { conn: false, id: null, az: null, target: null, err: '', busy: false, at: 0 };
  let buf = '', waiters = [], wired = false;

  /* ---------------- geometry ---------------- */
  const rad = Math.PI / 180;
  function bearing(a, b) { const y = Math.sin((b.lo - a.lo) * rad) * Math.cos(b.la * rad), x = Math.cos(a.la * rad) * Math.sin(b.la * rad) - Math.sin(a.la * rad) * Math.cos(b.la * rad) * Math.cos((b.lo - a.lo) * rad); return (Math.atan2(y, x) / rad + 360) % 360; }
  function km(a, b) { const h = Math.sin((b.la - a.la) * rad / 2) ** 2 + Math.cos(a.la * rad) * Math.cos(b.la * rad) * Math.sin((b.lo - a.lo) * rad / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); }
  const me = () => { const g = AP.myGrid && AP.myGrid(); return g ? AP.gridLL(g) : null; };
  /* where a spot / call is: its grid, its own position, or its country's centre */
  function placeOf(s) {
    if (!s) return null;
    if (s.grid || s.g) { const p = AP.gridLL(s.grid || s.g); if (p) return Object.assign(p, { how: 'grid' }); }
    if (isFinite(+s.la) && isFinite(+s.lo) && (+s.la || +s.lo)) return { la: +s.la, lo: +s.lo, how: 'place' };
    if (G.KPCContest && s.call) { const i = KPCContest.info(s.call); if (isFinite(i.la) && isFinite(i.lo)) return { la: i.la, lo: i.lo, how: 'country' }; }
    return null;
  }
  function headingTo(s) {
    const a = me(), b = placeOf(s); if (!a || !b) return null;
    let h = bearing(a, b); if (R.lp) h = (h + 180) % 360;
    return { az: Math.round(((h + (+R.off || 0)) % 360 + 360) % 360), km: Math.round(km(a, b)), how: b.how };
  }

  /* ---------------- rotctld ---------------- */
  async function connect() {
    if (ST.conn) return true; const kn = KN(); if (!kn) { ST.err = 'needs the Windows app (rotctld runs on the PC)'; return false; }
    const r = await kn.tcpOpen({ host: R.host || '127.0.0.1', port: +R.port || 4533, ms: 4000 });
    if (!r.ok) { ST.err = r.err || 'no rotctld at ' + R.host + ':' + R.port; paint(); return false; }
    ST.id = r.id; ST.conn = true; ST.err = ''; buf = '';
    if (!wired) { wired = true;
      kn.onTcpData(d => { if (d.id !== ST.id) return; buf += d.data; const L = buf.split('\n'); buf = L.pop(); L.forEach(l => { const w = waiters[0]; if (w) { w.lines.push(l.trim()); if (w.lines.length >= w.n || /^RPRT/.test(l.trim())) { waiters.shift(); w.res(w.lines); } } }); });
      kn.onTcpClose(d => { if (d.id !== ST.id) return; ST.conn = false; ST.id = null; waiters.splice(0).forEach(w => w.res(null)); paint(); }); }
    return true;
  }
  function ask(line, n) {
    return new Promise(async res => {
      if (!await connect()) return res(null);
      const w = { n, lines: [], res }; waiters.push(w); KN().tcpWrite(ST.id, line + '\n');
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, 3000);
    });
  }
  async function read() { const L = await ask('p', 2); if (!L || /^RPRT -/.test(L[0])) return null; const az = parseFloat(L[0]); if (isFinite(az)) { ST.az = Math.round(((az % 360) + 360) % 360); ST.at = Date.now(); } paint(); return ST.az; }
  async function turn(az, why) {
    if (!R.on) return false;
    az = Math.round(((+az % 360) + 360) % 360); ST.target = az;
    const L = await ask('P ' + az + ' 0', 1); const ok = !!(L && /RPRT 0/.test(L[L.length - 1] || ''));
    if (!ok) { ST.err = L ? 'rotctld said ' + L.join(' ') : ST.err || 'no answer'; AP.toast('🧭 The rotator did not turn: ' + esc(ST.err), 4000, 'bad'); }
    else { ST.err = ''; AP.toast('🧭 Turning to ' + az + '°' + (why ? ' (' + esc(why) + ')' : ''), 2500, 'log'); follow(); }
    paint(); return ok;
  }
  async function stop() { const L = await ask('S', 1); ST.target = null; paint(); return !!(L && /RPRT 0/.test(L.join(' '))); }
  let fT = null;
  function follow() { clearInterval(fT); let n = 0; fT = setInterval(async () => { n++; await read(); if (n > 45 || (ST.target != null && ST.az != null && Math.abs(((ST.az - ST.target + 540) % 360) - 180) <= 2)) { clearInterval(fT); if (n <= 45) ST.target = null; paint(); } }, 1500); }

  AP.on('spot-tune', s => { if (!R.on || !R.auto) return; const h = headingTo(s); if (!h) { AP.toast('🧭 No place known for ' + esc(s.call || 'that spot') + ' (no grid; load CTY.DAT for country headings).', 3500); return; } turn(h.az, s.call + ' · ' + AP.dist(h.km) + (h.how === 'country' ? ', country centre' : '')); });

  /* ---------------- STATION → 🧭 Rotator ---------------- */
  /* the compass + the status line only (never the boxes: no redraw under the member's fingers) */
  function paint() {
    const cp = $('roComp'), st = $('roSt'); if (!cp) return;
    const dial = ST.az == null ? '—' : ST.az + '°', pc = !!KN();
    cp.innerHTML = `<svg viewBox="-50 -50 100 100" aria-label="Heading ${dial}"><circle r="44" class="ring"/>${[0, 90, 180, 270].map(a => `<text x="${(Math.sin(a * rad) * 36).toFixed(1)}" y="${(-Math.cos(a * rad) * 36 + 3).toFixed(1)}" class="cd">${'NESW'[a / 90]}</text>`).join('')}${ST.target != null ? `<line x1="0" y1="0" x2="${(Math.sin(ST.target * rad) * 40).toFixed(1)}" y2="${(-Math.cos(ST.target * rad) * 40).toFixed(1)}" class="tg"/>` : ''}${ST.az != null ? `<line x1="0" y1="0" x2="${(Math.sin(ST.az * rad) * 40).toFixed(1)}" y2="${(-Math.cos(ST.az * rad) * 40).toFixed(1)}" class="nd"/>` : ''}<circle r="3" class="hub"/></svg><b class="roaz">${dial}</b>${ST.target != null ? `<small>→ ${ST.target}°</small>` : ''}`;
    st.textContent = !pc ? '📱 The rotator works from the Windows app (rotctld runs on the PC).' : ST.conn ? '🟢 Talking to rotctld at ' + R.host + ':' + R.port : ST.err ? '🔴 ' + ST.err : 'Not connected yet.';
  }
  function draw() {
    const st = $('scrStation'); if (!st) return; let c = $('stRot');
    if (!c) { const anchor = $('stCx') || st.querySelector('[data-grp^="alerts notifications"]') || st.lastElementChild; anchor.insertAdjacentHTML('beforebegin', '<section class="card" id="stRot" data-grp="rotator rotor beam antenna heading rotctld"><h2>🧭 Rotator</h2><div id="stRotB"></div></section>'); c = $('stRot'); }
    const pc = !!KN();
    $('stRotB').innerHTML = `<button type="button" class="b upsw${R.on ? ' on' : ''}" id="roOn"><b>${R.on ? 'ON' : 'OFF'}</b> <span>Turn my beam from the app (Hamlib rotctld)</span></button>
      <div id="roBody"${R.on ? '' : ' hidden'}>
      <div class="rocomp" id="roComp"></div>
      <div class="grid2"><label class="e">ROTCTLD AT<input id="roHost" value="${esc(R.host)}" spellcheck="false"></label><label class="e">PORT<input id="roPort" inputmode="numeric" value="${esc(R.port)}"></label>
      <label class="e">TURN TO (°)<input id="roTo" inputmode="numeric" maxlength="3" placeholder="0–359"></label><label class="e">BEAM OFFSET (°)<input id="roOff" inputmode="numeric" value="${esc(R.off || 0)}"></label></div>
      <div class="row"><button type="button" class="b gold" id="roGo">🧭 TURN</button><button type="button" class="b" id="roStop">⏹ STOP</button><button type="button" class="b" id="roRead">↻ WHERE IS IT</button></div>
      <button type="button" class="b upsw${R.auto ? ' on' : ''}" id="roAuto"><b>${R.auto ? 'ON' : 'OFF'}</b> <span>Turn the beam when I tap a spot</span></button>
      <button type="button" class="b upsw${R.lp ? ' on' : ''}" id="roLp"><b>${R.lp ? 'ON' : 'OFF'}</b> <span>Long path (the other way round)</span></button>
      <div class="st" id="roSt"></div>
      <p class="hint">Start Hamlib's rotctld for your controller first, e.g. <code>rotctld -m 603 -r COM5 -t 4533</code> (603 = Yaesu GS-232B; <code>rotctld -l</code> lists them all: Hy-Gain DCU-1 / Rotor-EZ, SPID, Green Heron …). Headings use your grid (STATION → My station) and the spot's grid; with only a call sign it aims at the country's centre (load CTY.DAT on the CONTEST tab). Beam offset = how far the beam points off the rotator's 0° (set it once).</p></div>`;
    $('roOn').onclick = () => { R.on = !R.on; save(); draw(); if (R.on && pc) read(); };
    paint(); if (!R.on) return;
    $('roHost').onchange = () => { R.host = $('roHost').value.trim() || '127.0.0.1'; save(); if (ST.id && KN()) KN().tcpClose(ST.id); ST.conn = false; };
    $('roPort').onchange = () => { R.port = +$('roPort').value || 4533; save(); if (ST.id && KN()) KN().tcpClose(ST.id); ST.conn = false; };
    $('roOff').onchange = () => { R.off = +$('roOff').value || 0; save(); };
    $('roGo').onclick = () => { const v = $('roTo').value.trim(); if (!/^\d{1,3}$/.test(v) || +v > 359) { AP.toast('Type a heading 0–359.', 2500, 'bad'); return; } turn(+v); };
    $('roTo').onkeydown = e => { if (e.key === 'Enter') $('roGo').click(); };
    $('roStop').onclick = () => stop();
    $('roRead').onclick = () => read();
    $('roAuto').onclick = () => { R.auto = !R.auto; save(); draw(); };
    $('roLp').onclick = () => { R.lp = !R.lp; save(); draw(); };
  }
  AP.on('screen', n => { if (n === 'station') draw(); });
  draw();

  G.KPCRotor = { S: R, save, turn, stop, read, headingTo, bearing, placeOf, state: () => Object.assign({}, ST), draw, paint };
})(window);
