/* KPC app: STEP 5 MODES ON THE MODE FRAME (Opus, Oct 24; Brandon: 'do everything you can'): CW, RTTY, PSK31, Feld HELL, SSTV, WSPR.
   The sound math is the website's (kpc-links kpc-digi.js → www/kpc-dsp.js = KPCDsp: RTTY, PSK31, SSTV, WSPR (a port of WSJT-X wsprd,
   GPL v3) and HELL); the CW decoder is the website logger's (kpc-logger-ft8.js cwFeed). All six share ONE panel (#dg5) with its own
   waterfall; the panel's data-m picks which parts show. Each mode = one KPCModes.add({...}), so the chips, the ⚙ button, the sound
   and the REMOTE tab come from the frame (kpc-mode.js).
   Sending: KPCNative.audio.play() at 48 kHz behind AP.pttOn(), like FT8; CW can also go out by the radio's own keyer (CAT) or a key
   line (DTR / RTS on the CAT cable). Nothing transmits without a real call sign (a practice call like K4TEST must never go on the air). */
(function (G) {
  'use strict';
  const AP = G.KPCApp, D = G.KPCDsp, A = G.KPCNative && KPCNative.audio, $ = id => document.getElementById(id), esc = AP.esc;
  if (!AP || !D || !G.KPCModes || !A) return;
  const R = 12000, OUT = 48000;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* dial frequencies (the radio's suppressed carrier; same table as the website logger) */
  const DIAL = {
    CW: { '160m': 1810, '80m': 3530, '60m': 5332, '40m': 7030, '30m': 10110, '20m': 14060, '17m': 18080, '15m': 21060, '12m': 24910, '10m': 28060, '6m': 50090 },
    RTTY: { '80m': 3580, '40m': 7080, '30m': 10140, '20m': 14085, '17m': 18100, '15m': 21080, '12m': 24920, '10m': 28080 },
    PSK31: { '160m': 1838, '80m': 3580, '40m': 7070, '30m': 10142, '20m': 14070, '17m': 18100, '15m': 21070, '12m': 24920, '10m': 28120, '6m': 50290 },
    HELL: { '160m': 1843, '80m': 3585, '40m': 7069.5, '30m': 10142.5, '20m': 14063, '17m': 18098, '15m': 21063, '12m': 24924, '10m': 28063, '6m': 50286 },   /* Feld Hell Club nets + its band list (Oct 26) */
    SSTV: { '80m': 3845, '40m': 7171, '20m': 14230, '17m': 18160, '15m': 21340, '12m': 24975, '10m': 28680, '6m': 50680, '2m (ISS)': 145800 },
    WSPR: { '160m': 1836.6, '80m': 3568.6, '60m': 5287.2, '40m': 7038.6, '30m': 10138.7, '20m': 14095.6, '17m': 18104.6, '15m': 21094.6, '12m': 24924.6, '10m': 28124.6, '6m': 50293, '2m': 144489 }
  };
  const RANGE = { CW: [200, 1400], RTTY: [200, 2800], PSK31: [200, 2800], HELL: [200, 2800], SSTV: [1000, 2500], WSPR: [1400, 1600] };
  const S = Object.assign({ band: {}, cw: {}, rtty: {}, psk: {}, hell: {}, sstv: {}, wspr: {}, mac: {}, rs: {} }, LS('kpcApp5', {}));
  S.cw = Object.assign({ wpm: 20, hz: 600, via: 'audio', bw: 'auto', tone: 0, abbr: false, afc: true }, S.cw);
  S.rtty = Object.assign({ center: 1500, shift: 170, baud: 45.45, rev: false, afc: true }, S.rtty);
  S.psk = Object.assign({ hz: 1000, afc: true, sq: 35 }, S.psk);
  S.hell = Object.assign({ hz: 1000, gain: 1, wide: 2 }, S.hell);
  S.sstv = Object.assign({ auto: true, tx: 'Martin 1', top: '{MY}', bot: '{REF} · 73', man: 'Martin 1' }, S.sstv);
  S.wspr = Object.assign({ tx: false, pct: 20, dbm: 23, hz: 1500 }, S.wspr);
  const save = () => SV('kpcApp5', S);
  let MODE = '';
  const band = m => { m = m || MODE; const L = Object.keys(DIAL[m] || {}); return L.includes(S.band[m]) ? S.band[m] : (L.includes('20m') ? '20m' : L.includes('40m') ? '40m' : L[0]); };
  const dialK = m => (DIAL[m || MODE] || {})[band(m)] || 14070;
  const audioHz = () => MODE === 'CW' ? S.cw.hz : MODE === 'RTTY' ? S.rtty.center : MODE === 'PSK31' ? S.psk.hz : MODE === 'HELL' ? S.hell.hz : MODE === 'WSPR' ? S.wspr.hz : 1500;
  /* Oct 26: SSTV on 80 m / 40 m is LSB by custom (7.171, 3.845): in USB-DATA the pictures sit on the wrong side and never copy */
  /* Oct 26 (Fable; Brandon: 'tap to key not working in cw'): with SEND WITH = sound the radio sits in DATA one tone BELOW the CW dial the
     whole time the CW screen is up (a radio in CW ignores its USB sound), so a key tap or typed CW goes out at once — no mode swap and
     1 s wait on every first dit. Stations on the CW dial still land on the PITCH. The DTR / RTS key line and the CAT keyer keep CW mode. */
  const toneCw = () => S.cw.via === 'audio' || !S.cw.via;
  /* Oct 27 (Fable; Brandon: 'auto change-over CW to DATA for CW … nice clean audio in and out'): S.cw.park = 'cw' (default) = the radio
     LISTENS in CW mode (its own narrow CW filter), and flips to DATA one tone low only while sending (`cwArm`), back to CW 1.2 s after
     the last element; 'data' = parked in DATA the whole time (the fastest first dit). Both only when SEND WITH = sound. */
  const parkData = () => toneCw() && S.cw.park === 'data';
  const dialOut = m => (m || MODE) === 'CW' && parkData() ? Math.round((dialK('CW') - (S.cw.tone || S.cw.hz || 600) / 1000) * 1000) / 1000 : dialK(m);
  const ARM = { on: false, back: 0, t: 0, busy: null };
  const cwTxDial = () => Math.round((dialK('CW') - (S.cw.tone || S.cw.hz || 600) / 1000) * 1000) / 1000;
  /* flip the radio CW → DATA one tone low for an over (one write, no read-back: ~30 ms), and back to CW `hang` ms after the last call */
  async function cwArm() {
    clearTimeout(ARM.t); if (ARM.on || parkData() || !toneCw() || !AP.catConnected() || !G.KPCCat || !KPCCat.tuneFast) return;
    ARM.on = true; const r = (G.KPCApp.dialNow && KPCApp.dialNow(36e5)) || null;
    ARM.back = r && /CW/.test(r.mode || '') ? r.khz : dialK('CW');
    if (r && /DATA/.test(r.mode || '') && Math.abs(r.khz - cwTxDial()) < 0.05) return;   /* already there */
    await KPCCat.tuneFast(cwTxDial(), 'DATA');
  }
  function cwDisarm(hang) {
    clearTimeout(ARM.t); if (!ARM.on) return;
    ARM.t = setTimeout(async () => { if (TXB || KEY.down) { cwDisarm(hang); return; } ARM.on = false; const back = ARM.back || dialK('CW');
      await KPCCat.tuneFast(back, 'CW'); setTimeout(async () => { const r2 = await KPCCat.read().catch(() => null); if (r2 && r2.khz && Math.abs(r2.khz - back) > 0.02) KPCCat.tuneFast(back, 'CW').catch(() => {}); if (r2) AP.fire('dial', r2); }, 700); }, hang == null ? 1200 : hang);
  }
  const cwOff = r => (MODE === 'CW' && toneCw() && (!r || /DATA/.test(r.mode || ''))) ? Math.round(dialK('CW') * 1000 - dialOut('CW') * 1000) / 1000 : 0;   /* the kHz the dial sits below the CW frequency */
  const radioMode = m => m === 'CW' ? (parkData() ? 'DATA' : 'CW') : m === 'SSTV' ? (band('SSTV') === '2m (ISS)' ? 'FM' : dialK('SSTV') < 10000 ? 'DATAL' : 'SSTV') : m === 'HELL' ? 'PSK' : m;   /* DATAL = data on LSB (Fable, Oct 26): 40 / 80 m SSTV pictures through the USB sound card */
  const myRef = () => { const me = AP.me(); return String(me.ref || '').split(/[\s,]+/)[0] || ''; };
  const stateOf = () => { const c = AP.myCounty && AP.myCounty(); return c ? c.split(',')[0] : ''; };
  const fill = t => String(t).replace(/\{MY\}/g, AP.myCall() || '').replace(/\{THEIR\}/g, ($('d5Call') ? $('d5Call').value : '').trim().toUpperCase()).replace(/\{REF\}/g, myRef()).replace(/\{GRID\}/g, AP.myGrid() || '').replace(/\{ST\}/g, stateOf()).replace(/\s+/g, ' ').trim();

  /* ================= the panel ================= */
  const pw = [0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 57, 60];
  const wat = d => { const w = Math.pow(10, d / 10) / 1000; return w < 1 ? Math.round(w * 1000) + ' mW' : (w < 10 ? w.toFixed(1).replace(/\.0$/, '') : Math.round(w)) + ' W'; };
  const html = `<div id="dg5" class="dg5" hidden data-m="cw">
    <div class="strip">
      <select id="d5Band" class="selc" aria-label="Band"></select>
      <b class="mono dial" id="d5Dial">14.060</b>
      <span class="kv"><i id="d5HzL">PITCH</i><b class="mono" id="d5Hz">600</b></span>
      <span class="kv d5q" title="How well the signal under the marker is copying"><i>SIGNAL</i><span class="lvbar"><i id="d5Q"></i></span></span>
      <span class="kv d5-cw"><i>WPM</i><b class="mono" id="d5Wpm">—</b></span>
      <button type="button" class="chip" id="d5Clr" title="Clear this mode's text">🧹 CLEAR</button>
    </div>
    <div class="chips spstrip" id="d5Spots" hidden aria-label="Spots on this band in this mode"></div>
    <div class="wfbox d5wfb"><canvas id="d5Wf" height="150" aria-label="Waterfall: tap a signal to tune to it"></canvas><canvas id="d5Sc" height="18"></canvas>
      <div class="wfoff" id="d5Off"><button type="button" class="gold big" id="d5Start">🎧 START LISTENING</button><span>Radio on the band below; the app moves it there when CAT is connected.</span></div></div>
    <div class="d5-kb">
      <div class="d5br d5-psk" id="d5Br"></div>
      <div class="d5rx" id="d5Rx" aria-live="polite"></div>
      <div class="d5hell d5-hell"><canvas id="d5Hell" width="1100" height="336" aria-label="Hellschreiber writing"></canvas><p class="hint">Hellschreiber is printed, not decoded: read the writing yourself (two copies of each line, so one is always whole). Tap the signal on the waterfall to tune to it.</p></div>
      <div class="d5calls" id="d5Calls"></div>
    </div>
    <div class="d5-sstv">
      <div class="st" id="d5Sst">Waiting for a picture…</div>
      <div class="d5pics"><canvas id="d5Cv" width="320" height="256" aria-label="Picture being received"></canvas>
        <div class="row"><label class="ck"><input type="checkbox" id="d5Auto"> Pick the type by itself (VIS)</label><select id="d5Man" class="selc" aria-label="Picture type for START NOW"></select><button type="button" class="b sm" id="d5Go">▶ START NOW</button><button type="button" class="b sm halt" id="d5StopRx">■ STOP</button><button type="button" class="b sm" id="d5Save">💾 SAVE PICTURE</button></div>
        <div class="d5gal" id="d5Gal"></div></div>
      <details class="d5send" id="d5Send"><summary>📤 SEND A PICTURE</summary>
        <div class="grid2"><label class="e">MODE<select id="d5TxMode"><option>Martin 1</option><option>Scottie 1</option><option>Robot 36</option><option>PD 120</option></select></label>
          <label class="e">TEXT ON TOP<input id="d5Top" spellcheck="false" autocapitalize="characters"></label><label class="e">TEXT ON THE BOTTOM<input id="d5Bot" spellcheck="false" autocapitalize="characters"></label></div>
        <div class="row"><button type="button" class="b sm" id="d5Pick">📷 PICK A PHOTO</button><button type="button" class="b sm" id="d5Card">🪪 MY CARD</button><input type="file" id="d5File" accept="image/*" hidden><small id="d5TxLen"></small></div>
        <canvas id="d5TxCv" width="320" height="256" aria-label="Picture to send"></canvas>
        <div class="row"><button type="button" class="b tx" id="d5TxGo">▶ SEND IT</button><button type="button" class="b halt" id="d5TxStop">■ STOP</button><span id="d5TxT"></span></div>
        <p class="hint">Use {MY}, {REF} (your park), {GRID}. Keep the power low: SSTV is a full-power steady signal for up to 2 minutes.</p></details>
    </div>
    <div class="d5-wspr">
      <div class="strip"><span class="kv"><i>NEXT 2-MIN CYCLE</i><b class="mono" id="d5WNext">--</b></span><span id="d5WSt" class="hint">Listening…</span></div>
      <div class="row"><label class="ck"><input type="checkbox" id="d5WTx"> Transmit my beacon</label>
        <select id="d5WPct" class="selc" aria-label="How often"><option value="20">1 cycle in 5</option><option value="33">1 in 3</option><option value="50">every other</option><option value="100">every cycle</option></select>
        <select id="d5WDbm" class="selc" aria-label="My power">${pw.map(d => `<option value="${d}">${d} dBm (${wat(d)})</option>`).join('')}</select>
        <button type="button" class="b sm" id="d5WNow">TX NEXT CYCLE</button><span class="hint" id="d5WMsg"></span></div>
      <div class="list dec" id="d5WList"><div class="empty">Decodes show here every 2 minutes (even UTC minutes). Radio on the WSPR frequency, USB / DATA.</div></div>
      <div class="row"><button type="button" class="b sm" id="d5Who">📍 WHO HEARD MY BEACON (LAST HOUR)</button><span class="hint" id="d5WhoT"></span></div>
      <div class="list dec" id="d5WhoL" hidden></div>
      <p class="hint">WSPR is a beacon: your call, grid and power go out; listening stations report it to wsprnet / wspr.live. Nobody answers and nothing goes in your log. Decoder: a port of WSJT-X's wsprd (K1JT, K9AN, GPL v3).</p>
    </div>
    <div class="d5log"><label class="e">THEIR CALL<input id="d5Call" autocapitalize="characters" spellcheck="false" autocomplete="off"></label><label class="e">SENT<input id="d5Rs" maxlength="3"></label><label class="e">RCVD<input id="d5Rr" maxlength="3"></label><label class="e">THEIR PARK<input id="d5Ref" autocapitalize="characters" spellcheck="false" autocomplete="off" placeholder="optional"></label><button type="button" class="b gold" id="d5Log">⬆ LOG IT</button></div>
    <div class="d5-kb2">
      <div class="d5mac" id="d5Mac"></div>
      <div class="d5key d5-cw" id="d5Key" aria-label="Hand keying"></div>
      <div class="d5txl"><input id="d5Tx" placeholder="Type here, Enter sends it" autocapitalize="characters" spellcheck="false" autocomplete="off"><button type="button" class="b tx" id="d5SendT">SEND</button><button type="button" class="b halt" id="d5Stop">STOP</button></div>
      <p class="hint" id="d5Why"></p>
    </div>
  </div>`;
  const host = $('aprsPanel') || $('dgFt');
  host.insertAdjacentHTML('afterend', html);
  const P = $('dg5');

  /* ================= waterfall (its own: 2048-point FFT, 5.9 Hz bins, a new row every 1024 samples) ================= */
  const wf = $('d5Wf'), sc = $('d5Sc'), wx = wf.getContext('2d'), sx = sc.getContext('2d');
  const N = 2048, HOP = 1024, ring = new Float32Array(N); let rn = 0, hopN = 0, VALS = null, BINS = null;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const re = new Float64Array(N), im = new Float64Array(N);
  const F = () => RANGE[MODE] || [200, 2800];
  const hzToX = hz => (hz - F()[0]) / (F()[1] - F()[0]) * wf.width, xToHz = x => F()[0] + x / wf.width * (F()[1] - F()[0]);
  function wfSize() { const w = Math.max(200, Math.round(wf.clientWidth || 600)); if (wf.width !== w) { wf.width = w; sc.width = w; drawScale(); } }
  function spectrum() {
    for (let i = 0; i < N; i++) { re[i] = ring[(rn + i) % N] * win[i]; im[i] = 0; }
    D.fft(re, im);
    if (MODE === 'CW') { if (!BINS) BINS = new Float32Array(N / 2); for (let k = 0; k < N / 2; k++) BINS[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12); }   /* per-bin dB for the CW gate (not tied to the canvas width) */
    const [f0, f1] = F(), W = wf.width, out = new Float32Array(W), bin = R / N;
    for (let x = 0; x < W; x++) { const a = Math.floor((f0 + x / W * (f1 - f0)) / bin), b = Math.max(a + 1, Math.floor((f0 + (x + 1) / W * (f1 - f0)) / bin)); let m = 0; for (let k = a; k < b && k < N / 2; k++) m = Math.max(m, re[k] * re[k] + im[k] * im[k]); out[x] = 10 * Math.log10(m + 1e-12); }
    return out;
  }
  let wfT = 0;
  function wfRow(vals) {
    VALS = vals; const t = performance.now(); if (document.hidden || P.hidden || t - wfT < 45) return; wfT = t;
    const srt = Array.from(vals).sort((a, b) => a - b), lo = srt[Math.floor(srt.length * 0.2)], hi = lo + 32;
    wx.drawImage(wf, 0, 0, wf.width, wf.height - 1, 0, 1, wf.width, wf.height - 1);
    const row = wx.createImageData(wf.width, 1);
    for (let x = 0; x < wf.width; x++) { const v = Math.max(0, Math.min(1, (vals[x] - lo) / (hi - lo))); const r = v < .5 ? 0 : (v - .5) * 2 * 255, g = v < .33 ? 0 : v < .8 ? (v - .33) / .47 * 255 : 255, b = v < .5 ? 60 + v * 2 * 195 : 255 - (v - .5) * 2 * 155; row.data.set([r, g, b, 255], x * 4); }
    wx.putImageData(row, 0, 0);
  }
  function drawScale() {
    const W = sc.width, H = sc.height, [f0, f1] = F(); sx.clearRect(0, 0, W, H); sx.fillStyle = 'rgba(140,150,170,.8)'; sx.font = '10px monospace'; sx.textAlign = 'center';
    const step = f1 - f0 > 1500 ? 500 : f1 - f0 > 600 ? 200 : 50;
    for (let f = Math.ceil(f0 / step) * step; f <= f1; f += step) { const x = hzToX(f); sx.fillRect(x, 0, 1, 4); sx.fillText(String(f), x, H - 2); }
    const mk = (hz, w, col, h) => { const x = hzToX(hz), ww = Math.max(2, w / (f1 - f0) * W); sx.fillStyle = col; sx.fillRect(x - ww / 2, 0, ww, h || 5); };
    if (MODE === 'CW') mk(S.cw.hz, cwBwHz(), '#45e08f', 6);
    else if (MODE === 'RTTY') { const s = S.rtty.shift / 2; mk(S.rtty.center + s, 8, S.rtty.rev ? '#ff5c5c' : '#45e08f'); mk(S.rtty.center - s, 8, S.rtty.rev ? '#45e08f' : '#ff5c5c'); }
    else if (MODE === 'PSK31') { mk(psk ? psk.fc : S.psk.hz, 31, '#45e08f'); BR.forEach(c => mk(c.rx.fc, 3, '#e8b84a', 3)); }
    else if (MODE === 'HELL') { mk(S.hell.hz, 245, 'rgba(69,224,143,.35)'); mk(S.hell.hz, 3, '#45e08f', 6); }
    else if (MODE === 'SSTV') { mk(1200, 6, '#ff5c5c'); mk(1500, 6, '#c9b48a'); mk(1900, 6, '#4da3ff'); mk(2300, 6, '#fff'); }
    else if (MODE === 'WSPR') { mk(1500, 200, 'rgba(232,184,74,.25)', 3); mk(S.wspr.hz, 6, '#ff5c5c'); }
    $('d5Hz').textContent = Math.round(audioHz());
  }
  const valAt = hz => { if (!VALS) return -200; const x = Math.round(hzToX(hz)); return VALS[Math.max(0, Math.min(VALS.length - 1, x))]; };
  function peakIn(a, b) { if (!VALS) return 0; let best = -1e9, bx = -1; const x0 = Math.max(0, Math.round(hzToX(a))), x1 = Math.min(VALS.length - 1, Math.round(hzToX(b))); for (let x = x0; x <= x1; x++) if (VALS[x] > best) { best = VALS[x]; bx = x; } const med = Array.from(VALS).sort((p, q) => p - q)[Math.floor(VALS.length / 2)]; return bx >= 0 && best - med > 8 ? xToHz(bx) : 0; }
  const snapPsk = hz => { if (!VALS) return hz; let sw = 0, s2 = 0; for (let f = hz - 22; f <= hz + 22; f += 1) { const p = Math.pow(10, valAt(f) / 10); sw += p; s2 += p * f; } return sw ? s2 / sw : hz; };
  const snapRtty = hz => { let best = hz, bv = -1e9; for (let c = hz - 120; c <= hz + 120; c += 2) { const a = valAt(c + S.rtty.shift / 2), b = valAt(c - S.rtty.shift / 2), s = Math.min(a, b) * 2 + a + b; if (s > bv) { bv = s; best = c; } } return best; };
  wf.addEventListener('click', e => { const r = wf.getBoundingClientRect(), hz = xToHz((e.clientX - r.left) / r.width * wf.width); click(hz); });
  function click(hz) {
    if (MODE === 'CW') cwPitch(peakIn(hz - 40, hz + 40) || hz);
    else if (MODE === 'RTTY') rttyTune(snapRtty(hz));
    else if (MODE === 'PSK31') pskTune(snapPsk(hz));
    else if (MODE === 'HELL') { S.hell.hz = Math.max(300, Math.min(2700, Math.round(snapPsk(hz)))); save(); hell.tune(S.hell.hz); drawScale(); }
    else if (MODE === 'WSPR') { S.wspr.hz = Math.max(1410, Math.min(1590, Math.round(hz))); save(); drawScale(); }
  }

  /* ================= receive text, calls heard ================= */
  let TXT = '', CALLS = [];
  const CALLRE = /\b((?:[A-Z]{1,2}|\d[A-Z])\d{1,2}[A-Z]{1,4})(?:\/[A-Z0-9]+)?\b/g;
  function rxChar(ch) { TXT = (TXT + ch).slice(-6000); if (/\s/.test(ch)) callScan(); clearTimeout(rxChar.t); rxChar.t = setTimeout(drawRx, 80); }
  function drawRx() { const el = $('d5Rx'), stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30; el.dataset.mode = MODE; el.innerHTML = (TXT ? '' : '<span class="ph">' + esc(MODE) + ' copy shows here.</span>') + esc(TXT).replace(/\[TX\]/g, '<i class="tx">▶</i>') + (MODE === 'CW' && C.cur ? '<span class="cur">' + esc(C.cur) + '</span>' : '<span class="cur">▌</span>'); if (stick) el.scrollTop = el.scrollHeight; }
  function callScan() {
    const tail = TXT.slice(-200), my = AP.myCall(); let m; CALLRE.lastIndex = 0;
    while ((m = CALLRE.exec(tail))) { const c = m[1]; if (c === my || c.length < 4) continue; CALLS = [c].concat(CALLS.filter(x => x !== c)).slice(0, 8); }
    $('d5Calls').innerHTML = CALLS.map(c => { const sp = spotOf(c), wk = G.KPCLog && KPCLog.worked(c); return `<button type="button" class="chip${sp ? ' park' : ''}${wk ? ' wk' : ''}" data-d5c="${esc(c)}">${esc(c)}${sp ? ' 🌲 ' + esc(sp) : ''}${wk ? ' ✓' : ''}</button>`; }).join('');
  }
  const spotOf = c => { if (!G.KPCSpots) return ''; const s = KPCSpots.all().find(x => x.call === c && x.refs.length); return s ? s.refs[0] : ''; };
  $('d5Calls').addEventListener('click', e => { const b = e.target.closest('[data-d5c]'); if (!b) return; $('d5Call').value = b.dataset.d5c; const r = spotOf(b.dataset.d5c); if (r) $('d5Ref').value = r; if (G.KPCLog && KPCLog.prefill) KPCLog.prefill({ call: b.dataset.d5c }); });
  /* Oct 25 (Brandon: 'went to PSK31, CW text showing on it … can't clear the old CW decodes, same with RTTY'): one text box was shared by
     all six modes. Now each mode keeps its own text and calls heard (TXTS / CALLSS), CLEAR wipes only the mode on screen (and its
     half-heard letter), and the box says which mode it is. */
  const TXTS = {}, CALLSS = {};
  function clearText() { TXT = ''; CALLS = []; C.cur = ''; $('d5Calls').innerHTML = ''; BR.length = 0; $('d5Br').innerHTML = ''; drawRx(); if (MODE === 'HELL') hellClear(); AP.toast('🧹 ' + MODE + ' text cleared.', 1500); }
  $('d5Clr').onclick = clearText;
  $('d5Call').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/\s/g, ''); };

  /* ================= CW: decoder (the website logger's) ================= */
  const MORSE = { '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z',
    '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9', '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/', '-...-': '=', '.-.-.': '+', '-....-': '-', '...-.-': '<SK>', '-.--.': '<KN>', '.-...': '<AS>' };
  const TOM = {}; for (const k in MORSE) if (MORSE[k].length === 1) TOM[MORSE[k]] = k;
  const C = { gate: 0, lvl: 0, a: [0, 0, 0, 0, 0, 0], n: 0, ph: 0, env: 0, sig: 1e-6, flo: 1e-6, on: false, run: 0, mk: 0, sp: 0, dit: 60, cur: '', spaced: true, snr: 0 };
  const cwBwHz = () => S.cw.bw === 'auto' ? Math.max(40, Math.min(160, 1200 / C.dit * 2.5)) : +S.cw.bw || 100;
  function cwFeed(v) {
    const w = 2 * Math.PI * S.cw.hz / R; C.ph += w; if (C.ph > 6.283185307) C.ph -= 6.283185307;
    const i = v * Math.cos(C.ph), q = v * Math.sin(C.ph), fa = 1 - Math.exp(-2 * Math.PI * (cwBwHz() / 2 / 0.51) / R), a = C.a;
    a[0] += fa * (i - a[0]); a[1] += fa * (a[0] - a[1]); a[2] += fa * (a[1] - a[2]); a[3] += fa * (q - a[3]); a[4] += fa * (a[3] - a[4]); a[5] += fa * (a[4] - a[5]);
    if (++C.n < 24) return; C.n = 0; if (C.gate > 0) C.gate -= 24;   /* every 2 ms */
    const e = Math.sqrt(a[2] * a[2] + a[5] * a[5]); C.env = C.env * .6 + e * .4;
    C.warm = (C.warm || 0) + 1;   /* 2 ms steps since the last reset: the noise floor rises fast for the first second, and nothing prints for 0.4 s */
    C.sig = Math.max(C.env, C.sig * 0.9995); C.flo = C.env < C.flo ? C.flo * .97 + C.env * .03 : C.flo * (C.warm < 500 ? 1.006 : 1.0008) + 1e-9; if (C.flo > C.sig * .6) C.flo = C.sig * .6;
    const thHi = C.flo + (C.sig - C.flo) * .5, thLo = C.flo + (C.sig - C.flo) * .35, snr = C.sig / (C.flo || 1e-9); C.snr = snr;
    const now = C.on ? C.env > thLo : C.env > thHi;
    if (C.warm < 200) { C.on = false; C.mk = C.sp = 0; return; }
    if (now !== C.on) { if (++C.run < Math.max(3, Math.round(C.dit / 8))) { cwTime(); return; } C.run = 0; if (C.on && snr > 2.2 && C.gate > 0) cwMark(C.mk); else if (!C.on && snr > 2.2 && C.gate > 0) cwGap(C.sp); C.on = now; C.mk = 0; C.sp = 0; } else C.run = 0;
    cwTime();
  }
  /* Oct 25 (Brandon: 'decoding OK, spacing and weaker stations could improve'): the letter and word gaps were fixed at 2.4 and 5.5 dits,
     so a fast, tight sender (letters 2 dits apart, words 5) ran together into nonsense. Now the decoder LEARNS each sender's spacing:
     the last 60 gaps are sorted into three groups (inside a letter / between letters / between words) on a log scale, and the
     thresholds sit between the groups; the dit comes from the last marks the same way (dits vs dahs). A glitch shorter than a third of
     a dit is ignored (was a fixed 6 ms), and the first few seconds use the textbook 2 / 5 dit thresholds. */
  const GAPS = [], MARKS = [];
  const cl = (arr, k, init) => { const L = arr.map(Math.log); let c = init.map(Math.log); for (let it = 0; it < 8; it++) { const sum = c.map(() => 0), n = c.map(() => 0); for (const v of L) { let b = 0; for (let j = 1; j < c.length; j++) if (Math.abs(v - c[j]) < Math.abs(v - c[b])) b = j; sum[b] += v; n[b]++; } c = c.map((x, j) => n[j] ? sum[j] / n[j] : x); } return c.map(Math.exp); };
  function cwLearn() {
    if (MARKS.length >= 6) { const [d1, d3] = cl(MARKS, 2, [Math.min(...MARKS), Math.max(...MARKS)]); if (d3 > d1 * 1.8) { C.dit = Math.max(20, Math.min(240, (d1 + d3 / 3) / 2)); C.mTh = Math.sqrt(d1 * d3); } }
    if (GAPS.length >= 12) { const [g1, g3, g7] = cl(GAPS, 3, [C.dit, C.dit * 3, C.dit * 7]);
      C.chTh = g3 > g1 * 1.5 ? Math.sqrt(g1 * g3) : C.dit * 2; C.wdTh = g7 > g3 * 1.4 ? Math.sqrt(g3 * g7) : Math.max(C.chTh * 2.2, C.dit * 5); }
  }
  function cwTime() { if (C.on) C.mk += 2; else { C.sp += 2; const chTh = C.chTh || C.dit * 2.2, wdTh = C.wdTh || C.dit * 5.5;
    if (C.cur && C.sp > chTh) { rxChar(MORSE[C.cur] || (C.cur.length > 7 ? '' : '*')); C.cur = ''; }
    if (!C.spaced && C.sp > wdTh) { rxChar(' '); C.spaced = true; }
    if (C.sp > 20 * C.dit && GAPS.length) { GAPS.length = 0; MARKS.length = 0; C.chTh = C.wdTh = C.mTh = 0; } } }   /* a long silence = maybe a new sender: learn again */
  function cwMark(d) { if (d < Math.max(10, C.dit / 3)) return; const dit = C.dit;
    MARKS.push(d); if (MARKS.length > 40) MARKS.shift();
    /* dit or dah: between the two groups of marks once there are a few (a fast sender's dah no longer reads as a dit), else at 2 dits;
       the first marks of a new sender move the dit estimate quickly, later ones gently */
    const th = C.mTh || 2 * dit, fast = MARKS.length < 12 ? .35 : .15;
    if (d < th) { C.cur += '.'; C.dit = Math.max(20, Math.min(240, dit * (1 - fast) + d * fast)); } else { C.cur += '-'; C.dit = Math.max(20, Math.min(240, dit * (1 - fast * .7) + d / 3 * fast * .7)); }
    C.spaced = false; if (C.cur.length > 8) C.cur = ''; cwLearn(); }
  function cwGap(d) { if (d < Math.max(10, C.dit / 3) || d > 20 * C.dit) return; GAPS.push(d); if (GAPS.length > 60) GAPS.shift(); }
  /* Oct 25: a SIGNAL GATE from the waterfall — plain noise used to print as E's and T's. The CW copy only counts while a tone stands (14 dB; noise reads up to ~8, a weak −4 dB signal ~28)
     8 dB or more above the band's noise right at the pitch (checked every waterfall row, held open 1.5 s after it fades). */
  /* Oct 27 (Fable; Brandon in CW-U with the radio's narrow filter: 'lots of extra E's'): the reference was the median of the WHOLE waterfall, which
     is near silence outside a 500 Hz radio filter, so the filtered noise at the pitch looked 14 dB 'loud'. Now the reference is the noise in
     a ring right around the pitch (inside the filter), taken high (65th percentile) so a ring half outside a narrow filter does not read low. */
  function cwGate() { if (!BINS) return; const bin = R / N, w = cwBwHz() / 2 + 15, kp = S.cw.hz / bin, R1 = Math.max(w, 70) / bin, R2 = Math.max(w * 2.5, 250) / bin, ring = [];
    let mx = -1e9; for (let k = Math.max(1, Math.floor(kp - R2)); k <= Math.min(N / 2 - 1, Math.ceil(kp + R2)); k++) { const d = Math.abs(k - kp); if (d <= w / bin) mx = Math.max(mx, BINS[k]); else if (d > R1) ring.push(BINS[k]); }
    ring.sort((a, b) => a - b); const med = ring.length ? ring[Math.floor(ring.length * 0.65)] : -100;
    C.lvl = mx - med; const sq = +S.cw.sq || 14; if (mx - med > sq) C.gate = R * 1.2; }
  function cwPitch(hz) { S.cw.hz = Math.max(250, Math.min(1300, Math.round(hz))); save(); C.sig = 1e-6; C.flo = 1e-6; C.warm = 0; C.cur = ''; GAPS.length = 0; MARKS.length = 0; C.chTh = C.wdTh = C.mTh = 0; drawScale(); }
  let afcN = 0;
  function cwAfc() { if (!S.cw.afc || TXB) return; const pk = peakIn(F()[0] + 50, F()[1] - 50); if (pk && Math.abs(pk - S.cw.hz) > 25 && Math.abs(pk - S.cw.hz) < 350) { if (++afcN > 8) { cwPitch(pk); afcN = 0; } } else afcN = 0; }
  const elems = (t, wpm) => { const u = 1200 / wpm, out = []; for (const w of t.split(' ')) { if (!w) continue; if (out.length) out.push([0, 6 * u]); const toks = w.match(/<[A-Z]{2}>|./g) || []; toks.forEach((ch, i) => { const k = ch.length > 1 ? Object.keys(MORSE).find(x => MORSE[x] === ch) : TOM[ch]; if (!k) return; if (i) out.push([0, 2 * u]); [...k].forEach((e, j) => { if (j) out.push([0, u]); out.push([1, e === '.' ? u : 3 * u]); }); out.push([0, u]); }); } return out; };   /* letter gap = u + 2u = 3u, word gap = u + 6u = 7u */
  const CWAB = [['THANK YOU', 'TU'], ['THANKS', 'TNX'], ['PLEASE', 'PSE'], ['YOUR', 'UR'], ['YOU', 'U'], ['ARE', 'R'], ['GOOD MORNING', 'GM'], ['GOOD AFTERNOON', 'GA'], ['GOOD EVENING', 'GE'], ['REPORT', 'RPT'], ['WEATHER', 'WX'], ['ANTENNA', 'ANT'], ['AGAIN', 'AGN'], ['FOR', 'FER'], ['AND', 'ES'], ['BEST REGARDS', '73'], ['POWER', 'PWR'], ['HERE', 'HR'], ['VERY', 'VY'], ['GOOD', 'GUD']];
  const cwShort = t => { let x = ' ' + t + ' '; for (const [a, b] of CWAB) x = x.split(' ' + a + ' ').join(' ' + b + ' '); return x.replace(/\s+/g, ' ').trim(); };
  function cwTone(t, wpm, hz) { const E = elems(t, wpm), tot = E.reduce((a, e) => a + e[1], 0) / 1000, out = new Float32Array(Math.ceil((tot + .15) * OUT)), rise = Math.round(.005 * OUT); let n = Math.round(.05 * OUT);
    for (const [k, ms] of E) { const len = Math.round(ms / 1000 * OUT); if (k) for (let i = 0; i < len; i++) { const env = Math.min(1, i / rise, (len - i) / rise); out[n + i] = 0.85 * Math.sin(2 * Math.PI * hz * (n + i) / OUT) * env; } n += len; } return out; }

  /* ================= RTTY / PSK31 / HELL ================= */
  let rtty = null, psk = null;
  function mkRtty() { rtty = new D.RttyRx({ center: S.rtty.center, shift: S.rtty.shift, baud: S.rtty.baud, rev: S.rtty.rev }); let pend = ''; rtty.onChar = c => { if (rtty.q > 0.72) { if (pend) { rxChar(pend); pend = ''; } rxChar(c); } else pend = (pend + c).slice(-8); }; }
  let pGate = 0;
  function mkPsk() { psk = new D.PskRx(S.psk.hz); psk.afc = S.psk.afc; psk.sq = S.psk.sq / 100; psk.onChar = c => { if (performance.now() < pGate || S.psk.sq === 0) rxChar(c); }; }
  function pskGate() { if (!VALS || !psk) return; const med = Array.from(VALS).sort((a, b) => a - b)[Math.floor(VALS.length / 2)]; let mx = -1e9; for (let f = psk.fc - 10; f <= psk.fc + 10; f += 2) mx = Math.max(mx, valAt(f)); if (mx > med + 8) pGate = performance.now() + 2500; }
  const BR = []; let brT = 0;
  function brFind() {
    const now = performance.now(); if (now - brT < 1500 || !VALS) return; brT = now;
    const W = VALS.length, med = Array.from(VALS).sort((a, b) => a - b)[Math.floor(W / 2)], span = Math.max(2, Math.round(25 / ((F()[1] - F()[0]) / W))), cand = [];
    for (let x = span; x < W - span; x++) { const v = VALS[x]; if (v < med + 12) continue; let top = true; for (let k = -span; k <= span; k++) if (VALS[x + k] > v) { top = false; break; } if (top) cand.push([xToHz(x), v]); }
    cand.sort((a, b) => b[1] - a[1]); const pk = []; for (const [f] of cand) if (f > 250 && f < 2750 && !pk.some(q => Math.abs(q - f) < 45)) pk.push(f);
    for (const f0 of pk.slice(0, 12)) { const f = snapPsk(f0), ch = BR.find(c => Math.abs(c.rx.fc - f) < 40); if (ch) { ch.seen = now; continue; }
      if (BR.length >= 10) { const k = BR.findIndex(c => !c.txt.trim() && now - c.born > 8000); if (k < 0) continue; BR.splice(k, 1); }
      const rx = new D.PskRx(f); rx.sq = Math.max(0.3, S.psk.sq / 100); const c = { rx, txt: '', seen: now, born: now }; rx.onChar = ch2 => { c.txt = (c.txt + (ch2 === '\n' ? ' ' : ch2)).slice(-90); }; BR.push(c); }
    for (let i = BR.length - 1; i >= 0; i--) if (now - BR[i].seen > 30000) BR.splice(i, 1);
    const list = BR.filter(c => c.txt.trim().length > 2).sort((a, b) => a.rx.fc - b.rx.fc);
    $('d5Br').innerHTML = list.length ? list.map(c => `<div class="d5bl${psk && Math.abs(c.rx.fc - psk.fc) < 15 ? ' on' : ''}" data-br="${c.rx.fc.toFixed(1)}" role="button" tabindex="0"><b>${Math.round(c.rx.fc)}</b><span>${esc(c.txt.slice(-70))}</span></div>`).join('') : '<div class="empty">Every PSK31 signal on the waterfall gets its own line here. Tap one to read it below.</div>';
  }
  $('d5Br').addEventListener('click', e => { const r = e.target.closest('[data-br]'); if (r) pskTune(+r.dataset.br); });
  function pskTune(hz) { S.psk.hz = Math.round(hz * 10) / 10; save(); psk.tune(S.psk.hz); drawScale(); }
  function rttyTune(c) { S.rtty.center = Math.round(c); save(); rtty.tune(S.rtty.center); drawScale(); }
  let afcT = 0; function rttyAfc() { if (!S.rtty.afc || TXB) return; const now = performance.now(); if (now - afcT < 2000) return; afcT = now; if (rtty.q < 0.5) return; const c = snapRtty(S.rtty.center); if (Math.abs(c - S.rtty.center) > 4 && Math.abs(c - S.rtty.center) < 60) rttyTune((c + S.rtty.center) / 2); }
  const hell = new D.HellRx(S.hell.hz), hc = $('d5Hell'), hx = hc.getContext('2d'); const HROWS = 14; let hX = 0, hCol = [];
  function hellClear() { hx.fillStyle = '#0b0d10'; hx.fillRect(0, 0, hc.width, hc.height); hX = 0; }
  hellClear();
  hell.onPx = v => { hCol.push(v); if (hCol.length < HROWS) return; const col = hCol; hCol = []; const lh = HROWS * 6, y0 = hc.height - lh, w = +S.hell.wide || 2, g = +S.hell.gain || 1;
    if (hX + w > hc.width) { const imd = hx.getImageData(0, lh, hc.width, hc.height - lh); hx.putImageData(imd, 0, 0); hx.fillStyle = '#0b0d10'; hx.fillRect(0, y0, hc.width, lh); hX = 0; }
    for (let r = 0; r < HROWS; r++) { const c = Math.round(255 * Math.max(0, Math.min(1, col[r] * g))); hx.fillStyle = `rgb(${Math.round(c * .95)},${c},${Math.round(c * .8)})`; const yy = (HROWS - 1 - r) * 3; hx.fillRect(hX, y0 + yy, w, 3); hx.fillRect(hX, y0 + HROWS * 3 + yy, w, 3); }
    hX += w; };

  /* ================= SSTV ================= */
  const sstv = new D.SstvRx(); let cur = null; const cv = $('d5Cv'), cx = cv.getContext('2d');
  function blank() { cx.fillStyle = '#0b0805'; cx.fillRect(0, 0, cv.width, cv.height); cx.fillStyle = '#6b5a3a'; cx.font = '14px Arial'; cx.textAlign = 'center'; cx.fillText('SSTV pictures show up here', cv.width / 2, cv.height / 2); }
  blank(); sstv.auto = S.sstv.auto;
  sstv.onStart = m => { cur = m; cv.width = m.w; cv.height = m.h; cx.fillStyle = '#000'; cx.fillRect(0, 0, m.w, m.h); $('d5Sst').textContent = '📺 Receiving ' + m.name + ' (' + sstvHow + ')…'; $('d5Man').value = m.name; sstvHow = 'VIS'; if (AP.notify) AP.notify('info', '📺 SSTV picture coming in (' + m.name + ')', { key: 'sstv', every: 60000, quiet: true }); };
  sstv.onRow = (y, px) => { if (!cur || y >= cur.h) return; const id = cx.createImageData(cur.w, 1); id.data.set(px); cx.putImageData(id, 0, y); if (y % 8 === 0) $('d5Sst').textContent = `📺 ${cur.name} · line ${y + 1} of ${cur.h}` + (sstvClip > 3 ? ' · ⚠ the sound is clipping: turn the radio\'s USB OUT (or RX LEVEL) down for cleaner colours' : ''); };
  let sstvClip = 0;
  sstv.onEnd = (m, r) => { $('d5Sst').textContent = r > 20 ? `✅ ${m.name} picture done (${r} lines). Waiting for the next one…` : 'Waiting for a picture…'; if (r > 20) galAdd(m.name); cur = null; };
  const GAL = LS('kpcAppSstv', []);
  function galAdd(name) { try { GAL.unshift({ url: cv.toDataURL('image/jpeg', 0.8), name, t: Date.now() }); GAL.splice(8); SV('kpcAppSstv', GAL); galDraw(); } catch (e) {} }
  function galDraw() { $('d5Gal').innerHTML = GAL.map((g, i) => `<button type="button" data-gal="${i}" title="${esc(g.name)}"><img src="${g.url}" alt="SSTV picture ${i + 1}"><small>${AP.utc(g.t)}</small></button>`).join(''); }
  galDraw();
  $('d5Gal').addEventListener('click', e => { const b = e.target.closest('[data-gal]'); if (!b) return; const g = GAL[+b.dataset.gal], img = new Image(); img.onload = () => { cv.width = img.width; cv.height = img.height; cx.drawImage(img, 0, 0); }; img.src = g.url; });
  $('d5Save').onclick = () => { cv.toBlob(async b => { if (!b) return; const name = 'KPC-SSTV-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.png', f = new File([b], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: 'SSTV picture' }); return; } catch (e) {} }
    if (AP.native) { AP.toast('The last 8 pictures stay in the row below the picture.', 4000); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png'); };
  /* Oct 25 (Brandon: 'a loud station did not decode great in Martin 1, not sure if this does auto mode or not'): it does (the VIS code at
     the start picks the type); the screen now SAYS which type it found and how (VIS / by hand), the type picker + the auto switch sit
     right here (not only in ⚙), and a clipped signal (peak at full scale) is named, because clipping smears the colours. */
  $('d5Man').innerHTML = Object.keys(D.SSTV).map(k => `<option${k === S.sstv.man ? ' selected' : ''}>${esc(k)}</option>`).join('');
  $('d5Man').onchange = () => { S.sstv.man = $('d5Man').value; save(); };
  $('d5Auto').checked = !!S.sstv.auto; $('d5Auto').onchange = () => { S.sstv.auto = sstv.auto = $('d5Auto').checked; save(); $('d5Sst').textContent = S.sstv.auto ? 'Waiting for a picture (the type is picked from its VIS code)…' : 'Auto start is OFF: pick the type and press ▶ START NOW when a picture begins.'; };
  let sstvHow = 'VIS';
  $('d5Go').onclick = () => { sstvHow = 'by hand'; sstv.stop(); sstv.manual(S.sstv.man); $('d5Sst').textContent = 'Started by hand: ' + S.sstv.man; };
  $('d5StopRx').onclick = () => sstv.stop();
  const tc = $('d5TxCv'), tx = tc.getContext('2d'); let PIC = null;
  function txDraw() {
    const m = D.SSTV[S.sstv.tx]; tc.width = m.w; tc.height = m.h; $('d5TxLen').textContent = Math.round(m.secs + 1) + ' seconds on the air'; const W = tc.width, H = tc.height;
    if (PIC) { const r = Math.max(W / PIC.width, H / PIC.height), w = PIC.width * r, h = PIC.height * r; tx.drawImage(PIC, (W - w) / 2, (H - h) / 2, w, h); }
    else { const g = tx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1b2a1a'); g.addColorStop(1, '#5a3a12'); tx.fillStyle = g; tx.fillRect(0, 0, W, H); tx.fillStyle = '#e8b84a'; tx.font = `900 ${Math.round(H * 0.2)}px Arial`; tx.textAlign = 'center'; tx.fillText(AP.myCall() || 'MY CALL', W / 2, H * 0.56); tx.font = `700 ${Math.round(H * 0.07)}px Arial`; tx.fillStyle = '#fff'; tx.fillText([myRef(), AP.myGrid()].filter(Boolean).join(' · ') || 'KENTUCKY PORTABLE CLUB', W / 2, H * 0.72); }
    const bandT = (t, y) => { t = fill(t).toUpperCase(); if (!t) return; const fs = Math.round(H * 0.085); tx.font = `900 ${fs}px Arial`; tx.textAlign = 'center'; tx.fillStyle = 'rgba(0,0,0,.6)'; tx.fillRect(0, y - fs * 1.05, W, fs * 1.4); tx.fillStyle = '#fff'; tx.fillText(t, W / 2, y); };
    bandT($('d5Top').value, Math.round(H * 0.11)); bandT($('d5Bot').value, Math.round(H * 0.96));
  }
  $('d5TxMode').value = S.sstv.tx; $('d5TxMode').onchange = () => { S.sstv.tx = $('d5TxMode').value; save(); txDraw(); };
  $('d5Top').value = S.sstv.top; $('d5Bot').value = S.sstv.bot; ['d5Top', 'd5Bot'].forEach(id => { $(id).oninput = () => { S.sstv.top = $('d5Top').value; S.sstv.bot = $('d5Bot').value; save(); txDraw(); }; });
  $('d5Pick').onclick = () => $('d5File').click(); $('d5Card').onclick = () => { PIC = null; txDraw(); };
  $('d5File').onchange = () => { const f = $('d5File').files[0]; if (!f) return; const img = new Image(); img.onload = () => { PIC = img; txDraw(); }; img.src = URL.createObjectURL(f); };
  $('d5Send').addEventListener('toggle', () => { if ($('d5Send').open) txDraw(); });
  $('d5TxGo').onclick = async () => { txDraw(); const m = D.SSTV[S.sstv.tx], img = tx.getImageData(0, 0, m.w, m.h); $('d5TxT').textContent = 'Making the sound…'; await sleep(30);
    const buf = D.sstvTx(img, S.sstv.tx, OUT); $('d5TxT').textContent = '📡 Sending ' + S.sstv.tx + ' (' + Math.round(buf.length / OUT) + ' s)…'; const ok = await send(buf, 'SSTV ' + S.sstv.tx); $('d5TxT').textContent = ok ? '✅ Sent.' : ''; };
  $('d5TxStop').onclick = () => { stopTx(); $('d5TxT').textContent = 'Stopped.'; };

  /* ================= WSPR ================= */
  let W = null, WK = null, wid = 0, wNext = false, wTxCyc = -1, wTxOn = -1, WLINES = [];
  const cyc = t => Math.floor(t / 120) * 120;
  function wNew(c) { W = { c, buf: new Float32Array(114 * R), got: new Uint8Array(114), tx: false }; }
  function wFeed(blk, t) {
    const c = cyc(t); if (!W || c > W.c + 119) { if (W && !W.done) wEnd(); wNew(c); }
    for (let i = 0; i < blk.length; i++) { const tt = t + i / R - W.c; if (tt < 0) continue; if (tt >= 114) { if (!W.done) wEnd(); const c2 = cyc(t + i / R); if (c2 > W.c) wNew(c2); continue; } W.buf[Math.floor(tt * R)] = blk[i]; W.got[Math.floor(tt)] = 1; }
  }
  /* Oct 25 (Brandon: 'no decode wspr 14095.6'): the decoder itself copies a made-up beacon down to −6 dB (checked). What went wrong was
     the feeding: (1) on the PC the sound's clock fell behind (fixed in 0.7.1), so a cycle got only part of its 114 s and was skipped
     without a word; (2) a Worker that failed to start (a file:// page) lost that cycle's sound for good, because the buffer had been
     handed to it. Now the cycle says how many of its 114 seconds came in, the sound is copied (not handed over), and a Worker that
     errors or stays quiet for 90 s is replaced by decoding on the page. */
  const WPEND = {};
  function wInline(id) { const p = WPEND[id]; if (!p) return; delete WPEND[id]; setTimeout(() => { let res = []; try { res = D.wsprDecode(p.audio, { ms: 30000 }); } catch (x) {} p.done(res); }, 30); }
  function wEnd() {
    W.done = true; const n = W.got.reduce((a, b) => a + b, 0);
    if (W.tx || W.c === wTxOn) { $('d5WSt').textContent = 'Sent my beacon this cycle.'; return; }
    if (n < 100) { $('d5WSt').textContent = n < 5 ? 'Listening… (the first full cycle starts on the next even minute)' : `Heard only ${n} of 114 s of the ${AP.utc(W.c * 1000)} cycle (a cycle needs nearly all of it): waiting for the next one.`; return; }
    const c = W.c, audio = W.buf; $('d5WSt').textContent = `🔎 Decoding ${AP.utc(c * 1000)} (${n} of 114 s heard)…`;
    const id = ++wid, done = res => wShow(c, res || []);
    WPEND[id] = { audio, done };
    try { if (!WK) { WK = new Worker('kpc-dsp.js?v=20261025g'); WK.onmessage = e => { const m = e.data; const p = m && m.cmd === 'wspr' && WPEND[m.id]; if (p) { delete WPEND[m.id]; p.done(m.res); } }; WK.onerror = () => { WK = 'no'; Object.keys(WPEND).forEach(k => wInline(+k)); }; }
      if (WK === 'no') throw new Error('no worker');
      WK.postMessage({ cmd: 'wspr', id, audio: audio.slice(), opt: { ms: 60000 } });
      setTimeout(() => { if (WPEND[id]) { WK = 'no'; wInline(id); } }, 90000); }
    catch (e) { wInline(id); }
  }
  function wShow(c, res) {
    const my = AP.gridLL ? AP.gridLL(AP.myGrid()) : null, dial = dialK('WSPR');
    for (const r of res) { const ll = r.grid && AP.gridLL ? AP.gridLL(r.grid) : null; let d = ''; if (my && ll && G.KPCAX25) d = AP.dist(KPCAX25.geo(my.la, my.lo, ll.la, ll.lo).km); WLINES.push({ t: c, snr: r.snr, dt: r.dt, mhz: (dial * 1000 + 1500 + r.df) / 1e6, drift: r.drift, call: r.call, grid: r.grid, dbm: r.dbm, d }); }
    if (WLINES.length > 300) WLINES = WLINES.slice(-300);
    $('d5WSt').textContent = `${res.length} decoded at ${AP.utc(c * 1000)}`; wDraw();
  }
  function wDraw() { const el = $('d5WList'); if (!WLINES.length) return; let last = -1;
    el.innerHTML = WLINES.slice(-120).map(x => { const sep = x.t !== last ? `<div class="dsep">${AP.utc(x.t * 1000)} ── WSPR</div>` : ''; last = x.t; return sep + `<div class="dl"><span>${x.snr}</span><span>${x.dt.toFixed(1)}</span><span>${x.mhz.toFixed(6)}</span><span></span><span class="m"><b>${esc(x.call)}</b> ${esc(x.grid)} ${x.dbm} dBm${x.d ? ' · ' + esc(x.d) : ''}</span></div>`; }).join(''); el.scrollTop = el.scrollHeight; }
  function wMsg() { const c = AP.myCall(), g = (AP.myGrid() || '').slice(0, 4), sym = c && g && AP.stdCall(c) ? D.wsprEncode(c, g, S.wspr.dbm) : null;
    $('d5WMsg').innerHTML = sym ? `Sends: <b>${esc(c)} ${esc(g)} ${S.wspr.dbm}</b>` : `<span class="bad">${!c ? 'Put your call in STATION.' : !g ? 'Put your grid in STATION.' : 'WSPR sends a plain real call only (no practice calls, no /P).'}</span>`; return sym; }
  setInterval(() => {
    const t = AP.now() / 1000, c = cyc(t), into = t - c; if ($('d5WNext')) $('d5WNext').textContent = Math.floor((120 - into) / 60) + ':' + String(Math.floor((120 - into) % 60)).padStart(2, '0');
    if (MODE !== 'WSPR' || !AP.running()) return;
    if (into < 0.9 && wTxCyc !== c) { wTxCyc = c; const want = S.wspr.tx && (wNext || Math.random() * 100 < S.wspr.pct); wNext = false;
      if (want) { const sym = wMsg(); if (sym && !TXB) { const buf = D.wsprTx(sym, S.wspr.hz, OUT); wTxOn = c; if (W && W.c === c) W.tx = true;
        setTimeout(() => { $('d5WSt').textContent = `📡 Sending my beacon at ${S.wspr.hz} Hz…`; send(buf, 'WSPR').then(ok => { if (ok) $('d5WSt').textContent = 'Beacon sent. Listening…'; }); }, Math.max(0, (1 - into) * 1000)); } } }
  }, 250);
  $('d5WTx').checked = S.wspr.tx; $('d5WTx').onchange = () => { S.wspr.tx = $('d5WTx').checked; save(); wMsg(); };
  $('d5WPct').value = String(S.wspr.pct); $('d5WPct').onchange = () => { S.wspr.pct = +$('d5WPct').value; save(); };
  $('d5WDbm').value = String(S.wspr.dbm); $('d5WDbm').onchange = () => { S.wspr.dbm = +$('d5WDbm').value; save(); wMsg(); };
  $('d5WNow').onclick = () => { if (!wMsg()) return; if (!S.wspr.tx) { S.wspr.tx = true; $('d5WTx').checked = true; save(); } wNext = true; AP.toast('Your beacon goes out at the start of the next even minute.', 3000); };
  $('d5Who').onclick = async () => { const c = AP.myCall(); if (!c) { AP.toast('Put your call in STATION first.', 3000, 'bad'); return; } $('d5WhoT').textContent = 'Asking wspr.live…';
    const sql = `SELECT time, rx_sign, rx_loc, snr FROM wspr.rx WHERE tx_sign='${c.replace(/[^A-Z0-9/]/g, '')}' AND time > now() - INTERVAL 60 MINUTE ORDER BY time DESC LIMIT 200 FORMAT JSON`;
    try { const r = await AP.net.raw('https://db1.wspr.live/?query=' + encodeURIComponent(sql), { ms: 15000 }); if (!r.ok) throw new Error(r.err || r.status); const rows = (JSON.parse(r.text).data) || [], seen = {};
      const L = rows.filter(w => !seen[w.rx_sign] && (seen[w.rx_sign] = 1));
      $('d5WhoT').textContent = L.length ? L.length + ' station' + (L.length > 1 ? 's' : '') + ' heard you' : 'Nobody reported you in the last hour (it takes a few minutes to show up).';
      $('d5WhoL').hidden = !L.length; $('d5WhoL').innerHTML = L.map(w => `<div class="dl"><span>${esc(w.snr)}</span><span></span><span></span><span></span><span class="m"><b>${esc(w.rx_sign)}</b> ${esc(w.rx_loc)} · ${esc(String(w.time).slice(11, 16))}z</span></div>`).join('');
    } catch (e) { $('d5WhoT').textContent = 'wspr.live did not answer (no signal?).'; } };

  /* ================= sending ================= */
  let TXB = false, stopFlag = false;
  function whyNot(mm) { const MODE0 = MODE; if (mm) MODE = mm; try { return whyNot0(); } finally { MODE = MODE0; } }
  function whyNot0() {
    if (!AP.myCall()) return 'Put your call sign in STATION → My station first.';
    if (!AP.stdCall(AP.myCall())) return 'Sending needs your real call sign (a practice call like K4TEST must never go on the air).';
    if (MODE === 'CW' && (S.cw.via === 'cat' || S.cw.via === 'dtr' || S.cw.via === 'rts')) { if (!(AP.catConnected() || (G.KPCCat && KPCCat.get().link === 'fake'))) return 'CW by the radio\'s keyer or a key line needs the radio connected (STATION → Radio control).';
      if (S.cw.via === 'cat' && G.KPCCat && !KPCCat.cwCan()) return 'This radio has no CAT keyer (older Yaesu). Under ⚙ CW → SEND WITH pick the DTR key line (radio menu USB KEYING = DTR).'; return ''; }
    if (!AP.running()) return 'Press 🎧 START LISTENING first (the sound goes out through the radio\'s sound card).';
    if (!AP.canKey()) return AP.can.why('key');
    return '';
  }
  async function send(pcm48, label) {
    const w = whyNot(); if (w) { AP.toast(esc(w), 5000, 'bad'); return false; }
    if (TXB) { AP.toast('Still sending: wait or press STOP.', 2500); return false; }
    TXB = true; stopFlag = false; chk(); AP.fire('mode', MODE);
    try { A.pauseRx = MODE !== 'CW'; await AP.pttOn(true); const r = await A.play(pcm48, 0, 'm5'); return !(r && r.state === 'stopped') && !stopFlag; }
    catch (e) { AP.toast('Could not send: ' + esc(e.message || e), 5000, 'bad'); return false; }
    finally { A.pauseRx = false; await AP.pttOn(false); TXB = false; chk(); }
  }
  function stopTx() { stopFlag = true; if (typeof AUTO5 !== 'undefined' && AUTO5) autoOff5('Stopped.'); if (typeof KEY !== 'undefined' && KEY.down) keyUp(); PADS.forEach(p => { p.P.dit = p.P.dah = false; }); if (TXB) { Promise.resolve().then(() => A.stopTx()).catch(() => {}); } if (G.KPCCat) { try { if (KPCCat.cwStop) KPCCat.cwStop(); if (S.cw.via === 'dtr' || S.cw.via === 'rts') KPCCat.keyLine(false, S.cw.via); } catch (e) {} } }
  async function sendText(t) {
    t = fill(t).toUpperCase().trim(); if (!t) return false;
    if (MODE === 'CW' && S.cw.abbr) t = cwShort(t);
    const w = whyNot(); if (w) { AP.toast(esc(w), 5000, 'bad'); return false; }
    TXT += '\n[TX] ' + t + '\n'; drawRx();
    if (MODE === 'CW') return cwOut(t, 0, true);
    const line = '\n' + t + '\n';
    const buf = MODE === 'RTTY' ? D.rttyTx(line, S.rtty, OUT) : MODE === 'HELL' ? D.hellTx(t, S.hell.hz, OUT) : MODE === 'PSK31' ? D.pskTx(line, S.psk.hz, OUT) : null;
    return buf ? send(buf, MODE) : false;
  }
  /* CW out by the way picked in ⚙ CW → SEND WITH (also for the remote, whatever mode the PC screen is on) */
  async function cwOut(t, wpm0, checked) {
    t = String(t || '').toUpperCase().trim(); if (!t) return false;
    if (!checked) { const w = whyNot('CW'); if (w) { AP.toast(esc(w), 5000, 'bad'); return false; } }
    { const was = MODE; MODE = 'CW'; try {
      const wpm = +wpm0 || +S.cw.wpm || 20, via = S.cw.via;
      if (via === 'cat') { if (!KPCCat.cwCan()) { AP.toast('This radio cannot take typed CW over CAT: pick "a key line" or "sound" under ⚙ CW → SEND WITH.', 6000, 'bad'); return false; }
        TXB = true; chk(); try { await KPCCat.cw(t, wpm); await sleep(elems(t, wpm).reduce((a, e) => a + e[1], 0) + 200); } finally { TXB = false; chk(); } return true; }
      if (via === 'dtr' || via === 'rts') { TXB = true; stopFlag = false; chk(); try { let t1 = performance.now(); for (const [k, d] of elems(t, wpm)) { if (stopFlag) break; await KPCCat.keyLine(!!k, via); t1 += d; const ww = t1 - performance.now(); if (ww > 0) await sleep(ww); } } finally { await KPCCat.keyLine(false, via); TXB = false; chk(); } return true; }
      /* a tone through the sound card only reaches the air in a DATA/USB mode: a radio sitting in CW ignores its USB sound (Brandon Oct 25:
         'power out but nothing in the monitor'). Put it in DATA, one tone lower, send, and put it back on CW. */
      const tone = S.cw.tone || S.cw.hz;
      await cwArm(); if (ARM.on) await sleep(60);
      try { return await send(cwTone(t, wpm, tone), 'CW'); }
      finally { cwDisarm(); }
    } finally { MODE = was; } }
  }
  /* macros: CW keeps them short, the keyboard modes send whole lines */
  const MAC = {
    CW: h => h ? [['CALL', '{MY}'], ['REPORT', '{THEIR} TU 5NN {ST} {ST} BK'], ['P2P', '{THEIR} TU 5NN P2P {REF} BK'], ['TU', 'TU 73 DE {MY}'], ['AGN', 'AGN?'], ['QRZ', 'QRZ? DE {MY}']]
      : [['CQ', 'CQ POTA DE {MY} {MY} K'], ['REPORT', '{THEIR} TU 5NN {ST} {ST} BK'], ['TU QRZ', 'TU 73 QRZ POTA DE {MY}'], ['CALL', '{MY}'], ['AGN', 'AGN?'], ['P2P', '{THEIR} TU 5NN P2P {REF} BK']],
    KB: h => h ? [['CALL', '{THEIR} DE {MY} {MY} K'], ['REPORT', '{THEIR} TU 599 599 {ST} {ST} DE {MY} K'], ['73', 'TU 73 GL {THEIR} DE {MY} SK'], ['AGN', 'AGN AGN DE {MY} K'], ['P2P', '{THEIR} TU 599 599 {ST} P2P {REF} {REF} DE {MY} K'], ['MY CALL', '{MY} {MY}']]
      : [['CQ POTA', 'CQ CQ CQ POTA DE {MY} {MY} {MY} {REF} K'], ['REPLY', '{THEIR} DE {MY} TU UR 599 599 {ST} {ST} {THEIR} DE {MY} K'], ['TU QRZ', '{THEIR} TU 73 QRZ DE {MY} POTA K'], ['AGN', 'AGN AGN DE {MY} K'], ['QRZ', 'QRZ? DE {MY} K'], ['73', '73 TU {THEIR} DE {MY} SK']]
  };
  const macros = () => S.mac[MODE] || (MODE === 'CW' ? MAC.CW : MAC.KB)(AP.me().hunt);
  function macDraw() { $('d5Mac').innerHTML = macros().map((m, i) => `<button type="button" class="chip" data-d5m="${i}" title="${esc(m[1])}">F${i + 1} ${esc(m[0])}</button>`).join('') + `<button type="button" class="chip${AUTO5 ? ' on' : ''}" data-d5auto title="Send F1 again and again with a listening gap, until someone answers">🔁 AUTO CQ${AUTO5 ? ' · ON' : ''}</button>` + '<button type="button" class="chip" data-d5medit>✏️ EDIT</button>'; }
  $('d5Mac').addEventListener('click', e => { const b = e.target.closest('[data-d5m]'); if (b) { if (AUTO5) autoOff5(); sendText(macros()[+b.dataset.d5m][1]); return; } if (e.target.closest('[data-d5auto]')) { if (AUTO5) autoOff5('Auto CQ off.'); else autoOn5(); return; } if (e.target.closest('[data-d5medit]')) macEdit(); });
  /* AUTO CQ for the keyboard modes (Brandon Oct 25: 'an auto repeat option … only needed on the CQ'): F1, then a listening gap, again —
     stops when you type their call, tap a memory, STOP, or after 10 minutes (someone has to be listening) */
  let AUTO5 = null;
  async function autoOn5() {
    const w = whyNot(); if (w) { AP.toast(esc(w), 5000, 'bad'); return; }
    const me = AUTO5 = { t0: Date.now(), mode: MODE }; macDraw();
    while (AUTO5 === me && MODE === me.mode) {
      if (Date.now() - me.t0 > 10 * 60000) { autoOff5('Auto CQ stopped after 10 minutes.'); break; }
      const ok = await sendText(macros()[0][1]); if (AUTO5 !== me) break; if (!ok) { autoOff5('Auto CQ stopped.'); break; }
      for (let k = +(S.gap5 || 6); k > 0 && AUTO5 === me; k--) { $('d5Why').textContent = '👂 Listening… next CQ in ' + k + ' s (type their call or tap STOP)'; await sleep(1000); }
    }
  }
  function autoOff5(why) { if (!AUTO5) return; AUTO5 = null; macDraw(); chk(); if (why) $('d5Why').textContent = why; }
  $('d5Call').addEventListener('input', () => { if (AUTO5 && $('d5Call').value.trim().length >= 3) autoOff5('Auto CQ stopped: you are working ' + $('d5Call').value.trim().toUpperCase() + '.'); });

  /* ================= HAND KEYING (Brandon Oct 25: 'cw has several keyers … but no actual tap to key or paddle option') =================
     TAP TO KEY = a straight key (hold = key down). PADDLES = two touch paddles, iambic (A or B, the WPM setting). The keys go out the way
     ⚙ CW → SEND WITH says: the DTR / RTS key line (the radio's own break-in keys it) or a tone through the sound card (PTT held while
     keying, let go 1.2 s after the last element). The radio's CAT keyer cannot be keyed by hand. On a PC: [ = dit, ] = dah, \\ = straight key.
     The REMOTE tab uses the same pad; there the phone sends the key timing and the PC plays it back evenly (kpc-remote.js). */
  const KEY = { down: false, ptt: false, offT: 0, tone: null, safety: 0 };
  /* Oct 26 (Brandon: 'tap to key not working in cw, don't key up'): key edges go out ONE AT A TIME (a short tap used to let go while the
     first key-down was still opening the key port / PTT, and the tone then ran on); a key line that fails now SAYS why. */
  let KQ = Promise.resolve(), WANT = false;
  const kq = f => (KQ = KQ.then(f, f));
  function keyWhy() { if (S.cw.via === 'cat') return 'The radio\'s CAT keyer cannot be keyed by hand: pick the DTR key line (or sound) in ⚙ CW → SEND WITH.'; return whyNot('CW'); }
  function keyDown() { if (WANT) return Promise.resolve(true); const w = keyWhy(); if (w) { AP.toast(esc(w), 5000, 'bad'); return Promise.resolve(false); } WANT = true; return kq(rawDown); }
  function keyUp() { if (!WANT && !KEY.down) return Promise.resolve(); WANT = false; return kq(rawUp); }
  async function rawDown() {
    if (KEY.down) return true;
    if (AUTO5) autoOff5(); KEY.down = true; clearTimeout(KEY.offT); clearTimeout(KEY.safety); KEY.safety = setTimeout(() => { if (KEY.down) { keyUp(); AP.toast('Key held over 8 s: let go by itself.', 3000); } }, 8000);
    TXB = true; chk();
    if (S.cw.via === 'dtr' || S.cw.via === 'rts') {
      const ok = await KPCCat.keyLine(true, S.cw.via);
      if (!ok) { KEY.down = false; WANT = false; clearTimeout(KEY.safety); TXB = false; chk(); const i = KPCCat.keyPortInfo ? KPCCat.keyPortInfo() : {};
        AP.toast('The ' + S.cw.via.toUpperCase() + ' key line did not key (' + esc(i.which || 'no port') + '). Connect the radio first (STATION → Radio control); a Yaesu FT-710 / 991A / FTDX10 keys on its SECOND USB port: ⚙ CW → PICK THE KEY PORT BY HAND, radio menu USB KEYING (CW) = DTR, BK-IN = ON. Or SEND WITH = sound.', 9000, 'bad'); return false; }
      if (KPCCat.keyPortInfo && /CAT port/.test(KPCCat.keyPortInfo().which || '') && /^ft(710|991|dx10|dx101|x1)/.test((KPCCat.get().radio || '')) && !keyDown.warned) { keyDown.warned = 1; AP.toast('Heads up: keying DTR on the CAT port. A Yaesu with two USB ports keys on the SECOND port: ⚙ CW → PICK THE KEY PORT BY HAND.', 7000); }
      return true;
    }
    if (!KEY.ptt) { KEY.ptt = true; A.pauseRx = false;
      /* a tone only reaches the air in DATA (Fable's rule for typed CW): the first key-down puts a radio sitting in CW into DATA one tone lower */
      await cwArm();
      const ok = await AP.pttOn(true); if (ok === false && AP.S.ptt !== 'vox') AP.toast('PTT did not answer: check the radio connection (STATION → Radio control).', 4000, 'bad'); }
    if (!AP.running()) { AP.toast('Sound is off: press START (the tone goes out through the radio\'s USB sound card).', 4000, 'bad'); }
    KEY.tone = A.tone(S.cw.tone || S.cw.hz, 8, 'key'); if (KEY.tone && KEY.tone.catch) KEY.tone.catch(() => {}); return true;
  }
  async function rawUp() {
    if (!KEY.down) return; KEY.down = false; clearTimeout(KEY.safety);
    if (S.cw.via === 'dtr' || S.cw.via === 'rts') { await KPCCat.keyLine(false, S.cw.via); TXB = false; chk(); return; }
    try { await A.stopTx(); } catch (e) {}
    clearTimeout(KEY.offT); KEY.offT = setTimeout(async () => { if (!KEY.down && KEY.ptt) { KEY.ptt = false; await AP.pttOn(false); TXB = false; chk(); cwDisarm(0); } }, 1200);
  }
  /* PADDLES (Oct 26, Brandon: 'more key options like the CW practice room'): Iambic B / Iambic A / Ultimatic (the last paddle pressed wins
     while both are held) / Bug (the dit paddle sends dits by itself, the dah paddle is a straight key); ⇄ SWAP for left-handers; WEIGHT
     = how long a dah is (3 dits is standard); keyboard (PC): [ ] or Z X or Left/Right Ctrl = paddles, Space or \ = straight key;
     a 🖱 mouse paddle (left button = dit, right = dah); 🎹 USB key adapters in MIDI mode (Vail-style: C = straight key, C# = dit, D = dah).
     Each pad has its own paddle state (the local CW screen and the REMOTE pads never mix). */
  const KM = { B: 'Iambic B', A: 'Iambic A', U: 'Ultimatic', G: 'Bug (semi-auto)' };
  const kmode = () => KM[S.cw.iam] ? S.cw.iam : 'B';
  async function iamRun(P, sink) {
    if (P.run) return; P.run = true;
    try { for (;;) {
      const u = 1200 / (+S.cw.wpm || 20), wt = Math.max(2.5, Math.min(4.5, +S.cw.wt || 3)), m = kmode(); let el = '';
      if (m === 'G') { if (P.dit) el = '.'; }
      else if (P.dit && P.dah) el = m === 'U' ? P.lastPress : (P.last === '.' ? '-' : '.');
      else if (P.dit) el = '.'; else if (P.dah) el = '-'; else if (P.memo && m === 'B') { el = P.memo; P.memo = ''; }
      if (!el) break;
      P.last = el; const t = el === '.' ? u : wt * u;
      if (!(await sink.down())) { P.dit = P.dah = false; break; } const sq = P.dit && P.dah;
      await sleep(t); await sink.up(); if (m === 'B' && sq && !(P.dit && P.dah)) P.memo = el === '.' ? '-' : '.';
      await sleep(u);
    } } finally { P.run = false; }
  }
  const PADS = [];
  function keyPad(host, sink) {
    if (!host) return; sink = sink || { down: keyDown, up: keyUp };
    const P = { dit: false, dah: false, run: false, last: '', memo: '', lastPress: '.', sink, host };
    const draw = () => { host.innerHTML = `<div class="kpad"><button type="button" class="kbtn st" data-k="s" title="Straight key: hold to send (Space or \\ on a PC)">✋ TAP TO KEY</button>
      <button type="button" class="kbtn pd" data-k="${S.cw.swap ? '-' : '.'}" title="Left paddle">${S.cw.swap ? '— DAH' : '• DIT'}</button><button type="button" class="kbtn pd" data-k="${S.cw.swap ? '.' : '-'}" title="Right paddle">${S.cw.swap ? '• DIT' : '— DAH'}</button></div>
      <div class="kopts"><button type="button" class="chip sm" data-ko="mode" title="How the paddles key">🎚 ${esc(KM[kmode()])}</button><button type="button" class="chip sm${S.cw.swap ? ' on' : ''}" data-ko="swap" title="Swap the paddles (left-handed or 'backwards' paddles)">⇄ SWAP</button>
        <button type="button" class="chip sm" data-ko="wt" title="Dah length (3 = standard)">⚖ WEIGHT ${(+S.cw.wt || 3).toFixed(1)}</button><button type="button" class="chip sm" data-ko="wpm" title="Speed">⏩ ${esc(String(S.cw.wpm || 20))} WPM</button>
        ${AP.pc || !AP.native ? '<button type="button" class="chip sm" data-ko="midi" title="USB key adapters in MIDI mode (Vail adapter and the like)">🎹 USB KEY (MIDI)</button>' : ''}</div>
      ${AP.native ? '' : '<div class="kmouse" data-ko="mouse" title="Hold the pointer here: left button = dit, right button = dah, both = squeeze">🖱 MOUSE PADDLE · left = dit · right = dah</div>'}
      <p class="hint kph">${AP.native ? 'Hold TAP TO KEY like a straight key, or squeeze the paddles.' : 'Keyboard: <b>[ ]</b>, <b>Z X</b> or <b>Left / Right Ctrl</b> = paddles · <b>Space</b> or <b>\\</b> = straight key (not while typing in a box).'}</p>`; };
    draw();
    const on = (k, d) => { if (k === 's' || (k === '-' && kmode() === 'G')) { d ? sink.down() : sink.up(); return; }
      if (k === '.') P.dit = d; else P.dah = d; if (d) P.lastPress = k; if (d) iamRun(P, sink); };
    host.addEventListener('pointerdown', e => { const b = e.target.closest('[data-k]'); if (!b) return; e.preventDefault(); b.classList.add('on'); b._k = b.dataset.k; on(b._k, true); try { b.setPointerCapture(e.pointerId); } catch (x) {} });
    const upf = e => { const b = e.target.closest && e.target.closest('[data-k]'); if (!b || !b.classList.contains('on')) return; b.classList.remove('on'); on(b._k || b.dataset.k, false); };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => host.addEventListener(n, upf));
    host.addEventListener('contextmenu', e => { if (e.target.closest('[data-k],[data-ko="mouse"]')) e.preventDefault(); });
    /* the mouse paddle: left / right button */
    const MB = {}; host.addEventListener('mousedown', e => { const z = e.target.closest('[data-ko="mouse"]'); if (!z) return; e.preventDefault(); const k = e.button === 2 ? '-' : e.button === 0 ? '.' : ''; if (!k) return; const kk = S.cw.swap ? (k === '.' ? '-' : '.') : k; MB[e.button] = kk; z.classList.add('on'); on(kk, true); });
    addEventListener('mouseup', e => { if (MB[e.button] == null) return; const kk = MB[e.button]; delete MB[e.button]; on(kk, false); const z = host.querySelector('[data-ko="mouse"]'); if (z && !Object.keys(MB).length) z.classList.remove('on'); });
    host.addEventListener('click', e => { const o = e.target.closest('[data-ko]'); if (!o) return; const k = o.dataset.ko;
      if (k === 'mode') { const L = Object.keys(KM); S.cw.iam = L[(L.indexOf(kmode()) + 1) % L.length]; save(); PADS.forEach(p => p.draw()); AP.toast('Paddles: ' + KM[S.cw.iam] + (S.cw.iam === 'G' ? ' (dit paddle = automatic dits, dah paddle = straight key)' : S.cw.iam === 'U' ? ' (both held = the last one pressed repeats)' : ''), 3500); }
      if (k === 'swap') { S.cw.swap = !S.cw.swap; save(); PADS.forEach(p => p.draw()); }
      if (k === 'wt') { const w = Math.round(((+S.cw.wt || 3) + 0.25) * 4) / 4; S.cw.wt = w > 4.5 ? 2.5 : w; save(); PADS.forEach(p => p.draw()); }
      if (k === 'wpm') { const L = [12, 15, 18, 20, 22, 25, 28, 30, 35]; const i = L.findIndex(x => x > (+S.cw.wpm || 20)); S.cw.wpm = i < 0 ? L[0] : L[i]; save(); PADS.forEach(p => p.draw()); }
      if (k === 'midi') midi(o); });
    const pad = { on, draw, P }; PADS.push(pad); return pad;
  }
  let MIDI = false;
  async function midi(btn) {
    if (!navigator.requestMIDIAccess) { AP.toast('USB / MIDI keys need the PC app (or Chrome / Edge).', 4000, 'bad'); return; }
    try { const acc = await navigator.requestMIDIAccess(); let n = 0;
      const hook = inp => { n++; inp.onmidimessage = ev => { const [st, note, vel] = ev.data, cmd = st >> 4; if ((cmd !== 8 && cmd !== 9) || MODE !== 'CW' || P.hidden) return; const d = cmd === 9 && vel > 0;
        const k = note % 12 === 0 ? 's' : note % 12 === 1 ? '.' : note % 12 === 2 ? '-' : ''; if (k) LOCALPAD.on(k === 's' ? 's' : (S.cw.swap ? (k === '.' ? '-' : '.') : k), d); }; };
      acc.inputs.forEach(hook); acc.onstatechange = e => { if (e.port.type === 'input' && e.port.state === 'connected') hook(e.port); };
      MIDI = n > 0; if (btn) btn.textContent = n ? '🎹 ' + n + ' USB KEY' + (n > 1 ? 'S' : '') + ' ✓' : '🎹 NO USB KEY FOUND'; AP.toast(n ? '🎹 USB key connected: C = straight key, C# = dit, D = dah (Vail-style adapters).' : 'No USB / MIDI key found: plug it in and tap again.', 4000, n ? 'log' : 'bad');
    } catch (e) { AP.toast('MIDI was blocked: ' + esc(e.message || e), 4000, 'bad'); }
  }
  const LOCALPAD = keyPad($('d5Key'));
  const kcode = e => (e.code === 'BracketLeft' || e.code === 'KeyZ' || e.code === 'ControlLeft') ? '.' : (e.code === 'BracketRight' || e.code === 'KeyX' || e.code === 'ControlRight') ? '-' : (e.code === 'Space' || e.code === 'Backslash') ? 's' : '';
  const swp = k => (S.cw.swap && k !== 's') ? (k === '.' ? '-' : '.') : k;
  addEventListener('keydown', e => { if (P.hidden || MODE !== 'CW' || document.body.dataset.screen !== 'digi' || e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || !$('sheet').hidden) return; const k = kcode(e); if (!k) return; e.preventDefault(); LOCALPAD.on(swp(k), true); });
  addEventListener('keyup', e => { if (MODE !== 'CW') return; const k = kcode(e); if (k) LOCALPAD.on(swp(k), false); });
  function macEdit() {
    const M = macros();
    AP.sheet(MODE + ' memory buttons', M.map((m, i) => `<div class="grid2"><label class="e">F${i + 1} NAME<input data-mn="${i}" value="${esc(m[0])}" maxlength="10"></label><label class="e">SENDS<input data-mt="${i}" value="${esc(m[1])}" autocapitalize="characters"></label></div>`).join('') + '<p class="hint">{MY} your call · {THEIR} their call · {REF} your park · {ST} your state · {GRID} your grid.</p><div class="row"><button type="button" class="b" id="d5MRe">↺ BACK TO THE USUAL</button></div>',
      () => { const n = M.map((m, i) => [String((document.querySelector(`[data-mn="${i}"]`) || {}).value || m[0]).trim().toUpperCase() || m[0], String((document.querySelector(`[data-mt="${i}"]`) || {}).value || m[1]).trim().toUpperCase() || m[1]]); if (!S.mac.__reset) S.mac[MODE] = n; delete S.mac.__reset; save(); macDraw(); });
    $('d5MRe').onclick = () => { delete S.mac[MODE]; S.mac.__reset = 1; AP.shut(); };
  }
  addEventListener('keydown', e => { if (P.hidden || !/^(CW|RTTY|PSK31|HELL)$/.test(MODE) || !/^F[1-6]$/.test(e.key)) return; e.preventDefault(); const m = macros()[+e.key.slice(1) - 1]; if (m) sendText(m[1]); });
  $('d5Tx').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = $('d5Tx').value; $('d5Tx').value = ''; sendText(v); } });
  $('d5SendT').onclick = () => { const v = $('d5Tx').value; $('d5Tx').value = ''; sendText(v); };
  $('d5Stop').onclick = () => stopTx();
  function chk() { const w = whyNot(); $('d5Why').textContent = TXB ? '📡 Sending…' : w; ['d5SendT', 'd5TxGo'].forEach(id => { const b = $(id); if (b) b.disabled = !!w || TXB; }); $('d5Stop').disabled = !TXB; }
  AP.on('key', chk); AP.on('me', () => { chk(); if (MODE === 'WSPR') wMsg(); macDraw(); }); AP.on('run', () => chk());

  /* ================= log ================= */
  $('d5Log').onclick = () => {
    const call = $('d5Call').value.trim().toUpperCase(); if (!call) { AP.toast('Type or tap their call first.', 3000, 'bad'); return; }
    const k = dialK() + (MODE === 'SSTV' || MODE === 'CW' ? 0 : audioHz() / 1000);
    const r = KPCLog.add({ call, khz: Math.round(k * 10) / 10, mode: MODE === 'HELL' ? 'HELL' : MODE, rs: $('d5Rs').value || (MODE === 'SSTV' ? '595' : '599'), rr: $('d5Rr').value || (MODE === 'SSTV' ? '595' : '599'), refs: $('d5Ref').value.trim() ? KPCLog.refList($('d5Ref').value) : [] });
    if (r && r.ok) { AP.toast(`✅ ${esc(call)} logged · ${band()} ${MODE} · ${r.n}`, 3000, 'log'); $('d5Call').value = ''; $('d5Ref').value = ''; } else AP.toast('Not logged: ' + esc((r && r.msg) || ''), 4000, 'bad');
  };

  /* ================= sound in ================= */
  let qT = 0;
  function rx(c) {
    const blk = c.pcm; if (!blk || !blk.length) return;
    for (let i = 0; i < blk.length; i++) { ring[rn] = blk[i]; rn = (rn + 1) % N; if (++hopN >= HOP) { hopN = 0; wfSize(); const v = spectrum(); wfRow(v); if (MODE === 'PSK31') { pskGate(); brFind(); } if (MODE === 'CW') { cwGate(); cwAfc(); } } }
    if (TXB && MODE !== 'CW') return;
    if (MODE === 'CW') for (let i = 0; i < blk.length; i++) cwFeed(blk[i]);
    else if (MODE === 'RTTY') { for (let i = 0; i < blk.length; i++) rtty.feed(blk[i]); rttyAfc(); }
    else if (MODE === 'PSK31') for (let i = 0; i < blk.length; i++) { const x = blk[i]; psk.feed(x); for (const ch of BR) ch.rx.feed(x); }
    else if (MODE === 'HELL') for (let i = 0; i < blk.length; i++) hell.feed(blk[i]);
    else if (MODE === 'SSTV') { sstvClip = c.peak >= 0.98 ? sstvClip + 1 : Math.max(0, sstvClip - 1); for (let i = 0; i < blk.length; i++) sstv.feed(blk[i]); }
    else if (MODE === 'WSPR') wFeed(blk, (c.t + (AP.now() - Date.now())) / 1000);
    const now = performance.now(); if (now - qT > 200) { qT = now; const q = MODE === 'CW' ? Math.min(1, Math.max(0, (C.snr - 1.5) / 6)) : MODE === 'RTTY' ? rtty.q : MODE === 'PSK31' ? Math.max(0, psk.q) : MODE === 'HELL' ? Math.min(1, hell.sig * 3) : 0; $('d5Q').style.width = Math.round(q * 100) + '%'; if (MODE === 'CW') { $('d5Wpm').textContent = C.snr > 2.2 ? Math.round(1200 / C.dit) : '—'; if (C.cur) drawRx(); } if (MODE === 'PSK31' && S.psk.afc) $('d5Hz').textContent = Math.round(psk.fc); }
  }

  /* ================= band / radio ================= */
  function bandSel() { const L = Object.keys(DIAL[MODE] || {}); $('d5Band').innerHTML = L.map(b => `<option value="${esc(b)}"${b === band() ? ' selected' : ''}>${esc(b)}</option>`).join(''); $('d5Dial').textContent = (dialK() / 1000).toFixed(4).replace(/0$/, ''); }
  async function setBand(b) {
    if (!(DIAL[MODE] || {})[b]) return false; S.band[MODE] = b; save(); bandSel(); if (SP5) SP5.update();
    if (TXB) stopTx();
    if (AP.catConnected()) { const ok = await KPCCat.tune(dialOut(), radioMode(MODE)); if (!ok) AP.toast('The radio did not take ' + (dialOut() / 1000).toFixed(4) + ' MHz. Set it by hand.', 5000, 'bad'); return ok; }
    AP.toast('📻 Set the radio to ' + (dialK() / 1000).toFixed(4) + ' MHz ' + (MODE === 'CW' ? 'CW' : MODE === 'SSTV' && dialK() < 10000 ? 'LSB' : 'USB / DATA') + '.', 4000);
    return true;
  }
  $('d5Band').onchange = () => setBand($('d5Band').value);
  $('d5Start').onclick = () => AP.start();
  AP.on('run', on => { $('d5Off').hidden = !!on; });
  $('d5Off').hidden = AP.running();

  /* ================= settings sheets ================= */
  function settings() {
    const ck = (id, on, lab) => `<label class="ck" style="display:flex;margin:9px 0"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> <span>${lab}</span></label>`;
    const sel = (id, v, opts) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}"${String(k) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    let body = '<h3 class="sh">Sound levels</h3>' + AP.lvHtml('tx') + AP.lvHtml('rx');
    if (MODE === 'CW') body += `<h3 class="sh">CW</h3><div class="grid2"><label class="e">SPEED (WPM)<input id="s5Wpm" inputmode="numeric" value="${S.cw.wpm}"></label>
      <label class="e">SEND WITH${sel('s5Via', S.cw.via, [['dtr', 'DTR key line (Yaesu 2nd USB port, Digirig…)'], ['rts', 'RTS key line'], ['cat', 'The radio\'s own keyer over CAT (Icom, Kenwood, Elecraft, QRP Labs, FT-710 / 991A / FTDX10)'], ['audio', 'Sound: a tone through the USB sound card (the app puts the radio in DATA while it sends)']])}</label>
      <label class="e">FILTER${sel('s5Bw', S.cw.bw, [['auto', 'Follows their speed'], ['50', '50 Hz'], ['100', '100 Hz'], ['200', '200 Hz'], ['500', '500 Hz']])}</label>
      <label class="e">TONE I SEND (Hz, blank = the pitch I listen on)<input id="s5Tone" inputmode="numeric" value="${S.cw.tone || ''}"></label></div>
      ${ck('s5Afc', S.cw.afc, 'Follow the strongest signal (AFC)')}${ck('s5Abbr', S.cw.abbr, 'Shorten what I type to CW short-hand (THANK YOU → TU, AND → ES…)')}
      <label class="e wide">THE RADIO WHILE SENDING BY SOUND${sel('s5Park', S.cw.park || 'cw', [['cw', 'Listen in CW (the radio\'s CW filter); flip to DATA only while sending'], ['data', 'Stay in DATA one tone below the whole time (fastest first dit)']])}</label>
      <div class="grid2"><label class="e">PADDLES${sel('s5Iam', S.cw.iam || 'B', [['B', 'Iambic B (most keyers)'], ['A', 'Iambic A'], ['U', 'Ultimatic'], ['G', 'Bug (dit paddle automatic, dah = straight key)']])}</label><label class="e">AUTO CQ GAP (s)<input id="s5Gap" inputmode="numeric" value="${S.gap5 || 6}"></label></div>
      <label class="e catx">KEY LINE PORT${sel('s5Kp', (G.KPCCat && KPCCat.get().keyPort) || '', [['', 'The radio\'s 2nd USB port, found by itself (FT-710, FT-991A, FTDX10…)'], ['cat', 'The CAT port itself (a one-port cable: Digirig, SignaLink-type)']].concat((G.KPCCat && KPCCat.get().keyPort && !/^cat$/.test(KPCCat.get().keyPort)) ? [[KPCCat.get().keyPort, 'The port picked by hand']] : []))}</label>
      <p class="hint" ${AP.catConnected() ? 'hidden' : ''}>The DTR / RTS key line and the radio's own keyer need the radio connected (STATION → Radio control); until then CW goes out as a tone through the sound card.</p>
      <div class="row catx"><button type="button" class="b" id="s5KpPick">PICK THE KEY PORT BY HAND</button><span class="hint" id="s5KpSt">${esc(G.KPCCat && KPCCat.keyPortInfo ? 'Key port now: ' + KPCCat.keyPortInfo().which : '')}</span></div>
      <p class="hint">Yaesu FT-710 / FTDX10 / 991A: radio menu USB KEYING (CW) = DTR and CW BK-IN = ON; the key line is on the radio's SECOND USB port (Windows calls it 'Standard COM Port'). Yaesu radios cannot take typed CW over CAT. Tap the waterfall on a signal to listen there.</p>`;
    if (MODE === 'RTTY') body += `<h3 class="sh">RTTY</h3><div class="grid2"><label class="e">SHIFT${sel('s5Sh', S.rtty.shift, [[170, '170 Hz (ham)'], [200, '200 Hz'], [425, '425 Hz'], [850, '850 Hz']])}</label><label class="e">SPEED${sel('s5Bd', S.rtty.baud, [[45.45, '45.45 baud (ham)'], [50, '50 baud'], [75, '75 baud']])}</label></div>${ck('s5Rev', S.rtty.rev, 'Reverse (mark and space swapped)')}${ck('s5Afc', S.rtty.afc, 'Keep the pair centred (AFC)')}`;
    if (MODE === 'PSK31') body += `<h3 class="sh">PSK31</h3>${ck('s5Afc', S.psk.afc, 'Follow the signal (AFC)')}<label class="e slide">SQUELCH <b>${S.psk.sq}</b><input type="range" id="s5Sq" min="0" max="90" step="5" value="${S.psk.sq}"></label>`;
    if (MODE === 'HELL') body += `<h3 class="sh">Feld Hell</h3><label class="e slide">DARKER <b>${S.hell.gain}</b><input type="range" id="s5Hg" min="0.5" max="3" step="0.1" value="${S.hell.gain}"></label><label class="e">WRITING SIZE${sel('s5Hw', S.hell.wide, [[1, 'Narrow'], [2, 'Normal'], [3, 'Wide']])}</label>`;
    if (MODE === 'SSTV') body += `<h3 class="sh">SSTV</h3>${ck('s5Auto', S.sstv.auto, 'Start a picture by itself (the VIS code at the start)')}<label class="e">MODE FOR START NOW${sel('s5Man', S.sstv.man, Object.keys(D.SSTV).map(k => [k, k]))}</label>`;
    if (MODE === 'WSPR') body += `<h3 class="sh">WSPR</h3><label class="e">MY TX AUDIO (Hz, 1410–1590)<input id="s5WHz" inputmode="numeric" value="${S.wspr.hz}"></label>`;
    if (/^(CW|RTTY|PSK31|HELL)$/.test(MODE)) body += '<div class="row"><button type="button" class="b" id="s5Mac">✏️ EDIT THE MEMORY BUTTONS</button></div>';
    setTimeout(() => { const b = $('s5KpPick'); if (b) b.onclick = () => { if (!G.KPCCat || !KPCCat.pickKeyPort) return; KPCCat.pickKeyPort().then(ok => { const st = $('s5KpSt'); if (st) st.textContent = ok ? 'Key port now: ' + KPCCat.keyPortInfo().which : 'No port picked.'; }); }; }, 0);
    AP.sheet(MODE + ' settings', body, () => {
      const v = id => $(id) ? $(id).value : null, c = id => $(id) ? $(id).checked : null;
      if (MODE === 'CW') { S.cw.wpm = Math.max(8, Math.min(45, +v('s5Wpm') || 20)); S.cw.via = v('s5Via'); S.cw.bw = v('s5Bw'); const t = +v('s5Tone'); S.cw.tone = t ? Math.max(300, Math.min(1200, t)) : 0; S.cw.afc = c('s5Afc'); S.cw.abbr = c('s5Abbr'); S.cw.iam = v('s5Iam') || 'B'; S.cw.park = v('s5Park') === 'data' ? 'data' : 'cw'; PADS.forEach(p => p.draw()); S.gap5 = Math.max(2, Math.min(30, +v('s5Gap') || 6));
        if (G.KPCCat && v('s5Kp') != null && v('s5Kp') !== (KPCCat.get().keyPort || '')) { KPCCat.set({ keyPort: v('s5Kp') }); KPCCat.keyPortClose && KPCCat.keyPortClose(); }
        if (AP.catConnected() && G.KPCCat) KPCCat.tune(dialOut('CW'), radioMode('CW')).catch(() => {});
        if ((S.cw.via === 'dtr' || S.cw.via === 'rts') && G.KPCCat && AP.catConnected() && KPCCat.keyPortOpen) KPCCat.keyPortOpen().then(() => { const i = KPCCat.keyPortInfo(); AP.toast('CW key line: ' + i.which + '.', 3500); }); }
      if (MODE === 'RTTY') { S.rtty.shift = +v('s5Sh'); S.rtty.baud = +v('s5Bd'); S.rtty.rev = c('s5Rev'); S.rtty.afc = c('s5Afc'); rtty.set({ shift: S.rtty.shift, baud: S.rtty.baud, rev: S.rtty.rev }); }
      if (MODE === 'PSK31') { S.psk.afc = c('s5Afc'); S.psk.sq = +v('s5Sq'); psk.afc = S.psk.afc; psk.sq = S.psk.sq / 100; }
      if (MODE === 'HELL') { S.hell.gain = +v('s5Hg'); S.hell.wide = +v('s5Hw'); }
      if (MODE === 'SSTV') { S.sstv.auto = c('s5Auto'); S.sstv.man = v('s5Man'); sstv.auto = S.sstv.auto; }
      if (MODE === 'WSPR') S.wspr.hz = Math.max(1410, Math.min(1590, +v('s5WHz') || 1500));
      save(); drawScale(); chk();
    });
    if ($('s5Mac')) $('s5Mac').onclick = () => { AP.shut(); setTimeout(macEdit, 50); };
  }

  /* ================= register the six modes ================= */
  const INFO = {
    CW: ['CW', 'CW: decode on the waterfall, memory keys, send by sound, the radio\'s keyer or a key line', 'CW: tap a signal on the waterfall to copy it; F1–F6 send the memories.'],
    RTTY: ['RTTY', 'RTTY 45 baud, 170 Hz shift', 'RTTY: tap between the two lines of a signal to tune it.'],
    PSK31: ['PSK31', 'PSK31: every signal on the waterfall gets its own line', 'PSK31: tap a signal or a line in the list to read it.'],
    HELL: ['HELL', 'Feld Hellschreiber: the writing is printed, you read it', 'Feld Hell: tap the signal to tune it; read the writing.'],
    SSTV: ['SSTV', 'Slow-scan TV: receive pictures, send a photo or your card', 'SSTV: pictures start by themselves; 📤 SEND A PICTURE to send one.'],
    WSPR: ['WSPR', 'WSPR beacon: decode every 2 minutes, send your own beacon', 'WSPR: decodes every even UTC minute; tick Transmit to beacon.']
  };
  /* spots of this mode on this band under the dial (Oct 27): tap = the radio goes to the spot (dial = the spot for a voice/DATA mode; CW/RTTY/PSK = the
     spot is the signal, the dial sits one pitch below) and the log line fills in */
  const MODERX = { CW: /^CW/, RTTY: /RTTY/, PSK31: /PSK/, HELL: /HELL/, SSTV: /SSTV/, WSPR: /WSPR/ };
  let SP5 = null;
  /* Nov 1 (Brandon: 'cw decoder broken … loud and not decoding'; 'clicking on the spot list … it took me to ft8'): ONE way to go
     to a CW / RTTY / PSK31 / HELL spot (this screen's strip AND the SPOTS list). The dial sits one pitch below the station ONLY
     when the radio is in DATA (sound modes); a radio IN CW MODE puts a station on its dial at its own CW pitch, so the dial =
     the spot (before: always 600 Hz low = outside the radio's CW filter = silence). */
  function tuneSpot(s) {
    if (!s) return;
    const b = Object.keys(DIAL[MODE] || {}).find(x => bandOfK(x) === bandOfK(s.khz));
    if (b && b !== band()) { S.band[MODE] = b; save(); bandSel(); drawScale(); }
    if (!AP.catConnected()) AP.toast('Connect the radio to go to a spot (STATION → Radio control).', 3000);
    else {
      const rm = radioMode(MODE), dataSide = /DATA|PSK|RTTY|SSTV/.test(rm) && rm !== 'RTTY';
      const off = MODE === 'CW' ? (parkData() ? (S.cw.tone || S.cw.hz || 600) / 1000 : 0) : !dataSide ? 0 : MODE === 'RTTY' ? (S.rtty.center || 1500) / 1000 : MODE === 'PSK31' ? (S.psk.hz || 1000) / 1000 : MODE === 'HELL' ? (S.hell.hz || 1000) / 1000 : 0;
      const k = Math.round((s.khz - off) * 1000) / 1000; SPOTK = s.khz;
      KPCCat.tuneFast ? KPCCat.tuneFast(k, rm) : KPCCat.tune(k, rm); $('d5Dial').textContent = (k / 1000).toFixed(4).replace(/0$/, '');
      if (MODE === 'CW' && !parkData()) setTimeout(pitchFromRadio, 600);
    }
    if ($('d5Call')) $('d5Call').value = s.call; if ($('d5Ref') && (s.refs || []).length) $('d5Ref').value = s.refs.join(' ');
    AP.toast('📻 ' + esc(s.call) + ' ' + (s.khz / 1000).toFixed(4).replace(/0$/, '') + ' — their call is in the log row.', 3000);
  }
  let SPOTK = 0;
  const BANDS_K = { '160m': [1800, 2000], '80m': [3500, 4000], '60m': [5300, 5410], '40m': [7000, 7300], '30m': [10100, 10150], '20m': [14000, 14350], '17m': [18068, 18168], '15m': [21000, 21450], '12m': [24890, 24990], '10m': [28000, 29700], '6m': [50000, 54000], '2m': [144000, 148000] };
  const bandOfK = x => { if (typeof x === 'string') return x.replace(/\s.*$/, ''); for (const k in BANDS_K) if (x >= BANDS_K[k][0] && x <= BANDS_K[k][1]) return k; return ''; };
  /* the radio's own CW pitch → the decoder's pitch (radio in CW mode only) */
  let pitchAsked = 0;
  async function pitchFromRadio(force) {
    if (MODE !== 'CW' || parkData() || !AP.catConnected() || !G.KPCCat || !KPCCat.cwPitch || (!force && Date.now() - pitchAsked < 4000)) return;
    pitchAsked = Date.now();
    const hz = await KPCCat.cwPitch().catch(() => null);
    if (hz && Math.abs(hz - S.cw.hz) > 15) { cwPitch(hz); AP.toast('🎵 CW pitch set to the radio\'s ' + hz + ' Hz, so the decoder listens where the radio puts the signal.', 4000); }
  }
  /* the CW / RTTY / PSK31 / HELL screen FOLLOWS the radio to another band (Brandon Nov 1: 'the radio is on 7.0590 CW, not CW's 14.0600') */
  AP.on('dial', r => {
    if (!r || !r.khz || !MODE || P.hidden || !/^(CW|RTTY|PSK31|HELL)$/.test(MODE) || TXB) return;
    const b = Object.keys(DIAL[MODE] || {}).find(x => bandOfK(x) === bandOfK(r.khz));
    if (b && b !== band()) { S.band[MODE] = b; save(); bandSel(); drawScale(); spots5(); AP.toast('📻 ' + MODE + ' follows the radio: ' + b + '.', 2500); }
    if (MODE === 'CW' && /^CW/.test(String(r.mode || ''))) pitchFromRadio();
  });
  function spots5() { if (!G.KPCSpots || !KPCSpots.strip) return; if (!SP5) SP5 = KPCSpots.strip($('d5Spots'), { band: () => band(), modes: MODERX[MODE] || /./, max: 12, tap: s => tuneSpot(s) }); else SP5.update({ modes: MODERX[MODE] || /./ }); }
  function activate(id) {
    if (MODE && MODE !== id) { TXTS[MODE] = TXT; CALLSS[MODE] = CALLS; }
    TXT = TXTS[id] || ''; CALLS = CALLSS[id] || []; C.cur = '';
    MODE = id; P.dataset.m = id.toLowerCase().replace('31', ''); $('d5HzL').textContent = id === 'CW' ? 'PITCH' : id === 'RTTY' ? 'CENTER' : id === 'PSK31' ? 'CARRIER' : id === 'WSPR' ? 'MY TX' : 'TONE';
    $('d5Rs').value = id === 'SSTV' ? '595' : '599'; $('d5Rr').value = id === 'SSTV' ? '595' : '599';
    if (id !== 'SSTV' && sstv.img) sstv.stop(); bandSel(); macDraw(); drawScale(); drawRx(); callScan(); chk(); if (id === 'WSPR') wMsg(); spots5();
    if (AP.catConnected()) KPCCat.tune(dialOut(id), radioMode(id)).then(() => { if (id === 'CW') setTimeout(pitchFromRadio, 500); }).catch(() => {});
  }
  const lines = () => TXT.split('\n').filter(Boolean).slice(-30).map((t, i) => ({ id: i, t: Date.now(), text: t, cls: /^\[TX\]/.test(t) ? 'mine' : '' }));
  for (const id of Object.keys(INFO)) {
    G.KPCModes.add({
      id, label: INFO[id][0], panel: P, title: INFO[id][1], hello: INFO[id][2],
      bands: Object.keys(DIAL[id]), band: () => band(id), setBand: b => { if (MODE !== id) S.band[id] = b; else setBand(b); save(); return true; }, khz: () => dialK(id),
      rx, run: () => {}, activate: () => activate(id), deactivate: () => { if (TXB) stopTx(); if (id === 'CW' && ARM.on) cwDisarm(0); if (MODE === id) { TXTS[id] = TXT; CALLSS[id] = CALLS; MODE = ''; } },
      settings, lines: () => (MODE === id ? lines() : []),
      ops: { send: a => sendText(String(a.text || '')), mac: a => { const m = macros()[+a.i || 0]; if (m) sendText(m[1]); }, halt: () => stopTx() },
      buttons: /^(CW|RTTY|PSK31|HELL)$/.test(id) ? [{ op: 'mac', i: 0, label: 'F1 ' + (id === 'CW' ? 'CQ' : 'CQ POTA'), cls: 'gold' }, { op: 'halt', label: 'STOP', cls: 'halt' }] : [{ op: 'halt', label: 'STOP', cls: 'halt' }],
      enabled: () => MODE === id && (id === 'WSPR' ? S.wspr.tx : false), txing: () => MODE === id && TXB, halt: () => stopTx(),
      state: () => ({ hz: Math.round(audioHz()), wpm: id === 'CW' ? Math.round(1200 / C.dit) : 0 })
    });
  }
  mkRtty(); mkPsk();
  G.KPCModes5 = { S, save, sendText, send, stopTx, elems, cwTone, dialK, dialOut, cwOff, band, tuneSpot, pitchFromRadio, txing: () => TXB, text: () => TXT, _feed: rx, _cw: () => C, _cwReset: () => { C.sig = 1e-6; C.flo = 1e-6; C.warm = 0; C.cur = ''; C.gate = 0; C.on = false; C.mk = 0; C.sp = 0; GAPS.length = 0; MARKS.length = 0; C.chTh = C.wdTh = C.mTh = 0; }, _sstv: sstv, why: whyNot, cwOut, keyDown, keyUp, keyPad, keyWhy, autoOn5, autoOff5, auto: () => !!AUTO5 };
})(window);
