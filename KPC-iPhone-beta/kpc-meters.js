/* KPC app: THE RADIO'S METERS (Opus, Oct 26; Brandon Oct 25: 'add S meter and selectable digital and analog meters').
   One widget, used on the PC / phone with a radio (a 📟 METERS bar on the LOG and DIGI screens) and on the REMOTE tab:
     ANALOG  = needle dials like the radio's own meter (gold on dark, a peak-hold tick on the S meter, the needle eases, red zones)
     DIGITAL = bars with numbers (the 0.6.11 look)
   Which meters show is picked in its ⚙ (S, PWR OUT, ALC, SWR, COMP, IDD, VDD: a meter the radio does not give stays hidden).
   Values come from KPCCat.meters() (Fable): s = dB over S9 (S9 = 0, S1 = −48), the rest 0–100 % of the radio's own scale, pwr = RF power set.
   Settings in localStorage kpcAppMeters {style, show[], open}. KPCMeters.mount(el) → {set(m)}; KPCMeters.feed(m) = new readings for all. */
(function (G) {
  'use strict';
  const AP = G.KPCApp, $ = id => document.getElementById(id), esc = AP && AP.esc;
  if (!AP) return;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const S = Object.assign({ style: 'analog', show: ['s', 'po', 'alc', 'swr'], open: !(G.matchMedia && matchMedia('(max-width: 600px)').matches) }, LS('kpcAppMeters', {}));   /* a phone starts folded */
  const save = () => { try { localStorage.setItem('kpcAppMeters', JSON.stringify(S)); } catch (e) {} };
  /* each meter: label, scale (value → 0..1 of the arc), ticks, red-zone start (0..1), how to print it */
  const sTxt = v => v == null ? '—' : v <= 0 ? 'S' + Math.max(0, Math.min(9, Math.round(9 + v / 6))) : 'S9+' + Math.round(v);
  const swrOf = v => v <= 0 ? 1 : v <= 30 ? 1 + v / 30 : v <= 60 ? 2 + (v - 30) / 30 : 3 + (v - 60) / 40 * 2;   /* Yaesu bar → SWR (same as the remote) */
  const DEF = {
    s: { label: 'S', f: v => v <= 0 ? (v + 54) / 54 * 0.6 : 0.6 + v / 60 * 0.4, ticks: [[-48, '1'], [-36, '3'], [-24, '5'], [-12, '7'], [0, '9'], [20, '+20'], [40, '+40'], [60, '+60']], red: 0.6, txt: sTxt, rx: true },
    po: { label: 'PWR OUT', f: v => v / 100, ticks: [[0, '0'], [25, '25'], [50, '50'], [75, '75'], [100, '100%']], red: 2, txt: v => v == null ? '—' : v + '%' },
    alc: { label: 'ALC', f: v => v / 100, ticks: [[0, '0'], [50, ''], [100, 'MAX']], red: 0.62, txt: v => v == null ? '—' : v + '%' },
    swr: { label: 'SWR', f: v => v / 100, ticks: [[0, '1'], [15, '1.5'], [30, '2'], [60, '3'], [100, '∞']], red: 0.3, txt: v => v == null ? '—' : '≈' + swrOf(v).toFixed(1) },
    comp: { label: 'COMP', f: v => v / 100, ticks: [[0, '0'], [50, ''], [100, 'MAX']], red: 0.75, txt: v => v == null ? '—' : v + '%' },
    idd: { label: 'IDD', f: v => v / 100, ticks: [[0, '0'], [50, ''], [100, 'MAX']], red: 0.85, txt: v => v == null ? '—' : v + '%' },
    vdd: { label: 'VDD', f: v => v / 100, ticks: [[0, '0'], [50, ''], [100, 'MAX']], red: 2, txt: v => v == null ? '—' : v + '%' }
  };
  const ORDER = ['s', 'po', 'alc', 'swr', 'comp', 'idd', 'vdd'];
  const W = [];   /* every mounted widget */
  let LAST = null;
  function mount(el, opts) {
    if (!el) return null; opts = opts || {};
    const w = { el, opts, cur: {}, peak: { v: -60, t: 0 }, cv: {} };
    el.classList.add('kmeters');
    w.draw = () => draw(w); w.set = m => { if (m) LAST = Object.assign({}, m, { at: m.at || Date.now() }); draw(w); };
    W.push(w); draw(w); return w;
  }
  function shown(m) { return S.show.filter(k => DEF[k] && (k === 's' ? true : m ? m[k] != null : true)); }
  function draw(w) {
    const m = w.opts.get ? w.opts.get() : LAST, keys = shown(m), tx = m && m.tx;
    /* folded (▸): one line with the numbers, still live — a phone keeps its screen for the waterfall */
    if (!S.open) { const sum = m ? keys.map(k => (k === 's' ? '' : DEF[k].label.replace('PWR OUT', 'PO') + ' ') + DEF[k].txt(m[k])).join(' · ') : 'waiting for the radio…';
      if (w.sig !== 'closed') { w.sig = 'closed'; w.el.innerHTML = `<div class="kmh"><button type="button" class="chip sm" data-kmopen aria-label="Show the meters">▸</button><b>📟</b>${w.opts.tune && w.opts.tune.ok() ? '<button type="button" class="chip sm kmtune" data-kmtune title="Start the radio\'s antenna tuner">🔧 TUNE</button>' : ''}<span class="kms mono"></span></div>`; }
      const e = w.el.querySelector('.kms'); if (e) e.textContent = (tx ? '📡 ' : '') + sum; return; }
    const head = `<div class="kmh"><button type="button" class="chip sm" data-kmopen aria-label="Fold the meters to one line">▾</button><b>📟 METERS</b>${w.opts.tune && w.opts.tune.ok() ? '<button type="button" class="chip sm kmtune" data-kmtune title="Start the radio\'s antenna tuner">🔧 TUNE</button>' : ''}<button type="button" class="chip sm" data-kmst>${S.style === 'analog' ? '◐ ANALOG' : '▮ DIGITAL'}</button><button type="button" class="chip sm" data-kmset aria-label="Which meters">⚙ METERS</button><span class="kma">${m ? (tx ? '📡 TX · ' : '') + (m.pwr != null ? 'power set ' + m.pwr + '%' : '') : 'waiting for the radio…'}</span></div>`;
    const sig = keys.join(',') + '|' + S.style + '|' + !!(w.opts.tune && w.opts.tune.ok());
    if (w.sig !== sig) { w.sig = sig; w.el.innerHTML = head + (S.style === 'analog' ? `<div class="kmg">${keys.map(k => `<div class="kgw"><canvas data-km="${k}" width="200" height="118" aria-label="${esc(DEF[k].label)} meter"></canvas></div>`).join('')}</div>`
      : `<div class="kmd">${keys.map(k => `<div class="mrow"><span>${esc(DEF[k].label)}</span><div class="mt"><div class="mb" data-kb="${k}"></div></div><b data-kt="${k}">—</b></div>`).join('')}</div>`); w.cv = {}; }
    else { const a = w.el.querySelector('.kma'); if (a) a.textContent = m ? (tx ? '📡 TX · ' : '') + (m.pwr != null ? 'power set ' + m.pwr + '%' : '') : 'waiting for the radio…'; }
    keys.forEach(k => { const v = m ? m[k] : null; if (S.style === 'analog') { w.cur[k] = v; } else { const b = w.el.querySelector(`[data-kb="${k}"]`), t = w.el.querySelector(`[data-kt="${k}"]`); if (!b) return; const f = v == null ? 0 : Math.max(0, Math.min(1, DEF[k].f(v))); b.style.width = (f * 100) + '%'; b.className = 'mb ' + (v == null ? 'off' : f >= DEF[k].red ? 'bad' : f >= DEF[k].red * 0.8 ? 'warn' : 'ok'); if (t) t.textContent = DEF[k].txt(v); } });
    if (S.style === 'analog') anim();
  }
  /* ---------- the needle dials ---------- */
  let rafOn = false;
  function anim() { if (rafOn) return; rafOn = true; requestAnimationFrame(step); }
  function step() {
    rafOn = false; let more = false; const now = performance.now();
    for (const w of W) {
      if (!w.el.isConnected || w.el.offsetParent === null) continue;
      w.el.querySelectorAll('canvas[data-km]').forEach(cv => {
        const k = cv.dataset.km, d = DEF[k], v = w.cur[k], tgt = v == null ? 0 : Math.max(0, Math.min(1, d.f(v)));
        const st = w.cv[k] || (w.cv[k] = { pos: 0 }); st.pos += (tgt - st.pos) * 0.22; if (Math.abs(tgt - st.pos) > 0.002) more = true;
        if (k === 's' && v != null) { if (v >= w.peak.v || now - w.peak.t > 1500) { if (v >= w.peak.v) { w.peak.v = v; w.peak.t = now; } else w.peak.v = Math.max(v, w.peak.v - 0.4); more = true; } }
        dial(cv, d, st.pos, v, k === 's' ? Math.max(0, Math.min(1, d.f(w.peak.v))) : null);
      });
    }
    if (more) anim();
  }
  function dial(cv, d, pos, v, peak) {
    const g = cv.getContext('2d'), Wd = cv.width, H = cv.height, cx = Wd / 2, cy = H * 1.02, r = H * 0.9, a0 = -Math.PI / 2 - 0.82, a1 = -Math.PI / 2 + 0.82, at = f => a0 + (a1 - a0) * f;
    const dark = document.documentElement.dataset.theme !== 'light';
    g.clearRect(0, 0, Wd, H);
    const face = g.createLinearGradient(0, 0, 0, H); face.addColorStop(0, dark ? '#1d2620' : '#fffaf0'); face.addColorStop(1, dark ? '#0f1411' : '#efe6d2');
    g.fillStyle = face; g.beginPath(); g.roundRect ? g.roundRect(1, 1, Wd - 2, H - 2, 10) : g.rect(1, 1, Wd - 2, H - 2); g.fill();
    g.lineWidth = 3; g.strokeStyle = dark ? 'rgba(240,201,107,.75)' : 'rgba(122,82,0,.75)'; g.beginPath(); g.arc(cx, cy, r, at(0), at(Math.min(1, d.red))); g.stroke();
    if (d.red < 1) { g.strokeStyle = '#e05c5c'; g.beginPath(); g.arc(cx, cy, r, at(d.red), at(1)); g.stroke(); }
    g.fillStyle = dark ? '#d9cfa8' : '#3d3320'; g.font = '600 10px ui-monospace,Menlo,monospace'; g.textAlign = 'center';
    d.ticks.forEach(([tv, tl]) => { const f = Math.max(0, Math.min(1, d.f(tv))), a = at(f), x1 = cx + Math.cos(a) * r, y1 = cy + Math.sin(a) * r, x2 = cx + Math.cos(a) * (r - 7), y2 = cy + Math.sin(a) * (r - 7);
      g.strokeStyle = g.fillStyle; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); if (tl) g.fillText(tl, cx + Math.cos(a) * (r - 17), cy + Math.sin(a) * (r - 17) + 3); });
    if (peak != null && v != null) { const a = at(peak); g.strokeStyle = 'rgba(243,154,85,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2)); g.lineTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9)); g.stroke(); }
    const a = at(pos); g.strokeStyle = v == null ? 'rgba(150,150,150,.5)' : (dark ? '#ffe3a0' : '#7a1d0e'); g.lineWidth = 2.2; g.shadowColor = dark ? 'rgba(255,214,120,.6)' : 'transparent'; g.shadowBlur = 6;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1)); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = dark ? '#a8a18f' : '#6b6252'; g.font = '800 10px Arial,sans-serif'; g.textAlign = 'left'; g.fillText(d.label, 8, 14);
    g.textAlign = 'right'; g.fillStyle = dark ? '#efe9da' : '#1d1a14'; g.font = '800 13px ui-monospace,Menlo,monospace'; g.fillText(d.txt(v), Wd - 8, 15);
  }
  /* ---------- the controls (one handler for every widget) ---------- */
  document.addEventListener('click', e => {
    const tb = e.target.closest('[data-kmtune]'); if (tb) { const w = W.find(x => x.el.contains(tb)); if (w && w.opts.tune) w.opts.tune.go(); return; }
    if (e.target.closest('[data-kmopen]')) { S.open = !S.open; save(); W.forEach(w => { w.sig = ''; draw(w); }); return; }
    if (e.target.closest('[data-kmst]')) { S.style = S.style === 'analog' ? 'digital' : 'analog'; save(); W.forEach(w => { w.sig = ''; draw(w); }); return; }
    if (e.target.closest('[data-kmset]')) {
      AP.sheet('📟 Meters', `<p class="hint">Pick the meters to show. ANALOG = needle dials like the radio's own; DIGITAL = bars with numbers. A meter your radio does not send stays hidden.</p>
        <div class="row"><button type="button" class="b${S.style === 'analog' ? ' gold' : ''}" data-kms="analog">◐ ANALOG</button><button type="button" class="b${S.style === 'digital' ? ' gold' : ''}" data-kms="digital">▮ DIGITAL</button></div>
        ${ORDER.map(k => `<label class="ck" style="display:flex;margin:8px 0"><input type="checkbox" data-kmk="${k}"${S.show.includes(k) ? ' checked' : ''}> <span>${esc(DEF[k].label)}${k === 's' ? ' (signal strength: S1–S9, dB over S9)' : k === 'comp' ? ' (speech compressor)' : k === 'idd' ? ' (drain current)' : k === 'vdd' ? ' (supply voltage)' : ''}</span></label>`).join('')}`,
        () => { S.show = ORDER.filter(k => { const c = document.querySelector(`[data-kmk="${k}"]`); return c && c.checked; }); if (!S.show.length) S.show = ['s']; save(); W.forEach(w => { w.sig = ''; draw(w); }); });
      document.querySelectorAll('[data-kms]').forEach(b => { b.onclick = () => { S.style = b.dataset.kms; save(); document.querySelectorAll('[data-kms]').forEach(x => x.classList.toggle('gold', x === b)); }; });
    }
  });
  function feed(m) { if (!m) return; LAST = Object.assign({}, m, { at: m.at || Date.now() }); W.forEach(w => { if (!w.opts.get) draw(w); }); }

  /* ---------- the PC / phone with its own radio: a 📟 METERS bar on the LOG and DIGI screens ---------- */
  const host = (id, before) => { const s = $(id); if (!s || $(id + 'Met')) return null; s.insertAdjacentHTML(before ? 'afterbegin' : 'afterbegin', `<div class="kmbar" id="${id}Met" hidden></div>`); return $(id + 'Met'); };
  /* 🔧 TUNE = the radio's own antenna tuner over CAT (it transmits a carrier for a few seconds; never while the app is transmitting) */
  const ATU = { ok: () => !!(G.KPCCat && KPCCat.connected() && KPCCat.extras && KPCCat.extras().includes('atu')),
    go: async () => { if (AP.txing()) { AP.toast('Transmitting now: tune after.', 2500, 'bad'); return; } if (G.KPCRigX) { KPCRigX.tuneAsk(); return; } const ok = await KPCCat.extra('atu', 1); AP.toast(ok ? '🔧 The radio\'s tuner is tuning: watch the SWR.' : 'The radio did not take the tune command (does it have a built-in tuner turned on?).', 4000, ok ? 'log' : 'bad'); } };
  const B1 = mount(host('scrLog'), { tune: ATU }), B2 = mount(host('scrDigi'), { tune: ATU });
  let busy = false, tPoll = 0;
  async function poll() {
    const on = AP.catConnected() && !(G.KPCRemote && KPCRemote.link && KPCRemote.link().on);
    [B1, B2].forEach(b => { if (b) b.el.hidden = !on; });
    if (!on || busy || document.hidden || !/^(log|digi|radio)$/.test(document.body.dataset.screen || '')) return;
    if (G.KPCRemote && KPCRemote.clients && KPCRemote.clients().length) return;   /* a phone is on: the remote link reads them already (feed) */
    const tx = AP.txing(); if (tx && AP.native) return;   /* Android: no CAT while transmitting (the USB port must be let go, Fable's rule) */
    if (Date.now() - tPoll < (tx ? 700 : 1000)) return; tPoll = Date.now();
    busy = true; try { const m = await KPCCat.meters(); if (m) feed(Object.assign(m, { tx })); } catch (e) {} busy = false;
  }
  setInterval(poll, 250);
  G.KPCMeters = { S, save, mount, feed, last: () => LAST, DEF, sTxt, swrOf };
})(window);
