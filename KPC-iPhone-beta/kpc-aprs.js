/* KPC app: APRS, the first mode built on the mode frame (Fable, Oct 22; Brandon Oct 21: 'add the aprs to the digi tab').
   Sound-card modem (1200 bd on 2 m 144.390 FM, 300 bd on 30 m 10.1476 USB) or a KISS TNC on a USB port (radios with a TNC inside).
   Hears stations → list + a range-ring map that needs no internet; sends a position beacon from the GPS with the park number;
   messages with acks; passes heard packets to the APRS internet network (iGate) when there is signal.
   TX needs a real licensed call: K4TEST (a practice call) can listen but never transmits. */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const AP = G.KPCApp, A = AP.audio, esc = AP.esc, X = G.KPCAX25;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  if (!X || !$('aprsPanel')) return;

  const BANDS = { '2m': { khz: 144390, baud: 1200, mark: 1200, space: 2200, mode: 'FM', path: 'WIDE1-1,WIDE2-1', label: '2 m · 144.390 FM' }, '30m': { khz: 10147.6, baud: 300, mark: 1600, space: 1800, mode: 'USB', path: '', label: '30 m · 10.1476 USB (300 bd)' } };
  const S = Object.assign({ band: '2m', ssid: 7, sym: '\\;', path: 'WIDE1-1,WIDE2-1', tpl: '{park} · KPC', auto: 0, modem: 'sound', kissPort: '', kissBaud: 9600, igate: false, digi: false, msgId: 1 }, LS('kpcAppAprs', {}));
  const save = () => SV('kpcAppAprs', S);
  const B = () => BANDS[S.band] || BANDS['2m'];
  let STA = new Map(LS('kpcAprsHeard', []));             /* call → the station we heard */
  let MSGS = LS('kpcAprsMsgs', []);                        /* messages in and out */
  let LINES = [], lid = 0, ME = null, meFrom = '', watchId = null, demod = null, txBusy = false, view = 'list', autoT = null, lastBeacon = 0, kissPort = null, kissDec = null, kissReader = null;

  const myCall = () => { const c = AP.myCall(); return c ? c.split('/')[0] + (S.ssid ? '-' + S.ssid : '') : ''; };
  const realCall = () => AP.stdCall(AP.myCall());
  const dial = () => B().khz;
  const whyNoTx = () => !AP.myCall() ? 'Put your call sign in STATION → My station first.' : !realCall() ? AP.myCall() + ' is a practice call: APRS listens, but transmitting needs a real licensed call.'
    : S.modem === 'kiss' ? (kissPort ? '' : 'Pick the TNC\'s USB port in ⚙ APRS settings and press CONNECT TNC.') : !AP.canKey() ? 'Nothing can key the radio yet: connect it (CAT) or pick VOX in STATION → Radio control.' : '';
  const timeS = t => AP.utc(t);

  /* ---------------- where am I ---------------- */
  function gridCenter(g) { g = String(g || '').toUpperCase(); if (g.length < 4) return null; const lon = (g.charCodeAt(0) - 65) * 20 - 180 + (+g[2]) * 2 + (g.length >= 6 ? (g.charCodeAt(4) - 65) / 12 + 1 / 24 : 1), lat = (g.charCodeAt(1) - 65) * 10 - 90 + (+g[3]) + (g.length >= 6 ? (g.charCodeAt(5) - 65) / 24 + 1 / 48 : 0.5); return { lat, lon }; }
  function locate() {
    if (!ME) { const c = gridCenter(AP.me().grid); if (c) { ME = c; meFrom = 'your grid square (rough)'; } }
    if (navigator.geolocation && watchId == null && !AP.pc) {
      try { watchId = navigator.geolocation.watchPosition(p => { ME = { lat: p.coords.latitude, lon: p.coords.longitude, mph: p.coords.speed != null && isFinite(p.coords.speed) ? p.coords.speed * 2.23694 : null, hdg: p.coords.heading != null && isFinite(p.coords.heading) ? p.coords.heading : null }; meFrom = 'GPS'; smart(); meLine(); if (view === 'map') drawMap(); }, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }); } catch (e) {}
    }
    meLine();
  }
  function unlocate() { if (watchId != null && navigator.geolocation) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} watchId = null; } }
  function meLine() { const e = $('apMe'); e.textContent = ME ? '📍 ' + ME.lat.toFixed(4) + ', ' + ME.lon.toFixed(4) + ' (' + meFrom + ')' + (AP.me().ref ? ' · ' + AP.me().ref : '') : '📍 No position yet: ' + (AP.pc ? 'type your grid square in STATION → My station (a PC has no GPS).' : 'press USE THIS DEVICE\'S GPS in STATION → My station, or put in your grid square.'); }

  /* ---------------- hearing ---------------- */
  function heard(fr, via) {
    const p = X.parse(fr); if (!p || !p.ui) return;
    const a = X.aprs(p.info, p.dest), me = myCall(), own = me && p.src.toUpperCase() === me;
    LINES.push({ id: ++lid, t: Date.now() / 1000, text: X.tnc2(p), cls: own ? 'mine' : a.kind === 'msg' && a.to === me ? 'me' : a.kind === 'pos' ? 'cq' : '' });
    if (LINES.length > 300) LINES = LINES.slice(-300);
    if (!own) {
      const st = STA.get(p.src) || { call: p.src, n: 0 };
      st.n++; st.t = Date.now(); st.via = via; st.path = p.path.join(','); st.raw = p.info.slice(0, 120);
      /* who carried it: hops marked used (*) that are real calls = the digipeaters it came through; none used = heard direct */
      const used = p.path.filter(h => /\*$/.test(h)).map(h => h.replace('*', '')).filter(h => !/^(WIDE|TRACE|RELAY|TEMP)\d?(-\d)?$/i.test(h));
      st.direct = used.length === 0; st.hops = used; st.digis = Array.from(new Set((st.digis || []).concat(used))).slice(-6);
      if (a.kind === 'pos' && (a.sym === '/#' || a.sym === '\\#' || /digi/i.test(a.comment || ''))) st.isDigi = true;
      if (a.kind === 'pos' || a.kind === 'obj') { Object.assign(st, { lat: a.lat, lon: a.lon, sym: a.sym, what: a.what, comment: a.comment, speed: a.speed, course: a.course }); if (a.kind === 'obj') st.obj = a.name; }
      else if (a.kind === 'status') st.status = a.comment;
      else if (a.kind === 'msg') st.msg = { to: a.to, text: a.msg, t: Date.now() };   /* Oct 23: shown in the heard list (Brandon) */
      if (ME && st.lat != null) { const g = X.geo(ME.lat, ME.lon, st.lat, st.lon); st.km = g.km; st.deg = g.deg; }
      STA.set(p.src, st); if (STA.size > 400) STA.delete(STA.keys().next().value);
      if (a.kind === 'msg' && me && a.to === me) {
        MSGS.push({ dir: 'in', from: p.src, text: a.msg, id: a.id, t: Date.now() }); AP.toast('✉ ' + esc(p.src) + ': ' + esc(a.msg), 8000, 'log');
        if (a.id) tx(X.ackText(p.src, a.id), true);
      }
      if (a.kind === 'ack') { const m = MSGS.find(x => x.dir === 'out' && x.to === p.src && x.id === a.id && !x.ack); if (m) { m.ack = Date.now(); AP.toast('✓ ' + esc(p.src) + ' got your message.', 3000, 'log'); } }
      if (G.KPCSpots && a.kind === 'pos' && /\b(US|CA|K|VE|[A-Z]{1,2}FF)-\d{3,5}\b/.test(a.comment || '')) KPCSpots.feed('aprs', [{ call: p.src.split('-')[0], khz: dial(), mode: 'APRS', refs: (a.comment.match(/\b(?:US|CA|K|VE|[A-Z]{1,2}FF)-\d{3,5}\b/g) || []), t: Date.now(), comment: a.comment, grid: '' }]);
      igate(p); digipeat(p);
    }
    MSGS = MSGS.slice(-200); SV('kpcAprsMsgs', MSGS); SV('kpcAprsHeard', [...STA.entries()].slice(-300));
    draw(); AP.fire('decoded', 'APRS');
  }
  function newDemod() { const b = B(); demod = X.Demod(12000, b.baud, b.mark, b.space); demod.onFrame = f => heard(f, S.band); }
  function rx(c) { if (S.modem !== 'sound' || !c.pcm) return; if (!demod) newDemod(); demod.feed(c.pcm); }

  /* ---------------- the iGate: heard packets → the APRS internet network, only with signal and a real call ---------------- */
  let igN = 0;
  function igate(p) {
    if (!S.igate || !realCall() || !AP.net.online()) return;
    if (/TCPIP|TCPXX|NOGATE|RFONLY/i.test(p.path.join(','))) return;
    const me = myCall(), line = p.src + '>' + p.dest + (p.path.length ? ',' + p.path.join(',') : '') + ',qAR,' + me + ':' + p.info;
    AP.net.fetch('http://rotate.aprs2.net:8080/', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'accept-type': 'text/plain' }, body: 'user ' + me + ' pass ' + X.passcode(me) + ' vers KPC ' + AP.VER + '\r\n' + line + '\r\n' }, 8000)
      .then(r => { if (r.ok) { igN++; $('apIg').hidden = false; $('apIg').textContent = '🌐 iGate: ' + igN + ' passed on' + (DIGN ? ' · ↻ digipeated ' + DIGN : ''); } }).catch(() => {});
  }

  /* ---------------- the fill-in DIGIPEATER (Brandon Oct 22: 'will we eventually have digipeat and igate?') ----------------
     Off by default. Repeats ONE hop: a packet whose next unused hop is WIDE1-1 goes out again with our call marked used in its
     place, once, on 2 m only, never our own packets, never one we repeated in the last 30 s, and only with a real call and a
     modem that can transmit. That is what a fill-in digi at a park does: it gets a handheld's beacon out to the wide digi on the hill. */
  const DSEEN = new Map();
  async function digipeat(p) {
    if (!S.digi || S.band !== '2m' || !realCall() || whyNoTx() || txBusy) return;
    const me = myCall(); if (!me || p.src.toUpperCase() === me) return;
    const path = p.path.slice(); const i = path.findIndex(h => !/\*$/.test(h)); if (i < 0) return;
    if (path[i].toUpperCase() !== 'WIDE1-1') return;
    if (path.slice(0, i).some(h => h.toUpperCase().replace('*', '') === me)) return;
    const key = p.src + '>' + p.info.slice(0, 60); const t = Date.now(); for (const [k, v] of DSEEN) if (t - v > 30000) DSEEN.delete(k); if (DSEEN.has(key)) return; DSEEN.set(key, t);
    path[i] = me + '*';
    const fr = X.build({ dest: p.dest, src: p.src, path, info: p.info });
    await new Promise(r => setTimeout(r, 300 + Math.random() * 900));   /* let the wide digi go first */
    if (txBusy) return;
    txBusy = true; chk();
    try {
      if (S.modem === 'kiss') await kissWrite(X.kiss.encode(fr));
      else { if (!AP.running()) return; const b = B(), pcm = X.modulate(fr, 48000, b.baud, b.mark, b.space, 20); A.pauseRx = true; await AP.pttOn(true); try { await A.play(pcm, 0, 'digi'); } finally { await AP.pttOn(false); } }
      DIGN++; LINES.push({ id: ++lid, t: Date.now() / 1000, text: '↻ ' + X.tnc2(X.parse(fr)), cls: 'mine', tx: true }); draw();
    } catch (e) {} finally { txBusy = false; chk(); }
  }
  let DIGN = 0;

  /* ---------------- sending ---------------- */
  async function tx(info, quiet) {
    const why = whyNoTx(); if (why) { if (!quiet) AP.toast(why, 5000, 'bad'); return false; }
    if (txBusy) { if (!quiet) AP.toast('Still sending the last packet.', 2500); return false; }
    const b = B(), frame = X.build({ dest: 'APZKPC', src: myCall(), path: (S.band === '2m' ? S.path : '').split(/[\s,]+/).filter(Boolean), info });
    txBusy = true; chk();
    try {
      if (S.modem === 'kiss') { await kissWrite(X.kiss.encode(frame)); }
      else {
        if (!AP.running() && !(await AP.start())) return false;
        const pcm = X.modulate(frame, 48000, b.baud, b.mark, b.space, b.baud === 300 ? 20 : 30);
        A.pauseRx = true; await AP.pttOn(true);
        try { await A.play(pcm, 0, 'aprs'); } finally { await AP.pttOn(false); }
      }
      LINES.push({ id: ++lid, t: Date.now() / 1000, text: X.tnc2(X.parse(frame)), cls: 'mine', tx: true }); draw();
      return true;
    } catch (e) { AP.toast('Did not go out: ' + esc(e.message || e), 5000, 'bad'); return false; }
    finally { txBusy = false; chk(); }
  }
  function comment() {
    const me = AP.me(), park = me.ref ? me.ref.split(' ').join('+') : '';
    return S.tpl.replace('{park}', park ? park : 'portable').replace('{freq}', G.KPCDigi ? (KPCDigi.dialKhz() / 1000).toFixed(3) : '').replace('{mode}', G.KPCModes && KPCModes.active() ? KPCModes.active().id : '').replace(/\s+·\s*$/, '').trim().slice(0, 43);
  }
  async function beacon() {
    if (!ME) { AP.toast('No position to send yet: GPS in STATION → My station, or a grid square.', 5000, 'bad'); AP.go('station'); return false; }
    const ok = await tx(X.posText(ME.lat, ME.lon, S.sym, comment(), '!'));
    if (ok) { lastBeacon = Date.now(); AP.toast('📡 Beacon sent: ' + esc(comment()), 3000, 'log'); }
    return ok;
  }
  function autoBeacon() { clearInterval(autoT); autoT = null; if (S.auto > 0) autoT = setInterval(() => { if (active && ME && !whyNoTx() && Date.now() - lastBeacon > S.auto * 60000 - 5000) beacon(); }, 15000);
    else if (S.auto < 0) autoT = setInterval(smart, 5000); }
  /* Brandon Oct 22: 'Beacon type be nice to have auto for when your mobile' — SmartBeaconing (the HamHUD rules most
     trackers use): parked or walking = every 30 min; faster = more often (every 3 min at 60 mph and up); a turn sends one
     straight away (sharper turns needed at low speed), never more than one every 30 s. Needs the GPS. */
  let lastHdg = null;
  function smart() {
    if (S.auto >= 0 || !active || !ME || whyNoTx() || txBusy || meFrom !== 'GPS') return;
    const mph = ME.mph || 0, since = (Date.now() - lastBeacon) / 1000, SLOW = 5, FAST = 60, SLOWR = 1800, FASTR = 180, TURN = 28, SLOPE = 26, TURNT = 30;
    const rate = mph < SLOW ? SLOWR : mph > FAST ? FASTR : FASTR * FAST / mph;
    let turn = false;
    if (mph > SLOW && ME.hdg != null && lastHdg != null) { let d = Math.abs(ME.hdg - lastHdg); if (d > 180) d = 360 - d; turn = d > TURN + SLOPE / mph && since >= TURNT; }
    if (!lastBeacon || since >= rate || turn) { lastHdg = ME.hdg; beacon(); }
  }
  let pend = [];
  function sendMsg(to, text) {
    to = String(to || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''); text = String(text || '').replace(/[|~{]/g, '').trim().slice(0, 67);
    if (!to || !text) return;
    const id = String(S.msgId++ % 100).padStart(2, '0'); save();
    const m = { dir: 'out', to, text, id, t: Date.now(), tries: 0 }; MSGS.push(m); SV('kpcAprsMsgs', MSGS);
    const go = async () => { if (m.ack || m.tries >= 3 || !active) return; m.tries++; await tx(X.msgText(to, text, id)); draw(); if (!m.ack && m.tries < 3) setTimeout(go, 30000); };
    go();
  }

  /* ---------------- KISS TNC on a USB port ---------------- */
  /* every port a TNC could be on: USB ports, and (Android) the Bluetooth devices paired in Android's settings; on Windows a
     Bluetooth TNC shows up as one of the COM ports once it is paired, and PICK A NEW PORT asks Windows for it */
  async function kissPorts() {
    const out = [];
    if (G.KPCNative.native && G.KPCNative.serial) (await G.KPCNative.serial.ports()).forEach(p => out.push({ i: 'u' + p.info.id, label: '🔌 ' + (p.info.name || p.info.chip || 'USB') + ' ' + (p.info.vid || '') + ':' + (p.info.pid || ''), port: p }));
    if (G.KPCNative.bt) { try { (await G.KPCNative.bt.list()).forEach(p => out.push({ i: 'b' + p.info.id, label: '📶 ' + p.info.name + ' (Bluetooth)', port: p })); } catch (e) { btWhy = String(e.message || e); } }
    if (!G.KPCNative.native && navigator.serial) { const ps = await navigator.serial.getPorts(); ps.forEach((p, i) => out.push({ i: 'w' + i, label: AP.portLabel(p, i), port: p })); }
    return out;
  }
  let btWhy = '';
  async function kissPickNew() {
    if (navigator.serial && !G.KPCNative.native) {
      const p = await AP.pickSerial('Pick the TNC\'s port', { allowedBluetoothServiceClassIds: ['00001101-0000-1000-8000-00805f9b34fb'] });
      if (!p) return false;
      const ps = await navigator.serial.getPorts(), i = ps.indexOf(p); if (i >= 0) { S.kissPort = 'w' + i; save(); }
      return true;
    }
    return false;
  }
  async function kissConnect() {
    await kissClose();
    const list = await kissPorts(), pick = list.find(p => String(p.i) === String(S.kissPort)) || null;
    if (!pick) { $('apTnc').textContent = 'TNC: no port picked.'; return false; }
    try {
      await pick.port.open({ baudRate: +S.kissBaud || 9600 }); kissPort = pick.port; kissDec = X.kiss.Decoder();
      $('apTnc').textContent = 'TNC: connected (' + pick.label + ').';
      (async () => { try { kissReader = kissPort.readable.getReader(); for (;;) { const { value, done } = await kissReader.read(); if (done) break; kissDec.feed(value).forEach(f => heard(f, 'tnc')); } } catch (e) {} })();
      chk(); return true;
    } catch (e) { $('apTnc').textContent = 'TNC: could not open the port (' + (e.message || e) + ').'; kissPort = null; chk(); return false; }
  }
  async function kissWrite(bytes) { if (!kissPort) throw new Error('no TNC'); const w = kissPort.writable.getWriter(); try { await w.write(bytes); } finally { try { w.releaseLock(); } catch (e) {} } }
  async function kissClose() { try { if (kissReader) await kissReader.cancel(); } catch (e) {} try { if (kissPort) await kissPort.close(); } catch (e) {} kissPort = null; kissReader = null; $('apTnc').textContent = S.modem === 'kiss' ? 'TNC: not connected.' : ''; }

  /* ONE simple TNC sheet (Brandon Oct 22, R2: 'one list of paired radios, one CONNECT, say what to pair first') */
  async function tncSheet() {
    const list = await kissPorts();
    AP.sheet('Radio with a TNC inside (Bluetooth or USB)', `
      <p class="hint"><b>1.</b> ${G.KPCNative.native ? 'Pair the radio or TNC in Android\'s Bluetooth settings first (or plug it in by USB).' : 'Pair the radio or TNC in Windows Bluetooth settings first (it becomes a COM port), or plug it in by USB.'} <b>2.</b> Pick it below. <b>3.</b> CONNECT. The TNC then does the decoding and keying; the sound card is not used.</p>
      <label class="e">MY TNC<select id="tnPick"><option value="">(pick one)</option>${list.map(p => `<option value="${p.i}"${String(S.kissPort) === String(p.i) ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      ${!list.length ? '<div class="st bad">Nothing paired or plugged in yet' + (btWhy ? ': ' + esc(btWhy) : '') + '.</div>' : ''}
      <div class="row"><button type="button" class="b gold" id="tnGo">🔌 CONNECT</button>${!G.KPCNative.native && navigator.serial ? '<button type="button" class="b" id="tnNew">➕ PICK A NEW PORT</button>' : ''}<button type="button" class="b" id="tnOff">USE THE SOUND CARD INSTEAD</button></div>
      <div class="st" id="tnSt">${S.modem === 'kiss' ? (kissPort ? 'Connected.' : 'TNC picked, not connected.') : 'Using the sound card now.'}</div>
      <p class="hint">Speed is 9600 unless your TNC says otherwise (⚙ APRS settings has the list).</p>`);
    $('tnGo').onclick = async () => { const v = $('tnPick').value; if (!v) { AP.toast('Pick the TNC first.', 3000, 'bad'); return; } S.kissPort = v; S.modem = 'kiss'; save(); $('tnSt').textContent = 'Connecting…'; const ok = await kissConnect(); $('tnSt').textContent = $('apTnc').textContent; if (ok) { AP.toast('✅ TNC connected. Beacons and messages go through it now.', 4000, 'log'); setTimeout(AP.shut, 800); } chk(); };
    if ($('tnNew')) $('tnNew').onclick = async () => { if (await kissPickNew()) { AP.shut(); tncSheet(); } };
    $('tnOff').onclick = async () => { S.modem = 'sound'; save(); await kissClose(); chk(); AP.shut(); AP.toast('Back to the sound card.', 3000); };
  }
  const tncB = $('apTncB'); if (tncB) tncB.onclick = tncSheet;

  /* ---------------- the screen ---------------- */
  function chk() {
    const why = whyNoTx();
    ['apBeacon', 'apMsg'].forEach(id => { $(id).disabled = !!why || txBusy; $(id).title = why; });
    const w = $('apWhy'); w.hidden = !why; w.textContent = why;
    $('apOff').hidden = AP.running() || S.modem === 'kiss';
    $('apBeacon').textContent = txBusy ? '📡 SENDING…' : '📡 BEACON NOW';
    $('apTnc').hidden = S.modem !== 'kiss';
    const tb = $('apTncB'); if (tb) { tb.classList.toggle('on', S.modem === 'kiss' && !!kissPort); tb.textContent = S.modem === 'kiss' ? (kissPort ? '📶 TNC ✓' : '📶 TNC…') : '📶 TNC'; }
  }
  function draw() {
    $('apN').textContent = STA.size;
    const list = [...STA.values()].sort((a, b) => b.t - a.t).slice(0, 150);
    $('apList').innerHTML = list.length ? list.map(s => `<div class="dl ${s.lat != null ? 'cq' : ''}" data-ap="${esc(s.call)}" role="button" tabindex="0"><span>${timeS(s.t)}</span><span>${s.km != null ? AP.dist(s.km, { noFt: 1 }) : ''}</span><span>${s.deg != null ? Math.round(s.deg) + '°' : ''}</span><span class="m"><b>${esc(s.call)}</b> ${s.msg && Date.now() - s.msg.t < 3600000 ? '<span class="apmsg">✉ ' + (s.msg.to === myCall() ? '<b>to you</b>' : 'to ' + esc(s.msg.to)) + ': ' + esc(s.msg.text) + '</span> ' : ''}${esc(s.what || (s.obj ? 'object ' + s.obj : ''))} ${esc((s.comment || s.status || '').slice(0, 120))}</span></div>`).join('')
      : '<div class="empty">Stations the radio hears show up here with how far away they are. 2 m: set the radio to 144.390 FM (the app does it over CAT when it can). 30 m: 10.1476 USB, 300 baud.</div>';
    const mm = $('apMsgs'); mm.hidden = !MSGS.length && view !== 'msgs';
    mm.innerHTML = MSGS.slice(-40).map(m => `<div class="dl ${m.dir === 'in' ? 'me' : 'mine'}"><span>${timeS(m.t)}</span><span>${m.dir === 'in' ? '⬇' : m.ack ? '✓' : m.tries >= 3 ? '✗' : '…'}</span><span></span><span class="m"><b>${esc(m.dir === 'in' ? m.from : m.to)}</b> ${esc(m.text)}${m.dir === 'out' && !m.ack ? ' <i>' + (m.tries >= 3 ? 'no ack' : 'waiting for ack') + '</i>' : ''}</span></div>`).join('');
    if (view === 'map') drawMap();
    if (view === 'sat') drawSat();
    chk();
  }
  /* ---------------- symbols + lines, shared by the rings map and the satellite map (Brandon Oct 23, F5) ----------------
     Our own small vector symbol set (no outside set, so nothing to license): the APRS code picks the glyph. */
  function drawSym(g, x, y, sym, r, fill, stroke) {
    const t = (sym || '').slice(-1), alt = (sym || '')[0] === '\\';
    g.save(); g.lineWidth = 1.5; g.strokeStyle = stroke; g.fillStyle = fill; g.beginPath();
    if (t === '-' || t === 'y') { g.moveTo(x - r, y + r); g.lineTo(x - r, y); g.lineTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x + r, y + r); g.closePath(); }                       /* house */
    else if (t === '>' || t === 'k' || t === 'j' || t === 'v' || t === 'U' || t === 'u') { g.roundRect ? g.roundRect(x - r, y - r * 0.55, 2 * r, r * 1.1, 3) : g.rect(x - r, y - r * 0.55, 2 * r, r * 1.1); g.fill(); g.stroke(); g.beginPath(); g.arc(x - r * 0.55, y + r * 0.6, r * 0.3, 0, 7); g.arc(x + r * 0.55, y + r * 0.6, r * 0.3, 0, 7); g.fillStyle = stroke; g.fill(); g.restore(); return; }  /* car / truck / van */
    else if (t === '#' || t === 'r') { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke(); g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5, a2 = a + Math.PI / 5; g.lineTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5); g.lineTo(x + Math.cos(a2) * r * 0.22, y + Math.sin(a2) * r * 0.22); } g.closePath(); g.fillStyle = stroke; g.fill(); g.restore(); return; }  /* digi / repeater: star in a diamond */
    else if (t === ';') { g.moveTo(x, y - r); g.lineTo(x + r, y + r * 0.8); g.lineTo(x - r, y + r * 0.8); g.closePath(); }                                                           /* park (tree/tent) */
    else if (t === '[') { g.arc(x, y - r * 0.6, r * 0.35, 0, 7); g.moveTo(x, y - r * 0.25); g.lineTo(x, y + r * 0.3); g.lineTo(x - r * 0.6, y + r); g.moveTo(x, y + r * 0.3); g.lineTo(x + r * 0.6, y + r); g.moveTo(x - r * 0.7, y); g.lineTo(x + r * 0.7, y); g.stroke(); g.restore(); return; }  /* walker */
    else if (t === 'b' || t === '<') { g.arc(x - r * 0.55, y + r * 0.3, r * 0.5, 0, 7); g.moveTo(x + r * 1.05, y + r * 0.3); g.arc(x + r * 0.55, y + r * 0.3, r * 0.5, 0, 7); g.moveTo(x - r * 0.55, y + r * 0.3); g.lineTo(x, y - r * 0.5); g.lineTo(x + r * 0.55, y + r * 0.3); g.stroke(); g.restore(); return; }  /* bike / motorcycle */
    else if (t === '_') { g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(x - r * 0.6, y); g.lineTo(x + r * 0.6, y); g.moveTo(x, y - r * 0.6); g.lineTo(x, y + r * 0.6); g.moveTo(x - r * 0.42, y - r * 0.42); g.lineTo(x + r * 0.42, y + r * 0.42); g.moveTo(x + r * 0.42, y - r * 0.42); g.lineTo(x - r * 0.42, y + r * 0.42); g.strokeStyle = stroke; g.stroke(); g.restore(); return; }  /* weather */
    else if (t === 's' || t === 'Y') { g.moveTo(x - r, y); g.lineTo(x + r, y); g.lineTo(x + r * 0.6, y + r * 0.7); g.lineTo(x - r * 0.6, y + r * 0.7); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - r); g.lineTo(x + r * 0.7, y - r * 0.2); g.closePath(); }  /* boat */
    else if (t === "'" || t === '^') { g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r * 0.9); g.lineTo(x, y + r * 0.7); g.moveTo(x - r * 0.4, y + r * 0.7); g.lineTo(x + r * 0.4, y + r * 0.7); g.lineWidth = 2.5; g.stroke(); g.restore(); return; }  /* aircraft */
    else if (t === 'O') { g.arc(x, y - r * 0.3, r * 0.7, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(x, y + r * 0.4); g.lineTo(x, y + r); g.stroke(); g.restore(); return; }  /* balloon */
    else if (t === '$' || t === 'l' || t === '(') { g.rect(x - r * 0.5, y - r, r, 2 * r); }                                                                                              /* phone / portable */
    else { g.arc(x, y, r * 0.75, 0, 7); }
    g.fill(); g.stroke(); g.restore();
  }
  /* lines: me → each station heard direct (thin, solid); a packet that came through digipeaters is drawn hop by hop
     (station → digi → … → me, dashed) when the digi's own position is known, else one dashed line labelled with the digi */
  function drawLinks(g, P, me, o) {
    if (!me) return;
    const [mx, my] = P(me.lat, me.lon), pos = c => { const d = STA.get(c) || [...STA.values()].find(s => s.call.split('-')[0] === String(c).split('-')[0]); return d && d.lat != null ? d : null; };
    for (const s of STA.values()) {
      if (s.lat == null) continue;
      const [x, y] = P(s.lat, s.lon), fresh = Date.now() - s.t < 600000;
      g.save(); g.lineWidth = 1; g.globalAlpha = fresh ? 0.75 : 0.35;
      if (s.direct) { g.strokeStyle = o.sat ? '#9fd3ff' : '#6DB4F5'; g.setLineDash([]); g.beginPath(); g.moveTo(x, y); g.lineTo(mx, my); g.stroke(); }
      else {
        g.strokeStyle = o.sat ? '#ffd27a' : '#E8B84A'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x, y);
        let known = 0; for (const h of s.hops || []) { const d = pos(h); if (d) { const [hx, hy] = P(d.lat, d.lon); g.lineTo(hx, hy); known++; } }
        g.lineTo(mx, my); g.stroke();
        if (!known && s.hops && s.hops.length) { g.setLineDash([]); g.globalAlpha = 1; g.fillStyle = o.sat ? '#ffd27a' : (o.dark ? '#c9a24a' : '#7F5300'); g.font = '9px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('via ' + s.hops.join(','), (x + mx) / 2, (y + my) / 2 - 3); }
      }
      g.restore();
    }
  }
  function drawStations(g, P, o) {
    const dark = o.dark, r = o.small ? 6 : 8;
    g.font = (o.small ? '10px' : '600 11px') + ' system-ui, sans-serif';
    for (const s of STA.values()) {
      if (s.lat == null) continue;
      const [x, y] = P(s.lat, s.lon), fresh = Date.now() - s.t < 600000;
      const fill = s.isDigi ? (fresh ? '#5FD39B' : '#3b7d5e') : fresh ? '#6DB4F5' : (dark || o.sat ? '#59667a' : '#8b93a1');
      drawSym(g, x, y, s.isDigi ? '/#' : s.sym, r, fill, o.sat ? '#000' : (dark ? '#0b0f14' : '#faf8f2'));
      g.fillStyle = o.sat ? '#fff' : (dark ? '#E6EAF0' : '#1A1E24'); g.textAlign = 'left'; g.fillText(s.obj || s.call, x + r + 2, y + 4);
    }
  }
  function drawMap() {
    const c = $('apMap'); if (c.hidden) return;
    const w = c.clientWidth || 360, h = 260; if (c.width !== w) { c.width = w; c.height = h; }
    const g = c.getContext('2d'), dark = document.documentElement.dataset.theme !== 'light';
    g.clearRect(0, 0, w, h); g.fillStyle = dark ? '#0b0f14' : '#faf8f2'; g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(cx, cy) - 14;
    const sts = [...STA.values()].filter(s => s.km != null);
    const U = AP.toUnit, far = Math.max(3, ...sts.map(s => U(s.km))), ring = far <= 10 ? 2.5 : far <= 50 ? 10 : far <= 150 ? 25 : far <= 400 ? 100 : 250, max = Math.ceil(far / ring) * ring;
    g.strokeStyle = dark ? '#2D3643' : '#DCD8CC'; g.fillStyle = dark ? '#9AA6B5' : '#5A6270'; g.font = '10px ' + 'ui-monospace, Menlo, monospace'; g.textAlign = 'left';
    for (let r = ring; r <= max; r += ring) { const px = r / max * R; g.beginPath(); g.arc(cx, cy, px, 0, Math.PI * 2); g.stroke(); g.fillText(r + ' ' + AP.distUnit(), cx + px + 2, cy - 2); }
    g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.stroke(); g.fillText('N', cx + 3, 12);
    if (!ME) { g.textAlign = 'center'; g.fillText('no position yet (GPS or grid square)', cx, cy + 4); return; }
    const P = (la, lo) => { const gg = X.geo(ME.lat, ME.lon, la, lo), px = U(gg.km) / max * R, a = (gg.deg - 90) * Math.PI / 180; return [cx + Math.cos(a) * px, cy + Math.sin(a) * px]; };
    drawLinks(g, P, ME, { dark, small: true });
    drawStations(g, P, { dark, small: true });
    g.fillStyle = '#E8B84A'; g.strokeStyle = dark ? '#0b0f14' : '#faf8f2'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = dark ? '#9AA6B5' : '#5A6270'; g.font = '9px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText('— heard direct   - - via a digipeater', 6, h - 6);
  }
  $('apList').addEventListener('click', e => {
    const r = e.target.closest('[data-ap]'); if (!r) return; const s = STA.get(r.dataset.ap); if (!s) return;
    AP.sheet(s.call, `<p>${esc(s.what || '')} ${s.lat != null ? '· ' + s.lat.toFixed(4) + ', ' + s.lon.toFixed(4) : ''}${s.km != null ? ' · ' + AP.dist(s.km) + ' at ' + Math.round(s.deg) + '°' : ''}${s.speed ? ' · ' + (AP.distUnit() === 'km' ? Math.round(s.speed * 1.852) + ' km/h' : Math.round(s.speed * 1.15078) + ' mph') : ''}</p>
      <p class="hint">${esc(s.comment || s.status || '')}</p><p class="hint mono">heard ${s.n}× · last ${esc(timeS(s.t))} UTC · ${s.direct ? 'heard DIRECT' : 'via ' + esc((s.hops || []).join(' → ') || s.path || '?')}${s.digis && s.digis.length ? ' · digis seen: ' + esc(s.digis.join(', ')) : ''}</p>
      <div class="row"><button type="button" class="b gold" id="apMsgTo">✉ MESSAGE ${esc(s.call)}</button>${s.lat != null ? `<a class="b" href="https://www.google.com/maps?q=${s.lat},${s.lon}" target="_blank" rel="noopener">🗺 OPEN IN MAPS</a>` : ''}</div>`);
    $('apMsgTo').onclick = () => { AP.shut(); msgSheet(s.call); };
  });
  function msgSheet(to) {
    AP.sheet('APRS message', `<div class="grid2"><label class="e">TO (CALL-SSID)<input id="apTo" autocapitalize="characters" spellcheck="false" value="${esc(to || '')}" placeholder="K4TEST-7"></label>
      <label class="e">MESSAGE (67 letters)<input id="apTxt" maxlength="67" placeholder="At the park, see you on 14.074"></label></div>
      <div class="row"><button type="button" class="b gold" id="apSend">⬆ SEND</button></div><p class="hint">Sent up to 3 times, 30 s apart, until the other station acks it.</p>`);
    $('apSend').onclick = () => { sendMsg($('apTo').value, $('apTxt').value); AP.shut(); draw(); };
  }
  $('apBeacon').onclick = beacon;
  $('apMsg').onclick = () => msgSheet('');
  /* LIST → MAP (range rings, no internet) → SATELLITE (Brandon Oct 22: 'a sat style map would be nice'; pictures need signal) → LIST */
  let satMap = null;
  function drawSat() {
    const c = $('apSat'); if (!c || c.hidden || !G.KPCMap) return;
    if (!satMap) satMap = G.KPCMap.create(c, { sat: true, draw(ctx, P, z, o) {
      drawLinks(ctx, P, ME, o); drawStations(ctx, P, o);
      if (ME) { const [x, y] = P(ME.lat, ME.lon); ctx.fillStyle = '#E8B84A'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = o.sat ? '#fff' : (o.dark ? '#9AA6B5' : '#5A6270'); ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('— direct   - - via a digipeater   ◆ digi', 6, o.h - 6);
    }, tap(la, lo, tx, ty) { let hit = null, best = 22; for (const s of STA.values()) { if (s.lat == null) continue; const [x, y] = satMap.P(s.lat, s.lon), d = Math.hypot(x - tx, y - ty); if (d < best) { best = d; hit = s; } } if (hit) { const r = document.querySelector('[data-ap="' + CSS.escape(hit.call) + '"]'); if (r) r.click(); } } });
    const pts = [...STA.values()].filter(s => s.lat != null).map(s => [s.lat, s.lon]).concat(ME ? [[ME.lat, ME.lon]] : []);
    if (!drawSat.fitted && pts.length) { satMap.fit(pts); drawSat.fitted = true; } else satMap.redraw();
  }
  $('apView').onclick = () => {
    view = view === 'list' ? 'map' : view === 'map' ? 'sat' : 'list';
    $('apMap').hidden = view !== 'map'; const sc = $('apSat'); if (sc) sc.hidden = view !== 'sat'; $('apList').hidden = view !== 'list';
    $('apView').textContent = view === 'list' ? '🗺 MAP' : view === 'map' ? '🛰 SATELLITE' : '📋 LIST';
    if (view === 'sat' && !AP.net.online()) AP.toast('No signal: satellite pictures need the internet. The stations still show.', 4000);
    draw(); if (view === 'sat') { drawSat.fitted = false; drawSat(); }
  };
  $('apStart').onclick = () => AP.start();
  $('apBand').innerHTML = Object.keys(BANDS).map(b => `<option value="${b}"${b === S.band ? ' selected' : ''}>${BANDS[b].label}</option>`).join('');
  $('apBand').onchange = () => setBand($('apBand').value);
  function setBand(b) {
    if (!BANDS[b]) return false; S.band = b; save(); $('apBand').value = b; $('apDial').textContent = (dial() / 1000).toFixed(4).replace(/0$/, ''); newDemod();
    if (AP.catConnected()) KPCCat.tune(dial(), B().mode).then(ok => { if (!ok) AP.toast('The radio did not take ' + (dial() / 1000).toFixed(4) + ' MHz ' + B().mode + ' (a 2 m radio?). Set it by hand.', 5000); });
    else AP.toast('Set the radio to ' + (dial() / 1000).toFixed(4) + ' MHz ' + B().mode + '.', 3000);
    return true;
  }
  function settings() {
    kissPorts().then(list => {
      AP.sheet('APRS settings', `
        <h3 class="sh">My beacon</h3>
        <div class="grid2">
          <label class="e">SSID (−7 = portable)<select id="apSsid">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(n => `<option value="${n}"${+S.ssid === n ? ' selected' : ''}>${n ? '-' + n : 'none'}</option>`).join('')}</select></label>
          <label class="e">SYMBOL<select id="apSym">${[['\\;', 'park / picnic'], ['/;', 'campground'], ['/[', 'on foot'], ['/>', 'car'], ['/-', 'house'], ['/y', 'home station'], ['/b', 'bike']].map(x => `<option value="${esc(x[0])}"${S.sym === x[0] ? ' selected' : ''}>${x[1]}</option>`).join('')}</select></label>
          <label class="e">COMMENT ({park} {freq} {mode} fill in)<input id="apTpl" value="${esc(S.tpl)}" maxlength="43"></label>
          <label class="e">2 m PATH<input id="apPath" value="${esc(S.path)}" placeholder="WIDE1-1,WIDE2-1"></label>
          <label class="e">BEACON BY ITSELF<select id="apAuto">${[[0, 'off'], [5, 'every 5 min'], [10, 'every 10 min'], [20, 'every 20 min'], [30, 'every 30 min'], [-1, 'AUTO when mobile (by speed + turns, GPS)']].map(x => `<option value="${x[0]}"${+S.auto === x[0] ? ' selected' : ''}>${x[1]}</option>`).join('')}</select></label>
        </div>
        <h3 class="sh">How the packets get to the radio</h3>
        <div class="grid2">
          <label class="e">MODEM<select id="apModem"><option value="sound"${S.modem === 'sound' ? ' selected' : ''}>This device's sound (data cable)</option><option value="kiss"${S.modem === 'kiss' ? ' selected' : ''}>KISS TNC on a USB port (radio with a TNC inside)</option></select></label>
          <label class="e">TNC PORT (USB or 📶 BLUETOOTH)<select id="apKiss"><option value="">(none)</option>${list.map(p => `<option value="${p.i}"${String(S.kissPort) === String(p.i) ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
          <label class="e">TNC SPEED<select id="apKissBaud">${[1200, 9600, 19200, 38400, 57600, 115200].map(b => `<option value="${b}"${(+S.kissBaud || 9600) === b ? ' selected' : ''}>${b}</option>`).join('')}</select></label>
        </div>
        <div class="row"><button type="button" class="b" id="apKissGo">🔌 CONNECT TNC</button>${!G.KPCNative.native && navigator.serial ? '<button type="button" class="b" id="apKissNew">➕ PICK A NEW PORT</button>' : ''}</div>
        ${btWhy ? '<div class="st bad">Bluetooth: ' + esc(btWhy) + '</div>' : ''}
        <p class="hint">Sound: 1200 baud on 2 m, 300 baud on 30 m, keyed like FT8 (CAT or VOX). TNC: the radio keys itself. BLUETOOTH TNC: pair it in ${G.KPCNative.native ? 'Android\'s Bluetooth settings' : 'Windows Bluetooth settings (it becomes a COM port)'} first, then it shows in the list with 📶.</p>
        <h3 class="sh">The internet side</h3>
        <label class="ck" style="display:flex;margin:9px 0"><input type="checkbox" id="apIgate"${S.igate ? ' checked' : ''}> <span>🌐 <b>Pass what I hear to the APRS internet network</b> (iGate) — only while this device has signal, and only with a real call</span></label>
        <h3 class="sh">Digipeater</h3>
        <label class="ck" style="display:flex;margin:9px 0"><input type="checkbox" id="apDigi"${S.digi ? ' checked' : ''}> <span>↻ <b>Fill-in digipeater</b> (WIDE1-1 only, 2 m) — repeats a nearby handheld's packet once so the big digi on the hill hears it. Off unless you mean it: it transmits by itself.${DIGN ? ' Repeated ' + DIGN + ' so far.' : ''}</span></label>
        <p class="hint">Keep the hint in mind: APRS is shared air. A beacon every 10 min is plenty from a park.</p>`,
        () => {
          S.ssid = +$('apSsid').value; S.sym = $('apSym').value; S.tpl = $('apTpl').value.trim() || '{park} · KPC'; S.path = $('apPath').value.trim().toUpperCase();
          S.auto = +$('apAuto').value; S.modem = $('apModem').value; S.kissPort = $('apKiss').value; S.kissBaud = +$('apKissBaud').value || 9600; S.igate = $('apIgate').checked; S.digi = $('apDigi').checked; save(); autoBeacon(); chk();
          if (S.modem !== 'kiss') kissClose();
        });
      $('apKissGo').onclick = () => { S.kissPort = $('apKiss').value; S.modem = 'kiss'; save(); kissConnect(); };
      if ($('apKissNew')) $('apKissNew').onclick = async () => { if (await kissPickNew()) { AP.shut(); settings(); } };
    });
  }

  /* ---------------- on the frame ---------------- */
  let active = false;
  const M = G.KPCModes.add({
    id: 'APRS', label: 'APRS', panel: '#aprsPanel', title: 'APRS: position beacons, who is around, messages',
    bands: Object.keys(BANDS), band: () => S.band, setBand, khz: dial,
    rx, run: on => { if (!on) newDemod(); chk(); },
    activate: () => { active = true; locate(); newDemod(); autoBeacon(); draw(); $('apDial').textContent = (dial() / 1000).toFixed(4).replace(/0$/, ''); if (S.modem === 'kiss' && !kissPort) kissConnect(); },
    deactivate: () => { active = false; unlocate(); clearInterval(autoT); autoT = null; if (txBusy) Promise.resolve().then(() => A.stopTx()).catch(() => {}); },
    settings, lines: () => LINES, hello: 'APRS: 2 m 144.390 FM by default. BEACON sends where you are with your park number.',
    ops: { beacon: () => beacon(), halt: () => { if (txBusy) Promise.resolve().then(() => A.stopTx()).catch(() => {}); }, msg: a => sendMsg(a.to, a.text) },
    buttons: [{ op: 'beacon', label: '📡 BEACON', cls: 'gold' }, { op: 'halt', label: 'HALT', cls: 'halt' }],
    enabled: () => false, txing: () => txBusy, halt: () => { if (txBusy) Promise.resolve().then(() => A.stopTx()).catch(() => {}); },
    state: () => ({ heard: STA.size, me: ME, last: lastBeacon })
  });
  AP.on('key', chk); AP.on('me', () => { if (active) { meLine(); chk(); } }); AP.on('look', () => { if (view === 'map') drawMap(); });
  AP.on('screen', s => { if (s === 'digi' && active) draw(); });
  draw(); chk();
  AP.on('units', () => draw());
  G.KPCAprs = { S, save, heard, tx, beacon, why: whyNoTx, sendMsg, stations: () => STA, messages: () => MSGS, setBand, mode: M, demod: () => demod, me: () => ME, setMe: (lat, lon) => { ME = { lat, lon }; meFrom = 'set'; meLine(); } };
})(window);
