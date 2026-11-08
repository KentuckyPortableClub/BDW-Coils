/* KPC FT8 / FT4 engine (Brandon Oct 17: the WSJT-X style tab in the KPC Logger).
   kpc-ft8.wasm = ft8_lib by Karlis Goba (MIT license, github.com/kgoba/ft8_lib) built for the browser.
   KPCFT8.load() → engine:
     e.start(ft4)        new slot (FT8 15 s / FT4 7.5 s)
     e.feed(Float32Array) 12 kHz mono audio, any length
     e.decode()          → [{db, dt, hz, text}]
     e.tones(text, ft4)  → Uint8Array of tones, or null when the text can't be sent
     KPCFT8.synth(tones, hz, rate, ft4) → Float32Array audio (GFSK, like WSJT-X) */
(function (G) {
  var FT8 = { sp: 0.16, bt: 2.0, slot: 15 }, FT4 = { sp: 0.048, bt: 1.0, slot: 7.5 };
  function erf(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
  function synth(sym, f0, rate, ft4) {
    var P = ft4 ? FT4 : FT8, n = sym.length, ns = Math.round(rate * P.sp), nw = n * ns, K = 5.336446;
    var pulse = new Float32Array(3 * ns);
    for (var i = 0; i < 3 * ns; i++) { var t = i / ns - 1.5; pulse[i] = (erf(K * P.bt * (t + 0.5)) - erf(K * P.bt * (t - 0.5))) / 2; }
    var dpk = 2 * Math.PI / ns, base = 2 * Math.PI * f0 / rate, dphi = new Float32Array(nw + 2 * ns).fill(base);
    for (i = 0; i < n; i++) { var ib = i * ns; for (var j = 0; j < 3 * ns; j++) dphi[j + ib] += dpk * sym[i] * pulse[j]; }
    for (j = 0; j < 2 * ns; j++) { dphi[j] += dpk * pulse[j + ns] * sym[0]; dphi[j + n * ns] += dpk * pulse[j] * sym[n - 1]; }
    var out = new Float32Array(nw), ph = 0;
    for (var k = 0; k < nw; k++) { out[k] = Math.sin(ph); ph = (ph + dphi[k + ns]) % (2 * Math.PI); }
    var nr = Math.max(1, Math.floor(ns / 8));
    for (i = 0; i < nr; i++) { var e = (1 - Math.cos(2 * Math.PI * i / (2 * nr))) / 2; out[i] *= e; out[nw - 1 - i] *= e; }
    return out;
  }
  function load(url) {
    url = url || 'kpc-ft8.wasm?v=20261017a';
    var M = Math;
    var imp = { env: { cos: M.cos, sin: M.sin, sinf: M.sin, cosf: M.cos, log10f: M.log10, expf: M.exp, exit: function () { throw new Error('ft8 exit'); } } };
    /* Oct 22 (Brandon: 'Windows: FT8 not decoding'): the Windows app opens its page from a file, and a web page may not fetch() a file,
       so the decoder never loaded there. The app's own bridge (window.kpcNet.asset) reads it from disk instead. */
    var viaApp = function () { if (typeof window !== 'undefined' && window.kpcNet && window.kpcNet.asset) return window.kpcNet.asset(url.split('?')[0]).then(function (b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return WebAssembly.instantiate(u.buffer, imp); }); return Promise.reject(new Error('no app bridge')); };
    var isFile = typeof location !== 'undefined' && location.protocol === 'file:';
    /* Oct 24: the decoder bytes also travel inside kpc-ft8-wasm.js (window.KPC_FT8_WASM_B64), so no file/fetch rules can stop it loading */
    var viaText = function () { var b64 = typeof window !== 'undefined' && window.KPC_FT8_WASM_B64; if (!b64) return Promise.reject(new Error('no embedded wasm')); var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return WebAssembly.instantiate(u.buffer, imp).then(function (r) { load.how = 'embedded'; return r; }); };
    var go0 = isFile ? viaApp().catch(function () { return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return WebAssembly.instantiate(b, imp); }); })
      : (WebAssembly.instantiateStreaming && typeof fetch === 'function' && typeof window !== 'undefined')
      ? WebAssembly.instantiateStreaming(fetch(url), imp).catch(function () { return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return WebAssembly.instantiate(b, imp); }); }).catch(viaApp)
      : (typeof fetch === 'function' && typeof window !== 'undefined' ? fetch(url).then(function (r) { return r.arrayBuffer(); }) : Promise.resolve(require('fs').readFileSync(url.split('?')[0]))).then(function (b) { return WebAssembly.instantiate(b, imp); });
    var go = viaText().catch(function (e1) { return go0.then(function (r) { load.how = load.how || (isFile ? 'app bridge / fetch' : 'fetch'); return r; }).catch(function (e2) { load.err = String((e1 && e1.message) || e1) + ' | ' + String((e2 && e2.message) || e2); throw e2; }); });
    return go.then(function (r) {
      var x = r.instance.exports, bs = 0, ft4 = 0, pend = new Float32Array(0);
      var mem = function () { return x.memory.buffer; };
      var e = {
        start: function (f4) { ft4 = f4 ? 1 : 0; bs = x.kft_init(ft4); x.kft_reset(); pend = new Float32Array(0); return bs; },
        feed: function (a) {
          if (!bs) e.start(ft4);
          var all = new Float32Array(pend.length + a.length); all.set(pend); all.set(a, pend.length);
          var o = 0, inp = x.kft_in();
          while (all.length - o >= bs) { new Float32Array(mem(), inp, bs).set(all.subarray(o, o + bs)); x.kft_block(); o += bs; }
          pend = all.slice(o);
        },
        blocks: function () { return x.kft_blocks(); },
        decode: function (minScore, iters) {
          var n = x.kft_decode(minScore || 10, iters || 25), nums = new Float32Array(mem(), x.kft_nums(), n * 3), tx = new Uint8Array(mem(), x.kft_texts(), n * 40), out = [];
          for (var i = 0; i < n; i++) {
            var s = ''; for (var j = 0; j < 40; j++) { var c = tx[i * 40 + j]; if (!c) break; s += String.fromCharCode(c); }
            /* score → rough dB like WSJT-X (calibrated against test signals, Oct 17) */
            out.push({ db: Math.max(-30, Math.min(30, Math.round(nums[i * 3]))), dt: Math.round((nums[i * 3 + 1] - 0.6) * 10) / 10, hz: Math.round(nums[i * 3 + 2]), text: s.trim() });
          }
          return out;
        },
        tones: function (text, f4) {
          var b = new Uint8Array(mem(), x.kft_txt(), 64), s = String(text || '').toUpperCase().trim().slice(0, 37);
          for (var i = 0; i < 64; i++) b[i] = i < s.length ? s.charCodeAt(i) : 0;
          var n = x.kft_encode(f4 ? 1 : 0); if (n <= 0) return null;
          return new Uint8Array(mem(), x.kft_tones(), n).slice();
        }
      };
      return e;
    });
  }
  G.KPCFT8 = { load: load, synth: synth, FT8: FT8, FT4: FT4 };
  if (typeof module !== 'undefined') module.exports = G.KPCFT8;
})(typeof window !== 'undefined' ? window : globalThis);
