/* KPC app: ❓ HELP (Opus, Nov 6; Brandon: 'a help screen would be nice too').
   - ❓ in the top bar on EVERY screen: help for the screen you are on, with ALL HELP / SETUP WIZARD / SOMETHING NOT WORKING.
   - the ❓ HELP page: search box, every topic, a setup guide per radio (CAT, baud, USB sound, the DATA menu), the troubleshooter,
     the radios list (which controls each one takes, and which have been checked on a real radio), and 📝 WORKS ON MY RADIO.
   - 🧙 RADIO SETUP WIZARD: pick the radio → set its menus → plug in + connect → does the frequency match? → sound → done.
   - 📝 WORKS ON MY RADIO: tick what worked and what did not; the report is copied / shared / saved, and kept here (kpcAppWorks) so the
     radios list shows it. Send it to the club so the radio can be marked 'checked'. */
(function (G) {
  'use strict';
  const AP = G.KPCApp, $ = id => document.getElementById(id); if (!AP) return;
  const esc = AP.esc, K = G.KPCCat;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const WORKS = LS('kpcAppWorks', {});

  /* ================================================================ TOPICS (screen = the screen it belongs to) */
  const T = [
    { id: 'logs', s: 'logs', t: 'My logs', k: 'logs park activation hunt event new log open', h: 'Every log you keep: one per park activation, hunting day, contest or event. Tap one to open it; <b>+ NEW LOG</b> starts another. Contacts always land in the open log, and EVERY CONTACT shows them all.' },
    { id: 'log', s: 'log', t: 'Logging a contact', k: 'log call enter rst report dupe band mode frequency dock', h: 'Type the call in the CALL box at the bottom and press ⬆ (or Enter). Band, mode and frequency come from the radio when it is connected, or tap them in the dock. RST boxes fill themselves if you leave them empty. Type <b>HELP</b> in the CALL box for the typed commands (20M, CW, 14.074 …). Several calls with commas log one contact each.' },
    { id: 'digi', s: 'digi', t: 'FT8 / FT4 and the digital modes', k: 'ft8 ft4 digi decode cq auto run hunt waterfall tx level', h: 'Press START (sound on), pick FT8 or FT4, and decodes scroll in. Tap a station to call it, or 📣 CQ. ENABLE TX lets it transmit; HALT stops at once. The slim <b>band strip</b> at the top shows who is spotted on this band (and the IC-7300 / 705 / 9700 / 7610 / 905 RF scope under it); tap a call there to go to it. Keep the radio\'s ALC low: set the TX level so ALC barely moves.' },
    { id: 'spots', s: 'spots', t: 'Spots', k: 'spots pota sota cluster rbn filter tune', h: 'Live spots from POTA, SOTA, the DX cluster and the skimmers. Tap a spot: the radio tunes there and the CALL box fills. Filters at the top pick bands, modes and programs.' },
    { id: 'radio', s: 'radio', t: 'The RADIO screen', k: 'radio vfo frequency band mode filter width nb nr notch power mic meters tune', h: 'Run the radio from here: frequency (wheel, arrows, − +, tap to type), band and mode buttons, filter width, NB / NR / NOTCH, RF power, mic gain, the meters, 🔧 TUNE, radio on / off and 🎙 HOLD TO TALK. A band button goes back to the last frequency you used on that band (📍 band memory).' },
    { id: 'more', s: 'radio', t: '🎛 More controls', k: 'if shift pbt passband nr level nb level agc att attenuator preamp ipo amp contour apf notch split rit xit clarifier vfo swap a=b keyer speed break-in', h: 'Under the meters: IF SHIFT, NR and NB level, AGC, ATT, PRE / IPO, CONTOUR, APF, MANUAL NOTCH, SPLIT, A ⇄ B, A = B, RIT / XIT with the offset, keyer speed and break-in. Only what YOUR radio takes over CAT shows. The radio does not tell the app when you turn its own knobs, so these show what was sent last. If one does nothing on your radio, send a 📝 WORKS ON MY RADIO report.' },
    { id: 'tune', s: 'radio', t: '🔧 Tune and the SWR guard', k: 'tune tuner atu swr mismatch antenna high swr warning power', h: '🔧 TUNE starts the radio\'s own antenna tuner. It always asks first because the radio transmits a carrier; afterwards the app tells you the SWR it saw. The <b>SWR guard</b> watches the SWR while you transmit: over the limit (2 : 1, 2.5 : 1 or 3 : 1) it warns you, and can also turn the power down to 25 % or stop transmitting (🎛 MORE CONTROLS → Safety). The SWR from the radio\'s meter is close, not exact.' },
    { id: 'station', s: 'station', t: 'Station settings', k: 'station call grid radio cat sound card ptt vox backup', h: 'Your call, grid and park; MY RADIO and CONNECT RADIO; the sound card; how the radio is keyed (CAT, RTS / DTR, VOX); uploads, backups and the extras (contesting, skimmers, scope, rotator, listening clean-up). Use the search box at the top of STATION to jump to a setting.' },
    { id: 'contest', s: 'contest', t: 'Contesting', k: 'contest field day wfd sweepstakes cqww wpx naqp sprint qso party exchange dupe mult cabrillo score', h: 'Pick the contest and fill MY exchange, then 📒 OPEN THE CONTEST LOG. Log right at the top of the 🏆 CONTEST screen (CALL + the exchange boxes + LOG, Enter logs, Esc wipes) or from the LOG screen. The line says ⛔ DUPE, ⭐ NEW mult or ✓ needed before you log. SAVE CABRILLO makes the file every contest takes.' },
    { id: 'net', s: 'contest', t: 'Field Day / multi-op network', k: 'network multi op field day share log pc hub phones gota', h: 'One PC is the hub; other PCs and phones join with the pair code (STATION → REMOTE LINK, "share the log only"). Every contact goes to every station, dupes are checked across all of them, and it all works with no internet on the site\'s own Wi-Fi.' },
    { id: 'cos', s: 'contest', t: 'Live score', k: 'contest online scoreboard live score cos', h: 'Turn on the live score with your contestonlinescore.com login: the score goes up every 2 minutes while there is internet, and waits when there is not.' },
    { id: 'skim', s: 'contest', t: 'Skimmers and the band map', k: 'skimmer rbn reverse beacon who hears me region band map waterfall', h: 'The Reverse Beacon Network skimmers in the US and Canada, by region. WHO HEARS ME lists the skimmers that heard your CQ and how loud. The band map shows who is where: gold = new mult, green = needed, grey = dupe, red = a call that is probably busted.' },
    { id: 'scope', s: 'station', t: 'The RF scope', k: 'scope spectrum waterfall ic-7300 ic-705 ic-9700 ic-7610 ic-905 audio', h: 'Icom IC-7300 / 705 / 9700 / 7610 / 905 send their own scope over the USB cable: the app shows it on the RADIO screen and under the band maps. Other radios get the AUDIO picture (what the sound card hears). The Yaesu FT-710 scope needs a special driver the app cannot use.' },
    { id: 'rotor', s: 'station', t: 'Rotator', k: 'rotator rotor beam heading rotctld hamlib long path', h: 'Through Hamlib rotctld (Windows app): TURN, STOP, follow a spot\'s heading, long path, and a beam offset.' },
    { id: 'nr', s: 'station', t: 'Listening clean-up (noise reduction)', k: 'noise reduction nr blanker notch filter listening clean up', h: 'Cleans up what you HEAR from the radio here (HEAR THE RADIO HERE and the phone): noise reduction, a noise blanker for clicks, an automatic notch for carriers and a band-pass filter. The decoders always get the untouched sound.' },
    { id: 'remote', s: 'remote', t: 'Remote: the radio from a phone', k: 'remote phone pc pair tailscale wifi voice audio', h: 'The PC with the radio is the base. Pair the phone with the code on the PC (same Wi-Fi, or Tailscale away from home). The phone gets the frequency, mode, meters, TUNE (it asks first), voice both ways and FT8.' },
    { id: 'backup', s: 'station', t: 'Backups', k: 'backup restore move phone new computer', h: 'STATION → BACKUP saves your log and every setting in one file; RESTORE puts it back on any device.' },
    { id: 'lite', s: '', t: 'KPC Lite', k: 'lite apk smaller', h: 'KPC Lite is the same app with fewer modes (FT8 + FT4 only, no remote link). Contesting, skimmers, the scope, the rotator, the clean-up, 🎛 more controls and this help are all in Lite too: turn them on in STATION.' }
  ];
  /* ================================================================ RADIO SETUP: what each radio's own menus need (adds to kpc-app's family tips) */
  const MODEL = {
    ic7300: ['MENU → SET → Connectors → CI-V: CI-V Baud Rate = 115200 (or Auto), CI-V Address = 94h, CI-V Transceive = ON, CI-V USB Port = Unlink from [REMOTE], CI-V USB Baud Rate = 115200, CI-V USB Echo Back = OFF', 'Connectors → MOD Input → DATA MOD = USB · USB MOD Level about 50 %', 'Connectors → ACC/USB Output Select = AF · USB AF Output Level about 50 %', 'For the RF scope under the band maps: Connectors → CI-V → CI-V USB Port must be Unlink from [REMOTE]', 'Windows driver: Icom\'s "USB driver" (Silicon Labs CP210x)'],
    ic705: ['MENU → SET → Connectors → CI-V: CI-V Address = A4h, CI-V USB Port = Unlink from [REMOTE], CI-V USB Echo Back = OFF', 'Connectors → MOD Input → DATA MOD = USB', 'USB AF / SQL Output → AF Output Level about 50 %', 'Bluetooth CAT is not used by the app: use the USB cable'],
    ic7100: ['MENU → SET → Connectors → CI-V: CI-V Baud Rate = 19200, CI-V Address = 88h, CI-V USB Echo Back = OFF', 'Connectors → DATA MOD = USB', 'Connectors → USB Audio SQL = OFF (OPEN), USB MOD Level about 50 %', 'The IC-7100 has no RF scope over CAT: the app shows the AUDIO picture'],
    ic9700: ['MENU → SET → Connectors → CI-V: CI-V Address = A2h, CI-V USB Port = Unlink from [REMOTE], CI-V USB Baud Rate = 115200, Echo Back = OFF', 'Connectors → MOD Input → DATA MOD = USB'],
    ic7610: ['MENU → SET → Connectors → CI-V: CI-V Address = 98h, CI-V USB (A) Port = Unlink from [REMOTE], USB (A) Baud = 115200, Echo Back = OFF', 'Connectors → MOD Input → DATA MOD = USB'],
    ft710: ['MENU → OPERATION SETTING → GENERAL: CAT-1 RATE = 38400, CAT-1 TIME OUT TIMER = 10 ms (or longer)', 'The radio makes two COM ports: the ENHANCED one is CAT, the STANDARD one is the PTT / keying line', 'MENU → OPERATION SETTING → MODE PSK/DATA (DATA): DATA MOD SOURCE = REAR, REAR SELECT = USB, USB MOD GAIN about 50', 'MODE SSB: SSB MOD SOURCE = REAR for voice from the app (or let the app switch to DATA while it sends)', 'The FT-710 scope over USB needs Yaesu\'s own driver: the app shows the AUDIO picture instead'],
    ftdx10: ['MENU → OPERATION SETTING → GENERAL: CAT RATE = 38400, CAT TIME OUT TIMER = 10 ms or longer', 'ENHANCED COM port = CAT, STANDARD = PTT / keying', 'MODE PSK/DATA: DATA MOD SOURCE = REAR, REAR SELECT = USB, USB MOD GAIN about 50', 'MODE SSB: SSB MOD SOURCE = REAR for voice from the app'],
    ftdx101: ['MENU → OPERATION SETTING → GENERAL: CAT RATE = 38400', 'ENHANCED COM port = CAT', 'MODE PSK/DATA: DATA MOD SOURCE = REAR, REAR SELECT = USB'],
    ftx1: ['MENU → CAT: CAT-1 RATE = 38400', 'ENHANCED COM port = CAT, STANDARD = PTT / keying', 'DATA mode: MOD SOURCE = REAR (USB), USB MOD GAIN about 50', 'Not checked on a real FTX-1 yet: please send a WORKS ON MY RADIO report'],
    ft891: ['MENU 05-06 CAT RATE = 38400, 05-08 CAT RTS = DISABLE (or let the app hold RTS)', 'The FT-891 has no USB sound card: use a Digirig, SCU-17 or similar on the DATA jack', 'DATA menu: DATA IN SELECT = REAR, DATA PTT SELECT = RTS (Digirig) or DAKY', 'With an SCU-17: CAT on the ENHANCED port, PTT on the STANDARD port'],
    ft991: ['MENU 031 CAT RATE = 38400, 032 CAT TOT = 10 ms or longer, 033 CAT RTS = DISABLE', 'MENU 070 DATA IN SELECT = REAR, 071 DATA PTT SELECT = RTS, 073 DATA OUT LEVEL about 50', 'ENHANCED COM port = CAT, STANDARD = PTT', 'Mode: DATA-U for FT8'],
    ts590: ['MENU: COM / USB port baud = 115200 (USB) — match the app', 'MENU: audio source for DATA = USB, USB audio input level about 5, DATA VOX = OFF', 'Use DATA (DA1) mode for FT8'],
    ts890: ['MENU → Advanced: USB (virtual COM) baud = 115200', 'Audio source for DATA mode = USB audio', 'Use DATA mode for FT8'],
    kx3: ['CONFIG: RS232 = 38400, AUTOINF = NOR', 'DATA A mode; MIC/LINE input = LINE IN from the sound card (KXUSB + a USB sound card, or a Digirig)'],
    k4: ['MENU: RS232 / USB baud = 38400 (the K4 USB port also works at higher rates)', 'DATA mode: TX audio from USB (LINE IN) — the K4 has its own USB audio'],
    g90: ['CI-V address 70h, baud 19200 (the G90 default)', 'Needs the Xiegu DE-19 (or a Digirig) for sound: the G90 has no USB sound card', 'PTT by CAT or by the DE-19\'s PTT line'],
    qmx: ['QMX menu: CAT = Kenwood TS-480 style (always on), any baud', 'USB sound card built in: pick "QMX" as the sound card', 'USB SERIAL PORTS = 3: CAT on the lowest-numbered port']
  };
  /* ================================================================ TROUBLESHOOTER */
  const TRB = [
    ['The radio does not answer (CONNECT fails)', ['Is the right radio picked in STATION → MY RADIO? The baud rate there must match the radio\'s own CAT / CI-V baud menu.', 'Close every other radio program (WSJT-X, flrig, N1MM, the radio maker\'s tool): only one program can hold the port.', 'Pick the right port: ⚙ MORE RADIO SETTINGS → PICK A DIFFERENT PORT. Yaesu with two ports: the ENHANCED one. Icom: the CP210x one.', 'Icom: the CI-V address in the app must match the radio (7300 = 94h, 705 = A4h, 7100 = 88h, 9700 = A2h), and CI-V USB Echo Back = OFF.', 'Unplug the USB cable, wait 5 seconds, plug it back in, CONNECT again.', 'Still nothing: try HOW THE APP REACHES IT = Hamlib rigctld or flrig.']],
    ['Frequency works but there is no sound / no decodes', ['STATION → SOUND: pick the radio\'s own USB sound card (USB Audio CODEC on Icom / Yaesu) as the input and press START.', 'The level bar should move: aim for the middle. Too low: raise the radio\'s USB AF output level. Too high: lower it.', 'The radio must be in DATA-U / USB-D for FT8, on the right frequency, with the filter at least 2.4 kHz wide.', 'Check the clock: FT8 needs the PC / phone clock within a second (the clock at the top turns red when it is off).']],
    ['It transmits but no power out', ['The radio\'s DATA MOD source must be USB / REAR (see the setup guide for your radio).', 'Raise the app\'s TX level until ALC barely moves; ALC pinned = too much.', 'Check RF POWER on the RADIO screen and that the radio is in DATA-U, not USB with the mic as the source.']],
    ['PTT does not key the radio', ['STATION → how the radio is keyed: CAT for most USB radios; RTS / DTR for a Digirig or SCU-17; VOX as the last resort.', 'Yaesu: CAT RTS menu = DISABLE if the radio keys when the app opens the port, or ENABLE if it never keys by RTS.', 'Make sure your call sign is set: the app will not transmit without it.']],
    ['A 🎛 MORE CONTROLS button does nothing', ['Some models answer a command a little differently: the app only knows what the maker\'s manual says.', 'Send a 📝 WORKS ON MY RADIO report so it can be fixed (or hidden) for your radio.', 'With Hamlib rigctld: Hamlib decides what your radio takes; unsupported ones are ignored.']],
    ['⚠ HIGH SWR warning', ['Stop and check the antenna, the coax and the connectors.', 'Press 🔧 TUNE if the radio has a tuner (it asks first), then try again.', 'The guard reads the radio\'s own SWR meter: if it warns at a good match, raise the limit (🎛 MORE CONTROLS → Safety).']],
    ['The RF scope is empty', ['Only the Icom IC-7300 / 705 / 9700 / 7610 / 905 send their scope over CAT.', 'Icom: CI-V USB Port = Unlink from [REMOTE]; the radio\'s scope display must be on.', 'Other radios: pick AUDIO for the picture from the sound card.']],
    ['No spots / skimmers', ['Spots need internet. On the Field Day site with no internet they come back when you have it.', 'Skimmers (RBN) on Windows log in with your call sign; on a phone they come through Spothole.']],
    ['Contest: dupes or score look wrong', ['Make sure the CONTEST log is the one open (the 🏆 tab says ✓ CONTEST LOG IS OPEN) and the year is right.', 'A contact logged in another log does not count: move it from MY LOGS.', 'Load CTY.DAT for DX contests (countries and zones).']],
    ['The phone cannot reach the PC', ['Same Wi-Fi, or Tailscale on both when away from home.', 'Pair again with a fresh code from the PC.', 'Windows firewall: allow the KPC app on private networks.']]
  ];

  /* ================================================================ the ❓ in the top bar + the HELP screen */
  const look = $('look');
  if (look && !$('helpBtn')) look.insertAdjacentHTML('beforebegin', '<button type="button" class="ic" id="helpBtn" aria-label="Help for this screen" title="Help">❓</button>');
  const main = document.querySelector('main');
  if (main && !$('scrHelp')) main.insertAdjacentHTML('beforeend', '<section class="scr" id="scrHelp" aria-label="Help"><div id="hpBody"></div></section>');
  const st = document.createElement('style'); st.textContent = 'body[data-screen="help"] #scrHelp{display:block}#scrHelp{max-width:980px;margin:0 auto}#helpBtn{font-size:16px}.hpq{width:100%;height:46px;font-size:17px;margin:0 0 10px}.hpt{margin:0 0 8px}.hpt summary{cursor:pointer;font-weight:700;padding:8px 0}.hpt p{margin:4px 0 10px}.helpl{margin:6px 0 10px 18px;padding:0}.helpl li{margin:4px 0}.hpw{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}.hpw .k{flex:1 1 200px}.hptab{width:100%;border-collapse:collapse;font-size:13px}.hptab td,.hptab th{border-bottom:1px solid var(--line);padding:5px 4px;text-align:left;vertical-align:top}.hpok{color:var(--ok)}.hpbad{color:var(--red)}.wzs{font:700 11px var(--sans);letter-spacing:.12em;color:var(--goldT)}';
  document.head.appendChild(st);
  $('helpBtn') && ($('helpBtn').onclick = () => screenHelp(document.body.dataset.screen || 'log'));
  function screenHelp(s) {
    const list = T.filter(t => t.s === s || (s === 'logs' && t.id === 'log'));
    AP.sheet('❓ Help' + (list[0] ? ': ' + list[0].t : ''), (list.length ? list.map(t => `<h3>${esc(t.t)}</h3><p>${t.h}</p>`).join('') : '<p>Pick a topic on the HELP page.</p>') +
      `<div class="row"><button type="button" class="b gold" id="hpAll">📖 ALL HELP</button>${K ? '<button type="button" class="b" id="hpWiz">🧙 RADIO SETUP WIZARD</button>' : ''}<button type="button" class="b" id="hpTrb">🩺 SOMETHING NOT WORKING</button></div>`);
    $('hpAll').onclick = () => { AP.shut(); open(); };
    if ($('hpWiz')) $('hpWiz').onclick = () => { AP.shut(); wizard(); };
    $('hpTrb').onclick = () => { AP.shut(); open('trb'); };
  }
  let Q = '';
  function open(part) { AP.go('help'); $('ttl').textContent = 'Help'; draw(); if (part) setTimeout(() => { const e = $('hp_' + part); if (e) { if (e.tagName === 'DETAILS') e.open = true; e.scrollIntoView({ block: 'start' }); } }, 60); }
  function draw() {
    const b = $('hpBody'); if (!b) return;
    const q = Q.toLowerCase().trim(), hit = t => !q || (t.t + ' ' + t.k + ' ' + t.h.replace(/<[^>]+>/g, '')).toLowerCase().includes(q);
    const th = T.filter(hit), tr = TRB.filter(([a, l]) => !q || (a + ' ' + l.join(' ')).toLowerCase().includes(q));
    b.innerHTML = `<input class="hpq" id="hpQ" type="search" placeholder="🔎 Search the help (try: ft8 sound, split, swr, field day)" value="${esc(Q)}">
      <div class="row"><button type="button" class="b gold" id="hpWiz2">🧙 RADIO SETUP WIZARD</button><button type="button" class="b" id="hpWorks">📝 WORKS ON MY RADIO</button><button type="button" class="b" id="hpBack">‹ BACK</button></div>
      <section class="card"><h2>How things work</h2>${th.map(t => `<details class="hpt" id="hp_${t.id}"${q ? ' open' : ''}><summary>${esc(t.t)}</summary><p>${t.h}</p></details>`).join('') || '<p class="hint">Nothing matches.</p>'}</section>
      <section class="card" id="hp_trb"><h2>🩺 Something not working?</h2>${tr.map(([a, l], i) => `<details class="hpt"${q ? ' open' : ''}><summary>${esc(a)}</summary><ol class="helpl">${l.map(x => '<li>' + esc(x) + '</li>').join('')}</ol></details>`).join('') || '<p class="hint">Nothing matches.</p>'}</section>
      ${K ? `<section class="card" id="hp_guide"><h2>📖 Setting up your radio</h2><label class="e">WHICH RADIO<select id="hpRig"></select></label><div id="hpGuide"></div></section>
      <section class="card" id="hp_radios"><h2>📻 Radios and what they take</h2><p class="hint">✓ = checked on a real radio with KPC. Everything else follows the maker's CAT manual and has not been tried on the air yet: a 📝 WORKS ON MY RADIO report gets it checked.</p><div id="hpRadios"></div></section>` : ''}`;
    const qi = $('hpQ'); qi.oninput = () => { Q = qi.value; const p = qi.selectionStart; draw(); const n = $('hpQ'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} };
    $('hpWiz2').onclick = () => wizard(); $('hpWorks').onclick = () => works(); $('hpBack').onclick = () => AP.go(LAST || 'log');
    if (K) { K.fillSelect($('hpRig')); $('hpRig').value = K.get().radio || ''; $('hpRig').onchange = () => { $('hpGuide').innerHTML = guideHtml($('hpRig').value); }; $('hpGuide').innerHTML = guideHtml($('hpRig').value); radios(); }
  }
  function guideHtml(id) {
    if (!K) return '';
    const R = K.RADIO[id], tips = AP.rigTips ? AP.rigTips() : {}, fam = AP.rigFam ? AP.rigFam(id) : 'other', F = tips[fam];
    if (!id) return '<p class="hint">Pick your radio for its setup guide.</p>';
    const C = K.caps ? K.caps(id) : null, keys = C ? C.keys : [];
    return (R ? `<p><b>${esc(R.label)}</b> · CAT ${esc(R.proto === 'icom' ? 'CI-V' : R.proto === 'kenwood' ? 'Kenwood-style' : 'Yaesu')} at <b>${R.baud}</b> baud${R.civ ? ' · CI-V address <b>' + esc(R.civ) + 'h</b>' : ''}</p>` : '') +
      (MODEL[id] ? '<h3>On this radio</h3><ul class="helpl">' + MODEL[id].map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      (F ? '<h3>' + esc(F[0]) + '</h3><ul class="helpl">' + F[1].map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      `<p class="hint">🎛 Controls the app can send to it: ${keys.length ? keys.map(k => NAMES[k] || k).join(', ') : 'frequency, mode and the basics only'}.${WORKS[id] ? ' · 📝 your report from ' + esc(WORKS[id].date) : ''}</p>`;
  }
  const NAMES = { shift: 'IF shift', nrl: 'NR level', nbl: 'NB level', agc: 'AGC', att: 'ATT', pre: 'preamp', contour: 'contour', apf: 'APF', mnotch: 'manual notch', mnotchf: 'notch frequency', split: 'split', rit: 'RIT', xit: 'XIT', ritoff: 'RIT offset', swap: 'A⇄B', ab: 'A=B', keyspd: 'keyer speed', bkin: 'break-in' };
  function radios() {
    const el = $('hpRadios'); if (!el || !K) return;
    el.innerHTML = '<table class="hptab"><tr><th>RADIO</th><th>MORE CONTROLS</th><th>CHECKED</th></tr>' + K.RADIOS.map(([g, L]) => L.map(r => { const id = r[0], C = K.caps(id), w = WORKS[id], t = K.TESTED[id];
      return `<tr><td>${esc((K.RADIO[id] || {}).label || r[1])}</td><td>${C.keys.length}</td><td>${t ? '<span class="hpok">✓ ' + esc(t.date || '') + '</span>' : w ? '<span class="' + (w.bad.length ? 'hpbad' : 'hpok') + '">📝 your report: ' + w.ok.length + ' ok' + (w.bad.length ? ', ' + w.bad.length + ' not' : '') + '</span>' : 'not yet'}</td></tr>`; }).join('')).join('') + '</table>';
  }
  function guide(id) { open('guide'); setTimeout(() => { const s = $('hpRig'); if (s && id) { s.value = id; $('hpGuide').innerHTML = guideHtml(id); } }, 80); }
  let LAST = 'log';
  AP.on('screen', s => { if (s !== 'help') LAST = s; else { $('ttl').textContent = 'Help'; draw(); } });

  /* ================================================================ 🧙 RADIO SETUP WIZARD */
  function wizard(step) {
    if (!K) return; step = step || 1; const c = K.get(), id = c.radio || '';
    const head = n => `<p class="wzs">STEP ${n} OF 5</p>`;
    if (step === 1) {
      AP.sheet('🧙 Radio setup', head(1) + '<p>Which radio is it?</p><label class="e wide">MY RADIO<select id="wzRig"></select></label><div class="row"><button type="button" class="b gold" id="wzN">NEXT ›</button></div>');
      K.fillSelect($('wzRig')); $('wzRig').value = id;
      $('wzN').onclick = () => { const v = $('wzRig').value; if (!v) { AP.toast('Pick the radio first.', 2500, 'bad'); return; } K.pickRadio(v); K.set({ on: true }); const s = $('stRig'); if (s) s.value = v; wizard(2); };
    } else if (step === 2) {
      AP.sheet('🧙 Set the radio\'s menus', head(2) + guideHtml(id) + '<div class="row"><button type="button" class="b" id="wzB">‹ BACK</button><button type="button" class="b gold" id="wzN">DONE, NEXT ›</button></div>');
      $('wzB').onclick = () => wizard(1); $('wzN').onclick = () => wizard(3);
    } else if (step === 3) {
      AP.sheet('🧙 Plug in and connect', head(3) + '<p>Turn the radio on and plug the USB cable into this device. Close other radio programs. Then press CONNECT and pick the radio\'s port when asked.</p><div class="row"><button type="button" class="b" id="wzB">‹ BACK</button><button type="button" class="b gold" id="wzC">📻 CONNECT</button></div><p class="hint" id="wzSt"></p>');
      $('wzB').onclick = () => wizard(2);
      $('wzC').onclick = async () => { $('wzSt').textContent = 'Connecting…'; const b = $('stConn'); if (b) b.click(); else await K.connect(true);
        let ok = false; for (let i = 0; i < 20 && !ok; i++) { await new Promise(r => setTimeout(r, 500)); ok = K.connected(); }
        if (ok) wizard(4); else { const m = (AP.catMsg && AP.catMsg()) || {}; $('wzSt').innerHTML = '❌ ' + esc(m.t || 'The radio did not answer.') + ' <button type="button" class="chip" id="wzT">🩺 HELP ME</button>'; $('wzT').onclick = () => { AP.shut(); open('trb'); }; } };
    } else if (step === 4) {
      AP.sheet('🧙 Does it match?', head(4) + '<p>The radio says:</p><p class="cxbig" id="wzF">…</p><p>Is that what the radio\'s display shows?</p><div class="row"><button type="button" class="b gold" id="wzY">✓ YES</button><button type="button" class="b" id="wzNo">✗ NO</button></div>');
      K.read().then(r => { $('wzF').textContent = r && r.khz ? (r.khz / 1000).toFixed(3) + ' MHz ' + (r.mode || '') : 'no answer'; });
      $('wzY').onclick = () => wizard(5); $('wzNo').onclick = () => { AP.shut(); open('trb'); };
    } else {
      AP.sheet('🧙 Sound, then done', head(5) + '<p>Last thing: in STATION → SOUND pick the radio\'s USB sound card (USB Audio CODEC on Icom and Yaesu) and press START. The level bar should sit in the middle.</p><p>✓ The radio is set up. Try the 📻 RADIO screen: 🎛 MORE CONTROLS shows what this radio takes.</p><div class="row"><button type="button" class="b gold" id="wzSnd">🔊 SOUND SETTINGS</button><button type="button" class="b" id="wzR">📻 RADIO SCREEN</button><button type="button" class="b" id="wzW">📝 REPORT HOW IT WENT</button></div>');
      $('wzSnd').onclick = () => { AP.shut(); AP.go('station'); const d = $('stDev'); if (d) d.scrollIntoView({ block: 'center' }); };
      $('wzR').onclick = () => { AP.shut(); AP.go('radio'); }; $('wzW').onclick = () => works();
    }
  }

  /* ================================================================ 📝 WORKS ON MY RADIO */
  const BASIC = [['freq', 'Frequency read + set'], ['mode', 'Mode (USB / LSB / CW / DATA)'], ['ptt', 'Transmit (PTT)'], ['meters', 'Meters (S, power, SWR, ALC)'], ['width', 'Filter width'], ['nb', 'NB on / off'], ['nr', 'NR on / off'], ['notch', 'Auto notch'], ['power', 'RF power'], ['mic', 'Mic gain'], ['atu', '🔧 Tune'], ['cw', 'CW typed from the app'], ['scope', 'RF scope'], ['onoff', 'Radio on / off']];
  function works() {
    if (!K) return; const c = K.get(), id = c.radio || '', R = K.RADIO[id];
    if (!id) { AP.toast('Pick your radio first (STATION → MY RADIO).', 3000, 'bad'); return; }
    const C = K.caps(id), list = BASIC.concat(C.keys.map(k => [k, NAMES[k] || k])), prev = WORKS[id] || { ok: [], bad: [] }, val = {};
    list.forEach(([k]) => { val[k] = prev.ok.includes(k) ? 1 : prev.bad.includes(k) ? -1 : 0; });
    AP.sheet('📝 Works on my ' + (R ? R.label : 'radio'), '<p class="hint">Try each one on the radio, then tap ✓ or ✗. Leave the ones you did not try.</p>' +
      list.map(([k, l]) => `<div class="hpw"><span class="k">${esc(l)}</span><button type="button" class="chip" data-wk="${k}" data-wv="1">✓ WORKS</button><button type="button" class="chip" data-wk="${k}" data-wv="-1">✗ NOT</button></div>`).join('') +
      '<label class="e wide">NOTES (firmware, cable, what went wrong)<textarea id="wkN" rows="3">' + esc(prev.note || '') + '</textarea></label><div class="row"><button type="button" class="b gold" id="wkGo">📤 SEND / SAVE THE REPORT</button></div>');
    const paint = () => document.querySelectorAll('[data-wk]').forEach(b => b.classList.toggle('on', val[b.dataset.wk] === +b.dataset.wv));
    paint(); document.querySelectorAll('[data-wk]').forEach(b => { b.onclick = () => { const k = b.dataset.wk, v = +b.dataset.wv; val[k] = val[k] === v ? 0 : v; paint(); }; });
    $('wkGo').onclick = async () => {
      const rep = { radio: id, label: R ? R.label : id, ok: list.filter(([k]) => val[k] === 1).map(([k]) => k), bad: list.filter(([k]) => val[k] === -1).map(([k]) => k), note: $('wkN').value.trim(), date: new Date().toISOString().slice(0, 10), link: K.link ? K.link() : '', ver: AP.VER };
      WORKS[id] = rep; SV('kpcAppWorks', WORKS);
      const me = AP.me ? (AP.me().call || '') : '';
      const txt = `KPC app — WORKS ON MY RADIO\nRadio: ${rep.label} (${id})\nApp: ${rep.ver || ''} · link: ${rep.link}\nBy: ${me}\nDate: ${rep.date}\n\nWORKS: ${rep.ok.map(k => NAMES[k] || k).join(', ') || '-'}\nDOES NOT WORK: ${rep.bad.map(k => NAMES[k] || k).join(', ') || '-'}\nNotes: ${rep.note || '-'}\n`;
      AP.shut();
      let done = false;
      try { if (navigator.share) { await navigator.share({ title: 'KPC: works on my ' + rep.label, text: txt }); done = true; } } catch (e) {}
      if (!done) { try { await navigator.clipboard.writeText(txt); AP.toast('📝 Report copied: paste it to the club (email, Discord, GitHub).', 5000, 'log'); done = true; } catch (e) {} }
      if (!done && AP.saveFile) AP.saveFile(txt, 'KPC-works-' + id + '-' + rep.date + '.txt', 'text/plain');
      if (document.body.dataset.screen === 'help') draw();
    };
  }

  G.KPCHelp = { open, draw, screenHelp, wizard, works, guide, guideHtml, topics: T, trouble: TRB, models: MODEL, reports: WORKS };
})(window);
