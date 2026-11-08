/* KPC app: 🎚 LISTENING CLEAN-UP — noise reduction, noise blanker, auto-notch and a filter for what you HEAR through the app
   (Nov 6 2026, Opus; the SDR handoff, section 6; Brandon: 'do next session').

   ONLY THE LISTENING PATHS: 🔊 HEAR THE RADIO HERE (kpc-native.js monitor) and the sound the PC sends to a phone on the REMOTE link
   (sendStream). NEVER the decoders: FT8 / FT4 / RTTY / PSK / SSTV / the AUDIO scope all read the raw capture, before any of this
   (the handoff: 'NR can erase digital signals; the digital path bypasses it'). Nothing here touches what goes to the radio.

   The chain:  radio sound → FILTER (Web Audio biquads, 3 high-pass + 3 low-pass) → kpc-nr worklet: NOISE BLANKER → AUTO-NOTCH →
               NOISE REDUCTION → speakers / phone.   One switch each; A/B = hear it with everything off, same loudness path.
     FILTER   off · voice 250–2800 Hz · CW 350–850 Hz (pitch 600) · wide 100–3500 Hz
     BLANKER  impulses (ignition, electric fence) far above the running level are muted for 1.5 ms with short ramps
     NOTCH    adaptive line enhancer (normalised LMS, 48 taps, 32-sample delay): a steady carrier is predictable, speech is not,
              so the predictable part is taken away. OFF for CW (it would notch the CW you want).
     NR       short-time spectrum (512-point FFT, half overlap, √Hann), the noise floor tracked per bin (follows it down at once,
              up slowly), Wiener gain with decision-directed SNR, a floor so it never goes silent (light −9 dB, medium −14,
              strong −20), gains smoothed across neighbouring bins against 'musical' warble. ≈ 11 ms delay at 48 kHz.
   The DSP core (NRCore) is plain JS: the worklet runs it on the audio thread, the tests run it on recorded-style test sound.
   Settings: localStorage kpcAppNr. */
(function (G) {
  'use strict';
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = Object.assign({ nr: 'off', nb: false, notch: false, filt: 'off', bypass: false, pitch: 600 }, LS('kpcAppNr', {}));
  const save = () => SV('kpcAppNr', S);
  const NR_FLOOR = { off: 1, light: 0.35, medium: 0.2, strong: 0.1 }, NR_OVER = { off: 1, light: 1, medium: 1.4, strong: 2 };

  /* ======================================================================== the DSP core (also the worklet's body) */
  function NRCore(sr) {
    const N = 512, H = 256, B = N / 2 + 1;
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    const rev = new Uint16Array(N); for (let i = 0; i < N; i++) { let r = 0; for (let k = 0; k < 9; k++) if (i & (1 << k)) r |= 1 << (8 - k); rev[i] = r; }
    const re = new Float32Array(N), im = new Float32Array(N);
    function fft(inv) {
      for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= N; len <<= 1) { const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
        for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) { const ar = re[i + k], ai = im[i + k], br = re[i + k + h], bi = im[i + k + h], vr = br * cr - bi * ci, vi = br * ci + bi * cr;
          re[i + k] = ar + vr; im[i + k] = ai + vi; re[i + k + h] = ar - vr; im[i + k + h] = ai - vi; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
      if (inv) for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
    }
    const inBuf = new Float32Array(N), outAcc = new Float32Array(N), RB = 4 * N, ring = new Float32Array(RB); let inN = 0, rw = 0, rr = 0, rc = 0;
    const noise = new Float32Array(B).fill(1e-6), ps = new Float32Array(B), gPrev = new Float32Array(B).fill(1), pPrev = new Float32Array(B), g = new Float32Array(B), gs = new Float32Array(B);
    let frames = 0;
    /* blanker */
    let env = 1e-3, blank = 0, bGain = 1, lp = 0, seen = 0; const bLen = Math.round(0.0015 * sr), bRamp = Math.max(4, Math.round(0.0003 * sr)), LA = bRamp + 4, look = new Float32Array(LA);   /* look-ahead: the gate is shut before the click gets through */
    /* notch (adaptive line enhancer) */
    const L = 48, D = 32, w = new Float32Array(L), hist = new Float32Array(L + D + 1); let hp = 0, pow = 1e-4;
    const o = { nr: 'off', nb: false, notch: false, bypass: false, floor: 1, over: 1 };
    const self = {
      set(p) { Object.assign(o, p || {}); o.floor = { off: 1, light: 0.35, medium: 0.2, strong: 0.1 }[o.nr] || 1; o.over = { off: 1, light: 1, medium: 1.4, strong: 2 }[o.nr] || 1; },
      latency: N,
      process(x, y) {               /* x in, y out (same length; y may be x) */
        for (let n = 0; n < x.length; n++) {
          let v = x[n];
          if (!o.bypass) {
            if (o.nb) {
              const a = Math.abs(v), late = look[lp]; look[lp] = v; lp = (lp + 1) % LA;
              if (seen < 4800) { seen++; env = env * 0.995 + a * 0.005; }                       /* the first 0.1 s: learn the level */
              else if (a > 8 * env + 0.02) blank = bLen + LA;                                  /* seen now, shut the gate on the delayed sound */
              else if (blank <= 0) env = env * 0.999 + a * 0.001;
              if (blank > 0) { blank--; bGain = Math.max(0, bGain - 1 / bRamp); } else bGain = Math.min(1, bGain + 1 / bRamp);
              v = late * bGain;
            }
            if (o.notch) {
              hist[hp] = v; let yv = 0; const base = hp - D;
              for (let k = 0; k < L; k++) { const idx = (base - k + hist.length * 2) % hist.length; yv += w[k] * hist[idx]; }
              pow = pow * 0.995 + v * v * 0.005;
              const e = v - yv, mu = 0.004 / (pow * L + 1e-6);
              for (let k = 0; k < L; k++) { const idx = (base - k + hist.length * 2) % hist.length; w[k] = w[k] * 0.99995 + mu * e * hist[idx]; }
              hp = (hp + 1) % hist.length; v = e;
            }
          }
          /* NR on a block basis: every H samples one frame; the output is delayed N samples (also in bypass, so A/B stays in time) */
          inBuf[inN++] = v;
          if (inN === N) {
            frames++;
            for (let i = 0; i < N; i++) { re[i] = inBuf[i] * win[i]; im[i] = 0; }
            if (o.nr !== 'off' && !o.bypass) {
              fft(false);
              for (let k = 0; k < B; k++) {
                const P = re[k] * re[k] + im[k] * im[k];
                ps[k] = frames < 3 ? P : ps[k] * 0.7 + P * 0.3;
                if (frames < 20) noise[k] = frames === 1 ? ps[k] : Math.min(noise[k] * 1.05, ps[k] + noise[k] * 0.5);   /* start: learn the floor fast */
                else if (ps[k] < noise[k]) noise[k] = noise[k] * 0.8 + ps[k] * 0.2; else noise[k] *= 1.003;              /* down at once, up ~3 dB a second */
                const nk = noise[k] * o.over + 1e-12, post = P / nk, prio = 0.98 * (gPrev[k] * gPrev[k] * pPrev[k]) / nk + 0.02 * Math.max(post - 1, 0);
                g[k] = Math.max(o.floor, prio / (1 + prio)); pPrev[k] = P;
              }
              for (let k = 0; k < B; k++) gs[k] = (g[Math.max(0, k - 1)] + 2 * g[k] + g[Math.min(B - 1, k + 1)]) / 4;
              for (let k = 0; k < B; k++) { gPrev[k] = gs[k]; re[k] *= gs[k]; im[k] *= gs[k]; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
              fft(true);
            }
            for (let i = 0; i < N; i++) outAcc[i] += re[i] * win[i];
            for (let i = 0; i < H; i++) { ring[rw] = outAcc[i]; rw = (rw + 1) % RB; rc++; }
            outAcc.copyWithin(0, H); outAcc.fill(0, N - H);
            inBuf.copyWithin(0, H); inN = N - H;
          }
          if (rc > H) { y[n] = ring[rr]; rr = (rr + 1) % RB; rc--; } else y[n] = 0;
        }
        return y;
      }
    };
    return self;
  }

  /* the worklet: NRCore on the audio thread, settings by message */
  const WORKLET = `${NRCore.toString()}
class KpcNr extends AudioWorkletProcessor {
  constructor(o) { super(); this.core = NRCore(sampleRate); this.core.set((o && o.processorOptions) || {}); this.port.onmessage = e => this.core.set(e.data); }
  process(inputs, outputs) { const i = inputs[0] && inputs[0][0], o = outputs[0] && outputs[0][0]; if (!o) return true; if (!i) { o.fill(0); return true; } this.core.process(i, o); for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(o); return true; }
}
registerProcessor('kpc-nr', KpcNr);`;
  let URLW = null; const READY = new WeakSet(), LIVE = new Set();
  async function prepare(ctx) {
    if (!ctx || !ctx.audioWorklet || READY.has(ctx)) return READY.has(ctx);
    try { if (!URLW) URLW = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })); await ctx.audioWorklet.addModule(URLW); READY.add(ctx); return true; } catch (e) { return false; }
  }
  const FILT = { off: [20, 20000], voice: [250, 2800], cw: [null, null], wide: [100, 3500] };
  function edges() { if (S.filt === 'cw') { const p = +S.pitch || 600; return [Math.max(100, p - 250), p + 250]; } return FILT[S.filt] || FILT.off; }
  function params() { return { nr: S.nr, nb: !!S.nb, notch: !!S.notch && S.filt !== 'cw', bypass: !!S.bypass }; }
  /* a chain in this AudioContext: {input, output}. With the worklet when the module is loaded (prepare), else the filter alone. */
  function chain(ctx) {
    const mk = (type, f) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 0.707; return b; };
    const [lo, hi] = edges(), bq = [mk('highpass', lo), mk('highpass', lo), mk('highpass', lo), mk('lowpass', hi), mk('lowpass', hi), mk('lowpass', hi)];   /* 3 + 3 stages: 36 dB an octave */
    for (let i = 0; i < bq.length - 1; i++) bq[i].connect(bq[i + 1]);
    const l2 = bq[bq.length - 1]; let out = l2, node = null;
    if (READY.has(ctx)) { try { node = new AudioWorkletNode(ctx, 'kpc-nr', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', processorOptions: params() }); l2.connect(node); out = node; } catch (e) { node = null; } }
    const c = { ctx, input: bq[0], output: out, node, bq };
    LIVE.add(c); return c;
  }
  function apply() {
    const [lo, hi] = S.bypass ? [20, 20000] : edges();
    for (const c of LIVE) {
      if (c.ctx.state === 'closed') { LIVE.delete(c); continue; }
      const t = c.ctx.currentTime; c.bq.forEach((b, i) => b.frequency.setTargetAtTime(i < 3 ? lo : hi, t, 0.02));
      if (c.node) c.node.port.postMessage(params());
    }
  }
  function set(p) { Object.assign(S, p || {}); save(); apply(); draw(); }
  const active = () => !S.bypass && (S.nr !== 'off' || S.nb || S.notch || S.filt !== 'off');

  /* ======================================================================== the controls: STATION → Sound (under 🔊 HEAR THE RADIO HERE) + the RADIO screen */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function html(id, ext) {
    const ch = (k, v, t) => `<button type="button" class="chip${S[k] === v ? ' on' : ''}" data-nrk="${k}" data-nrv="${esc(v)}">${t}</button>`;
    const tg = (k, t) => `<button type="button" class="chip${S[k] ? ' on' : ''}" data-nrt="${k}">${t}</button>`;
    return `<div class="nrbox" id="${id}"${ext ? ' data-nr-ext="1"' : ''}><div class="nrh">🎚 WHAT YOU HEAR HERE <small>${ext ? '(only what you hear; FT8 and the other decoders always get the untouched sound)' : '(speakers + the phone on the remote link; never the decoders)'}</small></div>
      <div class="nrrow"><span>NOISE REDUCTION</span>${ch('nr', 'off', 'OFF')}${ch('nr', 'light', 'LIGHT')}${ch('nr', 'medium', 'MEDIUM')}${ch('nr', 'strong', 'STRONG')}</div>
      <div class="nrrow"><span>FILTER</span>${ch('filt', 'off', 'OFF')}${ch('filt', 'voice', 'VOICE')}${ch('filt', 'cw', 'CW')}${ch('filt', 'wide', 'WIDE')}</div>
      <div class="nrrow"><span>MORE</span>${tg('nb', 'BLANKER')}${tg('notch', 'AUTO-NOTCH')}<button type="button" class="chip nrab${S.bypass ? ' on' : ''}" data-nrt="bypass">${S.bypass ? 'B: ALL OFF' : 'A/B'}</button></div>
      ${S.notch && S.filt === 'cw' ? '<p class="hint">Auto-notch is off with the CW filter: it would take the CW out.</p>' : ''}</div>`;
  }
  function draw() {
    const lv = $('stLevels'); if (lv && !$('stNr')) lv.insertAdjacentHTML('afterend', html('stNr')); else if ($('stNr')) $('stNr').outerHTML = html('stNr');
    const rd = $('rdTalk'); if (rd && !$('rdNr')) rd.insertAdjacentHTML('beforebegin', html('rdNr')); else if ($('rdNr')) $('rdNr').outerHTML = html('rdNr');
    document.querySelectorAll('.nrbox[data-nr-ext]').forEach(b => { b.outerHTML = html(b.id, true); });   /* Nov 7: boxes other pages put in (the website's Hunters Lounge) */
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-nrk],[data-nrt]'); if (!b) return;
    if (b.dataset.nrk) set({ [b.dataset.nrk]: b.dataset.nrv }); else set({ [b.dataset.nrt]: !S[b.dataset.nrt] });
    const A = G.KPCApp, mon = A && A.S && A.S.mon;
    if (A && !mon && !(G.KPCRemote && KPCRemote.base && KPCRemote.clients && KPCRemote.clients().length) && !draw.said) { draw.said = true; A.toast('🎚 This changes what you hear through the app: turn on 🔊 HEAR THE RADIO HERE (STATION → Sound), or listen on the phone over the remote link.', 5000); }
  });
  let tries = 0; const boot = () => { if (!G.KPCApp) { if (++tries < 50) setTimeout(boot, 200); return; }   /* Nov 7: on a website page with no app, stop looking after 10 s */ draw(); KPCApp.on('screen', n => { if (n === 'station' || n === 'radio') setTimeout(draw, 60); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  G.KPCNR = { S, set, prepare, chain, apply, active, params, edges, NRCore, draw, html, _live: () => LIVE.size };
})(window);
