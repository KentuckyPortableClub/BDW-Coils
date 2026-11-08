/* KPC app: MORE RADIO CONTROLS (Opus, Nov 6; Brandon: 'will the program still let the user change settings like nb, nr, shift, notch etc
   on the radio … is there a way to trigger the radio's tune for mismatch (swr)?' and 'make sure you do all the options for more radios than I own').
   - 🎛 MORE CONTROLS card on the RADIO screen: IF SHIFT / PBT, NR + NB level, AGC, ATT, PRE / IPO, CONTOUR, APF, MANUAL NOTCH (+ where),
     SPLIT, A ⇄ B, A = B, RIT / XIT + offset, keyer speed, break-in. Only what THIS radio takes over CAT shows (KPCCat.caps()).
     A radio nobody has tried yet with KPC says so ('not checked on a real radio yet').
   - 📍 BAND MEMORY: each band remembers its last frequency, mode and filter; a band button on the RADIO screen goes back there.
   - 🔧 TUNE ASKS FIRST: the radio's tuner only runs after a YES (it transmits a carrier). Never on its own.
   - ⚠ SWR GUARD: while transmitting, an SWR over the limit (2 reads in a row) warns, or lowers the power to 25 %, or stops transmitting.
   - 📊 a slim BAND STRIP on the DIGI screen (who is where on this band: spots + skimmers; the IC-7300 / 705 / 9700 / 7610 / 905 RF scope under it).
   Settings: localStorage kpcAppRigX; band memory kpcAppBandMem. */
(function (G) {
  'use strict';
  const AP = G.KPCApp, $ = id => document.getElementById(id); if (!AP || !G.KPCCat) return;
  const K = G.KPCCat, esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const X = Object.assign({ shift: 0, nrl: 50, nbl: 50, agc: '', att: 0, pre: 0, contour: 0, apf: 0, mnotch: 0, mnotchf: 1000, split: 0, rit: 0, xit: 0, ritoff: 0, ritstep: 50, keyspd: 22, bkin: 0,
    bandMem: true, tuneAsk: true, swrMax: 3, swrAct: 'warn', dgStrip: true, open: true }, LS('kpcAppRigX', {}));
  const save = () => SV('kpcAppRigX', X);
  const BM = LS('kpcAppBandMem', {});
  const AGCL = { off: 'OFF', fast: 'FAST', mid: 'MID', slow: 'SLOW', auto: 'AUTO' };

  /* ================================================================ 🎛 MORE CONTROLS
     One panel builder, two users: the RADIO screen here (pre 'rx', talks to this device's radio) and the phone's REMOTE screen
     (pre 'rmx', kpc-remote.js: the PC's radio, its caps + the values come in the PC's state, taps go back as {t:'rx'}). */
  function cardHtml(pre, cid, local, open) {
    const I = n => pre + n;
    return `<details class="card rdmore" id="${cid}"${open ? ' open' : ''}><summary><h2>🎛 More controls <span class="cxsub" id="${I('Tested')}"></span></h2></summary>
      <div class="rxg" data-k="shift"><label class="e slide">IF SHIFT <b id="${I('ShiftT')}"></b><input type="range" id="${I('Shift')}" min="-1200" max="1200" step="20"></label><button type="button" class="chip" data-x0="shift">CENTER</button></div>
      <div class="rxg" data-k="nrl"><label class="e slide">NR LEVEL <b id="${I('NrlT')}"></b><input type="range" id="${I('Nrl')}" min="0" max="100" step="5"></label></div>
      <div class="rxg" data-k="nbl"><label class="e slide">NB LEVEL <b id="${I('NblT')}"></b><input type="range" id="${I('Nbl')}" min="0" max="100" step="10"></label></div>
      <div class="rxg" data-k="agc"><span class="kv"><i>AGC</i></span><span class="chips" id="${I('Agc')}"></span></div>
      <div class="rxg" data-k="att"><span class="kv"><i>ATT</i></span><span class="chips" id="${I('Att')}"></span></div>
      <div class="rxg" data-k="pre"><span class="kv"><i>PRE</i></span><span class="chips" id="${I('Pre')}"></span></div>
      <div class="btns rxtog"><button type="button" class="b" data-xt="contour">CONTOUR</button><button type="button" class="b" data-xt="apf">APF (CW)</button><button type="button" class="b" data-xt="mnotch">MANUAL NOTCH</button></div>
      <div class="rxg" data-k="mnotchf"><label class="e slide">NOTCH AT <b id="${I('MnfT')}"></b><input type="range" id="${I('Mnf')}" min="200" max="3000" step="10"></label></div>
      <h3 class="rxh" data-k="vfo">VFO</h3>
      <div class="btns rxtog"><button type="button" class="b" data-xt="split">SPLIT</button><button type="button" class="b" data-xo="swap">A ⇄ B</button><button type="button" class="b" data-xo="ab">A = B</button></div>
      <div class="btns rxtog"><button type="button" class="b" data-xt="rit">RIT</button><button type="button" class="b" data-xt="xit">XIT</button></div>
      <div class="rxg" data-k="ritoff"><span class="kv"><i>OFFSET</i><b id="${I('RitT')}">0 Hz</b></span><button type="button" class="chip" data-xr="-1">−</button><button type="button" class="chip" data-xr="1">+</button><span class="chips" id="${I('RitS')}"></span><button type="button" class="chip" data-xr="0">CLEAR</button></div>
      <h3 class="rxh" data-k="cw">CW</h3>
      <div class="rxg" data-k="keyspd"><label class="e slide">KEYER SPEED <b id="${I('WpmT')}"></b><input type="range" id="${I('Wpm')}" min="6" max="48" step="1"></label></div>
      <div class="rxg" data-k="bkin"><span class="kv"><i>BREAK-IN</i></span><span class="chips" id="${I('Bk')}"></span></div>
      ${local ? `<h3 class="rxh">Safety &amp; memory</h3>
      <div class="grid2"><label class="e">SWR LIMIT<select id="rxSwr"><option value="2">2 : 1</option><option value="2.5">2.5 : 1</option><option value="3">3 : 1</option><option value="0">off</option></select></label>
        <label class="e">WHEN THE SWR IS OVER IT<select id="rxSwrA"><option value="warn">warn me</option><option value="power">warn + power to 25 %</option><option value="stop">warn + stop transmitting</option></select></label></div>
      <label class="tog"><input type="checkbox" id="rxTune"> Ask before 🔧 TUNE (it transmits a carrier)</label>
      <label class="tog"><input type="checkbox" id="rxMem"> 📍 Band memory: a band button goes back to that band's last frequency, mode and filter</label>
      <label class="tog"><input type="checkbox" id="rxStrip"> 📊 Band strip on the DIGI screen</label>
      <div class="row"><button type="button" class="b" id="rxWorks">📝 WORKS ON MY RADIO</button><button type="button" class="b" id="rxGuide">📖 SETUP GUIDE</button></div>` : ''}
      <p class="hint" id="${I('None')}"></p></details>`;
  }
  /* src: { x() → the values, set(k, v) → remember, send(k, v, label), caps() → {keys, agc, att, pre, proto}, can(k), tested() → text, none() → text } */
  function panel(host, where, pre, cid, src, local) {
    if ($(cid) || !host) return null;
    host.insertAdjacentHTML(where, cardHtml(pre, cid, local, local ? X.open : false));
    const root = $(cid), I = n => $(pre + n);
    if (local) root.addEventListener('toggle', () => { X.open = root.open; save(); });
    const P = { root, draw: () => drawP() };
    const slide = (id, k, fmt) => { const r = I(id); r.oninput = () => { I(id + 'T').textContent = fmt(+r.value); }; r.onchange = () => { src.set(k, +r.value); src.send(k, +r.value); }; };
    const fS = v => (v > 0 ? '+' : '') + v + ' Hz', fP = v => v + ' %', fH = v => v + ' Hz', fW = v => v + ' wpm';
    slide('Shift', 'shift', fS); slide('Nrl', 'nrl', fP); slide('Nbl', 'nbl', fP); slide('Mnf', 'mnotchf', fH); slide('Wpm', 'keyspd', fW);
    root.addEventListener('click', e => {
      const x = src.x();
      const z = e.target.closest('[data-x0]'); if (z) { src.set('shift', 0); src.send('shift', 0); drawP(); return; }
      const t = e.target.closest('[data-xt]'); if (t) { const k = t.dataset.xt, v = x[k] ? 0 : 1; src.set(k, v); drawP(); src.send(k, v); return; }
      const o = e.target.closest('[data-xo]'); if (o) { src.send(o.dataset.xo, 1, o.dataset.xo === 'swap' ? 'A ⇄ B' : 'A = B'); return; }
      const c = e.target.closest('[data-xc]'); if (c) { const [k, v] = c.dataset.xc.split(':'), val = k === 'agc' ? v : +v; src.set(k, val); drawP(); src.send(k, val); return; }
      const r = e.target.closest('[data-xr]'); if (r) { const d = +r.dataset.xr, v = d === 0 ? 0 : Math.max(-9990, Math.min(9990, (+x.ritoff || 0) + d * (+x.ritstep || 50))); src.set('ritoff', v); drawP(); src.send('ritoff', v); return; }
      const s = e.target.closest('[data-xs]'); if (s) { src.set('ritstep', +s.dataset.xs, true); drawP(); }
    });
    function drawP() {
      const x = src.x(), C = src.caps() || { keys: [] }, can = k => src.can(k);
      root.querySelectorAll('[data-k]').forEach(el => { const k = el.dataset.k; el.hidden = k === 'vfo' ? !['split', 'swap', 'ab', 'rit', 'xit'].some(can) : k === 'cw' ? !['keyspd', 'bkin'].some(can) : !can(k); });
      root.querySelectorAll('[data-xt]').forEach(b => { const k = b.dataset.xt; b.hidden = !can(k); b.classList.toggle('on', !!x[k]); b.textContent = b.textContent.replace(/ (ON|OFF)$/, '') + (x[k] ? ' ON' : ' OFF'); });
      root.querySelectorAll('[data-xo]').forEach(b => { b.hidden = !can(b.dataset.xo); });
      root.querySelectorAll('.rxtog').forEach(r => { r.hidden = ![...r.children].some(b => !b.hidden); });
      const setR = (id, v, f) => { const r = I(id); if (document.activeElement !== r) { r.value = v; I(id + 'T').textContent = f(+v); } };
      setR('Shift', x.shift || 0, fS); setR('Nrl', x.nrl, fP); setR('Nbl', x.nbl, fP); setR('Mnf', x.mnotchf, fH); setR('Wpm', x.keyspd, fW);
      const yae = C.proto === 'yaesu' || C.proto === 'yaesu8';
      I('Agc').innerHTML = (C.agc || []).map(a => `<button type="button" class="chip${x.agc === a ? ' on' : ''}" data-xc="agc:${a}">${AGCL[a]}</button>`).join('');
      I('Att').innerHTML = (C.att || []).map(d => `<button type="button" class="chip${+x.att === d ? ' on' : ''}" data-xc="att:${d}">${d ? (C.att.length === 2 && C.proto !== 'hamlib' ? 'ON' : d + ' dB') : 'OFF'}</button>`).join('');
      I('Pre').innerHTML = (C.pre || []).map(n => `<button type="button" class="chip${+x.pre === n ? ' on' : ''}" data-xc="pre:${n}">${n === 0 ? (yae ? 'IPO' : 'OFF') : (C.pre.length === 2 ? 'ON' : (yae ? 'AMP ' : 'P.AMP ') + n)}</button>`).join('');
      I('Bk').innerHTML = (C.proto === 'icom' || C.proto === 'hamlib' || C.proto === 'fake' ? [0, 1, 2] : [0, 1]).map(n => `<button type="button" class="chip${+x.bkin === n ? ' on' : ''}" data-xc="bkin:${n}">${['OFF', 'SEMI', 'FULL'][n]}</button>`).join('');
      I('RitT').textContent = fS(+x.ritoff || 0);
      I('RitS').innerHTML = [10, 50, 100, 500].map(s => `<button type="button" class="chip${+x.ritstep === s ? ' on' : ''}" data-xs="${s}">${s}</button>`).join('');
      I('Tested').textContent = src.tested(); I('None').textContent = src.none(C);
    }
    P.draw(); return P;
  }
  /* what the PC's state carries for the phone (kpc-remote.js baseState → rx) */
  const RXK = ['shift', 'nrl', 'nbl', 'agc', 'att', 'pre', 'contour', 'apf', 'mnotch', 'mnotchf', 'split', 'rit', 'xit', 'ritoff', 'ritstep', 'keyspd', 'bkin'];
  function testedTxt() { const C = K.caps ? K.caps() : {}, r = K.RADIO && K.RADIO[K.get().radio];
    return C.proto === 'fake' ? '· pretend radio' : C.proto === 'hamlib' ? '· through Hamlib' : C.tested ? '· ✓ checked on a real ' + (r ? r.label : 'radio') : r ? '· ' + r.label + ': not checked on a real radio yet' : ''; }
  function remoteState() {
    if (!K.connected()) return null; const C = K.caps(), ex = K.extras ? K.extras() : [], x = {}; RXK.forEach(k => { x[k] = X[k]; });
    return { caps: { keys: C.keys.filter(k => ex.includes(k)), agc: C.agc, att: C.att, pre: C.pre, proto: C.proto }, x, tested: testedTxt(), swr: { max: X.swrMax, act: X.swrAct } };
  }
  /* the phone asked (kpc-remote.js on the PC): same rules as a tap here */
  function remoteSet(k, v) {
    const C = remoteState(); if (!C) return Promise.resolve({ ok: false, msg: 'The radio is not connected on the PC.' });
    if (k === 'ritstep') { X.ritstep = +v || 50; save(); return Promise.resolve({ ok: true, quiet: true }); }
    if (!C.caps.keys.includes(k)) return Promise.resolve({ ok: false, msg: 'This radio does not take ' + (LBL[k] || k) + ' over CAT.' });
    if (AP.txing() && !['keyspd', 'bkin'].includes(k)) return Promise.resolve({ ok: false, msg: 'The radio is transmitting: not now.' });
    if (RXK.includes(k)) { X[k] = k === 'agc' ? String(v) : +v; save(); }
    return K.extra(k, k === 'agc' ? String(v) : +v).then(ok => { if (L) L.draw(); return { ok, msg: ok ? '' : 'The radio did not take ' + (LBL[k] || k) + ' over CAT.' }; });
  }
  let L = null;
  function mount() {
    if (L || !$('rdOn')) return;
    const at = document.querySelector('#rdOn .rdgrid'); if (!at) return;
    L = panel(at, 'afterend', 'rx', 'rdMore', {
      x: () => X, set: (k, v) => { X[k] = v; save(); }, send: (k, v, label) => go(k, v, label),
      caps: () => (K.caps ? K.caps() : { keys: [] }), can: k => { const C = K.caps ? K.caps() : { keys: [] }; return C.keys.includes(k) && (K.extras ? K.extras() : []).includes(k); },
      tested: testedTxt, none: C => C.keys.length ? 'Settings you change here are sent to the radio; the radio does not tell the app when you turn its own knobs, so these show what was sent last.' : 'This radio takes none of these over CAT (or pick your radio in STATION → MY RADIO so the app knows which ones it takes).'
    }, true);
    $('rxSwr').onchange = () => { X.swrMax = +$('rxSwr').value; save(); };
    $('rxSwrA').onchange = () => { X.swrAct = $('rxSwrA').value; save(); };
    $('rxTune').onchange = () => { X.tuneAsk = $('rxTune').checked; save(); };
    $('rxMem').onchange = () => { X.bandMem = $('rxMem').checked; save(); };
    $('rxStrip').onchange = () => { X.dgStrip = $('rxStrip').checked; save(); strip(); };
    $('rxWorks').onclick = () => { if (G.KPCHelp) KPCHelp.works(); };
    $('rxGuide').onclick = () => { if (G.KPCHelp) KPCHelp.guide(K.get().radio || ''); };
  }
  const LBL = { shift: 'IF SHIFT', nrl: 'NR LEVEL', nbl: 'NB LEVEL', agc: 'AGC', att: 'ATT', pre: 'PRE', contour: 'CONTOUR', apf: 'APF', mnotch: 'MANUAL NOTCH', mnotchf: 'NOTCH', split: 'SPLIT', rit: 'RIT', xit: 'XIT', ritoff: 'RIT OFFSET', swap: 'A ⇄ B', ab: 'A = B', keyspd: 'KEYER SPEED', bkin: 'BREAK-IN' };
  async function go(k, v, label) {
    if (AP.txing() && !['keyspd', 'bkin'].includes(k)) { AP.toast('Transmitting: change that after.', 2500, 'bad'); return false; }
    const ok = await K.extra(k, v);
    if (!ok) AP.toast('The radio did not take ' + (label || LBL[k] || k) + ' over CAT.', 3000, 'bad');
    else if (label) AP.toast(label + ' sent.', 1500, 'log');
    return ok;
  }
  function draw() {
    if (!L) mount(); if (!L) return;
    L.draw();
    $('rxSwr').value = String(X.swrMax); $('rxSwrA').value = X.swrAct; $('rxTune').checked = !!X.tuneAsk; $('rxMem').checked = !!X.bandMem; $('rxStrip').checked = !!X.dgStrip;
  }

  /* ================================================================ 📍 BAND MEMORY */
  let bmT = 0;
  AP.on('dial', r => { if (!r || !(r.khz > 0) || AP.txing()) return; clearTimeout(bmT); bmT = setTimeout(() => {
    const b = G.KPCLog && KPCLog.band(r.khz); if (!b) return; const ex = LS('kpcRmEx', {});
    BM[b] = { khz: r.khz, mode: r.mode || (BM[b] && BM[b].mode) || '', w: ex.width || 0, t: Date.now() }; SV('kpcAppBandMem', BM); }, 1500); });
  function bandMem(b) { return X.bandMem && BM[b] && BM[b].khz ? Object.assign({}, BM[b]) : null; }

  /* ================================================================ 🔧 TUNE ASKS FIRST + the SWR after it */
  function tuneAsk() {
    if (!K.connected() || !(K.extras && K.extras().includes('atu'))) { AP.toast('This radio has no tuner command over CAT.', 3000, 'bad'); return Promise.resolve(false); }
    if (AP.txing()) { AP.toast('Transmitting now: tune after.', 2500, 'bad'); return Promise.resolve(false); }
    if (!X.tuneAsk) return tuneNow();
    return new Promise(done => {
      AP.sheet('🔧 Tune the antenna?', '<p>The radio\'s own tuner runs now: it <b>transmits a carrier</b> for a few seconds on ' + esc(dialTxt()) + '. Make sure the frequency is clear and the antenna is connected.</p><div class="row"><button type="button" class="b gold" id="rxTuneGo">🔧 YES, TUNE</button><button type="button" class="b" id="rxTuneNo">NOT NOW</button></div>', () => done(false));
      $('rxTuneNo').onclick = () => AP.shut();
      $('rxTuneGo').onclick = async () => { const s = $('sheet'); s.hidden = true; done(await tuneNow()); };
    });
  }
  const dialTxt = () => { const d = (G.KPCLog && KPCLog.dock) || {}; return d.khz ? (d.khz / 1000).toFixed(3) + ' MHz' : 'the radio\'s frequency'; };
  async function tuneNow() {
    const ok = await K.extra('atu', 1);
    if (!ok) { AP.toast('The radio did not take the tune command (does it have a built-in tuner, turned on?).', 4000, 'bad'); return false; }
    AP.toast('🔧 Tuning… watch the SWR.', 3000, 'log');
    let best = null; const t0 = Date.now();
    while (Date.now() - t0 < 8000) { await new Promise(r => setTimeout(r, 700)); const m = G.KPCMeters && KPCMeters.last(); if (m && m.swr != null && m.po > 3) best = best == null ? m.swr : Math.min(best, m.swr); }
    if (best != null && G.KPCMeters) { const s = KPCMeters.swrOf(best); AP.toast('🔧 Tuned: SWR about ' + s.toFixed(1) + ' : 1' + (s > 2 ? ' — still high: check the antenna or try again.' : '.'), 5000, s > 2 ? 'bad' : 'log'); }
    return true;
  }

  /* ================================================================ ⚠ SWR GUARD */
  let hi = 0, acted = false, wasTx = false;
  async function guard() {
    const tx = AP.txing(); if (!tx) { hi = 0; acted = false; wasTx = false; return; }
    if (!wasTx) { wasTx = true; hi = 0; }
    if (!(X.swrMax > 0) || acted || !G.KPCMeters) return;
    const m = KPCMeters.last(); if (!m || m.swr == null || !(m.po > 5) || Date.now() - (m.at || Date.now()) > 3000) return;
    const s = KPCMeters.swrOf(m.swr); hi = s > X.swrMax ? hi + 1 : 0;
    if (hi < 2) return; acted = true;
    const what = X.swrAct === 'stop' ? ' Transmitting stopped.' : X.swrAct === 'power' ? ' Power turned down to 25 %.' : '';
    AP.toast('⚠ HIGH SWR: about ' + s.toFixed(1) + ' : 1.' + what + ' Check the antenna, or 🔧 TUNE.', 8000, 'bad');
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    if (X.swrAct === 'power') { await K.extra('power', 25); }
    if (X.swrAct === 'stop') { document.querySelectorAll('.scr .halt, #scrRadio .halt').forEach(b => { if (b.offsetParent) b.click(); }); if (G.KPCRadio && KPCRadio.talking()) KPCRadio._talkUp(); if (AP.txing()) await AP.pttOn(false); }
    AP.fire('swr-high', { swr: s, act: X.swrAct });
  }
  setInterval(guard, 400);

  /* ================================================================ 📊 DIGI BAND STRIP */
  function strip() {
    const dg = $('scrDigi'); if (!dg || !G.KPCSkim) return;
    let w = $('dgStrip');
    if (!X.dgStrip) { if (w) w.hidden = true; return; }
    if (!w) { const anchor = $('scrDigiMet') || dg.firstElementChild; (anchor || dg).insertAdjacentHTML(anchor ? 'afterend' : 'afterbegin', '<div class="dgstrip" id="dgStrip"><canvas id="dgStripCv" title="Who is where on this band: tap a call to go there"></canvas></div>'); w = $('dgStrip'); }
    w.hidden = false;
    if (document.body.dataset.screen === 'digi') { KPCSkim.mountMap($('dgStripCv'), null, { follow: true, slim: true }); }
  }
  AP.on('screen', s => { if (s === 'radio') { mount(); draw(); } if (s === 'digi') strip(); });
  AP.on('key', () => { if (document.body.dataset.screen === 'radio') draw(); });
  setInterval(() => { if (document.body.dataset.screen === 'radio') draw(); }, 4000);
  mount();

  G.KPCRigX = { X, save, draw, go, bandMem, BM, tuneAsk, tuneNow, strip, panel, remoteState, remoteSet, RXK, _guard: guard };
})(window);
