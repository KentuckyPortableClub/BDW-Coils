/* KPC app: THE UPLOAD QUEUE (Fable, Oct 22). Every contact can go to the loggers Brandon uses; uploads wait in line and go
   by themselves when the phone has signal again (a park with no service). Each record carries `up: {qrz:'ok'|'fail', eqsl:…}`,
   which syncs with the log, so the PC at home can finish what the phone could not, and nothing goes twice.
   Targets now: QRZ logbook (API key), eQSL (user + password), Wavelog (URL + API key). Listed, not live: POTA (step 4 sign-in),
   LoTW (needs TQSL on a PC: save the ADIF and sign it there). Keys live only on this device (localStorage kpcAppUp; the
   builders' report never includes them). */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const AP = G.KPCApp, esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const U = Object.assign({ qrz: { on: false, key: '' }, eqsl: { on: false, user: '', pass: '', nick: '' }, wavelog: { on: false, url: '', key: '', profile: '1' }, sent: {} }, LS('kpcAppUp', {}));
  const save = () => SV('kpcAppUp', U);
  const one = q => G.KPCLog.adif([q]).replace(/^[\s\S]*?<EOH>\s*/i, '');   /* one record, no header */
  const T = {
    qrz: {
      label: 'QRZ logbook', ready: () => !!U.qrz.key, why: 'needs your QRZ logbook API key (QRZ.com → Logbook → Settings → API key; a QRZ subscription with the logbook API)',
      async send(q) {
        const r = await AP.net.raw('https://logbook.qrz.com/api', { method: 'POST', body: new URLSearchParams({ KEY: U.qrz.key, ACTION: 'INSERT', ADIF: one(q) }), ms: 15000 });
        if (!r.ok && !r.text) throw new Error(r.err || 'no answer');
        if (/RESULT=(OK|REPLACE)/.test(r.text) || /duplicate/i.test(r.text)) return 'ok';
        const why = decodeURIComponent(((/REASON=([^&]*)/.exec(r.text) || [, ''])[1]).replace(/\+/g, ' ')).trim();
        if (/AUTH/.test(r.text)) throw Object.assign(new Error('QRZ refused the key' + (why ? ': ' + why : '')), { stop: true });
        throw new Error(why || r.text.slice(0, 80) || 'HTTP ' + r.status);
      }
    },
    eqsl: {
      label: 'eQSL', ready: () => !!(U.eqsl.user && U.eqsl.pass), why: 'needs your eQSL user name and password',
      async send(q) {
        const adif = 'KPC\n<EOH>\n' + one(q);
        const r = await AP.net.raw('https://www.eqsl.cc/qslcard/ImportADIF.cfm', { method: 'POST', body: new URLSearchParams(Object.assign({ EQSL_USER: U.eqsl.user, EQSL_PSWD: U.eqsl.pass, ADIFData: adif }, U.eqsl.nick ? { QTHNickname: U.eqsl.nick } : {})), ms: 20000 });
        if (!r.text) throw new Error(r.err || 'no answer');
        if (/Result:\s*\d+ out of \d+ records? added|Duplicate/i.test(r.text)) return 'ok';
        if (/No such Username|Password incorrect|Error: No such/i.test(r.text)) throw Object.assign(new Error('eQSL refused the user name or password'), { stop: true });
        const m = /Error:\s*([^<\n]{0,100})/i.exec(r.text); throw new Error(m ? m[1].trim() : 'eQSL did not say added (HTTP ' + r.status + ')');
      }
    },
    wavelog: {
      label: 'Wavelog', ready: () => !!(U.wavelog.url && U.wavelog.key), why: 'needs the Wavelog address and an API key (Wavelog → account → API keys)',
      async send(q) {
        const url = U.wavelog.url.replace(/\/+$/, '') + '/api/qso';
        const r = await AP.net.raw(url, { method: 'POST', body: { key: U.wavelog.key, station_profile_id: U.wavelog.profile || '1', type: 'adif', string: one(q) }, ms: 15000 });
        if (!r.text) throw new Error(r.err || 'no answer');
        if (/"status"\s*:\s*"created"|"created"/i.test(r.text)) return 'ok';
        if (/"status"\s*:\s*"failed".*(key|auth)/i.test(r.text)) throw Object.assign(new Error('Wavelog refused the key'), { stop: true });
        throw new Error(r.text.slice(0, 80));
      }
    },
    pota: { label: 'POTA', ready: () => false, why: 'comes with the POTA sign-in (step 4); until then SAVE ADIF FILE and upload it on pota.app', soon: true },
    lotw: { label: 'LoTW', ready: () => false, why: 'LoTW only takes files signed by TQSL on a computer: SAVE ADIF FILE, then sign and upload it there', soon: true }
  };
  const waiting = t => G.KPCLog ? [...KPCLog.all().values()].filter(q => !q.d && q.t > Date.now() - 366 * 86400000 && !(q.up && q.up[t] === 'ok')).sort((a, b) => a.t - b.t) : [];
  let busy = false;
  async function flush(force) {
    if (busy || !G.KPCLog || !AP.net.online()) return 0;
    busy = true; let n = 0;
    try {
      for (const t in T) {
        if (!U[t] || !U[t].on || !T[t].ready()) continue;
        const L = waiting(t).filter(q => force || !(q.up && q.up[t] && /^fail/.test(q.up[t]) && q.up[t + 'T'] > Date.now() - 3600000)).slice(0, 25);
        for (const q of L) {
          try { const r = await T[t].send(q); mark(q, t, r); n++; U.sent[t] = (U.sent[t] || 0) + 1; }
          catch (e) { mark(q, t, 'fail: ' + (e.message || e)); if (e.stop) { AP.toast('☁ ' + T[t].label + ': ' + esc(e.message) + '. Check it in STATION → Log files → UPLOADS.', 8000, 'bad'); break; } }
        }
      }
    } finally { busy = false; save(); draw(); }
    if (n) AP.toast('☁ ' + n + ' contact' + (n > 1 ? 's' : '') + ' uploaded.', 3000, 'log');
    return n;
  }
  function mark(q, t, r) { const up = Object.assign({}, q.up || {}); up[t] = r; up[t + 'T'] = Date.now(); KPCLog.edit(q.id, { up }); }
  function status() { return Object.keys(T).filter(t => U[t] && U[t].on).map(t => T[t].label + ': ' + (U.sent[t] || 0) + ' sent · ' + waiting(t).length + ' waiting').join(' · ') || 'No uploads turned on.'; }
  function draw() { const e = $('stUpT'); if (e) e.textContent = status(); }
  /* Oct 23 (Brandon: 'need to hide that info too once it is entered' + 'box on or off be easier'): one big ON/OFF per service,
     keys and passwords show as dots (👁 = peek), and typing a key into a service that was off turns it on. */
  const SECRET = { key: 1, pass: 1 };
  function sheet() {
    const was = {}; ['qrz', 'eqsl', 'wavelog'].forEach(t => { was[t] = JSON.stringify(U[t]); });
    const f = (t, k, lab) => SECRET[k]
      ? `<label class="e">${lab}<span class="upk"><input id="up_${t}_${k}" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(U[t][k] || '')}"><button type="button" class="b sm" data-peek="up_${t}_${k}" title="Show it">👁</button></span></label>`
      : `<label class="e">${lab}<input id="up_${t}_${k}" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(U[t][k] || '')}"></label>`;
    const sw = (t, txt) => `<button type="button" class="b upsw${U[t].on ? ' on' : ''}" id="up_${t}_on" data-on="${U[t].on ? 1 : 0}" aria-pressed="${U[t].on}"><b>${U[t].on ? 'ON' : 'OFF'}</b> <span>${txt}</span></button>`;
    AP.sheet('Uploads', `
      <p class="hint">${esc(status())}. Contacts go up by themselves when there is signal; nothing goes twice. Keys stay on this device.</p>
      <h3 class="sh">QRZ logbook</h3>${sw('qrz', 'Send every contact to my QRZ logbook')}
      ${f('qrz', 'key', 'QRZ LOGBOOK API KEY')}
      <h3 class="sh">eQSL</h3>${sw('eqsl', 'Send every contact to eQSL')}
      <div class="grid2">${f('eqsl', 'user', 'EQSL USER NAME')}${f('eqsl', 'pass', 'EQSL PASSWORD')}${f('eqsl', 'nick', 'QTH NICKNAME (IF YOU USE ONE)')}</div>
      <h3 class="sh">Wavelog</h3>${sw('wavelog', 'Send every contact to Wavelog')}
      <div class="grid2">${f('wavelog', 'url', 'WAVELOG ADDRESS (https://…)')}${f('wavelog', 'key', 'API KEY')}${f('wavelog', 'profile', 'STATION PROFILE ID')}</div>
      <h3 class="sh">Not yet</h3>
      <p class="hint">POTA: ${esc(T.pota.why)}. LoTW: ${esc(T.lotw.why)}.</p>
      <div class="row"><button type="button" class="b gold" id="upGo">☁ SEND WHAT IS WAITING NOW</button><button type="button" class="b" id="upRetry">↻ TRY THE FAILED ONES AGAIN</button></div>
      ${AP.can.raw ? '' : '<div class="st bad">In a browser tab these sites may refuse the app; the Windows and Android apps send straight.</div>'}`,
      () => {
        ['qrz', 'eqsl', 'wavelog'].forEach(t => {
          const b = $('up_' + t + '_on'), touched = b.dataset.touched === '1';
          U[t].on = b.dataset.on === '1';
          Object.keys(U[t]).forEach(k => { const e = $('up_' + t + '_' + k); if (e && e.tagName === 'INPUT') U[t][k] = e.value.trim(); });
          if (!touched && !U[t].on && T[t].ready() && JSON.stringify(Object.assign({}, U[t], { on: false })) !== JSON.stringify(Object.assign(JSON.parse(was[t]), { on: false }))) U[t].on = true;   /* new key typed → on */
          if (U[t].on && !T[t].ready()) { U[t].on = false; AP.toast(T[t].label + ' ' + T[t].why + '.', 6000, 'bad'); }
        });
        save(); draw(); flush();
      });
    document.querySelectorAll('.upsw').forEach(b => b.onclick = () => { const on = b.dataset.on !== '1'; b.dataset.on = on ? '1' : '0'; b.dataset.touched = '1'; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.querySelector('b').textContent = on ? 'ON' : 'OFF'; });
    document.querySelectorAll('[data-peek]').forEach(b => b.onclick = () => { const e = $(b.dataset.peek); e.type = e.type === 'password' ? 'text' : 'password'; });
    $('upGo').onclick = () => { AP.shut(); flush(); };
    $('upRetry').onclick = () => { AP.shut(); flush(true); };
  }
  const b = $('stUp'); if (b) b.onclick = sheet;
  AP.on('log', ev => { if (ev && /^(add|merge|file|adif)$/.test(ev.why)) setTimeout(() => flush(), 1500); });
  AP.on('online', on => { if (on) flush(); });
  setInterval(() => flush(), 120000);
  draw(); setTimeout(() => flush(), 8000);
  G.KPCUp = { U, save, flush, waiting, status, targets: T, sheet };
})(window);
