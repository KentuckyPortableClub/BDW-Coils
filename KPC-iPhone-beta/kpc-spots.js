/* KPC app: THE SPOT FRAME (Fable, Oct 22). One list that every source feeds; the SPOTS tab shows it.
     KPCSpots.source({ id:'pota', label:'POTA', every: 60, poll: async () => [spots] })   a source (Opus plugs POTA/SOTA/WWFF/cluster/RBN in here, step 4)
     KPCSpots.feed(sourceId, [ {call, khz, mode, refs:[], t, comment, grid, spotter} ])      new spots from anywhere (our own FT8 decodes and APRS already do)
   The frame de-duplicates (same station, same spot ±2 kHz, within 15 min = one line, newest time, all its sources),
   filters (band · mode · age · still-need · hide worked · hide outside my licence class · per source), alerts when a call on
   the watchlist shows up, and a tap = tune the radio (CAT) + fill the log line (call, park number, mode, frequency). */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const AP = G.KPCApp, esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = Object.assign({ bands: [], modes: [], digi: [], ct: [], ageMin: 60, need: 'all', hideWorked: false, inClass: false, off: [], watch: [], fmin: 0, fmax: 0, sort: 'new' }, LS('kpcAppSpots', {}));
  const save = () => SV('kpcAppSpots', S);
  const SRC = {}, SP = [];                                 /* sources by id; the spots, newest last */
  const alerted = {};
  const base = c => String(c || '').toUpperCase().replace(/^([A-Z0-9]+\/)?([A-Z0-9]+)(\/[A-Z0-9]+)?$/, '$2');
  const bandOf = k => (G.KPCLog && KPCLog.band(k)) || '';
  /* Oct 24 (Brandon: 'spots I dont see filters for digi modes'): the digital group splits into FT8 / FT4 / other digital */
  const digiOf = m => /FT8/i.test(m) ? 'FT8' : /FT4/i.test(m) ? 'FT4' : 'OTHER';
  const modeGroup = m => /FT8|FT4|JS8|PSK|RTTY|MFSK|OLIVIA|DATA|APRS|PKT|HELL|WSPR/i.test(m) ? 'DATA' : /CW/i.test(m) ? 'CW' : 'PHONE';
  /* Oct 26 (Brandon: 'spot at 7191 keeps taking me to 7191.5'): the spot WAS 7191.5; three decimals hid the half kHz → show the 4th when there is one */
  const mhz = k => { const t = Math.round(k * 10) / 10; return (t / 1000).toFixed(t % 1 ? 4 : 3); };

  function source(o) { if (!o || !o.id) return null; SRC[o.id] = Object.assign({ label: o.id, every: 0, poll: null, n: 0, last: 0, err: '' }, o); tick(); draw(); return SRC[o.id]; }
  /* a spot's position (for the continent filter): the source's own, else the centre of its grid square */
  function posOf(x) { if (isFinite(+x.la) && isFinite(+x.lo) && (x.la || x.lo)) return { la: +x.la, lo: +x.lo }; const g = AP.gridLL && x.grid ? AP.gridLL(x.grid) : null; return g ? { la: g.la, lo: g.lo } : {}; }
  function feed(src, list) {
    let n = 0;
    (list || []).forEach(x => {
      const call = base(x.call), khz = +x.khz; if (!call || call.length < 3 || !(khz > 100)) return;
      const t = +x.t || Date.now(), mode = String(x.mode || '').toUpperCase(), refs = (x.refs || []).map(r => String(r).toUpperCase()).filter(Boolean);
      const old = SP.find(s => s.call === call && Math.abs(s.khz - khz) <= 2 && Math.abs(s.t - t) < 15 * 60000);
      if (old) { if (t >= old.t) { old.t = t; old.khz = khz; if (mode) old.mode = mode; if (x.comment) old.comment = x.comment; } refs.forEach(r => { if (!old.refs.includes(r)) old.refs.push(r); }); if (!old.src.includes(src)) old.src.push(src); if (x.grid) old.grid = x.grid; if (x.st && !old.st) old.st = String(x.st).toUpperCase(); old.n++; return; }
      SP.push({ id: ++sid, call, khz, band: bandOf(khz), mode, refs, st: String(x.st || '').toUpperCase(), t, comment: String(x.comment || '').slice(0, 120), grid: String(x.grid || '').toUpperCase(), spotter: x.spotter || '', src: [src], n: 1, cont: x.cont || '', cty: x.cty || '', sig: x.sig || '', ...posOf(x) });
      n++;
      if (S.watch.includes(call) && Date.now() - (alerted[call] || 0) > 30 * 60000) { alerted[call] = Date.now(); const msg = call + ' is on: ' + mhz(khz) + ' ' + mode + (refs.length ? ' · ' + refs.join('+') : ''); if (AP.notify) AP.notify('watch', msg, { key: call, every: 30 * 60000 }); else { AP.toast('👀 ' + esc(msg), 8000, 'log'); try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {} } }
    });
    if (SRC[src]) { SRC[src].n += n; SRC[src].last = Date.now(); }
    prune(); if (n) { draw(); AP.fire('spots', { src, n }); }
    return n;
  }
  let sid = 0;
  function prune() { const cut = Date.now() - 6 * 3600000; for (let i = SP.length - 1; i >= 0; i--) if (SP[i].t < cut) SP.splice(i, 1); if (SP.length > 600) SP.splice(0, SP.length - 600); }
  /* Oct 25 (Brandon: 'like the Hunters Lounge spots, sort by time, mode, frequency … one line instead of stacked to see more'):
     tap a column head to sort by it (tap again = the other way round) */
  const dirOf = () => S.rev ? -1 : 1;
  const SORTS = { new: (a, b) => dirOf() * (b.t - a.t), freq: (a, b) => dirOf() * (a.khz - b.khz), mode: (a, b) => dirOf() * (String(a.mode).localeCompare(String(b.mode)) || a.khz - b.khz), call: (a, b) => dirOf() * a.call.localeCompare(b.call), st: (a, b) => dirOf() * (String(a.st || '~').localeCompare(String(b.st || '~')) || b.t - a.t), park: (a, b) => dirOf() * (String(a.refs[0] || '~').localeCompare(String(b.refs[0] || '~')) || b.t - a.t) };
  function shown() {
    const cut = Date.now() - S.ageMin * 60000, cls = AP.S.cls || '';
    return SP.filter(s => s.t >= cut && (!(S.ct || []).length || S.ct.includes(window.KPCCont ? KPCCont.of(s) : '')) && (!S.bands.length || S.bands.includes(s.band)) && (!S.modes.length || S.modes.includes(modeGroup(s.mode))) && (!S.digi.length || modeGroup(s.mode) !== 'DATA' || S.digi.includes(digiOf(s.mode)))
      && !s.src.every(x => S.off.includes(x)) && (!S.hideWorked || !(G.KPCLog && KPCLog.worked(s.call))) && (!S.inClass || !cls || AP.bandPlan.allowed(s.khz, cls, s.mode))
      && (S.need !== 'new' || !(G.KPCLog && KPCLog.worked(s.call))) && (S.need !== 'park' || newPk(s))
      && (!S.fmin || s.khz >= S.fmin) && (!S.fmax || s.khz <= S.fmax))   /* Brandon Oct 22: filter by frequency too */
      .sort(SORTS[S.sort] || SORTS.new);
  }
  function tick() { for (const id in SRC) { const s = SRC[id]; if (!s.poll || !s.every || S.off.includes(id) || !AP.net.online()) continue; if (Date.now() - s.last < s.every * 1000) continue; s.last = Date.now(); Promise.resolve().then(() => s.poll()).then(list => { s.err = ''; feed(id, list || []); }).catch(e => { s.err = String(e.message || e); draw(); }); } }
  setInterval(tick, 10000); setInterval(() => { if (/spots|log/.test(document.body.dataset.screen || '')) draw(); }, 30000);

  /* ---------------- the screen ---------------- */
  const age = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm' : Math.round(m / 60) + 'h'; };
  const newPk = s => !!(G.KPCLog && KPCLog.hunted && s.refs.some(r => /^[A-Z0-9]{1,4}-\d{4,6}$/.test(r) && !KPCLog.hunted(r)));
  function draw() {
    const el = $('spList'); if (!el) return;
    const L = shown(), all = SP.length;
    $('spN').textContent = L.length + (all > L.length ? ' of ' + all : '');
    const srcs = Object.values(SRC);
    $('spSrc').innerHTML = srcs.map(s => `<button type="button" class="chip${S.off.includes(s.id) ? '' : ' on'}" data-src="${esc(s.id)}" title="${esc(s.err || ((s.title ? s.title + ' ' : '') + s.n + ' so far'))}">${esc(s.label)}${s.err ? ' ⚠' : ''}</button>`).join('') || '<span class="hint">No spot sources yet.</span>';
    el.querySelectorAll && $('spSrc').querySelectorAll('[data-src]').forEach(b => { b.onclick = () => { const i = S.off.indexOf(b.dataset.src); if (i < 0) S.off.push(b.dataset.src); else S.off.splice(i, 1); save(); draw(); }; });
    const arrow = k => S.sort === k ? (S.rev ? ' ▲' : ' ▼') : '';
    const head = `<div class="sphead" role="row"><button type="button" data-ssort="new">AGE${arrow('new')}</button><button type="button" data-ssort="call">CALL${arrow('call')}</button><button type="button" data-ssort="park">PARK${arrow('park')}</button><button type="button" data-ssort="st">ST${arrow('st')}</button><button type="button" data-ssort="freq">MHz${arrow('freq')}</button><button type="button" data-ssort="mode">MODE${arrow('mode')}</button><button type="button" class="w" data-ssort="freq">BAND</button><span class="w">PARK · WHERE · COMMENT</span><span class="w">SPOTTED BY</span></div>`;
    const html = L.length ? head + L.slice(0, 250).map(s => { const wk = G.KPCLog && KPCLog.worked(s.call), watch = S.watch.includes(s.call), np = newPk(s);
      return `<div class="sp1${wk ? ' wk' : ''}${watch ? ' watch' : ''}${np ? ' np' : ''}" data-sp="${s.id}" role="row" tabindex="0" title="${esc([s.comment, 'by ' + (s.spotter || s.src.join('+'))].filter(Boolean).join(' · '))}">
        <span class="a">${age(s.t)}</span><span class="c">${watch ? '👀' : ''}${esc(s.call)}${wk ? ' <i>✓</i>' : ''}</span><span class="p"${np ? ' title="★ a park you have not hunted yet"' : ''}>${np ? '★ ' : ''}${esc(s.refs.join('+') || '—')}</span><span class="s">${esc(s.st || '')}</span><span class="f">${mhz(s.khz)}</span><span class="m">${esc(s.mode || '')}</span><span class="w bd">${esc(s.band || '')}</span><span class="w i">${esc(s.comment || (s.grid ? s.grid : ''))}</span><span class="w by">${esc(s.spotter || '')}<small>${esc(s.src.map(x => (SRC[x] && SRC[x].label) || x).join(' + '))}</small></span></div>`; }).join('')
      : '<div class="empty">' + (all ? 'Every spot is filtered out. Loosen the ⚙ FILTERS.' : (AP.net.online() ? 'No spots yet: POTA, SOTA, WWFF and the DX cluster are checked every minute or three.' : 'No signal: spots come back when this device is online. Stations calling CQ POTA/SOTA/WWFF on the FT8 screen still land here.')) + '</div>';
    el.innerHTML = html;
    /* Oct 26 (Brandon: 'spot screen looks bare on desktop'): a band strip above the list = how many spots per band, tap = show only that band */
    const bs = $('spBands'); if (bs) { const cnt = {}; SP.filter(s => s.t >= Date.now() - S.ageMin * 60000).forEach(s => { if (s.band) cnt[s.band] = (cnt[s.band] || 0) + 1; });
      const order = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'];
      bs.innerHTML = order.filter(b => cnt[b] || S.bands.includes(b)).map(b => `<button type="button" class="bdc${S.bands.includes(b) ? ' on' : ''}" data-bdc="${b}"><b>${b}</b><i>${cnt[b] || 0}</i></button>`).join('') + (S.bands.length ? '<button type="button" class="bdc all" data-bdc="">ALL BANDS</button>' : '');
      bs.hidden = !bs.innerHTML; }
    /* the same list beside the log on a tablet / PC */
    const side = $('lgSp'); if (side && getComputedStyle($('lgSpW')).display !== 'none') { side.innerHTML = html; $('lgSpN').textContent = L.length; }
  }
  $('spList').addEventListener('click', e => { const h = e.target.closest('[data-ssort]'); if (h) { const k = h.dataset.ssort; if (S.sort === k) S.rev = !S.rev; else { S.sort = k; S.rev = false; } save(); draw(); return; } const r = e.target.closest('[data-sp]'); if (!r) return; const s = SP.find(x => x.id === +r.dataset.sp); if (s) open(s); });
  if ($('lgSp')) { $('lgSp').addEventListener('click', e => { const h = e.target.closest('[data-ssort]'); if (h) { const k = h.dataset.ssort; if (S.sort === k) S.rev = !S.rev; else { S.sort = k; S.rev = false; } save(); draw(); return; } const r = e.target.closest('[data-sp]'); if (!r) return; const s = SP.find(x => x.id === +r.dataset.sp); if (s) open(s); }); $('lgSpAll').onclick = () => AP.go('spots'); }
  if ($('spBands')) $('spBands').addEventListener('click', e => { const b = e.target.closest('[data-bdc]'); if (!b) return; const k = b.dataset.bdc; if (!k) S.bands = []; else if (S.bands.includes(k)) S.bands = S.bands.filter(x => x !== k); else S.bands = [k]; save(); draw(); });
  G.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(draw, 200); }); let rsT = null;
  AP.on('screen', s => { if (s === 'log') draw(); });
  function open(s) {
    const wk = G.KPCLog && KPCLog.worked(s.call), cls = AP.S.cls, inCls = !cls || AP.bandPlan.allowed(s.khz, cls, s.mode);
    AP.sheet(s.call + ' · ' + mhz(s.khz) + ' ' + (s.mode || ''), `<p>${s.refs.length ? '🌲 ' + esc(s.refs.join(' + ')) + (s.st ? ' · ' + esc(s.st) : '') + '<br>' : s.st ? esc(s.st) + '<br>' : ''}${esc(s.comment || '')}${s.grid ? ' · ' + esc(s.grid) : ''}</p>
      <p class="hint mono">${esc(s.band)} · spotted ${age(s.t)} ago by ${esc(s.spotter || s.src.join('+'))}${wk ? ' · you have worked ' + esc(s.call) + ' before' : ''}${!inCls ? ' · ⚠ outside your licence class (' + esc(cls) + ')' : ''}</p>
      <div class="row"><button type="button" class="b gold" id="spTune">📻 TUNE + LOG LINE</button><button type="button" class="b" id="spWatch">${S.watch.includes(s.call) ? '👀 STOP WATCHING' : '👀 WATCH ' + esc(s.call)}</button>${s.refs.some(r => !/FF-|\//.test(r)) && G.KPCSpotMe ? '<button type="button" class="b" id="spRe">📣 RE-SPOT</button>' : ''}</div>`);
    if ($('spRe')) $('spRe').onclick = () => { AP.shut(); setTimeout(() => KPCSpotMe.respot(s), 40); };
    $('spTune').onclick = () => { AP.shut(); tune(s); };
    $('spWatch').onclick = () => { const i = S.watch.indexOf(s.call); if (i < 0) S.watch.push(s.call); else S.watch.splice(i, 1); save(); AP.shut(); draw(); };
  }
  async function tune(s) {
    AP.fire('spot-tune', s);   /* Nov 6: kpc-rotor.js turns the beam to it */
    /* on the link to the home PC (and no radio here): the PC's radio goes to the spot (Brandon Oct 22: 'click spots would be nice if you are remote') */
    if (G.KPCRemote && KPCRemote.link().paired && !AP.catConnected()) { if (G.KPCLog && KPCLog.prefill) KPCLog.prefill({ call: s.call, refs: s.refs, mode: s.mode, khz: s.khz, g: s.grid }); KPCRemote.spot(s); return; }
    const digi = /^FT[48]$/.test(s.mode) && G.KPCModes && KPCModes.get(s.mode);
    /* Nov 1 (Brandon: 'clicking on the spot list … cw should see that and it took me to ft8 page'): a CW / RTTY / PSK31 spot opens THAT mode's screen */
    const m5 = String(s.mode || '').toUpperCase().replace(/^PSK$/, 'PSK31'), d5 = /^(CW|RTTY|PSK31)$/.test(m5) && AP.catConnected() && G.KPCModes5 && KPCModes5.tuneSpot && G.KPCModes && KPCModes.get(m5);   /* no radio connected = log it by hand on the LOG screen, as before */
    if (d5) { KPCModes.use(m5); AP.go('digi'); KPCModes5.tuneSpot(s); if (G.KPCLog && KPCLog.prefill) KPCLog.prefill({ call: s.call, refs: s.refs, mode: s.mode, khz: s.khz, g: s.grid, st: s.st }); return; }
    if (digi) { KPCModes.use(s.mode); const b = bandOf(s.khz); if (b) KPCModes.active().setBand(b); }
    else if (AP.catConnected()) { const ok = await KPCCat.tune(s.khz, s.mode || ''); if (!ok) AP.toast('The radio did not take ' + mhz(s.khz) + '. Set it by hand.', 4000, 'bad'); }
    else AP.toast('📻 Set the radio to ' + mhz(s.khz) + ' MHz ' + esc(s.mode || '') + ' (connect it in STATION → Radio control to have the app do it).', 5000);
    if (G.KPCLog && KPCLog.prefill) KPCLog.prefill({ call: s.call, refs: s.refs, mode: s.mode, khz: s.khz, g: s.grid, st: s.st });
    if (digi) { AP.go('digi'); if ($('dgDx')) $('dgDx').value = s.call; } else AP.go('log');
  }
  /* the filter panel, laid out like the Hunters Lounge (Brandon Oct 24): a label + chips per row, every tap works at once */
  const BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'];
  const fOn = () => [S.bands.length, S.modes.length, S.digi.length, (S.ct || []).length, S.need !== 'all', S.inClass, S.fmin || S.fmax, S.ageMin !== 60, S.off.filter(x => SRC[x]).length].filter(Boolean).length;
  function filtHtml() {
    const c = (k, v, on, t) => `<button type="button" class="chip${on ? ' on' : ''}" data-fk="${k}" data-fv="${esc(v)}" aria-pressed="${on}">${t || esc(v)}</button>`;
    const row = (lab, inner) => `<div class="frow"><span>${lab}</span><div>${inner}</div></div>`;
    return row('SHOW', Object.values(SRC).map(x => c('src', x.id, !S.off.includes(x.id), esc(x.label))).join(''))
      + row('BAND', BANDS.map(b => c('band', b, S.bands.includes(b), b.toUpperCase())).join(''))
      + row('MODE', [['PHONE', 'PHONE'], ['CW', 'CW'], ['DATA', 'DIGITAL']].map(([k, l]) => c('mode', k, S.modes.includes(k), l)).join(''))
      + row('DIGITAL', [['FT8', 'FT8'], ['FT4', 'FT4'], ['OTHER', 'OTHER']].map(([k, l]) => c('digi', k, S.digi.includes(k), l)).join(''))
      + row('CONTINENT', (G.KPCCont ? KPCCont.list : []).map(([k, l]) => c('ct', k, (S.ct || []).includes(k), l)).join(''))
      + row('ONLY', c('need', 'park', S.need === 'park', '✨ PARKS NEW TO ME') + c('need', 'new', S.need === 'new', '🆕 CALLS NOT WORKED') + c('cls', '1', S.inClass, '📜 IN MY LICENCE CLASS' + (AP.S.cls ? ' (' + esc(AP.S.cls) + ')' : '')))
      + row('NO OLDER', [5, 10, 15, 30, 60, 120, 360].map(a => c('age', a, S.ageMin === a, a < 60 ? a + ' MIN' : a / 60 + ' H')).join(''))
      + row('SORT', c('sort', 'new', S.sort === 'new' || !SORTS[S.sort], 'NEWEST') + c('sort', 'freq', S.sort === 'freq', 'FREQUENCY') + c('sort', 'mode', S.sort === 'mode', 'MODE') + c('sort', 'park', S.sort === 'park', 'PARK') + c('sort', 'st', S.sort === 'st', 'STATE') + c('sort', 'call', S.sort === 'call', 'CALL'))
      + `<div class="frow"><span>kHz</span><div><input id="spFmin" inputmode="decimal" value="${S.fmin || ''}" placeholder="from 14000" class="fin"> <input id="spFmax" inputmode="decimal" value="${S.fmax || ''}" placeholder="to 14350" class="fin"></div></div>`
      + `<div class="frow"><span>WATCH FOR</span><div><input id="spWatchL" autocapitalize="characters" spellcheck="false" value="${esc(S.watch.join(' '))}" placeholder="calls, space between (a note when they show up)" class="fin wide"></div></div>`
      + `<p class="hint">${shown().length} of ${SP.length} spots shown. None picked in a row = all of them.${!AP.S.cls ? ' Set MY LICENCE CLASS in STATION → My station for the licence filter.' : ''}${!(G.KPCLog && KPCLog.potaFiles && KPCLog.potaFiles().h) ? ' Load your hunter file (STATION → Log files → MY POTA FILES) so NEW TO ME knows every park you have hunted.' : ''}</p>`
      + `<div class="row fend"><button type="button" class="b" data-fk="usual">↺ USUAL</button><button type="button" class="b" data-fk="all">✕ SHOW EVERYTHING</button><button type="button" class="b gold" data-fk="done">✓ DONE</button></div>`;
  }
  function filtDraw() { const el = $('spF'); if (el) el.innerHTML = filtHtml(); $('spFilt').innerHTML = '⚙ FILTERS' + (fOn() ? ' <i class="fnum">' + fOn() + ' ON</i>' : ''); }
  function reset(all) { S.bands = []; S.modes = []; S.digi = []; S.ct = []; S.need = 'all'; S.inClass = false; S.fmin = S.fmax = 0; S.ageMin = all ? 360 : 60; S.sort = 'new'; S.off = []; }
  $('spFilt').onclick = () => {
    AP.sheet('Spot filters', '<div id="spF" class="fpanel"></div>', () => { save(); draw(); filtDraw(); });
    filtDraw();
    const el = $('spF');
    el.onclick = e => {
      const b = e.target.closest('[data-fk]'); if (!b) return; const k = b.dataset.fk, v = b.dataset.fv, tog = (a, x) => { const i = a.indexOf(x); if (i < 0) a.push(x); else a.splice(i, 1); };
      if (k === 'done') { AP.shut(); return; }
      if (k === 'usual') reset(false); else if (k === 'all') reset(true);
      else if (k === 'src') tog(S.off, v); else if (k === 'band') tog(S.bands, v); else if (k === 'mode') tog(S.modes, v); else if (k === 'digi') tog(S.digi, v);
      else if (k === 'ct') { S.ct = S.ct || []; tog(S.ct, v); } else if (k === 'need') S.need = S.need === v ? 'all' : v; else if (k === 'cls') S.inClass = !S.inClass;
      else if (k === 'age') S.ageMin = +v; else if (k === 'sort') { S.sort = v; S.rev = false; }
      save(); draw(); filtDraw();
    };
    el.onchange = e => { const t = e.target; if (t.id === 'spFmin') S.fmin = parseFloat(t.value) || 0; else if (t.id === 'spFmax') S.fmax = parseFloat(t.value) || 0; else if (t.id === 'spWatchL') S.watch = t.value.toUpperCase().split(/[\s,]+/).filter(Boolean); else return; save(); draw(); filtDraw(); };
  };

  /* ---------------- SCAN (POTACAT has it): step the radio through the shown spots ---------------- */
  let scanT = 0, scanI = -1, scanId = 0;
  function scanStop(why) { clearInterval(scanT); scanT = 0; scanId = 0; $('spScan').textContent = '▶ SCAN'; $('spScan').classList.remove('on'); document.querySelectorAll('.sp1.scan').forEach(r => r.classList.remove('scan')); if (why) AP.toast(why, 3000); }
  async function scanStep() {
    const L = shown().filter(s => !/^FT[48]$/.test(s.mode || '')); if (!L.length) { scanStop('Nothing to scan: no voice / CW spots shown.'); return; }
    scanI = (scanI + 1) % L.length; const s = L[scanI]; scanId = s.id;
    document.querySelectorAll('.sp1').forEach(r => r.classList.toggle('scan', +r.dataset.sp === s.id));
    const r = document.querySelector(`.sp1[data-sp="${s.id}"]`); if (r) r.scrollIntoView({ block: 'nearest' });
    if (AP.catConnected()) { const ok = await KPCCat.tune(s.khz, s.mode || ''); if (!ok) scanStop('The radio did not take ' + mhz(s.khz) + ': scan stopped.'); }
    else if (G.KPCRemote && KPCRemote.link().paired) KPCRemote.spot(s);
  }
  $('spScan').onclick = () => {
    if (scanT) { scanStop(); return; }
    if (!AP.catConnected() && !(G.KPCRemote && KPCRemote.link().paired)) { AP.toast('📻 Scan moves the radio: connect it first (STATION → Radio control).', 5000, 'bad'); return; }
    const sec = +S.scanS || 10; scanI = -1; scanStep(); scanT = setInterval(scanStep, sec * 1000);
    $('spScan').textContent = '⏹ STOP · ' + sec + ' s'; $('spScan').classList.add('on');
    AP.toast('▶ Scanning the voice / CW spots shown, ' + sec + ' s each. Tap a spot (or STOP) to stay there. Long-press SCAN to change the time.', 5000);
  };
  $('spScan').oncontextmenu = e => { e.preventDefault(); const v = [5, 10, 15, 20, 30], i = v.indexOf(+S.scanS || 10); S.scanS = v[(i + 1) % v.length]; save(); AP.toast('Scan: ' + S.scanS + ' s per spot.', 2000); if (scanT) { scanStop(); $('spScan').click(); } };
  document.addEventListener('click', e => { if (scanT && e.target.closest('.sp1')) scanStop(); }, true);

  /* ---------------- WHO HEARD ME (PSKReporter, no key; at most once every 5 minutes, as they ask) ---------------- */
  let heardAt = 0, heardL = [];
  $('spHeard').onclick = async () => {
    const me = AP.myCall(); if (!me) { AP.toast('Put your call in STATION first.', 3000, 'bad'); return; }
    if (Date.now() - heardAt > 300000) {
      AP.toast('Asking PSKReporter who heard ' + esc(me) + '…', 4000);
      try { const r = await AP.net.raw('https://retrieve.pskreporter.info/query?senderCallsign=' + encodeURIComponent(me) + '&flowStartSeconds=-1800&rronly=1&noactive=1&appcontact=kentuckyportableclub%40gmail.com', { ms: 20000 });
        if (!r.ok) throw new Error(r.err || 'HTTP ' + r.status); heardAt = Date.now();
        const at = (t, k) => { const m = t.match(new RegExp(k + '="([^"]*)"')); return m ? m[1] : ''; };
        heardL = (r.text.match(/<receptionReport [^>]*>/g) || []).map(t => ({ call: at(t, 'receiverCallsign'), loc: at(t, 'receiverLocator'), khz: +at(t, 'frequency') / 1000, mode: at(t, 'mode'), snr: at(t, 'sNR'), t: +at(t, 'flowStartSeconds') * 1000 })).filter(x => x.call).sort((a, b) => b.t - a.t);
      } catch (e) { AP.toast('PSKReporter did not answer: ' + esc(e.message), 5000, 'bad'); return; }
    }
    const my = AP.gridLL ? AP.gridLL(AP.myGrid ? AP.myGrid() : '') : null;
    const dist = x => { const g = AP.gridLL ? AP.gridLL(x.loc) : null; if (!g || !my) return ''; const km = G.KPCAX25 ? KPCAX25.geo(my.la, my.lo, g.la, g.lo).km : 111 * Math.hypot(g.la - my.la, (g.lo - my.lo) * Math.cos(my.la * Math.PI / 180)); return AP.dist ? AP.dist(km) : Math.round(km) + ' km'; };
    const far = heardL.slice().sort((a, b) => (parseFloat(dist(b)) || 0) - (parseFloat(dist(a)) || 0))[0];
    AP.sheet('📡 Who heard ' + esc(me), heardL.length ? `<p class="hint">${heardL.length} reports in the last 30 minutes${far ? ' · farthest: <b>' + esc(far.call) + '</b> ' + esc(dist(far)) : ''}. From PSKReporter (stations running WSJT-X, skimmers and the like).</p><div class="oplist">${heardL.slice(0, 80).map(x => `<div class="op"><b>${esc(x.call)}</b> <span>${esc(x.loc)} · ${esc(dist(x))}</span><i>${(x.khz / 1000).toFixed(3)} ${esc(x.mode)}${x.snr ? ' · ' + esc(x.snr) + ' dB' : ''} · ${age(x.t)}</i></div>`).join('')}</div>`
      : '<p>Nobody reported hearing you in the last 30 minutes. Call CQ on FT8 or CW for a few minutes, then look again (PSKReporter is asked at most every 5 minutes).</p>');
  };

  /* ---------------- the first source: my own FT8 / FT4 decodes (CQ POTA / SOTA / WWFF heard here) ---------------- */
  let seenSlot = -1;
  /* Oct 26 (Brandon: 'my decodes, not sure it does anything'): stations my own FT8/FT4 screen hears calling CQ POTA / SOTA / WWFF land here (needs the FT8 screen listening) */
  source({ id: 'own', label: '📶 CQ POTA on my FT8', title: 'Stations your own FT8 / FT4 screen hears calling CQ POTA, SOTA or WWFF (and APRS park beacons): no internet needed, only the FT8 screen listening.' });
  AP.on('decoded', sl => {
    if (!G.KPCDigi || sl === seenSlot || typeof sl !== 'number') return; seenSlot = sl;
    const L = KPCDigi.lines().filter(x => x.sep == null && x.sl === sl && x.cq && /^(POTA|SOTA|WWFF|KFF)$/.test(x.cqw || '') && x.fr && !/\.\.\./.test(x.fr));
    if (L.length) feed('own', L.map(x => ({ call: x.fr, khz: KPCDigi.dialKhz() + x.hz / 1000, mode: KPCDigi.mode(), refs: [], t: x.t * 1000, comment: 'CQ ' + x.cqw + ' heard here', grid: x.grid })));
  });
  AP.on('screen', s => { if (s === 'spots') draw(); });
  draw(); filtDraw();
  /* Oct 27 (Fable; from POTACAT's spots-on-the-panadapter idea, Brandon: 'borrow #2'): a SPOTS-ON-THIS-BAND strip for the RADIO tab and the
     mode screens — the shown spots on one band (and, where asked, one mode group), newest first, as chips: tap = the screen's own tune.
     KPCSpots.strip(host, { band, modes: /CW/ | null, max, tap(s) }) → redraw with strip.update(); bandCounts() = {band: n} for badges. */
  function strip(host, o) {
    if (!host) return null; o = o || {}; const st = { host, o };
    st.update = (p) => { if (p) Object.assign(o, p); const band = typeof o.band === 'function' ? o.band() : o.band; if (!band) { host.hidden = true; return; }
      const L = shown().filter(s => s.band === band && (!o.modes || o.modes.test(String(s.mode || '')))).slice(0, o.max || 14);
      host.hidden = !L.length; if (!L.length) { host.innerHTML = ''; return; }
      host.innerHTML = `<span class="kv"><i>ON ${esc(band)}</i><b>${L.length}</b></span>` + L.map(s => { const np = newPk(s), wk = G.KPCLog && KPCLog.worked(s.call); return `<button type="button" class="chip spc${np ? ' np' : ''}${wk ? ' wk' : ''}" data-spc="${s.id}" title="${esc([s.refs.join('+'), s.comment, age(s.t) + ' ago by ' + (s.spotter || s.src.join('+'))].filter(Boolean).join(' · '))}"><b>${esc(s.call)}</b> ${mhz(s.khz)} <i>${esc(s.mode || '')}</i>${s.refs.length ? ' <em>' + (np ? '★' : '🌲') + '</em>' : ''}${wk ? ' ✓' : ''}</button>`; }).join(''); };
    host.addEventListener('click', e => { const b = e.target.closest('[data-spc]'); if (!b) return; const s = SP.find(x => x.id === +b.dataset.spc); if (!s) return; if (o.tap) o.tap(s); else tune(s); });
    STRIPS.push(st); st.update(); return st;
  }
  const STRIPS = [];
  const bandCounts = () => { const c = {}; shown().forEach(s => { if (s.band) c[s.band] = (c[s.band] || 0) + 1; }); return c; };
  const redrawStrips = () => STRIPS.forEach(s => { try { s.update(); } catch (e) {} });
  AP.on('spots', redrawStrips); AP.on('log', redrawStrips); setInterval(redrawStrips, 60000);
  G.KPCSpots = { S, save, source, feed, all: () => SP.slice(), shown, open, tune, sources: () => SRC, draw, strip, bandCounts, redrawStrips };
})(window);
