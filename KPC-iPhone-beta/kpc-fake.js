/* KPC app: THE PRETEND RADIO + PRETEND SOUND (Fable, Oct 22). With it on (STATION → Alerts & help, or ?fake=1) the app
   runs end to end with no cable: the sound card is a made-up band with FT8 stations calling CQ POTA (and answering you),
   an APRS beacon now and then, TUNE/TX 'go out' and come back, and the radio link is a pretend FT-710 that takes every
   command. For Brandon on a phone with no radio handy, and for the automated tests. Never on by itself. */
(function (G) {
  'use strict';
  let on = false; try { if (/[?&]fake=1/.test(location.search)) localStorage.setItem('kpcFake', '1'); if (/[?&]fake=0/.test(location.search)) localStorage.removeItem('kpcFake'); on = localStorage.getItem('kpcFake') === '1'; } catch (e) {}
  G.KPCFake = { on, calls: ['Q4ABC', 'Q4XYZ', 'Q4POT', 'Q4HNT', 'Q4FLD', 'Q4RPL'], grids: ['EM77', 'EM78', 'EM79', 'EM66', 'EN91', 'FM19'] };
  if (!on || !G.KPCNative) return;
  const N = G.KPCNative, A = N.audio, RATE = 48000, R12 = 12000;
  let ENG = null, cb = null, tick = null, t0 = 0, n12 = 0, slotBuf = null, slotT0 = 0, txUntil = 0;
  const rnd = (a, b) => a + Math.random() * (b - a), pick = L => L[Math.floor(Math.random() * L.length)];
  const myCall = () => { try { return (G.KPCApp && KPCApp.myCall()) || ''; } catch (e) { return ''; } };
  async function engine() { if (!ENG && G.KPCFT8) { try { ENG = await KPCFT8.load('kpc-ft8.wasm?v=20261017a'); } catch (e) { ENG = null; } } return ENG; }
  /* one FT8 slot (15 s at 12 kHz) with 2-4 stations in it; now and then one of them calls ME */
  function makeSlot(ft4) {
    const len = Math.round((ft4 ? 7.5 : 15) * R12), out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = (Math.random() - 0.5) * 0.03;
    if (!ENG) return out;
    const me = myCall(), n = 2 + Math.floor(Math.random() * 3), msgs = [];
    for (let i = 0; i < n; i++) { const c = pick(G.KPCFake.calls), g = pick(G.KPCFake.grids); msgs.push(Math.random() < 0.6 ? 'CQ POTA ' + c + ' ' + g : 'CQ ' + c + ' ' + g); }
    if (me && /^[A-Z0-9]{0,2}[0-9][A-Z]{1,3}$/.test(me) && Math.random() < 0.35) msgs.push(me + ' ' + pick(G.KPCFake.calls) + ' ' + pick(G.KPCFake.grids));
    for (const m of msgs) {
      let tones; try { tones = ENG.tones(m, ft4); } catch (e) { tones = null; } if (!tones) continue;
      const f0 = rnd(400, 2500), sig = KPCFT8.synth(tones, f0, R12, ft4), amp = rnd(0.05, 0.3), off = Math.round(rnd(0.2, 0.9) * R12);
      for (let i = 0; i < sig.length && off + i < len; i++) out[off + i] += sig[i] * amp;
    }
    return out;
  }
  let aprsAt = 0;
  function aprsBurst(buf, at) {                           /* an APRS beacon from a pretend station nearby, every ~45 s */
    if (!G.KPCAX25 || Date.now() < aprsAt) return;
    aprsAt = Date.now() + 45000;
    const X = G.KPCAX25, la = 37.5 + rnd(-0.3, 0.3), lo = -85.25 + rnd(-0.4, 0.4), c = pick(G.KPCFake.calls) + '-' + pick([7, 9, 5]);
    const fr = X.build({ dest: 'APZKPC', src: c, path: ['WIDE1-1'], info: X.posText(la, lo, pick(['\\;', '/>', '/[']), Math.random() < 0.5 ? 'US-' + String(Math.floor(rnd(100, 9999))).padStart(4, '0') + ' KPC test' : 'pretend station') });
    const s48 = X.modulate(fr, RATE, 1200, 1200, 2200), s = new Float32Array(Math.floor(s48.length / 4)); for (let i = 0; i < s.length; i++) s[i] = s48[i * 4] * 0.4;
    for (let i = 0; i < s.length && at + i < buf.length; i++) buf[at + i] += s[i];
  }
  async function start(o, onRx) { A.session = (A.session || 0) + 1;
    await engine(); cb = onRx; t0 = Date.now(); n12 = 0; slotBuf = null;
    clearInterval(tick);
    tick = setInterval(() => {
      if (!cb) return;
      const now = Date.now(), want = Math.floor((now - t0) / 1000 * R12), chunk = 1200;
      while (n12 + chunk <= want) {
        const ft4 = !!(G.KPCDigi && KPCDigi.mode() === 'FT4'), slotLen = (ft4 ? 7.5 : 15) * 1000, tAbs = t0 + n12 / R12 * 1000, slotStart = Math.floor(tAbs / slotLen) * slotLen;
        if (!slotBuf || slotT0 !== slotStart) { slotT0 = slotStart; slotBuf = makeSlot(ft4); aprsBurst(slotBuf, Math.round(rnd(0, 5) * R12)); }
        const off = Math.round((tAbs - slotStart) / 1000 * R12), pcm = new Float32Array(chunk);
        for (let i = 0; i < chunk; i++) pcm[i] = slotBuf[(off + i) % slotBuf.length] || 0;
        const txing = now < txUntil; let sum = 0; for (let i = 0; i < chunk; i++) sum += pcm[i] * pcm[i];
        try { cb({ pcm, t: tAbs, db: Math.round(10 * Math.log10(sum / chunk + 1e-9) * 10) / 10, peak: 0.3, tx: txing }); } catch (e) {}
        n12 += chunk;
      }
    }, 100);
    return { ok: true, source: 'fake', latencyMs: 20, rate: R12 };
  }
  async function stop() { cb = null; clearInterval(tick); tick = null; }
  function play(pcm, atMs, id) { return new Promise(res => { const ms = pcm.length / RATE * 1000, wait = atMs ? Math.max(0, atMs - Date.now()) : 0; txUntil = Date.now() + wait + ms; A.txing = true; if (A.onTx) A.onTx({ state: 'start', id }); setTimeout(() => { A.txing = false; const ev = { state: txUntil ? 'end' : 'stopped', id }; if (A.onTx) A.onTx(ev); res(ev); }, wait + ms); }); }
  function tone(hz, seconds, id) { return play(new Float32Array(Math.round((seconds || 10) * RATE)), 0, id || 'tone'); }
  function stopTx() { txUntil = 0; A.txing = false; return Promise.resolve(); }
  Object.assign(A, { native: false, start, stop, play, tone, stopTx, setGain: g => { A.gain = +g || 0; return Promise.resolve(); }, status: () => Promise.resolve({ running: !!tick, txing: Date.now() < txUntil, gain: A.gain, fake: true }),
    devices: async () => ({ inputs: [{ id: 'fake', name: '🧪 Pretend radio sound', usb: true }], outputs: [{ id: 'fake', name: '🧪 Pretend radio sound', usb: true }] }), rxStream: () => null, pipe: () => { const p = { gated: null, lvl: 0, level: db => { p.lvl = +db || 0; }, gate: on => { p.gated = !!on; }, shape: () => {}, stop: () => { p.stopped = true; } }; A._pipes = (A._pipes || 0) + 1; A._lastPipe = p; return p; } });
})(window);
