/* KPC app shell: the three screens, the look switch, and the one place everything shares —
   my station (call, grid, park), the sound (KPCNative.audio), the radio over USB (kpc-cat.js), keying the radio, toasts and sheets.
   Brandon's rules (Oct 21): settings live in ONE place, tabs on the phone, and a button that can't work yet is hidden. */
(function (G) {
  'use strict';
  let CHP, KAP;   /* plugin handles, registered once (Oct 24) */
  const VER = '0.8.0';
  /* KPC Lite (Oct 28, HQ): kpc-flavor.js (overwritten by the nightly build for the Lite APK) or ?lite=1. index.html already skipped the left-out files. */
  const LITE = !!document.documentElement.dataset.lite, LITE_OFF = { remote: 1 };
  const $ = id => document.getElementById(id);
  const N = G.KPCNative, A = N.audio;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const utc = (ms, sec) => { const d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + (sec ? ':' + pad(d.getUTCSeconds()) : ''); };

  const S = Object.assign({
    call: '', grid: '', ref: '', role: 'act', as: '', goal: 0,
    inDev: '', outDev: '', db: -6, rxDb: 0, ptt: 'cat', follow: 1
  }, LS('kpcApp', {}));
  const save = () => SV('kpcApp', S);
  let CTL = '';                                            /* control operator on the remote link, if any */
  const myCall = () => String(S.as || S.call || '').toUpperCase();
  const myGrid = () => String(S.grid || '').slice(0, 6).toUpperCase();

  /* ---------------- toast + sheet ---------------- */
  let tT = null;
  function toast(t, ms, kind) {
    const el = $('toast'); el.innerHTML = t; el.className = 'toast' + (kind ? ' ' + kind : ''); el.hidden = false;
    clearTimeout(tT); tT = setTimeout(() => { el.hidden = true; }, ms || 3000);
  }
  let sheetDone = null;
  function sheet(title, html, onDone) {
    $('sheetT').textContent = title; $('sheetB').innerHTML = html; $('sheet').hidden = false; sheetDone = onDone || null;
  }
  function shut() { $('sheet').hidden = true; if (sheetDone) { const f = sheetDone; sheetDone = null; f(); } }
  $('sheetX').onclick = shut;
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) shut(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sheet').hidden) shut(); });

  /* ---------------- look ---------------- */
  function look(n) { document.documentElement.dataset.theme = n; try { localStorage.setItem('kpcTheme', n); } catch (e) {} fire('look', n); }
  $('look').onclick = () => look(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  /* Oct 26 (Brandon: 'a little less plain, more Hunters Lounge look'): the Lounge's CABIN LODGE look (its painting, wood, embers) is the
     dark look by default; FOREST NIGHT = the green-black one; LIGHT = cream. data-style on <html>, localStorage kpcStyle. */
  document.querySelectorAll('[data-look]').forEach(b => { b.onclick = () => { if (b.dataset.style) { document.documentElement.dataset.style = b.dataset.style; try { localStorage.setItem('kpcStyle', b.dataset.style); } catch (e) {} } look(b.dataset.look); }; });

  /* ---------------- screens ---------------- */
  const TITLE = { logs: 'My logs', log: 'Log', digi: 'Digital modes', station: 'Station', remote: 'Remote', spots: 'Spots', map: 'Contacts map', radio: 'Radio' };
  function go(name) {
    if (LITE && LITE_OFF[name]) name = 'log';
    document.body.dataset.screen = name; $('ttl').textContent = TITLE[name] || 'KPC';
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === name || (name === 'logs' && b.dataset.go === 'log')));
    SV('kpcScreen', name === 'logs' ? 'log' : name); fire('screen', name);
  }
  document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => go(b.dataset.go); });

  /* ---------------- serial ports with real names (Oct 23, Brandon: 'little tough to figure out what com port') ----------------
     chipName(vid) = the USB chip in words; pickSerial(title, opts) = a sheet with Windows' own names (Windows app) and the
     exact port back, or null. Needs a tap (both requestPort calls run inside one). */
  const CHIPS = { '10c4': 'Silicon Labs CP210x', '0403': 'FTDI', '1a86': 'CH340', '067b': 'Prolific PL2303', '2341': 'Arduino', '0483': 'STM32', '1209': 'open hardware', '04d8': 'Microchip', '2e8a': 'Raspberry Pi Pico', '303a': 'Espressif ESP32', '0c26': 'Icom', '26aa': 'Yaesu', '0b28': 'Kenwood' };
  const hex4 = v => (v == null || v === '' ? '' : (+v).toString(16).padStart(4, '0'));
  const chipName = vid => CHIPS[hex4(vid)] || '';
  const PN = LS('kpcPortNames', {});
  function pickSerial(title, o) {
    o = o || {};
    if (!navigator.serial || N.native) return Promise.resolve(null);
    const kn = G.kpcNet;
    if (!kn || !kn.portList) return navigator.serial.requestPort(o).catch(() => null);
    return new Promise(done => {
      const lp = kn.portList(); navigator.serial.requestPort(o).catch(() => {});
      lp.then(list => {
        if (!list.length) { toast('Windows lists no COM ports. Plug the cable in (or pair the Bluetooth device in Windows settings) and try again.', 7000, 'bad'); return done(null); }
        sheet(title || 'Pick the port', '<p class="hint">These are Windows\' own names. A radio with two (Enhanced / Standard) talks on the <b>Enhanced</b> one; Bluetooth shows as "Standard Serial over Bluetooth link".</p><div class="oplist">' +
          list.map((p, i) => `<button type="button" class="op b" style="width:100%;text-align:left;height:auto;padding:10px" data-pp="${i}"><b>${esc(p.name || 'Port')}</b> ${esc(p.label.replace(p.name ? '(' + p.name + ')' : '', '').trim())}${chipName(parseInt(p.vid, 10)) ? ' <i>' + esc(chipName(parseInt(p.vid, 10))) + '</i>' : ''}</button>`).join('') + '</div>', () => done(null));
        document.querySelectorAll('[data-pp]').forEach(b => { b.onclick = async () => {
          const p = list[+b.dataset.pp]; await kn.portChoose(p.id);
          let port = null; try { port = await navigator.serial.requestPort(o); } catch (e) {}
          if (port) { const inf = port.getInfo(); PN[hex4(inf.usbVendorId) + ':' + hex4(inf.usbProductId) + ':' + p.name] = p.label; PN['@last'] = p.label; SV('kpcPortNames', PN); port.kpcName = p.label; }
          const d = done; done = () => {}; shut(); d(port);
        }; });
      });
    });
  }
  /* a port from getPorts() in words: '🔌 COM5 · Silicon Labs CP210x USB to UART (Enhanced)' when Windows told us before */
  function portLabel(port, i) {
    const inf = port.getInfo ? port.getInfo() : {}, key = hex4(inf.usbVendorId) + ':' + hex4(inf.usbProductId) + ':';
    const known = port.kpcName || Object.keys(PN).filter(k => k.startsWith(key)).map(k => PN[k]);
    const nm = typeof known === 'string' ? known : known.length === 1 ? known[0] : '';
    if (inf.usbVendorId) return '🔌 ' + (nm || ('USB port ' + (i + 1) + (chipName(inf.usbVendorId) ? ' · ' + chipName(inf.usbVendorId) : ''))) ;
    return '📶 ' + (nm || 'COM port ' + (i + 1) + ' (Bluetooth or a built-in port)');
  }

  /* distances (Oct 23, Brandon: 'km use standard units'): miles + feet unless STATION → My station says kilometres */
  function dist(km, o) {
    if (km == null || !isFinite(km)) return '';
    if (S.units === 'km') return km < 1 ? Math.round(km * 1000) + ' m' : (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()) + ' km';
    const mi = km / 1.609344;
    if (mi < 0.2 && !(o && o.noFt)) return Math.round(mi * 5280).toLocaleString() + ' ft';
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString()) + ' mi';
  }
  const distUnit = () => S.units === 'km' ? 'km' : 'mi', toUnit = km => S.units === 'km' ? km : km / 1.609344;

  /* ---------------- little event bus ---------------- */
  const SUB = {};
  function on(k, fn) { (SUB[k] = SUB[k] || []).push(fn); }
  function fire(k, a, b) { (SUB[k] || []).forEach(f => { try { f(a, b); } catch (e) { console.error(e); } }); }

  /* ---------------- sound ---------------- */
  let RUN = false, TXING = false, DEVS = { inputs: [], outputs: [] };
  async function devices() {
    try { DEVS = await A.devices(); } catch (e) { DEVS = { inputs: [], outputs: [] }; }
    /* Oct 23 (Brandon's desktop: in/out on Windows' 'default' / 'communications' = no TX sound): the radio's USB sound card
       is listed first, Windows' own two picks say what they are, and the output follows the input (same sound card). */
    const nm = x => x.sys ? (x.id === 'communications' ? 'Windows communications device (usually a headset, not the radio)' : 'Windows default (usually the PC speakers / mic)') : (x.usb ? '🔌 ' : '') + (x.name || x.id);
    const fill = (sel, list, cur) => { if (!sel) return; const l = [...list].sort((a, b) => (b.usb - a.usb) || (a.sys - b.sys)); sel.innerHTML = '<option value="">Default</option>' + l.filter(x => !(x.sys && x.id === 'default')).map(x => `<option value="${esc(x.id)}">${esc(nm(x))}</option>`).join(''); sel.value = cur && list.some(x => String(x.id) === String(cur)) ? cur : ''; };
    fill($('stIn'), DEVS.inputs, S.inDev); fill($('stOut'), DEVS.outputs, S.outDev);
    const sysPick = v => !v || v === 'default' || v === 'communications';
    if (sysPick(S.inDev)) { const u = DEVS.inputs.find(x => x.usb); if (u) $('stIn').value = u.id; }
    if (sysPick(S.outDev)) { const u = twin($('stIn').value) || DEVS.outputs.find(x => x.usb); if (u) $('stOut').value = u.id; }
    return DEVS;
  }
  /* the output on the same sound card as an input: same groupId (web), else the same name without 'Microphone'/'Speakers' */
  function twin(inId) {
    const i = DEVS.inputs.find(x => String(x.id) === String(inId)); if (!i || i.sys) return null;
    const base = n => String(n || '').toLowerCase().replace(/microphone|speakers?|input|output|line|\(|\)|-/g, ' ').replace(/\s+/g, ' ').trim();
    return DEVS.outputs.find(o => !o.sys && i.grp && o.grp === i.grp) || DEVS.outputs.find(o => !o.sys && base(o.name) && base(o.name) === base(i.name)) || null;
  }
  function soundWarn() {
    const usbIn = DEVS.inputs.find(x => x.usb), usbOut = DEVS.outputs.find(x => x.usb), bad = v => !v || v === 'default' || v === 'communications';
    const w = [];
    if (bad(S.inDev) && usbIn) w.push('RADIO SOUND IN is on Windows\' ' + (S.inDev || 'default') + ', not the radio: pick 🔌 ' + esc(usbIn.name));
    if (bad(S.outDev) && usbOut) w.push('RADIO SOUND OUT is on Windows\' ' + (S.outDev || 'default') + ', so your transmit sound goes to the PC, not the radio: pick 🔌 ' + esc(usbOut.name));
    if (w.length && !N.native) toast('⚠ ' + w.join('<br>⚠ ') + '<br>(STATION → Sound)', 10000, 'bad');
  }
  function state() {
    const el = $('rxState'); el.textContent = TXING ? 'TX' : RUN ? 'RX' : 'OFF';
    el.className = 'state' + (TXING ? ' tx' : RUN ? ' rx' : '');
    document.querySelector('.tabs [data-go="digi"]').classList.toggle('live', RUN);
    $('stStart').disabled = RUN; $('stStop').disabled = !RUN;
  }
  let quietSince = 0, quietSaid = 0;
  function level(c) {
    const db = c.db, pct = Math.max(0, Math.min(100, (db + 80) / 80 * 100));
    /* nothing coming in for 8 s = almost always the wrong sound card picked (Brandon Oct 22: Windows did not decode) */
    if (db > -70) quietSince = 0; else if (!quietSince) quietSince = Date.now(); else if (Date.now() - quietSince > 8000 && Date.now() - quietSaid > 120000) { quietSaid = Date.now(); toast('🔇 No sound is coming in (' + db.toFixed(0) + ' dB). Under STATION → Sound pick the radio\'s USB sound card as RADIO SOUND IN (not the ' + (N.native ? 'tablet' : 'PC') + ' microphone), press STOP then START LISTENING, and turn the radio\'s USB OUT level up.', 10000, 'bad'); }
    const i = $('stLvl'); i.style.width = pct + '%'; i.className = db > -3 ? 'bad' : '';
    $('stLvlT').textContent = (c.tx ? 'TX · ' : '') + db.toFixed(0) + ' dB';
    const d = $('dgLvl'); if (d) d.textContent = db.toFixed(0) + ' dB';
    /* Brandon Oct 22: 'rx bar in ft8 so I can see if incoming is to loud or not' — a bar with a word: too quiet / good / loud / TOO LOUD */
    const bar = $('dgLvlBar'), w = $('dgLvlW');
    if (bar && !c.tx) { const z = db < -55 ? ['low', 'too quiet'] : db <= -10 ? ['ok', 'good'] : db <= -3 ? ['hot', 'loud'] : ['bad', 'TOO LOUD']; bar.style.width = pct + '%'; bar.className = z[0]; if (w) { w.textContent = z[1]; w.className = z[0]; } }
  }
  async function start() {
    if (RUN) return true;
    /* Oct 25 (Brandon pressed START on the tablet to get the remote sound back, which started the tablet's OWN sound instead): on the link the PC owns the radio */
    if (G.KPCRemote && !KPCRemote.base && KPCRemote.link && KPCRemote.link().on) { toast('You are on the REMOTE link: the sound comes from the PC. Use 🔊 LISTEN (and the VOLUME slider) on the REMOTE tab, or disconnect from the PC first.', 6000); go('remote'); return false; }
    try {
      S.inDev = ($('stIn').value || ''); S.outDev = ($('stOut').value || ''); save();
      await A.start({ input: S.inDev, output: S.outDev, bufferMs: 250 }, c => { lastBlk = Date.now(); rxGain(c); level(c); fire('rx', c); });
      lastBlk = Date.now();
      A.pauseRx = true;                                   /* Oct 20: listening pauses while sending */
      await A.setGain(Math.pow(10, S.db / 20));
      RUN = true; state(); fire('run', true); soundWarn();
      return true;
    } catch (e) { toast('Could not start the sound: ' + esc(e.message || e) + '<br>Pick the radio\'s USB sound card under STATION → Sound.', 6000, 'bad'); return false; }
  }
  /* RX LEVEL (Brandon Oct 22): turns the radio's sound up or down inside the app, before the meter, the waterfall and the decoder */
  function rxGain(c) {
    const g = +S.rxDb || 0; if (!g || !c.pcm) return;
    const k = Math.pow(10, g / 20), p = c.pcm;
    for (let i = 0; i < p.length; i++) { const v = p[i] * k; p[i] = v > 1 ? 1 : v < -1 ? -1 : v; }
    c.db = Math.min(0, (+c.db || -100) + g);
  }
  /* Oct 26 (Fable): the sound restarts by itself when it is lost — the device's track ended, or sound was running but no block came
     for 6 s (a stalled card / worklet); at most once a minute, with a word. KPCApp.soundLost() for the tests. */
  let lostAt = 0, lastBlk = 0;
  async function soundLost(why) {
    if (!RUN) return false; if (Date.now() - lostAt < 60000) return false; lostAt = Date.now();
    toast('🔇 Sound lost (' + esc(why || 'no sound for 6 s') + '): starting it again…', 5000, 'bad');
    try { await stop(); } catch (e) {} await new Promise(r => setTimeout(r, 1500));
    try { await devices(); } catch (e) {}
    const ok = await start(); toast(ok ? '🎧 Sound is back.' : '🔇 The sound did not come back: press START in STATION → Sound.', 4000, ok ? 'log' : 'bad'); return ok;
  }
  A.onLost = why => { soundLost(why); };
  setInterval(() => { if (RUN && !TXING && lastBlk && Date.now() - lastBlk > 6000 && !N.native) soundLost('no sound blocks for 6 s'); }, 2000);
  async function stop() { RUN = false; lastBlk = 0; try { await A.stop(); } catch (e) {} $('stLvl').style.width = '0'; $('stLvlT').textContent = 'off'; state(); fire('run', false); }
  /* TX LEVEL + RX LEVEL sliders: the same two live in STATION → Sound and in the FT8 / FT4 settings (Brandon Oct 22).
     Any slider marked data-lv="tx" or "rx" works, wherever it is on screen. */
  const LV = { tx: { k: 'db', lo: -40, hi: 0 }, rx: { k: 'rxDb', lo: -20, hi: 20 }, vc: { k: 'vdb', lo: -20, hi: 30 }, mon: { k: 'monDb', lo: -30, hi: 20 } };   /* vc = VOICE LEVEL (Oct 27, apart from the FT8 TX LEVEL); mon = 🔊 HEAR THE RADIO HERE */
  const dbTxt = v => (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(1).replace('.0', '') + ' dB';
  function lvShow() {
    for (const w in LV) {
      const v = +S[LV[w].k] || 0;
      document.querySelectorAll('input[data-lv="' + w + '"]').forEach(e => { if (+e.value !== v) e.value = v; });
      document.querySelectorAll('[data-lvt="' + w + '"]').forEach(e => { e.textContent = dbTxt(v); });
    }
  }
  function lvSet(w, v) {
    const L = LV[w]; S[L.k] = Math.max(L.lo, Math.min(L.hi, Math.round(v * 2) / 2)); save(); lvShow();
    if (w === 'tx') return A.setGain(Math.pow(10, S.db / 20)).catch(() => {});
    if (w === 'mon') { if (A.monitorGain) A.monitorGain(S.monDb); return Promise.resolve(); }
    if (w === 'vc') return Promise.resolve();
    /* Oct 25 (Brandon's reports kept showing RX LEVEL at +20, the top): say once what the slider is for */
    if (S.rxDb >= 10 && Date.now() - (lvSet.said || 0) > 600000) { lvSet.said = Date.now(); toast('RX LEVEL only turns the sound up INSIDE the app (the bar shows the level after it). For a weak signal, turn the radio\'s USB OUT / AF level up instead and keep this near 0: at +20 a normal band clips and decodes stop.', 9000); }
    return Promise.resolve();
  }
  function lvHtml(w) {
    const L = LV[w], tx = w === 'tx', nm = { tx: 'TX LEVEL (FT8 / digital tones)', rx: 'RX LEVEL (what the decoders get)', vc: '🎙 VOICE LEVEL (keyer, hold to talk)', mon: '🔊 RADIO LOUDNESS HERE' }[w];
    return `<label class="e slide">${nm} <b data-lvt="${w}">${dbTxt(+S[L.k] || 0)}</b>
      <span class="pw"><button type="button" class="ic sm" data-lvs="${w}" data-d="-0.5" aria-label="${tx ? 'Transmit' : 'Receive'} level down">−</button><input type="range" data-lv="${w}" min="${L.lo}" max="${L.hi}" step="0.5" value="${+S[L.k] || 0}" aria-label="${tx ? 'Transmit' : 'Receive'} level in dB"><button type="button" class="ic sm" data-lvs="${w}" data-d="0.5" aria-label="${tx ? 'Transmit' : 'Receive'} level up">+</button></span></label>`;
  }
  document.addEventListener('input', e => { const w = e.target.dataset && e.target.dataset.lv; if (w) lvSet(w, +e.target.value); });
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-lvs]'); if (b) lvSet(b.dataset.lvs, (+S[LV[b.dataset.lvs].k] || 0) + (+b.dataset.d)); });
  const setDb = v => lvSet('tx', v);

  /* ---------------- keying the radio ----------------
     PTT on, then LET GO of the USB control port before any sound goes out: holding it stops the tablet
     sending sound to the radio's USB sound card (Brandon Oct 20). CAT or VOX only. */
  /* Oct 26 (Fable; Brandon: 'SSB no power out on the desktop', 'still not hearing my recorded CQ'): VOICE FROM THIS DEVICE (the voice keyer,
     HOLD TO TALK, a phone on the remote link) goes to the radio's USB sound card, but a radio sitting in SSB takes its sound from the MIC
     unless a menu says otherwise (Yaesu SSB MOD SOURCE, Icom DATA OFF MOD…) — while the DATA menus are already right (FT8 works).
     So `pttOn(true, {voice: true})` reads the mode, and when it is USB / LSB puts the radio in DATA-U / DATA-L for the length of the
     transmission, then puts the sideband back (S.vmod 'data' = do that, 'mic' = leave the mode alone: the radio's own menu is set to REAR). */
  let VMODE = '', VKHZ = 0, DIALR = null;
  on('dial', r => { if (r && r.khz) DIALR = { r, t: Date.now() }; });
  const dialNow = ms => DIALR && Date.now() - DIALR.t < (ms || 15000) ? DIALR.r : null;   /* the last dial CHANGE seen (follow fires on change), if under ms old */
  async function pttOn(on, o) {
    o = o || {};
    if (on && o.voice && S.vmod === 'data' && G.KPCCat && KPCCat.connected() && KPCCat.mode && S.ptt !== 'vox' && !VMODE) {
      try { const r = DIALR && Date.now() - DIALR.t < 1500 ? DIALR.r : await KPCCat.read();   /* a fresh dial read saves the 300 ms round trip before the voice starts */ if (r && /^(USB|LSB)$/.test(r.mode || '')) { if (await KPCCat.mode(r.mode === 'LSB' ? 'DATAL' : 'DATA', r.khz)) { VMODE = r.mode; VKHZ = r.khz; } } } catch (e) {}
    }
    TXING = !!on; state();
    if (S.ptt === 'vox' || !G.KPCCat) { if (!on) vmodeBack(); return true; }
    try {
      if (on) KPCCat.set({ follow: false });               /* no dial reads while transmitting */
      const ok = await KPCCat.ptt(on, S.ptt);
      if (on && N.serial && N.serial.letGo) { try { await N.serial.letGo(); } catch (e) {} }
      if (!on && S.follow) KPCCat.set({ follow: true });
      if (!on) vmodeBack();
      return ok;
    } catch (e) { if (!on && S.follow) KPCCat.set({ follow: true }); if (!on) vmodeBack(); return false; }
  }
  function vmodeBack() { if (!VMODE) return; const m = VMODE, k = VKHZ; VMODE = ''; VKHZ = 0; setTimeout(() => { if (G.KPCCat && KPCCat.connected()) KPCCat.mode(m, k).catch(() => {}); }, 150); }
  /* FT8 can only carry ordinary call signs (one or two letters/digits, a digit, then one to three letters) in full.
     Anything else — a practice call like K4TEST, or KZ4CP/P — goes out as a short code, and some stations' software will not answer it. */
  const stdCall = c => /^[A-Z0-9]{0,2}[0-9][A-Z]{1,3}$/.test(String(c || '').toUpperCase());
  function callWarn() {
    const c = myCall(), e = $('stCallWarn'); if (!e) return;
    const bad = !!c && !stdCall(c);
    e.hidden = !bad;
    if (bad) e.textContent = c + ' is not an ordinary call sign, so FT8 sends it as a short code instead of the letters. Contacts still work with most stations, but a few will not answer. Plain call signs like K4AB or KA4ABC go out in full.';
  }

  /* can anything key the radio at all? (CAT connected OR VOX) — Brandon Oct 21 */
  const canKey = () => !!myCall() && (S.ptt === 'vox' || !!(G.KPCCat && KPCCat.connected()));
  function keyCheck() { callWarn(); fire('key', canKey()); catVis(); }
  /* Oct 26 (Brandon: 'hide the cat control stuff until cat control is turned on'): before a radio is connected the Radio control card shows
     only MY RADIO, how it is keyed and CONNECT; the rest opens with ⚙ MORE RADIO SETTINGS or once the radio answers. body.cat-on = connected. */
  function catVis() { const on = !!(G.KPCCat && KPCCat.connected()); document.body.classList.toggle('cat-on', on); const pw = $('stProfW'); if (pw && G.KPCCat && KPCCat.profiles) pw.hidden = !on && !document.body.classList.contains('cat-more') && !Object.keys(KPCCat.profiles() || {}).length; }

  /* ---------------- radio over USB ---------------- */
  let catLast = { t: '', ok: null };
  function catT(t, ok) { catLast = { t: String(t || ''), ok }; const e = $('stCatT'); e.textContent = t; e.className = 'st' + (ok === true ? ' ok' : ok === false ? ' bad' : ''); }
  if (G.KPCCat) {
    KPCCat.fillSelect($('stRig'));
    KPCCat.set({ on: true, ptt: S.ptt === 'vox' ? 'vox' : 'cat', follow: !!S.follow });
    KPCCat.onStatus((t, ok) => { catT(t, ok); keyCheck(); });
    $('stRig').onchange = () => { KPCCat.pickRadio($('stRig').value); KPCCat.set({ on: true, ptt: S.ptt }); };
    KPCCat.follow(r => { if (!TXING) fire('dial', r); });
  }
  /* the radio frame (Oct 22): link + profiles */
  function linkUi() {
    if (!G.KPCCat) return;
    const c = KPCCat.get(), link = c.link || 'serial', L = KPCCat.links();
    $('stLink').innerHTML = L.map(l => `<option value="${l.id}"${l.id === link ? ' selected' : ''}${l.ok ? '' : ' disabled'}>${esc(l.label)}${l.ok ? '' : ' (not here)'}</option>`).join('');
    $('stPortW').hidden = link !== 'serial'; $('stHostW').hidden = !/^(rigctld|flrig)$/.test(link); $('stTcpW').hidden = !/^(rigctld|flrig)$/.test(link);
    $('stHost').value = c.host || 'localhost'; $('stTcpPort').value = c.port || (link === 'flrig' ? 12345 : 4532);
    const P = KPCCat.profiles(); $('stProf').innerHTML = (P.length ? '<option value="">(pick a profile)</option>' : '<option value="">(none saved yet)</option>') + P.map(p => `<option value="${esc(p.name)}"${p.now ? ' selected' : ''}>${esc(p.name)}</option>`).join('') + P.map(p => `<option value="-${esc(p.name)}">✕ remove ${esc(p.name)}</option>`).join('');
    $('stRig').value = c.radio || '';
  }
  $('stLink').onchange = () => { KPCCat.set({ link: $('stLink').value, port: $('stLink').value === 'flrig' ? 12345 : 4532 }); KPCCat.disconnect(true); linkUi(); keyCheck(); };
  $('stHost').onchange = () => KPCCat.set({ host: $('stHost').value.trim() || 'localhost' });
  $('stTcpPort').onchange = () => KPCCat.set({ port: +$('stTcpPort').value || 0 });
  $('stProf').onchange = async () => { const v = $('stProf').value; if (!v) return; if (v[0] === '-') { KPCCat.dropProfile(v.slice(1)); toast('Profile removed.', 2500); } else { await KPCCat.useProfile(v); const c = KPCCat.get(); if (c.ptt) S.ptt = c.ptt === 'vox' ? 'vox' : 'cat'; if (c.follow != null) S.follow = c.follow ? 1 : 0; save(); fields(); } linkUi(); keyCheck(); };
  $('stProfSave').onclick = () => {
    const c = KPCCat.get();
    sheet('Save this radio setup as a profile', `<label class="e">NAME<input id="prName" maxlength="30" value="${esc(c.profile || (KPCCat.RADIO[c.radio] ? KPCCat.RADIO[c.radio].label : ''))}" placeholder="Field rig"></label><p class="hint">Saves the radio type, speed, CI-V address, link, port and how it is keyed. Pick it back from RADIO PROFILE any time.</p>`,
      () => { if (KPCCat.saveProfile($('prName').value)) { toast('Profile saved.', 2500, 'log'); linkUi(); } });
  };
  async function fillPorts() {
    if (!G.KPCCat) return;
    try { const ps = await KPCCat.ports(); $('stPort').innerHTML = ps.length ? ps.map(p => `<option value="${p.i}"${p.now ? ' selected' : ''}>${esc(p.label)}</option>`).join('') : '<option value="">(no USB port seen)</option>'; } catch (e) {}
  }
  $('stConn').onclick = async () => {
    if (!$('stRig').value) { catT('Pick your radio in the MY RADIO list first.', false); return; }
    catT('Connecting…'); const ok = await KPCCat.connect(true); await fillPorts(); keyCheck();
    if (!ok) return;
    const r = KPCCat.lastDial() || await KPCCat.read();
    if (r) { fire('dial', r); catT('Radio says ' + (r.khz / 1000).toFixed(4) + ' MHz ' + (r.mode || '?') + (/DATA/.test(r.mode || '') ? ' · DATA mode ✓' : ' · not in DATA mode yet'), /DATA/.test(r.mode || '')); }
    keyCheck();
  };
  $('stRead').onclick = async () => { if (!KPCCat.connected()) { catT('Not connected. Press CONNECT RADIO.', false); return; } const r = await KPCCat.read(); if (r) { fire('dial', r); catT('Radio says ' + (r.khz / 1000).toFixed(4) + ' MHz ' + (r.mode || '?'), true); } };
  $('stDis').onclick = async () => { await KPCCat.disconnect(); await fillPorts(); keyCheck(); };
  /* Oct 26 (Brandon: 'add where we can rename the port a radio's name for different radio set-ups') */
  if ($('stPortName')) $('stPortName').onclick = () => {
    const k = KPCCat.get().portKey; if (!k || !KPCCat.connected()) { toast('Connect the radio first: the name goes on the port it answered on.', 4000, 'bad'); return; }
    const NK = LS('kpcPortNick', {});
    sheet('✏️ Name this port', `<label class="e wide">NAME<input id="pnN" maxlength="30" value="${esc(NK[k] || (KPCCat.get().radio ? (document.querySelector('#stRig option:checked') || {}).textContent || '' : ''))}" placeholder="FT-710 shack"></label><p class="hint">The name shows in the USB PORT list and goes with this cable / radio. Save the whole setup (radio type, speed, keying) under a name with 💾 SAVE AS A PROFILE.</p><div class="row"><button type="button" class="b gold" id="pnGo">SAVE THE NAME</button><button type="button" class="b" id="pnDel">✕ NO NAME</button></div>`);
    const done = v => { const A = LS('kpcPortNick', {}); if (v) A[k] = v; else delete A[k]; SV('kpcPortNick', A); shut(); fillPorts(); toast(v ? '★ Port named ' + esc(v) + '.' : 'Name taken off.', 2500); };
    $('pnGo').onclick = () => done($('pnN').value.trim().slice(0, 30)); $('pnDel').onclick = () => done('');
  };
  $('stPort').onchange = async () => { if ($('stPort').value === '') return; catT('Switching port…'); await KPCCat.usePort(+$('stPort').value); await fillPorts(); keyCheck(); };

  /* ---------------- my station ---------------- */
  function asOpts() {
    const home = String(S.call || '').toUpperCase(), ex = String(S.asList || '').split(/[\s,]+/).filter(Boolean);
    const list = [''].concat(ex.filter(c => c !== home));
    $('stAs').innerHTML = list.map(c => `<option value="${esc(c)}"${(S.as || '') === c ? ' selected' : ''}>${c ? esc(c) + ' (club / other call)' : (home ? esc(home) + ' (my call)' : 'my call')}</option>`).join('') +
      '<option value="+">＋ Add a club or other call…</option>' + (ex.length ? '<option value="-">✕ Take a call off this list…</option>' : '');
  }
  /* Oct 24 (Brandon: 'say I run club call I need station call sign and operators call sign'): SEND AS = the call on the air
     (STATION_CALLSIGN); the operator stays MY CALL SIGN (or who is picked in OPERATORS) = OPERATOR in the log */
  function asAdd() {
    sheet('Run a club or other call', `<p class="hint">Type the club call (or a special-event call) you have permission to use. It goes out on the air and in the log as the STATION call; <b>you</b> (MY CALL SIGN, or who is picked under OPERATORS) are the OPERATOR on every contact.</p>
      <label class="e">CALL<input id="asNew" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="the club call"></label>
      <div class="row"><button type="button" class="b gold" id="asGo">✓ ADD AND USE IT</button></div>
      <p class="hint">QRZ: each call has its own QRZ logbook and API key. To send club contacts to the club's QRZ logbook, put the club logbook's key in ☁ UPLOADS while you run the club call.</p>`);
    setTimeout(() => $('asNew').focus(), 50);
    $('asGo').onclick = () => {
      const c = $('asNew').value.trim().toUpperCase().replace(/[^A-Z0-9/]/g, '');
      if (c.length < 3) { toast('Type the call first.', 2500, 'bad'); return; }
      const ex = String(S.asList || '').split(/[\s,]+/).filter(Boolean); if (!ex.includes(c)) ex.push(c);
      S.asList = ex.join(' '); S.as = c === String(S.call || '').toUpperCase() ? '' : c; save(); asOpts(); fire('me'); shut();
      toast('📻 Sending as ' + esc(c) + ' · operator ' + esc(String(S.op || S.call || '?').toUpperCase()) + '. Both go in the log.', 5000, 'log');
    };
  }
  function asDrop() {
    const ex = String(S.asList || '').split(/[\s,]+/).filter(Boolean);
    sheet('Take a call off the list', ex.map(c => `<button type="button" class="b" data-asdel="${esc(c)}" style="margin:4px">✕ ${esc(c)}</button>`).join(''));
    document.querySelectorAll('[data-asdel]').forEach(b => { b.onclick = () => { const c = b.dataset.asdel; S.asList = ex.filter(x => x !== c).join(' '); if (S.as === c) S.as = ''; save(); asOpts(); fire('me'); shut(); }; });
  }
  function fields() {
    $('stCall').value = S.call || ''; $('stGrid').value = S.grid || ''; $('stRef').value = S.ref || '';
    $('stRole').value = S.role || 'act'; $('stGoalN').value = String(S.goal || 0);
    $('stPtt').value = S.ptt === 'vox' ? 'vox' : 'cat'; $('stFollow').value = S.follow ? '1' : '0';
    asOpts(); lvShow(); $('stCls').value = S.cls || ''; $('stUnits').value = S.units || 'mi'; $('stPwr').value = S.pwr || ''; $('stMyRig').value = S.rig || ''; $('stAnt').value = S.ant || '';
    if ($('stCnty')) $('stCnty').value = S.cnty || ''; cntyShow();
  }
  const bind = (id, k, up) => { const e = $(id); e.onchange = () => { let v = e.value.trim(); if (up) v = v.toUpperCase(); S[k] = v; e.value = v; save(); fire('me'); keyCheck(); }; };
  bind('stCall', 'call', true); bind('stGrid', 'grid', true); bind('stRef', 'ref', true);
  $('stRole').onchange = () => { S.role = $('stRole').value; save(); fire('me'); };
  $('stGoalN').onchange = () => { S.goal = +$('stGoalN').value || 0; save(); fire('me'); };
  $('stAs').onchange = () => { const v = $('stAs').value; if (v === '+' || v === '-') { asOpts(); (v === '+' ? asAdd : asDrop)(); return; } S.as = v; save(); fire('me'); };
  if ($('stCnty')) $('stCnty').onchange = () => { S.cnty = $('stCnty').value.trim(); $('stCnty').value = S.cnty; save(); cntyShow(); fire('me'); };
  $('stCls').onchange = () => { S.cls = $('stCls').value; save(); fire('me'); };
  $('stUnits').onchange = () => { S.units = $('stUnits').value; save(); fire('units'); };
  /* Oct 24 (Brandon: 'give users plenty of options'): power / rig / antenna go on each contact and into the ADIF */
  /* Oct 25: the MY RIG box was id stRig, the same id as the MY RADIO drop-down below it (Brandon: 'my radio field is blank, can not select what radio'): now stMyRig */
  [['stPwr', 'pwr'], ['stMyRig', 'rig'], ['stAnt', 'ant']].forEach(([id, k]) => { $(id).onchange = () => { S[k] = $(id).value.trim(); save(); }; });
  if ($('stVmod')) { $('stVmod').value = S.vmod === 'data' ? 'data' : 'mic'; $('stVmod').onchange = () => { S.vmod = $('stVmod').value; save(); }; }
  $('stPtt').onchange = () => { S.ptt = $('stPtt').value; save(); if (G.KPCCat) KPCCat.set({ ptt: S.ptt }); keyCheck(); };
  $('stFollow').onchange = () => { S.follow = $('stFollow').value === '1' ? 1 : 0; save(); if (G.KPCCat) KPCCat.set({ follow: !!S.follow }); };
  /* OPERATORS (Oct 22, Fable): several people on one install. Each has a call, grid, name and CQ word; the log keeps every
     contact with the operator's call, and the LOG screen shows the operator who is signed in. Nothing is copied when you switch. */
  function opsShow() {
    const cur = String(S.op || S.call || '').toUpperCase(), e = $('stOpNow'); if (!e) return;
    e.textContent = S.ops && S.ops.length ? (cur || '?') + ' (' + (S.ops.length + 1) + ' operators)' : cur || 'just me';
  }
  const stOps = $('stOps');
  if (stOps) stOps.onclick = () => {
    const home = String(S.call || '').toUpperCase(), ops = Array.isArray(S.ops) ? S.ops : [], cur = String(S.op || home).toUpperCase();
    const list = [{ call: home, grid: S.grid, name: '', home: true }].concat(ops.filter(o => o.call !== home));
    sheet('Operators on this ' + (N.native ? 'device' : 'PC'), `
      <div class="oplist">${list.map(o => `<label class="ck op"><input type="radio" name="opPick" value="${esc(o.call)}"${o.call === cur ? ' checked' : ''}> <b>${esc(o.call || '?')}</b> ${esc(o.name || '')} <i>${esc(o.grid || '')}</i>${o.home ? ' <small>the station</small>' : ` <button type="button" class="ic sm" data-opdel="${esc(o.call)}" aria-label="Remove ${esc(o.call)}">✕</button>`}</label>`).join('')}</div>
      <div class="grid2">
        <label class="e">ADD A CALL<input id="opCall" autocapitalize="characters" spellcheck="false" placeholder="K4TEST"></label>
        <label class="e">THEIR GRID<input id="opGrid" autocapitalize="characters" maxlength="6"></label>
        <label class="e">NAME<input id="opName"></label>
      </div>
      <p class="hint">Pick who is at the key. The log shows that operator's contacts and the ADIF file is theirs; the station call stays yours. Add a club member here before you hand them the mic.</p>`,
      () => {
        const nc = String(($('opCall') || {}).value || '').trim().toUpperCase();
        if (nc && nc.length >= 3 && nc !== home) { S.ops = ops.filter(o => o.call !== nc).concat([{ call: nc, grid: String($('opGrid').value || '').toUpperCase(), name: String($('opName').value || '').trim() }]); }
        const pick = document.querySelector('input[name="opPick"]:checked');
        if (pick) S.op = pick.value === home ? '' : pick.value;
        if (nc && nc.length >= 3 && nc !== home && !pick) S.op = nc;
        save(); opsShow(); fire('me'); keyCheck();
      });
    document.querySelectorAll('[data-opdel]').forEach(b => { b.onclick = () => { S.ops = ops.filter(o => o.call !== b.dataset.opdel); if (S.op === b.dataset.opdel) S.op = ''; save(); shut(); stOps.onclick(); }; });
  };
  /* ONE place that asks where we are (Brandon Oct 22: the PC said 'Android did not allow'). Android: the GPS. Windows: most PCs have no
     GPS and Windows gives the browser nothing without a Google key, so the PC gets a plain answer and the grid-square box instead. */
  const PC = !N.native;
  function gps(o) {
    o = o || {};
    return new Promise((res, rej) => {
      if (!navigator.geolocation) { rej(new Error(PC ? 'This computer has no GPS the app can read. Type your grid square (like EM77ab) in MY STATION, or use the phone for AM I IN THE PARK.' : 'This device has no GPS the app can read.')); return; }
      navigator.geolocation.getCurrentPosition(p => res({ la: p.coords.latitude, lo: p.coords.longitude, acc: p.coords.accuracy }), e => {
        const c = e && e.code;
        const why = PC ? (c === 1 ? 'Windows did not let the app read the location. Windows Settings → Privacy & security → Location → on, then try again — or type your grid square in MY STATION.'
          : 'This computer cannot find its position (most PCs have no GPS). Type your grid square (like EM77ab) in MY STATION; the phone does the GPS work in the field.')
          : c === 1 ? 'Android did not allow location for KPC. Android Settings → Apps → KPC → Permissions → Location → Allow, then try again.'
          : c === 3 ? 'No GPS fix yet. Step outside or near a window and press the button again (it can take half a minute).'
          : 'No position yet: turn Location on in Android\'s quick settings, then try again.';
        rej(new Error(why));
      }, { enableHighAccuracy: !PC, timeout: o.ms || (PC ? 12000 : 30000), maximumAge: o.maxAge || 600000 });
    });
  }
  /* a PC has no GPS: say so on the button itself and offer the two honest ways (Brandon Oct 22, R1) */
  if (PC) { $('stGps').textContent = '📍 FIND MY GRID SQUARE (no GPS on a PC)'; }
  async function gridFromPlace(q) {
    const r = await net.raw('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'user-agent': 'KPC app ' + VER + ' (kentuckyportableclub.github.io)' }, ms: 12000 });
    if (!r.ok) throw new Error(r.err || 'the place lookup did not answer');
    const j = JSON.parse(r.text || '[]'); if (!j.length) throw new Error('no such place found');
    return { la: +j[0].lat, lo: +j[0].lon, name: j[0].display_name };
  }
  $('stGps').onclick = async () => {
    if (PC) {
      sheet('Your grid square on this PC', `<p class="hint">A computer has no GPS, so the app cannot find where you are by itself. Two ways:</p>
        <label class="e">1. TYPE YOUR GRID SQUARE<input id="gqGrid" autocapitalize="characters" maxlength="6" value="${esc(S.grid || '')}" placeholder="EM77ab"></label>
        <label class="e">2. OR YOUR TOWN / ZIP, AND THE APP LOOKS IT UP (needs internet)<input id="gqPlace" placeholder="Elizabethtown KY"></label>
        <div class="row"><button type="button" class="b gold" id="gqGo">✓ USE IT</button></div><p class="hint">In the field the phone does the GPS work; here your grid only goes in your FT8 messages and the log.</p>`);
      $('gqGo').onclick = async () => {
        const g = $('gqGrid').value.trim().toUpperCase(), pl = $('gqPlace').value.trim();
        if (/^[A-R]{2}\d{2}([A-X]{2})?$/i.test(g)) { S.grid = g; save(); $('stGrid').value = g; fire('me'); shut(); toast('📍 Your grid is ' + g + '.', 3000, 'log'); return; }
        if (!pl) { toast('Type a grid square or a town.', 3000, 'bad'); return; }
        toast('Looking up ' + esc(pl) + '…', 6000);
        try { const p = await gridFromPlace(pl); const gg = toGrid(p.la, p.lo); S.grid = gg; S.pos = { la: p.la, lo: p.lo, g: gg }; save(); $('stGrid').value = gg; fire('me'); shut(); toast('📍 ' + esc(p.name.split(',').slice(0, 2).join(',')) + ' → grid ' + gg + '.', 6000, 'log'); }
        catch (e) { toast('Could not look that up: ' + esc(e.message), 5000, 'bad'); }
      };
      return;
    }
    toast('Looking for your position…', 4000);
    try { const p = await gps(); const g = toGrid(p.la, p.lo); S.grid = g; S.pos = { la: p.la, lo: p.lo, g }; save(); $('stGrid').value = g; fire('me'); toast('📍 Your grid is ' + g + ' now. It goes in your FT8 messages and your log.', 5000, 'log'); }
    catch (e) { toast('📍 ' + esc(e.message), 9000, 'bad'); }
  };
  /* ---------------- county (Brandon Oct 24: 'automatic county into the log from gps or grid') ----------------
     US counties from the FCC's free census-area lookup (geo.fcc.gov, no key). Answers are kept on the device (kpcCnty),
     so a park you have been to works with no signal. Outside the US the FCC has no answer and the county stays blank. */
  function gridLL(g) {
    g = String(g || '').toUpperCase(); if (!/^[A-R]{2}\d{2}/.test(g)) return null;
    let lo = (g.charCodeAt(0) - 65) * 20 - 180 + (+g[2]) * 2, la = (g.charCodeAt(1) - 65) * 10 - 90 + (+g[3]);
    if (/^[A-X]{2}$/.test(g.slice(4, 6))) { lo += (g.charCodeAt(4) - 65) / 12 + 1 / 24; la += (g.charCodeAt(5) - 65) / 24 + 1 / 48; } else { lo += 1; la += 0.5; }
    return { la, lo, rough: g.length < 6 };
  }
  const CN = (() => { try { return JSON.parse(localStorage.getItem('kpcCnty') || '{}'); } catch (e) { return {}; } })();
  async function county(la, lo) {
    if (!isFinite(la) || !isFinite(lo)) return null;
    const k = la.toFixed(2) + ',' + lo.toFixed(2); if (CN[k] !== undefined) return CN[k];
    if (la < 17 || la > 72 || lo > -60 || lo < -180) { return null; }   /* not the US: no lookup */
    try {
      const r = await net.raw('https://geo.fcc.gov/api/census/area?format=json&lat=' + la.toFixed(5) + '&lon=' + lo.toFixed(5), { ms: 10000 });
      if (!r.ok) return null;
      const x = (JSON.parse(r.text || '{}').results || [])[0];
      const v = x && x.county_name ? { c: String(x.county_name).replace(/\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$/i, ''), st: x.state_code || '', full: x.county_name } : '';
      CN[k] = v; const ks = Object.keys(CN); if (ks.length > 400) delete CN[ks[0]];
      try { localStorage.setItem('kpcCnty', JSON.stringify(CN)); } catch (e) {}
      return v || null;
    } catch (e) { return null; }
  }
  /* MY county: typed in MY STATION wins; else from the last GPS fix in this grid; else the grid square's centre */
  async function myCountyLook() {
    const g = myGrid(); if (!g) { S.mcn = null; save(); cntyShow(); return null; }
    if (S.mcn && S.mcn.g === g && S.mcn.c) { cntyShow(); return S.mcn; }
    const p = S.pos && S.pos.g === g ? S.pos : gridLL(g); if (!p) return null;
    const v = await county(p.la, p.lo);
    if (v && myGrid() === g) { S.mcn = { g, c: v.c, st: v.st, full: v.full, rough: !(S.pos && S.pos.g === g) && g.length < 6 }; save(); cntyShow(); fire('county', S.mcn); }
    return S.mcn;
  }
  /* 'KY,Hopkins' = how ADIF writes a county (MY_CNTY / CNTY) */
  const myCounty = () => { const t = String(S.cnty || '').trim(); if (t) { const m = t.match(/^([A-Z]{2})\s*,\s*(.+)$/i); return m ? m[1].toUpperCase() + ',' + m[2] : ((S.mcn && S.mcn.st) || '') + ',' + t; } return S.mcn && S.mcn.g === myGrid() && S.mcn.c ? S.mcn.st + ',' + S.mcn.c : ''; };
  function cntyShow() { const e = $('stCntyN'); if (!e) return; const c = myCounty(); e.textContent = S.cnty ? 'typed by you' : c ? 'found from ' + (S.pos && S.pos.g === myGrid() ? 'your GPS' : 'your grid square' + (myGrid().length < 6 ? ' (4 letters = rough: use FIND MY GRID at the park)' : '')) : myGrid() ? 'looking it up when there is signal (US only)' : 'set your grid square first'; const i = $('stCnty'); if (i && document.activeElement !== i) i.placeholder = c ? c.split(',').slice(1).join(',') + ' County, ' + c.split(',')[0] : 'found by itself'; }
  on('me', () => { myCountyLook(); });
  on('online', () => { myCountyLook(); });
  setTimeout(myCountyLook, 1500);
  function toGrid(la, lo) {
    lo += 180; la += 90;
    const A = 'ABCDEFGHIJKLMNOPQR', a = 'abcdefghijklmnopqrstuvwx';
    return A[Math.floor(lo / 20)] + A[Math.floor(la / 10)] + Math.floor(lo % 20 / 2) + Math.floor(la % 10) +
      a[Math.floor((lo % 2) * 12)].toUpperCase() + a[Math.floor((la % 1) * 24)].toUpperCase();
  }

  /* ---------------- sound buttons ---------------- */
  $('stStart').onclick = () => start();
  $('stStop').onclick = () => stop();
  $('stDev').onclick = () => devices().then(() => toast('Looked for sound cards again.', 2000));
  $('stIn').onchange = () => { S.inDev = $('stIn').value; const t = twin(S.inDev); if (t && $('stOut').value !== String(t.id)) { $('stOut').value = t.id; S.outDev = t.id; toast('RADIO SOUND OUT set to the same sound card: ' + esc(t.name), 4000); } save(); if (RUN) toast('Press STOP then START LISTENING to use the new sound card.', 4000); };
  $('stOut').onchange = () => { S.outDev = $('stOut').value; save(); if (RUN) toast('Press STOP then START LISTENING to use the new sound card.', 4000); };
  $('stLevels').innerHTML = lvHtml('tx') + lvHtml('vc') + lvHtml('rx') + `<div class="row monrow"><button type="button" class="b" id="stMon">🔊 HEAR THE RADIO HERE</button><select id="stMonDev" aria-label="Which speaker"><option value="">This computer's speakers</option></select></div>` + lvHtml('mon') + '<p class="hint">🔊 HEAR THE RADIO HERE plays the radio on this computer\'s speakers (never on the radio\'s own sound card): work the radio from the desk with the PC mic and speakers.</p>';
  /* 🔊 HEAR THE RADIO HERE (Oct 27, Fable; Brandon: 'play audio out PC and talk into PC, work semi-remote from the desktop') */
  async function monDevs() { const sel = $('stMonDev'); if (!sel || !navigator.mediaDevices) return; try { const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'communications' && d.deviceId !== S.outDev);
    sel.innerHTML = '<option value="">This computer\'s speakers</option>' + ds.map(d => `<option value="${esc(d.deviceId)}"${S.monDev === d.deviceId ? ' selected' : ''}>${esc(d.deviceId === 'default' ? 'Windows default (' + (d.label || '').replace(/^Default - /, '') + ')' : d.label || 'Speaker')}</option>`).join(''); } catch (e) {} }
  function monShow() { const b = $('stMon'); if (b) { b.classList.toggle('on', !!S.mon); b.textContent = S.mon ? '🔊 HEARING THE RADIO HERE · TAP TO STOP' : '🔊 HEAR THE RADIO HERE'; } document.querySelectorAll('[data-mon]').forEach(x => { x.classList.toggle('on', !!S.mon); x.textContent = S.mon ? '🔊 ON' : '🔊 HEAR HERE'; }); }
  async function monSet(on) { S.mon = !!on; save(); monShow(); if (!A.monitor) return; if (S.mon && !RUN) { const ok = await start(); if (!ok) { S.mon = false; save(); monShow(); return; } } const r = await A.monitor(S.mon, S.monDev || '', S.monDb); if (S.mon && r && r.err) toast('Could not play the radio here: ' + esc(r.err), 5000, 'bad'); else if (S.mon) toast('🔊 The radio plays on ' + esc((r && r.where) || 'this computer\'s speakers') + '.', 3000); }
  if ($('stMon')) { $('stMon').onclick = () => monSet(!S.mon); $('stMonDev').onchange = () => { S.monDev = $('stMonDev').value; save(); if (S.mon) A.monitor && A.monitor(true, S.monDev, S.monDb); }; monDevs(); monShow(); }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-mon]'); if (b) monSet(!S.mon); });
  on('run', o => { if (o && S.mon && A.monitor) setTimeout(() => A.monitor(true, S.monDev || '', S.monDb), 300); });

  /* ---------------- find a setting ---------------- */
  $('stQ').oninput = () => {
    const words = $('stQ').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    document.querySelectorAll('#scrStation .card').forEach(c => {
      const hay = ((c.dataset.grp || '') + ' ' + c.textContent).toLowerCase();
      c.classList.toggle('hide', words.length > 0 && !words.every(w => hay.indexOf(w) >= 0));
    });
  };

  /* ---------------- clock check + CALIBRATE (Brandon Oct 22: the app can't set the phone's clock, so it keeps an offset) ----------------
     AP.now() = the device clock + S.clkOff ms. The FT8 screen uses it for slots; sound 'at' times are handed to the device in device time. */
  const now = () => Date.now() + (+S.clkOff || 0);
  let clkSaid = 0, lastDt = null, lastFrom = '';
  function clock(dt, from) {
    lastDt = dt; lastFrom = from;
    const off = Math.abs(dt);
    const e = $('stClk');
    const cal = S.clkOff ? ' Calibrated by ' + (S.clkOff > 0 ? '+' : '') + (S.clkOff / 1000).toFixed(2) + ' s.' : '';
    const bc = $('stClkCal'); if (bc) { bc.hidden = off < 0.3 && !S.clkOff; bc.textContent = S.clkOff ? '⏱ CLEAR THE CALIBRATION' : '⏱ CALIBRATE (+' + dt.toFixed(1) + ' s)'; }
    if (off < 1) { e.textContent = 'Clock: good (about ' + dt.toFixed(1) + ' s off, ' + from + ').' + cal; e.className = 'st ok'; return; }
    e.textContent = 'Clock: about ' + off.toFixed(1) + ' s ' + (dt > 0 ? 'slow' : 'fast') + ' (' + from + '). FT8 needs it right within a second: turn on "set time automatically", or press CALIBRATE and the app corrects for it.' + cal;
    e.className = 'st bad';
    if (Date.now() - clkSaid > 600000) { clkSaid = Date.now(); const m = 'This device\'s clock is about ' + off.toFixed(1) + ' s ' + (dt > 0 ? 'slow' : 'fast') + '. Turn on "set time automatically" or FT8 contacts will fail.'; if (G.KPCApp && KPCApp.notify) KPCApp.notify('clock', m, { bad: true, ms: 8000 }); else toast('⏱ ' + m, 8000, 'bad'); }
  }
  /* true time from the internet: two services, whichever answers; dt = real - corrected device time */
  async function onlineClock() {
    const srcs = [['https://worldtimeapi.org/api/timezone/Etc/UTC', j => j.utc_datetime || j.datetime], ['https://timeapi.io/api/time/current/zone?timeZone=UTC', j => j.dateTime + 'Z']];
    for (const [u, pick] of srcs) {
      try {
        const t0 = Date.now(), r = await net.fetch(u, {}, 6000), j = await r.json(), half = (Date.now() - t0) / 2;
        const real = new Date(pick(j)).getTime();
        if (isFinite(real)) { clock((real - (now() - half)) / 1000, 'checked online'); return true; }   /* the answer is from mid-request: our time then was now() - half */
      } catch (e) {}
    }
    if (lastDt == null) $('stClk').textContent = 'Clock: no internet to check against. It is also checked against the stations you hear on FT8.';
    return false;
  }
  onlineClock();
  const bcal = $('stClkCal');
  if (bcal) bcal.onclick = async () => {
    if (S.clkOff) { S.clkOff = 0; save(); toast('Calibration cleared: the app trusts the device clock again.', 3000); if (!(await onlineClock()) && lastDt != null) clock(lastDt, lastFrom); return; }
    toast('Checking the time on the internet…', 4000);
    const was = lastDt;
    if (!(await onlineClock())) { toast('No internet right now. The offset from the FT8 stations you hear can be used instead: ' + (was != null ? was.toFixed(1) + ' s' : 'none yet') + '.', 6000, 'bad'); if (was == null) return; }
    if (lastDt == null) return;
    S.clkOff = Math.round((+S.clkOff || 0) + lastDt * 1000); save();
    toast('⏱ Calibrated: the app now runs ' + (S.clkOff > 0 ? '+' : '') + (S.clkOff / 1000).toFixed(2) + ' s from the device clock. FT8 slots use the corrected time.', 6000, 'log');
    clock(0, 'calibrated'); fire('clock', S.clkOff);
  };

  /* ---------------- helpers every feature shares (Fable, Oct 22: cheaper rounds later) ----------------
     bandPlan: the US plan by licence class (spots 'outside my class', the guest pass, APRS/beacon checks all read it).
     net: online? + a fetch with a timeout + a POST queue that waits for signal (iGate, QRZ, POTA uploads).
     report: one text block for Brandon to copy when something is wrong (version, device, settings, radio, the last console lines). */
  /* [lo kHz, hi kHz, classes, modes]  T = Technician, G = General, A = Advanced, E = Extra; modes: cw (CW + data), cwo (CW only: Technician HF), ph (phone/image), all */
  const PLAN = [
    [1800, 2000, 'GAE', 'all'],
    [3500, 3525, 'E', 'cw'], [3525, 3600, 'GAE', 'cw'], [3525, 3600, 'T', 'cwo'], [3600, 3700, 'AE', 'ph'], [3700, 3800, 'AE', 'ph'], [3800, 4000, 'GAE', 'ph'],
    [5330.5, 5406.4, 'GAE', 'all'],
    [7000, 7025, 'E', 'cw'], [7025, 7125, 'GAE', 'cw'], [7025, 7125, 'T', 'cwo'], [7125, 7175, 'AE', 'ph'], [7175, 7300, 'GAE', 'ph'],
    [10100, 10150, 'GAE', 'cw'],
    [14000, 14025, 'E', 'cw'], [14025, 14150, 'GAE', 'cw'], [14150, 14175, 'E', 'ph'], [14175, 14225, 'AE', 'ph'], [14225, 14350, 'GAE', 'ph'],
    [18068, 18110, 'GAE', 'cw'], [18110, 18168, 'GAE', 'ph'],
    [21000, 21025, 'E', 'cw'], [21025, 21200, 'GAE', 'cw'], [21025, 21200, 'T', 'cwo'], [21200, 21225, 'E', 'ph'], [21225, 21275, 'AE', 'ph'], [21275, 21450, 'GAE', 'ph'],
    [24890, 24930, 'GAE', 'cw'], [24930, 24990, 'GAE', 'ph'],
    [28000, 28300, 'TGAE', 'cw'], [28300, 28500, 'TGAE', 'ph'], [28500, 29700, 'GAE', 'ph'],
    [50000, 54000, 'TGAE', 'all'], [144000, 148000, 'TGAE', 'all'], [222000, 225000, 'TGAE', 'all'], [420000, 450000, 'TGAE', 'all'], [902000, 928000, 'TGAE', 'all'], [1240000, 1300000, 'TGAE', 'all']
  ];
  const isCwData = m => /CW|FT|RTTY|PSK|HELL|WSPR|JS8|APRS|PKT|DATA|MFSK|OLIVIA|SSTV/i.test(m || '') && !/SSB|USB|LSB|FM|AM|SSTV/i.test(m || '');
  const bandPlan = {
    classes: { T: 'Technician', G: 'General', A: 'Advanced', E: 'Extra' },
    /* may this class transmit here? mode: 'FT8', 'SSB', 'CW'… ('' = any). The 'cw' segments take CW + data; 'ph' phone + image; 'all' everything. */
    allowed(khz, cls, mode) {
      cls = (cls || 'E').toUpperCase()[0]; if (!'TGAE'.includes(cls)) cls = 'E';
      return PLAN.some(s => khz >= s[0] && khz <= s[1] && s[2].includes(cls) && (!mode || s[3] === 'all' || (s[3] === 'cwo' ? /CW/i.test(mode) : s[3] === 'cw' ? isCwData(mode) || /CW/i.test(mode) : !isCwData(mode))));
    },
    segments: cls => PLAN.filter(s => s[2].includes((cls || 'E').toUpperCase()[0])).map(s => s.slice())
  };
  /* the network: a fetch with a timeout, and a POST queue that keeps trying while there is no signal */
  let NQ = LS('kpcNetQ', []);
  const net = {
    online: () => navigator.onLine !== false,
    async fetch(url, opts, ms) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = setTimeout(() => { if (ctl) ctl.abort(); }, ms || 10000);
      try { return await fetch(url, Object.assign({ cache: 'no-store' }, opts || {}, ctl ? { signal: ctl.signal } : {})); } finally { clearTimeout(t); }
    },
    /* post now if we can, else keep it (up to 500 jobs, 7 days) and send it when the signal comes back */
    post(url, body, headers, tag) {
      const job = { url, body: typeof body === 'string' ? body : JSON.stringify(body), headers: headers || { 'content-type': 'application/json' }, tag: tag || '', t: Date.now(), tries: 0 };
      NQ.push(job); if (NQ.length > 500) NQ = NQ.slice(-500); SV('kpcNetQ', NQ);
      return net.flush();
    },
    pending: tag => NQ.filter(j => !tag || j.tag === tag).length,
    /* HTTP with no CORS wall: the Windows app goes through Electron's own net, Android through Capacitor's native HTTP,
       a plain browser falls back to fetch (and may be refused by the far end). Returns {ok, status, text, err}. */
    async raw(url, o) {
      o = o || {};
      const body = o.body == null ? undefined : (typeof o.body === 'string' ? o.body : o.body instanceof URLSearchParams ? o.body.toString() : JSON.stringify(o.body));
      const headers = Object.assign({}, o.headers || {});
      if (body != null && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['content-type'] = o.body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : typeof o.body === 'string' ? 'text/plain' : 'application/json';
      if (G.kpcNet && G.kpcNet.fetch) return G.kpcNet.fetch({ url, method: o.method || (body != null ? 'POST' : 'GET'), headers, body, ms: o.ms || 15000 });
      /* Oct 24 (Brandon's tablet: 'Capacitor plugin CapacitorHttp already registered' every ~70 s): register the plugin ONCE, not on every spots poll */
      if (CHP === undefined) CHP = N.native && G.Capacitor && G.Capacitor.registerPlugin ? G.Capacitor.registerPlugin('CapacitorHttp') : null;
      const CH = CHP;
      if (CH && CH.request) {
        try { const r = await CH.request({ url, method: o.method || (body != null ? 'POST' : 'GET'), headers, data: body, connectTimeout: o.ms || 15000, readTimeout: o.ms || 15000, responseType: 'text' }); return { ok: r.status >= 200 && r.status < 300, status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data || ''), headers: r.headers || {} }; }
        catch (e) { return { ok: false, status: 0, text: '', err: String(e.message || e) }; }
      }
      try { const r = await net.fetch(url, { method: o.method || (body != null ? 'POST' : 'GET'), headers, body }, o.ms); const text = await r.text(); return { ok: r.ok, status: r.status, text, headers: {} }; }
      catch (e) { return { ok: false, status: 0, text: '', err: String(e.message || e) }; }
    },
    canRaw: () => !!((G.kpcNet && G.kpcNet.fetch) || (N.native && G.Capacitor && G.Capacitor.registerPlugin)),
    tcp: !!(G.kpcNet && G.kpcNet.tcpOpen),
    async flush() {
      if (!net.online() || net.busy) return 0;
      net.busy = true; let sent = 0;
      try {
        const cut = Date.now() - 7 * 86400000;
        for (const j of NQ.slice()) {
          if (j.t < cut) { NQ.splice(NQ.indexOf(j), 1); continue; }
          try { const r = await net.fetch(j.url, { method: 'POST', body: j.body, headers: j.headers }, 12000); if (r.ok || (r.status >= 400 && r.status < 500)) { NQ.splice(NQ.indexOf(j), 1); sent++; } else { j.tries++; break; } }
          catch (e) { j.tries++; break; }
        }
      } finally { SV('kpcNetQ', NQ); net.busy = false; }
      if (sent) fire('net', { sent, left: NQ.length });
      return sent;
    },
    busy: false
  };
  addEventListener('online', () => { net.flush(); fire('online', true); });
  addEventListener('offline', () => fire('online', false));
  setInterval(() => { if (NQ.length) net.flush(); }, 60000);
  /* the builders' report: the last console lines are kept here */
  const CLOG = [];
  ['log', 'warn', 'error'].forEach(k => { const o = console[k].bind(console); console[k] = (...a) => { try { CLOG.push(new Date().toISOString().slice(11, 19) + ' ' + k + ' ' + a.map(x => typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x)).join(' ').slice(0, 300)); if (CLOG.length > 200) CLOG.shift(); } catch (e) {} o(...a); }; });
  addEventListener('error', e => { CLOG.push(new Date().toISOString().slice(11, 19) + ' ERROR ' + (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '')); if (CLOG.length > 200) CLOG.shift(); });
  async function report() {
    const s = Object.assign({}, S); delete s.rmTok; delete s.asList;
    let au = {}; try { au = await A.status(); } catch (e) {}
    return ['KPC app report ' + new Date().toISOString(), 'version ' + VER + (LITE ? ' Lite' : '') + ' · ' + (N.native ? 'Android' : N.platform) + ' · ' + navigator.userAgent, 'screen ' + innerWidth + 'x' + innerHeight + ' · online ' + net.online() + ' · queued posts ' + NQ.length,
      'sound: running ' + RUN + ' txing ' + TXING + ' ' + JSON.stringify(au), 'radio: ' + JSON.stringify(catLast) + (G.KPCCat ? ' ' + JSON.stringify(KPCCat.get ? KPCCat.get() : {}) : ''), 'tunes (asked → radio said, then 3 s later): ' + (G.KPCCat && KPCCat.tuneLog ? JSON.stringify(KPCCat.tuneLog()) : '-') + (G.KPCCat && KPCCat.keyPortInfo ? ' · CW key port: ' + JSON.stringify(KPCCat.keyPortInfo()) : '') + (G.KPCCat && KPCCat.modeLog ? ' · dial put back after a mode change: ' + JSON.stringify(KPCCat.modeLog()) : '') + ' · voice: ' + JSON.stringify({ vmod: S.vmod || 'mic', vdb: +S.vdb || 0, mon: !!S.mon }) + (G.KPCModes5 ? ' · cw: ' + JSON.stringify({ via: KPCModes5.S.cw.via, park: KPCModes5.S.cw.park || 'cw', wpm: KPCModes5.S.cw.wpm }) : ''),
      'mode: ' + (G.KPCModes ? JSON.stringify(KPCModes.state()) : '-'), 'decoder: ' + (G.KPCDigi && KPCDigi.diag ? JSON.stringify(KPCDigi.diag()) : '-'), 'remote: ' + (G.KPCRemote ? JSON.stringify(KPCRemote.link()) : '-'), 'sound link (this end as a phone): ' + (G.KPCRemote && KPCRemote.rtcPhone ? JSON.stringify(KPCRemote.rtcPhone()) : '-'), 'sound links (this end as the PC): ' + (G.KPCRemote && KPCRemote.rtcReport ? JSON.stringify(await KPCRemote.rtcReport().catch(e => String(e))) : '-'),
      'settings: ' + JSON.stringify(s), 'log: ' + (G.KPCLog ? KPCLog.count() + ' shown / ' + KPCLog.all().size + ' kept' : '-'), '--- last console lines ---'].concat(CLOG).join('\n');
  }
  const stRep = $('stReport');
  if (stRep) stRep.onclick = async () => { const t = await report(); try { await navigator.clipboard.writeText(t); toast('The report is copied. Paste it to whoever is fixing the app (nothing secret is in it).', 5000, 'log'); } catch (e) { const ta = $('stAdifT'); ta.hidden = false; ta.value = t; toast('Copy did not work here: the report is in the box under Log files, hold to select it.', 6000); } };

  /* what can this device do right now? Every button reads this one object instead of its own mix of tests (Fable, Oct 22) */
  const can = {
    get key() { return canKey(); }, get cat() { return !!(G.KPCCat && KPCCat.connected()); }, get call() { return !!myCall(); }, get realCall() { return stdCall(myCall()); },
    get gps() { return !!navigator.geolocation; }, get mic() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }, get online() { return net.online(); },
    get native() { return !!N.native; }, get pc() { return N.platform === 'windows'; }, get raw() { return net.canRaw(); }, get tcp() { return net.tcp; }, get serial() { return !!(N.serial || navigator.serial || navigator.usb); },
    get sound() { return RUN; }, get remote() { return !!(G.KPCRemote && KPCRemote.link().paired); }, get lite() { return LITE; },
    /* why not? one line for the dimmed button */
    why(what) { return ({ key: !myCall() ? 'Put your call sign in STATION → My station first.' : 'Nothing can key the radio yet: connect it (CAT) or pick VOX in STATION → Radio control.', cat: 'Connect the radio in STATION → Radio control first.', call: 'Put your call sign in STATION → My station first.', realCall: myCall() + ' is a practice call: this needs a real licensed call.', gps: 'This device has no GPS the app can read.', mic: 'No microphone here, or it is not allowed for KPC.', online: 'No internet right now; it will go when the signal is back.', raw: 'This needs the app (Windows or Android), not a browser tab.', tcp: 'Only the Windows app can open a TCP link.', serial: 'This device cannot talk to a USB radio.', sound: 'Press START LISTENING first.' })[what] || ''; }
  };
  /* settings versioning: rename or reshape a setting here, once, instead of one-off flags piling up */
  const MIG = [
    [2, () => { if (S.acv) delete S.acv; }],
    /* 0.6.7 (Brandon Oct 22: 'do we need the pretend mode anymore? … take it off'): the 🧪 button is gone; a device left on
       PRETEND is switched back to the real radio once (?fake=1 stays as the builders' switch for the tests) */
    [3, () => { if (!/[?&]fake=1/.test(location.search)) { let was = false; try { was = !!localStorage.getItem('kpcFake'); localStorage.removeItem('kpcFake'); } catch (e) {} if (was) setTimeout(() => location.reload(), 300); } }],
    /* 0.7.1 (Oct 25): the MY RIG text box shared its id with the radio drop-down, so it was filled with the radio's short id ('ft710'); put the proper name there once */
    [4, () => { if (S.rig && G.KPCCat && KPCCat.RADIO && KPCCat.RADIO[S.rig]) S.rig = KPCCat.RADIO[S.rig].label || S.rig; }],
    /* 0.7.6 (Oct 27): RX LEVEL sat at +20 in every report (he read it as loudness; the CW decoder read 54 WPM from the clipped noise): back to 0 once */
    [5, () => { if (+S.rxDb >= 10) { S.rxDb = 0; setTimeout(() => toast('RX LEVEL was at +' + 20 + ' dB and is back at 0: it only feeds the decoders (not loudness). To hear the radio louder here use 🔊 HEAR THE RADIO HERE under STATION → Sound.', 9000), 2500); } }]
  ];
  (function migrate() { const v = +S.ver || 1; MIG.forEach(([n, f]) => { if (v < n) { try { f(); } catch (e) {} } }); if (v < MIG[MIG.length - 1][0]) { S.ver = MIG[MIG.length - 1][0]; save(); } })();

  /* ---------------- backup + restore, and 'a new build is out' (Oct 22) ----------------
     The backup = every setting this app keeps (incl. the log file) in one .kpcbackup. RESTORE merges the log and puts the settings back. */
  const BK_KEYS = ['kpcApp', 'kpcAppDigi', 'kpcAppAprs', 'kpcAppSpots', 'kpcAppAlerts', 'kpcAppUp', 'kpcCat', 'kpcQrz', 'kpcAppDock', 'kpcTheme', 'kpcStyle', 'kpcMode', 'kpcPacks', 'kpcDev', 'kpcLogOpts', 'kpcAppLk', 'kpcAppPotaF', 'kpcPortNick', 'kpcAppOps', 'kpcAppVk', 'kpcApp5', 'kpcAppMeters', 'kpcAppCx', 'kpcAppSkim', 'kpcSkimLoc', 'kpcAppQp', 'kpcAppScope', 'kpcAppRot', 'kpcAppNr', 'kpcAppRigX', 'kpcAppBandMem', 'kpcAppWorks'];
  function backupText() { const st = {}; BK_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v != null) st[k] = v; }); return JSON.stringify({ kpcbackup: 1, ver: VER, when: Date.now(), settings: st, log: G.KPCLog ? JSON.parse(KPCLog.fileText()) : null }); }
  function restoreText(txt) {
    let j; try { j = JSON.parse(txt); } catch (e) { return { ok: false, msg: 'that is not a KPC backup file' }; }
    if (!j || !j.kpcbackup) return { ok: false, msg: 'that is not a KPC backup file' };
    let n = 0; if (j.log && G.KPCLog) n = KPCLog.merge(j.log.qso || [], 'file').length;
    Object.keys(j.settings || {}).forEach(k => { if (BK_KEYS.includes(k)) { try { localStorage.setItem(k, j.settings[k]); } catch (e) {} } });
    return { ok: true, n };
  }
  const bkS = $('stBackup'), bkR = $('stRestore'), bkF = $('stRestoreFile');
  if (bkS) bkS.onclick = () => saveFile(backupText(), 'KPC-backup-' + (myCall() || 'app').replace(/[^A-Z0-9]/gi, '') + '-' + new Date().toISOString().slice(0, 10) + '.kpcbackup', 'application/json');
  if (bkR && bkF) { bkR.onclick = () => bkF.click(); bkF.onchange = async () => { const f = bkF.files && bkF.files[0]; bkF.value = ''; if (!f) return; const r = restoreText(await f.text()); if (!r.ok) { toast('Not restored: ' + esc(r.msg), 5000, 'bad'); return; } toast('✅ Restored: settings back, ' + r.n + ' contacts merged. The app restarts in a moment.', 5000, 'log'); setTimeout(() => location.reload(), 2500); }; }
  const newer = (a, b) => { const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((A[i] || 0) > (B[i] || 0)) return true; if ((A[i] || 0) < (B[i] || 0)) return false; } return false; };
  /* Oct 24 (to-do 'EASIER UPDATES step 1'): a bar on every screen when a newer build is out; GET IT opens the download page in the browser */
  function updBar(j) {
    let b = document.querySelector('.updbar'); if (LS('kpcUpdHide', '') === j.ver) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.className = 'updbar'; document.querySelector('header.top').after(b); }
    b.innerHTML = `⬆ <b>New build ${esc(j.ver)}</b>${j.notes ? ' — ' + esc(String(j.notes).slice(0, 90)) : ''}${j.where ? ` <a class="b gold sm" href="${esc(j.where)}" target="_blank" rel="noopener">GET IT</a>` : ''} <button type="button" class="ux" title="Hide until the next build">✕</button>`;
    b.querySelector('.ux').onclick = () => { SV('kpcUpdHide', j.ver); b.remove(); };
  }
  async function updateCheck() {
    const e = $('stUpd'); if (!net.online()) return;
    const last = LS('kpcUpdAt', 0); if (Date.now() - last < 6 * 3600000 && !$('stUpd').dataset.force) return;
    try { const r = await net.fetch('https://kentuckyportableclub.github.io/KPC-Links/app/version.json?v=' + Date.now().toString(36).slice(0, 7), {}, 10000); if (!r.ok) return; const j = await r.json(); SV('kpcUpdAt', Date.now());
      SV('kpcUpdLast', j);
      if (j.ver && newer(j.ver, VER)) { updBar(j); e.hidden = false; e.className = 'st ok'; e.innerHTML = '⬆ A newer test build is out: <b>' + esc(j.ver) + '</b> (' + esc(j.when || '') + ')' + (j.notes ? ' — ' + esc(j.notes) : '') + (j.where ? ' <a href="' + esc(j.where) + '" target="_blank" rel="noopener">GET IT</a>' : ''); if (LS('kpcUpdSaid', '') !== j.ver) { SV('kpcUpdSaid', j.ver); toast('⬆ A newer test build (' + esc(j.ver) + ') is out. See STATION → Alerts & help.', 7000, 'log'); } }
      else { e.hidden = false; e.className = 'st'; e.textContent = 'This is the newest build (' + VER + ').'; }
    } catch (err) { console.warn('update check: ' + (err && err.message)); }
  }
  /* the last answer is kept, so the bar shows at once after a restart (or at a park with no signal) */
  { const lj = LS('kpcUpdLast', null); if (lj && lj.ver && newer(lj.ver, VER)) { updBar(lj); const e = $('stUpd'); if (e) { e.hidden = false; e.className = 'st ok'; e.innerHTML = '⬆ A newer test build is out: <b>' + esc(lj.ver) + '</b> (' + esc(lj.when || '') + ')' + (lj.notes ? ' — ' + esc(lj.notes) : '') + (lj.where ? ' <a href="' + esc(lj.where) + '" target="_blank" rel="noopener">GET IT</a>' : ''); } } }
  setTimeout(updateCheck, 6000); setInterval(updateCheck, 6 * 3600000);
  const bu = $('stUpdNow'); if (bu) bu.onclick = () => { $('stUpd').dataset.force = '1'; updateCheck().then(() => { delete $('stUpd').dataset.force; }); };

  /* the pretend radio switch */
  const fakeOn = () => !!(G.KPCFake && KPCFake.on);
  const bf = $('stFake');
  if (bf) { bf.textContent = '🧪 PRETEND RADIO: ' + (fakeOn() ? 'ON' : 'OFF'); bf.classList.toggle('on', fakeOn()); bf.onclick = () => { try { if (fakeOn()) localStorage.removeItem('kpcFake'); else localStorage.setItem('kpcFake', '1'); } catch (e) {} toast(fakeOn() ? 'Pretend radio off. Restarting…' : 'Pretend radio on: a made-up band, nothing on the air. Restarting…', 3000); setTimeout(() => location.reload(), 1200); }; }
  if (fakeOn() && G.KPCCat) { const c = KPCCat.get(); if (c.link !== 'fake') { if (!c.radio) KPCCat.pickRadio('ft710'); KPCCat.set({ link: 'fake', on: true }); linkUi(); } toast('🧪 Pretend radio is ON: nothing goes on the air.', 4000); }
  /* Brandon Oct 22: the PC was still on PRETEND without him noticing → a banner on every screen while it is on, tap = turn it off */
  if (fakeOn()) { const b = document.createElement('button'); b.type = 'button'; b.className = 'fakebar'; b.textContent = '🧪 PRETEND RADIO IS ON — made-up band, nothing goes on the air. Tap to turn it off.'; b.onclick = () => { try { localStorage.removeItem('kpcFake'); } catch (e) {} location.reload(); }; document.querySelector('header.top').after(b); document.body.classList.add('fake'); }
  else if (G.KPCCat && KPCCat.get().link === 'fake') { KPCCat.set({ link: 'serial' }); linkUi(); }

  /* headless base station (the PC app started with --headless): do by itself what Brandon would click */
  const HEADLESS = /[?&]headless=1/.test(location.search);
  if (HEADLESS) setTimeout(async () => {
    console.log('headless: starting the station');
    if (G.KPCCat && KPCCat.get().radio) { try { await KPCCat.connect(false); await fillPorts(); keyCheck(); } catch (e) {} }
    await start();
    if (G.kpcRemote) { try { await G.kpcRemote.start({ on: true }); } catch (e) {} }
    toast('Headless base station: sound on, radio ' + (canKey() ? 'ready' : 'not connected') + ', phone link on.', 6000, 'log');
  }, 2500);

  /* ---------------- clock in the header ---------------- */
  setInterval(() => { $('utc').textContent = utc(Date.now(), true); }, 250);
  $('utc').textContent = utc(Date.now(), true);

  /* ---------------- start up ---------------- */
  $('stVer').textContent = VER + (LITE ? ' Lite' : '') + ' · ' + (N.native ? 'Android' : N.platform === 'windows' ? 'Windows' : 'browser');
  fields(); devices(); fillPorts(); linkUi(); keyCheck(); state();
  /* Oct 27 (Fable; Brandon: 'does this work on all radios?'): what each radio family needs set on ITS OWN menus — the app cannot set these over CAT */
  const TIPS = {
    yaesu: ['Yaesu (FT-710, FTDX10, FT-991A, FT-891, FTX-1)', ['CAT RATE = the baud rate picked here (38400), CAT RTS = ON is fine (the app holds RTS up)', 'DATA: MODE DATA → DATA MOD SOURCE = REAR and REAR SELECT = USB (FT8 power comes from this)', 'SSB voice from the app (keyer, hold to talk, the phone): MODE SSB → SSB MOD SOURCE = REAR (AUTO also works on most) — then PTT from the app carries the USB sound', 'CW typed from the app: the radio\'s own keyer over CAT works on the FT-710 / FTDX10 / 991A / 891; hand keying: USB KEYING (CW) = DTR + CW BK-IN = ON (the key is on the radio\'s SECOND USB port)', 'A tone through the sound card only transmits in DATA: the app flips the radio to DATA for the over when you pick that way']],
    icom: ['Icom (IC-7300, IC-705, IC-7100, IC-9700…)', ['CONNECTORS → CI-V: USB BAUD RATE = the one picked here, CI-V ADDRESS = the one shown here, CI-V USB ECHO BACK = OFF', 'DATA: MOD → DATA MOD = USB (FT8 power comes from this); the app uses USB-D', 'SSB voice from the app: CONNECTORS → MOD → DATA OFF MOD = USB (that is the SSB source) — or leave it MIC and turn on \'switch the radio to DATA while it sends\' under VOICE FROM THIS DEVICE', 'CW typed from the app: the radio\'s own keyer over CAT works; hand keying: CW by DTR on the USB port (CONNECTORS → USB SEND/KEYING → USB KEYING (CW) = DTR)', 'CI-V USB PORT = UNLINK FROM [REMOTE] so the USB port is a plain CAT port']],
    kenwood: ['Kenwood (TS-590, TS-890, TS-990, TS-480)', ['Menu: baud rate for the USB / COM port = the one picked here; TX ENABLE for the data (USB) audio input', 'DATA: pick DATA (DA1) with the USB audio as the source: menu \'USB audio input level\' up, \'audio input line select\' / \'DATA VOX\' off', 'SSB voice from the app: the SSB source must be the USB (ACC2) input while sending by CAT: menu \'TX audio source (SSB)\' / \'PC audio\' = USB — or use \'switch the radio to DATA while it sends\'', 'CW typed from the app: the radio\'s own keyer over CAT (KY) works; hand keying: DTR / RTS key line on the COM port where the radio allows it']],
    elecraft: ['Elecraft (KX2, KX3, K3, K4, KH1)', ['CONFIG: RS232 = the baud rate picked here; AUTOINF OFF', 'DATA: DATA A mode with LINE IN as the source (MIC/LINE = LINE); the KX2/KX3 take the sound card on the ACC / LINE jack', 'SSB voice from the app: MIC/LINE → LINE for the SSB source while sending from the app, or use \'switch the radio to DATA while it sends\'', 'CW typed from the app: the radio\'s own keyer over CAT (KY) works well; hand keying = a real key on the radio, or the DTR / RTS line through a Digirig']],
    xiegu: ['Xiegu (G90, X6100, X6200, G106)', ['CI-V on the USB-C / ACC: baud 19200 (G90 default), address 70', 'DATA + voice from the app both need the sound card on the ACC / LINE IN jack (a Digirig / Xiegu DE-19): the radio has no USB sound card of its own', 'CW typed from the app over CAT is not reliable on Xiegu: use the DTR / RTS key line (Digirig) or a tone', 'Hamlib / flrig also work for these (HOW THE APP REACHES IT)']],
    qrp: ['QRP Labs (QMX, QDX, QCX, (tr)uSDX)', ['QMX: USB SERIAL PORTS = 3 in its menu; CAT on the lowest port at 38400; the DTR line is NOT the key (the app keeps it down)', 'QDX / QMX are digital-only for the sound card (FT8 etc.); the QMX keys CW by its own keyer over CAT (KY, firmware 1_00_021+) or a paddle', 'No voice from these radios']],
    other: ['Other radios', ['The app sends standard Kenwood-style CAT (TS-590 commands); if the radio does not answer, try Hamlib rigctld or flrig under HOW THE APP REACHES IT', 'For DATA and voice from the app the radio must take its transmit sound from the sound card you picked (its USB / LINE / ACC input); set that in the radio\'s menu', 'CW: typed CW over CAT works on radios with a KY command; otherwise the DTR / RTS key line, or a tone through the sound card']]
  };
  const rigFam = id => { const R = G.KPCCat && KPCCat.RADIO && KPCCat.RADIO[id]; return !R ? 'other' : R.model === 'elecraft' ? 'elecraft' : R.model === 'xiegu' ? 'xiegu' : /^(qmx|qdx|qcx|trusdx)$/.test(id) ? 'qrp' : /^yaesu/.test(R.proto) ? 'yaesu' : R.proto === 'icom' ? 'icom' : R.proto === 'kenwood' && /^ts/.test(id) ? 'kenwood' : 'other'; };
  if ($('stRigTips')) $('stRigTips').onclick = () => { if (G.KPCHelp) { KPCHelp.guide($('stRig').value || ''); return; }   /* Nov 6: the full setup guide for this radio (kpc-help.js) */ const id = $('stRig').value || '', fam = rigFam(id);
    const T = TIPS[fam]; sheet('📖 ' + T[0], '<p class="hint">What the radio itself has to be set to; the app cannot change these over CAT. Menu names differ a little by model: look for these words in the radio\'s manual.</p><ul class="helpl">' + T[1].map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><p class="hint">Three things every radio needs for the app: (1) CAT answers at the baud rate picked here, (2) its transmit sound comes from the sound card you picked (for DATA and for voice from the app), (3) a way to key CW: its own keyer over CAT, a DTR / RTS line, or a tone in DATA mode.</p>'); };
  if ($('stCatMore')) $('stCatMore').onclick = () => { document.body.classList.toggle('cat-more'); $('stCatMore').textContent = document.body.classList.contains('cat-more') ? '▴ FEWER RADIO SETTINGS' : '⚙ MORE RADIO SETTINGS'; catVis(); };
  setInterval(catVis, 3000); setTimeout(catVis, 300);
  go(LS('kpcScreen', 'log'));
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', devices);
  G.addEventListener('error', e => console.error(e.message));

  /* Oct 22 (Brandon: 'Saved adif I dont see it on my tablet'): an Android web view drops a blob download without a word.
     In the app the file goes through the plugin into Downloads › KPC, and a sheet offers to SEND it (email, Drive…).
     On the PC / in a browser it is an ordinary download. Returns where it went, or '' when it could not be saved. */
  async function saveFile(text, name, mime) {
    if (KAP === undefined) KAP = N.native && G.Capacitor && G.Capacitor.registerPlugin ? G.Capacitor.registerPlugin('KpcAudio') : null;
    const KA = KAP;
    if (KA) {
      try {
        const r = await KA.saveFile({ name, text, mime: 'application/octet-stream' });
        sheet('Saved', `<p>📁 <b>${esc(r.where || 'Downloads/KPC/' + name)}</b></p><p class="hint">Open it with the Files app (Downloads › KPC), or send it on now.</p>
          <div class="row"><button type="button" class="b gold" id="svSend">📤 SEND IT (email, Drive, QRZ…)</button><button type="button" class="b" id="svOk">OK</button></div>`);
        const b = document.getElementById('svSend'); if (b) b.onclick = () => { KA.shareFile({ uri: r.uri, mime: mime || 'text/plain', name }).catch(() => toast('Sending did not open here. The file is in Downloads › KPC.', 5000, 'bad')); shut(); };
        const k = document.getElementById('svOk'); if (k) k.onclick = () => shut();
        return r.where || 'Downloads/KPC/' + name;
      } catch (e) { console.error('saveFile: ' + (e && e.message)); }
    }
    try {
      const a = document.createElement('a'), b = new Blob([text], { type: mime || 'text/plain' });
      a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      if (!KA) toast('Saved ' + esc(name) + ' to this device\'s Downloads folder.', 5000, 'log');
      return 'Downloads/' + name;
    } catch (e) { toast('Could not save the file here. Use COPY THE LOG instead.', 5000, 'bad'); return ''; }
  }

  G.KPCApp = {
    saveFile,
    VER, S, save, toast, sheet, shut, go, on, fire, esc, utc, toGrid,
    myCall, myGrid, dist, distUnit, toUnit, pickSerial, portLabel, chipName, native: N.native, platform: N.platform,
    devices, start, stop, soundLost, setDb, lvSet, dialNow, monSet, lvHtml, lvShow, pttOn, catMsg: () => catLast, canKey, keyCheck, clock, stdCall,
    running: () => RUN, txing: () => TXING, rigTips: () => TIPS, rigFam: id => rigFam(id),
    audio: A, rate: A.rate, bandPlan, net, report, can, backupText, restoreText, headless: HEADLESS, now, gps, pc: PC,
    cat: () => G.KPCCat || null, catConnected: () => !!(G.KPCCat && KPCCat.connected()),
    /* station = the call that goes out on the air (SEND AS); op = who is at the key (OPERATORS); ctl = the control operator when
       someone else holds the key from afar (set by the remote link), kept apart as Part 97.119 wants */
    county, gridLL, myCounty,
    me: () => ({ cnty: myCounty(), call: myCall(), station: String(S.call || '').toUpperCase(), grid: myGrid(), ref: String(S.ref || '').toUpperCase(), hunt: S.role === 'hunt', goal: +S.goal || 0,
      op: String(S.op || S.call || '').toUpperCase(), ctl: String(CTL || '').toUpperCase() }),
    ctl: c => { if (c !== undefined) { CTL = String(c || '').toUpperCase(); fire('me'); } return CTL; }
  };
  opsShow();
})(window);
