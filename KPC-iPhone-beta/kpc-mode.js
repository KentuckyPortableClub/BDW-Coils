/* KPC app: THE MODE FRAME (Fable, Oct 22). Every digital mode is one object with the same shape, so a new mode
   (CW, RTTY, PSK31, SSTV, WSPR, HELL, JS8, APRS…) plugs in here and gets the chip, the settings button, the sound,
   the remote link and the spot feed for free:
     KPCModes.add({
       id: 'APRS', label: 'APRS', panel: '#aprsPanel',   // the panel shown on the FT8/digital screen while this mode is active
       bands: ['2m','30m'], band(), setBand(b),           // its band list and the one it is on (the remote shows them)
       rx(c),                                             // sound in: {pcm: Float32Array 12 kHz, t, db} while the mode is active and sound runs
       run(on),                                           // sound started / stopped
       activate(), deactivate(),                          // became / stopped being the active mode
       settings(),                                        // opens its own settings sheet (the ⚙ chip)
       lines(),                                           // [{id,t,text,cls}] what it heard, for the remote tab and the lists
       ops: { cq: () => {}, halt: () => {} },             // what the remote may ask it to do: {op} messages land here
       buttons: [{op:'cq', label:'📣 CQ'}],               // what the remote tab shows for it
       enabled(), txing(), halt(why), state()             // is TX armed, is it sending now, stop everything, extra state for the remote
     });
   Sound: only the ACTIVE mode gets samples (one decoder at a time: phone battery, and the radio is on one band anyway).
   Rule (Brandon Oct 21): a mode whose buttons cannot work hides or dims them itself, with one line saying what to turn on. */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const AP = G.KPCApp, esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const M = [], byId = {};
  let ACT = null, RUN = false;
  const noop = () => {};
  const DEF = { bands: [], band: () => '', setBand: () => false, rx: noop, run: noop, activate: noop, deactivate: noop, settings: null, lines: () => [], ops: {}, buttons: [], enabled: () => false, txing: () => false, halt: noop, state: () => ({}), khz: () => 0, tune: null };

  function add(m) {
    m = Object.assign({}, DEF, m);
    if (!m.id || byId[m.id]) return byId[m.id];
    M.push(m); byId[m.id] = m; m.el = typeof m.panel === 'string' ? document.querySelector(m.panel) : m.panel;
    strip();
    const want = LS('kpcMode', 'FT8');
    if (!ACT && (m.id === want || M.length === 1)) use(m.id, true);
    return m;
  }
  function strip() {
    const el = $('modeChips'); if (!el) return;
    el.innerHTML = M.map(m => `<button type="button" class="chip mode${ACT === m ? ' on' : ''}" data-mode="${esc(m.id)}" title="${esc(m.title || m.label || m.id)}">${esc(m.label || m.id)}</button>`).join('');
    el.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => use(b.dataset.mode); });
    const set = $('dgSet'); if (set) { set.hidden = !(ACT && ACT.settings); $('dgSetM').textContent = ACT ? ACT.id : ''; }
  }
  function use(id, quiet) {
    const m = byId[id]; if (!m) return false;
    if (ACT === m) return true;
    const old = ACT;
    if (old) { try { old.deactivate(); } catch (e) { console.error(e); } if (old.el) old.el.hidden = true; }
    ACT = m; SV('kpcMode', id);
    if (m.el) m.el.hidden = false;
    try { m.activate(old ? old.id : ''); } catch (e) { console.error(e); }
    strip(); AP.fire('mode', m.id);
    if (!quiet && m.hello) AP.toast(m.hello, 3000);
    return true;
  }
  AP.on('rx', c => { if (ACT && RUN) ACT.rx(c); });
  AP.on('run', on => { RUN = on; M.forEach(m => { try { m.run(on, m === ACT); } catch (e) { console.error(e); } }); });
  const set = $('dgSet'); if (set) set.onclick = () => { if (ACT && ACT.settings) ACT.settings(); };
  /* the remote link asks by name */
  function op(name, a) {
    if (!ACT) return false;
    if (name === 'mode') return use(a && a.mode);
    if (name === 'band') return ACT.setBand(a && a.band);
    const f = ACT.ops[name]; if (!f) return false; f(a || {}); return true;
  }
  const state = () => ACT ? { mode: ACT.id, modes: M.map(m => m.id), bands: ACT.bands, band: ACT.band(), khz: ACT.khz(), enabled: !!ACT.enabled(), txing: !!ACT.txing(), buttons: ACT.buttons, extra: ACT.state() } : { mode: '', modes: [], bands: [], band: '', khz: 0, enabled: false, txing: false, buttons: [], extra: {} };

  /* ================= Oct 26 (Opus, Brandon's 0.7.2 test) =================
     (1) 'radio is not on this mode's dial' bar: a spot tune (or the knob) can leave the radio on 7.1915 LSB while WSPR waits on 14.0956
         ('not hearing wspr'); FT8 / FT4 / WSPR need the exact dial, the other modes the same band. One tap = TUNE IT.
     (2) ❓ a help sheet per mode (Brandon: 'a help ? here and there for rtty, hell, sstv …').
     (3) [Nov 1, Brandon: 'the hold to talk button is still on digi modes': the chip is gone from the digital screens; it lives on the RADIO tab] 🎤 HOLD TO TALK on every digital screen (PC: the microphone picked in the voice keyer goes to the radio through the TX LEVEL,
         PTT while held, the talk limit lets go); only where the band plan allows voice (never on 14.074). */
  const strip0 = $('modeStrip');
  if (strip0 && !$('dgHelp')) {
    $('dgSet').insertAdjacentHTML('afterend', '<button type="button" class="chip" id="dgHelp" title="How this mode works and how to set the radio">❓ HELP</button>');
    strip0.insertAdjacentHTML('afterend', '<div class="st dialw" id="dialW" hidden role="alert"><span id="dialWT"></span><button type="button" class="b gold sm" id="dialWGo">📻 TUNE IT</button></div>');
  }
  let DIAL = null;
  const bandOf = k => (G.KPCLog && KPCLog.band ? KPCLog.band(k) : '') || '';
  const exact = { FT8: 1, FT4: 1, WSPR: 0.3 };
  function dialCheck() {
    const w = $('dialW'); if (!w) return;
    const m = ACT, r = DIAL, on = m && r && r.khz && AP.catConnected && AP.catConnected() && document.body.dataset.screen === 'digi' && !(m.txing && m.txing());
    let bad = '';
    if (on) { const want = +m.khz() || 0; if (want > 100) { const tol = exact[m.id]; if (tol != null ? Math.abs(r.khz - want) > tol : bandOf(r.khz) !== bandOf(want))
      bad = `📻 The radio is on <b>${(r.khz / 1000).toFixed(4)} ${AP.esc(r.mode || '')}</b>, not ${AP.esc(m.id)}'s <b>${(want / 1000).toFixed(4)}</b> (${AP.esc(m.band() || bandOf(want))}): ${AP.esc(m.id)} will not hear anything there.`; } }
    w.hidden = !bad; if (bad) $('dialWT').innerHTML = bad;
  }
  if ($('dialWGo')) $('dialWGo').onclick = async () => { if (!ACT) return; const b = ACT.band(); const ok = await ACT.setBand(b); if (ok === false) AP.toast('The radio did not take it: set ' + (ACT.khz() / 1000).toFixed(4) + ' by hand.', 4000, 'bad');
    setTimeout(async () => { try { const r = await KPCCat.read(); if (r) AP.fire('dial', r); } catch (e) {} }, 900); };
  AP.on('dial', r => { DIAL = r; dialCheck(); }); AP.on('mode', () => setTimeout(dialCheck, 50)); AP.on('screen', () => setTimeout(dialCheck, 50));

  const HELP = {
    FT8: ['FT8', 'Weak-signal data in 15-second turns. The computer does the talking: you pick who to call.', ['Radio: USB-DATA (DATA-U) on the dial shown (20 m = 14.074). The app sets it with CAT.', 'Keep RX LEVEL in the green and the radio\'s ALC barely moving (TX LEVEL in STATION → Sound).', 'Tap a line in the decode list = call that station: the six TX messages fill in and the app answers on its own (Auto).', 'RX = where you listen, TX = where you send (type a number or tap / hold the waterfall). ↔ zooms the waterfall to find a clear spot.', 'Your clock must be within a second: ⏱ CALIBRATE in STATION → Alerts & help.']],
    FT4: ['FT4', 'Like FT8 but 7.5-second turns: faster, a little less sensitive. Contests and busy bands.', ['Radio: USB-DATA on the FT4 dial (20 m = 14.080).', 'Same screen and buttons as FT8; tap a decode to call.']],
    APRS: ['APRS', 'Short position and message packets. On 2 m (144.390 FM) digipeaters and iGates pass them on to aprs.fi.', ['Radio: FM on 144.390 (2 m) at 1200 baud, or USB on 10.1476 (30 m) at 300 baud.', '📡 BEACON sends your position (GPS on a phone, your grid on a PC) with your park in the comment.', 'A KISS TNC (USB or Bluetooth) can do the sound instead: ⚙ APRS → modem.', 'Practice calls (K4TEST) never transmit.']],
    CW: ['CW (Morse)', 'The app copies CW from the waterfall and can send it from the keyboard, the F1–F6 memories, or by hand.', ['Radio: CW mode on the dial (20 m = 14.060). Tap the waterfall on the signal to copy it.', 'SEND WITH (⚙ CW): the DTR key line (a Yaesu with two USB ports keys on the second, "Standard", port; menu USB KEYING (CW) = DTR, BK-IN ON), a tone through the sound card (the app puts the radio in DATA while sending), or the radio\'s own keyer.', '✋ TAP TO KEY = a straight key; • DIT / — DAH = paddles (iambic). On a PC: [ and ] or Z and X, Space = straight key, a mouse: left = dit, right = dah.', 'WPM, the tone and the copy filter are in ⚙ CW.']],
    RTTY: ['RTTY', 'Radio teletype: 45.45 baud, 170 Hz shift, the classic contest mode.', ['Radio: USB-DATA (or the radio\'s RTTY mode, reversed) near 14.085.', 'Tap the waterfall between the two tones (mark and space) to tune. REV swaps them if you see garbage.', 'Type in the box and press Enter to send; F1–F6 are memories.']],
    PSK31: ['PSK31', 'A narrow keyboard-to-keyboard mode: chats, nets. One signal is only 31 Hz wide.', ['Radio: USB-DATA on 14.070 (20 m). Keep the TX level LOW: an over-driven PSK signal splatters across everyone.', 'Tap the waterfall right on a trace to copy it; AFC follows small drift.', 'Type to send; F1–F6 are memories.']],
    HELL: ['Feld Hell', 'Hellschreiber "prints" the letters as a picture: you read them by eye, even in noise.', ['Radio: USB-DATA near 14.063 (20 m) or the net frequencies (7.0695, 10.1425, 3.585).', 'Tap the trace; the text shows twice (it is meant to): read the clearest line.', 'Type to send.']],
    SSTV: ['SSTV', 'Slow-scan television: one picture in 30–120 s. Martin 1 and Scottie 1 are the common types.', ['Radio: 14.230 USB (20 m). On 40 m and 80 m SSTV is LSB (7.171, 3.845): the app sets LSB there. ISS pictures: 145.800 FM.', 'Leave "pick the type by itself (VIS)" on: the app starts on the VIS tone at the top of a picture.', 'Pictures land in the gallery; send a photo or "my card" with your call on it.', 'Keep the RX level out of the red: a clipped picture comes out streaky.']],
    WSPR: ['WSPR', 'A 2-minute beacon at a few watts: who hears you, and who you hear, worldwide (wsprnet / wspr.live).', ['Radio: USB-DATA on the exact WSPR dial (20 m = 14.0956). The signals sit at 1400–1600 Hz audio. If the yellow bar says the radio is somewhere else, tap TUNE IT.', 'Your clock must be right to the second (⏱ CALIBRATE).', 'A cycle needs at least 100 of its 114 seconds: leave the screen on WSPR for a few minutes.', 'BEACON = transmit 1 cycle in N with your call, grid and power.']]
  };
  if ($('dgHelp')) $('dgHelp').onclick = () => { const h = HELP[ACT && ACT.id] || ['This mode', '', []];
    AP.sheet('❓ ' + h[0], `<p>${AP.esc(h[1])}</p><ul class="helpl">${h[2].map(x => '<li>' + AP.esc(x) + '</li>').join('')}</ul><p class="hint">Settings for ${AP.esc(ACT ? ACT.id : '')} are under ⚙. Radio control (CAT) is in STATION → Radio control. ${AP.esc('KPC is an independent ham radio club, not part of Parks on the Air®, SOTA or WWFF.')}</p>`); };

  let TALK = null;
  async function talkDown() {
    if (TALK) return; const m = ACT, khz = m ? +m.khz() || 0 : 0, cls = AP.S.cls || 'E';
    if (!AP.canKey()) { AP.toast('Nothing can key the radio yet: connect it in STATION → Radio control (or pick VOX).', 5000, 'bad'); return; }
    if (m && m.txing && m.txing()) { AP.toast(m.id + ' is transmitting: STOP it first.', 3000, 'bad'); return; }
    if (khz && !AP.bandPlan.allowed(khz, cls, 'SSB')) { AP.toast('🎤 Voice is not allowed on ' + (khz / 1000).toFixed(3) + ' (a CW / data part of the band' + (AP.S.cls ? ' for your licence' : '') + '). Talk in the phone part of the band, e.g. on the LOG screen with the voice keyer.', 6500, 'bad'); return; }
    if (AP.native) { AP.toast('🎤 On a phone at the radio, talk into the radio\'s own microphone (its PTT). HOLD TO TALK sends a microphone through the sound card on the PC app and from the REMOTE tab.', 6500); return; }
    if (!AP.running()) { AP.toast('Press START (the radio\'s sound) first: the microphone goes out through it.', 4000, 'bad'); return; }
    TALK = { t0: Date.now() }; $('dgTalk').classList.add('on'); $('dgTalk').textContent = '🎤 TALKING… (let go)';
    try {
      const mic = (G.KPCVoice && KPCVoice.S && KPCVoice.S.mic) || '';
      const st = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: mic ? { exact: mic } : undefined, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      if (!TALK) { st.getTracks().forEach(t => t.stop()); return; }
      TALK.st = st; TALK.p = AP.audio.pipe(st, AP.S.voice || 'natural'); if (!TALK.p) throw new Error('the sound is not running'); if (TALK.p.level) TALK.p.level(+AP.S.vdb || 0);
      await AP.pttOn(true, { voice: true }); if (!TALK) { await AP.pttOn(false, { voice: true }); return; } TALK.p.gate(true);
      TALK.lim = setTimeout(() => { talkUp(); AP.toast('🎤 Talk limit reached: PTT let go.', 3000); }, Math.max(30, +AP.S.rmTalk || 180) * 1000);
    } catch (e) { AP.toast('🎤 The microphone did not open: ' + AP.esc(e.message || e) + '. Pick it in the voice keyer (🎙 → RECORD / EDIT → RECORD WITH).', 6000, 'bad'); talkUp(); }
  }
  async function talkUp() { const t = TALK; if (!t) return; TALK = null; clearTimeout(t.lim); const b = $('dgTalk'); if (b) { b.classList.remove('on'); b.textContent = '🎤 HOLD TO TALK'; }
    try { if (t.p) { t.p.gate(false); t.p.stop(); } } catch (e) {} try { if (t.st) t.st.getTracks().forEach(x => x.stop()); } catch (e) {} if (t.p) await AP.pttOn(false, { voice: true }); }
  const tb = $('dgTalk');
  if (tb) { tb.addEventListener('pointerdown', e => { e.preventDefault(); try { tb.setPointerCapture(e.pointerId); } catch (x) {} talkDown(); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => tb.addEventListener(n, () => talkUp())); tb.addEventListener('contextmenu', e => e.preventDefault()); }
  G.addEventListener('blur', () => talkUp());
  G.KPCModes = { add, dialCheck, talking: () => !!TALK, _talkDown: talkDown, _talkUp: talkUp, use, op, state, active: () => ACT, all: () => M.slice(), get: id => byId[id] || null, lines: () => ACT ? ACT.lines() : [] };
})(window);
