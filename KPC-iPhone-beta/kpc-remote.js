/* KPC app: REMOTE OPERATION (Fable, Oct 22). Two halves in one file:
     THE BASE STATION (the Windows app, when electron/remote.js is there as window.kpcRemote): the PC keeps the radio and the sound;
       phones that paired (6-digit code + APPROVE on the PC) send requests. The PC decides, and keeps the SAFETY RULES:
       - watchdog: the phone holding the key must say 'alive' every second; 2.5 s of silence, the link closing, or an 'alive'
         that says the finger left the button → PTT OFF, tone stopped, FT8 TX halted.
       - a time limit per press: talk (S.rmTalk s, 180 by default), TUNE 20 s. FT8 is bounded by its own slot.
       - one phone at a time holds the key (the first one in); the others can watch.
     THE PHONE (any device): STATION → Remote: address(es) of the PC + the pair code once; then CONNECT. Sound two ways by
       WebRTC (RX in the speaker, HOLD TO TALK sends the mic), band / mode / TUNE / CQ / HALT / tap-a-line over the link,
       and the log syncs both ways (KPCLog.changes / merge). Works on home WiFi or over Tailscale: the phone tries each address. */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const AP = G.KPCApp, A = AP.audio, esc = AP.esc, S = AP.S, N = G.KPCNative && KPCNative.audio;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const PORT = 8731, ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const BASE = !!G.kpcRemote;                              /* this is the Windows app with the server inside */
  if (S.rmTalk == null) S.rmTalk = 180;
  if (!S.rmName) S.rmName = AP.native ? 'phone' : AP.platform === 'windows' ? 'PC' : 'browser';
  const W = LS('kpcSyncW', {});                            /* sync watermarks per peer: the newest 'u' I have from them */
  /* what the active mode heard, trimmed for the link (every mode on the frame gives lines() the same way) */
  const lines = () => (G.KPCModes ? KPCModes.lines() : []).slice(-80).map(x => x.sep != null ? { sep: x.sep, t: x.t, mode: x.mode, n: x.n }
    : { id: x.id, t: x.t, db: x.db, dt: x.dt, hz: x.hz, text: x.text, cls: x.cls, cq: x.cq, cqw: x.cqw, fr: x.fr, to: x.to, me: x.me, tx: x.tx, grid: x.grid, par: x.par });
  const MD = () => (G.KPCModes && KPCModes.active()) || null;

  /* ======================================================================== THE BASE STATION (PC) */
  const CL = new Map();                                    /* client id → {dev, alive, ptt, pc, pipe, tx} */
  let HOLDER = null, PTT = null, TUNE = null, DIGI = false, INFO = null;
  const KP = { id: null, base: null, last: 0, q: [], end: 0 };   /* hand keying from the phone (key edges played back evenly) */
  /* the radio's front panel as the PC last knew it (Brandon Oct 22: 'more like a real radio'). PHONE = a voice/CW mode picked from
     the phone (the digital screens then sit idle and the dial belongs to the panel); EX = what the panel asked the radio for. */
  const RIG = { khz: 0, mode: '' }; let PHONE = ''; const EX = Object.assign({ width: 2400, notch: 0, nb: 0, nr: 0, power: 100, mic: 50 }, LS('kpcRmEx', {}));
  const saveEx = () => SV('kpcRmEx', EX);
  if (!S.voice) S.voice = 'natural';
  AP.on('dial', r => { if (r && r.khz) { RIG.khz = r.khz; RIG.mode = r.mode || RIG.mode; } });
  const send = (to, m) => { try { G.kpcRemote.send(to, m); } catch (e) {} };
  const say = (to, text, bad) => send(to, { t: 'toast', text, bad: !!bad });

  function baseState() {
    const cat = AP.catMsg();
    const ms = G.KPCModes ? KPCModes.state() : { mode: '', modes: [], bands: [], band: '', khz: 0, enabled: false, txing: false, buttons: [], extra: {} };
    return { t: 'state', ver: AP.VER, run: AP.running(), tx: AP.txing(), ptt: !!PTT, tune: !!TUNE, digiOn: ms.enabled, key: AP.canKey(),
      cat: cat.t || '', catOk: cat.ok, catConn: AP.catConnected(), station: AP.me().call, grid: AP.me().grid, ref: AP.me().ref,
      band: ms.band, bands: ms.bands, mode: PHONE || ms.mode, modes: ms.modes, khz: PHONE ? RIG.khz : ms.khz, buttons: PHONE ? [] : ms.buttons,
      rig: { khz: RIG.khz, mode: RIG.mode }, phone: PHONE, ex: EX, extras: G.KPCCat && AP.catConnected() ? KPCCat.extras() : [], rx: G.KPCRigX && AP.catConnected() ? KPCRigX.remoteState() : null, voice: S.voice, cw: !!(G.KPCCat && KPCCat.cwCan && KPCCat.cwCan()) || !!G.KPCModes5, vk: G.KPCVoice ? { m: KPCVoice.names(), on: KPCVoice.playing(), auto: KPCVoice.auto() } : null,
      qso: ms.extra, qsoL: G.KPCDigi && KPCDigi.qsoLines ? KPCDigi.qsoLines() : [], meters: MET && Date.now() - MET.at < 6000 ? MET : null, spec: !PHONE && G.KPCDigi && KPCDigi.spectrum && AP.running() ? KPCDigi.spectrum() : null, holder: HOLDER, lim: +S.rmTalk || 180, n: CL.size,
      pcs: { db: +S.db || 0, vdb: +S.vdb || 0, rxDb: +S.rxDb || 0, vmod: S.vmod === 'data' ? 'data' : 'mic', run: AP.running(), cat: AP.catConnected(), cwvia: G.KPCModes5 ? (KPCModes5.S.cw.via || 'audio') : '' } };
  }
  const tellAll = () => { if (CL.size) send('*', baseState()); };
  AP.on('voice', v => { if (!BASE) return; for (const [, cc] of CL) if (cc.pipe && cc.pipe.shape) cc.pipe.shape(v); tellAll(); });   /* Nov 8: the PC's RADIO screen picked a voice */
  AP.on('swr-high', e => { if (CL.size && BASE) say('*', '⚠ HIGH SWR at the PC: about ' + (+e.swr).toFixed(1) + ' : 1' + (e.act === 'stop' ? ': transmitting stopped.' : e.act === 'power' ? ': power turned down to 25 %.' : '.') + ' Check the antenna or 🔧 TUNE.', true); });   /* Nov 6 */
  /* meters for the remote (Brandon Oct 24: 'always show ALC'): read every 2 s while a phone is on and the radio is connected, every second while transmitting */
  let MET = null, metT = 0, metBusy = false;
  async function metersTick() {
    if (!CL.size || !AP.catConnected() || !G.KPCCat || !KPCCat.meters || metBusy) return;
    const hot = AP.txing() || !!PTT || !!TUNE; if (Date.now() - metT < (hot ? 900 : 2000)) return;
    metBusy = true; try { const m = await KPCCat.meters(); if (m) { MET = Object.assign(m, { at: Date.now(), tx: hot }); if (G.KPCMeters) KPCMeters.feed(MET); } } catch (e) {} metBusy = false; metT = Date.now();
    /* keyed from the phone for 3 s and the radio reports no power: say what to check (FT-710: MOD SOURCE) instead of leaving him guessing */
    if (PTT && !PTT.said && MET && typeof MET.po === 'number' && Date.now() - PTT.since > 3000 && MET.po <= 1) { PTT.said = true; say(PTT.id, '⚠ The radio is keyed but puts out no power. On the PC check STATION → Sound → TX LEVEL (and that RADIO SOUND OUT is the radio\'s USB card). The app puts the radio in DATA while you talk (STATION → Radio control → VOICE FROM THIS DEVICE), so the DATA MOD SOURCE = USB setup that works for FT8 carries your voice too; if that is set to "leave the mode alone", a Yaesu needs MODE SSB → MOD SOURCE = REAR.', true); }
  }

  async function vfo(id, khz, mode, who) {
    if (!(khz > 100)) return;
    if (!AP.catConnected()) { RIG.khz = khz; if (mode) RIG.mode = mode; tellAll(); return say(id, 'The radio is not connected on the PC: it was not moved. Connect it in the PC\'s STATION → Radio control.', true); }
    if (PTT || TUNE || (MD() && MD().txing())) return say(id, 'Wait for the transmission to end.', true);
    const ok = await KPCCat.tune(khz, mode || PHONE || RIG.mode || '');
    if (ok) { RIG.khz = khz; if (mode) RIG.mode = mode; const r = await KPCCat.read(); if (r && r.khz) { RIG.khz = r.khz; RIG.mode = r.mode || RIG.mode; AP.fire('dial', r); } if (who) say(id, 'Radio on ' + (RIG.khz / 1000).toFixed(3) + ' ' + RIG.mode + ' for ' + who + '.'); }
    else say(id, 'The radio did not take ' + (khz / 1000).toFixed(3) + ' MHz.', true);
    tellAll();
  }
  /* Oct 25 (Brandon: 'no power out from the remote', 'lose sound on the tablet'): the phone's voice reaches the radio through a chain of
     Web Audio nodes (A.pipe) that belongs to ONE sound session on the PC. It used to be built once, when the microphone track arrived -
     if the PC's sound was not running then, or was stopped and started again later, the chain was missing or dead for good, so PTT keyed
     the radio with silence. Now the chain is (re)built whenever it is needed, and a sound restart also hands the phone the NEW radio audio. */
  function ensurePipe(c) {
    const gen = A.session || 0;
    if (c.pipe && c.pipeGen === gen) return c.pipe;
    if (c.pipe) { try { c.pipe.stop(); } catch (e) {} c.pipe = null; }
    if (!c.inStream || !AP.running()) return null;
    c.pipe = A.pipe(c.inStream, S.voice); c.pipeGen = gen; if (c.rtc) c.rtc.pipe = !!c.pipe;
    if (c.pipe && c.pipe.level) c.pipe.level(c.vdb || 0);
    if (c.pipe && PTT && PTT.id === c.id) c.pipe.gate(true);
    return c.pipe;
  }
  async function soundRestarted() {
    const rx = (A.sendStream && A.sendStream()) || (A.rxStream && A.rxStream()), tr = rx && rx.getAudioTracks()[0];
    for (const [, c] of CL) {
      ensurePipe(c);
      if (c.pc && tr) { try { const sn = c.pc.getSenders().find(x => !x.track || x.track.kind === 'audio'); if (sn && sn.track !== tr) await sn.replaceTrack(tr); if (c.rtc) c.rtc.trackOut = true; } catch (e) { if (c.rtc) c.rtc.err = 'replaceTrack: ' + (e.message || e); } }
    }
    tellAll();
  }
  AP.on('run', on => { if (on) setTimeout(soundRestarted, 200); });
  async function pttSet(id, on, why) {
    if (on) {
      if (PTT || TUNE || (MD() && MD().txing())) return say(id, 'The radio is already transmitting.', true);
      if (!AP.canKey()) return say(id, 'Nothing on the PC can key the radio: connect it (CAT) or pick VOX in the PC\'s STATION → Radio control.', true);
      if (!AP.running() && !(await AP.start())) return say(id, 'The PC could not start its sound.', true);
      const c = CL.get(id); if (!c) return;
      PTT = { id, since: Date.now(), timer: setTimeout(() => { pttSet(id, false, 'limit'); say(id, '⏱ Talk limit: ' + S.rmTalk + ' s. PTT dropped, press again to keep going.', true); }, (+S.rmTalk || 180) * 1000), said: false };
      const pipe = ensurePipe(c);
      if (pipe) pipe.gate(true); else if (!c.inStream) say(id, 'The PC has no microphone sound from this phone: press LISTEN first (it opens the sound link both ways).', true);
      AP.ctl(c.dev.call || ''); await AP.pttOn(true, { voice: true }); tellAll(); return;
    }
    if (!PTT || (id && PTT.id !== id && why !== 'watchdog' && why !== 'gone')) return;
    clearTimeout(PTT.timer); const c = CL.get(PTT.id); if (c && c.pipe) c.pipe.gate(false);
    PTT = null; await AP.pttOn(false, { voice: true }); AP.ctl(''); tellAll();
  }
  async function tuneGo(id) {
    if (PTT || TUNE || (MD() && MD().txing())) return say(id, 'The radio is already transmitting.', true);
    if (!AP.canKey()) return say(id, 'Nothing on the PC can key the radio yet (CAT or VOX in the PC\'s Radio control).', true);
    if (!G.KPCDigi) return;
    TUNE = { id, timer: setTimeout(() => { A.stopTx().catch(() => {}); }, 20000) };
    AP.ctl((CL.get(id) || { dev: {} }).dev.call || ''); tellAll();
    try { await KPCDigi.tune(); } catch (e) {}
    clearTimeout(TUNE.timer); TUNE = null; AP.ctl(''); tellAll();
  }
  function release(id, why) {                              /* the safety stop: everything this phone had going, off */
    if (PTT && PTT.id === id) pttSet(id, false, why);
    if (KP.id === id) { KP.q.forEach(clearTimeout); KP.q = []; KP.base = null; if (G.KPCModes5) KPCModes5.keyUp(); AP.ctl(''); }
    if (TUNE && TUNE.id === id) { A.stopTx().catch(() => {}); }
    if (DIGI && MD() && (MD().enabled() || MD().txing())) { MD().halt(why === 'gone' ? 'The phone dropped off the link, so transmitting stopped.' : 'No word from the phone for 2.5 s, so transmitting stopped.'); DIGI = false; }
  }
  function rtcClose(c) { if (c.pipe) { c.pipe.stop(); c.pipe = null; } if (c.inEl) { try { c.inEl.pause(); c.inEl.srcObject = null; } catch (e) {} } c.inStream = null; if (c.pc) { try { c.pc.close(); } catch (e) {} c.pc = null; } c.iceQ = []; c.rtc = null; }
  /* Oct 24 (Brandon: pairs + CAT fine, but no sound on the tablet and no TX from it; the report said nothing about the sound link):
     (1) the phone's ICE candidates used to arrive while the PC was still starting its sound (c.pc null) and were dropped, and any
     candidate before the remote description threw → queue them (iceQ) until the description is set; (2) every state the sound link
     goes through is kept in c.rtc for the report; (3) 'connected' / 'failed' are said to the phone with the reason. */
  async function rtcOffer(id, sdp) {
    const c = CL.get(id); if (!c) return;
    const q0 = c.iceQ || []; rtcClose(c); c.iceQ = q0;
    const pc = new RTCPeerConnection(ICE); c.pc = pc; c.rtc = { at: Date.now(), conn: 'new', ice: 'new', gather: 'new', trackIn: false, trackOut: false, pipe: false, err: '' };
    pc.onicecandidate = ev => { if (ev.candidate) send(id, { t: 'rtc', ice: ev.candidate }); };
    pc.onconnectionstatechange = () => { if (!c.rtc) return; c.rtc.conn = pc.connectionState; if (/failed|closed/.test(pc.connectionState)) say(id, 'The sound link ' + pc.connectionState + ' on the PC side (' + pc.iceConnectionState + '). Press LISTEN again; if it keeps failing, let KPC through the Windows firewall (STATION → Remote).', true); if (pc.connectionState === 'connected') say(id, '🔊 Sound link up.'); };
    pc.oniceconnectionstatechange = () => { if (c.rtc) c.rtc.ice = pc.iceConnectionState; };
    pc.onicegatheringstatechange = () => { if (c.rtc) c.rtc.gather = pc.iceGatheringState; };
    /* Nov 1 (Brandon: remote voice = 0 W in USB AND DATA-U while FT8 from the PC gives 20 W): Chromium hands a REMOTE WebRTC
       stream to Web Audio as silence until a media element plays it. The phone side always had its <audio>; the PC never did, so
       the voice pipe carried nothing. A hidden, muted element keeps the phone's voice flowing (muted = nothing on the PC speakers). */
    pc.ontrack = ev => { const st = ev.streams[0] || new MediaStream([ev.track]); c.inStream = st; c.id = id; if (c.rtc) c.rtc.trackIn = true;
      try { if (!c.inEl) { c.inEl = new Audio(); c.inEl.muted = true; c.inEl.autoplay = true; c.inEl.setAttribute('playsinline', ''); } c.inEl.srcObject = st; const pp = c.inEl.play(); if (pp && pp.catch) pp.catch(e => { if (c.rtc) c.rtc.err = 'voice element: ' + (e.message || e); }); if (c.rtc) c.rtc.inEl = true; } catch (e) { if (c.rtc) c.rtc.err = 'voice element: ' + (e.message || e); } if (!ensurePipe(c)) say(id, 'The PC got your microphone but its sound is not running, so your voice cannot reach the radio yet: it starts when you press TALK or START THE PC LISTENING.', true); };
    if (!AP.running() && !(await AP.start())) { if (c.rtc) c.rtc.err = 'PC sound would not start'; say(id, 'The PC could not start its sound, so there is no radio audio to send.', true); }
    if (c.pc !== pc) return;   /* a newer offer took over while the sound was starting */
    const rx = (A.sendStream && A.sendStream()) || (A.rxStream && A.rxStream());   /* Oct 26: the levelled copy (radio USB audio is quiet) */
    if (rx) { rx.getAudioTracks().forEach(tr => pc.addTrack(tr, rx)); c.rtc.trackOut = true; } else pc.addTransceiver('audio', { direction: 'recvonly' });
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      for (const cand of c.iceQ.splice(0)) { try { await pc.addIceCandidate(cand); } catch (e) {} }
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      send(id, { t: 'rtc', sdp: pc.localDescription.sdp, kind: 'answer' });
    } catch (e) { if (c.rtc) c.rtc.err = String(e.message || e); say(id, 'Sound link failed on the PC: ' + (e.message || e), true); }
  }
  /* what the report shows about each phone's sound link (PC side) + what the phone itself said about it (phone side, in 'alive') */
  async function rtcReport() {
    const out = [];
    for (const [id, c] of CL) {
      let pair = '';
      if (c.pc) { try { const st = await c.pc.getStats(); const P = {}; st.forEach(r => { P[r.id] = r; }); st.forEach(r => { if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.state === 'succeeded') { const l = P[r.localCandidateId] || {}, rm = P[r.remoteCandidateId] || {}; pair = (l.candidateType || '?') + ' ' + (l.address || l.ip || '') + ':' + (l.port || '') + ' ↔ ' + (rm.candidateType || '?') + ' ' + (rm.address || rm.ip || '') + ':' + (rm.port || ''); } }); } catch (e) {} }
      out.push({ phone: (c.dev || {}).name || id, ptt: c.ptt, rtc: c.rtc, pair, phoneSays: c.rtcPhone || null, voiceDb: c.pipe && c.pipe.db ? c.pipe.db() : null, voicePeak: c.vpk == null ? null : c.vpk });
    }
    return out;
  }
  function onMsg(d) {
    const id = d.from, m = d.m; if (!m) return;
    if (m.t === 'joined') {
      CL.set(id, { id, dev: d.dev || {}, alive: Date.now(), ptt: false, pc: null, pipe: null, inStream: null, logOnly: !!(d.dev && d.dev.logOnly) });
      /* Nov 5 (contest add-on): a Field Day / multi-op station that only SHARES THE LOG never holds the key */
      if (!HOLDER && !(d.dev && d.dev.logOnly)) HOLDER = id;
      AP.toast('📱 ' + esc((d.dev || {}).name || 'A phone') + (d.dev && d.dev.call ? ' (' + esc(d.dev.call) + ')' : '') + ' is on the link' + (d.dev && d.dev.logOnly ? ' sharing the log (its own radio).' : HOLDER === id ? ' and holds the key.' : ' (watching: another phone holds the key).'), 5000, 'log');
      send(id, baseState()); send(id, { t: 'lines', lines: lines() }); send(id, { t: 'sync', since: W[(d.dev || {}).id] || 0 });
      baseCard(); return;
    }
    const c = CL.get(id); if (!c) return;
    c.alive = Date.now();
    if (m.t === 'gone') { release(id, 'gone'); rtcClose(c); CL.delete(id); if (HOLDER === id) { HOLDER = ([...CL.values()].find(x => !x.logOnly) || {}).id || null; if (HOLDER) say(HOLDER, 'You hold the key now.'); } AP.toast('📱 ' + esc(c.dev.name || 'The phone') + ' left the link.', 4000); baseCard(); tellAll(); return; }
    if (m.t === 'alive') { c.ptt = !!m.ptt; if (m.rtc) c.rtcPhone = m.rtc; if (m.vdb != null && +m.vdb !== c.vdb) { c.vdb = +m.vdb; if (c.pipe && c.pipe.level) c.pipe.level(c.vdb); } if (PTT && PTT.id === id && !m.ptt) pttSet(id, false, 'watchdog'); return; }
    if (m.t === 'sync') { send(id, { t: 'syncd', recs: G.KPCLog ? KPCLog.changes(m.since) : [] }); return; }
    if (m.t === 'syncd') { const ch = syncIn(c.dev.id, m.recs); if (ch.length) CL.forEach((x, k) => { if (k !== id) send(k, { t: 'syncd', recs: ch }); }); return; }   /* Nov 5: Field Day = the PC passes each station's contacts on to the others */
    if (m.t === 'rtc') { if (m.sdp) rtcOffer(id, m.sdp); else if (m.ice) { if (c.pc && c.pc.remoteDescription) c.pc.addIceCandidate(m.ice).catch(() => {}); else (c.iceQ = c.iceQ || []).push(m.ice); } return; }
    if (m.t === 'state?') { send(id, baseState()); send(id, { t: 'lines', lines: lines() }); return; }
    /* everything below touches the radio: only the phone that holds the key */
    if (HOLDER !== id) return say(id, 'Another phone holds the key right now. You can watch.', true);
    if (m.t === 'ptt') { pttSet(id, !!m.on); return; }
    if (m.t === 'tune') { tuneGo(id); return; }
    if (m.t === 'run') { (m.on ? AP.start() : AP.stop()); setTimeout(tellAll, 300); return; }
    if (m.t === 'digi' && G.KPCModes) {                  /* anything a mode offers: the frame routes it */
      const keyed = !/^(band|mode|halt)$/.test(m.op || '');
      if (keyed && !AP.canKey()) return say(id, 'Nothing on the PC can key the radio yet.', true);
      if (m.op === 'halt') DIGI = false; else if (keyed && !(m.op === 'tx' && !m.on)) DIGI = true; else if (m.op === 'tx') DIGI = false;
      if (!KPCModes.op(m.op, m)) say(id, m.op === 'band' ? 'No ' + m.band + ' for ' + (MD() ? MD().id : '') + '.' : 'The PC\'s ' + (MD() ? MD().id : '') + ' screen cannot do "' + m.op + '".', true);
      setTimeout(tellAll, 300);
      /* Oct 25 (Brandon: 'remote changes the radio but the screen does not update'): after a band or mode pick, read the dial back once the
         tune has had time to land, so the VFO and the mode's controls on the phone follow the radio */
      if (/^(band|mode)$/.test(m.op || '')) setTimeout(async () => { if (AP.catConnected() && G.KPCCat && !AP.txing()) { const r = await KPCCat.read().catch(() => null); if (r && r.khz) AP.fire('dial', r); } tellAll(); }, 1500);
      return;
    }
    if (m.t === 'cat' && m.op === 'read' && G.KPCCat && KPCCat.connected()) { KPCCat.read().then(r => { if (r) AP.fire('dial', r); tellAll(); }); return; }
    if (m.t === 'cat' && m.op === 'atu') { if (!G.KPCCat || !KPCCat.connected()) return say(id, 'No radio control on the PC.', true); if (PTT || TUNE || AP.txing()) return say(id, 'The radio is transmitting: not now.', true); KPCCat.extra('atu', 1).then(ok => say(id, ok ? '🔧 The radio\'s tuner is tuning.' : 'The radio did not take the tune command.', !ok)); return; }
    if (m.t === 'cat' && m.op === 'power') { if (!G.KPCCat || !KPCCat.power) return say(id, 'No radio control on the PC.', true); if (PTT || TUNE || AP.txing()) return say(id, 'The radio is transmitting: not now.', true); KPCCat.power(!!m.on).then(ok => { say(id, ok ? (m.on ? '🔌 Radio power ON sent.' : '🔌 Radio power OFF sent.') : 'The radio did not take the power command (' + (m.on ? 'many radios cannot be switched ON over USB' : 'no CAT') + ').', !ok); if (ok && m.on) setTimeout(() => { KPCCat.connect(false).then(() => tellAll()); }, 4000); else tellAll(); }); return; }
    /* ---- the front panel ---- */
    if (m.t === 'vfo') { vfo(id, +m.khz, m.mode); return; }
    if (m.t === 'step') { if (RIG.khz) vfo(id, Math.round((RIG.khz + (+m.hz || 0) / 1000) * 1000) / 1000, PHONE || RIG.mode); return; }
    if (m.t === 'pmode') { /* LSB USB CW AM FM DATA from the phone, or '' = back to the digital screens */
      const pm = String(m.mode || '').toUpperCase();
      if (!pm) { PHONE = ''; tellAll(); return; }
      if (MD() && (MD().enabled() || MD().txing())) MD().halt('The phone switched to ' + pm + '.');
      DIGI = false; PHONE = pm; vfo(id, RIG.khz || (MD() ? MD().khz() : 14250), pm); return;
    }
    /* Nov 6 (Brandon: 'do the remote screen options … remote operations being able to control the radio'): 🎛 MORE CONTROLS from the phone,
       the same rules as a tap on the PC (only what this radio takes, nothing but keyer speed / break-in while transmitting) */
    if (m.t === 'rx') { if (c.logOnly) return say(id, 'This device only shares the log: it does not run the PC\'s radio.', true); if (!G.KPCRigX) return say(id, 'The PC app is too old for these controls.', true);
      KPCRigX.remoteSet(String(m.k || ''), m.v).then(r => { if (!r.ok) say(id, r.msg, true); else if (m.label) say(id, m.label + ' sent.'); tellAll(); }); return; }
    if (m.t === 'extra') { if (!AP.catConnected()) return say(id, 'The radio is not connected on the PC.', true); const v = m.name === 'width' || m.name === 'power' || m.name === 'mic' ? +m.value : (m.value ? 1 : 0); EX[m.name] = v; saveEx(); KPCCat.extra(m.name, v).then(ok => { if (!ok) say(id, 'This radio does not take ' + m.name + ' over CAT.', true); tellAll(); }); return; }
    /* Oct 27 (Brandon: 'how can we change PC settings when I am at work without remote desktop'): a paired phone may change these PC settings */
    if (m.t === 'pcset') {
      const k = String(m.k || ''), v = m.v;
      if (k === 'db') AP.lvSet('tx', Math.max(-40, Math.min(0, +v || 0)));
      else if (k === 'rxDb') AP.lvSet('rx', Math.max(-20, Math.min(20, +v || 0)));
      else if (k === 'vdb') AP.lvSet('vc', Math.max(-20, Math.min(30, +v || 0)));
      else if (k === 'vmod') { S.vmod = v === 'data' ? 'data' : 'mic'; AP.save(); const e = $('stVmod'); if (e) e.value = S.vmod; }
      else if (k === 'run') { if (PTT || TUNE || AP.txing()) return say(id, 'Transmitting: not now.', true); (v ? AP.start() : AP.stop()).then(() => tellAll()); return; }
      else if (k === 'cat') { if (PTT || TUNE || AP.txing()) return say(id, 'Transmitting: not now.', true); (v ? KPCCat.connect(false) : KPCCat.disconnect()).then(ok => { AP.keyCheck(); if (v && !ok) say(id, 'The PC could not reach the radio: ' + (AP.catMsg().t || 'no answer'), true); tellAll(); }); return; }
      else if (k === 'cwvia' && G.KPCModes5 && /^(audio|dtr|rts|cat)$/.test(v)) { KPCModes5.S.cw.via = v; KPCModes5.save(); }
      else return;
      tellAll(); return;
    }
    if (m.t === 'voice') { S.voice = (A.voicePresets || []).includes(m.preset) ? m.preset : 'natural'; AP.save(); for (const [, cc] of CL) if (cc.pipe && cc.pipe.shape) cc.pipe.shape(S.voice); tellAll(); return; }
    if (m.t === 'cw' && G.KPCModes5 && !(AP.catConnected() && KPCCat.cwCan())) {   /* Oct 24: no CAT keyer → the PC sends it by sound or the key line (⚙ CW → SEND WITH) */
      if (PTT || TUNE) return say(id, 'The radio is already transmitting.', true); AP.ctl(c.dev.call || '');
      KPCModes5.cwOut(String(m.text || '').slice(0, 200), +m.wpm || 0).then(ok => { if (!ok) say(id, 'The PC could not send CW: ' + (KPCModes5.why('CW') || 'see ⚙ CW on the PC'), true); setTimeout(() => AP.ctl(''), 2000); }); return; }
    if (m.t === 'cw') { if (!AP.catConnected() || !KPCCat.cwCan()) return say(id, 'This radio cannot take typed CW over CAT (Yaesu: use the key).', true); if (PTT || TUNE) return say(id, 'The radio is already transmitting.', true); AP.ctl(c.dev.call || ''); KPCCat.cw(String(m.text || '').slice(0, 200), +m.wpm || 0).then(() => { setTimeout(() => AP.ctl(''), 2000); }); return; }
    /* Oct 25 (Brandon: no tap-to-key / paddle, 'never keys up in CW remote'): HAND KEYING from the phone. The phone sends every key edge
       with ITS clock (the paddle logic runs on the phone); the PC plays the edges back 250 ms later at the same spacing, so WiFi jitter
       does not chop the Morse. A pause of 1.5 s starts a new run; a key held 8 s is let go (KPCModes5); the 2.5 s watchdog covers a dead link. */
    if (m.t === 'key') {
      if (!G.KPCModes5) return say(id, 'The PC has no CW keying.', true);
      if (m.d) { const w = KPCModes5.keyWhy(); if (w) return say(id, w, true); }
      const now = performance.now();
      if (KP.id !== id || !KP.base || m.at - KP.last > 1500) { KP.id = id; KP.base = { ph: +m.at, pc: now + 250 }; AP.ctl(c.dev.call || ''); }
      KP.last = +m.at; let when = KP.base.pc + (+m.at - KP.base.ph);
      if (when < now) { KP.base.pc += now - when + 40; when = now + 40; }
      const tm = setTimeout(() => { KP.q = KP.q.filter(x => x !== tm); m.d ? KPCModes5.keyDown() : KPCModes5.keyUp(); if (!m.d && !KP.q.length) clearTimeout(KP.end), KP.end = setTimeout(() => AP.ctl(''), 3000); }, when - now);
      KP.q.push(tm); return;
    }
    if (m.t === 'cwstop') { if (G.KPCCat) KPCCat.cwStop(); if (G.KPCModes5) KPCModes5.stopTx(); return; }
    /* Oct 24: the PC's voice keyer from the phone (one tap = one memory out behind PTT, AUTO CQ, STOP) */
    if (m.t === 'vk') { if (!G.KPCVoice) return say(id, 'No voice keyer on the PC.', true); if (m.op === 'stop') { KPCVoice.stop('Stopped from the phone.'); setTimeout(tellAll, 200); return; }
      if (PTT || TUNE) return say(id, 'The radio is already transmitting.', true); AP.ctl(c.dev.call || '');
      const done = () => { setTimeout(() => AP.ctl(''), 1500); tellAll(); };
      if (m.op === 'auto') { if (m.on) KPCVoice.autoOn().finally(done); else { KPCVoice.autoOff('Auto CQ off (phone).'); done(); } setTimeout(tellAll, 300); return; }
      KPCVoice.play(+m.i || 0).then(ok => { if (!ok) say(id, 'The PC could not send memory ' + ((+m.i || 0) + 1) + ' (recorded? sound started? radio keyed?).', true); done(); }); setTimeout(tellAll, 300); return; }
    if (m.t === 'spot') { /* a spot tapped on the phone: tune the PC's radio to it (FT8/FT4 → the frame; anything else → the panel) */
      const mode = String(m.mode || '').toUpperCase();
      if (/^FT[48]$/.test(mode) && G.KPCModes && KPCModes.get(mode)) { PHONE = ''; KPCModes.use(mode); const b = G.KPCLog ? KPCLog.band(+m.khz) : ''; if (b) KPCModes.active().setBand(b); say(id, 'The PC is on ' + mode + ' ' + b + ' for ' + m.call + '.'); setTimeout(tellAll, 400); return; }
      const pm = /CW/.test(mode) ? 'CW' : /FM/.test(mode) ? 'FM' : /AM/.test(mode) ? 'AM' : /DATA|RTTY|PSK|JS8/.test(mode) ? 'DATA' : (+m.khz < 10000 && !(+m.khz >= 5300 && +m.khz <= 5410) ? 'LSB' : 'USB');
      if (MD() && (MD().enabled() || MD().txing())) MD().halt('The phone tuned to a spot.'); DIGI = false; PHONE = pm; vfo(id, +m.khz, pm, m.call); return;
    }
  }
  /* the watchdog: 2.5 s without 'alive' from the phone that holds the key → everything off */
  function watchdog() {
    const cut = Date.now() - 2500;
    for (const [id, c] of CL) if (c.alive < cut && (PTT && PTT.id === id || TUNE && TUNE.id === id || (DIGI && HOLDER === id))) release(id, 'watchdog');
  }
  function baseCard() {
    const el = $('rmBase'); if (!el) return;
    const i = INFO || { on: false, addrs: [], devices: [], clients: [] };
    const kind = { wifi: 'home WiFi', tailscale: 'Tailscale (from anywhere)', other: 'other network' };
    el.innerHTML = `
      <div class="row"><button type="button" class="b ${i.on ? '' : 'gold'}" id="rmOn">${i.on ? '⏹ TURN THE LINK OFF' : '📡 LET MY PHONE IN'}</button>${i.on ? '<button type="button" class="b" id="rmCode">🔑 NEW PAIR CODE</button>' : ''}<label class="e small">TALK LIMIT<select id="rmTalk">${[60, 120, 180, 300].map(x => `<option value="${x}"${(+S.rmTalk || 180) === x ? ' selected' : ''}>${x / 60} min</option>`).join('')}</select></label></div>
      ${i.err ? `<div class="st bad">${esc(i.err)}</div>` : ''}
      ${i.on ? `<div class="paircode"><i>PAIR CODE (type it on the phone once)</i><b class="mono">${esc(String(i.code || '').replace(/(\d{3})(\d{3})/, '$1 $2'))}</b></div>
      <div class="addrs">${i.addrs.length ? i.addrs.map(a => `<div><b class="mono">${esc(a.ip)}</b> <span>${esc(kind[a.kind] || a.kind)}</span></div>`).join('') : '<div>No network address found: is this PC on WiFi or Ethernet?</div>'}</div>
      <p class="hint">Port ${esc(String(i.port))}. On the phone: STATION → Remote → type the WiFi address (at home) and the Tailscale address (away), then the pair code, press CONNECT, and press APPROVE here. Tailscale on both the PC and the phone gives the phone a way home with no router changes.</p>
      <div class="row"><button type="button" class="b" id="rmFw">🛡 LET KPC THROUGH WINDOWS FIREWALL</button><button type="button" class="b" id="rmSelf">🩺 CHECK THIS PC</button></div>
      <div class="st" id="rmFwT" hidden></div>
      <p class="hint">The phone says 'refused'? Windows Firewall is the usual reason: press the shield button (Windows asks you to allow a change), or when Windows pops up "allow KPC on this network" click ALLOW for both private and public networks.</p>` : '<p class="hint">Off: no phone can reach this PC. Turn it on, read the pair code to your phone, and the phone becomes your remote: radio, FT8 and your voice, from the next room or from the park.</p>'}
      ${i.clients.length ? `<div class="st ok">On the link now: ${i.clients.map(c => esc(c.dev.name || '?') + (c.dev.call ? ' (' + esc(c.dev.call) + ')' : '') + (HOLDER === c.id ? ' 🔑' : '') + ` <button type="button" class="ic sm" data-rmdrop="${esc(c.id)}">✕</button>`).join(' · ')}</div>` : ''}
      ${i.devices.filter(d => !d.revoked).length ? `<div class="oplist">${i.devices.filter(d => !d.revoked).map(d => `<div class="op"><b>${esc(d.name)}</b> ${d.call ? esc(d.call) : ''} <i>paired ${esc(new Date(d.when).toISOString().slice(0, 10))}</i> <button type="button" class="ic sm" data-rmrev="${esc(d.id)}" aria-label="Throw ${esc(d.name)} out">THROW OUT</button></div>`).join('')}</div>` : ''}`;
    $('rmOn').onclick = async () => { INFO = await G.kpcRemote.start({ on: !i.on, port: i.port || PORT }); baseCard(); };
    if ($('rmCode')) $('rmCode').onclick = async () => { INFO = await G.kpcRemote.newCode(); baseCard(); };
    $('rmTalk').onchange = () => { S.rmTalk = +$('rmTalk').value || 180; AP.save(); tellAll(); };
    if ($('rmFw')) $('rmFw').onclick = async () => { const t = $('rmFwT'); t.hidden = false; t.className = 'st'; t.textContent = 'Asking Windows…'; const r = await G.kpcRemote.firewall(); t.className = 'st ' + (r.ok ? 'ok' : 'bad'); t.textContent = r.ok ? '✅ Windows Firewall now lets KPC in (port ' + i.port + ').' : '✗ ' + (r.err || 'Windows did not allow it. Try again and click YES on the Windows prompt.'); };
    if ($('rmSelf')) $('rmSelf').onclick = async () => { const t = $('rmFwT'); t.hidden = false; t.className = 'st'; t.textContent = 'Checking…'; const r = await G.kpcRemote.selfCheck(); t.className = 'st ' + (r.ok ? 'ok' : 'bad'); t.textContent = r.ok ? '✅ The link answers on this PC at ' + r.addrs.join(', ') + '. If the phone still cannot reach it, it is the firewall or a different network.' : '✗ ' + (r.err || 'The link is not answering on this PC.'); };
    el.querySelectorAll('[data-rmrev]').forEach(b => { b.onclick = async () => { INFO = await G.kpcRemote.revoke(b.dataset.rmrev); baseCard(); }; });
    el.querySelectorAll('[data-rmdrop]').forEach(b => { b.onclick = () => G.kpcRemote.drop(b.dataset.rmdrop); });
  }
  function baseStart() {
    G.kpcRemote.onMsg(onMsg);
    G.kpcRemote.onClients(async () => { INFO = await G.kpcRemote.info(); baseCard(); });
    G.kpcRemote.onPair(d => {
      AP.sheet('A phone wants to pair', `<p><b>${esc(d.dev.name || 'A phone')}</b>${d.ip ? ' from ' + esc(String(d.ip).replace('::ffff:', '')) : ''} typed the right pair code.</p>
        <label class="e">THE CALL SIGN AT THAT PHONE<input id="rmPairCall" autocapitalize="characters" spellcheck="false" value="${esc(d.dev.call || '')}" placeholder="K4TEST"></label>
        <p class="hint">It goes in the log as the control operator when they key the radio from there (Part 97.119). Only approve a phone you know.</p>
        <div class="row"><button type="button" class="b gold" id="rmYes">✓ APPROVE</button><button type="button" class="b halt" id="rmNo">✕ NO</button></div>`);
      $('rmYes').onclick = () => { G.kpcRemote.approve(d.id, true, String($('rmPairCall').value || '').trim().toUpperCase()); AP.shut(); };
      $('rmNo').onclick = () => { G.kpcRemote.approve(d.id, false); AP.shut(); };
    });
    setInterval(watchdog, 500); setInterval(tellAll, 1000); setInterval(metersTick, 500);
    /* Nov 1: while a phone holds the key, keep the loudest voice level the PC saw (the report's voicePeak: −99 = nothing arrived) */
    setInterval(() => { if (PTT) { const c = CL.get(PTT.id); if (c && c.pipe && c.pipe.db) { const d = c.pipe.db(); c.vpk = c.vpk == null ? d : Math.max(c.vpk, d); } } }, 200);
    AP.on('decoded', () => { if (CL.size) send('*', { t: 'lines', lines: lines() }); });
    ['dial', 'run', 'key', 'me'].forEach(k => AP.on(k, () => setTimeout(tellAll, 50)));
    AP.on('log', ev => { if (ev && ev.recs && ev.why !== 'merge' && ev.why !== 'load' && CL.size) send('*', { t: 'syncd', recs: ev.recs }); });
    G.kpcRemote.info().then(i => { INFO = i; baseCard(); });
  }

  /* ======================================================================== SYNC (both halves) */
  function syncIn(peer, recs) {
    if (!G.KPCLog || !recs || !recs.length) return [];
    const ch = KPCLog.merge(recs, 'merge'), n = ch.length, mx = Math.max(W[peer] || 0, ...recs.map(r => +r.u || 0));
    W[peer] = mx; SV('kpcSyncW', W);
    /* Nov 5: a contest log's contacts arrive all day from the other stations: no toast for each */
    if (n && !(G.KPCContest && KPCContest.S.on && recs.every(r => r.cx))) AP.toast('🔄 ' + n + ' contact' + (n > 1 ? 's' : '') + ' came over from the ' + (BASE ? 'phone' : 'PC') + '.', 3000, 'log');
    return ch;
  }

  /* ======================================================================== THE PHONE (client) */
  let MUTE = false;                                        /* tests only: pretend the phone went quiet */
  let RMW = null;
  let ws = null, LINK = { on: false, paired: false, name: '', ms: 0, wait: false }, ST = null, LN = [], aliveT = null, pc = null, mic = null, HOLD = false, RTC = 'off';
  const devId = () => { if (!S.rmId) { S.rmId = (G.KPCLog ? KPCLog.dev : '') + '-' + Math.random().toString(36).slice(2, 8); AP.save(); } return S.rmId; };
  const addrList = () => String(S.rmAddr || '').split(/[\s,;]+/).map(a => a.trim()).filter(Boolean);
  const wsUrl = a => /^wss?:\/\//.test(a) ? a : 'ws://' + (a.includes(':') && !/^\[/.test(a) ? a : a + ':' + PORT);
  const out = m => { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(m)); } catch (e) {} } };

  /* one address: the socket, or WHY it failed (Brandon Oct 22: the tablet only said 'no answer from PC') */
  const WHY = {};
  function tryOne(url, ms) {
    return new Promise(res => {
      let w; try { w = G.KPCNative.ws ? G.KPCNative.ws(url, ms) : new WebSocket(url); } catch (e) { WHY[url] = String(e.message || e); res(null); return; }
      let done = false; const fin = v => { if (!done) { done = true; clearTimeout(t); res(v); } };
      const t = setTimeout(() => { WHY[url] = 'no answer in ' + Math.round(ms / 1000) + ' s (wrong address, or this device is not on the same network / Tailscale is not up)'; try { w.close(); } catch (e) {} fin(null); }, ms);
      w.onopen = () => fin(w);
      w.onerror = e => { WHY[url] = (e && e.message) || w.lastError || 'refused (the PC is there but nothing answers on port ' + PORT + ': link OFF on the PC, or Windows Firewall is blocking KPC)'; };
      w.onclose = e => { if (!WHY[url]) WHY[url] = (e && e.reason) || w.lastError || 'closed before it opened'; fin(null); };
    });
  }
  async function testLink() {
    const list = addrList(); if (!list.length) { AP.toast('Type the PC\'s address first.', 4000, 'bad'); return; }
    AP.toast('Testing ' + list.length + ' address' + (list.length > 1 ? 'es' : '') + '…', 8000);
    const out = [];
    for (const a of list) { const u = wsUrl(a); delete WHY[u]; const w = await tryOne(u, 4000); if (w) { try { w.close(); } catch (e) {} out.push('✅ ' + a + ': the PC answers here.'); } else out.push('✗ ' + a + ': ' + (WHY[u] || 'no answer')); }
    AP.sheet('Link test', '<div class="oplist">' + out.map(x => '<div class="op">' + esc(x) + '</div>').join('') + '</div><p class="hint">Refused = the PC is reachable but KPC is not listening: on the PC press LET MY PHONE IN, and when Windows asks about the network, click ALLOW (both private and public). No answer = this device cannot reach that address at all: same WiFi? Tailscale running on both? The PC shows its addresses under STATION → Remote; use the WiFi one at home.</p>');
  }
  async function connect(code) {
    const list = addrList();
    code = String(code || '').replace(/\D/g, '');
    if (!list.length) { AP.toast('Type the PC\'s address first (it is on the PC under STATION → Remote).', 5000, 'bad'); return; }
    disconnect(true); linkCard('Connecting…');
    let w = null, used = '';
    for (const a of list) { const u = wsUrl(a); delete WHY[u]; w = await tryOne(u, 4000); if (w) { used = a; break; } }
    if (!w) { linkCard(''); AP.toast('No PC answered. ' + esc(list.map(a => a + ': ' + (WHY[wsUrl(a)] || 'no answer')).join(' · ')) + ' — press TEST THE LINK for what to do.', 10000, 'bad'); return; }
    ws = w; LINK = { on: true, paired: false, name: '', ms: 0, wait: false, addr: used };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onLink(m); };
    ws.onclose = () => { if (ws === w) { ws = null; linkDown('The link to the PC closed.'); } };
    ws.onerror = () => {};
    out({ t: 'hello', dev: { id: devId(), name: S.rmName, call: AP.me().op || AP.me().call, logOnly: !!S.rmLogOnly }, token: S.rmTok || '', code: String(code || '').replace(/\D/g, '') });
  }
  function disconnect(quiet) {
    if (N && N.keepAwake && LINK.on) N.keepAwake(false, false);
    HOLD = false; clearInterval(aliveT); aliveT = null; rtcStop();
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; }
    if (LINK.on && !quiet) AP.toast('Off the link.', 2500);
    LINK = { on: false, paired: false, name: '', ms: 0, wait: false }; ST = null; LN = [];
    tabShow(); linkCard(''); AP.fire('remote', false);
  }
  function linkDown(why) { const was = LINK.on; disconnect(true); if (was) AP.toast('📵 ' + esc(why) + ' Your finger off the button means nothing more goes out: the PC drops PTT by itself.', 6000, 'bad'); }
  function onLink(m) {
    if (m.t === 'welcome') {
      if (m.ok) {
        LINK.paired = true; LINK.name = m.name || 'PC'; LINK.wait = false; if (m.token) { S.rmTok = m.token; AP.save(); }
        aliveT = setInterval(() => { if (!MUTE) out({ t: 'alive', at: Date.now(), ptt: HOLD, vdb: +S.rmVdb || 0, rtc: RTC === 'off' ? null : rtcSummary() }); }, 1000);
        out({ t: 'sync', since: W['pc'] || 0 }); out({ t: 'state?' });
        if (S.rmLogOnly) { LINK.logOnly = true; AP.toast('🔗 Sharing the log with ' + esc(LINK.name) + ' (this device keeps its own radio).', 3500, 'log'); tabShow(); AP.fire('remote', true); }   /* Nov 5: Field Day / multi-op */
        else { ownOff(); if (N.keepAwake) N.keepAwake(true, false); AP.toast('🔗 On the link with ' + esc(LINK.name) + '.', 3000, 'log'); tabShow(); AP.go('remote'); AP.fire('remote', true); }
      } else if (m.wait) { LINK.wait = true; AP.toast('The PC took the code: now press ✓ APPROVE on the PC screen.', 15000); }
      else {
        /* Oct 23 (Brandon: 'no box to type in pc's code … pc never shows to allow'): an old key the PC no longer knows hid the
           code box; now the key is dropped, the box shows, and the phone says what to do */
        if (/pair code|thrown out|Not paired/i.test(m.why || '')) { S.rmTok = ''; AP.save(); }
        AP.toast(esc(m.why || 'The PC said no.') + (/Not paired/.test(m.why || '') ? ' Type it in PAIR CODE and press CONNECT again.' : ''), 8000, 'bad'); disconnect(true);
        setTimeout(() => { const p = $('rmPin'); if (p) { p.focus(); p.scrollIntoView({ block: 'center' }); } }, 100);
      }
      linkCard(''); return;
    }
    if (m.t === 'bye') { AP.toast(esc(m.why || 'The PC closed the link.'), 5000, 'bad'); disconnect(true); return; }
    if (m.t === 'alive') { LINK.ms = Math.max(0, Date.now() - (+m.at || Date.now())); return; }
    if (m.t === 'toast') { AP.toast(esc(m.text), m.bad ? 5000 : 3000, m.bad ? 'bad' : ''); return; }
    if (m.t === 'state') { ST = m; drawRemote(); return; }
    if (m.t === 'lines') { LN = m.lines || []; drawLines(); return; }
    if (m.t === 'sync') { out({ t: 'syncd', recs: G.KPCLog ? KPCLog.changes(m.since) : [] }); return; }
    if (m.t === 'syncd') { syncIn('pc', m.recs); return; }
    if (m.t === 'rtc') { if (m.sdp && pc) pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).then(async () => { for (const cand of ICEQ.splice(0)) { try { await pc.addIceCandidate(cand); } catch (e) {} } }).catch(e => { PRTC.err = String(e.message || e); }); else if (m.ice) { if (pc && pc.remoteDescription) pc.addIceCandidate(m.ice).catch(() => {}); else ICEQ.push(m.ice); } return; }
  }
  /* sound both ways */
  let ICEQ = [], PRTC = {};
  /* Oct 24: the phone's own sound and radio get out of the way while it is on the link (Brandon's tablet had both running: one owner of the speaker and the mic) */
  async function ownOff() {
    try { if (AP.running()) { await AP.stop(); AP.toast('🔇 Your own sound here is off while you are on the link: the PC\'s radio is what you hear and key.', 5000, 'log'); } } catch (e) {}
    try { if (G.KPCCat && KPCCat.connected && KPCCat.connected()) await KPCCat.disconnect(true); } catch (e) {}
  }
  async function rtcStart() {
    rtcStop(); RTC = 'starting'; drawRemote(); ICEQ = []; PRTC = { at: Date.now(), conn: 'new', ice: 'new', gather: 'new', mic: false, micErr: '', trackIn: false, play: '', err: '' };
    await ownOff();
    pc = new RTCPeerConnection(ICE);
    if (LAZY) { pc.addTransceiver('audio', { direction: 'sendrecv' }); PRTC.mic = 'when you talk'; }   /* Nov 8: iPhone: the mic opens only while you hold TALK (an open mic sends Safari's sound to the quiet earpiece) */
    else try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); PRTC.mic = true; }
    catch (e) { mic = null; PRTC.micErr = String(e.name || e.message || e); AP.toast('No microphone here (' + esc(PRTC.micErr) + '): you can listen but not talk. Allow the microphone for KPC (Android Settings → Apps → KPC → Permissions) and press LISTEN again.', 7000, 'bad'); }
    if (LAZY) {} else if (mic) mic.getAudioTracks().forEach(tr => { tr.enabled = false; pc.addTrack(tr, mic); }); else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = ev => { const st = ev.streams[0] || new MediaStream([ev.track]); const el = $('rmAudio'); el.srcObject = st; el.muted = false; el.volume = 1; PRTC.trackIn = true; el.play().then(() => { PRTC.play = 'playing'; }).catch(e => { PRTC.play = 'blocked: ' + (e.name || e); const b = $('rmHear'); if (b) b.hidden = false; }); volHook(st, el); RTC = 'on'; drawRemote(); };
    pc.onicecandidate = ev => { if (ev.candidate) out({ t: 'rtc', ice: ev.candidate }); };
    pc.oniceconnectionstatechange = () => { if (pc) PRTC.ice = pc.iceConnectionState; };
    pc.onicegatheringstatechange = () => { if (pc) PRTC.gather = pc.iceGatheringState; };
    pc.onconnectionstatechange = () => { if (!pc) return; PRTC.conn = pc.connectionState; if (/failed|disconnected|closed/.test(pc.connectionState)) { RTC = 'off'; AP.toast('The sound link ' + pc.connectionState + ' (' + pc.iceConnectionState + '). Press LISTEN again; both must be on the same WiFi and KPC let through the PC\'s firewall.', 6000, 'bad'); drawRemote(); } };
    try { const off = await pc.createOffer(); await pc.setLocalDescription(off); out({ t: 'rtc', sdp: pc.localDescription.sdp, kind: 'offer' }); } catch (e) { PRTC.err = String(e.message || e); RTC = 'off'; AP.toast('Could not start the sound link: ' + esc(PRTC.err), 5000, 'bad'); drawRemote(); }
  }
  function rtcStop() { if (mic) { mic.getTracks().forEach(t => t.stop()); mic = null; } if (pc) { try { pc.close(); } catch (e) {} pc = null; } const el = $('rmAudio'); if (el) el.srcObject = null; volOff(); RTC = 'off'; const b = $('rmHear'); if (b) b.hidden = true; }
  /* Oct 25 (Brandon: 'I can hear now on the remote but it is not loud enough'): VOLUME on the remote tab, up to 4× (+12 dB) through a
     Web Audio gain. The <audio> element keeps the WebRTC track alive (Chrome gives Web Audio silence from a remote track no element plays)
     and is muted once the gain path runs; if Web Audio cannot be made, the element's own volume is used (1× at most). */
  let vCtx = null, vGain = null;
  const volGet = () => Math.max(0.2, Math.min(10, +S.rmVol || 2));   /* Oct 26 (Brandon: 'need more volume'): up to 10× behind a limiter, so a big boost cannot clip */
  function volHook(st, el) {
    try {
      const AC = G.AudioContext || G.webkitAudioContext; if (!AC) return;
      if (!vCtx) vCtx = new AC();
      if (vCtx.state === 'suspended') vCtx.resume().catch(() => {});
      const src = vCtx.createMediaStreamSource(st); vGain = vCtx.createGain(); vGain.gain.value = volGet();
      const lim = vCtx.createDynamicsCompressor(); lim.threshold.value = -8; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
      src.connect(vGain); vGain.connect(lim); lim.connect(vCtx.destination);
      el.muted = true; PRTC.vol = 'webaudio ' + volGet().toFixed(1) + 'x';
    } catch (e) { vGain = null; el.muted = false; el.volume = Math.min(1, volGet()); PRTC.vol = 'element ' + (e.message || e); }
  }
  function volOff() { try { if (vGain) vGain.disconnect(); } catch (e) {} vGain = null; }
  function volSet(v) { S.rmVol = Math.max(0.2, Math.min(10, +v || 1)); AP.save(); if (vGain) vGain.gain.value = S.rmVol; else { const el = $('rmAudio'); if (el) el.volume = Math.min(1, S.rmVol); } const t = $('rmVolT'); if (t) t.textContent = Math.round(S.rmVol * 100) + '%'; }
  const rtcSummary = () => Object.assign({ state: RTC }, PRTC, { trackLive: !!(pc && pc.getReceivers && pc.getReceivers().some(r => r.track && r.track.readyState === 'live')), micOn: !!(mic && mic.getAudioTracks().some(t => t.enabled)) });
  /* Nov 8: the iPhone way: Safari plays through the quiet earpiece while a mic is open, so the mic is opened on TALK and closed after */
  const LAZY = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || /[?&]iosmic=1/.test(location.search);
  async function lazyMic(on) {
    if (!pc) return false;
    const snd = pc.getSenders().find(x => !x.track || x.track.kind === 'audio') || (pc.getTransceivers()[0] || {}).sender; if (!snd) return false;
    if (on) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { AP.toast('Talking from this phone needs the https address (Tailscale): see the iPhone instructions. You can still listen and run the radio.', 7000, 'bad'); return false; }
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
      catch (e) { PRTC.micErr = String(e.name || e.message || e); AP.toast('No microphone (' + esc(PRTC.micErr) + '): allow the microphone for this page (Settings → Safari → Microphone).', 7000, 'bad'); return false; }
      const tr = mic.getAudioTracks()[0]; tr.enabled = true; await snd.replaceTrack(tr); return true;
    }
    try { await snd.replaceTrack(null); } catch (e) {} if (mic) { mic.getTracks().forEach(t => t.stop()); mic = null; } unlock(); return true;
  }
  function unlock() { try { if (vCtx && vCtx.state !== 'running') vCtx.resume().catch(() => {}); } catch (e) {} const el = $('rmAudio'); if (el && el.srcObject && el.paused) el.play().catch(() => {}); }
  function hold(on) {
    if (!LINK.paired) return;
    if (on && !(ST && ST.key)) { AP.toast('The PC cannot key the radio yet (CAT or VOX on the PC).', 4000, 'bad'); return; }
    if (LAZY && on && (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)) { lazyMic(true); return; }
    if (LAZY) lazyMic(!!on);
    HOLD = !!on; if (mic) mic.getAudioTracks().forEach(tr => { tr.enabled = HOLD; });
    out({ t: 'ptt', on: HOLD }); out({ t: 'alive', at: Date.now(), ptt: HOLD }); drawRemote();
  }

  /* the REMOTE screen */
  const tab = () => document.querySelector('.tabs [data-go="remote"]');
  function tabShow() { const b = tab(); if (b) b.hidden = !LINK.paired; if (!LINK.paired && document.body.dataset.screen === 'remote') AP.go('station'); }
  /* ⚙ PC SETTINGS on the phone: the PC's own levels / switches, applied there at once ({t:'pcset'}) */
  function pcSheet() {
    const p = (ST && ST.pcs) || null; if (!p) { AP.toast('Not on the link to the PC yet.', 3000, 'bad'); return; }
    const db = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' dB';
    AP.sheet('⚙ The home PC\'s settings', `<p class="hint">These change the PC at home right away (no remote desktop needed).</p>
      <label class="e slide">TX LEVEL (FT8 / digital tones) <b id="pcDbT">${db(p.db)}</b><input type="range" id="pcDb" min="-40" max="0" step="1" value="${p.db}"></label>
      <label class="e slide">🎙 VOICE LEVEL on the PC (its own keyer / mic) <b id="pcVdT">${db(p.vdb || 0)}</b><input type="range" id="pcVd" min="-20" max="30" step="1" value="${p.vdb || 0}"></label>
      <label class="e slide">RX LEVEL (what the decoders get; 0 is normal) <b id="pcRxT">${db(p.rxDb)}</b><input type="range" id="pcRx" min="-20" max="20" step="1" value="${p.rxDb}"></label>
      <label class="e wide">VOICE FROM THE PHONE<select id="pcVm"><option value="mic"${p.vmod === 'mic' ? ' selected' : ''}>Leave the radio's mode alone (SSB MOD SOURCE = REAR)</option><option value="data"${p.vmod === 'data' ? ' selected' : ''}>Switch the radio to DATA while I talk</option></select></label>
      ${p.cwvia ? `<label class="e wide">CW SENDS WITH<select id="pcCw">${[['audio', 'A tone through the sound card'], ['dtr', 'DTR key line'], ['rts', 'RTS key line'], ['cat', 'The radio\'s own keyer (CAT)']].map(([k, t]) => `<option value="${k}"${p.cwvia === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
      <div class="row"><button type="button" class="b${p.run ? '' : ' gold'}" id="pcRun">${p.run ? '⏹ STOP THE PC SOUND' : '🎧 START THE PC SOUND'}</button><button type="button" class="b${p.cat ? '' : ' gold'}" id="pcCat">${p.cat ? '🔌 DISCONNECT THE RADIO' : '📻 CONNECT THE RADIO'}</button></div>
      <p class="hint">MY VOICE (on the REMOTE tab) sets how loud your voice goes out; TX LEVEL here is for the digital modes.</p>`);
    const sl = (id, k, t) => { const r = $(id); r.oninput = () => { $(t).textContent = db(+r.value); }; r.onchange = () => out({ t: 'pcset', k, v: +r.value }); };
    sl('pcDb', 'db', 'pcDbT'); sl('pcRx', 'rxDb', 'pcRxT'); sl('pcVd', 'vdb', 'pcVdT');
    $('pcVm').onchange = () => out({ t: 'pcset', k: 'vmod', v: $('pcVm').value });
    if ($('pcCw')) $('pcCw').onchange = () => out({ t: 'pcset', k: 'cwvia', v: $('pcCw').value });
    $('pcRun').onclick = () => { out({ t: 'pcset', k: 'run', v: !p.run }); AP.shut(); };
    $('pcCat').onclick = () => { if (p.cat && !confirm2()) return; out({ t: 'pcset', k: 'cat', v: !p.cat }); AP.shut(); };
  }
  const confirm2 = () => true;
  /* 🎛 MORE CONTROLS on the phone (Nov 6): kpc-rigx.js's panel, fed by the PC's state (s.rx = what its radio takes + the values sent last) */
  let RXP = null, rxSig = '';
  function rxPanel(s) {
    if (!G.KPCRigX || !KPCRigX.panel) return;
    if (!RXP && $('rmPanel')) RXP = KPCRigX.panel($('rmPanel'), 'afterend', 'rmx', 'rmMore', {
      x: () => (ST && ST.rx && ST.rx.x) || {},
      set: (k, v) => { if (ST && ST.rx && ST.rx.x) ST.rx.x[k] = v; if (k === 'ritstep') out({ t: 'rx', k, v }); },
      send: (k, v, label) => out({ t: 'rx', k, v, label }),
      caps: () => (ST && ST.rx && ST.rx.caps) || { keys: [] }, can: k => !!(ST && ST.rx && ST.rx.caps.keys.includes(k)),
      tested: () => ((ST && ST.rx && ST.rx.tested) || '') + ' · the PC\'s radio',
      none: C => C.keys.length ? 'These go to the radio at the PC. The radio does not tell the app when its own knobs turn, so they show what was sent last.' + (ST && ST.rx && ST.rx.swr && ST.rx.swr.max ? ' SWR guard on the PC: ' + ST.rx.swr.max + ' : 1, ' + ({ warn: 'warns', power: 'warns + power to 25 %', stop: 'warns + stops transmitting' }[ST.rx.swr.act] || 'warns') + '.' : '') : 'The PC\'s radio takes none of these over CAT.'
    }, false);
    const el = $('rmMore'); if (!el) return;
    el.hidden = !s.rx || LINK.logOnly;
    const sig = JSON.stringify(s.rx || null); if (s.rx && sig !== rxSig) { rxSig = sig; RXP.draw(); }
  }
  function drawRemote() {
    if (document.body.dataset.screen !== 'remote' && !LINK.paired) return;
    const s = ST || {}, k = !!s.key;
    $('rmSt').textContent = s.station || LINK.name || '—';
    const rk = s.phone ? ((s.rig && s.rig.khz) || s.khz) : (s.khz || (s.rig && s.rig.khz));   /* Oct 25: on a digital mode show that mode's dial (the last dial read can be stale) */
    const d = $('rmVfo'); d.textContent = rk ? (rk / 1000).toFixed(4).replace(/(\.\d{3})(\d)$/, '$1.$2') : '—';
    $('rmRigMode').textContent = s.phone || (s.rig && s.rig.mode) || s.mode || '';
    /* phone modes: LSB USB CW AM FM DATA — picking one parks the PC's digital screen */
    document.querySelectorAll('#rmPModes [data-pm]').forEach(x => x.classList.toggle('on', x.dataset.pm === s.phone));
    rxPanel(s);
    const phone = !!s.phone, ex = s.ex || {}, has = s.extras || [];
    $('rmPanel').hidden = !phone;
    if (phone) {
      ['width', 'notch', 'nb', 'nr', 'power', 'mic'].forEach(n => { const w = $('rx_' + n); if (w) w.hidden = !has.includes(n); });
      $('rmNoEx').hidden = has.length > 0 || !s.catConn; $('rmNoEx').textContent = s.catConn ? 'This radio takes no panel settings over CAT (' + (s.phone || '') + ' still works: dial, mode, talk).' : 'Connect the radio on the PC to use the panel.';
      const wsel = $('rxWidth'); if (wsel && !wsel.matches(':focus')) wsel.value = String(ex.width || 2400);
      ['notch', 'nb', 'nr'].forEach(n => { const b = $('rx' + n[0].toUpperCase() + n.slice(1)); if (b) { b.classList.toggle('on', !!ex[n]); b.textContent = b.dataset.label + (ex[n] ? ' ON' : ' OFF'); } });
      ['power', 'mic'].forEach(n => { const r = $('rx' + n[0].toUpperCase() + n.slice(1)); if (r && !r.matches(':active')) { r.value = ex[n] != null ? ex[n] : r.value; $('rx' + n[0].toUpperCase() + n.slice(1) + 'T').textContent = r.value + (n === 'power' ? ' %' : ''); } });
      document.querySelectorAll('#rmVoice [data-voice]').forEach(x => x.classList.toggle('on', x.dataset.voice === (s.voice || 'natural')));
      const vk = $('rmVk'); if (vk) { const L = s.vk && s.vk.m ? s.vk.m.filter(x => x.has) : []; vk.hidden = !L.length || s.phone === 'CW' || s.phone === 'DATA';
        vk.innerHTML = L.length ? '<span class="kv"><i>VOICE KEYER</i></span>' + L.map(x => `<button type="button" class="chip${s.vk.on === x.i ? ' on' : ''}" data-rvk="${x.i}">${x.i + 1} ${esc(x.n)}</button>`).join('') + `<button type="button" class="chip${s.vk.auto ? ' on' : ''}" data-rvk="auto">🔁 AUTO CQ${s.vk.auto ? ' ON' : ''}</button><button type="button" class="chip halt" data-rvk="stop">⏹</button>` : ''; }
      $('rmCw').hidden = s.phone !== 'CW'; $('rmCwNo').hidden = s.phone !== 'CW' || !!s.cw;   /* s.cw = the PC can send CW one way or another */ $('rmTalkB').hidden = s.phone === 'CW' || s.phone === 'DATA';
    } else $('rmTalkB').hidden = false;
    $('rmMs').textContent = LINK.ms ? LINK.ms + ' ms' : '—';
    const st = $('rmState'); st.textContent = s.tx || s.ptt || s.tune ? 'TX' : s.run ? 'RX' : 'OFF'; st.className = 'state' + (s.tx || s.ptt || s.tune ? ' tx' : s.run ? ' rx' : '');
    $('rmCat').textContent = s.catConn ? (s.cat || 'Radio connected') : 'Radio not connected on the PC' + (s.cat ? ': ' + s.cat : '');
    $('rmCat').className = 'st' + (s.catConn ? ' ok' : ' bad');
    const b = $('rmBand'); const list = s.bands || []; if (b.options.length !== list.length || [...b.options].some((o, i) => o.value !== list[i])) b.innerHTML = list.map(x => `<option>${x}</option>`).join(''); if (s.band && b.value !== s.band) b.value = s.band;
    const mc = $('rmModes'), want = (s.modes || []).join('|'); if (mc.dataset.k !== want) { mc.dataset.k = want; mc.innerHTML = (s.modes || []).map(m => `<button type="button" class="chip mode" data-rmode="${esc(m)}">${esc(m)}</button>`).join(''); mc.querySelectorAll('[data-rmode]').forEach(x => { x.onclick = () => { out({ t: 'pmode', mode: '' }); out({ t: 'digi', op: 'mode', mode: x.dataset.rmode }); }; }); }
    mc.querySelectorAll('[data-rmode]').forEach(x => x.classList.toggle('on', !phone && x.dataset.rmode === s.mode));
    $('rmBand').hidden = phone; $('rmLines').hidden = phone; $('rmOps').hidden = phone;
    { const kb = $('rmKb'); if (kb) kb.hidden = phone || !/^(CW|RTTY|PSK31|HELL)$/.test(s.mode || ''); const k2 = $('rmKey2'); if (k2) k2.hidden = phone || s.mode !== 'CW'; }   /* Oct 24: type to send on the PC's keyboard modes */
    const bb = $('rmOps'), bk = JSON.stringify(s.buttons || []); if (bb.dataset.k !== bk) { bb.dataset.k = bk; bb.innerHTML = (s.buttons || []).map(x => `<button type="button" class="b ${esc(x.cls || '')}" data-rop="${esc(x.op)}" data-toggle="${x.toggle ? 1 : ''}" data-on="${esc(x.on || '')}" data-label="${esc(x.label)}">${esc(x.label)}</button>`).join(''); bb.querySelectorAll('[data-rop]').forEach(x => { x.onclick = () => out(x.dataset.toggle ? { t: 'digi', op: x.dataset.rop, on: !(ST && ST.digiOn) } : { t: 'digi', op: x.dataset.rop }); }); }
    bb.querySelectorAll('[data-rop]').forEach(x => { const onIt = !!(x.dataset.toggle && s.digiOn); x.classList.toggle('on', onIt); x.textContent = onIt && x.dataset.on ? x.dataset.on : x.dataset.label; x.disabled = !k && x.dataset.rop !== 'halt'; x.title = k ? '' : 'The PC cannot key the radio yet: connect it (CAT) or pick VOX there.'; });
    $('rmRun').textContent = s.run ? '⏹ STOP THE PC LISTENING' : '🎧 START THE PC LISTENING';
    $('rmListen').textContent = RTC === 'on' ? '🔇 SOUND OFF' : RTC === 'starting' ? '… CONNECTING SOUND' : '🔊 LISTEN';
    ['rmTalkB'].forEach(id => { const e = $(id); e.disabled = !k; e.title = k ? '' : 'The PC cannot key the radio yet: connect it (CAT) or pick VOX there.'; });
    $('rmTalkB').classList.toggle('on', HOLD); $('rmTalkB').textContent = HOLD ? '🎙 TALKING… (let go to stop)' : '🎙 HOLD TO TALK';
    $('rmLim').textContent = 'Talk limit ' + Math.round((s.lim || 180) / 60) + ' min · the PC drops PTT by itself if this phone goes quiet for 2.5 s.';
    drawMeters(s); drawSpec(s);
    const qs = $('rmQso'); const QL = s.qsoL || [];
    if (!phone && (QL.length || (s.qso && (s.qso.dx || s.qso.cq)))) {
      qs.hidden = false; const hms = t => { const d = new Date(t * 1000); return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + String(d.getUTCSeconds()).padStart(2, '0'); };
      qs.innerHTML = `<div class="qh"><b>${s.qso && s.qso.dx ? '⇄ ' + esc(s.qso.dx) : (s.qso && s.qso.cq ? '📣 CALLING CQ' : 'WHO IS CALLING ME')}</b>${s.qso && s.qso.dx ? `<span>SENT <b>${esc(s.qso.rs || '—')}</b> · RCVD <b>${esc(s.qso.rr || '—')}</b></span>` : ''}</div>` +
        QL.map(x => `<div class="dl ${x.tx ? 'mine' : 'me'}"><span>${hms(x.t).slice(0, 4)}</span><span>${x.tx ? 'Tx' : (x.db != null ? (x.db >= 0 ? '+' : '-') + String(Math.abs(Math.round(x.db))).padStart(2, '0') : '')}</span><span></span><span>${x.hz || ''}</span><span class="m">${esc(x.text)}</span></div>`).join('');
      drawRmLog();
    } else if (s.qso && s.qso.dx) { qs.hidden = false; qs.textContent = 'Working ' + s.qso.dx + ' (' + (s.qso.state || '') + ', Tx' + (s.qso.next || '') + ')'; } else if (s.qso && s.qso.heard != null) { qs.hidden = false; qs.textContent = 'APRS on the PC: ' + s.qso.heard + ' stations heard' + (s.qso.me ? ' · PC position known' : ''); } else { qs.hidden = true; qs.textContent = ''; }
  }
  /* ALC / power out / SWR bars (Brandon Oct 24): always on the screen while the radio is connected; grey when the PC has not read them yet */
  function drawMeters(s) {
    const el = $('rmMeters'); if (!el) return;
    const m = s.meters, show = !!s.catConn && !!(G.KPCCat || true);
    el.hidden = !show; if (!show) return;
    /* Oct 26: the meters are the KPCMeters widget (S meter, analog dials or digital bars, which ones = its ⚙) */
    if (G.KPCMeters) { if (!RMW) RMW = KPCMeters.mount($('rmMet'), { get: () => (ST && ST.meters) || null, tune: { ok: () => !!(ST && ST.meters), go: () => { AP.sheet('🔧 Tune the antenna?', '<p>The radio at home runs its own tuner: it <b>transmits a carrier</b> for a few seconds. Make sure the frequency is clear.</p><div class="row"><button type="button" class="b gold" id="rmTuneGo">🔧 YES, TUNE</button></div>'); $('rmTuneGo').onclick = () => { AP.shut(); out({ t: 'cat', op: 'atu' }); }; } } }); RMW.draw(); }   /* Nov 6: asks first (Brandon: never tune by itself) */
    const bar = (id, v, cls) => { const b = $(id), t = $(id + 'T'); if (!b) return; b.style.width = (v == null ? 0 : Math.max(0, Math.min(100, v))) + '%'; b.className = 'mb ' + (v == null ? 'off' : cls(v)); if (t) t.textContent = v == null ? '—' : v + (id === 'rmPo' ? '' : ''); };
    bar('rmAlc', m ? m.alc : null, v => v > 85 ? 'bad' : v > 60 ? 'warn' : 'ok');
    bar('rmPo', m ? m.po : null, v => 'ok');
    bar('rmSwr', m ? m.swr : null, v => v > 60 ? 'bad' : v > 30 ? 'warn' : 'ok');
    /* Oct 25 (Brandon: 'we need to know what SWR is'): the meter is a 0-100 % bar; Yaesu's scale is close to 1.0 at 0 %, 1.5 at ~15 %, 2.0 at ~30 %, 3.0 at ~60 %, over 3 above. Shown as 'SWR ≈' */
    { const t = $('rmSwrT'); if (t && m && m.swr != null) { const v = m.swr, est = v <= 0 ? 1.0 : v <= 30 ? 1 + v / 30 : v <= 60 ? 2 + (v - 30) / 30 : 3 + (v - 60) / 40 * 2; t.textContent = (m.tx || v > 0 ? '≈' + est.toFixed(1) : '—') + (v > 60 ? '⚠' : ''); } }
    { const t = $('rmPoT'); if (t && m && m.po != null) t.textContent = m.po + ' %'; }
    const pw = $('rmPwrT'); if (pw) pw.textContent = m && m.pwr != null ? m.pwr + ' %' : '—';
    const age = $('rmMetAge'); if (age) age.textContent = m ? (m.tx ? 'transmitting · ' : '') + 'read ' + Math.round((Date.now() - m.at) / 1000) + ' s ago' : 'waiting for the PC to read the meters…';
    const pr = $('rxPower'); if (pr && m && m.pwr != null && document.activeElement !== pr && !pr.dataset.touch) { pr.value = m.pwr; const t = $('rxPowerT'); if (t) t.textContent = m.pwr + ' %'; }
  }
  /* band view: what the PC's waterfall sees right now, 200-2800 Hz; gold = TX spot, blue = RX spot, dots = stations decoded in the last 2 min; tap = move TX there */
  function drawSpec(s) {
    const c = $('rmSpec'); if (!c) return;
    const sp = s.spec; const wrap = c.closest('.specw'); if (wrap) wrap.hidden = !sp || !!s.phone;
    if (!sp) return;
    const W = c.clientWidth || 320, H = 72; if (c.width !== W * 2) { c.width = W * 2; c.height = H * 2; }
    const g = c.getContext('2d'); g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement), gold = cs.getPropertyValue('--goldT').trim() || '#E8B84A', text = cs.getPropertyValue('--sub').trim() || '#999';
    const db = sp.db || [], N = db.length, lo = Math.min(...db.filter(v => v > -150)), hi = Math.max(...db); const x2 = hz => (hz - sp.f0) / (sp.f1 - sp.f0) * W;
    g.fillStyle = 'rgba(127,127,127,.12)'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < N; i++) { const v = (db[i] - lo) / Math.max(6, hi - lo); const h = Math.max(1, v * (H - 14)); g.fillStyle = `rgba(90,170,255,${0.35 + 0.6 * v})`; g.fillRect(i * W / N, H - 12 - h, W / N + 0.5, h); }
    (sp.taken || []).forEach(hz => { g.fillStyle = text; g.beginPath(); g.arc(x2(hz), H - 6, 2.2, 0, 7); g.fill(); });
    const bw = (s.mode === 'FT4' ? 83 : 50);
    if (sp.rx) { g.strokeStyle = '#4aa3ff'; g.lineWidth = 1.5; g.strokeRect(x2(sp.rx - bw / 2), 2, x2(sp.rx + bw / 2) - x2(sp.rx - bw / 2), H - 16); }
    if (sp.tx) { g.strokeStyle = gold; g.setLineDash([4, 3]); g.lineWidth = 2; g.strokeRect(x2(sp.tx - bw / 2), 2, x2(sp.tx + bw / 2) - x2(sp.tx - bw / 2), H - 16); g.setLineDash([]); }
    g.fillStyle = text; g.font = '600 10px sans-serif'; [500, 1000, 1500, 2000, 2500].forEach(hz => g.fillText(String(hz), x2(hz) - 10, H - 1));
    c.dataset.f0 = sp.f0; c.dataset.f1 = sp.f1;
  }
  /* the log on the remote screen = this phone's own log (it is kept in step with the PC's over the link) */
  function drawRmLog() {
    const el = $('rmLog'); if (!el || !G.KPCLog) return;
    const Q = KPCLog.qs().slice(-8).reverse();
    el.innerHTML = `<div class="qh"><b>📒 LAST CONTACTS (${KPCLog.count()})</b></div>` + (Q.map(q => `<div class="dl"><span>${esc(String(q.t || '').slice(0, 4))}</span><span class="m"><b>${esc(q.call)}</b> ${esc(q.band || '')} ${esc(q.mode || '')}${q.refs && q.refs.length ? ' 🌲' + esc(q.refs.join(' ')) : ''}${q.rs ? ' ' + esc(q.rs) + '/' + esc(q.rr || '') : ''}</span></div>`).join('') || '<div class="empty">Contacts made on the PC show up here as they are logged.</div>');
  }
  function drawLines() {
    const el = $('rmLines'); if (!el) return;
    const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    const hms = t => { const d = new Date(t * 1000); return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + String(d.getUTCSeconds()).padStart(2, '0'); };
    const fdb = n => (n >= 0 ? '+' : '-') + String(Math.min(49, Math.abs(Math.round(n)))).padStart(2, '0');
    el.innerHTML = LN.map(x => x.sep != null ? `<div class="dsep">${hms(x.t).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3')} ── ${esc(x.mode)}${x.n ? ' · ' + x.n : ''}</div>`
      : `<div class="dl ${x.cls || (x.tx ? 'mine' : x.me ? 'me' : x.cq ? (x.cqw ? 'cqp' : 'cq') : '')}" data-rl="${x.id || ''}" role="button" tabindex="0"><span>${hms(x.t).slice(0, 4)}</span><span>${x.tx ? 'Tx' : x.db != null ? fdb(x.db) : ''}</span><span>${x.tx || x.dt == null ? '' : (+x.dt || 0).toFixed(1)}</span><span>${x.hz || ''}</span><span class="m">${esc(x.text)}</span></div>`).join('')
      || '<div class="empty">What the PC hears shows up here. Press START THE PC LISTENING, then tap a line to call that station.</div>';
    if (stick) el.scrollTop = el.scrollHeight;
  }
  function linkCard(busy) {
    const el = $('rmLink'); if (!el) return;
    const onIt = LINK.on && LINK.paired;
    el.innerHTML = `
      <div class="grid2">
        <label class="e">PC ADDRESS(ES)<input id="rmAddr" spellcheck="false" autocapitalize="off" inputmode="url" value="${esc(S.rmAddr || '')}" placeholder="192.168.1.5 100.101.102.103"></label>
        <label class="e">THIS ${AP.native ? 'PHONE' : 'DEVICE'}'S NAME<input id="rmName" value="${esc(S.rmName || '')}" maxlength="24"></label>
        <label class="e">PAIR CODE (the 6 digits on the PC${S.rmTok ? ': only if the PC asks again' : ''})<input id="rmPin" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="482 913"></label>
      </div>
      <div class="row">${onIt ? '<button type="button" class="b" id="rmDis">⏏ LEAVE THE LINK</button><button type="button" class="b gold" id="rmGoScr">📡 OPEN THE REMOTE SCREEN</button>' : `<button type="button" class="b gold" id="rmConn"${busy ? ' disabled' : ''}>${busy ? esc(busy) : '🔗 CONNECT TO THE PC'}</button><button type="button" class="b" id="rmTest">🩺 TEST THE LINK</button>`}${S.rmTok && !onIt ? '<button type="button" class="b" id="rmForget">FORGET THIS PC</button>' : ''}</div>
      <div class="st ${onIt ? 'ok' : ''}">${onIt ? 'On the link with ' + esc(LINK.name) + ' at ' + esc(LINK.addr || '') + '.' : LINK.wait ? '⏳ The PC has the code. Waiting for you to press ✓ APPROVE on the PC… (not connected yet)' : LINK.on ? 'Reached the PC, checking the pair code… (not connected yet)' : S.rmTok ? 'Paired. Press CONNECT: this ' + (AP.native ? 'phone' : 'device') + ' tries each address in turn.' : 'Not paired yet.'}</div>
      <button type="button" class="b upsw${S.rmLogOnly ? ' on' : ''}" id="rmLogOnly"><b>${S.rmLogOnly ? 'ON' : 'OFF'}</b> <span>📒 SHARE THE LOG ONLY <small>(Field Day / multi-op: this device keeps its own radio and sound; its contacts go to the PC and on to the other stations)</small></span></button>
      <p class="hint">Open the KPC app on the Windows PC with the radio, STATION → Remote → LET MY PHONE IN. Type its addresses here (the home WiFi one, and the Tailscale one for away from home, with a space between), and the 6-digit pair code once. Then the PC asks you to APPROVE.</p>`;
    $('rmAddr').onchange = () => { S.rmAddr = $('rmAddr').value.trim(); AP.save(); };
    $('rmName').onchange = () => { S.rmName = $('rmName').value.trim() || S.rmName; AP.save(); };
    if ($('rmConn')) $('rmConn').onclick = () => { S.rmAddr = $('rmAddr').value.trim(); S.rmName = $('rmName').value.trim() || S.rmName; AP.save(); connect($('rmPin') ? $('rmPin').value : ''); };
    if ($('rmTest')) $('rmTest').onclick = () => { S.rmAddr = $('rmAddr').value.trim(); AP.save(); testLink(); };
    if ($('rmDis')) $('rmDis').onclick = () => disconnect();
    if ($('rmGoScr')) $('rmGoScr').onclick = () => AP.go('remote');
    if ($('rmForget')) $('rmForget').onclick = () => { S.rmTok = ''; AP.save(); linkCard(''); };
    if ($('rmLogOnly')) $('rmLogOnly').onclick = () => { S.rmLogOnly = !S.rmLogOnly; AP.save(); linkCard(''); };
  }
  function clientStart() {
    linkCard(''); tabShow();
    const T = $('rmTalkB');
    const down = e => { e.preventDefault(); hold(true); }, up = e => { if (e) e.preventDefault(); hold(false); };
    T.addEventListener('pointerdown', down); T.addEventListener('pointerup', up); T.addEventListener('pointercancel', up); T.addEventListener('pointerleave', () => { if (HOLD) up(); });
    T.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { if (!HOLD) hold(true); e.preventDefault(); } }); T.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') hold(false); });
    T.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('blur', () => { if (HOLD) hold(false); }); document.addEventListener('visibilitychange', () => { if (document.hidden && HOLD) hold(false); });
    $('rmRun').onclick = () => out({ t: 'run', on: !(ST && ST.run) });
    $('rmListen').onclick = () => { if (RTC === 'off') { if (N.keepAwake) N.keepAwake(true, true); if (vCtx && vCtx.state === 'suspended') vCtx.resume().catch(() => {}); rtcStart().catch(e => { RTC = 'off'; AP.toast('Sound link failed: ' + esc(e.message || e), 5000, 'bad'); drawRemote(); }); } else { rtcStop(); drawRemote(); } };
    { const v = $('rmVdb'); if (v) { v.value = +S.rmVdb || 0; const t = $('rmVdbT'); if (t) t.textContent = ((+S.rmVdb || 0) > 0 ? '+' : '') + (+S.rmVdb || 0) + ' dB'; v.oninput = () => { S.rmVdb = Math.max(-20, Math.min(30, +v.value || 0)); AP.save(); if (t) t.textContent = (S.rmVdb > 0 ? '+' : '') + S.rmVdb + ' dB'; out({ t: 'alive', at: Date.now(), ptt: HOLD, vdb: S.rmVdb }); }; } }
    if ($('rmPcs')) $('rmPcs').onclick = () => pcSheet();
    { const r = $('rmVol'); if (r) { r.value = volGet(); const t = $('rmVolT'); if (t) t.textContent = Math.round(volGet() * 100) + '%'; r.oninput = () => volSet(r.value); } }
    $('rmBand').onchange = () => out({ t: 'digi', op: 'band', band: $('rmBand').value });
    /* the front panel */
    document.querySelectorAll('#rmPModes [data-pm]').forEach(b => { b.onclick = () => out({ t: 'pmode', mode: b.dataset.pm }); });
    let STEP = +LS('kpcRmStep', 1000);
    const stepBtns = () => document.querySelectorAll('#rmSteps [data-step]').forEach(x => x.classList.toggle('on', +x.dataset.step === STEP));
    document.querySelectorAll('#rmSteps [data-step]').forEach(b => { b.onclick = () => { STEP = +b.dataset.step; SV('kpcRmStep', STEP); stepBtns(); }; }); stepBtns();
    $('rmDown').onclick = () => out({ t: 'step', hz: -STEP }); $('rmUp').onclick = () => out({ t: 'step', hz: STEP });
    $('rmVfo').onclick = () => {
      AP.sheet('Go to a frequency', `<label class="e">FREQUENCY (kHz)<input id="rmKhz" inputmode="decimal" value="${ST && ST.rig && ST.rig.khz ? ST.rig.khz : ''}" placeholder="14285"></label><p class="hint">kHz: 14285 or 7.188 both work (under 1000 = MHz).</p>`,
        () => { let v = parseFloat(($('rmKhz') || {}).value); if (!isFinite(v)) return; if (v < 1000) v *= 1000; out({ t: 'vfo', khz: Math.round(v * 1000) / 1000, mode: (ST && ST.phone) || '' }); });
      setTimeout(() => { try { $('rmKhz').focus(); $('rmKhz').select(); } catch (e) {} }, 60);
    };
    $('rxWidth').onchange = () => out({ t: 'extra', name: 'width', value: +$('rxWidth').value });
    ['notch', 'nb', 'nr'].forEach(n => { const b = $('rx' + n[0].toUpperCase() + n.slice(1)); b.dataset.label = b.textContent.replace(/ (ON|OFF)$/, ''); b.onclick = () => out({ t: 'extra', name: n, value: !(ST && ST.ex && ST.ex[n]) }); });
    ['power', 'mic'].forEach(n => { const r = $('rx' + n[0].toUpperCase() + n.slice(1)); r.oninput = () => { $('rx' + n[0].toUpperCase() + n.slice(1) + 'T').textContent = r.value + (n === 'power' ? ' %' : ''); }; r.onchange = () => out({ t: 'extra', name: n, value: +r.value }); });
    document.querySelectorAll('#rmVoice [data-voice]').forEach(b => { b.onclick = () => out({ t: 'voice', preset: b.dataset.voice }); });
    document.addEventListener('click', e => { const b = e.target.closest('[data-rvk]'); if (!b) return; const v = b.dataset.rvk; if (v === 'stop') out({ t: 'vk', op: 'stop' }); else if (v === 'auto') out({ t: 'vk', op: 'auto', on: !(ST && ST.vk && ST.vk.auto) }); else out({ t: 'vk', op: 'play', i: +v }); });
    if ($('rmKbSend')) { const go = () => { const t = $('rmKbT').value.trim(); if (!t) return; out({ t: 'digi', op: 'send', text: t }); $('rmKbT').value = ''; }; $('rmKbSend').onclick = go; $('rmKbT').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }); $('rmKbStop').onclick = () => out({ t: 'digi', op: 'halt' }); }
    $('rmCwSend').onclick = () => { const t = $('rmCwT').value.trim(); if (!t) return; out({ t: 'cw', text: t, wpm: +$('rmCwWpm').value || 0 }); $('rmCwT').value = ''; };
    $('rmCwStop').onclick = () => out({ t: 'cwstop' });
    /* the phone's hand-keying pads (the CW panel + the digital CW screen): every edge goes to the PC with this phone's clock */
    if (G.KPCModes5 && KPCModes5.keyPad) { const sink = { down: async () => { out({ t: 'key', d: 1, at: performance.now() }); return true; }, up: async () => { out({ t: 'key', d: 0, at: performance.now() }); } };
      KPCModes5.keyPad($('rmKey'), sink); KPCModes5.keyPad($('rmKey2'), sink); }
    document.querySelectorAll('#rmCwMac [data-cw]').forEach(b => { b.onclick = () => out({ t: 'cw', text: b.dataset.cw.replace('{me}', AP.me().call || '').replace('{dx}', ($('rmCwDx').value || '').toUpperCase()), wpm: +$('rmCwWpm').value || 0 }); });
    $('rmSync').onclick = () => { out({ t: 'sync', since: W['pc'] || 0 }); AP.toast('Asked the PC for its new contacts; yours go over by themselves.', 3000); };
    $('rmLines').addEventListener('click', e => { const r = e.target.closest('[data-rl]'); if (r) out({ t: 'digi', op: 'call', id: +r.dataset.rl }); });
    AP.on('log', ev => { if (LINK.paired && ev && ev.recs && ev.why !== 'merge' && ev.why !== 'load') out({ t: 'syncd', recs: ev.recs }); if (LINK.paired) drawRmLog(); });
    const sc = $('rmSpec'); if (sc) sc.addEventListener('click', e => { const r = sc.getBoundingClientRect(), f0 = +sc.dataset.f0 || 200, f1 = +sc.dataset.f1 || 2800; const hz = Math.round(f0 + (e.clientX - r.left) / r.width * (f1 - f0)); out({ t: 'digi', op: 'txhz', hz }); AP.toast('TX spot → ' + hz + ' Hz on the PC.', 2000); });
    ['rmPwrOn', 'rmPwrOff'].forEach(id => { const b = $(id); if (b) b.onclick = () => { if (id === 'rmPwrOff' && !confirm('Turn the radio OFF? You may not be able to turn it back on from here (most radios cannot be woken over USB).')) return; out({ t: 'cat', op: 'power', on: id === 'rmPwrOn' }); }; });
    const pr = $('rxPower'); if (pr) { pr.addEventListener('pointerdown', () => { pr.dataset.touch = '1'; }); pr.addEventListener('change', () => { delete pr.dataset.touch; }); }
    const hb = $('rmHear'); if (hb) hb.onclick = () => { const el = $('rmAudio'); if (el) el.play().then(() => { PRTC.play = 'playing'; hb.hidden = true; }).catch(e => { PRTC.play = 'blocked: ' + (e.name || e); }); };
    AP.on('screen', s => { if (s === 'remote') { drawRemote(); drawLines(); } });
  }

  /* ======================================================================== start */
  if (BASE) {
    baseStart();
    /* on the PC the 'connect to a PC' half is for the rare case of a laptop reaching the home PC: tucked away */
    const l = $('rmLink'); if (l && l.parentNode) { const d = document.createElement('details'); d.className = 'fold'; d.innerHTML = '<summary>Use this PC as the remote for ANOTHER PC that has the radio</summary>'; l.parentNode.insertBefore(d, l); d.appendChild(l); }
  } else { const b = $('rmBase'); if (b) b.hidden = true; }
  clientStart();
  /* a spot tapped on the phone while on the link: the PC's radio goes there */
  const spot = s => { if (!LINK.paired) return false; out({ t: 'spot', khz: s.khz, mode: s.mode || '', call: s.call, refs: s.refs || [] }); AP.go('remote'); return true; };
  G.KPCRemote = { _unlock: () => unlock(), _lazy: () => LAZY, _rxPanel: () => RXP, base: BASE, link: () => LINK, logOnly: () => !!(LINK.paired && LINK.logOnly), connect, disconnect, spot, state: () => ST, clients: () => [...CL.values()], holder: () => HOLDER, ptt: () => PTT, pttSet, onMsg, syncIn, W, rtcReport, rtcPhone: () => (RTC === 'off' && !PRTC.at ? null : rtcSummary()), _mute: on => { MUTE = !!on; }, _out: out, _fakeState: st => { LINK.paired = true; ST = st; drawRemote(); } };
})(window);
