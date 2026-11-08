/* KPCPota: sign in to POTA inside the app → my stats, parks hunted / activated, award progress, awards earned
   (Opus, Oct 30; Brandon: 'add pota sign in for stats and current parks hunted etc').
   How: pota.app's OWN page opens (Android: KpcPota plugin, a full-screen WebView; Windows: a window of its own); the member
   signs in there, so the app never sees the password. The FINDER script reads pota.app's sign-in ticket (the Cognito id
   token + refresh token kept in its storage); the app keeps it ONLY on this device (localStorage kpcAppPotaAuth: never in a
   backup or a builders' report) and asks api.pota.app the same questions pota.app's own My Stats / Achievements pages ask
   (the same calls as the website's Hunters Lounge bookmark, kpc-pota-bm.js). The id ticket lasts an hour; the refresh
   ticket gets a new one without signing in again (Cognito REFRESH_TOKEN_AUTH). Synced once a day by itself.
   The hunted / activated park lists feed KPCLog.potaSet() = the same place 📄 MY POTA FILES fills (NEW badges, need alert, NEXT PARK). */
(function () {
  const G = window, AP = G.KPCApp; if (!AP) return;
  const $ = id => document.getElementById(id), esc = AP.esc;
  const AK = 'kpcAppPotaAuth', SK = 'kpcAppPotaStats';
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let AUTH = get(AK, null), ST = get(SK, null), BUSY = false, PLUG = null;

  /* runs ON pota.app: the sign-in ticket as JSON, or null while not signed in yet */
  const FINDER = "(function(){try{var o={},i,k,m;for(i=0;i<localStorage.length;i++){k=localStorage.key(i);m=k.match(/^CognitoIdentityServiceProvider\\.([^.]+)\\.(.+)\\.(idToken|refreshToken)$/);if(m){o.client=m[1];o.user=m[2];o[m[3]]=localStorage.getItem(k);}}if(o.idToken)return JSON.stringify(o);"
    + "for(i=0;i<localStorage.length;i++){var v=String(localStorage.getItem(localStorage.key(i))||''),x=v.match(/eyJ[\\w-]+\\.eyJ[\\w-]+\\.[\\w-]+/);if(x){try{var p=JSON.parse(atob(x[0].split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(p.token_use==='id'||p['pota:callsign'])return JSON.stringify({idToken:x[0]});}catch(e){}}}return null}catch(e){return null}})()";
  const body = t => { try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };

  function setAuth(o) {
    const b = body(o.idToken);
    AUTH = { id: o.idToken, rt: o.refreshToken || '', client: o.client || '', region: (String(b.iss || '').match(/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com/) || [])[1] || '',
      call: String(b['pota:callsign'] || '').toUpperCase(), exp: (+b.exp || 0) * 1000, t: Date.now() };
    put(AK, AUTH);
  }
  async function signIn() {
    let raw = null;
    try {
      if (G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform()) {
        if (!PLUG) PLUG = G.Capacitor.registerPlugin('KpcPota');
        const r = await PLUG.signIn({ finder: FINDER, url: 'https://pota.app/' }); raw = r && r.json;
      } else if (G.kpcNet && G.kpcNet.potaSignIn) raw = await G.kpcNet.potaSignIn(FINDER);
      else if (G.KPC_POTA_TEST) raw = await G.KPC_POTA_TEST(FINDER);   /* the tests stand in for pota.app here */
      else { AP.toast('Signing in to POTA works in the KPC app (phone, tablet or Windows). In a web browser use 📄 MY POTA FILES.', 6000, 'bad'); return false; }
    } catch (e) { const m = String(e && e.message || e); AP.toast(/closed/.test(m) ? 'POTA sign-in closed.' : 'POTA sign-in: ' + esc(m), 4000); return false; }
    let o = raw; for (let i = 0; i < 2 && typeof o === 'string'; i++) { try { o = JSON.parse(o); } catch (e) { break; } }
    if (!o || !o.idToken) { AP.toast('The app could not find your POTA sign-in. Sign in on the page and wait for your call to show at the top, then it closes by itself.', 7000, 'bad'); return false; }
    setAuth(o); AP.fire('potastats');
    return sync();
  }
  async function token() {
    if (!AUTH) return '';
    if (AUTH.exp > Date.now() + 60000) return AUTH.id;
    if (AUTH.rt && AUTH.client && AUTH.region) {
      const r = await AP.net.raw('https://cognito-idp.' + AUTH.region + '.amazonaws.com/', { method: 'POST', ms: 15000,
        headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        body: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: AUTH.client, AuthParameters: { REFRESH_TOKEN: AUTH.rt } }) }).catch(() => null);
      let j = null; try { j = r && JSON.parse(r.text); } catch (e) {}
      const id = j && j.AuthenticationResult && j.AuthenticationResult.IdToken;
      if (id) { AUTH.id = id; AUTH.exp = (+body(id).exp || 0) * 1000; put(AK, AUTH); return id; }
    }
    return '';
  }
  const KEYS = ['hunter/parks', 'activator/parks', 'hunter/dxentity', 'activator/dxentity', 'activator/p2p', 'hunter/earlyshift', 'hunter/lateshift', 'activator/earlyshift', 'activator/lateshift'];
  async function sync(quiet) {
    if (BUSY) return false; BUSY = true;
    try {
      const t = await token();
      if (!t) { if (!quiet) AP.toast('Your POTA sign-in has run out: tap 🔑 SIGN IN TO POTA again.', 6000, 'bad'); return false; }
      const H = { Authorization: t };
      const ask = async u => { const r = await AP.net.raw(u, { headers: H, ms: 20000 }).catch(() => null); if (r && (r.status === 401 || r.status === 403)) throw new Error('auth'); if (!r || !r.ok) return null; try { return JSON.parse(r.text); } catch (e) { return null; } };
      const both = await ask('https://api.pota.app/user/stats/hunted_activated_list?type=both');
      if (!both) throw new Error('POTA did not answer (no signal, or pota.app is busy). Try again in a minute.');
      const B = 'https://api.pota.app/user/award/progress/';
      const pr = await Promise.all(KEYS.map(k => ask(B + k)));
      const earned = await ask('https://api.pota.app/user/award/earned');
      const h = Array.isArray(both.hunted) ? both.hunted : [], a = Array.isArray(both.activated) ? both.activated : [];
      const S2 = { t: Date.now(), call: AUTH.call, nh: h.length, na: a.length, aw: {}, loc: {},
        earned: (Array.isArray(earned) ? earned : []).map(x => [x.awardName || x.name || '', x.dateGranted || x.date || '', x.endorsements || '', x.reference || '']) };
      KEYS.forEach((k, i) => { S2.aw[k] = pr[i]; });
      h.forEach(x => String(x.locationDesc || x.location || '').split(',').forEach(l => { l = l.trim(); if (l) S2.loc[l] = (S2.loc[l] || 0) + 1; }));
      const refsOf = L => L.map(x => String(x.reference || x.ref || '').toUpperCase()).filter(r => /^[A-Z0-9]{1,4}-\d{4,6}$/.test(r));
      if (G.KPCLog && KPCLog.potaSet) { if (h.length) KPCLog.potaSet('h', refsOf(h), 'pota.app sign-in'); if (a.length) KPCLog.potaSet('a', refsOf(a), 'pota.app sign-in'); }
      ST = S2; put(SK, ST); AP.fire('potastats');
      if (!quiet) AP.toast('✅ POTA for ' + esc(S2.call || 'you') + ': ' + S2.nh.toLocaleString() + ' parks hunted · ' + S2.na.toLocaleString() + ' activated · ' + S2.earned.length + ' awards', 5000, 'log');
      return true;
    } catch (e) {
      if (e.message === 'auth') { if (AUTH) { AUTH.exp = 0; put(AK, AUTH); } if (!quiet) AP.toast('POTA says the sign-in is no good any more: tap 🔑 SIGN IN TO POTA again.', 6000, 'bad'); }
      else if (!quiet) AP.toast(esc(e.message || String(e)), 6000, 'bad');
      return false;
    } finally { BUSY = false; draw(); }
  }
  /* ---------------- Google sign-ins: the KPC ⭐ bookmark on pota.app hands a summary over as kpcapp://pota?z=… ----------------
     (Brandon Oct 30: 'I use Google login to sign into pota so that needs to work too'; Google blocks its sign-in inside apps,
     so the member signs in in Chrome / Edge as always; the website's kpc-pota-bm.js?app=1 builds the link) */
  const BM = "javascript:(function(){var s=document.createElement('script');s.src='https://kentuckyportableclub.github.io/KPC-Links/kpc-pota-bm.js?app=1&t='+Date.now();document.head.appendChild(s)})()";
  const ungrp = s3 => { const out = []; String(s3 || '').split('_').forEach(g => { const m = g.split('~'); if (m.length === 2 && m[0]) m[1].split('.').forEach(n => { if (n) out.push(m[0] + '-' + String(n).padStart(4, '0')); }); }); return out; };
  async function fromLink(url) {
    const m = String(url || '').match(/^kpcapp:\/\/pota\/?\?(?:.*&)?z=([A-Za-z0-9_-]+)/i); if (!m) return false;
    let P = null;
    try {
      const b = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      P = JSON.parse(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
    } catch (e) { AP.toast('The POTA hand-off could not be read (' + esc(e.message || e) + '). Tap the bookmark on pota.app again.', 7000, 'bad'); return false; }
    if (!P || P.v !== 1) return false;
    const h = ungrp(P.h), a = ungrp(P.a);
    if (G.KPCLog && KPCLog.potaSet) { if (h.length) KPCLog.potaSet('h', h, 'pota.app (bookmark)'); if (a.length) KPCLog.potaSet('a', a, 'pota.app (bookmark)'); }
    ST = { t: +P.t || Date.now(), call: String(P.call || '').toUpperCase(), nh: +P.nh || h.length, na: +P.na || a.length, aw: P.n || {}, loc: P.loc || {}, ec: +P.ec || 0,
      earned: (P.e || []).map(x => [x[0] || '', x[1] || '', x[2] || '', x[4] || x[3] || '']), src: 'bookmark' };
    put(SK, ST); AP.fire('potastats');
    AP.toast('✅ POTA for ' + esc(ST.call || 'you') + ': ' + ST.nh.toLocaleString() + ' parks hunted · ' + ST.na.toLocaleString() + ' activated' + (ST.ec ? ' · ' + ST.ec + ' awards' : '') + ' (from the bookmark)', 6000, 'log');
    if (!open) sheet();
    return true;
  }
  async function takeLink() {
    try {
      let l = '';
      if (G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform()) { if (!PLUG) PLUG = G.Capacitor.registerPlugin('KpcPota'); const r = await PLUG.takeLink(); l = r && r.link; }
      else if (G.kpcNet && G.kpcNet.linkTake) l = await G.kpcNet.linkTake();
      if (l) await fromLink(l);
    } catch (e) {}
  }
  if (G.kpcNet && G.kpcNet.onLink) G.kpcNet.onLink(l => { fromLink(l); });
  setTimeout(takeLink, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) takeLink(); });
  function bmSheet() {
    open = false;
    AP.sheet('🔖 POTA with a Google sign-in', `<p class="hint">Google does not let apps show its sign-in page, so you sign in to POTA in your browser as always, and a KPC bookmark there hands your numbers to the app.</p>
      <h3 class="sh">Once: make the bookmark</h3>
      <ol class="hint" style="margin:0 0 10px 18px;padding:0"><li>Tap <b>COPY THE BOOKMARK</b> below.</li><li>In <b>Chrome</b> (or Edge): ☆ bookmark any page, then <b>edit</b> it: name it <b>KPC to app</b> and paste over its address.</li></ol>
      <div class="row"><button type="button" class="b gold" id="bmCopy">📋 COPY THE BOOKMARK</button></div>
      <h3 class="sh">Each time</h3>
      <ol class="hint" style="margin:0 0 10px 18px;padding:0"><li>Open <b>pota.app</b> and sign in with Google (your call shows at the top).</li><li>Phone: type <b>KPC to app</b> in the address bar and tap the bookmark in the list. PC: click it in the bookmarks bar.</li><li>Tap <b>OPEN IN KPC APP</b> (choose KPC if asked).</li></ol>
      <div class="row"><button type="button" class="b" id="bmOpen">🌐 OPEN POTA.APP</button><button type="button" class="b" id="bmBack">‹ BACK</button></div>
      <p class="hint">Only your numbers come over (parks hunted / activated, awards, states); your sign-in stays on pota.app.</p>`);
    $('bmCopy').onclick = async () => { let ok = false; try { await navigator.clipboard.writeText(BM); ok = true; } catch (e) {} if (!ok) { const t = document.createElement('textarea'); t.value = BM; document.body.appendChild(t); t.select(); try { ok = document.execCommand('copy'); } catch (e) {} t.remove(); } AP.toast(ok ? '📋 Copied. Now make the bookmark in Chrome / Edge.' : 'Could not copy here.', 4000, ok ? 'log' : 'bad'); };
    $('bmOpen').onclick = () => { try { window.open('https://pota.app/', '_blank'); } catch (e) {} };
    $('bmBack').onclick = () => { AP.shut(); sheet(); };
  }
  function signOut() { AUTH = null; put(AK, null); AP.toast('Signed out: the app forgot its POTA sign-in on this device (your stats stay until you clear them).', 5000); draw(); }

  /* ---------------- the stats sheet (the Hunters Lounge's tiles) ---------------- */
  const FE = [0, 10, 20, 30, 40, 50, 75, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000];
  const numOf = (o, ...k) => { if (o == null) return null; if (typeof o === 'number') return o; for (const x of k) if (o[x] != null && isFinite(+o[x])) return +o[x]; const v = Object.values(o).find(v2 => typeof v2 === 'number'); return v == null ? null : v; };
  const nextOf = (v, s) => Array.isArray(s) ? (s.find(x => x > v) == null ? v : s.find(x => x > v)) : (Math.floor(v / s) + 1) * s;
  const prevOf = (v, s) => Array.isArray(s) ? Math.max(0, ...s.filter(x => x <= v)) : Math.floor(v / s) * s;
  function tile(lbl, v, step, unit) {
    if (v == null) return '';
    const n = nextOf(v, step), p0 = prevOf(v, step), pct = n > p0 ? Math.round((v - p0) / (n - p0) * 100) : 100;
    return `<div class="pt"><b>${v.toLocaleString()}</b><span>${lbl}</span><div class="pbar"><i style="width:${pct}%"></i></div><small>${n > v ? (n - v).toLocaleString() + ' more ' + unit + ' to ' + n.toLocaleString() : 'top level'}</small></div>`;
  }
  const US = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  function html() {
    const signed = !!AUTH, s = ST;
    const who = signed ? `Signed in as <b>${esc(AUTH.call || '?')}</b>${AUTH.rt ? '' : ' (this sign-in lasts about an hour)'}` : (ST && ST.src === 'bookmark' ? 'Brought over with the 🔖 bookmark. Tap it on pota.app again to refresh.' : 'Not signed in.');
    let body2 = '<p class="hint">Sign in once and the app brings over your POTA numbers: parks hunted and activated, award progress, awards earned, states hunted. It also marks parks that are <b>new to you</b> in SPOTS and NEXT PARK.</p>';
    if (s && s.t) {
      const n = (k, ...f) => numOf(s.aw && s.aw[k], ...f);
      const got = US.filter(a => s.loc && s.loc['US-' + a]), miss = US.filter(a => !(s.loc && s.loc['US-' + a]));
      const rec = (s.earned || []).slice().sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 6);
      body2 = `<div class="ptiles">${tile('PARKS HUNTED', n('hunter/parks', 'numParks', 'parks') == null ? s.nh : n('hunter/parks', 'numParks', 'parks'), FE, 'parks')}${tile('PARKS ACTIVATED', n('activator/parks', 'numParks', 'parks') == null ? s.na : n('activator/parks', 'numParks', 'parks'), FE, 'parks')}
        ${tile('PARK TO PARK', n('activator/p2p', 'contacts'), 25, 'contacts')}${tile('DX ENTITIES HUNTED', n('hunter/dxentity', 'numEntities'), 5, 'entities')}${tile('DX ENTITIES ACTIVATED', n('activator/dxentity', 'numEntities'), 5, 'entities')}
        ${tile('EARLY SHIFT HUNTER', n('hunter/earlyshift', 'contacts'), 100, 'contacts')}${tile('LATE SHIFT HUNTER', n('hunter/lateshift', 'contacts'), 100, 'contacts')}${tile('EARLY SHIFT ACTIVATOR', n('activator/earlyshift', 'contacts'), 100, 'contacts')}${tile('LATE SHIFT ACTIVATOR', n('activator/lateshift', 'contacts'), 100, 'contacts')}</div>
        <h3 class="sh">🗺 States hunted: ${got.length} of 50</h3><p class="hint">${miss.length ? 'Still needed: ' + miss.join(' ') : 'All 50! 🎉'}</p>
        <h3 class="sh">🎖 Awards earned: ${(s.ec || (s.earned || []).length).toLocaleString()}</h3>${rec.length ? '<ul class="helpl">' + rec.map(e => `<li>${esc(e[0])}${e[3] ? ' · ' + esc(e[3]) : ''} <small>${esc(String(e[1]).slice(0, 10))}</small></li>`).join('') + '</ul>' : '<p class="hint">None yet.</p>'}
        <p class="hint">From POTA for ${esc(s.call || 'you')}, ${new Date(s.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. POTA updates achievements once a day, and a hunter gets credit only after the activator's log is in.</p>`;
    }
    return `<p>${who}</p>${body2}
      <div class="row">${signed ? '<button type="button" class="b gold" id="ptSync">🔄 SYNC NOW</button><button type="button" class="b" id="ptOut">SIGN OUT</button>' : '<button type="button" class="b gold" id="ptIn">🔑 SIGN IN TO POTA (email + password)</button>'}<button type="button" class="b" id="ptBm">🔖 I SIGN IN WITH GOOGLE</button></div>
      <p class="hint">Email + password: you sign in on <b>pota.app's own page</b>; the app never sees your password. Google: Google does not allow its sign-in inside apps, so use 🔖 (the KPC bookmark in your browser). It keeps the sign-in only on this device and only reads your own POTA numbers. KPC is an independent ham radio club, not part of Parks on the Air®.</p>`;
  }
  let open = false;
  function sheet() { open = true; AP.sheet('📊 My POTA stats', html()); wire(); }
  function wire() {
    if ($('ptIn')) $('ptIn').onclick = () => signIn();
    if ($('ptSync')) $('ptSync').onclick = () => { $('ptSync').textContent = '… ASKING POTA'; sync(); };
    if ($('ptOut')) $('ptOut').onclick = signOut;
    if ($('ptBm')) $('ptBm').onclick = bmSheet;
  }
  function draw() { const b = $('sheetB'), t = $('sheetT'); if (open && b && t && /My POTA stats/.test(t.textContent) && !$('sheet').hidden) { b.innerHTML = html(); wire(); } else open = false; }
  AP.on('potastats', draw);
  if ($('stPotaS')) $('stPotaS').onclick = sheet;
  /* once a day by itself, quietly */
  const daily = () => { if (AUTH && AUTH.rt && (!ST || Date.now() - ST.t > 20 * 3600e3)) sync(true); };
  setTimeout(daily, 25000); setInterval(daily, 3 * 3600e3);
  G.KPCPota = { sheet, signIn, sync, signOut, fromLink, bookmark: () => BM, signedIn: () => !!AUTH, stats: () => ST, _finder: FINDER };
})();
