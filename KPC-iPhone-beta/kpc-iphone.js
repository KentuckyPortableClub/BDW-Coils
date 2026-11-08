/* KPC app: THE iPHONE PAGE (Opus, Nov 8 2026; Brandon: 'the apple mobile webpage for the app and remote').
   There is no KPC app for iPhone, so an iPhone (or iPad, or any browser) opens the app's own page, either
   - from the PC with the radio:  http://<PC address>:8731/phone/  at home (listen + run the radio, no talking: Safari only allows the
     microphone on https), or  https://<pc>.<tailnet>.ts.net/phone/  through 'tailscale serve' (everything, talking too, home or away), or
   - from the iPhone beta website (GitHub Pages, https): type the PC's Tailscale address  wss://<pc>.<tailnet>.ts.net  in PC ADDRESS.
   What this file does (only on an iPhone / iPad, ?iphone=1, or a page the PC handed out):
   - fills PC ADDRESS with the PC that handed out the page (ws:// or wss:// to match http / https)
   - a first-time welcome: what works on an iPhone and what needs the PC; 'Add to Home Screen' tip
   - every tap wakes the sound back up (Safari stops it without a tap), and keeps the screen awake while on the link (the sound stops
     when the screen locks: Apple's rule for web pages)
   - goes straight to the REMOTE screen once paired.
   The microphone part (open only while you hold TALK) is in kpc-remote.js (LAZY). */
(function (G) {
  'use strict';
  const AP = G.KPCApp; if (!AP) return;
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const FROM_PC = /^\/phone\//.test(location.pathname);
  const ON = IOS || FROM_PC || /[?&]iphone=1/.test(location.search);
  if (!ON) return;
  document.documentElement.dataset.iphone = '1';
  const S = AP.S, $ = id => document.getElementById(id), esc = AP.esc;
  const standalone = !!(navigator.standalone || (G.matchMedia && matchMedia('(display-mode: standalone)').matches));

  /* the PC that handed out this page is the PC to pair with */
  if (FROM_PC) {
    const me = (location.protocol === 'https:' ? 'wss://' : '') + location.host;
    const list = String(S.rmAddr || '').split(/[\s,;]+/).filter(Boolean);
    if (!list.includes(me)) { S.rmAddr = [me].concat(list).join(' '); AP.save(); }
  }
  const secure = G.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /* Safari: sound only starts / comes back after a tap */
  const wake = () => { try { if (G.KPCRemote && KPCRemote._unlock) KPCRemote._unlock(); } catch (e) {} };
  document.addEventListener('touchend', wake, { passive: true }); document.addEventListener('click', wake, true);

  /* keep the screen on while on the link (iOS 16.4+) */
  let lock = null;
  async function keepAwake() {
    const on = G.KPCRemote && KPCRemote.link && KPCRemote.link().paired && document.visibilityState === 'visible';
    try { if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } else if (!on && lock) { await lock.release(); lock = null; } } catch (e) { lock = null; }
  }
  document.addEventListener('visibilitychange', () => { keepAwake(); if (document.visibilityState === 'visible') wake(); });
  setInterval(keepAwake, 5000);

  /* first time: what this page is */
  function hello() {
    if (S.iphoneHello) return;
    AP.sheet('📱 KPC on the iPhone', `<p>There is no KPC app for iPhone, so this page <b>is</b> the app. It runs your radio <b>through the KPC app on your Windows PC</b> (the PC has the radio on its USB cable): frequency, mode, 🎛 more controls, meters, 🔧 tune, hearing the radio, the voice keyer and the PC's FT8. The log and the spots work here too.</p>
      <ul class="helpl"><li><b>Talking</b> needs the https address (Tailscale). ${!FROM_PC ? 'On this website, put your PC\'s Tailscale address in PC ADDRESS (wss://your-pc.your-tailnet.ts.net): then listening, running the radio and talking all work.' : secure ? '✓ This page has it: hold 🎙 HOLD TO TALK and allow the microphone the first time.' : 'This page is the plain home address: you can listen and run the radio, but not talk. See the iPhone instructions for the Tailscale address.'}</li>
      <li>The sound stops when the screen locks or you switch apps (Apple's rule for web pages). The page keeps the screen on while you are on the link.</li>
      <li>An iPhone cannot plug into a radio itself (no USB / Bluetooth radio control in Safari).</li>
      ${standalone ? '' : '<li><b>Add it to your Home Screen</b> so it opens like an app: tap Safari\'s Share button ⬆, then <b>Add to Home Screen</b>.</li>'}</ul>
      <p>Next: <b>PAIR</b> with the PC (STATION → REMOTE LINK here, the 6-digit code from the PC).</p>
      <div class="row"><button type="button" class="b gold" id="iphOk">OK, PAIR NOW</button></div>`);
    $('iphOk').onclick = () => { S.iphoneHello = 1; AP.save(); AP.shut(); toPair(); };
  }
  function toPair() { AP.go('station'); setTimeout(() => { const a = $('rmLink') || $('rmAddr'); if (a) a.scrollIntoView({ block: 'center' }); }, 300); }

  /* a small strip on the STATION remote card */
  function strip() {
    const lk = $('rmLink'); if (!lk || $('iphNote')) return;
    lk.insertAdjacentHTML('afterbegin', `<p class="st ${secure ? 'ok' : ''}" id="iphNote">📱 ${FROM_PC ? 'This page came from your PC (' + esc(location.host) + ').' : 'iPhone page.'} ${secure ? 'https: listening, running the radio and talking all work.' : 'Plain address: listening and running the radio work; talking needs the Tailscale (https) address.'}</p>`);
  }
  new MutationObserver(() => strip()).observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    const paired = G.KPCRemote && KPCRemote.link && KPCRemote.link().paired;
    if (paired) AP.go('remote'); else if (!S.iphoneHello) hello(); else if (!S.rmTok) toPair();
    keepAwake();
  }, 1200);
  G.KPCIphone = { ios: IOS, fromPc: FROM_PC, secure, standalone, hello };
})(window);
