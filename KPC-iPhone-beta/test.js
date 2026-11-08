/* KPC app, step 2 radio check screen: sound in/out through the app's own code, FT8 receive, TUNE, one FT8 CQ, radio over USB. */
(function () {
  const $ = id => document.getElementById(id);
  const N = window.KPCNative, A = N.audio, VER = ((/KPC\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || 'radio check');   /* was a fixed '0.2.8' (Oct 23: it showed in Brandon's report) */
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = Object.assign({ inDev: '', outDev: '', db: -6, ptt: 'cat', call: '', grid: '', pause: true, stereo: false, low: false, deep: false }, LS('kpcTest', {}));
  const save = () => SV('kpcTest', S);
  $('ver').textContent = VER + ' · ' + N.platform;
  $('plat').textContent = N.native ? 'Android' : N.platform === 'windows' ? 'Windows' : 'browser';

  /* ---- log ---- */
  const LOG = [];
  function log(t) { const s = new Date().toISOString().slice(11, 19) + 'Z ' + t; LOG.push(s); if (LOG.length > 300) LOG.shift(); const el = $('log'); el.textContent = LOG.slice(-80).join('\n'); el.scrollTop = el.scrollHeight; }
  $('copyLog').onclick = async () => { const t = ['KPC app ' + VER + ' · ' + N.platform + ' · ' + navigator.userAgent, ...LOG].join('\n'); try { await navigator.clipboard.writeText(t); log('Copied.'); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); log('Copied.'); } catch (e2) { log('Could not copy.'); } ta.remove(); } };
  window.onerror = (m, src, l) => log('ERROR ' + m + ' (' + (src || '').split('/').pop() + ':' + l + ')');
  window.onunhandledrejection = e => log('ERROR ' + (e.reason && (e.reason.message || e.reason)));
  log('KPC app ' + VER + ' on ' + N.platform + (N.native ? ' (native sound + USB)' : ' (web sound + Web Serial)') + ' · Capacitor ' + (window.Capacitor ? (Capacitor.getPlatform ? Capacitor.getPlatform() : 'bridge') + (Capacitor.registerPlugin ? '' : ' no registerPlugin') : 'none'));
  if (!N.native && /; wv\)/.test(navigator.userAgent)) log('WARNING: running inside the app but the native bridge was not found. Tell Brandon to send this log.');

  /* ---- look ---- */
  $('look').onclick = () => { const r = document.documentElement, n = r.dataset.theme === 'light' ? 'dark' : 'light'; r.dataset.theme = n; try { localStorage.setItem('kpcTheme', n); } catch (e) {} };

  /* ---- devices ---- */
  async function devices() {
    let d = { inputs: [], outputs: [] };
    try { d = await A.devices(); } catch (e) { log('Device list failed: ' + (e.message || e)); }
    const fill = (sel, list, cur) => { sel.innerHTML = '<option value="">Default</option>' + list.map(x => `<option value="${x.id}">${x.usb ? '🔌 ' : ''}${x.name || x.id}</option>`).join(''); sel.value = cur && list.some(x => String(x.id) === String(cur)) ? cur : ''; };
    fill($('inDev'), d.inputs, S.inDev); fill($('outDev'), d.outputs, S.outDev);
    const ui = d.inputs.find(x => x.usb), uo = d.outputs.find(x => x.usb);
    if (!S.inDev && ui) { $('inDev').value = ui.id; log('Radio sound card found: ' + ui.name); }
    if (!S.outDev && uo) $('outDev').value = uo.id;
    if (!ui && N.native) log('No USB sound card seen yet. Plug the radio in (data cable), turn it on, then ↻ DEVICES.');
    return d;
  }
  $('refresh').onclick = devices;
  $('inDev').onchange = () => { S.inDev = $('inDev').value; save(); };
  $('outDev').onchange = () => { S.outDev = $('outDev').value; save(); };

  /* ---- receive: ring at 12 kHz, decode every 15 s slot ---- */
  const R12 = 12000, RING = R12 * 40;
  let ENG = null, RUN = false, ring = new Float32Array(RING), n12 = 0, t0 = 0, lastRx = 0, quietSince = 0, slotDone = -1, timer = null, decoded = 0;
  async function engine() { if (ENG) return ENG; ENG = await KPCFT8.load('kpc-ft8.wasm?v=20261017a'); return ENG; }
  function onRx(c) {
    lastRx = Date.now();
    if (!t0) t0 = c.t;
    t0 = c.t - n12 / R12 * 1000; // keep the sample count lined up with the clock
    for (let i = 0; i < c.pcm.length; i++) ring[(n12 + i) % RING] = c.pcm[i];
    n12 += c.pcm.length;
    const db = c.db, pct = Math.max(0, Math.min(100, (db + 80) / 80 * 100));
    $('lvl').style.width = pct + '%'; $('lvl').className = db > -3 ? 'hot' : ''; $('lvlT').textContent = (c.tx ? 'TX · ' : '') + db.toFixed(0) + ' dB';
    if (db < -70) { if (!quietSince) quietSince = Date.now(); else if (Date.now() - quietSince > 6000) $('soundHint').textContent = 'No sound is coming in. Pick the USB sound card under RADIO SOUND IN, check the cable, and turn the radio\'s USB audio out up.'; }
    else quietSince = 0;
  }
  function tick() {
    if (!RUN) return;
    const now = Date.now() / 1000, B = Math.floor(now / 15) * 15; // start of the current slot
    $('slotT').textContent = 'slot ' + ((B / 15) % 2 === 0 ? 'even' : 'odd') + ' · ' + (now - B).toFixed(0) + ' s';
    if (now - B >= 0.9 && slotDone !== B && t0) { slotDone = B; decodeSlot(B - 15); }
  }
  function decodeSlot(start) {
    const i0 = Math.round((start * 1000 - t0) / 1000 * R12), want = 15 * R12;
    if (i0 < n12 - RING || i0 + want * 0.9 > n12) return; // not all in yet (or too old)
    const buf = new Float32Array(want); for (let i = 0; i < want; i++) { const j = i0 + i; buf[i] = j >= 0 && j < n12 ? ring[((j % RING) + RING) % RING] : 0; }
    let D = [];
    try { ENG.start(false); ENG.feed(buf); D = ENG.decode(10, 25); } catch (e) { log('decode error ' + (e.message || e)); return; }
    D.sort((a, b) => a.hz - b.hz);
    const t = new Date(start * 1000).toISOString().slice(11, 19), box = $('dec');
    if (box.querySelector('.empty')) box.innerHTML = '';
    const me = ($('call').value || '').trim().toUpperCase();
    const html = `<div class="sep">${t} UTC · ${D.length} decoded</div>` + D.map(d => { const tk = d.text.split(/\s+/); const cls = tk[0] === 'CQ' ? 'cq' : (me && tk[0] === me ? 'me' : ''); return `<div class="l ${cls}"><span>${t.slice(0, 5)}</span><span>${d.db > 0 ? '+' : ''}${d.db}</span><span>${d.dt.toFixed(1)}</span><span>${d.hz}</span><span>${esc(d.text)}</span></div>`; }).join('');
    box.insertAdjacentHTML('afterbegin', html);
    while (box.children.length > 120) box.lastChild.remove();
    decoded += D.length; $('cntT').textContent = decoded + ' decoded';
    if (D.length) log('decoded ' + D.length + ' at ' + t + ' UTC (best ' + Math.max(...D.map(d => d.db)) + ' dB)');
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  $('start').onclick = async () => {
    $('start').disabled = true;
    try {
      await engine();
      S.inDev = $('inDev').value; S.outDev = $('outDev').value; save();
      const r = await A.start({ input: S.inDev, output: S.outDev, stereo: S.stereo, lowLatency: S.low, deep: S.deep }, onRx);
      RUN = true; n12 = 0; t0 = 0; slotDone = -1; quietSince = 0;
      await A.setGain(Math.pow(10, S.db / 20));
      $('stop').disabled = false; $('lvlT').textContent = '…';
      log('Sound started: ' + (r.source || '') + (r.input ? ' · in: ' + r.input.name : '') + (r.output ? ' · out: ' + r.output.name : '') + ' · latency ' + (r.latencyMs || 0) + ' ms' + (r.stereo ? ' · stereo' : ' · mono') + (r.lowLatency ? ' · low-latency' : '') + (r.deep ? ' · media-player path' : '') + (r.bufferMs ? ' · buffer ' + r.bufferMs + ' ms' : '') + (r.track ? ' · ' + r.track : '') + (r.hal ? ' · device ' + r.hal : '') + (N.native ? ' · media volume set to max' : ''));
      if (timer) clearInterval(timer); timer = setInterval(tick, 250);
    } catch (e) { log('Could not start sound: ' + (e.message || e)); $('start').disabled = false; }
  };
  $('stop').onclick = async () => { RUN = false; if (timer) clearInterval(timer); timer = null; try { await A.stop(); } catch (e) {} $('start').disabled = false; $('stop').disabled = true; $('lvl').style.width = '0'; $('lvlT').textContent = 'off'; $('txT').textContent = 'TX off'; $('txT').className = 'st'; log('Sound stopped.'); };

  /* ---- transmit ---- */
  const dbT = () => { $('pwrT').textContent = (S.db > 0 ? '+' : S.db === 0 ? '' : '−') + Math.abs(S.db).toFixed(1).replace('.0', '') + ' dB'; $('pwr').value = S.db; };
  const setDb = async v => { S.db = Math.max(-40, Math.min(0, Math.round(v * 2) / 2)); save(); dbT(); try { await A.setGain(Math.pow(10, S.db / 20)); } catch (e) {} };
  $('optPause').checked = !!S.pause; $('optStereo').checked = !!S.stereo; $('optLow').checked = !!S.low; A.pauseRx = !!S.pause;
  $('optPause').onchange = () => { S.pause = $('optPause').checked; A.pauseRx = S.pause; save(); log('Pause listening while sending: ' + (S.pause ? 'on' : 'off')); };
  $('optStereo').onchange = () => { S.stereo = $('optStereo').checked; save(); log('Stereo out: ' + (S.stereo ? 'on' : 'off') + ' (press STOP, then START LISTENING)'); };
  $('optDeep').checked = !!S.deep; $('optDeep').onchange = () => { S.deep = $('optDeep').checked; save(); log('Media-player path: ' + (S.deep ? 'on' : 'off') + ' (press STOP, then START LISTENING)'); };
  $('optLow').onchange = () => { S.low = $('optLow').checked; save(); log('Low-latency out: ' + (S.low ? 'on' : 'off') + ' (press STOP, then START LISTENING)'); };
  dbT(); $('pwr').oninput = () => setDb(+$('pwr').value); $('pwrD').onclick = () => setDb(S.db - 0.5); $('pwrU').onclick = () => setDb(S.db + 0.5);
  $('ptt').value = S.ptt; $('ptt').onchange = () => { S.ptt = $('ptt').value; save(); KPCCat.set({ ptt: S.ptt }); };
  $('call').value = S.call; $('grid').value = S.grid;
  $('call').onchange = () => { S.call = $('call').value.trim().toUpperCase(); $('call').value = S.call; save(); };
  $('grid').onchange = () => { S.grid = $('grid').value.trim().toUpperCase(); $('grid').value = S.grid; save(); };
  const txT = (t, on) => { $('txT').textContent = t; $('txT').className = 'st' + (on ? ' on' : ''); };
  async function pttOn(on) {
    if (S.ptt === 'vox') return true;
    try {
      const ok = await KPCCat.ptt(on, S.ptt); if (!ok) log('PTT ' + (on ? 'on' : 'off') + ' did not work (' + S.ptt + ').');
      if (on && N.serial && N.serial.letGo) { const r = await N.serial.letGo(); if (r && r.holding) log('USB port still held (RTS/DTR PTT): the radio may get no sound.'); else log('USB port let go for TX.'); }
      return ok;
    } catch (e) { log('PTT error ' + (e.message || e)); return false; }
  }
  let txBusy = false;
  $('tune').onclick = async () => {
    if (!RUN) { log('Press START LISTENING first (it opens the sound).'); return; }
    if (txBusy) { log('Still finishing the last TX; press STOP TX, then try again.'); return; } txBusy = true;
    txT('TUNE: steady 1500 Hz tone for 10 s. Watch ALC and watts.', true); log('TUNE at ' + S.db + ' dB, PTT ' + S.ptt);
    await pttOn(true);
    try { const r = await A.tone(1500, 10, 'tune'); log('TUNE ' + r.state); } catch (e) { log('TUNE failed: ' + (e.message || e)); }
    await pttOn(false); txT('TX off'); txBusy = false;
  };
  $('tuneOnly').onclick = async () => {
    if (!N.native) { log('TUNE, NOTHING LISTENING is for the Android app.'); return; }
    if (txBusy) return; txBusy = true;
    if (RUN) { RUN = false; if (timer) clearInterval(timer); timer = null; $('start').disabled = false; $('stop').disabled = true; $('lvl').style.width = '0'; $('lvlT').textContent = 'off'; }
    txT('TUNE with nothing listening: steady tone for 10 s (press START LISTENING again afterwards).', true); log('TUNE (nothing listening) at ' + S.db + ' dB, PTT ' + S.ptt + ', stereo');
    await pttOn(true);
    try { const r = await A.toneOnly({ hz: 1500, seconds: 10, stereo: true, output: $('outDev').value }); log('TX tone-only ' + (r.ok ? 'end' : 'FAILED ' + r.error) + ': wrote ' + r.written + ' of ' + r.samples + ', underruns ' + r.underruns + ', out ' + r.out + ', gain ' + (+r.gain).toFixed(2)); }
    catch (e) { log('tone-only failed: ' + (e.message || e)); }
    await pttOn(false); txT('TX off'); txBusy = false;
  };
  $('tuneFree').onclick = async () => {
    if (!N.native) { log('TONE, RADIO LET GO is for the Android app.'); return; }
    if (txBusy) { log('Still finishing the last TX; press STOP TX, then try again.'); return; } txBusy = true;
    try { await KPCCat.disconnect(); } catch (e) {} fillPorts();
    txT('RADIO LET GO: the app is not holding the USB control port. Press MOX on the radio, tone plays for 10 s.', true); log('TONE WITH RADIO LET GO at ' + S.db + ' dB (no PTT; key the radio with MOX)');
    await new Promise(r => setTimeout(r, 1500));
    try { const r = await Promise.race([A.mediaTone({ hz: 1500, seconds: 10 }), new Promise(res => setTimeout(() => res({ ok: false, timeout: true, ms: 0, gain: 0 }), 13000))]); log(r.stopped ? 'Tone stopped.' : r.timeout ? 'Tone: no answer after 13 s.' : 'TX tone (radio let go) end: ' + r.ms + ' ms, out ' + (r.out || '?') + ', gain ' + (+r.gain).toFixed(2)); }
    catch (e) { log('tone failed: ' + (e.message || e)); }
    txT('TX off'); txBusy = false;
  };
  $('tuneMedia').onclick = async () => {
    if (!N.native) { log('MEDIA PLAYER TONE is for the Android app.'); return; }
    if (txBusy) return; txBusy = true;
    txT('MEDIA PLAYER TONE: 10 s tone file through Android\'s media player (the YouTube way).', true); log('MEDIA PLAYER TONE at ' + S.db + ' dB, PTT ' + S.ptt);
    await pttOn(true);
    try { const r = await Promise.race([A.mediaTone({ hz: 1500, seconds: 10 }), new Promise(res => setTimeout(() => res({ ok: false, timeout: true, ms: 0, gain: 0 }), 13000))]); log(r.stopped ? 'Media-player tone stopped.' : r.timeout ? 'Media-player tone: no answer after 13 s (buttons freed).' : 'TX media-player tone end: ' + r.ms + ' ms, out ' + (r.out || '?') + ', gain ' + (+r.gain).toFixed(2)); }
    catch (e) { log('media-player tone failed: ' + (e.message || e)); }
    await pttOn(false); txT('TX off'); txBusy = false;
  };
  $('halt').onclick = async () => { try { await A.stopTx(); } catch (e) {} await pttOn(false); txT('TX off'); log('TX stopped.'); };
  $('cq').onclick = async () => {
    if (!RUN) { log('Press START LISTENING first.'); return; }
    const me = ($('call').value || '').trim().toUpperCase(), g = ($('grid').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,}\/?[A-Z0-9]*$/.test(me)) { log('Put your call sign in MY CALL first.'); return; }
    if (txBusy) return; txBusy = true;
    const msg = ('CQ ' + me + (/^[A-R]{2}\d{2}$/.test(g) ? ' ' + g : '')).trim();
    let tones; try { tones = ENG.tones(msg, false); } catch (e) {}
    if (!tones) { log('That message can\'t be sent as FT8: ' + msg); txBusy = false; return; }
    const pcm = KPCFT8.synth(tones, 1500, A.rate, false);
    const now = Date.now() / 1000; let B = Math.ceil((now + 1.5) / 15) * 15; if ((B / 15) % 2 !== 0) B += 15; // next even slot
    const at = B * 1000 + 500, id = 'cq' + B;
    txT('Sending "' + msg + '" in ' + Math.round(B - now) + ' s (even slot ' + new Date(B * 1000).toISOString().slice(11, 19) + ' UTC)…', true);
    log('FT8 CQ queued for ' + new Date(B * 1000).toISOString().slice(11, 19) + ' UTC: ' + msg + ' (' + pcm.length + ' samples at 1500 Hz)');
    const pttTimer = setTimeout(() => { pttOn(true); txT('TX: ' + msg, true); }, Math.max(0, at - Date.now() - 700));
    try { const r = await A.play(pcm, at, id); log('FT8 CQ ' + r.state + (r.late ? ' (started ' + r.late + ' ms late)' : '') + ' at ' + new Date().toISOString().slice(11, 23) + ' UTC'); } catch (e) { log('FT8 TX failed: ' + (e.message || e)); }
    clearTimeout(pttTimer);
    await pttOn(false); txT('TX off'); txBusy = false;
  };
  A.onTx = ev => { if (ev.state === 'start' && ev.id !== 'tune') txT('TX: FT8 going out' + (ev.late > 300 ? ' (started ' + ev.late + ' ms late)' : ''), true);
    if (ev.state !== 'start' && ev.written != null) log('TX ' + ev.id + ' ' + ev.state + ': wrote ' + ev.written + ' of ' + ev.samples + ' samples in ' + ev.ms + ' ms, played ' + ev.head + ', errors ' + ev.errors + ', underruns ' + ev.underruns + ', out ' + ev.out + ', volume ' + ev.vol + ', gain ' + (ev.gain != null ? (+ev.gain).toFixed(2) : '?') + (ev.pausedRx ? ', listening paused' : ', listening kept on') + (ev.stereo ? ', stereo' : ', mono') + (ev.lowLatency ? ', low-latency' : '') + (ev.deep ? ', media-player path' : '') + (ev.bufferMs ? ', buffer ' + ev.bufferMs + ' ms' : '')); };

  /* ---- radio ---- */
  const catT = (t, ok) => { $('catT').textContent = t; $('catT').className = 'st' + (ok ? ' ok' : ''); };
  KPCCat.fillSelect($('rig'));
  $('rig').onchange = () => { const r = KPCCat.pickRadio($('rig').value); KPCCat.set({ on: true, ptt: S.ptt }); log('Radio: ' + (r ? r.label + ' · ' + r.proto + ' · ' + r.baud + ' baud' : $('rig').value)); };
  KPCCat.set({ on: true, ptt: S.ptt });
  KPCCat.onStatus((t, ok) => { catT(t, ok); log('Radio: ' + t); });
  async function fillPorts() {
    try { const ps = await KPCCat.ports(); const sel = $('port'); sel.innerHTML = ps.length ? ps.map(p => `<option value="${p.i}"${p.now ? ' selected' : ''}>${esc(p.label)}</option>`).join('') : '<option value="">(no USB port seen)</option>'; } catch (e) {}
  }
  $('port').onchange = async () => { if ($('port').value === '') return; catT('Switching port…'); await KPCCat.usePort(+$('port').value); fillPorts(); };
  $('connect').onclick = async () => {
    if (!$('rig').value) { catT('Pick your radio in the RADIO list first.'); return; }
    if (!KPCCat.supported()) { catT('This device can\'t talk to a radio over USB.'); return; }
    catT('Connecting…'); const ok = await KPCCat.connect(true); await fillPorts();
    if (ok) { const r = await KPCCat.read(); showDial(r); }
  };
  function showDial(r) { if (!r) { catT('Connected, but the radio did not answer. Check the radio type and its CAT baud rate (FT-710: CAT RATE 38400).'); return; }
    const data = /DATA/.test(r.mode); catT(`Radio says ${(r.khz / 1000).toFixed(4)} MHz ${r.mode || '?'}${data ? ' · DATA mode ✓' : ' · not in DATA mode: press SET 14.074 FT8 (DATA), or set DATA-U on the radio'}`, data);
    $('dialT').textContent = (r.khz / 1000).toFixed(3); log('Dial ' + r.khz + ' kHz ' + r.mode); }
  $('readDial').onclick = async () => { if (!KPCCat.connected()) { catT('Not connected. Press CONNECT RADIO.'); return; } showDial(await KPCCat.read()); };
  $('setDial').onclick = async () => { if (!KPCCat.connected()) { catT('Not connected. Press CONNECT RADIO.'); return; } await KPCCat.tune(14074, 'FT8'); await new Promise(r => setTimeout(r, 300)); showDial(await KPCCat.read()); };
  $('disconnect').onclick = async () => { await KPCCat.disconnect(); fillPorts(); };
  if ($('rig').value) log('Radio picked earlier: ' + $('rig').value);

  devices();
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', devices);
})();
