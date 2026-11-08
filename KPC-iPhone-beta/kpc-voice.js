/* KPC app: THE VOICE KEYER (Opus, Oct 24; Brandon Oct 24: 'make sure our voice keyer is on the to do'; plan in kpc-links
   notes/ft8-app.md 'VOICE MEMORY'). Six memories you record yourself (CQ POTA…, your call, the report, TU QRZ, QRZ?, 73), each up to
   30 s, kept on this device (IndexedDB kpc-voice, 16 kHz). One tap plays one out to the radio behind PTT (the same sound path as FT8);
   🔁 AUTO CQ repeats memory 1 with a listening gap until someone answers (typing a call, tapping STOP or the 10-minute limit stops it).
   The REMOTE tab on the phone can play the PC's memories ({t:'vk'} messages, kpc-remote.js). LOG screen → 🎙 chip shows the bar. */
(function (G) {
  'use strict';
  const AP = G.KPCApp, A = G.KPCNative && KPCNative.audio, $ = id => document.getElementById(id), esc = AP && AP.esc;
  if (!AP || !A) return;
  const RATE = 16000, MAXS = 30;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = Object.assign({ show: false, gap: 5, names: ['CQ', 'MY CALL', 'REPORT', 'TU QRZ', 'QRZ?', '73'], mic: '' }, LS('kpcAppVk', {}));
  const save = () => SV('kpcAppVk', S);
  const HAS = new Set();   /* which memories are recorded */

  /* ---------------- storage ---------------- */
  let dbP = null;
  const db = () => dbP || (dbP = new Promise((ok, no) => { try { const r = indexedDB.open('kpc-voice', 1); r.onupgradeneeded = () => r.result.createObjectStore('mem'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } }));
  const put = (i, v) => db().then(d => new Promise((ok, no) => { const t = d.transaction('mem', 'readwrite'); if (v == null) t.objectStore('mem').delete(i); else t.objectStore('mem').put(v, i); t.oncomplete = ok; t.onerror = () => no(t.error); }));
  const get = i => db().then(d => new Promise(ok => { const q = d.transaction('mem').objectStore('mem').get(i); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }));
  async function load() { for (let i = 0; i < 6; i++) { const v = await get(i).catch(() => null); if (v && v.pcm) HAS.add(i); } draw(); }

  /* ---------------- the bar on the LOG screen ---------------- */
  const dock = $('lgDock'), form = $('lgForm');
  if (dock && form) {
    form.insertAdjacentHTML('beforebegin', `<div class="vkbar" id="vkBar" hidden aria-label="Voice keyer"><div class="vkm" id="vkM"></div>
      <div class="vkc"><button type="button" class="chip" id="vkAuto" title="Play memory 1 again and again, with a listening gap, until someone answers">🔁 AUTO CQ</button><button type="button" class="chip halt" id="vkStop">⏹ STOP</button><button type="button" class="chip" id="vkSet" title="Record, name and test the memories">⏺ RECORD / EDIT</button><span class="hint" id="vkSt"></span><button type="button" class="chip vkfold" id="vkFold" title="Fold the voice keyer away (the 🎙 chip brings it back)">▾ FOLD AWAY</button></div></div>`);
    const chips = dock.querySelector('#dkSet'); if (chips) chips.insertAdjacentHTML('beforebegin', '<button type="button" class="chip" id="dkVk" title="Voice keyer: play your recorded CQ, call, report…">🎙</button>');
  }
  function draw() {
    const bar = $('vkBar'); if (!bar) return; bar.hidden = !S.show; const b = $('dkVk'); if (b) { b.classList.toggle('on', !!S.show); b.textContent = S.show ? '🎙 ▾' : '🎙 KEYER'; b.title = S.show ? 'Fold the voice keyer away' : 'Voice keyer: play your recorded CQ, call, report…'; }
    $('vkM').innerHTML = S.names.map((n, i) => `<button type="button" class="vkb${HAS.has(i) ? '' : ' empty'}${PLAYING === i ? ' on' : ''}" data-vk="${i}" title="${HAS.has(i) ? 'Send ' + esc(n) : 'Not recorded yet: tap to record it'}">${i + 1} ${esc(n)}</button>`).join('');
    $('vkAuto').classList.toggle('on', !!AUTO); $('vkAuto').textContent = AUTO ? '🔁 AUTO CQ · ON' : '🔁 AUTO CQ';
  }
  const say = t => { const e = $('vkSt'); if (e) e.textContent = t || ''; };
  if ($('dkVk')) $('dkVk').onclick = () => { S.show = !S.show; save(); draw(); };
  if ($('vkFold')) $('vkFold').onclick = () => { if (AUTO) autoOff(); S.show = false; save(); draw(); AP.toast('🎙 Voice keyer folded away: the 🎙 KEYER chip brings it back.', 3000); };
  document.addEventListener('click', e => { const b = e.target.closest('[data-vk]'); if (!b) return; const i = +b.dataset.vk; if (!HAS.has(i)) { editSheet(i); return; } if (AUTO) autoOff(); play(i); });
  if ($('vkStop')) $('vkStop').onclick = () => stop('Stopped.');
  if ($('vkAuto')) $('vkAuto').onclick = () => { if (AUTO) autoOff('Auto CQ off.'); else autoOn(); };
  if ($('vkSet')) $('vkSet').onclick = () => editSheet(0);

  /* ---------------- playing out ---------------- */
  let PLAYING = -1, stopFlag = false;
  function whyNot() { if (!AP.running()) return 'Press 🎧 START LISTENING on the DIGI screen (or STATION → Sound) first: the voice goes out through the radio\'s sound card.'; if (!AP.canKey()) return AP.can.why('key'); return ''; }
  const i16toF = (b64) => { const bin = atob(b64), n = bin.length >> 1, o = new Float32Array(n); for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; o[i] = v / 32768; } return o; };
  const fToI16 = f => { let s = ''; for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])) * 32767 | 0, u = v < 0 ? v + 65536 : v; s += String.fromCharCode(u & 255, u >> 8); } return btoa(s); };
  const up48 = f => { const o = new Float32Array(f.length * 3); for (let i = 0; i < f.length; i++) { const a = f[i], b = i + 1 < f.length ? f[i + 1] : a; o[3 * i] = a; o[3 * i + 1] = a + (b - a) / 3; o[3 * i + 2] = a + 2 * (b - a) / 3; } return o; };
  /* Oct 27: 🎙 VOICE LEVEL (STATION → Sound, S.vdb) scales the memory before it goes out — apart from the FT8 TX LEVEL */
  const vlevel = f => { const g = Math.pow(10, (+AP.S.vdb || 0) / 20); if (Math.abs(g - 1) < 0.01) return f; const o = new Float32Array(f.length); for (let i = 0; i < f.length; i++) { const v = f[i] * g; o[i] = v > 1 ? 1 : v < -1 ? -1 : v; } return o; };
  async function play(i, quiet) {
    const w = whyNot(); if (w) { if (!quiet) AP.toast(esc(w), 5000, 'bad'); return false; }
    if (PLAYING >= 0 || AP.txing()) { if (!quiet) AP.toast('Something is already transmitting.', 2500); return false; }
    const m = await get(i); if (!m || !m.pcm) { if (!quiet) AP.toast('Memory ' + (i + 1) + ' is empty: record it first.', 3000); return false; }
    PLAYING = i; stopFlag = false; draw(); say('📡 Sending ' + S.names[i] + '…');
    try { await AP.pttOn(true, { voice: true }); const r = await A.play(vlevel(up48(i16toF(m.pcm))), 0, 'vk'); return !(r && r.state === 'stopped') && !stopFlag; }
    catch (e) { AP.toast('The voice keyer could not send: ' + esc(e.message || e), 5000, 'bad'); return false; }
    finally { await AP.pttOn(false, { voice: true }); PLAYING = -1; draw(); if (!AUTO) say(''); }
  }
  function stop(why) { stopFlag = true; autoOff(); if (PLAYING >= 0) Promise.resolve().then(() => A.stopTx()).catch(() => {}); say(why || ''); }

  /* ---------------- auto CQ ---------------- */
  let AUTO = null;
  async function autoOn() {
    if (!HAS.has(0)) { AP.toast('Record memory 1 (your CQ) first.', 3000); editSheet(0); return; }
    const w = whyNot(); if (w) { AP.toast(esc(w), 5000, 'bad'); return; }
    const me = AUTO = { t0: Date.now() }; draw();
    while (AUTO === me) {
      if (Date.now() - me.t0 > 10 * 60000) { autoOff('Auto CQ stopped after 10 minutes (the rules want a person listening).'); break; }
      const ok = await play(0, true); if (AUTO !== me) break; if (!ok) { autoOff('Auto CQ stopped.'); break; }
      for (let s = +S.gap || 5; s > 0 && AUTO === me; s--) { say('👂 Listening… next CQ in ' + s + ' s (type their call or tap STOP)'); await new Promise(r => setTimeout(r, 1000)); }
    }
  }
  function autoOff(why) { if (!AUTO) return; AUTO = null; draw(); say(why || ''); }
  const ec = $('eCall'); if (ec) ec.addEventListener('input', () => { if (AUTO && ec.value.trim().length >= 3) { autoOff('Auto CQ stopped: you are logging ' + ec.value.trim().toUpperCase() + '.'); } });

  /* ---------------- recording ---------------- */
  let REC = null;
  async function recStart(devId) {
    const st = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: devId ? { exact: devId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const ctx = new (G.AudioContext || G.webkitAudioContext)(), src = ctx.createMediaStreamSource(st), pr = ctx.createScriptProcessor(4096, 1, 1), bufs = [];
    pr.onaudioprocess = e => { bufs.push(new Float32Array(e.inputBuffer.getChannelData(0))); const sec = bufs.length * 4096 / ctx.sampleRate; const t = $('vkRecT'); if (t) t.textContent = '⏺ ' + sec.toFixed(1) + ' s'; if (sec >= MAXS) recStop(); };
    src.connect(pr); pr.connect(ctx.destination);
    REC = { st, ctx, pr, bufs };
  }
  function recStop() {
    if (!REC) return null; const { st, ctx, pr, bufs } = REC; REC = null;
    try { pr.disconnect(); st.getTracks().forEach(t => t.stop()); } catch (e) {}
    const n = bufs.reduce((a, b) => a + b.length, 0), all = new Float32Array(n); let k = 0; for (const b of bufs) { all.set(b, k); k += b.length; }
    const sr = ctx.sampleRate; ctx.close().catch(() => {});
    /* to 16 kHz (averaging), trim the quiet ends, bring the peak up to -1 dB */
    const ratio = sr / RATE, out = new Float32Array(Math.floor(n / ratio));
    for (let i = 0; i < out.length; i++) { const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)); let s = 0; for (let j = a; j < b && j < n; j++) s += all[j]; out[i] = s / (b - a); }
    let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v)); if (pk < 0.003) return { empty: true };
    const th = pk * 0.04; let s0 = 0, s1 = out.length - 1; while (s0 < out.length && Math.abs(out[s0]) < th) s0++; while (s1 > s0 && Math.abs(out[s1]) < th) s1--;
    s0 = Math.max(0, s0 - RATE * 0.08); s1 = Math.min(out.length - 1, s1 + RATE * 0.15);
    const g = 0.89 / pk, f = out.slice(Math.floor(s0), Math.floor(s1) + 1).map(v => v * g);
    return { f, secs: f.length / RATE };
  }
  /* ▶ LISTEN HERE (Brandon Oct 25: 'the listen button to hear it before sending is not working'): it played into a 16 kHz AudioContext on
     Windows' DEFAULT output — on a radio PC that is often the radio's own USB sound card, so the memory went into the radio (unkeyed) and
     nothing came out of the speakers. Now: a normal-rate context, resumed, sent to a speaker that is NOT the radio's sound card
     (setSinkId, PC), and the status line says where and how long. On a phone/tablet Android routes media to a plugged-in USB sound card,
     so it says so and offers the share sheet as the way to hear it. */
  let LCTX = null;
  async function speakerId() {
    try { const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput'); const radio = AP.S.outDev || '';
      const rx = /usb audio codec|usb audio device|ft-|ic-|ts-|yaesu|icom|kenwood|digirig|signalink|codec/i;
      const ok = ds.filter(d => d.deviceId && d.deviceId !== radio && !rx.test(d.label || '') && d.deviceId !== 'communications');
      if (S.spk) { const m = ds.find(d => d.deviceId === S.spk); if (m) return { id: m.deviceId, name: m.label || 'the picked speaker' }; }   /* Oct 26: picked by hand in the sheet */
      const pick = ok.find(d => d.deviceId !== 'default') || ok[0]; return pick ? { id: pick.deviceId, name: pick.label || 'speakers' } : null; } catch (e) { return null; }
  }
  async function listenLocal(f) {
    try {
      if (LCTX) { try { LCTX.close(); } catch (e) {} LCTX = null; }
      const c = LCTX = new (G.AudioContext || G.webkitAudioContext)(); if (c.state === 'suspended') await c.resume();
      let where = 'this device\'s speaker';
      if (c.setSinkId && !AP.native) { const sp = await speakerId(); if (sp) { try { await c.setSinkId(sp.id); where = sp.name; } catch (e) { where = 'Windows\' default output (' + (e.message || e) + ')'; } } else where = 'Windows\' default output (no other speaker found)'; }
      const b = c.createBuffer(1, f.length, RATE); b.copyToChannel(f, 0);
      const s = c.createBufferSource(); s.buffer = b; const g = c.createGain(); g.gain.value = 0.9; s.connect(g); g.connect(c.destination); s.start();
      const secs = (f.length / RATE).toFixed(1); const t = $('vkRecT'); if (t) t.textContent = '▶ playing ' + secs + ' s on ' + where;
      if (AP.native) AP.toast('▶ Playing it here. With the radio\'s USB cable plugged in, Android may send it to the radio instead of the speaker: unplug the cable to hear it, or use 📤 SHARE.', 6000);
      s.onended = () => { if (t) t.textContent = '✓ recorded ' + secs + ' s'; c.close().catch(() => {}); if (LCTX === c) LCTX = null; };
      return true;
    } catch (e) { AP.toast('Could not play it back here: ' + esc(e.message || e), 4000, 'bad'); return false; }
  }
  async function editSheet(i) {
    let mics = []; try { mics = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) {}
    const opts = '<option value="">The phone / PC microphone (default)</option>' + mics.filter(d => d.deviceId && d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}"${S.mic === d.deviceId ? ' selected' : ''}>${esc(d.label || 'Microphone')}</option>`).join('');
    let spk = []; try { spk = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'communications'); } catch (e) {}
    const sopts = '<option value="">By itself (a speaker that is not the radio)</option>' + spk.map(d => `<option value="${esc(d.deviceId)}"${S.spk === d.deviceId ? ' selected' : ''}>${esc(d.deviceId === 'default' ? 'Windows default (' + (d.label || '').replace(/^Default - /, '') + ')' : (d.label || 'Speaker'))}${d.deviceId === AP.S.outDev ? ' = the radio' : ''}</option>`).join('');
    let NEW = null;
    AP.sheet('🎙 Voice keyer memories', `<div class="chips wrap" id="vkPick">${S.names.map((n, k) => `<button type="button" class="chip${k === i ? ' on' : ''}" data-vkp="${k}">${k + 1} ${esc(n)}${HAS.has(k) ? ' ✓' : ''}</button>`).join('')}</div>
      <div class="grid2"><label class="e">NAME ON THE BUTTON<input id="vkName" maxlength="10" value="${esc(S.names[i])}" autocapitalize="characters"></label>
      <label class="e">RECORD WITH<select id="vkMic">${opts}</select></label></div>
      ${AP.native ? '' : `<label class="e wide">▶ LISTEN HERE PLAYS ON<select id="vkSpk">${sopts}</select></label>`}
      <div class="row"><button type="button" class="b gold" id="vkRec">⏺ RECORD</button><button type="button" class="b" id="vkHear" ${HAS.has(i) ? '' : 'disabled'}>▶ LISTEN HERE</button><button type="button" class="b" id="vkTry" ${HAS.has(i) ? '' : 'disabled'}>📡 SEND IT ON THE AIR</button><button type="button" class="b" id="vkDel" ${HAS.has(i) ? '' : 'disabled'}>✕ ERASE</button></div>
      <p class="hint"><b id="vkRecT">${HAS.has(i) ? '✓ recorded' : 'not recorded yet'}</b> · up to ${MAXS} s. Say it the way you would on the air, e.g. “CQ POTA, CQ POTA, this is K… from US-…, calling CQ and listening”. The app trims the quiet ends and evens the level.</p>
      <label class="e">LISTENING GAP FOR AUTO CQ (seconds)<input id="vkGap" inputmode="numeric" maxlength="2" value="${S.gap}"></label>
      <p class="hint">Pick the microphone in your hand, not the radio's USB sound card. Set the TX LEVEL (STATION → Sound) so the radio's ALC barely moves.</p>`,
      () => { const nm = $('vkName') && $('vkName').value.trim().toUpperCase(); if (nm) S.names[i] = nm.slice(0, 10); S.mic = $('vkMic') ? $('vkMic').value : S.mic; if ($('vkSpk')) S.spk = $('vkSpk').value; S.gap = Math.max(2, Math.min(30, +($('vkGap') || {}).value || 5)); save(); draw(); if (REC) recStop(); });
    $('vkPick').onclick = e => { const b = e.target.closest('[data-vkp]'); if (b) { if (REC) recStop(); AP.shut(); setTimeout(() => editSheet(+b.dataset.vkp), 30); } };
    $('vkRec').onclick = async () => {
      if (REC) { const r = recStop(); $('vkRec').textContent = '⏺ RECORD AGAIN'; if (!r || r.empty) { $('vkRecT').textContent = '⚠ Nothing heard: check the microphone.'; return; }
        NEW = r.f; await put(i, { pcm: fToI16(r.f), secs: r.secs, t: Date.now() }); HAS.add(i); draw(); $('vkRecT').textContent = '✓ recorded ' + r.secs.toFixed(1) + ' s'; ['vkHear', 'vkTry', 'vkDel'].forEach(id => { $(id).disabled = false; }); return; }
      try { await recStart($('vkMic').value || ''); $('vkRec').textContent = '⏹ STOP RECORDING'; $('vkRecT').textContent = '⏺ 0.0 s'; }
      catch (e) { AP.toast('The microphone did not open: ' + esc(e.message || e) + (AP.native ? ' (Android Settings → Apps → KPC → Permissions → Microphone)' : ''), 7000, 'bad'); }
    };
    if ($('vkSpk')) $('vkSpk').onchange = () => { S.spk = $('vkSpk').value; save(); };
    $('vkHear').onclick = async () => { const m = NEW ? { f: NEW } : await get(i); if (m) listenLocal(m.f || i16toF(m.pcm)); };
    $('vkTry').onclick = () => { AP.shut(); play(i); };
    $('vkDel').onclick = async () => { await put(i, null); HAS.delete(i); draw(); AP.shut(); };
  }

  G.KPCVoice = { S, play, stop, autoOn, autoOff, names: () => S.names.map((n, i) => ({ i, n, has: HAS.has(i) })), playing: () => PLAYING, auto: () => !!AUTO,
    _put: (i, f) => put(i, { pcm: fToI16(f), secs: f.length / RATE, t: Date.now() }).then(() => { HAS.add(i); draw(); }) };
  load().catch(() => draw());
})(window);
