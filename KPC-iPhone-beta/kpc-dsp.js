/* KPC digital modes engine: RTTY, PSK31, SSTV, WSPR and Feld Hellschreiber (Oct 17) (Brandon Oct 17 2026: 'go ahead with RTTY, PSK31, SSTV, WSPR').
   Pure sound math at 12 000 samples a second, shared by the KPC Logger and both Hunters Lounges (kpc-logger-ft8.js draws the screens).
   - RTTY: 45.45 / 50 / 75 baud, any shift; two matched filters + W7AY-style automatic threshold; Baudot (US figures, unshift on space).
   - PSK31: BPSK at 31.25 baud, Varicode (table from fldigi, GPL), AFC, squelch; many channels at once for the signal browser.
   - SSTV: receive Martin 1/2, Scottie 1/2/DX, Robot 36/72, PD 50/90/120/160/180/240/290 (VIS code picks the mode, line sync fixes slant);
     send Martin 1, Scottie 1, Robot 36, PD 120.
   - WSPR: encoder (checked against WSJT-X's wsprsim) and a decoder ported from WSJT-X wsprd (Joe Taylor K1JT, Steve Franke K9AN, GPL v3):
     spectrum candidates, sync search, noncoherent symbol detection, Fano decoder (Phil Karn KA9Q), type 1 and 2 messages.
   The WSPR decode runs in a Web Worker: new Worker('kpc-dsp.js') (APP COPY of kpc-links/kpc-digi.js, Oct 24) and post {cmd:'wspr', id, audio (Float32Array, 114 s at 12 kHz)}. */
(function (G) {
  'use strict';
  const R = 12000, TAU = Math.PI * 2;
  const D = {};

  /* ---------- helpers ---------- */
  function lp(fc, fs) { const w = TAU * fc / fs, c = Math.cos(w), s = Math.sin(w), a = s / Math.SQRT2, a0 = 1 + a;
    return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - a) / a0 }; }
  function BQ(c) { this.c = c; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  BQ.prototype.run = function (x) { const c = this.c, y = c.b0 * x + c.b1 * this.x1 + c.b2 * this.x2 - c.a1 * this.y1 - c.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; };
  function fft(re, im, inv) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) { const a = (inv ? 1 : -1) * TAU / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = u + len / 2, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
  D.fft = fft;
  /* a tone of changing frequency, phase kept smooth: segs = [[Hz, seconds], …] (amplitude 0 = silence) */
  function tones(segs, rate, amp) { let tot = 0; for (const s of segs) tot += s[1]; const out = new Float32Array(Math.ceil(tot * rate) + 8); let n = 0, ph = 0, acc = 0;
    for (const [f, d, a] of segs) { acc += d * rate; const end = Math.floor(acc), w = TAU * f / rate, A = a == null ? (amp || 1) : a; for (; n < end; n++) { out[n] = A * Math.sin(ph); ph += w; if (ph > TAU) ph -= TAU; } }
    return out.subarray(0, n); }
  D.tones = tones;

  /* ======================= RTTY ======================= */
  const LTR = ['', 'E', '\n', 'A', ' ', 'S', 'I', 'U', '\r', 'D', 'R', 'J', 'N', 'F', 'C', 'K', 'T', 'Z', 'L', 'W', 'H', 'Y', 'P', 'Q', 'O', 'B', 'G', '', 'M', 'X', 'V', ''];
  const FIG = ['', '3', '\n', '-', ' ', '\x07', '8', '7', '\r', '$', '4', "'", ',', '!', ':', '(', '5', '"', ')', '2', '#', '6', '0', '1', '9', '?', '&', '', '.', '/', ';', ''];
  const FIGS = 27, LTRS = 31;
  function RttyRx(o) { this.set(o || {}); this.onChar = null; }
  RttyRx.prototype.set = function (o) {
    this.center = o.center || this.center || 1500; this.shift = o.shift || this.shift || 170; this.baud = o.baud || this.baud || 45.45; this.rev = o.rev != null ? !!o.rev : !!this.rev;
    const fm = this.center + (this.rev ? -1 : 1) * this.shift / 2, fs = this.center - (this.rev ? -1 : 1) * this.shift / 2;
    this.wm = TAU * fm / R; this.ws = TAU * fs / R; this.pm = this.ps = 0; this.N = Math.round(R / this.baud);
    this.buf = new Float32Array(this.N * 4); this.bp = 0; this.sum = [0, 0, 0, 0];
    this.mE = this.sE = 1e-3; this.mN = this.sN = 0; this.prev = 1; this.st = 0; this.cnt = 0; this.bits = 0; this.figs = false; this.q = 0; this.lvm = 0; this.lvs = 0;
  };
  RttyRx.prototype.tune = function (center) { /* move without losing the character in progress (AFC, taps) */
    this.center = center; const fm = center + (this.rev ? -1 : 1) * this.shift / 2, fs = center - (this.rev ? -1 : 1) * this.shift / 2; this.wm = TAU * fm / R; this.ws = TAU * fs / R; };
  RttyRx.prototype.feed = function (x) {
    const N = this.N, b = this.buf, p = this.bp * 4, s = this.sum;
    this.pm += this.wm; if (this.pm > TAU) this.pm -= TAU; this.ps += this.ws; if (this.ps > TAU) this.ps -= TAU;
    const v0 = x * Math.cos(this.pm), v1 = x * Math.sin(this.pm), v2 = x * Math.cos(this.ps), v3 = x * Math.sin(this.ps);
    s[0] += v0 - b[p]; s[1] += v1 - b[p + 1]; s[2] += v2 - b[p + 2]; s[3] += v3 - b[p + 3]; b[p] = v0; b[p + 1] = v1; b[p + 2] = v2; b[p + 3] = v3; this.bp = (this.bp + 1) % N;
    const M = Math.hypot(s[0], s[1]) / N, Sp = Math.hypot(s[2], s[3]) / N;
    const fa = 4 / N, sl = 1 / (N * 24);
    this.mE += (M - this.mE) * (M > this.mE ? fa : sl); this.sE += (Sp - this.sE) * (Sp > this.sE ? fa : sl);
    this.mN += (M - this.mN) * (M < this.mN ? fa : sl); this.sN += (Sp - this.sN) * (Sp < this.sN ? fa : sl);
    const mc = Math.min(M, this.mE), sc = Math.min(Sp, this.sE);
    const v = (mc - this.mN) * (this.mE - this.mN) - (sc - this.sN) * (this.sE - this.sN) - 0.5 * ((this.mE - this.mN) ** 2 - (this.sE - this.sN) ** 2);
    const bit = v > 0 ? 1 : 0; this.lvm = M; this.lvs = Sp;
    if (this.st === 0) { if (this.prev === 1 && bit === 0) { this.st = 1; this.cnt = 0; } }
    else { this.cnt++; const half = N >> 1;
      if (this.cnt === half) { if (bit !== 0) this.st = 0; else this.bits = 0; }
      else if (this.cnt > half && (this.cnt - half) % N === 0) { const k = (this.cnt - half) / N;
        if (k <= 5) this.bits |= bit << (k - 1);
        else { this.st = 0; const ok = bit === 1; this.q += ((ok ? 1 : 0) - this.q) * 0.18; if (ok) this.code(this.bits); } } }
    this.prev = bit;
  };
  RttyRx.prototype.code = function (c) {
    if (c === LTRS) { this.figs = false; return; } if (c === FIGS) { this.figs = true; return; }
    const ch = (this.figs ? FIG : LTR)[c]; if (c === 4) this.figs = false; /* unshift on space */
    if (ch && this.onChar) this.onChar(ch === '\r' ? '' : ch === '\x07' ? '' : ch);
  };
  RttyRx.prototype.level = function () { return { m: this.lvm, s: this.lvs, q: this.q, sig: Math.max(this.mE, this.sE) / Math.max(1e-9, Math.max(this.mN, this.sN) + 1e-6) }; };
  D.RttyRx = RttyRx;
  const R_L = {}, R_F = {}; LTR.forEach((c, i) => { if (c && c !== ' ') R_L[c] = i; }); FIG.forEach((c, i) => { if (c && c !== ' ') R_F[c] = i; });
  /* text → audio (AFSK). Starts with a short mark tone and LTRS so receivers lock on. */
  D.rttyTx = function (text, o, rate) {
    o = o || {}; const center = o.center || 1500, shift = o.shift || 170, baud = o.baud || 45.45, rev = !!o.rev, fm = center + (rev ? -1 : 1) * shift / 2, fs = center - (rev ? -1 : 1) * shift / 2, T = 1 / baud;
    const segs = [[fm, 0.3]]; const send = c => { segs.push([fs, T]); for (let i = 0; i < 5; i++) segs.push([(c >> i) & 1 ? fm : fs, T]); segs.push([fm, 1.5 * T]); };
    send(LTRS); send(LTRS); let figs = false;
    for (let ch of String(text).toUpperCase().replace(/\r/g, '')) {
      if (ch === '\n') { send(8); send(2); continue; }
      if (ch === ' ') { send(4); figs = false; continue; }
      if (R_L[ch] != null) { if (figs) { send(LTRS); figs = false; } send(R_L[ch]); }
      else if (R_F[ch] != null) { if (!figs) { send(FIGS); figs = true; } send(R_F[ch]); }
    }
    send(LTRS); segs.push([fm, 0.15]);
    return tones(segs, rate || R, 1);
  };

  /* ======================= PSK31 ======================= */
  const VARI = '1010101011 1011011011 1011101101 1101110111 1011101011 1101011111 1011101111 1011111101 1011111111 11101111 11101 1101101111 1011011101 11111 1101110101 1110101011 1011110111 1011110101 1110101101 1110101111 1101011011 1101101011 1101101101 1101010111 1101111011 1101111101 1110110111 1101010101 1101011101 1110111011 1011111011 1101111111 1 111111111 101011111 111110101 111011011 1011010101 1010111011 101111111 11111011 11110111 101101111 111011111 1110101 110101 1010111 110101111 10110111 10111101 11101101 11111111 101110111 101011011 101101011 110101101 110101011 110110111 11110101 110111101 111101101 1010101 111010111 1010101111 1010111101 1111101 11101011 10101101 10110101 1110111 11011011 11111101 101010101 1111111 111111101 101111101 11010111 10111011 11011101 10101011 11010101 111011101 10101111 1101111 1101101 101010111 110110101 101011101 101110101 101111011 1010101101 111110111 111101111 111111011 1010111111 101101101 1011011111 1011 1011111 101111 101101 11 111101 1011011 101011 1101 111101011 10111111 11011 111011 1111 111 111111 110111111 10101 10111 101 110111 1111011 1101011 11011111 1011101 111010101 1010110111 110111011 1010110101 1011010111 1110110101'.split(' ');
  const VDEC = {}; VARI.forEach((c, i) => { VDEC[parseInt(c, 2)] = i; });
  const PSK_SPS = R / 31.25; /* 384 samples a symbol */
  function PskRx(fc) { this.fc = fc || 1000; this.fc0 = this.fc; this.ph = 0; const c = lp(28, R); this.f = [new BQ(c), new BQ(c), new BQ(c), new BQ(c)]; this.n = 0; this.bk = new Float64Array(16); this.zr = new Float64Array(16); this.zi = new Float64Array(16);
    this.best = 0; this.acc = 0; this.last = 1; this.q = 0; this.amp = 0; this.noise = 1e-9; this.afc = true; this.onChar = null; this.sq = 0.35; this.sym = 0; this.edge = 0; }
  PskRx.prototype.feed = function (x) {
    this.ph += TAU * this.fc / R; if (this.ph > TAU) this.ph -= TAU;
    const i = this.f[1].run(this.f[0].run(x * Math.cos(this.ph))), q = this.f[3].run(this.f[2].run(-x * Math.sin(this.ph)));
    if (++this.n < 24) return; this.n = 0; /* 16 looks per symbol */
    const k = this.sym & 15; this.sym++; const m = i * i + q * q; this.bk[k] = this.bk[k] * 0.96 + m * 0.04;
    if (k === this.best) {
      const pr = this.zr[k], pi = this.zi[k], dr = i * pr + q * pi, di = q * pr - i * pi, dm = Math.hypot(dr, di) || 1e-12;
      const bit = dr > 0 ? 1 : 0; const c2 = (dr * dr - di * di) / (dm * dm); this.q += (c2 - this.q) * 0.06;
      this.amp += (Math.sqrt(m) - this.amp) * 0.05;
      if (this.afc) { const e = Math.atan2(2 * dr * di, dr * dr - di * di) / 2; this.fc += e * 31.25 / TAU * (this.q > 0.5 ? 0.05 : 0.12); if (Math.abs(this.fc - this.fc0) >= 7.5) { this.fc = this.fc0 + Math.sign(this.fc - this.fc0) * 7.5; if (++this.edge > 40) { this.fc = this.fc0; this.edge = 0; } } else this.edge = 0; }
      this.bitIn(bit);
      let bb = 0, bv = -1; for (let j = 0; j < 16; j++) if (this.bk[j] > bv) { bv = this.bk[j]; bb = j; }
      if (bb !== this.best && this.bk[bb] > this.bk[this.best] * 1.1) this.best = bb;
      let lo = Infinity; for (let j = 0; j < 16; j++) lo = Math.min(lo, this.bk[j]); this.noise += (lo - this.noise) * 0.02;
    }
    this.zr[k] = i; this.zi[k] = q;
  };
  PskRx.prototype.bitIn = function (b) {
    if (b === 0 && this.last === 0) { const code = this.acc >> 1; this.acc = 0; this.last = 1; /* swallow, next char starts fresh */
      if (code > 0 && this.q >= this.sq) { const c = VDEC[code]; if (c != null && this.onChar) { if (c === 10 || c === 13) this.onChar(c === 10 ? '\n' : ''); else if (c >= 32 && c < 127) this.onChar(String.fromCharCode(c)); } } return; }
    this.acc = ((this.acc << 1) | b) & 0xffffff; this.last = b;
  };
  PskRx.prototype.tune = function (hz) { this.fc = this.fc0 = hz; this.q = 0; };
  PskRx.prototype.level = function () { return { q: this.q, fc: this.fc }; };
  D.PskRx = PskRx;
  D.pskTx = function (text, fc, rate) {
    rate = rate || R; const bits = []; for (let i = 0; i < 40; i++) bits.push(0);
    for (const ch of String(text).replace(/\r/g, '')) { const c = ch.charCodeAt(0); const v = VARI[c < 128 ? c : 32]; for (const b of v) bits.push(+b); bits.push(0, 0); }
    for (let i = 0; i < 32; i++) bits.push(1);
    const T = rate / 31.25, out = new Float32Array(Math.ceil((bits.length + 2) * T)); const w = TAU * fc / rate; let A = 1, n = 0, acc = 0;
    for (let s = 0; s < bits.length; s++) { acc += T; const end = Math.floor(acc), L = end - n, rev = bits[s] === 0;
      for (let j = 0; j < L; j++, n++) { let a = rev ? A * Math.cos(Math.PI * j / L) : A; if (s === 0) a *= Math.sin(Math.PI / 2 * j / L); if (s === bits.length - 1) a *= Math.cos(Math.PI / 2 * j / L); out[n] = a * Math.sin(w * n); }
      if (rev) A = -A; }
    return out.subarray(0, n);
  };

  /* ======================= SSTV ======================= */
  const PD = (vis, w, h, px) => ({ vis, w, h, rows: 2, yuv: 'pd', pre: 0, syncAt: 0, segs: [['s', 20], ['g', 2.08], ['Y0', w * px], ['V', w * px], ['U', w * px], ['Y1', w * px]] });
  const MART = (vis, sc) => ({ vis, w: 320, h: 256, rows: 1, pre: 0, syncAt: 0, segs: [['s', 4.862], ['g', .572], ['G', sc], ['g', .572], ['B', sc], ['g', .572], ['R', sc], ['g', .572]] });
  const SCOT = (vis, sc) => ({ vis, w: 320, h: 256, rows: 1, pre: 9, syncAt: 1.5 + sc + 1.5 + sc, segs: [['g', 1.5], ['G', sc], ['g', 1.5], ['B', sc], ['s', 9], ['g', 1.5], ['R', sc]] });
  const SSTV = {
    'Martin 1': MART(44, 146.432), 'Martin 2': MART(40, 73.216),
    'Scottie 1': SCOT(60, 138.24), 'Scottie 2': SCOT(56, 88.064), 'Scottie DX': SCOT(76, 345.6),
    'Robot 36': { vis: 8, w: 320, h: 240, rows: 1, yuv: 'r36', pre: 0, syncAt: 0, segs: [['s', 9], ['g', 3], ['Y', 88], ['g', 4.5], ['g', 1.5], ['C', 44]] },
    'Robot 72': { vis: 12, w: 320, h: 240, rows: 1, yuv: 'r72', pre: 0, syncAt: 0, segs: [['s', 9], ['g', 3], ['Y', 138], ['g', 4.5], ['g', 1.5], ['V', 69], ['g', 4.5], ['g', 1.5], ['U', 69]] },
    'PD 50': PD(93, 320, 256, .286), 'PD 90': PD(99, 320, 256, .532), 'PD 120': PD(95, 640, 496, .19), 'PD 160': PD(98, 512, 400, .382),
    'PD 180': PD(96, 640, 496, .286), 'PD 240': PD(97, 640, 496, .382), 'PD 290': PD(94, 800, 616, .286)
  };
  for (const k in SSTV) { const m = SSTV[k]; m.name = k; m.L = m.segs.reduce((a, s) => a + s[1], 0); m.lines = m.h / m.rows; m.secs = (m.pre + m.L * m.lines) / 1000; }
  const BYVIS = {}; for (const k in SSTV) BYVIS[SSTV[k].vis] = SSTV[k];
  D.SSTV = SSTV;
  const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;
  function yuv2rgb(Y, U, V, o, i) { o[i] = clamp(Y + 1.402 * (V - 128)); o[i + 1] = clamp(Y - 0.344136 * (U - 128) - 0.714136 * (V - 128)); o[i + 2] = clamp(Y + 1.772 * (U - 128)); o[i + 3] = 255; }
  /* receiver: feed() every 12 kHz sample. Calls onStart(mode), onRow(y, rgba Uint8ClampedArray width*4), onEnd(mode, rowsDone) */
  function SstvRx() { const c = lp(900, R); this.f = [new BQ(c), new BQ(c), new BQ(c), new BQ(c)]; this.ph = 0; this.pr = 1; this.pi = 0; this.ms = new Float32Array(1200); this.mi = 0; this.msAcc = 0; this.msN = 0;
    this.n = 0; this.img = null; this.onStart = this.onRow = this.onEnd = null; this.cand = null; this.auto = true; this.fl = 1900;
    const T = this.T = { r: new Float64Array(6), i: new Float64Array(6), c: new Float64Array(6).fill(1), s: new Float64Array(6), wc: new Float64Array(6), ws: new Float64Array(6), n: 0, zr: new Float64Array(1200 * 12) }; VT.forEach((f, k) => { T.wc[k] = Math.cos(TAU * f / R); T.ws[k] = Math.sin(TAU * f / R); }); }
  SstvRx.prototype.feed = function (x) {
    this.ph += TAU * 1900 / R; if (this.ph > TAU) this.ph -= TAU;
    const i = this.f[1].run(this.f[0].run(x * Math.cos(this.ph))), q = this.f[3].run(this.f[2].run(-x * Math.sin(this.ph)));
    const dr = i * this.pr + q * this.pi, di = q * this.pr - i * this.pi; this.pr = i; this.pi = q;
    let f = 1900 + Math.atan2(di, dr) * R / TAU; if (!(f > 900 && f < 2700)) f = f > 2700 ? 2700 : 900; this.fl += (f - this.fl) * 0.5; f = this.fl;
    this.n++;
    if (this.img) this.imgIn(f);
    this.toneIn(x);
    this.msAcc += f; if (++this.msN === 12) { this.ms[this.mi % 1200] = this.msAcc / 12; this.mi++; this.msAcc = 0; this.msN = 0; if (!this.img && this.auto) this.visCheck(); }
    this.freq = f;
  };
  /* VIS code by tone energy (matched to each 30 ms bit), which holds up in noise far better than reading the frequency */
  const VT = [1100, 1200, 1300, 1900, 1500, 2300];
  SstvRx.prototype.toneIn = function (x) { const T = this.T; for (let k = 0; k < 6; k++) { const c = T.c[k], sn = T.s[k]; T.r[k] += x * c; T.i[k] -= x * sn; const nc = c * T.wc[k] - sn * T.ws[k]; T.s[k] = c * T.ws[k] + sn * T.wc[k]; T.c[k] = nc; }
    if (++T.n === 12) { T.n = 0; const j = (this.mi % 1200) * 12; for (let k = 0; k < 6; k++) { T.zr[j + k * 2] = T.r[k]; T.zr[j + k * 2 + 1] = T.i[k]; T.r[k] = T.i[k] = 0; const g = 1 / Math.hypot(T.c[k], T.s[k]); T.c[k] *= g; T.s[k] *= g; } } };
  SstvRx.prototype.E = function (k, a, b, ch) { /* energy of tone k from a to b ms ago (coherent over chunks of ch ms) */ const T = this.T; let tot = 0, r = 0, i = 0, n = 0;
    for (let m = b; m > a; m--) { const j = (((this.mi - m) % 1200 + 1200) % 1200) * 12; r += T.zr[j + k * 2]; i += T.zr[j + k * 2 + 1]; if (++n === ch) { tot += r * r + i * i; r = i = 0; n = 0; } } return tot + r * r + i * i; };
  SstvRx.prototype.visCheck = function () {
    if (this.cand && this.n - this.cand.at > 12 * 15) { const c = this.cand; this.cand = null; this.start(BYVIS[c.code], c.at); return; }
    if (this.mi < 1000) return;
    const on = (a, b, k, others) => { const e = this.E(k, a, b, b - a); let o = 0; for (const q of others) o = Math.max(o, this.E(q, a, b, b - a)); return e / (o + 1e-12); };
    const rs = on(3, 27, 1, [0, 2, 3]); if (rs < 2.5) return; const ra = on(273, 297, 1, [0, 2, 3]); if (ra < 2.5) return;
    const lead = this.E(3, 330, 570, 10), oth = Math.max(this.E(4, 330, 570, 10), this.E(1, 330, 570, 10), this.E(5, 330, 570, 10)); if (lead < 3 * oth) return;
    let code = 0, ones = 0, sc = Math.log(rs) + Math.log(ra);
    for (let b = 0; b < 8; b++) { const lo = 270 - 30 * b - 27, hi = 270 - 30 * b - 3, e1 = this.E(0, lo, hi, 24), e0 = this.E(2, lo, hi, 24); const one = e1 > e0, r = (one ? e1 / (e0 + 1e-12) : e0 / (e1 + 1e-12)); if (r < 1.8) return; sc += Math.log(r); if (one) { ones++; if (b < 7) code |= 1 << b; } }
    if (ones % 2 !== 0 || !BYVIS[code]) return;
    if (!this.cand || this.cand.code !== code && sc > this.cand.sc) this.cand = { code, sc, at: this.n, first: this.n, last: this.n };
    else if (this.cand.code === code) { if (sc > this.cand.sc * 0.92) { this.cand.last = this.n; this.cand.at = Math.round((this.cand.first + this.cand.last) / 2); } if (sc > this.cand.sc) this.cand.sc = sc; }
  };
  /* start an image: mode + the sample number where line 0 begins (after VIS, or now for a manual start) */
  SstvRx.prototype.start = function (m, at, manual) {
    const len = Math.ceil((m.pre + m.L * (m.lines + 1)) / 1000 * R * 1.1) + R;
    this.img = { m, t0: at - 12 * 0 + (manual ? 0 : 0), F: new Float32Array(len), P: new Float64Array(len + 1), S: new Float64Array(len + 1), n: 0, base: at, line: 0, fit: [], miss: 0, jump: 0, manual: !!manual, chroma: null, rowbuf: null };
    const im = this.img; /* samples already past `at` (the 15 ms wait) are re-made from the freq history is not possible, so fill them with 1500 */
    const late = Math.max(0, this.n - at); for (let k = 0; k < late; k++) this.imgIn(1500, true);
    if (this.onStart) this.onStart(m);
    void im;
  };
  SstvRx.prototype.stop = function () { if (this.img) { const im = this.img; this.img = null; if (this.onEnd) this.onEnd(im.m, im.line * im.m.rows); } };
  SstvRx.prototype.imgIn = function (f) {
    const im = this.img; if (im.n >= im.F.length) { this.stop(); return; }
    const k = im.n; im.F[k] = f; im.P[k + 1] = im.P[k] + f; im.S[k + 1] = im.S[k] + (f < 1350 ? 1 : 0); im.n++;
    const m = im.m, sps = R / 1000;
    /* is the next line complete? */
    const pred = this.lineStart(im.line), end = pred + m.L * sps + 8 * sps;
    if (im.n >= end) this.doLine();
  };
  SstvRx.prototype.lineStart = function (n) { const im = this.img, m = im.m, sps = R / 1000; const f = im.fit;
    if (f.length >= 4) { let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const [x, y] of f) { sx += x; sy += y; sxx += x * x; sxy += x * y; } const N = f.length, d = N * sxx - sx * sx; if (d) { const b = (N * sxy - sx * sy) / d, a = (sy - b * sx) / N; if (b > m.L * sps * 0.98 && b < m.L * sps * 1.02) return a + b * n; } }
    if (f.length) { const [x, y] = f[f.length - 1]; return y + (n - x) * m.L * sps; }
    return m.pre * sps + n * m.L * sps; };
  SstvRx.prototype.doLine = function () {
    const im = this.img, m = im.m, sps = R / 1000, n = im.line; let st = this.lineStart(n);
    /* find the sync pulse near where it should be */
    const sl = Math.round(m.segs.find(s => s[0] === 's')[1] * sps), exp = st + m.syncAt * sps, win = Math.round((im.fit.length >= 4 ? 2.5 : im.manual && n < 2 ? m.L / 2 : 14) * sps);
    let bp = -1, bs = 0; for (let p = Math.max(0, Math.round(exp - win)); p <= Math.round(exp + win) && p + sl <= im.n; p++) { const s = (im.S[p + sl] - im.S[p]) / sl; if (s > bs + 1e-9) { bs = s; bp = p; } }
    if (bs > 0.62 && bp >= 0) { const got = bp - m.syncAt * sps, d = got - st;
      if (!im.fit.length || Math.abs(d) < (im.fit.length < 4 ? 14 : 6) * sps || im.manual && im.fit.length < 2) {
        /* a jump (the sound card dropped or doubled a few samples): follow the sync pulse and start the line fit again */
        if (im.fit.length >= 4 && Math.abs(d) > 1.2 * sps) { if (++im.jump >= 2) { im.fit = im.fit.slice(-1); im.jump = 0; } st = got; } else im.jump = 0;
        im.fit.push([n, got]); if (im.fit.length > 40) im.fit.shift(); if (im.fit.length < 4) st = got; } im.miss = 0; } else im.miss++;
    this.drawLine(n, st); im.line++;
    if (im.line >= m.lines || im.miss > 24) this.stop();
  };
  SstvRx.prototype.chan = function (a, dur, W) { const im = this.img, out = new Float32Array(W), step = dur / W;
    for (let x = 0; x < W; x++) { let lo = Math.round(a + x * step), hi = Math.round(a + (x + 1) * step); if (hi <= lo) hi = lo + 1; lo = Math.max(0, Math.min(im.n - 1, lo)); hi = Math.max(lo + 1, Math.min(im.n, hi)); const f = (im.P[hi] - im.P[lo]) / (hi - lo); out[x] = clamp((f - 1500) / 800 * 255); } return out; };
  SstvRx.prototype.drawLine = function (n, st) {
    const im = this.img, m = im.m, sps = R / 1000, W = m.w; let t = st; const C = {};
    for (const [k, ms] of m.segs) { const d = ms * sps; if (k.length <= 2 && k !== 's' && k !== 'g') C[k] = this.chan(t, d, W); t += d; }
    const row = () => new Uint8ClampedArray(W * 4);
    if (!m.yuv) { const o = row(); for (let x = 0; x < W; x++) { o[x * 4] = C.R[x]; o[x * 4 + 1] = C.G[x]; o[x * 4 + 2] = C.B[x]; o[x * 4 + 3] = 255; } if (this.onRow) this.onRow(n, o); return; }
    if (m.yuv === 'pd') { const a = row(), b = row(); for (let x = 0; x < W; x++) { yuv2rgb(C.Y0[x], C.U[x], C.V[x], a, x * 4); yuv2rgb(C.Y1[x], C.U[x], C.V[x], b, x * 4); } if (this.onRow) { this.onRow(2 * n, a); this.onRow(2 * n + 1, b); } return; }
    if (m.yuv === 'r72') { const o = row(); for (let x = 0; x < W; x++) yuv2rgb(C.Y[x], C.U[x], C.V[x], o, x * 4); if (this.onRow) this.onRow(n, o); return; }
    /* Robot 36: even lines carry R-Y, odd lines B-Y; each pair shares both */
    if (n % 2 === 0) { im.chroma = { Y: C.Y, V: C.C, n }; const o = row(); for (let x = 0; x < W; x++) yuv2rgb(C.Y[x], 128, C.C[x], o, x * 4); if (this.onRow) this.onRow(n, o); }
    else { const p = im.chroma && im.chroma.n === n - 1 ? im.chroma : { Y: C.Y, V: new Float32Array(W).fill(128) }; const a = row(), b = row();
      for (let x = 0; x < W; x++) { yuv2rgb(p.Y[x], C.C[x], p.V[x], a, x * 4); yuv2rgb(C.Y[x], C.C[x], p.V[x], b, x * 4); } if (this.onRow) { this.onRow(n - 1, a); this.onRow(n, b); } }
  };
  SstvRx.prototype.manual = function (name) { const m = SSTV[name]; if (m) this.start(m, this.n, true); };
  D.SstvRx = SstvRx;
  /* image (ImageData-like {width,height,data} already sized to the mode) → audio */
  D.sstvTx = function (img, name, rate) {
    const m = SSTV[name]; if (!m) return null; const W = m.w, px = img.data, fr = v => 1500 + 800 * v / 255;
    const segs = [[1900, .3], [1200, .01], [1900, .3], [1200, .03]]; let ones = 0; for (let b = 0; b < 7; b++) { const one = (m.vis >> b) & 1; ones += one; segs.push([one ? 1100 : 1300, .03]); } segs.push([ones % 2 ? 1100 : 1300, .03]); segs.push([1200, .03]);
    if (m.pre) segs.push([1200, m.pre / 1000]);
    const P = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const Yv = p => .299 * p[0] + .587 * p[1] + .114 * p[2], Uv = p => 128 - .168736 * p[0] - .331264 * p[1] + .5 * p[2], Vv = p => 128 + .5 * p[0] - .418688 * p[1] - .081312 * p[2];
    for (let n = 0; n < m.lines; n++) {
      for (const [k, ms] of m.segs) { const d = ms / 1000;
        if (k === 's') { segs.push([1200, d]); continue; }
        if (k === 'g') { segs.push([m.yuv === 'r36' && ms === 4.5 ? (n % 2 ? 2300 : 1500) : m.yuv && ms === 1.5 ? 1900 : 1500, d]); continue; }
        const y0 = m.rows === 2 ? 2 * n : n, y1 = m.rows === 2 ? 2 * n + 1 : n, pd = d / W;
        for (let x = 0; x < W; x++) { let v;
          if (k === 'R' || k === 'G' || k === 'B') v = P(x, y0)['RGB'.indexOf(k)];
          else if (k === 'Y' || k === 'Y0') v = Yv(P(x, y0)); else if (k === 'Y1') v = Yv(P(x, y1));
          else if (k === 'U' || k === 'V' || k === 'C') { const kk = k === 'C' ? (n % 2 ? 'U' : 'V') : k; const f = kk === 'U' ? Uv : Vv; v = m.rows === 2 ? (f(P(x, y0)) + f(P(x, y1))) / 2 : (m.yuv === 'r36' ? (f(P(x, n)) + f(P(x, Math.min(m.h - 1, n % 2 ? n - 1 : n + 1)))) / 2 : f(P(x, n))); }
          segs.push([fr(v), pd]); } } }
    return tones(segs, rate || R, 1);
  };

  /* ======================= WSPR ======================= */
  const PR3 = [1,1,0,0,0,0,0,0,1,0,0,0,1,1,1,0,0,0,1,0,0,1,0,1,1,1,1,0,0,0,0,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,1,0,1,1,0,0,1,1,0,1,0,0,0,1,1,0,1,0,0,0,0,1,1,0,1,0,1,0,1,0,1,0,0,1,0,0,1,0,1,1,0,0,0,1,1,0,1,0,1,0,0,0,1,0,0,0,0,0,1,0,0,1,0,0,1,1,1,0,1,1,0,0,1,1,0,1,0,0,0,1,1,1,0,0,0,0,0,1,0,1,0,0,1,1,0,0,0,0,0,0,0,1,1,0,1,0,1,1,0,0,0,1,1,0,0,0];
  const POLY1 = 0xf2d05351, POLY2 = 0xe4613c47;
  const par32 = v => { v ^= v >>> 16; v ^= v >>> 8; v ^= v >>> 4; v ^= v >>> 2; v ^= v >>> 1; return v & 1; };
  const ENC = st => (par32((st & POLY1) >>> 0) << 1) | par32((st & POLY2) >>> 0);
  const rev8 = i => { let r = 0; for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b); return r; };
  const ILV = []; for (let i = 0, p = 0; p < 162; i++) { const j = rev8(i); if (j < 162) { ILV[p] = j; p++; } }
  const cc = ch => { const c = ch.charCodeAt(0); if (c >= 48 && c <= 57) return c - 48; if (c === 32) return 36; if (c >= 65 && c <= 90) return c - 55; return -1; };
  function packCall(call) { call = call.toUpperCase(); if (call.length > 6 || call.length < 3) return -1; let c6;
    if (/\d/.test(call[2])) c6 = call.padEnd(6, ' '); else if (/\d/.test(call[1])) c6 = (' ' + call).padEnd(6, ' '); else return -1;
    if (!/^[A-Z0-9 ][A-Z0-9][0-9][A-Z ]{3}$/.test(c6)) return -1;
    const c = [...c6].map(cc); let n = c[0]; n = n * 36 + c[1]; n = n * 10 + c[2]; n = n * 27 + c[3] - 10; n = n * 27 + c[4] - 10; n = n * 27 + c[5] - 10; return n; }
  D.wsprPower = [0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 57, 60];
  /* "CALL GRID4 dBm" (type 1 only; calls with / are not supported) → 162 tones 0-3, or null */
  D.wsprEncode = function (call, grid, dbm) {
    const n = packCall(String(call || '').trim()); grid = String(grid || '').toUpperCase().slice(0, 4); if (n < 0 || !/^[A-R]{2}[0-9]{2}$/.test(grid)) return null;
    dbm = +dbm; if (!D.wsprPower.includes(dbm)) return null;
    const g = [grid.charCodeAt(0) - 65, grid.charCodeAt(1) - 65, +grid[2], +grid[3]];
    const m = ((179 - 10 * g[0] - g[2]) * 180 + 10 * g[1] + g[3]) * 128 + dbm + 64;
    const d = [(n >>> 20) & 255, (n >>> 12) & 255, (n >>> 4) & 255, ((n & 15) << 4) | ((m >>> 18) & 15), (m >>> 10) & 255, (m >>> 2) & 255, (m & 3) << 6, 0, 0, 0, 0];
    const bits = []; let st = 0; for (let b = 0; b < 11; b++) for (let i = 7; i >= 0; i--) { st = ((st << 1) | ((d[b] >> i) & 1)) >>> 0; const s = ENC(st); bits.push(s >> 1, s & 1); }
    const ch = new Array(162); for (let p = 0; p < 162; p++) ch[ILV[p]] = bits[p];
    const sym = new Uint8Array(162); for (let i = 0; i < 162; i++) sym[i] = 2 * ch[i] + PR3[i]; return sym;
  };
  /* 162 tones → audio: 1.4648 Hz apart, 0.6827 s each (110.6 s) */
  D.wsprTx = function (sym, hz, rate) { rate = rate || R; const segs = []; for (const s of sym) segs.push([hz - 1.5 * 12000 / 8192 + s * 12000 / 8192, 8192 / 12000]); return tones(segs, rate, 1); };

  /* --- decoder (port of wsprd) --- */
  const MET = [0.9999,0.9998,0.9998,0.9998,0.9998,0.9998,0.9997,0.9997,0.9997,0.9997,0.9997,0.9996,0.9996,0.9996,0.9995,0.9995,0.9994,0.9994,0.9994,0.9993,0.9993,0.9992,0.9991,0.9991,0.999,0.9989,0.9988,0.9988,0.9988,0.9986,0.9985,0.9984,0.9983,0.9982,0.998,0.9979,0.9977,0.9976,0.9974,0.9971,0.9969,0.9968,0.9965,0.9962,0.996,0.9957,0.9953,0.995,0.9947,0.9941,0.9937,0.9933,0.9928,0.9922,0.9917,0.9911,0.9904,0.9897,0.989,0.9882,0.9874,0.9863,0.9855,0.9843,0.9832,0.9819,0.9806,0.9792,0.9777,0.976,0.9743,0.9724,0.9704,0.9683,0.9659,0.9634,0.9609,0.9581,0.955,0.9516,0.9481,0.9446,0.9406,0.9363,0.9317,0.927,0.9218,0.916,0.9103,0.9038,0.8972,0.8898,0.8822,0.8739,0.8647,0.8554,0.8457,0.8357,0.8231,0.8115,0.7984,0.7854,0.7704,0.7556,0.7391,0.721,0.7038,0.684,0.6633,0.6408,0.6174,0.5939,0.5678,0.541,0.5137,0.4836,0.4524,0.4193,0.385,0.3482,0.3132,0.2733,0.2315,0.1891,0.1435,0.098,0.0493,0,-0.051,-0.1052,-0.1593,-0.2177,-0.2759,-0.3374,-0.4005,-0.4599,-0.5266,-0.5935,-0.6626,-0.7328,-0.8051,-0.8757,-0.9498,-1.0271,-1.1019,-1.1816,-1.2642,-1.3459,-1.4295,-1.5077,-1.5958,-1.6818,-1.7647,-1.8548,-1.9387,-2.0295,-2.1152,-2.2154,-2.3011,-2.3904,-2.482,-2.5786,-2.673,-2.7652,-2.8616,-2.9546,-3.0526,-3.1445,-3.2445,-3.3416,-3.4357,-3.5325,-3.6324,-3.7313,-3.8225,-3.9209,-4.0248,-4.1278,-4.2261,-4.3193,-4.422,-4.5262,-4.6214,-4.7242,-4.8234,-4.9245,-5.0298,-5.125,-5.2232,-5.3267,-5.4332,-5.5342,-5.6431,-5.727,-5.8401,-5.935,-6.0407,-6.1418,-6.2363,-6.3384,-6.4536,-6.5429,-6.6582,-6.7433,-6.8438,-6.9478,-7.0789,-7.1894,-7.2714,-7.3815,-7.481,-7.5575,-7.6852,-7.8071,-7.858,-7.9724,-8.1,-8.2207,-8.2867,-8.4017,-8.5287,-8.6347,-8.7082,-8.8319,-8.9448,-9.0355,-9.1885,-9.2095,-9.2863,-9.4186,-9.5064,-9.6386,-9.7207,-9.8286,-9.9453,-10.0701,-10.1735,-10.3001,-10.2858,-10.5427,-10.5982,-10.7361,-10.7042,-10.9212,-11.0097,-11.0469,-11.1155,-11.2812,-11.3472,-11.4988,-11.5327,-11.6692,-11.9376,-11.8606,-12.1372,-13.2539];
  const BIAS = 0.45, M0 = new Int32Array(256), M1 = new Int32Array(256); for (let i = 0; i < 256; i++) { M0[i] = Math.round(10 * (MET[i] - BIAS)); M1[i] = Math.round(10 * (MET[255 - i] - BIAS)); }
  function fano(sym, nbits, delta, maxcycles) {
    const enc = new Uint32Array(nbits + 1), gam = new Float64Array(nbits + 1), met = new Int32Array((nbits + 1) * 4), tm0 = new Int32Array(nbits + 1), tm1 = new Int32Array(nbits + 1), br = new Uint8Array(nbits + 1);
    for (let k = 0; k < nbits; k++) { const a = sym[2 * k], b = sym[2 * k + 1]; met[k * 4] = M0[a] + M0[b]; met[k * 4 + 1] = M0[a] + M1[b]; met[k * 4 + 2] = M1[a] + M0[b]; met[k * 4 + 3] = M1[a] + M1[b]; }
    const last = nbits - 1, tail = nbits - 31; let np = 0; enc[0] = 0;
    let l = ENC(enc[0]), m0 = met[l], m1 = met[3 ^ l]; if (m0 > m1) { tm0[0] = m0; tm1[0] = m1; } else { tm0[0] = m1; tm1[0] = m0; enc[0]++; }
    br[0] = 0; gam[0] = 0; let t = 0; maxcycles *= nbits; let i;
    for (i = 1; i <= maxcycles; i++) {
      const ng = gam[np] + (br[np] ? tm1[np] : tm0[np]);
      if (ng >= t) {
        if (gam[np] < t + delta) while (ng >= t + delta) t += delta;
        gam[np + 1] = ng; enc[np + 1] = (enc[np] << 1) >>> 0;
        if (++np === last + 1) break;
        l = ENC(enc[np]);
        if (np >= tail) tm0[np] = met[np * 4 + l];
        else { m0 = met[np * 4 + l]; m1 = met[np * 4 + (3 ^ l)]; if (m0 > m1) { tm0[np] = m0; tm1[np] = m1; } else { tm0[np] = m1; tm1[np] = m0; enc[np] = (enc[np] + 1) >>> 0; } }
        br[np] = 0; continue;
      }
      for (;;) {
        if (np === 0 || gam[np - 1] < t) { t -= delta; if (br[np] !== 0) { br[np] = 0; enc[np] ^= 1; } break; }
        if (--np < tail && br[np] !== 1) { br[np]++; enc[np] ^= 1; break; }
      }
    }
    if (i > maxcycles) return null;
    const out = new Uint8Array(nbits >> 3); for (let k = 0; k < out.length; k++) out[k] = enc[7 + 8 * k] & 255; return out;
  }
  const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
  function unpack(d) {
    const n1 = (d[0] << 20) + (d[1] << 12) + (d[2] << 4) + ((d[3] >> 4) & 15), n2 = ((d[3] & 15) << 18) + (d[4] << 10) + (d[5] << 2) + ((d[6] >> 6) & 3);
    if (n1 >= 262177560) return null;
    let n = n1; const t = []; t[5] = CH[n % 27 + 10]; n = Math.floor(n / 27); t[4] = CH[n % 27 + 10]; n = Math.floor(n / 27); t[3] = CH[n % 27 + 10]; n = Math.floor(n / 27); t[2] = CH[n % 10]; n = Math.floor(n / 10); t[1] = CH[n % 36]; n = Math.floor(n / 36); t[0] = CH[n];
    let call = t.join('').trim(); const ng = n2 >> 7; if (ng >= 32400) return null;
    const dlat = ng % 180 - 90; let dlong = Math.floor(ng / 180) * 2 - 180 + 2; if (dlong < -180) dlong += 360; if (dlong > 180) dlong += 360;
    const nlong = Math.floor(60 * (180 - dlong) / 5), a1 = Math.floor(nlong / 240), a2 = Math.floor((nlong - 240 * a1) / 24), nlat = Math.floor(60 * (dlat + 90) / 2.5), b1 = Math.floor(nlat / 240), b2 = Math.floor((nlat - 240 * b1) / 24);
    const grid = CH[10 + a1] + CH[10 + b1] + CH[a2] + CH[b2];
    const ntype = (n2 & 127) - 64;
    if (ntype >= 0 && ntype <= 62) { const nu = ntype % 10;
      if (nu === 0 || nu === 3 || nu === 7) { if (!/^[A-Z0-9]{1,3}[0-9][A-Z]{0,3}$/.test(call)) return null; return { call, grid, dbm: ntype, msg: call + ' ' + grid + ' ' + ntype }; }
      let nadd = nu; if (nu > 3) nadd = nu - 3; if (nu > 7) nadd = nu - 7; const n3 = (n2 >> 7) + 32768 * (nadd - 1), dbm = ntype - nadd;
      if (n3 < 60000) { let pf = '', x = n3; for (let k = 0; k < 3; k++) { const c = x % 37; pf = (c < 10 ? String(c) : c < 36 ? String.fromCharCode(c + 55) : ' ') + pf; x = Math.floor(x / 37); } call = pf.trim() + '/' + call; }
      else { const c = n3 - 60000; if (c < 10) call += '/' + c; else if (c < 36) call += '/' + String.fromCharCode(c + 55); else if (c < 126) call += '/' + Math.floor((c - 26) / 10) + ((c - 26) % 10); else return null; }
      const nn = dbm % 10; if (!(nn === 0 || nn === 3 || nn === 7)) return null; return { call, grid: '', dbm, msg: call + ' ' + dbm };
    }
    if (ntype < 0) { const dbm = -(ntype + 1), c6 = t.join(''), g6 = c6[5] + c6.slice(0, 5); if (ntype === -64 || !/^[A-R]{2}[0-9]{2}/.test(g6)) return null; return { call: '<...>', grid: g6.trim(), dbm, msg: '<...> ' + g6.trim() + ' ' + dbm }; }
    return null;
  }
  /* 12 kHz audio (starting at the even minute) → 375 Hz complex baseband around 1500 Hz, 45 000 points */
  function down(a) {
    const mk = (N, fc, fs) => { const h = new Float64Array(N), mid = (N - 1) / 2; let s = 0; for (let k = 0; k < N; k++) { const x = k - mid, w = 0.42 - 0.5 * Math.cos(TAU * k / (N - 1)) + 0.08 * Math.cos(2 * TAU * k / (N - 1)); h[k] = (x === 0 ? 2 * fc / fs : Math.sin(TAU * fc / fs * x) / (Math.PI * x)) * w; s += h[k]; } for (let k = 0; k < N; k++) h[k] /= s; return h; };
    const h1 = mk(97, 420, 12000), h2 = mk(201, 172, 1500), n1 = Math.floor(a.length / 8), ir = new Float32Array(n1), iq = new Float32Array(n1), w = TAU * 1500 / 12000;
    const cr = new Float32Array(a.length), ci = new Float32Array(a.length); for (let n = 0; n < a.length; n++) { cr[n] = a[n] * Math.cos(w * n); ci[n] = -a[n] * Math.sin(w * n); }
    for (let m = 0; m < n1; m++) { let sr = 0, si = 0; const c = m * 8 - 48; for (let k = 0; k < 97; k++) { const j = c + k; if (j >= 0 && j < a.length) { sr += h1[k] * cr[j]; si += h1[k] * ci[j]; } } ir[m] = sr; iq[m] = si; }
    const N = 45000, id = new Float32Array(N), qd = new Float32Array(N);
    for (let m = 0; m < N; m++) { let sr = 0, si = 0; const c = m * 4 - 100; for (let k = 0; k < 201; k++) { const j = c + k; if (j >= 0 && j < n1) { sr += h2[k] * ir[j]; si += h2[k] * iq[j]; } } id[m] = sr * 100; qd[m] = si * 100; }
    return [id, qd];
  }
  function osc(fp) { const dt = 1 / 375, df = 375 / 256, o = []; for (const d of [-1.5, -0.5, 0.5, 1.5]) { const ph = TAU * dt * (fp + d * df), c = new Float64Array(257), s = new Float64Array(257); c[0] = 1; s[0] = 0; const cd = Math.cos(ph), sd = Math.sin(ph); for (let j = 1; j < 257; j++) { c[j] = c[j - 1] * cd - s[j - 1] * sd; s[j] = c[j - 1] * sd + s[j - 1] * cd; } o.push([c, s]); } return o; }
  function tonesAt(id, qd, np, lag, f0, drift) { /* per-symbol I/Q of the 4 tones (+ end rotations) */
    const is = [new Float64Array(162), new Float64Array(162), new Float64Array(162), new Float64Array(162)], qs = is.map(() => new Float64Array(162)), cf = is.map(() => new Float64Array(162)), sf = is.map(() => new Float64Array(162));
    let last = NaN, O = null;
    for (let i = 0; i < 162; i++) { const fp = f0 + (drift / 2) * (i - 81) / 81; if (fp !== last) { O = osc(fp); last = fp; }
      for (let t = 0; t < 4; t++) { const [c, s] = O[t]; let I = 0, Q = 0; for (let j = 0; j < 256; j++) { const k = lag + i * 256 + j; if (k > 0 && k < np) { I += id[k] * c[j] + qd[k] * s[j]; Q += -id[k] * s[j] + qd[k] * c[j]; } } is[t][i] = I; qs[t][i] = Q; cf[t][i] = c[256]; sf[t][i] = s[256]; } }
    return { is, qs, cf, sf };
  }
  function syncDemod(id, qd, np, f1, ifmin, ifmax, fstep, shift, lagmin, lagmax, lagstep, drift, mode) {
    let best = -1e30, bs = shift, bf = f1;
    if (mode === 0) { ifmin = 0; ifmax = 0; fstep = 0; } if (mode === 1) { lagmin = shift; lagmax = shift; }
    for (let ifr = ifmin; ifr <= ifmax; ifr++) { const f0 = f1 + ifr * fstep;
      for (let lag = lagmin; lag <= lagmax; lag += lagstep) { const T = tonesAt(id, qd, np, lag, f0, drift); let ss = 0, tot = 0;
        for (let i = 0; i < 162; i++) { const p = [0, 1, 2, 3].map(t => Math.sqrt(T.is[t][i] ** 2 + T.qs[t][i] ** 2)); tot += p[0] + p[1] + p[2] + p[3]; const cm = (p[1] + p[3]) - (p[0] + p[2]); ss += PR3[i] ? cm : -cm; }
        ss /= tot; if (ss > best) { best = ss; bs = lag; bf = f0; } } }
    return { sync: best, shift: bs, f: bf };
  }
  function ncsd(id, qd, np, f1, lag, drift, nblock, bitbybit) {
    const T = tonesAt(id, qd, np, lag, f1, drift), fs = new Float64Array(162), nseq = 1 << nblock;
    for (let i = 0; i < 162; i += nblock) { const p = new Float64Array(nseq);
      for (let j = 0; j < nseq; j++) { let xi = 0, xq = 0, cm = 1, sm = 0; for (let ib = 0; ib < nblock && i + ib < 162; ib++) { const b = (j >> (nblock - 1 - ib)) & 1, it = PR3[i + ib] + 2 * b, a = T.is[it][i + ib], q = T.qs[it][i + ib];
          xi += a * cm + q * sm; xq += q * cm - a * sm; const cmp = T.cf[it][i + ib] * cm - T.sf[it][i + ib] * sm, smp = T.sf[it][i + ib] * cm + T.cf[it][i + ib] * sm; cm = cmp; sm = smp; } p[j] = Math.sqrt(xi * xi + xq * xq); }
      for (let ib = 0; ib < nblock && i + ib < 162; ib++) { const mask = 1 << (nblock - 1 - ib); let x1 = 0, x0 = 0; for (let j = 0; j < nseq; j++) { if (j & mask) { if (p[j] > x1) x1 = p[j]; } else if (p[j] > x0) x0 = p[j]; } fs[i + ib] = x1 - x0; if (bitbybit) fs[i + ib] /= Math.max(x1, x0) || 1; } }
    let s1 = 0, s2 = 0; for (let i = 0; i < 162; i++) { s1 += fs[i] / 162; s2 += fs[i] * fs[i] / 162; } const fac = Math.sqrt(Math.max(1e-12, s2 - s1 * s1)), out = new Uint8Array(162);
    for (let i = 0; i < 162; i++) { let v = 50 * fs[i] / fac; if (v > 127) v = 127; if (v < -128) v = -128; out[i] = Math.floor(v + 128); } return out;
  }
  function deinterleave(s) { const t = new Uint8Array(162); for (let p = 0; p < 162; p++) t[p] = s[ILV[p]]; return t; }
  /* audio: Float32Array at 12 kHz, starting on the even minute (114 s or a bit less). Returns decodes. */
  D.wsprDecode = function (audio, opt) { const [id, qd] = down(audio); return D.wsprDecodeIQ(id, qd, opt); };
  D.wsprDecodeIQ = function (id, qd, opt) {
    opt = opt || {}; const t00 = Date.now(), budget = opt.ms || 45000;
    const np = 45000, nffts = 4 * Math.floor(np / 512) - 1, df = 375 / 256 / 2, dt = 1 / 375;
    const ps = []; for (let j = 0; j < 512; j++) ps.push(new Float32Array(nffts)); const re = new Float64Array(512), im = new Float64Array(512), w = new Float64Array(512); for (let i = 0; i < 512; i++) w[i] = Math.sin(0.006147931 * i);
    for (let i = 0; i < nffts; i++) { for (let j = 0; j < 512; j++) { const k = i * 128 + j; re[j] = (k < np ? id[k] : 0) * w[j]; im[j] = (k < np ? qd[k] : 0) * w[j]; } fft(re, im); for (let j = 0; j < 512; j++) { const k = (j + 256) % 512; ps[j][i] = re[k] * re[k] + im[k] * im[k]; } }
    const psavg = new Float64Array(512); for (let j = 0; j < 512; j++) { let s = 0; for (let i = 0; i < nffts; i++) s += ps[j][i]; psavg[j] = s; }
    const sm = new Float64Array(411); for (let i = 0; i < 411; i++) { let s = 0; for (let j = -3; j <= 3; j++) s += psavg[256 - 205 + i + j]; sm[i] = s; }
    const srt = Array.from(sm).sort((a, b) => a - b), noise = srt[122] || 1, minsnr = Math.pow(10, -0.8);
    for (let j = 0; j < 411; j++) { sm[j] = sm[j] / noise - 1; if (sm[j] < minsnr) sm[j] = 0.1 * minsnr; }
    let C = []; for (let j = 1; j < 410 && C.length < 200; j++) if (sm[j] > sm[j - 1] && sm[j] > sm[j + 1]) C.push({ freq: (j - 205) * df, snr: 10 * Math.log10(sm[j]) - 26.3, shift: 0, drift: 0, sync: 0 });
    const fmin = opt.fmin != null ? opt.fmin : -110, fmax = opt.fmax != null ? opt.fmax : 110; C = C.filter(c => c.freq >= fmin && c.freq <= fmax).sort((a, b) => b.snr - a.snr).slice(0, opt.maxc || 60);
    const maxdrift = 4;
    for (const c of C) { let smax = -1e30; const if0 = Math.floor(c.freq / df + 256);
      for (let ifr = if0 - 2; ifr <= if0 + 2; ifr++) for (let k0 = -10; k0 < 22; k0++) for (let idr = -maxdrift; idr <= maxdrift; idr++) { let ss = 0, pw = 0;
        for (let k = 0; k < 162; k++) { const ifd = Math.trunc(ifr + (k - 81) / 81 * idr / (2 * df)), ki = k0 + 2 * k; if (ki >= 0 && ki < nffts && ifd - 3 >= 0 && ifd + 3 < 512) { const p0 = Math.sqrt(ps[ifd - 3][ki]), p1 = Math.sqrt(ps[ifd - 1][ki]), p2 = Math.sqrt(ps[ifd + 1][ki]), p3 = Math.sqrt(ps[ifd + 3][ki]); ss += (2 * PR3[k] - 1) * ((p1 + p3) - (p0 + p2)); pw += p0 + p1 + p2 + p3; } }
        const s1 = ss / (pw || 1); if (s1 > smax) { smax = s1; c.shift = 128 * (k0 + 1); c.drift = idr; c.freq = (ifr - 256) * df; c.sync = s1; } } }
    for (const c of C) { if (Date.now() - t00 > budget) break;
      let f1 = c.freq, drift = c.drift, shift = c.shift, r;
      r = syncDemod(id, qd, np, f1, 0, 0, 0, shift, shift - 128, shift + 128, 64, drift, 0); shift = r.shift;
      r = syncDemod(id, qd, np, f1, -2, 2, 0.25, shift, 0, 0, 64, drift, 1); f1 = r.f; let sync = r.sync;
      const rp = syncDemod(id, qd, np, f1, 0, 0, 0, shift, 0, 0, 64, drift + 0.5, 1), rm = syncDemod(id, qd, np, f1, 0, 0, 0, shift, 0, 0, 64, drift - 0.5, 1);
      if (rp.sync > sync) { drift += 0.5; sync = rp.sync; } else if (rm.sync > sync) { drift -= 0.5; sync = rm.sync; }
      if (sync > 0.10) { r = syncDemod(id, qd, np, f1, 0, 0, 0, shift, shift - 32, shift + 32, 16, drift, 0); shift = r.shift; r = syncDemod(id, qd, np, f1, -2, 2, 0.05, shift, 0, 0, 16, drift, 1); f1 = r.f; sync = r.sync; }
      c.freq = f1; c.shift = shift; c.drift = drift; c.sync = sync; }
    const W = []; for (const c of C) { const k = W.findIndex(x => Math.abs(c.freq - x.freq) < 0.05 && Math.abs(c.shift - x.shift) < 16); if (k >= 0) { if (c.sync > W[k].sync) W[k] = c; } else if (c.sync > 0.12) W.push(c); }
    const out = [], minrms = 52 * 50 / 64;
    for (const c of W) { if (Date.now() - t00 > budget) break; let got = null;
      for (let ib = 1; ib <= (opt.deep ? 4 : 1) && !got; ib++) { const nb = ib < 4 ? ib : 1, bb = ib === 4 ? 1 : 0;
        for (let idt = 0; idt <= 16 && !got; idt++) { let ii = (idt + 1) >> 1; if (idt % 2 === 1) ii = -ii; ii *= 8;
          const sy = ncsd(id, qd, np, c.freq, c.shift + ii, c.drift, nb, bb); let sq = 0; for (let i = 0; i < 162; i++) sq += (sy[i] - 128) ** 2; if (Math.sqrt(sq / 162) <= minrms) continue;
          const d = fano(deinterleave(sy), 81, 60, opt.cycles || 10000); if (!d) continue; const u = unpack(d); if (u) got = Object.assign(u, { jit: ii }); } }
      if (got && !out.some(o => o.call === got.call && Math.abs(o.df - c.freq) < 4)) out.push(Object.assign(got, { snr: Math.round(c.snr), dt: +(c.shift * dt - 1).toFixed(1), df: +c.freq.toFixed(1), drift: c.drift, sync: c.sync })); }
    return out.sort((a, b) => a.df - b.df);
  };

  /* ---------------- Feld Hellschreiber (Oct 17, Brandon: 'hellschreiber') ----------------
     On/off keyed tone, 2.5 characters a second: each character = 7 columns, each column = 14 picture elements scanned
     bottom to top (245 elements a second, about 4.08 ms each). Nothing to decode: the receiver just paints the tone's
     strength as a picture, so your eyes read it (that's why it copies through noise and needs no sync). */
  const HELLF = {
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], 'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], 'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], 'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'], 'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'], 'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], 'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], 'N': ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], 'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], 'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], 'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], 'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], 'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], 'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'], ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
    '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'], '/': ['00000', '00001', '00010', '00100', '01000', '10000', '00000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'], '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'], ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
    "'": ['01100', '00100', '01000', '00000', '00000', '00000', '00000'], '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
    ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'], '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
    '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110'], '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
  };
  D.HELL = { cps: 2.5, cols: 7, rows: 14, rate: 245 };
  /* columns of 14 elements (bottom first) for a text */
  function hellCols(text) { const out = []; for (const ch of String(text).toUpperCase()) { const g = HELLF[ch] || HELLF[ch === '\n' ? ' ' : '?'];
      const C = [[], [], [], [], [], [], []]; for (let c = 0; c < 7; c++) for (let r = 13; r >= 0; r--) { const row = Math.floor(r / 2), on = c >= 1 && c <= 5 && g[row][c - 1] === '1'; C[c].push(on ? 1 : 0); }
      /* rows are listed top to bottom; the scan goes bottom to top, so element 0 = bottom (row 6) */
      out.push(...C); } return out; }
  D.hellTx = function (text, fc, rate) { rate = rate || R; const cols = hellCols(' ' + text + ' '), el = rate / 245, N = Math.ceil(cols.length * 14 * el), out = new Float32Array(N + 8);
    const rise = Math.max(4, Math.round(rate * 0.0012)); let ph = 0; const w = TAU * fc / rate;
    const bits = []; for (const c of cols) for (const b of c) bits.push(b);
    for (let n = 0; n < N; n++) { const k = Math.floor(n / el), b = bits[k] || 0; let env = b; if (b) { const st = Math.round(k * el), en = Math.round((k + 1) * el); let a = Math.min(n - st, en - n) / rise;
        if (bits[k - 1]) a = Math.max(a, (en - n) / rise > 1 ? 1 : a); if (bits[k + 1]) a = Math.max(a, (n - st) / rise > 1 ? 1 : a); if (bits[k - 1] && bits[k + 1]) a = 1; env = Math.min(1, Math.max(0, a)); env = 0.5 - 0.5 * Math.cos(Math.PI * env); }
      out[n] = 0.85 * env * Math.sin(ph); ph += w; if (ph > TAU) ph -= TAU; } return out; };
  /* receiver: mix to 0 Hz, ~2 ms smoothing (passes 245 elements a second), strength per element, slow AGC */
  function HellRx(fc) { this.tune(fc || 1000); this.i = 0; this.q = 0; this.acc = 0; this.n = 0; this.pos = 0; this.pk = 1e-6; this.fl = 1e-7; this.onPx = null; this.sig = 0; }
  HellRx.prototype.tune = function (fc) { this.fc = fc; this.w = TAU * fc / R; this.ph = this.ph || 0; };
  HellRx.prototype.feed = function (x) {
    this.ph += this.w; if (this.ph > TAU) this.ph -= TAU; const a = 0.11;                    /* one-pole low-pass at ~220 Hz, run twice */
    this.i += a * (x * Math.cos(this.ph) - this.i); this.q += a * (-x * Math.sin(this.ph) - this.q);
    this.i2 = (this.i2 || 0) + a * (this.i - (this.i2 || 0)); this.q2 = (this.q2 || 0) + a * (this.q - (this.q2 || 0));
    this.acc += Math.sqrt(this.i2 * this.i2 + this.q2 * this.q2); this.n++; this.pos += 245 / R;
    if (this.pos >= 1) { this.pos -= 1; const v = this.acc / this.n; this.acc = 0; this.n = 0;
      this.pk = Math.max(v, this.pk * 0.9993); this.fl = Math.min(v, this.fl * 1.0005 + 1e-9); if (this.fl > v) this.fl = v;
      const span = Math.max(this.pk - this.fl, 1e-7), lvl = Math.max(0, Math.min(1, (v - this.fl) / span)); this.sig = this.sig * 0.995 + lvl * 0.005;
      if (this.onPx) this.onPx(lvl); } };
  D.HellRx = HellRx;
  D._hellCols = hellCols;
  D._unpack = unpack; D._fano = fano; D._down = down;

  /* worker mode: decode WSPR off the main screen */
  if (typeof window === 'undefined' && typeof self !== 'undefined' && typeof postMessage === 'function') {
    self.onmessage = e => { const m = e.data || {}; if (m.cmd === 'wspr') { let res = [], err = ''; try { res = D.wsprDecode(m.audio, m.opt); } catch (x) { err = String(x && x.message || x); } postMessage({ cmd: 'wspr', id: m.id, res, err }); } };
  }
  G.KPCDsp = D;   /* app copy: named KPCDsp (the app's own KPCDigi is the FT8 screen) */
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
