/* KPC app: the FT8 / FT4 screen. Listens to the radio through the app's own sound (KPCNative.audio), decodes every slot,
   draws a real waterfall, and works a contact by itself (auto sequence Tx1-6) straight into the log.
   Rules learned on Brandon's tablet (Oct 20): key the radio, LET GO of the USB control port, then send sound;
   no dial reads while transmitting; CAT PTT or VOX only; 250 ms sound buffer. */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const AP = G.KPCApp, A = AP.audio, esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const DIAL = {
    FT8: { '160m': 1840, '80m': 3573, '60m': 5357, '40m': 7074, '30m': 10136, '20m': 14074, '17m': 18100, '15m': 21074, '12m': 24915, '10m': 28074, '6m': 50313, '2m': 144174 },
    FT4: { '80m': 3575, '40m': 7047.5, '30m': 10140, '20m': 14080, '17m': 18104, '15m': 21140, '12m': 24919, '10m': 28180, '6m': 50318 }
  };
  const S = Object.assign({
    mode: 'FT8', band: '20m', txHz: 1500, rxHz: 1500, hold: true, auto: true, first: true, even: true,
    keepCq: false, cqw: '', wd: 2, runMin: 30, huntAny: false, deep: false, noGrid: false, potaOnly: false, autoClear: true, ov: {}, hl: { park: 1, dxped: 1, event: 1, dx: 0, newc: 0, newb: 0 }
  }, LS('kpcAppDigi', {}));
  /* 0.3.2 (Brandon Oct 22: 'get rid of the button'): the CLEAR TX SPOT button is gone, the automatic one does the job, so it starts ON */
  if (S.acv !== 1) { S.autoClear = true; S.acv = 1; }
  /* Oct 23 (Brandon: 'auto default cq to just cq not pota'): plain CQ, once for everyone; CQ POTA stays in the ⚙ sheet */
  if (S.cqv !== 1) { S.cqw = ''; S.cqv = 1; }
  /* Nov 1 (Brandon: 'call cq option … do it from 2 to 10 minutes'; auto 'adjust time 5 minutes to 8 hours') */
  if (!(+S.wd >= 2)) S.wd = 2; if (+S.wd > 10) S.wd = 10;
  /* Oct 28 (Fable, readiness review): measured on synthetic signals in noise, 'deeper decoding' copies one more dB (−18 6/6 vs 4/6, −19 4/6 vs 2/6) for ~45 ms a pass: on by default on a PC (a phone keeps it off for the battery) */
  if (S.dpv !== 1) { if (!(G.KPCNative && KPCNative.native)) S.deep = true; S.dpv = 1; }
  const save = () => SV('kpcAppDigi', S);

  const slotLen = () => S.mode === 'FT4' ? 7.5 : 15;
  const stdK = () => DIAL[S.mode][S.band] || DIAL.FT8['20m'];
  const ovKey = () => S.mode + '|' + S.band;
  const dialK = () => (S.ov && S.ov[ovKey()]) || stdK();
  const nowS = () => AP.now() / 1000;                      /* the corrected clock (STATION → CALIBRATE) */
  const dev = ms => ms - (AP.now() - Date.now());         /* corrected time → device time, for the sound's 'at' */
  const pad = n => String(n).padStart(2, '0');
  const hms = t => { const d = new Date(t * 1000); return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()); };
  const hmsC = t => hms(t).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3');
  const clean = c => String(c || '').replace(/[<>]/g, '').toUpperCase();
  const isGrid = t => /^[A-R]{2}\d{2}$/i.test(t) && String(t).toUpperCase() !== 'RR73';
  const isRpt = t => /^[+-]\d{2}$/.test(t);
  const isRRpt = t => /^R[+-]\d{2}$/.test(t);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmtDb = n => (n >= 0 ? '+' : '-') + String(Math.min(49, Math.abs(Math.round(n)))).padStart(2, '0');

  /* ================= sound in: ring buffer at 12 kHz ================= */
  const R12 = 12000, RING = R12 * 40;
  let ring = new Float32Array(RING), n12 = 0, t0 = 0, ENG = null, RUN = false, ACTIVE = true;   /* ACTIVE = FT8/FT4 is the mode on screen (the frame routes sound only then) */
  let lastDec = -1, txSlots = new Set(), dtAvg = [];
  /* Oct 24 (Brandon's PC: 'decoder restart: no result' every 38 s = 2.5 slots, never a decode): decodeSlot() returned early forever when the
     engine had never loaded (ENG null) and the failure was only in the console. Now a load failure is loud (toast + report), every decode
     pass is timed, and the sample buffer is checked before the wasm sees it. DIAG is what the builders' report shows. */
  const DIAG = { loaded: false, how: '', loadErr: '', loads: 0, passes: 0, decoded: 0, passMs: [], lastWhy: '', behindS: 0, skips: { noEngine: 0, tx: 0, notReady: 0, badBuf: 0 } };
  async function engine() {
    if (ENG) return ENG;
    try { ENG = await KPCFT8.load('kpc-ft8.wasm?v=20261017a'); DIAG.loaded = true; DIAG.how = KPCFT8.load.how || ''; DIAG.loadErr = ''; DIAG.loads++; }
    catch (e) { DIAG.loaded = false; DIAG.loadErr = String(KPCFT8.load.err || e.message || e); console.error('decoder load failed: ' + DIAG.loadErr); if (Date.now() - (engine.said || 0) > 60000) { engine.said = Date.now(); AP.toast('⚠ The FT8 decoder could not load (' + DIAG.loadErr.slice(0, 80) + '). Copy a builders\' report from STATION → Alerts & help.', 9000, 'bad'); } throw e; }
    return ENG;
  }
  AP.on('clock', () => { lastDec = -1; dtAvg = []; });

  /* sound in, handed over by the mode frame only while FT8 or FT4 is the active mode */
  function rx(c) {
    if (!c.pcm || !c.pcm.length) return;
    if (!t0) t0 = c.t;
    t0 = c.t + (AP.now() - Date.now()) - n12 / R12 * 1000;   /* keep the sample count lined up with the (corrected) clock */
    for (let i = 0; i < c.pcm.length; i++) ring[(n12 + i) % RING] = c.pcm[i];
    n12 += c.pcm.length;
  }
  AP.on('run', on => { RUN = on; $('dgWfOff').hidden = on; if (on) { lastDec = -1; n12 = 0; t0 = 0; wfLoop(); } else { TXON = false; avgSpec = null; chk(); } });

  /* ================= waterfall ================= */
  const wf = $('dgWf'), sc = $('dgSc');
  let F0 = 200, F1 = 2800, lastSpec = null, avgSpec = null, lastSlotLine = -1;
  const hzToX = hz => (hz - F0) / (F1 - F0) * wf.width;
  const xToHz = x => Math.round(F0 + x / wf.width * (F1 - F0));

  /* our own spectrum: the native sound comes in as plain samples, so there is no AnalyserNode to borrow */
  const FN = 4096, HB = FN >> 1, BINHZ = R12 / FN;        /* Oct 23 (Brandon: 'sharper waterfall'): 2.9 Hz bins, was 5.9 */
  const win = new Float32Array(FN), rev = new Uint16Array(FN);
  const fre = new Float32Array(FN), fim = new Float32Array(FN), mag = new Float32Array(HB);
  (function initFft() {
    for (let i = 0; i < FN; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FN - 1));
    const bits = Math.log2(FN);
    for (let i = 0; i < FN; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  })();
  function fft() {
    for (let i = 0; i < FN; i++) { const j = rev[i]; if (j > i) { let t = fre[i]; fre[i] = fre[j]; fre[j] = t; t = fim[i]; fim[i] = fim[j]; fim[j] = t; } }
    for (let len = 2; len <= FN; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < FN; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < h; k++) {
          const ar = fre[i + k], ai = fim[i + k], br = fre[i + k + h], bi = fim[i + k + h];
          const vr = br * cr - bi * ci, vi = br * ci + bi * cr;
          fre[i + k] = ar + vr; fim[i + k] = ai + vi; fre[i + k + h] = ar - vr; fim[i + k + h] = ai - vi;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function spectrum() {
    if (n12 < FN) return null;
    const s = n12 - FN;
    for (let i = 0; i < FN; i++) { fre[i] = ring[((s + i) % RING + RING) % RING] * win[i]; fim[i] = 0; }
    fft();
    for (let i = 0; i < HB; i++) mag[i] = 10 * Math.log10(fre[i] * fre[i] + fim[i] * fim[i] + 1e-14);
    return mag;
  }
  /* WSJT-X style: dark navy → blue → cyan → yellow → white */
  const STOPS = [[0, 4, 8, 28], [.18, 12, 26, 96], [.38, 22, 70, 170], [.55, 28, 130, 205], [.70, 50, 200, 215], [.84, 160, 235, 150], [.93, 240, 225, 80], [1, 255, 255, 230]];
  const LUT = (function () {
    const t = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const v = i / 255; let a = STOPS[0], b = STOPS[STOPS.length - 1];
      for (let k = 0; k < STOPS.length - 1; k++) if (v >= STOPS[k][0] && v <= STOPS[k + 1][0]) { a = STOPS[k]; b = STOPS[k + 1]; break; }
      const f = b[0] === a[0] ? 0 : (v - a[0]) / (b[0] - a[0]);
      t[i * 3] = a[1] + (b[1] - a[1]) * f; t[i * 3 + 1] = a[2] + (b[2] - a[2]) * f; t[i * 3 + 2] = a[3] + (b[3] - a[3]) * f;
    }
    return t;
  })();
  function wfSize() {
    const w = Math.max(300, Math.round(wf.clientWidth || 600));
    if (wf.width !== w) { wf.width = w; sc.width = w; drawScale(); }
    if (wf.height !== wf.clientHeight) wf.height = wf.clientHeight || 190;
    if (sc.height !== 20) sc.height = 20;
  }
  function drawScale() {
    const g = sc.getContext('2d'), W = sc.width, H = sc.height, cs = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, W, H);
    g.fillStyle = cs.getPropertyValue('--panel2').trim() || '#232B36'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(150,150,150,.6)'; g.fillStyle = cs.getPropertyValue('--sub').trim() || '#9AA6B5'; g.font = '10px ui-monospace,monospace';
    const st = F1 - F0 > 1600 ? 250 : F1 - F0 > 700 ? 100 : 50, bg = st * 2;
    for (let hz = Math.ceil(F0 / st) * st; hz < F1; hz += st) {
      const x = hzToX(hz), big = hz % bg === 0;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, big ? 6 : 3); g.stroke();
      if (big) g.fillText(String(hz), Math.min(W - 24, Math.max(1, x - 12)), 17);
    }
  }
  let wfT = 0, rafOn = false;
  function wfLoop() {
    if (!RUN) { rafOn = false; return; }
    rafOn = true; requestAnimationFrame(wfLoop);
    const t = performance.now();
    if (t - wfT < (S.mode === 'FT4' ? 70 : 120) || document.hidden || document.body.dataset.screen !== 'digi') return;
    wfT = t;
    wfSize();
    const sp = spectrum(); if (!sp) return;
    lastSpec = sp;
    if (!avgSpec) avgSpec = Float32Array.from(sp); else for (let i = 0; i < HB; i++) avgSpec[i] = avgSpec[i] * 0.9 + sp[i] * 0.1;
    const g = wf.getContext('2d'), W = wf.width, H = wf.height;
    const row = g.createImageData(W, 1), vals = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const a = Math.max(0, Math.round((F0 + x / W * (F1 - F0)) / BINHZ)), b = Math.min(HB - 1, Math.round((F0 + (x + 1) / W * (F1 - F0)) / BINHZ));
      let m = -200; for (let i = a; i <= b; i++) if (sp[i] > m) m = sp[i];
      vals[x] = m;
    }
    const sorted = Array.from(vals).sort((p, q) => p - q), med = sorted[Math.floor(W * 0.35)] || -100;
    const gain = 255 / (26 * Math.pow(2, -(+S.wfC || 0) / 50)), lift = 2 + (+S.wfB || 0) / 10;   /* CONTRAST −100..100, BRIGHTNESS −100..100 (⚙ FT8) */
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, Math.round((vals[x] - med + lift) * gain)));
      row.data[x * 4] = LUT[v * 3]; row.data[x * 4 + 1] = LUT[v * 3 + 1]; row.data[x * 4 + 2] = LUT[v * 3 + 2]; row.data[x * 4 + 3] = 255;
    }
    g.drawImage(wf, 0, 0, W, H - 1, 0, 1, W, H - 1);
    g.putImageData(row, 0, 0);
    const sl = Math.floor(nowS() / slotLen());
    if (sl !== lastSlotLine) {
      lastSlotLine = sl;
      g.fillStyle = 'rgba(232,184,74,.8)'; g.fillRect(0, 0, W, 1);
      g.font = '10px ui-monospace,monospace'; g.fillStyle = 'rgba(232,184,74,.95)'; g.fillText(hmsC(sl * slotLen()), 4, 12);
    }
  }
  /* the RX / TX markers and the CLEAR SPOT box sit over the waterfall, so scrolling never wipes them */
  const MK = document.createElement('div');
  MK.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  MK.innerHTML = '<i id="mkRx"></i><i id="mkTx"></i><i id="mkCl"></i>';
  wf.parentElement.appendChild(MK);
  const mkCss = (el, c, w) => { el.style.cssText = 'position:absolute;top:0;bottom:20px;width:' + w + 'px;' + c; };
  function marks() {
    const W = wf.clientWidth || 1, bw = Math.max(3, (S.mode === 'FT4' ? 83 : 50) / (F1 - F0) * W);
    const px = hz => (hz - F0) / (F1 - F0) * W;
    mkCss($('mkRx'), 'background:rgba(109,180,245,.28);border-left:2px solid #6DB4F5;left:' + px(S.rxHz).toFixed(1) + 'px;', bw);
    mkCss($('mkTx'), 'background:rgba(243,154,85,.26);border-left:2px solid #F39A55;left:' + px(S.txHz).toFixed(1) + 'px;', bw);
    const c = $('mkCl');
    if (CLEAR != null) mkCss(c, 'border:2px dashed #E8B84A;background:rgba(232,184,74,.1);left:' + px(CLEAR).toFixed(1) + 'px;', bw);
    else c.style.cssText = 'display:none';
    if (document.activeElement !== $('dgRxT')) $('dgRxT').value = S.rxHz; if (document.activeElement !== $('dgTxT')) $('dgTxT').value = S.txHz;
  }
  /* tap = listen there · hold (or right-click / shift) = move my transmit frequency */
  let hold = null, held = false;
  function pointHz(e) { const r = wf.getBoundingClientRect(); return Math.max(F0 + 20, Math.min(F1 - 20, xToHz((e.clientX - r.left) * wf.width / r.width))); }
  wf.addEventListener('pointerdown', e => {
    held = false; const hz = pointHz(e);
    if (e.shiftKey || e.button === 2) { setTx(hz); held = true; return; }
    hold = setTimeout(() => { held = true; setTx(hz); AP.toast('Transmit frequency moved to ' + hz + ' Hz.', 2000); }, 450);
  });
  wf.addEventListener('pointerup', e => { clearTimeout(hold); if (!held) setRx(pointHz(e)); });
  wf.addEventListener('pointerleave', () => clearTimeout(hold));
  wf.addEventListener('contextmenu', e => e.preventDefault());
  /* Oct 26 (Brandon: 'ft8/4 tx and rx let us type in there and change them'; 'option to make water span smaller to look for spots') */
  const hzIn = (id, f) => { const el = $(id); const go = () => { const v = Math.round(+el.value); if (v >= 200 && v <= 3000) f(v); else { AP.toast('Pick a number from 200 to 3000 Hz.', 2500, 'bad'); marks(); } };
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); el.blur(); } }); el.addEventListener('change', go); el.addEventListener('focus', () => el.select()); };
  hzIn('dgRxT', hz => { setRx(hz); }); hzIn('dgTxT', hz => { setTx(hz); AP.toast('Transmit frequency: ' + hz + ' Hz.', 1800); });
  const SPANS = [[200, 2800, '200–2800'], [1500, 0, '± 750 Hz'], [800, 0, '± 400 Hz'], [400, 0, '± 200 Hz']];
  function setSpan(i) {
    S.span = ((i % SPANS.length) + SPANS.length) % SPANS.length; save(); const sp = SPANS[S.span];
    if (sp[1]) { F0 = sp[0]; F1 = sp[1]; } else { const c = Math.max(200 + sp[0] / 2, Math.min(3000 - sp[0] / 2, S.txHz)); F0 = Math.round(c - sp[0] / 2); F1 = Math.round(c + sp[0] / 2); }
    $('dgSpan').textContent = '↔ ' + (sp[1] ? sp[2] : F0 + '–' + F1); $('dgSpan').classList.toggle('on', !!S.span);
    const g = wf.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, wf.width, wf.height); drawScale(); marks();
  }
  $('dgSpan').onclick = () => setSpan((+S.span || 0) + 1);
  setTimeout(() => setSpan(+S.span || 0), 0);
  function setRx(hz) { S.rxHz = hz; if (!S.hold) S.txHz = hz; CLEAR = null; save(); marks(); drawRx(); }
  function setTx(hz) { S.txHz = hz; CLEAR = null; save(); if (+S.span && (hz < F0 + 30 || hz > F1 - 30)) setSpan(+S.span); else marks(); }

  /* ================= CLEAR TX SPOT: move MY transmit frequency to the quietest gap =================
     Brandon Oct 22: renamed from CLEAR SPOT (the old name did not say it moves YOUR transmit frequency), bigger on the phone,
     and it says why it is dimmed: it has to hear the band first. */
  let CLEAR = null;
  /* is anyone (not calling me) on this spot in the last few slots? */
  function spotTaken(hz) {
    const bw = S.mode === 'FT4' ? 83 : 50, from = lastDec - 4;
    return LINES.some(x => x.sep == null && !x.tx && !x.me && x.sl >= from && Math.abs(x.hz - hz) < bw);
  }
  function clearSpot(quiet) {
    if (!avgSpec) { if (!quiet) AP.toast('Press START LISTENING first: it needs to hear the band to find a clear spot.', 4000, 'bad'); return null; }
    const bw = S.mode === 'FT4' ? 83 : 50, lo = 300, hi = 2700;
    let best = null, bestV = 1e9;
    for (let hz = lo; hz <= hi - bw; hz += 5) {
      if (spotTaken(hz + bw / 2)) continue;                          /* a station decoded there lately (maybe in the other slot) */
      const a = Math.round(hz / BINHZ), b = Math.round((hz + bw) / BINHZ);
      let sum = 0, n = 0, pk = -200;
      for (let i = a; i <= b; i++) { sum += avgSpec[i]; n++; if (avgSpec[i] > pk) pk = avgSpec[i]; }
      const v = sum / Math.max(1, n) + pk * 0.5;                        /* quiet on average AND no strong signal in it */
      if (v < bestV) { bestV = v; best = hz; }
    }
    if (best == null) return null;
    const hz = Math.round(best + bw / 2);
    S.txHz = hz; CLEAR = Math.round(best); save(); marks();
    AP.toast('🎯 ' + (quiet ? 'Your spot was busy, so ' : '') + 'your transmit frequency is now ' + hz + ' Hz, the quietest gap. The gold dashed box shows it.', 3500);
    return hz;
  }
  /* automatic CLEAR TX SPOT (Brandon Oct 22: 'put it in whenever you feel it is best'): when I start calling CQ, and before each new CQ
     after a contact, move only if someone else is on my spot. Answering a station never moves it (that is what HOLD TX is for). */
  /* Oct 22 (Brandon: 'it did not go to clear frequency'): busy = a station decoded there lately, OR a signal on the
     waterfall right there (a station we could not decode still blocks the spot). It says what it did either way. */
  function spotLoud(hz) {
    if (!avgSpec) return false; const bw = S.mode === 'FT4' ? 83 : 50, a = Math.round((hz - bw / 2) / BINHZ), b = Math.round((hz + bw / 2) / BINHZ);
    const all = Array.from(avgSpec.slice(Math.round(300 / BINHZ), Math.round(2700 / BINHZ))).sort((x, y) => x - y), med = all[Math.floor(all.length / 2)] || -100;
    let pk = -200; for (let i = a; i <= b; i++) if (avgSpec[i] > pk) pk = avgSpec[i];
    return pk > med + 8;
  }
  function autoSpot(quiet) {
    if (!S.autoClear || !avgSpec) return null;
    if (spotTaken(S.txHz) || spotLoud(S.txHz)) return clearSpot(true);
    if (!quiet) AP.toast('🎯 Your TX spot (' + S.txHz + ' Hz) is clear: staying there.', 2500);
    return null;
  }
  /* Brandon Oct 23: 'watching ALL the time, before CQ too' — after every decode pass, while not in the middle of a contact,
     move off a spot someone has taken (a contact in hand keeps its spot: the other station is listening there) */
  function autoSpotTick() { if (!S.autoClear || txBusy || (QS.dx && QS.state && QS.state !== 'done') || !RUN) return; autoSpot(true); }

  /* ================= decodes ================= */
  let LINES = [], MYQ = [], lid = 0, byId = {}, GRIDS = LS('kpcAppGrids', {});
  const MAXL = 400;
  function decodeSlot(sl) {
    if (!ENG) { DIAG.skips.noEngine++; DIAG.lastWhy = 'no engine'; if (!restarting) engine().catch(() => {}); return; }
    const L = slotLen(), start = sl * L;
    if (txSlots.has(S.mode + sl)) { DIAG.skips.tx++; DIAG.lastWhy = 'my TX slot'; lastPass = nowS(); return; }
    const i0 = Math.round((start - t0 / 1000) * R12), want = Math.round(L * R12);
    if (!isFinite(i0) || !t0) { DIAG.skips.badBuf++; DIAG.lastWhy = 'sample clock not set (t0 ' + t0 + ')'; return; }
    if (i0 < n12 - RING || i0 + want * 0.85 > n12) { DIAG.skips.notReady++; DIAG.lastWhy = 'samples not ready (i0 ' + i0 + ' n12 ' + n12 + ', sound ' + ((i0 + want - n12) / R12).toFixed(1) + ' s behind the clock)'; DIAG.behindS = Math.round((i0 + want - n12) / R12 * 10) / 10; return; }
    const buf = new Float32Array(want);
    let nz = 0;
    for (let i = 0; i < want; i++) { const j = i0 + i; const v = j >= 0 && j < n12 ? ring[((j % RING) + RING) % RING] : 0; buf[i] = isFinite(v) ? v : 0; if (buf[i]) nz++; }
    if (nz < want / 10) { DIAG.skips.badBuf++; DIAG.lastWhy = 'buffer nearly empty (' + nz + ' of ' + want + ')'; lastPass = nowS(); quietSlots++; return; }
    let Dd = []; const tp = performance.now();
    try { ENG.start(S.mode === 'FT4'); ENG.feed(buf); Dd = ENG.decode(S.deep ? 6 : 10, S.deep ? 40 : 25); } catch (e) { console.error(e); DIAG.lastWhy = 'threw: ' + (e.message || e); restartEngine('the decoder threw: ' + (e.message || e)); return; }
    DIAG.passes++; DIAG.decoded += Dd.length; DIAG.passMs.push(Math.round(performance.now() - tp)); if (DIAG.passMs.length > 8) DIAG.passMs.shift(); DIAG.lastWhy = 'ok';
    lastPass = nowS(); quietSlots = Dd.length ? 0 : quietSlots + 1;
    Dd.sort((a, b) => a.hz - b.hz);
    const me = AP.myCall(), par = sl % 2;
    if (Dd.length) {
      const dts = Dd.map(d => d.dt).sort((a, b) => a - b), m = dts[Math.floor(dts.length / 2)];
      dtAvg.push(m); if (dtAvg.length > 8) dtAvg.shift();
      if (dtAvg.length >= 3) { const s = dtAvg.slice().sort((a, b) => a - b)[Math.floor(dtAvg.length / 2)]; AP.clock(s, 'from the stations you hear'); }
    }
    LINES.push({ sep: sl, t: start, mode: S.mode, n: Dd.length });
    for (const d of Dd) {
      const tk = d.text.split(/\s+/), to = clean(tk[0]);
      const fr = clean(tk[0] === 'CQ' ? (tk.length > 3 ? tk[2] : tk[1]) : tk[1]);
      LINES.push({
        t: start, sl, par, db: d.db, dt: d.dt, hz: d.hz, text: d.text,
        cq: tk[0] === 'CQ', cqw: tk[0] === 'CQ' && tk.length > 3 ? tk[1] : '',
        to, fr, me: !!me && to === me, grid: tk.length >= 3 && isGrid(tk[tk.length - 1]) ? tk[tk.length - 1].toUpperCase() : ''
      });
    }
    if (LINES.length > MAXL) LINES = LINES.slice(-MAXL);
    for (const x of LINES) if (x.sl === sl && x.grid && x.fr && !/\.\.\./.test(x.fr)) GRIDS[x.fr] = x.grid;
    clearTimeout(gridT); gridT = setTimeout(() => { const k = Object.keys(GRIDS); if (k.length > 2000) k.slice(0, k.length - 2000).forEach(c => delete GRIDS[c]); SV('kpcAppGrids', GRIDS); }, 2000);
    $('dgCnt').textContent = Dd.length ? '· ' + Dd.length : '';
    drawBand(); drawRx(); seq(sl); AP.fire('decoded', sl); autoSpotTick();
    if (Dd.some(d => me && d.text.split(/\s+/)[0] === me)) { const tx2 = Dd.find(d => d.text.split(/\s+/)[0] === me).text; if (AP.notify) AP.notify('calling', tx2, { key: tx2.split(/\s+/)[1] || tx2, every: 120000, ms: 4000 }); else AP.toast('📞 Someone is calling you: ' + esc(tx2), 4000); }
  }
  let gridT = null;
  const parkish = x => /^(POTA|SOTA|WWFF|KFF)$/.test(x.cqw || '');
  /* ---- what lights up in the decode list (Brandon Oct 24: 'options to highlight dx, dxpeditions, special events etc') ---- */
  const HLD = { park: ['🌲', 'Park activators (CQ POTA / SOTA / WWFF)'], dxped: ['🏝', 'DXpeditions (from the DX spots)'], event: ['🎉', 'Special-event stations (1x1 calls, W1AW/n, spotted as special events)'],
    dx: ['🌍', 'DX: stations outside my own country'], newc: ['✨', 'A call I have never worked'], newb: ['📶', 'A call I have not worked on this band'] };
  if (!S.hl || typeof S.hl !== 'object') S.hl = { park: 1, dxped: 1, event: 1, dx: 0, newc: 0, newb: 0 };
  const usCall = c => /^(A[A-L]|[KNW])[A-Z]?\d/.test(c), caCall = c => /^(V[A-GOY]|C[F-KYZ]|X[J-O])\d/.test(c);
  const ctryKey = c => { c = String(c || '').toUpperCase().replace(/^[A-Z0-9]+\//, ''); return usCall(c) ? 'US' : caCall(c) ? 'CA' : (c.match(/^[A-Z0-9]?[A-Z]/) || [''])[0]; };
  let spotHl = { t: 0, m: {} };
  function spotFlag(call) {   /* DXpedition / special event, from the DX spots the SPOTS tab already fetches */
    if (Date.now() - spotHl.t > 30000 && G.KPCSpots) { const m = {}; KPCSpots.all().forEach(s => { const c = String(s.call || '').toUpperCase(), t = [s.sig, s.comment].join(' '); if (/DXPEDITION|DX-?PED/i.test(t)) m[c] = 'dxped'; else if (/SPECIAL EVENT|\bSES\b/i.test(t) || /^special/i.test(s.sig || '')) m[c] = m[c] || 'event'; }); spotHl = { t: Date.now(), m }; }
    return spotHl.m[String(call || '').toUpperCase()] || '';
  }
  /* Oct 25 (HQ: 'leave the DXpedition highlight on our own special-events data'): the website's special-event list (kpc-special-events.json,
     chat 6's calendar job) — the calls of every event on the air TODAY light up 🎉. Fetched twice a day with signal, kept on the device. */
  let EVC = new Set((LSG('kpcAppEvC', { calls: [] }).calls || []));
  function LSG(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  async function evLoad() {
    const c = LSG('kpcAppEvC', { calls: [], at: 0, day: '' }), day = new Date().toISOString().slice(0, 10);
    if (c.day === day && Date.now() - (c.at || 0) < 12 * 36e5) return;
    try { const r = await AP.net.fetch('https://kentuckyportableclub.github.io/KPC-Links/kpc-special-events.json?v=' + day, {}, 15000); if (!r.ok) return; const j = await r.json();
      const calls = []; (j.stations || []).forEach(e => { if ((!e.start || e.start <= day) && (!e.end || e.end >= day)) (e.calls || [e.call]).forEach(x => { if (x) calls.push(String(x).toUpperCase()); }); });
      EVC = new Set(calls); try { localStorage.setItem('kpcAppEvC', JSON.stringify({ calls, at: Date.now(), day })); } catch (e) {} } catch (e) {}
  }
  setTimeout(evLoad, 8000); setInterval(evLoad, 3 * 36e5);
  function hlOf(x) {
    const H = S.hl || {}, c = String(x.fr || '').toUpperCase(); if (!c || /\.\.\./.test(c) || /[<>]/.test(c)) return x.cq && parkish(x) && H.park ? 'park' : '';
    const sf = spotFlag(c);
    if (H.dxped && sf === 'dxped') return 'dxped';
    if (H.event && (sf === 'event' || EVC.has(c) || /^[KNW]\d[A-Z]$/.test(c) || /^W1AW\/\d$/.test(c))) return 'event';
    if (H.park && parkish(x)) return 'park';
    if (H.dx) { const me = ctryKey(AP.myCall()); if (me && ctryKey(c) && ctryKey(c) !== me) return 'dx'; }
    if ((H.newc || H.newb) && G.KPCLog) {
      const b = c.replace(/^[A-Z0-9]+\//, '').replace(/\/[A-Z0-9]+$/, ''), mine = KPCLog.qs().filter(q => String(q.call).toUpperCase().replace(/^[A-Z0-9]+\//, '').replace(/\/[A-Z0-9]+$/, '') === b);
      if (H.newc && !mine.length) return 'newc';
      if (H.newb && mine.length && !mine.some(q => q.band === S.band)) return 'newb';
    }
    return '';
  }
  function lineHtml(x) {
    if (x.sep != null) return `<div class="dsep">${hmsC(x.t)} ── ${x.mode}${x.n ? ' · ' + x.n : ''}</div>`;
    const wk = x.fr && G.KPCLog && KPCLog.worked(x.fr), park = parkish(x), hl = x.tx || x.me ? '' : hlOf(x);
    if (S.potaOnly && !park && !x.tx && !x.me) return '';
    const cls = x.tx ? 'mine' : x.me ? 'me' : x.cq ? (x.cqw ? 'cqp' : 'cq') : '';
    let sel = false; try { sel = !!(QS.dx && (x.fr === QS.dx || x.to === QS.dx)); } catch (e) {}   /* Oct 26: the station in hand lights up in every list */
    return `<div class="dl ${cls}${hl ? ' hl-' + hl : ''}${wk ? ' wk' : ''}${sel ? ' dxsel' : ''}" data-l="${x.id || ''}" role="button" tabindex="0"${hl ? ` title="${esc(HLD[hl][1])}"` : ''}>` +
      `<span>${hms(x.t).replace(/(\d{4})(\d\d)/, '$1')}</span>` +
      `<span>${x.tx ? 'Tx' : fmtDb(x.db)}</span>` +
      `<span>${x.tx ? '' : (x.dt >= 0 ? '' : '') + x.dt.toFixed(1)}</span>` +
      `<span>${x.hz}</span>` +
      `<span class="m">${esc(x.text)}${hl && hl !== 'park' ? ' <i class="ref">' + HLD[hl][0] + '</i>' : park ? ' <i class="ref">🌲</i>' : ''}</span></div>`;
  }
  const idOf = x => { if (!x.id) { x.id = ++lid; byId[x.id] = x; } return x.id; };
  function drawBand() {
    const el = $('dgBandL'), stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40, L = LINES.slice(-200);
    L.forEach(idOf);
    el.innerHTML = L.map(lineHtml).join('') || '<div class="empty">Everyone the radio hears shows up here every 15 seconds. Tap a line to call that station.</div>';
    if (stick) el.scrollTop = el.scrollHeight;
  }
  /* the QSO box beside TX1-6: the stations calling ME, and the contact in hand (both sides), newest at the bottom */
  function drawQso() {
    const el = $('dgQsoL'); if (!el) return;
    const dx = QS.dx, me = AP.myCall();
    const L = LINES.filter(x => x.sep == null && x.t > qClr && (x.me || (dx && (x.fr === dx || x.to === dx)))).concat(MYQ.filter(x => x.t > qClr && (!dx || String(x.text || '').split(/\s+/)[0] === dx || /^CQ /.test(x.text || ''))))
      .sort((a, b) => a.t - b.t).slice(-12);
    const rr = $('dgRr'); if (rr) rr.value = QS.rr || '';
    $('dgQsoDx').textContent = dx ? '⇄ ' + dx : (QS.cq ? '📣 CALLING CQ' : 'NO CONTACT');
    $('dgQsoR').innerHTML = dx ? `SENT <b>${esc(QS.rs || '—')}</b> · RCVD <b>${esc(QS.rr || '—')}</b>${QS.grid ? ' · ' + esc(QS.grid) : ''}` : '';
    el.innerHTML = L.map(x => `<div class="${x.tx ? 'mine' : x.me ? 'me' : ''}"><span>${hms(x.t).replace(/(\d{4})(\d\d)/, '$1')}</span>${x.tx ? '<i>▶</i>' : `<i>${fmtDb(x.db)}</i>`}<span class="m">${esc(x.text)}</span></div>`).join('')
      || `<p class="empty">${me ? 'Stations calling ' + esc(me) + ' and your side of the contact show here.' : 'Set your call in STATION first.'}</p>`;
    el.scrollTop = el.scrollHeight;
  }
  let qClr = 0;   /* Brandon Oct 22: 'clear for the stations I called and called me' */
  $('dgQsoClr').onclick = () => { qClr = Date.now() / 1000; if (!(G.KPCDigi && KPCDigi.txing && KPCDigi.txing())) { QS.dx = ''; QS.grid = ''; QS.rs = ''; QS.rr = ''; QS.logged = false; QS.state = ''; $('dgDx').value = ''; $('dgDxG').value = ''; $('dgRpt').value = ''; gen(); } drawQso(); };
  function drawRx() {
    drawQso();
    const el = $('dgRxL'), w = S.mode === 'FT4' ? 90 : 60, dx = QS.dx;
    const L = LINES.filter(x => x.sep == null && Math.abs(x.hz - S.rxHz) <= w).sort((a, b) => a.t - b.t).slice(-80);   /* Oct 22: the QSO box shows the contact + who called me; this is only my frequency */
    L.forEach(idOf);
    el.innerHTML = L.map(lineHtml).join('') || '<div class="empty">Stations right on your receive frequency show here. Your contact and who is calling you are in the box beside TX1-6.</div>';
    el.scrollTop = el.scrollHeight;
  }
  ['dgBandL', 'dgRxL'].forEach(i => {
    $(i).addEventListener('click', e => { const r = e.target.closest('[data-l]'); if (r) pick(byId[r.dataset.l]); });
    $(i).addEventListener('keydown', e => { if (e.key === 'Enter') { const r = e.target.closest('[data-l]'); if (r) pick(byId[r.dataset.l]); } });
  });
  /* on a phone the two lists share the space (one chip each); on a tablet or PC both are on screen */
  function listsFit() {
    /* Oct 24 (Brandon: 'what is the box of call sign under the decoder box … remove'): the MY FREQUENCY list is gone;
       the QSO box beside TX1-6 shows the contact and who is calling. dgRxL stays in the page, hidden, for the remote's lines */
    $('dgBandL').hidden = false; $('dgRxL').hidden = true;
  }
  document.querySelectorAll('[data-list]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-list]').forEach(x => x.classList.toggle('on', x === b));
    listsFit();
  });
  $('dgPark').onclick = () => { S.potaOnly = !S.potaOnly; save(); $('dgPark').classList.toggle('on', S.potaOnly); drawBand(); drawRx(); };
  $('dgPark').classList.toggle('on', S.potaOnly);

  /* ================= the contact in hand ================= */
  const QS = { dx: '', grid: '', rs: '', rr: '', state: '', next: 6, logged: false, cq: false, since: 0, ref: '' };
  function pick(x) {
    if (!x || x.sep != null) return;
    if (x.tx) return;
    const me = AP.myCall();
    const other = x.me ? x.fr : (x.cq ? x.fr : (x.fr && x.fr !== me ? x.fr : x.to));
    if (!other || /\.\.\./.test(other)) { AP.toast('That call is hidden (a long or odd call sign). Wait until they send it in full.', 4000); return; }
    QS.dx = other; QS.grid = x.grid || GRIDS[other] || ''; QS.rs = fmtDb(x.db); QS.rr = ''; QS.state = 'call'; QS.logged = false; QS.since = nowS();
    QS.ref = parkish(x) ? (x.cqw || '') : '';
    QS.cq = false; QS.paused = false;
    S.rxHz = x.hz; if (!S.hold) S.txHz = x.hz; S.even = x.par === 1; save();
    $('dgDx').value = QS.dx; $('dgDxG').value = QS.grid; $('dgRpt').value = QS.rs;
    gen();
    let n = S.noGrid ? 2 : 1;
    if (x.me) {
      const tk = x.text.split(/\s+/), last = tk[tk.length - 1].toUpperCase();
      if (isRpt(last)) { QS.rr = last; n = 3; } else if (isRRpt(last)) { QS.rr = last.slice(1); n = 4; }
      else if (last === 'RR73' || last === 'RRR') n = 5; else n = 2;
    }
    nextTx(n); txOn(true); marks(); drawRx();
    AP.toast('📞 Calling ' + esc(other) + ' (Tx' + n + ')', 2500);
  }
  function markDx() { document.querySelectorAll('#scrDigi .dl[data-l]').forEach(d => { const x = byId[d.dataset.l]; d.classList.toggle('dxsel', !!(x && QS.dx && (x.fr === QS.dx || x.to === QS.dx))); }); }
  function gen() {
    const me = AP.myCall() || 'K4TEST', g = AP.myGrid().slice(0, 4), dx = QS.dx || 'DXCALL', r = QS.rs || '-10';
    const cqw = (S.cqw && !KPCLog.me().hunt) ? S.cqw + ' ' : '';
    const M = [`${dx} ${me}${g ? ' ' + g : ''}`, `${dx} ${me} ${r}`, `${dx} ${me} R${r}`, `${dx} ${me} RR73`, `${dx} ${me} 73`, `CQ ${cqw}${me}${g ? ' ' + g : ''}`];
    $('dgTxm').innerHTML = M.map((m, i) => `<div class="tm${QS.next === i + 1 ? ' on' : ''}${i === 0 && S.noGrid ? ' skip' : ''}">
      <button type="button" class="n" data-nx="${i + 1}" title="Send this one next">Tx${i + 1}</button>
      <span class="m" data-tm="${i + 1}" data-nx="${i + 1}">${esc(m)}</span>
      <button type="button" class="w" data-now="${i + 1}" title="Send this one in the next slot">NOW</button></div>`).join('');
    drawQso(); markDx();
  }
  const msgOf = n => { const e = document.querySelector(`[data-tm="${n}"]`); return e ? e.textContent.toUpperCase().trim() : ''; };
  function nextTx(n) { QS.next = n; document.querySelectorAll('.tm').forEach((d, i) => d.classList.toggle('on', i + 1 === n)); chk(); }
  $('dgTxm').addEventListener('click', e => {
    const a = e.target.closest('[data-nx]'), b = e.target.closest('[data-now]');
    if (b) { nextTx(+b.dataset.now); NOWTX = true; txOn(true); return; }
    if (a) nextTx(+a.dataset.nx);
  });
  $('dgDx').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/\s/g, ''); };
  $('dgDx').onchange = () => { QS.dx = clean($('dgDx').value); QS.logged = false; QS.state = 'call'; gen(); };
  $('dgDxG').onchange = () => { QS.grid = $('dgDxG').value.toUpperCase(); gen(); };
  $('dgRpt').onchange = () => { QS.rs = $('dgRpt').value.trim(); gen(); };
  $('dgAuto').checked = !!S.auto; $('dgAuto').onchange = () => { S.auto = $('dgAuto').checked; save(); };
  $('dgHold').checked = !!S.hold; $('dgHold').onchange = () => { S.hold = $('dgHold').checked; save(); };

  /* ================= the sequencer (WSJT-X auto sequence) ================= */
  function seq(sl) {
    const me = AP.myCall(); if (!me || !(S.auto || AUTO.run || AUTO.hunt)) return;
    if ((AUTO.run || AUTO.hunt) && autoLimit()) return;
    const L = LINES.filter(x => x.sl === sl && x.me);
    let mine = L.find(x => QS.dx && x.fr === QS.dx);
    if (!mine && (QS.state === 'cq' || (QS.next === 6 && TXON)) && L.length) {
      const c = L.slice().sort((a, b) => S.first ? 0 : b.db - a.db)[0];
      if (c && c.fr && !/\.\.\./.test(c.fr)) {
        QS.dx = c.fr; QS.grid = c.grid || ''; QS.rs = fmtDb(c.db); QS.rr = ''; QS.logged = false; QS.since = nowS(); QS.ref = '';
        S.even = c.par === 1; $('dgDx').value = QS.dx; $('dgDxG').value = QS.grid; $('dgRpt').value = QS.rs; mine = c;
      }
    }
    if (!mine) {
      const wd = (+S.wd || 2) * 60;
      if (AUTO.run || AUTO.hunt) { autoIdle(sl, wd); return; }
      if (TXON && QS.since && nowS() - QS.since > wd) { halt('⏱ No answer for ' + (S.wd || 2) + ' minute' + ((+S.wd || 2) > 1 ? 's' : '') + ': transmitting is off. Change this in ⚙ ' + S.mode + '.'); QS.since = 0; }
      return;
    }
    const tk = mine.text.split(/\s+/), last = tk[tk.length - 1].toUpperCase();
    QS.since = nowS(); if (!QS.rs) QS.rs = fmtDb(mine.db);
    S.even = mine.par === 1; save();
    if (isGrid(last) || tk.length === 2) { if (isGrid(last)) QS.grid = last; gen(); nextTx(2); QS.state = 'sentrpt'; }
    else if (isRpt(last) && S.noGrid && (QS.state === 'sentrpt' || QS.next === 2)) { QS.rr = last; gen(); nextTx(4); QS.state = 'rr73'; }
    else if (isRpt(last)) { QS.rr = last; gen(); nextTx(3); QS.state = 'sentrrpt'; }
    else if (isRRpt(last)) { QS.rr = last.slice(1); gen(); nextTx(4); QS.state = 'rr73'; }
    else if (last === 'RR73' || last === 'RRR') { if (!QS.logged) logIt(); nextTx(5); QS.state = 'send73'; }
    else if (last === '73') { if (!QS.logged && QS.rr) logIt(); afterQso(); }
    $('dgDxG').value = QS.grid; $('dgRpt').value = QS.rs;
    if (!TXON && QS.state !== 'done') txOn(true);
    drawRx();
  }
  function afterQso() {
    QS.state = 'done';
    if (AUTO.hunt) { TXON = false; chk(); autoSt(); return; }   /* the next slot's decode picks the next park */
    if ((S.keepCq && QS.cq) || AUTO.run) { QS.dx = ''; QS.grid = ''; QS.rr = ''; QS.logged = false; QS.state = 'cq'; QS.since = nowS(); $('dgDx').value = ''; $('dgDxG').value = ''; gen(); nextTx(6); autoSpot(); }
    else { TXON = false; chk(); }
  }
  /* ================= AUTO RUN / AUTO HUNT (Brandon Oct 30: 'auto ft4-8 option … with longer cq') =================
     AUTO RUN  = activating: CQ, work each caller to RR73, log, CQ again; keeps calling past the no-answer limit
                 until the run time (⚙ RUN / HUNT FOR, 10–60 min or until STOP) is up.
     AUTO HUNT = hunting: each slot, if no contact is in hand, call the best CQ POTA/SOTA/WWFF/KFF station not yet worked
                 today on this band + mode (a park new to me first, then the strongest); no answer in the no-answer
                 time → skip it for 30 min and try the next. Both stop on HALT / STOP, ENABLE TX off, or a mode change.
     The operator stays at the radio (FCC: a control operator watches an HF data station). */
  const AUTO = { run: false, hunt: false, mix: false, t0: 0, tried: {} };   /* mix = AUTO BOTH: run, and hunt a new park when one shows up */
  function autoSt() {
    const r = $('dgRun'), h = $('dgHunt'), bo = $('dgBoth'), st = $('dgAutoSt'); if (!r) return;
    const run = AUTO.run && !AUTO.mix, mix = AUTO.run && AUTO.mix;
    r.classList.toggle('on', run); h.classList.toggle('on', AUTO.hunt); if (bo) bo.classList.toggle('on', mix);
    r.textContent = run ? '⏹ STOP RUN' : '🔁 AUTO RUN'; h.textContent = AUTO.hunt ? '⏹ STOP HUNT' : '🎯 AUTO HUNT'; if (bo) bo.textContent = mix ? '⏹ STOP BOTH' : '🔀 AUTO BOTH';
    if (!st) return;
    if (!AUTO.run && !AUTO.hunt) { st.hidden = true; return; }
    const lim = +S.runMin || 0, left = lim ? Math.max(0, Math.ceil((AUTO.t0 + lim * 60 - nowS()) / 60)) : 0;
    st.hidden = false;
    st.textContent = (AUTO.mix ? '🔀 AUTO BOTH: calling CQ; a park I have not worked shows up → I work it, then CQ again' + (QS.dx && !QS.cq && QS.state !== 'done' ? ' · now ' + QS.dx : '') : AUTO.run ? '🔁 AUTO RUN: calling CQ, answering and logging by itself' : '🎯 AUTO HUNT: calling ' + (S.huntAny ? 'CQ stations' : 'parks') + ' I have not worked today' + (QS.dx && QS.state !== 'done' ? (QS.paused ? ' · ' + QS.dx + ' is working someone: waiting for its CQ' : ' · now ' + QS.dx) : ''))
      + ' · ' + (lim ? left + ' min left' : 'until you press STOP') + '. Stay at the radio.';
  }
  function autoStop(why) { if (!AUTO.run && !AUTO.hunt) return; AUTO.run = false; AUTO.hunt = false; AUTO.mix = false; autoSt(); if (why) AP.toast(why, 6000); }
  function autoLimit() {
    const lim = +S.runMin || 0;
    if (lim && nowS() - AUTO.t0 > lim * 60 && !(QS.dx && QS.state && QS.state !== 'done' && QS.state !== 'cq' && QS.state !== 'call')) {
      const k = AUTO.mix ? 'AUTO BOTH' : AUTO.run ? 'AUTO RUN' : 'AUTO HUNT'; autoStop(); halt('⏱ ' + k + ' finished its ' + lim + ' minutes. Press it again to keep going.'); return true;
    }
    autoSt(); return false;
  }
  function backToCq() { QS.dx = ''; QS.grid = ''; QS.rr = ''; QS.rs = ''; QS.logged = false; QS.state = 'cq'; QS.cq = true; QS.since = nowS(); $('dgDx').value = ''; $('dgDxG').value = ''; gen(); nextTx(6); }
  /* Nov 1 (Brandon: 'auto hunt … make it only call when the hunted say cq'): while I am calling a station that is now working
     someone else, stop sending (TX off, 'waiting'); when it calls CQ again, call it again. The no-answer time still runs. */
  function holdForCq(sl) {
    if (!QS.dx || QS.cq || QS.state !== 'call') return false;
    const me = AP.myCall(), L = LINES.filter(x => x.sl === sl && x.fr === QS.dx);
    if (!L.length) return !!QS.paused;
    const cq = L.some(x => x.cq), busy = L.some(x => !x.cq && x.to && x.to !== me);
    if (busy && !cq) { if (!QS.paused) { QS.paused = true; if (TXON) { TXON = false; chk(); } autoSt(); } return true; }
    if (cq && QS.paused) { QS.paused = false; const c = L.find(x => x.cq); S.even = c.par === 1; save(); txOn(true); autoSt(); }
    return false;
  }
  function autoIdle(sl, wd) {
    const quiet = QS.since && nowS() - QS.since > wd, slots2 = QS.since && nowS() - QS.since > slotLen() * 2 + 1;
    if (AUTO.run) {
      /* sent RR73 and they went quiet (no 73): the contact is complete, like WSJT-X logs it */
      if (QS.state === 'rr73' && QS.rr && slots2) { if (!QS.logged) logIt(); backToCq(); return; }
      if (QS.state === 'send73' && slots2) { backToCq(); return; }         /* AUTO BOTH: worked the park, sent 73: back to CQ */
      if (QS.state !== 'cq' && quiet) { if (!QS.cq && QS.dx) AUTO.tried[QS.dx] = nowS() + 1800; QS.paused = false; backToCq(); return; }   /* a caller (or a park) went quiet: CQ again */
      if (AUTO.mix && holdForCq(sl)) return;                                /* AUTO BOTH: the park is working someone else: wait for its next CQ */
      if (QS.state === 'cq') { QS.since = nowS(); if (AUTO.mix && huntPick(sl)) return; }   /* the longer CQ; AUTO BOTH: a new park heard → go work it */
      if (!TXON && !QS.paused) txOn(true);
      return;
    }
    /* AUTO HUNT */
    if (!(QS.dx && QS.state && QS.state !== 'done' && quiet) && holdForCq(sl)) return;
    if (QS.state === 'send73' && slots2) { afterQso(); }
    else if (QS.dx && QS.state && QS.state !== 'done' && quiet) { QS.paused = false; AUTO.tried[QS.dx] = nowS() + 1800; AP.toast('🎯 No answer from ' + esc(QS.dx) + ': trying the next one.', 3000); QS.state = 'done'; QS.dx = ''; TXON = false; chk(); }
    if (!QS.dx || QS.state === 'done' || QS.state === '') huntPick(sl);
  }
  function spotRefs(call) {
    if (!G.KPCSpots || !call) return [];
    const b = String(call).toUpperCase().split('/').sort((a, c) => c.length - a.length)[0], k = dialK();
    const sp = KPCSpots.all().find(x => x.call && String(x.call).toUpperCase().split('/').includes(b) && Math.abs((+x.khz || 0) - k) < 6 && (x.refs || []).length);
    return sp ? sp.refs.slice() : [];
  }
  function workedToday(call) {
    if (!G.KPCLog) return false;
    const b = String(call).toUpperCase(), day = new Date(AP.now()).toISOString().slice(0, 10);
    return KPCLog.qs().some(q => String(q.call || '').toUpperCase() === b && q.band === S.band && String(q.mode || '').toUpperCase() === S.mode && new Date(q.t).toISOString().slice(0, 10) === day);
  }
  function huntPick(sl) {
    const now = nowS();
    const C = LINES.filter(x => x.sl === sl && x.cq && x.fr && !/\.\.\.|[<>]/.test(x.fr) && !x.tx && !(AUTO.tried[x.fr] > now) && !workedToday(x.fr))
      .map(x => { const refs = spotRefs(x.fr); return { x, refs, park: parkish(x) || refs.length > 0, isNew: refs.some(r => G.KPCLog && KPCLog.hunted && !KPCLog.hunted(r)) }; })
      .filter(c => S.huntAny || c.park)
      .sort((a, b) => (b.isNew - a.isNew) || (b.park - a.park) || (b.x.db - a.x.db));
    if (!C.length) { autoSt(); return false; }
    const c = C[0]; pick(c.x); QS.ref = c.refs.join(','); autoSt(); return true;
  }
  function autoGo(kind) {
    const was = kind === 'both' ? (AUTO.run && AUTO.mix) : kind === 'run' ? (AUTO.run && !AUTO.mix) : AUTO.hunt;
    const NAME = { run: 'AUTO RUN', hunt: 'AUTO HUNT', both: 'AUTO BOTH' };
    if (was) { autoStop(); halt(NAME[kind] + ' stopped.'); return; }
    if (AUTO.run || AUTO.hunt) { autoStop(); halt(); }
    if (!AP.myCall()) { AP.toast('Put your call sign in STATION → My station first.', 5000, 'bad'); return; }
    if (!AP.canKey()) { txOn(true); return; }   /* txOn says why */
    AUTO.run = kind === 'run' || kind === 'both'; AUTO.mix = kind === 'both'; AUTO.hunt = kind === 'hunt'; AUTO.t0 = nowS(); AUTO.tried = {};
    if (AUTO.run) { $('dgCq').onclick(); if (!TXON) { autoStop(); return; } }
    else { if (TXON) halt(); QS.dx = ''; QS.state = ''; QS.cq = false; $('dgDx').value = ''; gen(); }
    autoSt();
    const lim = +S.runMin || 0;
    AP.toast((AUTO.mix ? '🔀 AUTO BOTH on: CQ, answer callers, and work any park you have not worked today when it shows up, then CQ again' : AUTO.run ? '🔁 AUTO RUN on: CQ, answer, log, CQ again' : '🎯 AUTO HUNT on: it calls the parks it hears that you have not worked today') + ' · ' + (lim ? lim + ' minutes' : 'until you press STOP') + '. Stay at the radio.', 6000);
  }
  if ($('dgRun')) { $('dgRun').onclick = () => autoGo('run'); $('dgHunt').onclick = () => autoGo('hunt'); if ($('dgBoth')) $('dgBoth').onclick = () => autoGo('both'); }

  let LAST = { k: '', t: 0 };
  function logIt() {
    if (!QS.dx || !G.KPCLog) return;
    QS.logged = true;
    const k = QS.dx + '|' + S.band + '|' + S.mode;
    if (LAST.k === k && nowS() - LAST.t < 900) return;
    LAST = { k, t: nowS() };
    const refs = /^[A-Z0-9]+-\d/.test(QS.ref || '') ? QS.ref.split(',') : spotRefs(QS.dx);   /* their park(s), from the spots, so a hunted park counts */
    const r = KPCLog.add({ call: QS.dx, khz: offBand && radioK ? radioK : dialK(), mode: S.mode, rs: QS.rs, rr: QS.rr, g: QS.grid, my: AP.myCall(), refs });
    if (r && r.ok) AP.toast('✅ ' + esc(QS.dx) + ' logged · ' + esc(S.band) + ' ' + S.mode + ' · sent ' + esc(QS.rs) + ' rcvd ' + esc(QS.rr || '?') + ' · ' + r.n + (KPCLog.me().hunt ? ' today' : ' this activation'), 3000, 'log');
    else AP.toast('⚠️ Not logged: ' + esc((r && r.msg) || 'the log did not answer'), 5000, 'bad');
  }

  /* ================= transmitting ================= */
  let TXON = false, NOWTX = false, txBusy = false, lastTxSlot = -1, warned = 0;
  function txOn(on) {
    if (on && !AP.canKey()) { AP.toast(AP.myCall() ? 'Nothing can key the radio yet. In STATION → Radio control, connect the radio (CAT) or pick VOX.' : 'Put your call sign in STATION → My station first.', 6000, 'bad'); return; }
    /* Oct 23 (Brandon: 'if no grid is entered into setting it will not send out step 1'): the CQ and Tx1 carry my grid */
    if (on && !/^[A-R]{2}\d{2}/i.test(AP.myGrid() || '')) { AP.toast('Put your grid square in STATION → My station first: FT8\'s CQ and first call send it.', 6000, 'bad'); TXON = false; chk(); return; }
    TXON = !!on; if (on && !AP.running()) AP.start();
    if (on && !AP.stdCall(AP.myCall()) && !warned) { warned = 1; AP.toast('Heads up: FT8 sends ' + esc(AP.myCall()) + ' as a short code, not the letters, because it is not an ordinary call sign. Most stations still answer.', 7000); }
    if (on) QS.since = QS.since || nowS();
    chk();
  }
  function chk() {
    $('dgEn').classList.toggle('on', TXON);
    $('dgEn').textContent = TXON ? 'TX IS ON' : 'ENABLE TX';
    $('dgCq').classList.toggle('on', TXON && QS.next === 6);
  }
  function halt(why) { TXON = false; NOWTX = false; chk(); if (txBusy) { A.stopTx().catch(() => {}); } if (why) AP.toast(why, 4000); }
  $('dgEn').onclick = () => { if (TXON) autoStop(); txOn(!TXON); };
  $('dgHalt').onclick = () => { autoStop(); halt('Transmitting stopped.'); };
  $('dgCq').onclick = () => {
    if (!AP.myCall()) { AP.toast('Put your call sign in STATION → My station first.', 5000, 'bad'); AP.go('station'); return; }
    QS.dx = ''; QS.grid = ''; QS.state = 'cq'; QS.logged = false; QS.cq = true; QS.ref = ''; QS.since = nowS();
    $('dgDx').value = ''; $('dgDxG').value = ''; gen(); nextTx(6); const moved = autoSpot(); txOn(true);
    AP.toast('📣 Calling CQ in the next ' + (S.even ? 'even' : 'odd') + ' slot' + (moved ? ' at ' + moved + ' Hz (your spot was busy, so 🎯 moved it to a clear gap).' : '.'), moved ? 5000 : 3000);
  };
  $('dgTune').onclick = async () => {
    if (txBusy) { await A.stopTx().catch(() => {}); return; }
    if (!AP.running() && !(await AP.start())) return;
    txBusy = true; AP.toast('TUNE: a steady tone for 10 seconds. Watch the radio\'s ALC and watts.', 4000);
    await AP.pttOn(true);
    try { await A.tone(S.txHz, 10, 'tune'); } catch (e) { AP.toast('TUNE did not work: ' + esc(e.message || e), 5000, 'bad'); }
    await AP.pttOn(false); txBusy = false;
  };

  function txTick(t, sl, into) {
    if (!RUN || txBusy || !TXON || !ENG) return;
    if (lastTxSlot === sl) return;
    const par = sl % 2, want = S.even ? 0 : 1;
    if (!NOWTX && par !== want) return;
    if (into > 1.2) return;                                /* too late in this slot: wait for the next one */
    if (!AP.myCall()) { halt('Put your call sign in STATION → My station: nothing was sent.'); return; }
    const n = QS.next || 6;
    let m = msgOf(n);
    if (/DXCALL/.test(m) && clean($('dgDx').value)) { QS.dx = clean($('dgDx').value); gen(); m = msgOf(n); }
    if (!m || /DXCALL/.test(m)) { AP.toast('Tap a station first, or press 📣 CQ.', 4000); halt(); return; }
    lastTxSlot = sl; NOWTX = false;
    send(m, n, sl);
  }
  async function send(m, n, sl) {
    let tones = null;
    try { tones = ENG.tones(m, S.mode === 'FT4'); } catch (e) {}
    if (!tones) { AP.toast('⚠️ That message can\'t go out as ' + S.mode + ': ' + esc(m), 5000, 'bad'); halt(); return; }
    txBusy = true; txSlots.add(S.mode + sl); if (txSlots.size > 60) txSlots = new Set([S.mode + sl]);
    const pcm = KPCFT8.synth(tones, S.txHz, A.rate, S.mode === 'FT4');
    const at = sl * slotLen() * 1000 + 500;                /* the slot's own start + 0.5 s, like WSJT-X */
    const id = 'tx' + sl;
    MYQ.push({ t: sl * slotLen(), tx: 1, hz: S.txHz, text: m }); if (MYQ.length > 40) MYQ.shift();
    drawRx();
    /* key the radio a touch early; AP.pttOn lets go of the USB port straight after, before any sound */
    const kt = setTimeout(() => AP.pttOn(true), Math.max(0, at - AP.now() - 700));
    try {
      await Promise.race([A.play(pcm, dev(at), id),
        new Promise(r => setTimeout(r, Math.max(2000, at - AP.now()) + slotLen() * 1000 + 3000))]);   /* never get stuck waiting */
    } catch (e) { AP.toast('The sound did not go out: ' + esc(e.message || e), 5000, 'bad'); }
    clearTimeout(kt);
    await AP.pttOn(false);
    txBusy = false;
    if (n === 4 && !QS.logged) { logIt(); setTimeout(afterQso, 300); }
    else if (n === 5) { if (!QS.logged && QS.rr) logIt(); setTimeout(afterQso, 300); }
  }

  /* ================= decoder watchdog (Brandon Oct 23: decodes stopped at 20:48 while the waterfall kept moving) =================
     Every slot must come back with a decode pass (even an empty one). Two slots with no pass while sound is still arriving = the
     decoder is wedged (a thrown error inside the wasm, a stuck feed) → make a fresh engine and reset the sample clock. Three
     quiet slots in a row with sound present and a loud-enough band = a warning in the strip, so Brandon sees it before he wonders. */
  let lastPass = 0, lastN12 = 0, quietSlots = 0, wdSaid = 0, restarting = false;
  let restartEngine = async function (why) {
    if (restarting) return; restarting = true;
    console.warn('decoder restart: ' + why);
    let ok = true; try { ENG = null; await engine(); } catch (e) { ok = false; }
    lastDec = -1; dtAvg = []; lastPass = nowS(); restarting = false;
    if (ok) AP.toast('🔁 The FT8 decoder was restarted (' + why + ').', 4000);
  };
  function watchdog(sl, t) {
    const L = slotLen();
    if (!ACTIVE) { lastN12 = n12; lastPass = t; return; }     /* another mode has the sound: nothing for this watchdog to judge (Oct 25: it cried 'no result for 598 s' on SSTV) */
    if (n12 === lastN12) return;                             /* no sound arriving: that is the sound card's problem, not the decoder's */
    lastN12 = n12;
    if (lastPass && t - lastPass > 2.5 * L && !txBusy) restartEngine('no result for ' + Math.round(t - lastPass) + ' s; last reason: ' + DIAG.lastWhy);
    const e = $('dgWdT'); if (e) { if (quietSlots >= 6 && !txBusy && Date.now() - wdSaid > 300000) { wdSaid = Date.now(); AP.toast('No stations decoded for ' + quietSlots + ' slots while sound is coming in. Band dead, or the RX level / radio mode off? Check the level word above the waterfall.', 7000); } }
  }

  /* ================= every quarter second ================= */
  setInterval(() => {
    const t = nowS(), L = slotLen(), sl = Math.floor(t / L), into = t - sl * L;
    const bar = $('dgSlotBar'); if (bar) bar.style.width = (into / L * 100) + '%';
    $('dgSlotT').textContent = (sl % 2 === 0 ? 'EVEN' : 'ODD') + ' SLOT · ' + into.toFixed(0) + ' s' + (TXON ? ' · TX ' + (S.even ? 'EVEN' : 'ODD') : '');
    if (!RUN) return;
    const at = S.mode === 'FT4' ? 6.6 : 14.4;
    if (into >= at && lastDec !== sl) { lastDec = sl; decodeSlot(sl); }
    watchdog(sl, t);
    txTick(t, sl, into);
    if (!rafOn) wfLoop();
  }, 250);

  /* ================= band, mode, dial =================
     Oct 22 (Brandon: band list stuck on 20 m): a band change that the radio did not take used to fail without a word
     (the USB port had been dropped, or the change came while transmitting), so the screen said 40 m while the radio sat on 20 m.
     Now: a change made while transmitting stops TX first and then tunes; a failed write is tried once more (that opens the port
     again); the radio is read back; and if it is NOT on the new band the screen says so in red with a TRY AGAIN button.
     The radio's knob is still followed, but never for 8 seconds after you pick a band here, and never to undo a change that failed. */
  let userT = 0, tuning = false, tuneN = 0, radioK = 0, offBand = false;
  const bandOfK = k => (G.KPCLog && KPCLog.band(k)) || '';
  const mhz = k => (k / 1000).toFixed(3);
  function bandOpts() {
    const B = Object.keys(DIAL[S.mode]);
    if (!DIAL[S.mode][S.band]) { S.band = B.includes('20m') ? '20m' : B[0]; save(); }
    $('dgBand').innerHTML = B.map(b => `<option${b === S.band ? ' selected' : ''}>${b}</option>`).join('');
    $('dgBand').value = S.band;
  }
  function showDial() {
    const e = $('dgDial');
    e.textContent = offBand && radioK ? mhz(radioK) : mhz(dialK());
    e.classList.toggle('warn', offBand);
    e.title = offBand ? 'This is where your radio really is' : 'Dial frequency';
  }
  function tuneWarn(html) {
    const w = $('dgTuneW');
    if (!html) { w.hidden = true; w.innerHTML = ''; return; }
    w.innerHTML = '<span>' + html + '</span><button type="button" class="b sm" id="dgTuneAgain">TRY AGAIN</button>';
    w.hidden = false;
    $('dgTuneAgain').onclick = () => radioTune();
  }
  async function radioTune() {
    const my = ++tuneN, band = S.band, mode = S.mode;
    userT = Date.now(); offBand = false; showDial();
    if (!AP.catConnected()) {
      tuneWarn('');
      const picked = !!(AP.cat() && KPCCat.get().radio);
      AP.toast(picked ? '📻 The radio is not connected, so it was not changed. Set it to ' + mhz(dialK()) + ' MHz by hand, or press CONNECT RADIO in STATION → Radio control.'
        : '📻 Set your radio to ' + mhz(dialK()) + ' MHz (DATA / USB).', 5000);
      return;
    }
    if (TXON || txBusy || AP.txing()) {
      halt('Band changed, so transmitting stopped. The radio changes as soon as this transmission ends.');
      const t = Date.now(); while ((txBusy || AP.txing()) && Date.now() - t < 20000) await sleep(250);
    }
    if (my !== tuneN) return;                              /* a newer pick took over */
    tuning = true; tuneWarn('');
    const want = dialK();
    let ok = await KPCCat.tune(want, mode);
    if (!ok && my === tuneN) { await sleep(300); ok = await KPCCat.tune(want, mode); }   /* the 2nd try opens the USB port again */
    const r = ok && my === tuneN ? await KPCCat.read() : null;
    tuning = false; userT = Date.now();
    if (my !== tuneN) return;
    if (!ok) {
      const why = (AP.catMsg().t || '').replace(/open the CAT & QRZ tab and press CONNECT MY RADIO/, 'press CONNECT RADIO in STATION');
      offBand = !!radioK; showDial();
      tuneWarn('⚠️ The radio did not change to <b>' + band + '</b>' + (radioK ? ' — it is still on <b>' + mhz(radioK) + '</b>' : '') + '. ' + (why ? AP.esc(why) + ' ' : '') + 'Check the USB cable, then TRY AGAIN (or STATION → CONNECT RADIO).');
      AP.toast('⚠️ The radio did not change to ' + band + '. See the red note under the band.', 5000, 'bad');
      return;
    }
    if (r && r.khz) {
      radioK = Math.round(r.khz * 1000) / 1000;
      if (Math.abs(radioK - want) > 1.5) {
        offBand = bandOfK(radioK) !== band; showDial();
        tuneWarn('⚠️ Asked the radio for <b>' + mhz(want) + '</b> but it says <b>' + mhz(radioK) + '</b>. Is the radio locked, in memory mode, or on VFO B? TRY AGAIN once it is on VFO A.');
        return;
      }
    }
    offBand = false; tuneWarn(''); showDial();
  }
  $('dgBand').onchange = () => { S.band = $('dgBand').value; if (S.ov) delete S.ov[ovKey()]; save(); showDial(); radioTune(); if (SPF) SPF.update(); };
  /* FT8 ↔ FT4 (the mode frame calls this when its chip is tapped, or when the remote asks) */
  /* Oct 27: FT8 / FT4 parks spotted on this band, under the dial; a POTA spot carries the dial, not the audio spot, so a tap fills DX CALL + the log line (the decode list lights the station when it is heard) */
  let SPF = null;
  function spotsFt() { if (!G.KPCSpots || !KPCSpots.strip || !$('dgSpots')) return; const o = { band: () => S.band, modes: S.mode === 'FT4' ? /^FT4/ : /^FT8/, max: 12, tap: s => { if ($('dgDx')) $('dgDx').value = s.call; if (G.KPCLog && KPCLog.prefill) KPCLog.prefill({ call: s.call, refs: s.refs, mode: s.mode, khz: s.khz, g: s.grid, st: s.st }); AP.toast('🌲 ' + s.call + ' is in DX CALL; tap their line in the decode list when they show up.', 3500); } }; if (!SPF) SPF = KPCSpots.strip($('dgSpots'), o); else SPF.update(o); }
  function useMode(m, first) {
    const was = S.mode; S.mode = m; save();
    bandOpts(); showDial(); gen(); marks(); lastDec = -1; dtAvg = []; spotsFt();
    if (!first) { radioTune(); AP.toast(S.mode === 'FT4' ? 'FT4: 7.5-second slots, a wider signal. Same screen.' : 'FT8: 15-second slots.', 3000); }
    else if (was !== m) radioTune();
  }
  AP.on('dial', r => {                                     /* the radio's knob moved (never read while transmitting) */
    if (!r || !r.khz) return;
    if (tuning || Date.now() - userT < 8000) return;       /* never undo a band you just picked */
    const k = Math.round(r.khz * 1000) / 1000, prev = radioK, rb = bandOfK(k);
    radioK = k;
    if (rb && rb !== S.band && DIAL[S.mode][rb] && (!offBand || (prev && bandOfK(prev) !== rb))) {
      S.band = rb; bandOpts(); AP.toast('📻 Your radio is on ' + rb + ', so the band list followed it.', 3000);
    }
    if (rb === S.band) {
      offBand = false; tuneWarn('');
      if (Math.abs(k - stdK()) < 0.01) { if (S.ov) delete S.ov[ovKey()]; } else { S.ov = S.ov || {}; S.ov[ovKey()] = k; }
    } else {
      offBand = true;
      tuneWarn('📻 Your radio is on <b>' + mhz(k) + '</b>, not on ' + S.band + '. TRY AGAIN sends it to ' + S.band + ', or pick its band in the list.');
    }
    save(); showDial();
  });

  /* ================= the mode's own settings sheet ================= */
  function settings() {
    const ck = (id, on, lab) => `<label class="ck" style="display:flex;margin:9px 0"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> <span>${lab}</span></label>`;
    /* grouped by what a setting IS (Brandon Oct 21); TX + RX levels live here too (Brandon Oct 22) */
    AP.sheet(S.mode + ' settings', `
      <h3 class="sh">Sound levels</h3>
      ${AP.lvHtml('tx')}
      ${AP.lvHtml('rx')}
      <p class="hint">Moves right away, while you listen or TUNE. The same two sliders are in STATION → Sound.</p>
      <h3 class="sh">My transmit frequency</h3>
      ${ck('shHold', S.hold, '🔒 <b>Hold my transmit frequency</b> — tapping a station does not move it (they hear me where I am)')}
      ${ck('shAutoClr', S.autoClear, '🎯 <b>Find a clear TX spot by itself</b> — watches all the time: whenever someone sits on my transmit spot (and I am not in the middle of a contact) it moves to the quietest gap, and it checks again before each CQ (hold on the waterfall to move it by hand)')}
      <div class="grid2">
        <label class="e">MY TRANSMIT FREQUENCY (Hz)<input id="shTx" inputmode="numeric" value="${S.txHz}"></label>
        <label class="e">LISTENING AT (Hz)<input id="shRx" inputmode="numeric" value="${S.rxHz}"></label>
      </div>
      <h3 class="sh">Contacts</h3>
      ${ck('shAuto', S.auto, 'Auto sequence — answer by itself (grid → report → R-report → RR73 → 73) and log the contact')}
      ${ck('shFirst', S.first, 'Call the first station that answers my CQ (off = the strongest one)')}
      ${ck('shEven', S.even, 'I transmit in the EVEN slots (this flips by itself when you answer someone)')}
      ${ck('shKeep', S.keepCq, 'Keep calling CQ after each contact')}
      ${ck('shNoG', S.noGrid, '⚡ Fast contact — send my report first, no grid, and RR73 as soon as both reports are in')}
      <div class="grid2">
        <label class="e">CQ<select id="shCqw">${[['', 'CQ'], ['POTA', 'CQ POTA'], ['SOTA', 'CQ SOTA'], ['WWFF', 'CQ WWFF']].map(([v2, l]) => `<option value="${v2}"${S.cqw === v2 ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="e">STOP CALLING AFTER NO ANSWER<select id="shWd">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}"${+S.wd === n ? ' selected' : ''}>${n} minutes</option>`).join('')}</select></label>
        <label class="e">🔁 AUTO RUN / 🎯 AUTO HUNT GO FOR<select id="shRunMin">${[5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 0].map(n => `<option value="${n}"${+S.runMin === n ? ' selected' : ''}>${!n ? 'until I press STOP' : n < 60 ? n + ' minutes' : n === 60 ? '1 hour' : (n / 60) + ' hours'}</option>`).join('')}</select></label>
        ${ck('shHuntAny', S.huntAny, '🎯 AUTO HUNT calls any CQ, not only parks')}
        <p class="hint">AUTO RUN keeps calling CQ the whole time (the no-answer limit above does not stop it). Stay at the radio while it runs.</p>
      </div>
      <h3 class="sh">Waterfall</h3>
      <label class="e slide">BRIGHTNESS <b id="shWfBT">${+S.wfB || 0}</b><input type="range" id="shWfB" min="-100" max="100" step="5" value="${+S.wfB || 0}"></label>
      <label class="e slide">CONTRAST <b id="shWfCT">${+S.wfC || 0}</b><input type="range" id="shWfC" min="-100" max="100" step="5" value="${+S.wfC || 0}"></label>
      <p class="hint">Changes as you slide. Brightness lifts the noise floor; contrast makes weak traces stand out more (too much and the noise sparkles).</p>
      <h3 class="sh">Light up in the decode list</h3>
      ${Object.entries(HLD).map(([k, v]) => ck('shHl_' + k, !!(S.hl || {})[k], `<span class="hlk hl-${k}">${v[0]}</span> ${v[1]}`)).join('')}
      <p class="hint">Each kind has its own colour; a station calling you always shows in orange. Special events: the KPC website's list of special-event stations on the air today, + 1x1 calls. DXpeditions: spots that say so. The announced DXpeditions: <a href="https://www.ng3k.com/Misc/adxo.html" target="_blank" rel="noopener">NG3K's list ›</a></p>
      <h3 class="sh">Decoding</h3>
      ${ck('shDeep', S.deep, 'Deeper decoding — finds weaker stations, uses more battery')}
      <p class="hint">Sound card, how the radio is keyed and your call sign live in STATION, so they are in one place for every mode.</p>`,
      () => {
        const g = id => { const e = $(id); return e ? e.checked : null; };
        S.auto = g('shAuto'); S.first = g('shFirst'); S.even = g('shEven'); S.hold = g('shHold'); S.autoClear = g('shAutoClr');
        S.keepCq = g('shKeep'); S.noGrid = g('shNoG'); S.deep = g('shDeep');
        S.hl = {}; Object.keys(HLD).forEach(k => { S.hl[k] = g('shHl_' + k) ? 1 : 0; }); spotHl.t = 0;
        const tx = +($('shTx') || {}).value, rx = +($('shRx') || {}).value;
        if (tx >= 200 && tx <= 3000 && Math.round(tx) !== S.txHz) { S.txHz = Math.round(tx); CLEAR = null; }
        if (rx >= 200 && rx <= 3000) S.rxHz = Math.round(rx);
        if ($('shCqw')) S.cqw = $('shCqw').value;
        if ($('shWd')) S.wd = +$('shWd').value || 2;
        if ($('shRunMin')) S.runMin = +$('shRunMin').value; if ($('shHuntAny')) S.huntAny = $('shHuntAny').checked; autoSt();
        save(); $('dgAuto').checked = S.auto; $('dgHold').checked = S.hold; marks(); gen();
      });
    ['B', 'C'].forEach(k => { const r = $('shWf' + k); if (r) r.oninput = () => { S['wf' + k] = +r.value; $('shWf' + k + 'T').textContent = r.value; save(); }; });
  };

  /* ================= hide what cannot work yet (Brandon Oct 21) ================= */
  AP.on('key', can => {
    const why = !AP.myCall() ? 'Put your call sign in STATION → My station first.'
      : 'Nothing can key the radio yet: connect it (CAT) or pick VOX in STATION → Radio control.';
    ['dgEn', 'dgCq', 'dgTune'].forEach(id => { $(id).disabled = !can; $(id).title = can ? '' : why; });
    if (!can && TXON) halt();
  });
  AP.on('me', () => { gen(); AP.keyCheck(); });
  AP.on('screen', s => { if (s === 'digi') { wfSize(); drawScale(); marks(); if (RUN && !rafOn) wfLoop(); } });
  AP.on('look', () => drawScale());
  addEventListener('resize', () => { listsFit(); if (document.body.dataset.screen === 'digi') { wfSize(); drawScale(); marks(); } });

  $('dgStart').onclick = async () => { await engine(); AP.start(); };
  engine().catch(e => AP.toast('The FT8 decoder would not load: ' + esc(e.message || e), 6000, 'bad'));
  bandOpts(); showDial(); gen(); wfSize(); drawScale(); marks(); drawBand(); drawRx(); chk(); listsFit();
  $('dgWfOff').hidden = false;
  AP.keyCheck();

  /* the remote link (Oct 22): the phone asks, this screen on the PC does it */
  /* test hooks (tools/tests): pretend the decoder is stuck; count restarts; check the auto spot mover; the bin size */
  let RESTARTS = 0; const _restart0 = restartEngine;
  restartEngine = async function (why) { RESTARTS++; return _restart0(why); };
  G.KPCDigi = { S, save, mode: () => S.mode, running: () => RUN, lines: () => LINES,
    diag: () => Object.assign({}, DIAG, { lastPassAgeS: lastPass ? Math.round(nowS() - lastPass) : null, n12, t0: Math.round(t0), clkOff: AP.S.clkOff || 0, rxDb: AP.S.rxDb || 0, mode: S.mode, run: RUN, active: ACTIVE, capture: (KPCNative.audio.capture ? KPCNative.audio.capture() : null) }),
    _wedge: () => { lastPass = nowS() - 100; lastN12 = -1; }, _restarts: () => RESTARTS, _binHz: () => BINHZ,
    _hl: (x, hl) => { if (hl) S.hl = hl; spotHl.t = 0; return hlOf(x); },
    /* test hook (Oct 30): feed made-up decoded lines for slot sl, then run the sequencer as a real pass would */
    _feedLines: (sl, list) => { const me = AP.myCall(); for (const d of list) { const tk = d.text.split(/\s+/), to = clean(tk[0]); const fr = clean(tk[0] === 'CQ' ? (tk.length > 3 ? tk[2] : tk[1]) : tk[1]);
        LINES.push({ t: sl * slotLen(), sl, par: sl % 2, db: d.db == null ? -10 : d.db, dt: 0.2, hz: d.hz || 1200, text: d.text, cq: tk[0] === 'CQ', cqw: tk[0] === 'CQ' && tk.length > 3 ? tk[1] : '', to, fr, me: !!me && to === me, grid: tk.length >= 3 && isGrid(tk[tk.length - 1]) ? tk[tk.length - 1].toUpperCase() : '' }); }
      seq(sl); },
    _auto: () => ({ run: AUTO.run, hunt: AUTO.hunt, mix: AUTO.mix, cq: QS.cq, dx: QS.dx, state: QS.state, next: QS.next, tx: TXON, ref: QS.ref, logged: QS.logged }),
    _qsSince: v => { QS.since = v; },
    _autoTest: hz => { if (!avgSpec) avgSpec = new Float32Array(HB).fill(-90); const a = Math.round((hz - 25) / BINHZ), b = Math.round((hz + 25) / BINHZ); for (let i = a; i <= b; i++) avgSpec[i] = -40; const before = S.txHz; autoSpotTick(); return { moved: S.txHz !== before, to: S.txHz }; },
    /* a small band view for the remote screen (Brandon Oct 24: 'a waterfall or band view to find a clear TX spot'): 120 steps from 200 to 2800 Hz, dB, plus the RX/TX spots */
    spectrum: () => { if (!avgSpec) return null; const N = 120, out = new Array(N), a = Math.round(200 / BINHZ), b = Math.round(2800 / BINHZ), w = (b - a) / N; for (let i = 0; i < N; i++) { let pk = -200; for (let j = Math.floor(a + i * w); j < a + (i + 1) * w; j++) if (avgSpec[j] > pk) pk = avgSpec[j]; out[i] = Math.round(pk); } return { f0: 200, f1: 2800, db: out, rx: S.rxHz, tx: S.txHz, taken: Array.from(new Set(LINES.filter(x => x.sep == null && x.t > nowS() - 120).map(x => Math.round(x.hz / 25) * 25))) }; },
    setTxHz: hz => { hz = Math.round(+hz); if (!(hz >= 200 && hz <= 3000)) return false; setTx(hz); return true; },
    txOn: on => txOn(!!on), halt: why => halt(why), cq: () => $('dgCq').onclick(), tune: () => $('dgTune').onclick(), txing: () => !!txBusy, enabled: () => !!TXON,
    setBand: b => { if (!DIAL[S.mode][b]) return false; $('dgBand').value = b; $('dgBand').onchange(); return true; },
    setMode: m => G.KPCModes ? KPCModes.use(m) : false,
    call: id => { const x = byId[id]; if (!x) return false; pick(x); return true; }, band: () => S.band, dialKhz: () => dialK(), qso: () => ({ dx: QS.dx, state: QS.state, next: QS.next, rs: QS.rs, rr: QS.rr, cq: QS.cq, grid: QS.grid }),
    /* the QSO box lines (stations calling me + both sides of the contact in hand), for the remote screen */
    qsoLines: () => { const dx = QS.dx; return LINES.filter(x => x.sep == null && x.t > qClr && (x.me || (dx && (x.fr === dx || x.to === dx)))).concat(MYQ.filter(x => x.t > qClr && (!dx || String(x.text || '').split(/\s+/)[0] === dx || /^CQ /.test(x.text || '')))).sort((a, b) => a.t - b.t).slice(-10).map(x => ({ t: x.t, tx: x.tx ? 1 : 0, db: x.db, hz: x.hz, text: x.text })); } };

  /* ================= on the mode frame: FT8 and FT4 are two chips on one panel ================= */
  if (G.KPCModes) ['FT8', 'FT4'].forEach(id => KPCModes.add({
    id, label: id, panel: '#dgFt', title: id === 'FT4' ? 'FT4: 7.5-second slots' : 'FT8: 15-second slots',
    bands: Object.keys(DIAL[id]), band: () => S.band, setBand: b => KPCDigi.setBand(b), khz: () => dialK(),
    rx, run: () => {}, activate: prev => { ACTIVE = true; useMode(id, !prev); }, deactivate: () => { ACTIVE = false; autoStop(); if (TXON || txBusy) halt('Mode changed, so transmitting stopped.'); },
    settings, lines: () => LINES, hello: '',
    ops: { cq: () => $('dgCq').onclick(), halt: () => { autoStop(); halt('The phone pressed HALT.'); }, run: () => autoGo('run'), hunt: () => autoGo('hunt'), both: () => autoGo('both'), tx: a => txOn(!!a.on), call: a => KPCDigi.call(+a.id), tune: () => $('dgTune').onclick(), txhz: a => KPCDigi.setTxHz(a.hz) },
    buttons: [{ op: 'cq', label: '📣 CQ', cls: 'cq' }, { op: 'tx', label: 'ENABLE TX', on: 'TX IS ON', cls: 'tx', toggle: true }, { op: 'halt', label: 'HALT', cls: 'halt' }, { op: 'tune', label: 'TUNE 10 s' }, { op: 'run', label: '🔁 AUTO RUN' }, { op: 'hunt', label: '🎯 AUTO HUNT' }, { op: 'both', label: '🔀 AUTO BOTH' }],
    enabled: () => !!TXON, txing: () => !!txBusy, halt: why => halt(why), tune: () => $('dgTune').onclick(),
    state: () => ({ dx: QS.dx, state: QS.state, next: QS.next, rs: QS.rs, rr: QS.rr })
  }));
})(window);
