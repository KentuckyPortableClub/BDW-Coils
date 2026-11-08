/* KPC app: the 📻 RADIO tab (Opus, Oct 27; Brandon: 'a screen dedicated to changing the radio frequency and all the stuff available
   to change through cat … basically work SSB from the app when in cat and never have to touch the radio'; 'radio interface also desktop
   and power options on off for both'). The radio THIS device controls over CAT (the PC, or a tablet plugged into the radio).
   A phone on the remote link has the same controls on its REMOTE tab (that radio is the PC's), so this tab hides itself there.
   Big VFO (wheel / arrows / − + / tap to type), band + mode buttons (DATA-L too), filter width, NB / NR / NOTCH, RF power, mic gain,
   the meters (analog or digital) + 🔧 TUNE (the radio's antenna tuner), ⏻ RADIO ON / OFF, 🎙 HOLD TO TALK through this computer's
   microphone, and the voice keyer's memories. Set-only controls remember what was asked last (localStorage kpcRmEx, the same memory the
   PC uses for the phone's panel). Nothing here when the radio is not connected: a CONNECT card instead. */
(function (G) {
  'use strict';
  const AP = G.KPCApp, $ = id => document.getElementById(id); if (!AP || !G.KPCCat) return;
  const esc = AP.esc, K = G.KPCCat;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const EX = Object.assign({ width: 2400, notch: 0, nb: 0, nr: 0, power: 100, mic: 50 }, LS('kpcRmEx', {}));
  const saveEx = () => SV('kpcRmEx', EX);
  const S = Object.assign({ step: 1000 }, LS('kpcAppRadio', {}));
  const save = () => SV('kpcAppRadio', S);
  const BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m'];
  const MODES = [['LSB', 'LSB'], ['USB', 'USB'], ['CW', 'CW'], ['AM', 'AM'], ['FM', 'FM'], ['DATA', 'DATA-U'], ['DATAL', 'DATA-L']];
  const WID = { ssb: [1800, 2100, 2400, 2700, 3000], cw: [100, 200, 300, 500, 800, 1200], am: [3000, 6000, 9000] };
  const STEPS = [10, 100, 500, 1000, 5000, 10000];
  let RIG = { khz: 0, mode: '' }, busy = false, SPOTS = null;

  /* the screen + its tab */
  const main = document.querySelector('main');
  if (main && !$('scrRadio')) main.insertAdjacentHTML('beforeend', `<section class="scr" id="scrRadio" aria-label="The radio">
    <div class="rdoff" id="rdOff"><h2>📻 The radio</h2><p>Connect the radio (CAT) to run it from here: frequency, band, mode, filter, noise blanker / reduction, power, mic gain, meters, the tuner, power on / off, and talk through this computer.</p>
      <div class="row"><button type="button" class="b gold" id="rdConn">📻 CONNECT THE RADIO</button><button type="button" class="b" id="rdSet">⚙ RADIO SETTINGS</button></div><p class="hint" id="rdOffT"></p></div>
    <div class="rdon" id="rdOn" hidden>
      <div class="rdtop">
        <div class="rdvfo"><button type="button" class="ic big" id="rdDn" aria-label="Down one step">−</button>
          <button type="button" class="rdkhz" id="rdKhz" title="Tap to type a frequency · mouse wheel or ↑ ↓ to tune"><b id="rdMhz">—</b><small id="rdHz"></small><i id="rdMode"></i></button>
          <button type="button" class="ic big" id="rdUp" aria-label="Up one step">+</button></div>
        <div class="chips rdsteps" id="rdSteps"></div>
        <div class="chips rdbands" id="rdBands"></div>
        <div class="chips rdmodes" id="rdModes"></div>
        <div class="chips spstrip" id="rdSpots" hidden aria-label="Spots on this band"></div>
      </div>
      <div class="rdgrid">
        <div class="card rdctl"><h2>Receive &amp; transmit</h2>
          <div class="grid2"><label class="e" id="rdWidthW">FILTER WIDTH<select id="rdWidth"></select></label>
            <label class="e slide" id="rdPowerW">RF POWER <b id="rdPowerT"></b><input type="range" id="rdPower" min="5" max="100" step="5"></label>
            <label class="e slide" id="rdMicW">MIC GAIN <b id="rdMicT"></b><input type="range" id="rdMic" min="0" max="100" step="5"></label></div>
          <div class="btns"><button type="button" class="b" data-rx="nb">NB</button><button type="button" class="b" data-rx="nr">NR</button><button type="button" class="b" data-rx="notch">NOTCH</button></div>
          <p class="hint" id="rdNoEx"></p></div>
        <div class="card rdmet"><h2>Meters</h2><div id="rdMet"></div></div>
      </div>
      <div class="rdbig"><button type="button" class="b rdtune" id="rdTune">🔧 TUNE (antenna tuner)</button><button type="button" class="b" id="rdPwrOn">⏻ RADIO ON</button><button type="button" class="b" id="rdPwrOff">⏻ RADIO OFF</button></div>
      <div class="strip rdvk" id="rdVk" aria-label="Voice keyer"></div>
      <div class="rdlv" id="rdLv"></div>
      <button type="button" class="talk" id="rdTalk">🎙 HOLD TO TALK <small>(this computer's microphone)</small></button>
      <div class="strip" id="rdVoice" aria-label="Voice shaping"><span class="kv"><i>VOICE</i></span><button type="button" class="chip" data-rvoice="natural" title="Your voice as it is">NATURAL</button><button type="button" class="chip" data-rvoice="punch" title="A little brighter and tighter">PUNCH</button><button type="button" class="chip" data-rvoice="contest" title="Bright and compressed, like a contest mic: cuts through a pile-up">CONTEST</button></div>
      <p class="hint" id="rdTalkH">Voice from this computer goes to the radio's USB sound card: the radio's SSB MOD SOURCE must be REAR (or STATION → Radio control → VOICE FROM THIS DEVICE = DATA). Keyboard: hold <b>Space</b> on this screen to talk.</p>
    </div>
  </section>`);
  const tabs = document.querySelector('.tabs');
  if (tabs && !tabs.querySelector('[data-go="radio"]')) { const sp = tabs.querySelector('[data-go="spots"]'); sp.insertAdjacentHTML('afterend', '<button type="button" data-go="radio"><i>📻</i><span>RADIO</span></button>'); tabs.querySelector('[data-go="radio"]').onclick = () => AP.go('radio'); }

  const onLink = () => !!(G.KPCRemote && !KPCRemote.base && KPCRemote.link && KPCRemote.link().on);
  function tabVis() { const t = tabs && tabs.querySelector('[data-go="radio"]'); if (t) t.hidden = onLink(); }
  const mhzTxt = k => { if (!(k > 0)) return ['—', '']; const hz = Math.round(k * 1000), s = String(hz).padStart(7, '0'); const m = Math.floor(hz / 1e6), r = String(hz % 1e6).padStart(6, '0'); return [m + '.' + r.slice(0, 3), '.' + r.slice(3, 5)]; };
  const kindOf = m => /CW/.test(m) ? 'cw' : /AM/.test(m) ? 'am' : 'ssb';
  function draw() {
    if (document.body.dataset.screen !== 'radio') return;
    tabVis();
    const on = K.connected(); $('rdOff').hidden = on; $('rdOn').hidden = !on;
    if (!on) { const st = (AP.catMsg && AP.catMsg()) || {}; $('rdOffT').textContent = st.t || ''; return; }
    const [a, b] = mhzTxt(RIG.khz); $('rdMhz').textContent = a; $('rdHz').textContent = b; $('rdMode').textContent = RIG.mode === 'DATAL' ? 'DATA-L' : RIG.mode === 'DATA' ? 'DATA-U' : RIG.mode || '';
    const band = (G.KPCLog && KPCLog.band(RIG.khz)) || '';
    $('rdSteps').innerHTML = STEPS.map(s => `<button type="button" class="chip${S.step === s ? ' on' : ''}" data-rstep="${s}">${s >= 1000 ? s / 1000 + ' kHz' : s + ' Hz'}</button>`).join('');
    const bc = G.KPCSpots && KPCSpots.bandCounts ? KPCSpots.bandCounts() : {};
    $('rdBands').innerHTML = BANDS.map(x => `<button type="button" class="chip${x === band ? ' on' : ''}" data-rband="${x}">${x}${bc[x] ? '<small class="bn">' + bc[x] + '</small>' : ''}</button>`).join('');
    if (G.KPCSpots && KPCSpots.strip) { if (!SPOTS) SPOTS = KPCSpots.strip($('rdSpots'), { band: () => (G.KPCLog && KPCLog.band(RIG.khz)) || '', max: 16, tap: s => { tuneTo(s.khz, s.mode === 'FT8' || s.mode === 'FT4' ? 'DATA' : /^(SSB|USB|LSB)$/.test(s.mode) ? (s.khz < 10000 && !(s.khz >= 5300 && s.khz <= 5410) ? 'LSB' : 'USB') : s.mode || ''); if (G.KPCLog && KPCLog.prefill) KPCLog.prefill({ call: s.call, refs: s.refs, mode: s.mode, khz: s.khz, g: s.grid, st: s.st }); AP.toast('📻 ' + s.call + ' · ' + (s.khz / 1000).toFixed(4).replace(/0$/, '') + ' ' + (s.mode || '') + ' — the log line is filled in.', 3000); } }); else SPOTS.update(); }
    $('rdModes').innerHTML = MODES.map(([k, l]) => `<button type="button" class="chip mode${RIG.mode === k ? ' on' : ''}" data-rmode="${k}">${l}</button>`).join('');
    const ex = K.extras ? K.extras() : [], kd = kindOf(RIG.mode), wl = WID[kd];
    $('rdWidthW').hidden = !ex.includes('width'); $('rdPowerW').hidden = !ex.includes('power'); $('rdMicW').hidden = !ex.includes('mic');
    const wsel = $('rdWidth'); if (document.activeElement !== wsel) { const cur = wl.reduce((p, c) => Math.abs(c - EX.width) < Math.abs(p - EX.width) ? c : p, wl[0]); wsel.innerHTML = wl.map(w => `<option value="${w}"${w === cur ? ' selected' : ''}>${w >= 1000 ? (w / 1000).toFixed(1) + ' kHz' : w + ' Hz'}</option>`).join(''); }
    const pw = $('rdPower'); if (document.activeElement !== pw) { const m = G.KPCMeters && KPCMeters.last && KPCMeters.last(); pw.value = (m && m.pwr != null) ? m.pwr : EX.power; $('rdPowerT').textContent = pw.value + ' %'; }
    const mc = $('rdMic'); if (document.activeElement !== mc) { mc.value = EX.mic; $('rdMicT').textContent = mc.value; }
    document.querySelectorAll('[data-rx]').forEach(x => { const n = x.dataset.rx; x.hidden = !ex.includes(n); x.classList.toggle('on', !!EX[n]); x.textContent = n.toUpperCase() + (EX[n] ? ' ON' : ' OFF'); });
    $('rdNoEx').textContent = ex.length ? '' : 'This radio family takes only frequency and mode over CAT.';
    $('rdTune').hidden = !ex.includes('atu');
    if ($('rdLv') && !$('rdLv').innerHTML) $('rdLv').innerHTML = (AP.lvHtml ? AP.lvHtml('vc') : '') + '<div class="row"><button type="button" class="b" data-mon>🔊 HEAR HERE</button></div>' + (AP.lvHtml ? AP.lvHtml('mon') : '');
    const vk = G.KPCVoice ? KPCVoice.names().filter(x => x.has) : [];
    $('rdVk').innerHTML = vk.length ? '<span class="kv"><i>VOICE KEYER</i></span>' + vk.map(x => `<button type="button" class="chip${KPCVoice.playing() === x.i ? ' on' : ''}" data-rvk="${x.i}">${x.i + 1} ${esc(x.n)}</button>`).join('') + '<button type="button" class="chip halt" data-rvk="stop">⏹ STOP</button>' : '';
    $('rdVk').hidden = !vk.length;
  }
  /* moving the radio */
  async function tuneTo(khz, mode) {
    if (!(khz > 100) || busy) return; if (AP.txing()) { AP.toast('Transmitting: wait for it to end.', 2500, 'bad'); return; }
    busy = true; RIG.khz = khz; if (mode) RIG.mode = mode; draw();
    try { const ok = await K.tune(khz, mode || RIG.mode || ''); if (!ok) AP.toast('The radio did not take ' + (khz / 1000).toFixed(3) + ' MHz.', 3000, 'bad');
      const r = await K.read(); if (r && r.khz) { RIG = { khz: r.khz, mode: r.mode || RIG.mode }; AP.fire('dial', r); } }
    finally { busy = false; draw(); }
  }
  let pend = 0, pendT = 0;   /* wheel / arrows / − +: steps add up, the radio gets one command per 120 ms */
  function nudge(n) { if (!RIG.khz) return; pend += n; RIG.khz = Math.round((RIG.khz + n * S.step / 1000) * 1000) / 1000; draw(); clearTimeout(pendT); pendT = setTimeout(() => { pend = 0; tuneTo(RIG.khz, RIG.mode); }, 120); }
  document.addEventListener('click', e => {
    const st = e.target.closest('[data-rstep]'); if (st) { S.step = +st.dataset.rstep; save(); draw(); return; }
    const bd = e.target.closest('[data-rband]'); if (bd && G.KPCRigX && KPCRigX.bandMem(bd.dataset.rband)) { const mm = KPCRigX.bandMem(bd.dataset.rband);   /* Nov 6: 📍 band memory (kpc-rigx.js) */
      tuneTo(mm.khz, mm.mode).then(() => { if (mm.w && K.extras && K.extras().includes('width') && mm.w !== EX.width) { EX.width = mm.w; saveEx(); K.extra('width', mm.w); draw(); } }); return; }
    if (bd) { const b = bd.dataset.rband, m = RIG.mode || 'SSB', k = G.KPCLog && KPCLog.bandKhz ? KPCLog.bandKhz(b, /DATA/.test(m) ? 'FT8' : m) : 0; const mm = /^(LSB|USB)$/.test(m) ? (k < 10000 && !(k >= 5300 && k <= 5410) ? 'LSB' : 'USB') : m; if (k) tuneTo(k, mm); return; }
    const md = e.target.closest('[data-rmode]'); if (md) { tuneTo(RIG.khz, md.dataset.rmode); return; }
    const rx = e.target.closest('[data-rx]'); if (rx) { const n = rx.dataset.rx; EX[n] = EX[n] ? 0 : 1; saveEx(); draw(); K.extra(n, EX[n]).then(ok => { if (!ok) AP.toast('This radio does not take ' + n.toUpperCase() + ' over CAT.', 3000, 'bad'); }); return; }
    const vk = e.target.closest('[data-rvk]'); if (vk) { if (vk.dataset.rvk === 'stop') KPCVoice.stop('Stopped.'); else KPCVoice.play(+vk.dataset.rvk); setTimeout(draw, 200); return; }
  });
  $('rdUp').onclick = () => nudge(1); $('rdDn').onclick = () => nudge(-1);
  $('rdKhz').addEventListener('wheel', e => { e.preventDefault(); nudge(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  $('rdKhz').onclick = () => { AP.sheet('📻 Frequency', `<label class="e wide">FREQUENCY (MHz or kHz)<input id="rdK" inputmode="decimal" value="${RIG.khz ? (RIG.khz / 1000).toFixed(4) : ''}"></label><div class="row"><button type="button" class="b gold" id="rdKGo">GO</button></div>`);
    const go = () => { let v = parseFloat($('rdK').value); if (!isFinite(v)) return; if (v < 1000) v *= 1000; AP.shut(); tuneTo(Math.round(v * 1000) / 1000, ''); }; $('rdKGo').onclick = go; $('rdK').addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); setTimeout(() => $('rdK').select(), 50); };
  $('rdWidth').onchange = () => { EX.width = +$('rdWidth').value; saveEx(); K.extra('width', EX.width).then(ok => { if (!ok) AP.toast('The radio did not take the filter width.', 3000, 'bad'); }); };
  [['rdPower', 'power', ' %'], ['rdMic', 'mic', '']].forEach(([id, n, u]) => { const r = $(id); r.oninput = () => { $(id + 'T').textContent = r.value + u; }; r.onchange = () => { EX[n] = +r.value; saveEx(); K.extra(n, EX[n]).then(ok => { if (!ok) AP.toast('The radio did not take ' + n + '.', 3000, 'bad'); }); }; });
  $('rdTune').onclick = async () => { if (AP.txing()) return; if (G.KPCRigX) { KPCRigX.tuneAsk(); return; }   /* Nov 6: asks first, then reports the SWR */ const ok = await K.extra('atu', 1); AP.toast(ok ? '🔧 The radio\'s tuner is tuning: watch the SWR.' : 'The radio did not take the tune command.', 3500, ok ? 'log' : 'bad'); };
  $('rdPwrOn').onclick = async () => { const ok = K.power ? await K.power(true) : false; AP.toast(ok ? '⏻ Radio ON sent: connecting again in a few seconds.' : 'The radio did not take RADIO ON.', 4000, ok ? 'log' : 'bad'); if (ok) setTimeout(() => K.connect(false).then(() => { AP.keyCheck(); draw(); }), 4000); };
  $('rdPwrOff').onclick = () => { AP.sheet('⏻ Turn the radio OFF?', '<p>The radio switches off. RADIO ON can wake it again over the same cable (most Yaesu / Kenwood / Icom radios; some need their USB powered).</p><div class="row"><button type="button" class="b halt" id="rdOffGo">⏻ YES, TURN IT OFF</button></div>');
    $('rdOffGo').onclick = async () => { AP.shut(); if (AP.txing()) return; const ok = K.power ? await K.power(false) : false; AP.toast(ok ? '⏻ Radio OFF sent.' : 'The radio did not take RADIO OFF.', 3500, ok ? 'log' : 'bad'); }; };
  $('rdConn').onclick = () => { const b = $('stConn'); if (b && $('stRig') && $('stRig').value) b.click(); else { AP.go('station'); const c = $('stRig'); if (c) c.scrollIntoView({ block: 'center' }); AP.toast('Pick your radio in MY RADIO, then CONNECT RADIO.', 4000); } setTimeout(draw, 2500); setTimeout(draw, 6000); };
  $('rdSet').onclick = () => { AP.go('station'); const c = $('stRig'); if (c) c.scrollIntoView({ block: 'center' }); };

  /* 🎙 HOLD TO TALK through this computer's microphone (the voice keyer's mic choice); voice PTT = kpc-app pttOn(…, {voice}) */
  let TALK = null;
  async function talkDown() {
    if (TALK) return; const cls = AP.S.cls || 'E';
    if (!AP.canKey()) { AP.toast('Nothing can key the radio yet: connect it (CAT) or pick VOX.', 4000, 'bad'); return; }
    if (AP.txing()) { AP.toast('Already transmitting.', 2500, 'bad'); return; }
    if (RIG.khz && /^(LSB|USB|AM|FM|DATA|DATAL)$/.test(RIG.mode || '') && !AP.bandPlan.allowed(RIG.khz, cls, 'SSB')) { AP.toast('🎙 Voice is not allowed on ' + (RIG.khz / 1000).toFixed(3) + (AP.S.cls ? ' for your licence' : '') + ': move to the phone part of the band.', 5000, 'bad'); return; }
    if (/CW/.test(RIG.mode || '')) { AP.toast('The radio is in CW: pick LSB / USB first.', 3000, 'bad'); return; }
    if (AP.native) { AP.toast('🎙 On a phone at the radio, talk into the radio\'s own microphone.', 4000); return; }
    if (!AP.running() && !(await AP.start())) return;
    /* Nov 8 (Brandon: 'key is little delayed'): key the radio AT ONCE, while the microphone opens (and the mic stays warm for a
       minute after you let go, so the next press does not wait for Windows to open it again) */
    TALK = { t0: Date.now() }; $('rdTalk').classList.add('on');
    const T0 = TALK; T0.key = AP.pttOn(true, { voice: true });
    try {
      const mic = (G.KPCVoice && KPCVoice.S && KPCVoice.S.mic) || '';
      clearTimeout(WARM.t);
      let st = WARM.st && WARM.dev === mic && WARM.st.getAudioTracks().some(t => t.readyState === 'live') ? WARM.st : null;
      if (!st) { if (WARM.st) WARM.st.getTracks().forEach(t => t.stop()); st = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: mic ? { exact: mic } : undefined, echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); WARM.st = st; WARM.dev = mic; }
      if (TALK !== T0) { coolMic(); return; }
      TALK.st = st; TALK.p = AP.audio.pipe(st, AP.S.voice || 'natural'); if (!TALK.p) throw new Error('the sound is not running');
      if (TALK.p.level) TALK.p.level(+AP.S.vdb || 0);
      const keyed = await T0.key; if (TALK !== T0) return; if (!keyed) throw new Error('the radio did not key'); TALK.p.gate(true);
      TALK.lim = setTimeout(() => { talkUp(); AP.toast('🎙 Talk limit: PTT let go.', 3000); }, Math.max(30, +AP.S.rmTalk || 180) * 1000);
    } catch (e) { AP.toast('🎙 The microphone did not open: ' + esc(e.message || e) + '. Pick it in the voice keyer (🎙 KEYER → RECORD / EDIT → RECORD WITH).', 6000, 'bad'); talkUp(); }
  }
  async function talkUp() { const t = TALK; if (!t) return; TALK = null; clearTimeout(t.lim); $('rdTalk').classList.remove('on');
    try { if (t.p) { t.p.gate(false); t.p.stop(); } } catch (e) {} coolMic(); if (t.key) { await t.key; await AP.pttOn(false, { voice: true }); } }
  const WARM = { st: null, dev: '', t: 0 };
  function coolMic() { clearTimeout(WARM.t); WARM.t = setTimeout(() => { if (WARM.st && !TALK) { WARM.st.getTracks().forEach(x => x.stop()); WARM.st = null; } }, 60000); }
  /* Nov 8 (Brandon: 'is the contest voice changer still in the app desktop and remote?'): the same NATURAL / PUNCH / CONTEST as the
     phone's REMOTE screen, here for the PC's own HOLD TO TALK. One saved choice (AP.S.voice) for both; changing it while talking re-shapes at once. */
  const vPaint = () => document.querySelectorAll('[data-rvoice]').forEach(b => b.classList.toggle('on', b.dataset.rvoice === (AP.S.voice || 'natural')));
  document.querySelectorAll('[data-rvoice]').forEach(b => { b.onclick = () => { AP.S.voice = b.dataset.rvoice; AP.save(); vPaint(); try { if (TALK && TALK.p && TALK.p.shape) TALK.p.shape(AP.S.voice); } catch (e) {} AP.fire('voice', AP.S.voice); AP.toast('🎙 Voice: ' + b.textContent, 1500, 'log'); }; });
  vPaint(); AP.on('voice', vPaint);
  const tb = $('rdTalk');
  tb.addEventListener('pointerdown', e => { e.preventDefault(); try { tb.setPointerCapture(e.pointerId); } catch (x) {} talkDown(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => tb.addEventListener(n, () => talkUp())); tb.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', e => { if (document.body.dataset.screen !== 'radio' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '') || !$('sheet').hidden) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) talkDown(); } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); nudge(1); } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); } });
  addEventListener('keyup', e => { if (e.code === 'Space' && TALK) talkUp(); });
  G.addEventListener('blur', () => talkUp());

  /* the meters (the same widget as the LOG / DIGI bars, with the tuner) */
  let MW = null;
  function meters() { if (MW || !G.KPCMeters || !$('rdMet')) return; MW = KPCMeters.mount($('rdMet'), { tune: { ok: () => K.connected() && K.extras && K.extras().includes('atu'), go: () => $('rdTune').click() } }); }

  AP.on('dial', r => { if (r && r.khz && !busy && !pend) { RIG = { khz: r.khz, mode: r.mode || RIG.mode }; draw(); } });
  AP.on('screen', s => { tabVis(); if (s !== 'radio') { talkUp(); return; } meters(); if (K.connected() && !AP.txing()) K.read().then(r => { if (r && r.khz) { RIG = { khz: r.khz, mode: r.mode || '' }; AP.fire('dial', r); } draw(); }); draw(); });
  AP.on('key', () => draw());
  setInterval(() => { tabVis(); if (document.body.dataset.screen === 'radio') draw(); }, 3000);
  G.KPCRadio = { draw, tuneTo, nudge, rig: () => Object.assign({}, RIG), _talkDown: talkDown, _talkUp: talkUp, talking: () => !!TALK, S };
})(window);
