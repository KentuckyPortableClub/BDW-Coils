/* KPC app: 🏆 CONTESTING (Nov 5 2026, Opus; Brandon: 'spot list with all skimmers for US and Canada … broke down by regions,
   options for log and scoring, major contests, ARRL Field Day, QSO parties … all the info a good contester log would need',
   then 'could the download let you select the options you want?').

   NOTHING shows until it is switched on: STATION → 🏆 CONTESTING = one ON/OFF + a switch per part (the "pick your options"):
     log      = contest logging: the exchange boxes on the LOG line, dupe + new-multiplier check while typing, score, rates,
                Cabrillo file, contest ADIF tags
     map      = BAND MAP + WATERFALL of who is where (spots + skimmers, coloured new mult / needed / dupe / busted)
     skim     = SKIMMERS BY REGION: every RBN skimmer heard in the US and Canada, by ARRL division / call area / section,
                and WHO HEARS ME (kpc-skim.js)
     cos      = LIVE SCORE to the Contest Online Scoreboard (contestonlinescore.com), every 2 minutes while online
     share    = FIELD DAY / MULTI-OP: share the contest log over the remote link (PC = the hub, phones + tablets = stations)

   THE CONTEST LOG: a MY LOGS event log with a fixed id 'cx-<contest>-<year>' (KPCLog.opNew(kind, name, refs, id)), so every
   device in a Field Day group writes into the SAME log. Each contact keeps its exchange in `cx` = {k: contest key, s: sent,
   r: received}; KPCLog.add takes `cx`, the record merges like any other field. Dupes / mults / score are worked out from
   EVERY device's contacts in that log (KPCLog.all(), not the operator's own view).

   Contest rules change: each contest carries `url` + `notes`; the ones marked VERIFY were written from memory (see CLAUDE.md).
   Country / continent / zone for DX contests: CTY.DAT (⬇ GET CTY.DAT, country-files.com) — a short built-in table until then.
   Super Check Partial: MASTER.SCP (⬇ GET MASTER.SCP) — partial matches under the CALL box and the busted-call check. */
(function (G) {
  'use strict';
  const AP = G.KPCApp; if (!AP || !G.KPCLog) return;
  const $ = id => document.getElementById(id), esc = AP.esc;
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const YEAR = new Date().getUTCFullYear();
  const COS_URL = 'https://contestonlinescore.com/post/', SD_URL = 'http://scoredistributor.net/';
  const CTY_URL = 'https://www.country-files.com/cty/cty.dat', SCP_URL = 'https://www.supercheckpartial.com/MASTER.SCP';

  /* ---------------- settings: localStorage kpcAppCx (in the backup); the scoreboard password apart in kpcAppCxCos (never backed up / reported) */
  const CF = Object.assign({ on: false, feat: { log: true, map: true, skim: true, cos: false, share: false }, id: 'arrl-fd', yr: YEAR, sent: {},
    cat: { power: 'LOW', ops: 'SINGLE-OP', assisted: false, tx: 'ONE', bands: 'ALL', mode: 'MIXED', overlay: '' },
    watts: 100, psrc: 'GENERATOR', bonus: {}, om: 1, club: '', level: 'division' }, LS('kpcAppCx', {}));
  CF.feat = Object.assign({ log: true, map: true, skim: true, cos: false, share: false }, CF.feat || {});
  const COS = Object.assign({ on: false, user: '', pass: '', url: COS_URL, last: null }, LS('kpcAppCxCos', {}));
  const save = () => { SV('kpcAppCx', CF); };
  const saveCos = () => SV('kpcAppCxCos', COS);
  const on = f => CF.on && (!f || CF.feat[f]);

  /* ======================================================================== ARRL / RAC SECTIONS (85: 71 US + 14 RAC, 2025 list)
     [abbr, name, country, state, call area, ARRL division or RAC region, lat, lon] — lat/lon = a rough centre, only used to put a
     skimmer in its nearest section when the call book gives no state */
  const SEC = [
    ['CT', 'Connecticut', 'US', 'CT', '1', 'New England', 41.6, -72.7], ['EMA', 'Eastern Massachusetts', 'US', 'MA', '1', 'New England', 42.3, -71.2], ['ME', 'Maine', 'US', 'ME', '1', 'New England', 44.6, -69.6], ['NH', 'New Hampshire', 'US', 'NH', '1', 'New England', 43.2, -71.5], ['RI', 'Rhode Island', 'US', 'RI', '1', 'New England', 41.7, -71.5], ['VT', 'Vermont', 'US', 'VT', '1', 'New England', 44.2, -72.8], ['WMA', 'Western Massachusetts', 'US', 'MA', '1', 'New England', 42.3, -72.6],
    ['ENY', 'Eastern New York', 'US', 'NY', '2', 'Hudson', 42.4, -73.9], ['NLI', 'NYC / Long Island', 'US', 'NY', '2', 'Hudson', 40.75, -73.4], ['NNJ', 'Northern New Jersey', 'US', 'NJ', '2', 'Hudson', 40.85, -74.4], ['NNY', 'Northern New York', 'US', 'NY', '2', 'Atlantic', 44.2, -75.2], ['SNJ', 'Southern New Jersey', 'US', 'NJ', '2', 'Atlantic', 39.7, -74.9], ['WNY', 'Western New York', 'US', 'NY', '2', 'Atlantic', 42.9, -77.3],
    ['DE', 'Delaware', 'US', 'DE', '3', 'Atlantic', 39.0, -75.5], ['EPA', 'Eastern Pennsylvania', 'US', 'PA', '3', 'Atlantic', 40.4, -75.8], ['MDC', 'Maryland / DC', 'US', 'MD', '3', 'Atlantic', 39.1, -76.8], ['WPA', 'Western Pennsylvania', 'US', 'PA', '3', 'Atlantic', 40.6, -79.6],
    ['AL', 'Alabama', 'US', 'AL', '4', 'Southeastern', 33.0, -86.8], ['GA', 'Georgia', 'US', 'GA', '4', 'Southeastern', 33.4, -84.0], ['KY', 'Kentucky', 'US', 'KY', '4', 'Great Lakes', 37.8, -85.5], ['NC', 'North Carolina', 'US', 'NC', '4', 'Roanoke', 35.6, -79.4], ['NFL', 'Northern Florida', 'US', 'FL', '4', 'Southeastern', 30.0, -82.5], ['SC', 'South Carolina', 'US', 'SC', '4', 'Roanoke', 34.0, -81.0], ['SFL', 'Southern Florida', 'US', 'FL', '4', 'Southeastern', 26.4, -80.4], ['WCF', 'West Central Florida', 'US', 'FL', '4', 'Southeastern', 27.9, -82.3], ['TN', 'Tennessee', 'US', 'TN', '4', 'Delta', 35.9, -86.4], ['VA', 'Virginia', 'US', 'VA', '4', 'Roanoke', 37.7, -77.9], ['PR', 'Puerto Rico', 'US', 'PR', '4', 'Southeastern', 18.2, -66.5], ['VI', 'US Virgin Islands', 'US', 'VI', '4', 'Southeastern', 18.34, -64.9],
    ['AR', 'Arkansas', 'US', 'AR', '5', 'Delta', 34.9, -92.4], ['LA', 'Louisiana', 'US', 'LA', '5', 'Delta', 30.7, -91.5], ['MS', 'Mississippi', 'US', 'MS', '5', 'Delta', 32.5, -89.7], ['NM', 'New Mexico', 'US', 'NM', '5', 'Rocky Mountain', 34.8, -106.4], ['NTX', 'North Texas', 'US', 'TX', '5', 'West Gulf', 32.9, -97.0], ['OK', 'Oklahoma', 'US', 'OK', '5', 'West Gulf', 35.6, -97.3], ['STX', 'South Texas', 'US', 'TX', '5', 'West Gulf', 29.6, -97.0], ['WTX', 'West Texas', 'US', 'TX', '5', 'West Gulf', 32.2, -101.8],
    ['EB', 'East Bay', 'US', 'CA', '6', 'Pacific', 37.8, -122.0], ['LAX', 'Los Angeles', 'US', 'CA', '6', 'Southwestern', 34.2, -118.3], ['ORG', 'Orange', 'US', 'CA', '6', 'Southwestern', 34.0, -117.2], ['SB', 'Santa Barbara', 'US', 'CA', '6', 'Southwestern', 34.7, -120.0], ['SCV', 'Santa Clara Valley', 'US', 'CA', '6', 'Pacific', 37.1, -121.8], ['SDG', 'San Diego', 'US', 'CA', '6', 'Southwestern', 32.9, -116.8], ['SF', 'San Francisco', 'US', 'CA', '6', 'Pacific', 38.6, -122.7], ['SJV', 'San Joaquin Valley', 'US', 'CA', '6', 'Pacific', 36.8, -119.6], ['SV', 'Sacramento Valley', 'US', 'CA', '6', 'Pacific', 39.2, -121.3], ['PAC', 'Hawaii / Pacific', 'US', 'HI', '6', 'Pacific', 21.3, -157.8],
    ['AK', 'Alaska', 'US', 'AK', '7', 'Northwestern', 61.4, -149.6], ['AZ', 'Arizona', 'US', 'AZ', '7', 'Southwestern', 33.4, -111.9], ['EWA', 'Eastern Washington', 'US', 'WA', '7', 'Northwestern', 47.2, -118.4], ['ID', 'Idaho', 'US', 'ID', '7', 'Northwestern', 44.0, -115.5], ['MT', 'Montana', 'US', 'MT', '7', 'Northwestern', 46.9, -110.4], ['NV', 'Nevada', 'US', 'NV', '7', 'Pacific', 37.5, -116.5], ['OR', 'Oregon', 'US', 'OR', '7', 'Northwestern', 44.6, -122.6], ['UT', 'Utah', 'US', 'UT', '7', 'Rocky Mountain', 40.4, -111.8], ['WWA', 'Western Washington', 'US', 'WA', '7', 'Northwestern', 47.5, -122.3], ['WY', 'Wyoming', 'US', 'WY', '7', 'Rocky Mountain', 42.9, -107.5],
    ['MI', 'Michigan', 'US', 'MI', '8', 'Great Lakes', 43.3, -84.5], ['OH', 'Ohio', 'US', 'OH', '8', 'Great Lakes', 40.3, -82.8], ['WV', 'West Virginia', 'US', 'WV', '8', 'Roanoke', 38.6, -80.6],
    ['IL', 'Illinois', 'US', 'IL', '9', 'Central', 41.3, -88.6], ['IN', 'Indiana', 'US', 'IN', '9', 'Central', 40.0, -86.3], ['WI', 'Wisconsin', 'US', 'WI', '9', 'Central', 43.9, -89.0],
    ['CO', 'Colorado', 'US', 'CO', '0', 'Rocky Mountain', 39.5, -105.2], ['IA', 'Iowa', 'US', 'IA', '0', 'Midwest', 42.0, -93.4], ['KS', 'Kansas', 'US', 'KS', '0', 'Midwest', 38.5, -97.0], ['MN', 'Minnesota', 'US', 'MN', '0', 'Dakota', 45.5, -93.8], ['MO', 'Missouri', 'US', 'MO', '0', 'Midwest', 38.5, -92.5], ['ND', 'North Dakota', 'US', 'ND', '0', 'Dakota', 47.4, -99.8], ['NE', 'Nebraska', 'US', 'NE', '0', 'Midwest', 41.0, -97.9], ['SD', 'South Dakota', 'US', 'SD', '0', 'Dakota', 44.2, -99.4],
    ['AB', 'Alberta', 'CA', 'AB', 'VE6', 'Prairies', 52.3, -113.8], ['BC', 'British Columbia', 'CA', 'BC', 'VE7', 'Pacific (RAC)', 49.6, -123.2], ['GH', 'Golden Horseshoe', 'CA', 'ON', 'VE3', 'Ontario', 43.5, -79.7], ['MB', 'Manitoba', 'CA', 'MB', 'VE4', 'Prairies', 50.0, -97.4], ['NB', 'New Brunswick', 'CA', 'NB', 'VE9', 'Atlantic (RAC)', 46.3, -66.0], ['NL', 'Newfoundland / Labrador', 'CA', 'NL', 'VO1', 'Atlantic (RAC)', 48.5, -55.5], ['NS', 'Nova Scotia', 'CA', 'NS', 'VE1', 'Atlantic (RAC)', 45.0, -63.2], ['ONE', 'Ontario East', 'CA', 'ON', 'VE3', 'Ontario', 45.1, -75.9], ['ONN', 'Ontario North', 'CA', 'ON', 'VE3', 'Ontario', 47.6, -82.5], ['ONS', 'Ontario South', 'CA', 'ON', 'VE3', 'Ontario', 42.9, -81.3], ['PE', 'Prince Edward Island', 'CA', 'PE', 'VY2', 'Atlantic (RAC)', 46.3, -63.2], ['QC', 'Quebec', 'CA', 'QC', 'VE2', 'Quebec', 46.6, -72.4], ['SK', 'Saskatchewan', 'CA', 'SK', 'VE5', 'Prairies', 51.6, -105.6], ['TER', 'Territories (YT / NT / NU)', 'CA', 'NT', 'VE8', 'North', 62.5, -118.0]
  ].map(([abbr, name, country, state, area, div, la, lo]) => ({ abbr, name, country, state, area, div, la, lo }));
  const SECM = new Map(SEC.map(s => [s.abbr, s]));
  const US_ST = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
  const CA_PR = 'NB NS PE NL QC ON MB SK AB BC YT NT NU'.split(' ');
  const STPR = new Set([...US_ST, ...CA_PR]);
  const secsOfState = st => { st = String(st || '').toUpperCase(); st = st === 'DC' ? 'MD' : (st === 'YT' || st === 'NU') ? 'NT' : st; return SEC.filter(s => s.state === st); };

  /* ======================================================================== CALL SIGNS */
  const MODS = /^(P|M|MM|AM|QRP|A|B|R|LH|J|E)$/;
  const US_RE = /^(A[A-L]|K|N|W)[A-Z]?[0-9]/, CA_RE = /^(V[A-GOXY]|C[F-KYZ]|X[J-O])[0-9]/;
  const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
  function split(call) {
    const p = norm(call).split('/').filter(x => x && !MODS.test(x));
    if (p.length <= 1) return { base: p[0] || '' };
    const dig = p.find(x => /^[0-9]$/.test(x)), rest = p.filter(x => !/^[0-9]$/.test(x));
    if (rest.length === 1) return { base: rest[0], dig };
    const [a, b] = rest; return a.length <= b.length ? { base: b, pfx: a, dig } : { base: a, pfx: b, dig };
  }
  /* CQ WPX prefix rules: N8BJQ → N8, W1ABC/4 → W4, VE3/W1ABC → VE3, a portable prefix with no digit (PA/N8BJQ) → PA0 */
  function wpx(call) {
    const { base, pfx, dig } = split(call);
    const of = c => { const m = /^([0-9]?[A-Z]+[0-9]+)/.exec(c); if (m) return m[1]; return ((/^[0-9]?[A-Z]{1,2}/.exec(c) || [c])[0]) + '0'; };
    if (pfx) return of(pfx);
    const p = of(base); return dig ? p.replace(/[0-9]+$/, dig) : p;
  }
  const CA_DIG = { 1: 'NS', 2: 'QC', 3: 'ON', 4: 'MB', 5: 'SK', 6: 'AB', 7: 'BC', 8: 'NT', 9: 'NB' };
  function caProv(call) {
    const { base, pfx } = split(call), c = pfx && CA_RE.test(pfx + '0') ? pfx : base, m = /^([A-Z]{2})([0-9])/.exec(c); if (!m) return '';
    if (m[1] === 'VO') return 'NL'; if (m[1] === 'VY') return m[2] === '1' ? 'YT' : m[2] === '2' ? 'PE' : m[2] === '0' ? 'NU' : ''; return CA_DIG[m[2]] || '';
  }
  function usArea(call) {
    const { base, pfx, dig } = split(call), src = pfx && US_RE.test(pfx + (/[0-9]$/.test(pfx) ? '' : '0')) ? pfx : base;
    const sp = /^(K|N|W|A)([HLP])([0-9])/.exec(src); if (sp) { const t = 'K' + sp[2] + sp[3]; if (['KH6', 'KH7', 'KL7', 'KP2', 'KP3', 'KP4'].includes(t)) return t; }
    return dig || (/[0-9]/.exec(src) || [''])[0];
  }
  const SPECIAL_SEC = { KH6: 'PAC', KH7: 'PAC', KL7: 'AK', KP3: 'PR', KP4: 'PR', KP2: 'VI' };

  /* ---------------- CTY.DAT (country-files.com) and a small built-in table until it is loaded ---------------- */
  let CTY = null;   /* { exact: Map, pfx: Map, max } */
  function ctyParse(text) {
    const db = { exact: new Map(), pfx: new Map(), max: 0, n: 0 };
    for (const rec of String(text || '').split(';')) {
      const t = rec.trim(); if (!t) continue;
      const lines = t.split(/\r?\n/), h = lines[0].split(':').map(x => x.trim()); if (h.length < 8) continue;
      const e = { name: h[0], cq: +h[1], itu: +h[2], cont: h[3], la: +h[4], lo: -+h[5], dxcc: h[7].replace(/^\*/, '') }; db.n++;
      for (const raw of lines.slice(1).join(' ').split(',')) {
        const a = raw.trim(); if (!a) continue;
        const ex = a[0] === '=', body = ex ? a.slice(1) : a, key = (/^[A-Z0-9/]+/.exec(body) || [])[0]; if (!key) continue;
        const r = { e }, cq = /\((\d+)\)/.exec(body), itu = /\[(\d+)\]/.exec(body), ct = /\{([A-Z]{2})\}/.exec(body);
        if (cq) r.cq = +cq[1]; if (itu) r.itu = +itu[1]; if (ct) r.cont = ct[1];
        if (ex) db.exact.set(key, r); else { db.pfx.set(key, r); db.max = Math.max(db.max, key.length); }
      }
    }
    return db;
  }
  /* rough built-in table: [prefix, dxcc, continent, CQ zone] — only the common ones, for a contest before CTY.DAT is loaded */
  const MINI = new Map([['K', 'K', 'NA', 5], ['N', 'K', 'NA', 5], ['W', 'K', 'NA', 5], ['AA', 'K', 'NA', 5], ['AB', 'K', 'NA', 5], ['AC', 'K', 'NA', 5], ['AD', 'K', 'NA', 5], ['AE', 'K', 'NA', 5], ['AF', 'K', 'NA', 5], ['AG', 'K', 'NA', 5], ['AI', 'K', 'NA', 5], ['AJ', 'K', 'NA', 5], ['AK', 'K', 'NA', 5],
    ['KH6', 'KH6', 'OC', 31], ['KL7', 'KL', 'NA', 1], ['KP4', 'KP4', 'NA', 8], ['KP2', 'KP2', 'NA', 8], ['VE', 'VE', 'NA', 5], ['VA', 'VE', 'NA', 5], ['VO', 'VE', 'NA', 5], ['VY', 'VE', 'NA', 5], ['XE', 'XE', 'NA', 6], ['XF', 'XE', 'NA', 6], ['CO', 'CO', 'NA', 8], ['CM', 'CO', 'NA', 8], ['HI', 'HI', 'NA', 8], ['TI', 'TI', 'NA', 7], ['YN', 'YN', 'NA', 7], ['HR', 'HR', 'NA', 7], ['TG', 'TG', 'NA', 7], ['V3', 'V3', 'NA', 7], ['HP', 'HP', 'NA', 7], ['6Y', '6Y', 'NA', 8], ['J3', 'J3', 'NA', 8], ['8P', '8P', 'NA', 8], ['VP9', 'VP9', 'NA', 5], ['C6', 'C6', 'NA', 8], ['ZF', 'ZF', 'NA', 8], ['PJ', 'PJ2', 'SA', 9],
    ['G', 'G', 'EU', 14], ['M', 'G', 'EU', 14], ['2E', 'G', 'EU', 14], ['GM', 'GM', 'EU', 14], ['MM', 'GM', 'EU', 14], ['GW', 'GW', 'EU', 14], ['MW', 'GW', 'EU', 14], ['GI', 'GI', 'EU', 14], ['EI', 'EI', 'EU', 14], ['F', 'F', 'EU', 14], ['DL', 'DL', 'EU', 14], ['DA', 'DL', 'EU', 14], ['DB', 'DL', 'EU', 14], ['DC', 'DL', 'EU', 14], ['DD', 'DL', 'EU', 14], ['DF', 'DL', 'EU', 14], ['DG', 'DL', 'EU', 14], ['DH', 'DL', 'EU', 14], ['DJ', 'DL', 'EU', 14], ['DK', 'DL', 'EU', 14], ['DM', 'DL', 'EU', 14], ['DO', 'DL', 'EU', 14], ['I', 'I', 'EU', 15], ['IK', 'I', 'EU', 15], ['IZ', 'I', 'EU', 15], ['EA', 'EA', 'EU', 14], ['EA8', 'EA8', 'AF', 33], ['CT', 'CT', 'EU', 14], ['PA', 'PA', 'EU', 14], ['PD', 'PA', 'EU', 14], ['PE', 'PA', 'EU', 14], ['ON', 'ON', 'EU', 14], ['HB', 'HB', 'EU', 14], ['OE', 'OE', 'EU', 15], ['SP', 'SP', 'EU', 15], ['SQ', 'SP', 'EU', 15], ['OK', 'OK', 'EU', 15], ['OL', 'OK', 'EU', 15], ['OM', 'OM', 'EU', 15], ['HA', 'HA', 'EU', 15], ['YO', 'YO', 'EU', 20], ['LZ', 'LZ', 'EU', 20], ['SV', 'SV', 'EU', 20], ['9A', '9A', 'EU', 15], ['S5', 'S5', 'EU', 15], ['YU', 'YU', 'EU', 15], ['SM', 'SM', 'EU', 14], ['SA', 'SM', 'EU', 14], ['LA', 'LA', 'EU', 14], ['OH', 'OH', 'EU', 15], ['OZ', 'OZ', 'EU', 14], ['ES', 'ES', 'EU', 15], ['YL', 'YL', 'EU', 15], ['LY', 'LY', 'EU', 15], ['UR', 'UR', 'EU', 16], ['UT', 'UR', 'EU', 16], ['US', 'UR', 'EU', 16], ['UA', 'UA', 'EU', 16], ['RA', 'UA', 'EU', 16], ['RU', 'UA', 'EU', 16], ['RZ', 'UA', 'EU', 16], ['R', 'UA', 'EU', 16], ['UA9', 'UA9', 'AS', 17], ['UA0', 'UA9', 'AS', 18], ['RA9', 'UA9', 'AS', 17], ['R9', 'UA9', 'AS', 17], ['R0', 'UA9', 'AS', 18], ['TA', 'TA', 'AS', 20], ['4X', '4X', 'AS', 20],
    ['JA', 'JA', 'AS', 25], ['JE', 'JA', 'AS', 25], ['JF', 'JA', 'AS', 25], ['JH', 'JA', 'AS', 25], ['JR', 'JA', 'AS', 25], ['7K', 'JA', 'AS', 25], ['BY', 'BY', 'AS', 24], ['BG', 'BY', 'AS', 24], ['BV', 'BV', 'AS', 24], ['HL', 'HL', 'AS', 25], ['DS', 'HL', 'AS', 25], ['VU', 'VU', 'AS', 22], ['HS', 'HS', 'AS', 26], ['9V', '9V', 'AS', 28], ['9M2', '9M2', 'AS', 28], ['A6', 'A6', 'AS', 21], ['HZ', 'HZ', 'AS', 21],
    ['VK', 'VK', 'OC', 30], ['ZL', 'ZL', 'OC', 32], ['DU', 'DU', 'OC', 27], ['YB', 'YB', 'OC', 28], ['KH2', 'KH2', 'OC', 27], ['ZS', 'ZS', 'AF', 38], ['5Z', '5Z', 'AF', 37], ['SU', 'SU', 'AF', 34], ['CN', 'CN', 'AF', 33], ['5N', '5N', 'AF', 35], ['V5', 'V5', 'AF', 38],
    ['LU', 'LU', 'SA', 13], ['PY', 'PY', 'SA', 11], ['PU', 'PY', 'SA', 11], ['PP', 'PY', 'SA', 11], ['CE', 'CE', 'SA', 12], ['CX', 'CX', 'SA', 13], ['HK', 'HK', 'SA', 9], ['OA', 'OA', 'SA', 10], ['YV', 'YV', 'SA', 9], ['HC', 'HC', 'SA', 10], ['CP', 'CP', 'SA', 10], ['ZP', 'ZP', 'SA', 11]].map(([p, d, c, z]) => [p, { dxcc: d, cont: c, cq: z }]));
  const IC = new Map();
  function info(call) {
    const c = norm(call); let v = IC.get(c); if (v) return v;
    const { base, pfx } = split(c), look = pfx || base, probe = look + (/[0-9]/.test(look) ? '' : '0');
    v = { call: c, base, prefix: wpx(c), us: US_RE.test(probe), ca: false };
    v.ca = !v.us && CA_RE.test(probe);
    if (v.us) v.area = usArea(c); if (v.ca) v.prov = caProv(c);
    let hit = null;
    if (CTY) {
      const ex = CTY.exact.get(c.replace(/\/(P|M|MM|AM|QRP|[0-9])$/, ''));
      if (ex) hit = ex; else for (let n = Math.min(look.length, CTY.max); n > 0 && !hit; n--) hit = CTY.pfx.get(look.slice(0, n)) || null;
      if (hit) { v.dxcc = hit.e.dxcc; v.cty = hit.e.name; v.cont = hit.cont || hit.e.cont; v.cq = hit.cq || hit.e.cq; v.itu = hit.itu || hit.e.itu; v.la = hit.e.la; v.lo = hit.e.lo; }   /* Nov 6: la/lo = the country's centre (the rotator's fallback) */
    }
    if (!hit) for (let n = Math.min(look.length, 3); n > 0; n--) { const m = MINI.get(look.slice(0, n)); if (m) { v.dxcc = m.dxcc; v.cont = m.cont; v.cq = m.cq; break; } }
    IC.set(c, v); return v;
  }
  function ctySet(text, quiet) {
    const db = ctyParse(text); if (db.n < 50) { if (!quiet) AP.toast('That file is not a CTY.DAT country file.', 4000, 'bad'); return false; }
    CTY = db; IC.clear(); try { localStorage.setItem('kpcCty', text); localStorage.setItem('kpcCtyT', String(Date.now())); } catch (e) {}
    if (!quiet) AP.toast('🌍 CTY.DAT loaded: ' + db.n + ' countries.', 3000, 'log'); recalc(); return true;
  }
  try { const t = localStorage.getItem('kpcCty'); if (t) CTY = ctyParse(t); } catch (e) {}

  /* ---------------- Super Check Partial (MASTER.SCP) ---------------- */
  let SCP = null;
  function scpSet(text, quiet) {
    const s = new Set(); String(text || '').split(/\r?\n/).forEach(l => { const c = l.trim().toUpperCase(); if (c && c[0] !== '#' && /^[A-Z0-9/]{3,}$/.test(c)) s.add(c); });
    if (s.size < 100) { if (!quiet) AP.toast('That file is not a MASTER.SCP list.', 4000, 'bad'); return false; }
    SCP = s; try { localStorage.setItem('kpcScp', [...s].join('\n')); localStorage.setItem('kpcScpT', String(Date.now())); } catch (e) {}
    if (!quiet) AP.toast('✅ MASTER.SCP loaded: ' + s.size.toLocaleString() + ' calls.', 3000, 'log'); return true;
  }
  try { const t = localStorage.getItem('kpcScp'); if (t) SCP = new Set(t.split('\n')); } catch (e) {}
  function partial(f, max) { f = norm(f); if (!SCP || f.length < 2) return []; const out = []; for (const c of SCP) { if (c.includes(f)) { out.push(c); if (out.length >= (max || 12)) break; } } return out.sort(); }
  function edits(a, b, cap) {
    if (a === b) return 0; let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; let lo = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur.push(v); if (v < lo) lo = v; } if (lo > cap) return lo; prev = cur; }
    return prev[b.length];
  }

  /* ======================================================================== CONTESTS
     Each contest = one object: rcvd / sent exchange fields, dupe key, points, mults, score, Cabrillo columns.
     x = the contact the engine looks at: {call, band, mc (CW|PH|DG), mode, r (received), s (sent), gota, t} */
  const HF6 = ['160m', '80m', '40m', '20m', '15m', '10m'];
  const FDB = HF6.concat(['6m', '2m', '1.25m', '70cm', '33cm', '23cm']);
  const PHONE = /^(SSB|USB|LSB|AM|FM|DV|DIGITALVOICE|DSTAR|DMR|C4FM|FREEDV|M17|PH|PHONE)$/;
  const mcOf = m => { m = String(m || '').toUpperCase(); return m === 'CW' ? 'CW' : PHONE.test(m) ? 'PH' : 'DG'; };
  const byMode = p => x => p[x.mc] || 0;
  const F = {
    rst: { k: 'rst', l: 'RST', w: 3, re: /^[1-5][1-9][1-9]?$/, auto: x => x.mc === 'PH' ? '59' : '599' },
    nr: { k: 'nr', l: 'NR', w: 4, re: /^\d{1,5}$/, num: 1 },
    sec: { k: 'sec', l: 'SECTION', w: 4, up: 1, list: 'cxSecL', ok: v => SECM.has(v) || v === 'DX' ? '' : 'unknown section ' + v },
    cls: { k: 'cls', l: 'CLASS', w: 3, up: 1, re: /^\d{1,2}[A-F]$/ },
    wcls: { k: 'cls', l: 'CLASS', w: 3, up: 1, re: /^\d{1,2}[HIOM]$/ },
    prec: { k: 'prec', l: 'PREC', w: 1, up: 1, re: /^[QABUMS]$/ },
    chk: { k: 'chk', l: 'CK', w: 2, re: /^\d{2}$/ },
    zone: { k: 'zone', l: 'ZONE', w: 2, re: /^\d{1,2}$/ },
    izone: { k: 'zone', l: 'ZONE/HQ', w: 4, up: 1 },
    name: { k: 'name', l: 'NAME', w: 6, up: 1, re: /^[A-Z]{1,12}$/ },
    loc: { k: 'loc', l: 'ST/PROV', w: 4, up: 1 },
    pwr: { k: 'loc', l: 'POWER', w: 4, up: 1 },
    sorn: { k: 'loc', l: 'ST/NR', w: 4, up: 1 },
    cty: { k: 'loc', l: 'COUNTY/ST', w: 5, up: 1 }
  };
  const sameCty = (x, c) => { const t = info(x.call); return !!t.dxcc && t.dxcc === c.my.dxcc; };
  const wve = call => { const i = info(call); return i.us || i.ca; };
  const naCty = x => { const t = info(x.call); return t.cont === 'NA' && !t.us && !t.ca ? (t.dxcc || '') : ''; };
  const L = x => String(x.r.loc || '').toUpperCase();
  const low = b => b === '160m' || b === '80m' || b === '40m';
  const stMult = (x, scope) => { const t = info(x.call); return t.us || t.ca ? [{ t: 'state', v: STPR.has(L(x)) ? L(x) : '', s: scope }] : [{ t: 'country', v: t.dxcc || '', s: scope }]; };

  /* Field Day bonus checklist (2026 rules, 7.3): [key, words, points or per-count function, classes it counts for] */
  const FD_BONUS = [
    ['emerg', '100% emergency power (how many transmitters)', n => Math.min(n, 20) * 100, 'ABCEF'], ['media', 'Media publicity', 100, 'ABCDEF'], ['public', 'Public location', 100, 'ABF'], ['table', 'Public information table', 100, 'ABF'],
    ['smmsg', 'Message to the Section Manager / SEC by radio', 100, 'ABCDEF'], ['msgs', 'Formal messages handled (how many, 10 each, up to 10)', n => Math.min(n, 10) * 10, 'ABCDEF'], ['sat', 'Satellite contact', 100, 'ABF'],
    ['alt', 'Alternate power (5 contacts, no mains or petrol generator)', 100, 'ABEF'], ['w1aw', 'W1AW / K6KPH bulletin copied', 100, 'ABCDEF'], ['edu', 'Educational activity', 100, 'ADEF'], ['official', 'Elected official visit', 100, 'ABCDEF'],
    ['agency', 'Served agency visit', 100, 'ABCDEF'], ['coach', 'GOTA coach (10+ supervised contacts)', 100, 'AF'], ['web', 'Entry sent with the ARRL web app', 50, 'ABCDEF'], ['youth', 'Youth (18 or under) with a contact (how many)', n => Math.min(n, 5) * 20, 'ABCDEF'],
    ['social', 'Social media promotion (clubs)', 100, 'ABCDEF'], ['safety', 'Safety Officer', 100, 'A'], ['site', 'Site responsibilities checklist', 50, 'BCDEF']];
  const fdPower = () => { const w = +CF.watts || 100; return w <= 5 && /BATTERY|SOLAR|NATURAL/.test(CF.psrc || '') ? 5 : w <= 100 ? 2 : 1; };
  function fdBonus(list) {
    const cls = (String(CF.sent.cls || '1A').replace(/\d+/, '') || 'A').toUpperCase()[0]; let n = 0;
    FD_BONUS.forEach(([k, , p, cl]) => { const v = CF.bonus[k]; if (!v || !cl.includes(cls)) return; n += typeof p === 'function' ? p(+v) : p; });
    if (cls === 'A' || cls === 'F') n += list.filter(q => q.cx && q.cx.g).length * 5;   /* 7.3.13: 5 per GOTA contact, not multiplied */
    return n;
  }

  const C = [
    { id: 'arrl-fd', name: 'ARRL Field Day', cab: 'ARRL-FD', cos: 'ARRL-FD', adif: 'ARRL-FIELD-DAY', url: 'https://www.arrl.org/field-day-rules', bands: FDB, modes: ['CW', 'PH', 'DG'],
      rcvd: [F.cls, F.sec], sent: [F.cls, F.sec], fd: 1, noRst: 1,
      dupe: x => x.call + '|' + x.band + '|' + x.mc + (x.gota ? '|G' : ''), points: byMode({ PH: 1, CW: 2, DG: 2 }),
      score: (t, list) => t.pts * fdPower() + fdBonus(list), cabS: (x, s) => [s.cls, s.sec], cabR: x => [x.r.cls, x.r.sec],
      notes: 'Checked against the 2026 rules (Nov 5 2026): phone 1, CW + digital 2; power ×5 (5 W or less, not on mains or a generator), ×2 (100 W or less), ×1 (more); classes A/B/C up to 500 W, D/E/F up to 100 W; each station once per band per mode; GOTA = 5 bonus points each.' },
    { id: 'wfd', name: 'Winter Field Day', cab: 'WFD', cos: 'WFD', adif: 'WFD', url: 'https://winterfieldday.org/sop.php', bands: HF6.concat(['6m', '2m', '70cm']), modes: ['CW', 'PH', 'DG'],
      rcvd: [F.wcls, F.sec], sent: [F.wcls, F.sec], noRst: 1, wfd: 1,
      points: x => /^FT[48]$/.test(x.mode) ? null : byMode({ PH: 1, CW: 2, DG: 2 })(x), score: t => t.pts * Math.max(1, +CF.om || 1),
      cabS: (x, s) => [s.cls, s.sec], cabR: x => [x.r.cls, x.r.sec], notes: 'VERIFY each year: the objectives (they multiply the score), the times, the points. No FT8 / FT4. 100 W at most.' },
    ...['CW', 'SSB'].map(m => ({ id: 'arrl-ss-' + m.toLowerCase(), name: 'ARRL Sweepstakes ' + m, cab: 'ARRL-SS-' + m, cos: 'ARRL-SS-' + m, adif: 'ARRL-SS-' + m, url: 'https://www.arrl.org/sweepstakes', bands: HF6, modes: [m === 'CW' ? 'CW' : 'PH'],
      rcvd: [F.nr, F.prec, F.chk, F.sec], sent: [F.prec, F.chk, F.sec], serial: 1, noRst: 1,
      dupe: x => x.call, points: () => 2, mults: x => [{ t: 'section', v: String(x.r.sec || '').toUpperCase(), s: 'once' }], sweep: 1,
      cabS: (x, s) => [x.s.nr, s.prec, s.chk, s.sec], cabR: x => [x.r.nr, x.r.prec, x.r.chk, x.r.sec], notes: '85 sections for a clean sweep (71 US + 14 RAC). Each station once, any band.' })),
    ...['CW', 'SSB', 'RTTY'].map(m => ({ id: 'cqww-' + m.toLowerCase(), name: 'CQ WW DX ' + m, cab: 'CQ-WW-' + m, cos: 'CQ-WW-' + m, adif: 'CQ-WW-' + m, url: 'https://www.cqww.com/rules.htm', bands: HF6, modes: [m === 'CW' ? 'CW' : m === 'SSB' ? 'PH' : 'DG'],
      rcvd: m === 'RTTY' ? [F.rst, F.zone, F.loc] : [F.rst, F.zone], sent: [F.zone], dx: 1,
      dupe: x => x.call + '|' + x.band,
      points: (x, c) => { const t = info(x.call); if (sameCty(x, c)) return m === 'RTTY' ? 1 : 0; if (t.cont && t.cont !== c.my.cont) return 3; return c.my.cont === 'NA' ? 2 : 1; },
      mults: x => { const z = +x.r.zone, h = [{ t: 'zone', v: z >= 1 && z <= 40 ? String(z) : '', s: 'band' }, { t: 'country', v: info(x.call).dxcc || '', s: 'band' }]; if (m === 'RTTY' && wve(x.call)) h.push({ t: 'state', v: STPR.has(L(x)) ? L(x) : '', s: 'band' }); return h; },
      cabS: (x, s) => [x.s.rst || '599', s.zone], cabR: x => [x.r.rst || '599', x.r.zone], notes: 'Needs CTY.DAT for countries + continents. Same-country contacts: 0 points (CW/SSB), multiplier credit only.' })),
    ...['CW', 'SSB', 'RTTY'].map(m => ({ id: 'cqwpx-' + m.toLowerCase(), name: 'CQ WPX ' + m, cab: 'CQ-WPX-' + m, cos: 'CQ-WPX-' + m, adif: 'CQ-WPX-' + m, url: 'https://www.cqwpx.com/rules.htm', bands: HF6, modes: [m === 'CW' ? 'CW' : m === 'SSB' ? 'PH' : 'DG'],
      rcvd: [F.rst, F.nr], sent: [], serial: 1, dx: 1, dupe: x => x.call + '|' + x.band,
      points: (x, c) => { const t = info(x.call), lb = low(x.band); if (sameCty(x, c)) return 1; if (t.cont && t.cont !== c.my.cont) return lb ? 6 : 3; if (c.my.cont === 'NA') return lb ? 4 : 2; return lb ? 2 : 1; },
      mults: x => [{ t: 'prefix', v: info(x.call).prefix, s: 'once' }], cabS: x => [x.s.rst || '599', x.s.nr], cabR: x => [x.r.rst || '599', x.r.nr], notes: 'VERIFY the same-country point value each year.' })),
    ...['CW', 'SSB'].map(m => ({ id: 'arrl-dx-' + m.toLowerCase(), name: 'ARRL International DX ' + m, cab: 'ARRL-DX-' + m, cos: 'ARRL-DX-' + m, adif: 'ARRL-DX-' + m, url: 'https://www.arrl.org/arrl-dx', bands: HF6, modes: [m === 'CW' ? 'CW' : 'PH'],
      rcvd: [F.rst, F.pwr], sent: [F.loc], dx: 1, dupe: x => x.call + '|' + x.band,
      points: (x, c) => wve(x.call) === !!(c.my.us || c.my.ca) ? null : 3,
      mults: (x, c) => (c.my.us || c.my.ca) ? [{ t: 'country', v: info(x.call).dxcc || '', s: 'band' }] : [{ t: 'state', v: STPR.has(L(x)) ? L(x) : '', s: 'band' }],
      cabS: (x, s) => [x.s.rst || '599', s.loc], cabR: x => [x.r.rst || '599', x.r.loc], notes: 'W/VE work DX only (3 points, DXCC countries per band); DX work W/VE only.' })),
    ...['CW', 'SSB', 'RTTY'].map(m => ({ id: 'naqp-' + m.toLowerCase(), name: 'NAQP ' + m, cab: 'NAQP-' + m, cos: 'NAQP-' + m, adif: 'NAQP-' + m, url: 'https://ncjweb.com/naqp/', bands: HF6, modes: [m === 'CW' ? 'CW' : m === 'SSB' ? 'PH' : 'DG'],
      rcvd: [F.name, F.loc], sent: [F.name, F.loc], noRst: 1, dupe: x => x.call + '|' + x.band, points: () => 1,
      mults: x => { const t = info(x.call); return t.us || t.ca ? [{ t: 'state', v: STPR.has(L(x)) ? L(x) : '', s: 'band' }] : [{ t: 'country', v: naCty(x), s: 'band' }]; },
      cabS: (x, s) => [s.name, s.loc], cabR: x => [x.r.name, x.r.loc], notes: 'VERIFY: whether KH6 / KL7 count as states; credit for non-NA contacts.' })),
    ...['CW', 'SSB', 'RTTY'].map(m => ({ id: 'na-sprint-' + m.toLowerCase(), name: 'NA Sprint ' + m, cab: 'NA-SPRINT-' + m, cos: 'NA-SPRINT-' + m, adif: 'NA-SPRINT-' + m, url: 'https://ncjweb.com/sprint-rules/', bands: ['80m', '40m', '20m'], modes: [m === 'CW' ? 'CW' : m === 'SSB' ? 'PH' : 'DG'],
      rcvd: [F.nr, F.name, F.loc], sent: [F.name, F.loc], serial: 1, noRst: 1, dupe: x => x.call + '|' + x.band, points: () => 1,
      mults: x => { const t = info(x.call); return t.us || t.ca ? [{ t: 'state', v: STPR.has(L(x)) ? L(x) : '', s: 'once' }] : [{ t: 'country', v: naCty(x), s: 'once' }]; },
      cabS: (x, s) => [x.s.nr, s.name, s.loc], cabR: x => [x.r.nr, x.r.name, x.r.loc], notes: 'The QSY rule (the CQing station moves after each contact) is up to you, not checked here.' })),
    { id: 'arrl-10', name: 'ARRL 10 Meter', cab: 'ARRL-10', cos: 'ARRL-10', adif: 'ARRL-10', url: 'https://www.arrl.org/10-meter', bands: ['10m'], modes: ['CW', 'PH'],
      rcvd: [F.rst, F.sorn], sent: [F.sorn], dupe: x => x.call + '|' + x.mc, points: byMode({ PH: 2, CW: 4 }),
      mults: x => { const t = info(x.call); if (t.us || t.ca) return [{ t: 'state', v: STPR.has(L(x)) ? L(x) : '', s: 'mode' }]; if (t.dxcc === 'XE') return [{ t: 'xe', v: L(x), s: 'mode' }]; return [{ t: 'country', v: t.dxcc || '', s: 'mode' }]; },
      cabS: (x, s) => [x.s.rst || '59', s.loc], cabR: x => [x.r.rst || '59', x.r.loc], notes: 'VERIFY: Mexican states, ITU regions for /MM.' },
    { id: 'arrl-160', name: 'ARRL 160 Meter', cab: 'ARRL-160', cos: 'ARRL-160', adif: 'ARRL-160', url: 'https://www.arrl.org/160-meter', bands: ['160m'], modes: ['CW'],
      rcvd: [F.rst, F.sec], sent: [F.sec], dupe: x => x.call, sweep: 1,
      points: (x, c) => wve(x.call) ? 2 : (c.my.us || c.my.ca) ? 5 : null,
      mults: x => wve(x.call) ? [{ t: 'section', v: String(x.r.sec || '').toUpperCase(), s: 'once' }] : [{ t: 'country', v: info(x.call).dxcc || '', s: 'once' }],
      cabS: (x, s) => [x.s.rst || '599', s.sec], cabR: x => [x.r.rst || '599', x.r.sec], notes: 'W/VE: 2 points each, DX 5; sections + DXCC countries once.' },
    { id: 'arrl-rtty', name: 'ARRL RTTY Roundup', cab: 'ARRL-RTTY', cos: 'ARRL-RTTY', adif: 'ARRL-RTTY', url: 'https://www.arrl.org/rtty-roundup', bands: ['80m', '40m', '20m', '15m', '10m'], modes: ['DG'],
      rcvd: [F.rst, F.sorn], sent: [F.sorn], dupe: x => x.call + '|' + x.band, points: x => x.mc === 'DG' ? 1 : null, mults: x => stMult(x, 'once'),
      cabS: (x, s) => [x.s.rst || '599', s.loc], cabR: x => [x.r.rst || '599', x.r.loc], notes: 'VERIFY which states count (48 + DC or 50), KH6 / KL7 as countries.' },
    { id: 'iaru-hf', name: 'IARU HF Championship', cab: 'IARU-HF', cos: 'IARU-HF', adif: 'IARU-HF', url: 'https://www.arrl.org/iaru-hf-championship', bands: HF6, modes: ['CW', 'PH'],
      rcvd: [F.rst, F.izone], sent: [F.izone], dx: 1, dupe: x => x.call + '|' + x.band + '|' + x.mc,
      points: (x, c) => { const z = String(x.r.zone || ''); if (!/^\d+$/.test(z)) return 1; if (+z === +CF.sent.zone) return 1; return info(x.call).cont === c.my.cont ? 3 : 5; },
      mults: x => { const z = String(x.r.zone || '').toUpperCase(); return [/^\d+$/.test(z) ? { t: 'zone', v: String(+z), s: 'band' } : { t: 'hq', v: z, s: 'band' }]; },
      cabS: (x, s) => [x.s.rst || '599', s.zone], cabR: x => [x.r.rst || '599', x.r.zone] },
    { id: 'cwt', name: 'CWops CWT', cab: 'CWOPS-CWT', cos: 'CWOPS-CWT', adif: 'CWOPS-CWT', url: 'https://cwops.org/cwops-tests/', bands: HF6, modes: ['CW'],
      rcvd: [F.name, { k: 'nr', l: 'NR/ST', w: 5, up: 1 }], sent: [F.name, { k: 'nr', l: 'MEMBER # (or state)', w: 6, up: 1 }], noRst: 1, dupe: x => x.call + '|' + x.band, points: () => 1,
      mults: x => [{ t: 'call', v: x.call, s: 'once' }], cabS: (x, s) => [s.name, s.nr], cabR: x => [x.r.name, x.r.nr], notes: 'One hour; scores go to 3830. VERIFY the scoreboard name.' },
    { id: 'sst', name: 'K1USN Slow Speed Test', cab: 'K1USN-SST', cos: 'K1USN-SST', adif: 'K1USN-SST', url: 'https://k1usn.com/sst.html', bands: HF6, modes: ['CW'],
      rcvd: [F.name, F.loc], sent: [F.name, F.loc], noRst: 1, dupe: x => x.call + '|' + x.band, points: () => 1, mults: x => stMult(x, 'once'),
      cabS: (x, s) => [s.name, s.loc], cabR: x => [x.r.name, x.r.loc] }
  ];
  /* State QSO parties: one template; the county lists live in QP below (add a party = one line + its counties) */
  const QP = LS('kpcAppQp', {});   /* {id: {name, state, counties: {ABR: name}, pts: {PH, CW, DG}, url, cab}} — loaded from a file (📂 ADD A QSO PARTY) */
  function qsoParty(p) {
    const cty = v => String(v || '').toUpperCase() in (p.counties || {});
    return { id: p.id, name: p.name, cab: p.cab || (p.state + '-QSO-PARTY'), cos: p.cab || (p.state + '-QSO-PARTY'), adif: p.cab || (p.state + '-QSO-PARTY'), url: p.url || '', bands: HF6.concat(['6m', '2m']), modes: ['CW', 'PH', 'DG'],
      rcvd: [F.rst, F.cty], sent: [F.cty], qp: p, dupe: x => x.call + '|' + x.band + '|' + x.mc + '|' + (cty(L(x)) ? L(x) : ''),
      points: x => (p.pts || { PH: 1, CW: 2, DG: 2 })[x.mc] || 0,
      mults: x => { const v = L(x); if (cty(v)) return [{ t: 'county', v, s: 'once' }]; if (String(CF.sent.loc || '').toUpperCase() in (p.counties || {}) || AP.me().cnty.startsWith(p.state)) { if (STPR.has(v)) return [{ t: 'state', v, s: 'once' }]; if (v === 'DX') return [{ t: 'dx', v, s: 'once' }]; } return []; },
      cabS: (x, s) => [x.s.rst || '59', s.loc], cabR: x => [x.r.rst || '59', x.r.loc], notes: 'Every QSO party is a little different: check the points, multipliers, bonus stations and county list each year. A mobile that moves county can be worked again.' };
  }
  const all = () => C.concat(Object.keys(QP).map(k => qsoParty(Object.assign({ id: k }, QP[k]))));
  const def = () => all().find(c => c.id === CF.id) || C[0];
  const KEY = () => CF.id + '-' + (CF.yr || YEAR);
  const LOGID = () => 'cx-' + KEY();

  /* ======================================================================== THE ENGINE (dupes, mults, score) */
  let R = { list: [], per: new Map(), dupes: new Map(), mults: new Map(), byType: {}, rows: {}, qsos: 0, pts: 0, score: 0, bonus: 0 };
  const myInfo = () => { const me = AP.me(); const i = info(me.station || me.call || 'K0XX'); return Object.assign({}, i, { cont: i.cont || 'NA' }); };
  const inCx = q => q && !q.d && (q.opn === LOGID() || (q.cx && q.cx.k === KEY()));
  function xOf(q) { const cx = q.cx || {}; return { id: q.id, call: String(q.call || '').toUpperCase(), band: String(q.band || '').toLowerCase(), mode: String(q.mode || '').toUpperCase(), mc: mcOf(q.mode), r: Object.assign({ rst: q.rr }, cx.r || {}), s: Object.assign({ rst: q.rs }, cx.s || {}), gota: !!cx.g, t: q.t, q }; }
  const mkey = (h, x) => h.s === 'once' ? h.t + '|' + h.v : h.s === 'band' ? h.t + '|' + x.band + '|' + h.v : h.s === 'mode' ? h.t + '|' + x.mc + '|' + h.v : h.t + '|' + x.band + '|' + x.mc + '|' + h.v;
  function recalc() {
    const D = def(), c = { my: myInfo() }, out = { list: [], per: new Map(), dupes: new Map(), mults: new Map(), byType: {}, rows: {}, qsos: 0, pts: 0 };
    const recs = [...KPCLog.all().values()].filter(inCx).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    out.list = recs;
    for (const q of recs) {
      const x = xOf(q), dk = D.dupe ? D.dupe(x) : x.call + '|' + x.band + '|' + x.mc;
      if (out.dupes.has(dk)) { out.per.set(q.id, { dupe: true, pts: 0, nm: [] }); continue; }
      out.dupes.set(dk, q.id);
      const p = D.points(x, c); if (p === null) { out.per.set(q.id, { no: true, pts: 0, nm: [] }); continue; }
      const nm = [];
      for (const h of (D.mults ? D.mults(x, c) : [])) { if (!h.v) continue; const k = mkey(h, x); if (!out.mults.has(k)) { out.mults.set(k, q.id); nm.push(h); out.byType[h.t] = (out.byType[h.t] || 0) + 1; } }
      out.per.set(q.id, { pts: p, nm }); out.qsos++; out.pts += p;
      const rk = x.band + ' ' + x.mc, row = out.rows[rk] || (out.rows[rk] = { band: x.band, mc: x.mc, q: 0, p: 0, m: {} }); row.q++; row.p += p; nm.forEach(h => { row.m[h.t] = (row.m[h.t] || 0) + 1; });
    }
    out.mt = Object.values(out.byType).reduce((a, b) => a + b, 0);
    out.bonus = D.fd ? fdBonus(recs) : 0;
    out.score = D.score ? D.score(out, recs) : out.pts * Math.max(1, out.mt);
    R = out; AP.fire('contest', { score: R.score }); if (on()) draw();
    return R;
  }
  function dupeOf(call, band, mode) {
    const D = def(), x = { call: norm(call), band: String(band || '').toLowerCase(), mode: String(mode || '').toUpperCase(), mc: mcOf(mode), r: {}, s: {}, gota: false };
    const id = R.dupes.get(D.dupe ? D.dupe(x) : x.call + '|' + x.band + '|' + x.mc); return id ? KPCLog.get(id) : null;
  }
  function previewMults(call, band, mode, r) {
    const D = def(); if (!D.mults) return [];
    const x = { call: norm(call), band: String(band || '').toLowerCase(), mode: String(mode || '').toUpperCase(), mc: mcOf(mode), r: r || {}, s: {} };
    return D.mults(x, { my: myInfo() }).filter(h => h.v && !R.mults.has(mkey(h, x)));
  }
  /* the colour of a spot on the band map: 'dupe' | 'mult' | 'need' | 'no' (does not count) */
  function status(call, band, mode) {
    if (dupeOf(call, band, mode)) return 'dupe';
    const D = def(), x = { call: norm(call), band: String(band || '').toLowerCase(), mode: String(mode || '').toUpperCase(), mc: mcOf(mode), r: history(call) || {}, s: {} };
    if (!D.bands.includes(x.band) || !D.modes.includes(x.mc)) return 'no';
    if (D.points(x, { my: myInfo() }) === null) return 'no';
    return previewMults(call, band, mode, x.r).length ? 'mult' : 'need';
  }
  /* last exchange heard from that call in this contest (every device's contacts) — fills the boxes */
  function history(call) { const c = norm(call); let best = null; for (const q of R.list) if (q.call === c && q.cx && q.cx.r && (!best || q.t > best.t)) best = q; return best ? Object.assign({}, best.cx.r) : null; }
  function rates() {
    const now = Date.now(), ts = R.list.map(q => q.t), hr = ts.filter(t => now - t <= 3600000).length, l10 = ts.slice(-10);
    const span = l10.length >= 5 ? l10[l10.length - 1] - l10[0] : 0;   /* the last-10 rate only once there are 5+ contacts over 2+ minutes (3 in 10 s is not 6000 an hour) */
    return { hour: hr, last10: span >= 120000 ? Math.round((l10.length - 1) / (span / 3600000)) : 0 };
  }
  const nextNr = () => { const me = AP.me().station; return R.list.filter(q => (q.station || '') === me || !q.station).length + 1; };

  /* ======================================================================== THE LOG LINE (dock) */
  const fid = f => 'cxR_' + f.k;
  function sentNow() { const s = Object.assign({}, CF.sent); if (def().serial) s.nr = String(nextNr()); return s; }
  /* KPCLog's ⬆ calls this for the contact it is about to save (kpc-log.js onsubmit) */
  function entryCx() {
    if (!on('log') || !$('cxRow')) return null;
    const D = def(), r = {};
    D.rcvd.forEach(f => { const el = $(fid(f)); if (el) { const v = el.value.trim(); r[f.k] = f.up ? v.toUpperCase() : v; } });
    if (D.rcvd.some(f => f.k === 'rst') && !r.rst) delete r.rst;
    const cx = { k: KEY(), c: D.id, s: sentNow(), r };
    if ($('cxGota') && $('cxGota').classList.contains('on')) cx.g = 1;
    return cx;
  }
  function dockRow() {
    const dock = $('lgDock'), form = $('lgForm'); if (!dock || !form) return;
    let row = $('cxRow');
    const want = on('log') && KPCLog.cur() === LOGID();
    document.body.classList.toggle('cx-on', want);
    if (!want) { if (row) row.remove(); return; }
    const D = def(), sig = D.id + '|' + D.rcvd.map(f => f.k).join(',');
    if (row && row.dataset.sig === sig) return;
    if (row) row.remove();
    dock.insertBefore(Object.assign(document.createElement('div'), { id: 'cxRow', className: 'cxrow' }), form);
    row = $('cxRow'); row.dataset.sig = sig;
    row.innerHTML = `<span class="cxname" title="${esc(D.name)}">🏆 ${esc(D.name.replace(/^ARRL /, ''))}</span>` +
      D.rcvd.map(f => `<label class="e cxe" style="--w:${f.w}">${esc(f.l)}<input id="${fid(f)}" form="lgForm" ${f.list ? 'list="' + f.list + '"' : ''} autocapitalize="characters" spellcheck="false" autocomplete="off" enterkeyhint="done"></label>`).join('') +
      (D.fd ? '<button type="button" class="chip" id="cxGota" title="This contact was made at the GOTA station">GOTA</button>' : '') +
      `<span class="cxst" id="cxSt"></span><datalist id="cxSecL">${SEC.map(s => `<option value="${s.abbr}">${esc(s.name)}</option>`).join('')}<option value="DX">DX</option></datalist>`;
    if ($('cxGota')) $('cxGota').onclick = () => $('cxGota').classList.toggle('on');
    D.rcvd.forEach(f => { const el = $(fid(f)); el.addEventListener('input', () => { if (f.up) { const p = el.selectionStart; el.value = el.value.toUpperCase(); try { el.setSelectionRange(p, p); } catch (e) {} } check(); }); });
    check();
  }
  let lastCall = '';
  function check() {
    const st = $('cxSt'); if (!st) return;
    const call = norm($('eCall') ? $('eCall').value : ''), D = def(), dk = KPCLog.dock || {};
    const band = KPCLog.band(+dk.khz) || '', mode = dk.mode || '';
    if (call !== lastCall) {
      lastCall = call; const h = call.length >= 3 ? history(call) : null;
      D.rcvd.forEach(f => { const el = $(fid(f)); if (el && h && h[f.k] && !el.value && f.k !== 'nr' && f.k !== 'rst') el.value = h[f.k]; });
    }
    if (call.length < 3) { st.className = 'cxst'; st.innerHTML = scpLine(call); return; }
    const r = {}; D.rcvd.forEach(f => { const el = $(fid(f)); if (el && el.value) r[f.k] = el.value.trim().toUpperCase(); });
    const d = dupeOf(call, band, mode);
    if (d) { st.className = 'cxst dupe'; st.innerHTML = '⛔ DUPE · worked ' + esc(d.band) + ' ' + esc(d.mode) + ' at ' + AP.utc(d.t) + 'z'; return; }
    const nm = previewMults(call, band, mode, r), bad = D.rcvd.map(f => { const v = r[f.k]; if (!v) return ''; if (f.re && !f.re.test(v)) return f.l + '?'; return f.ok ? f.ok(v) : ''; }).filter(Boolean);
    const busted = SCP && SCP.size && !SCP.has(call) ? ' · <i>not in SCP</i>' : '';
    st.className = 'cxst ' + (nm.length ? 'mult' : 'need');
    st.innerHTML = (nm.length ? '⭐ NEW ' + nm.map(h => esc(h.t) + ' ' + esc(h.v)).join(', ') : '✓ needed') + (bad.length ? ' · <b class="bad">' + esc(bad.join(', ')) + '</b>' : '') + busted;
  }
  function scpLine(f) { const p = partial(f, 10); return p.length ? '🔎 ' + p.map(c => `<button type="button" class="scp" data-c="${esc(c)}">${esc(c)}</button>`).join(' ') : ''; }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.scp'); if (b && $('cxECall') && document.body.dataset.screen === 'contest') { $('cxECall').value = b.dataset.c; $('cxECall').dispatchEvent(new Event('input', { bubbles: true })); $('cxECall').focus(); return; } if (b && $('eCall')) { $('eCall').value = b.dataset.c; $('eCall').dispatchEvent(new Event('input', { bubbles: true })); $('eCall').focus(); } });
  document.addEventListener('input', e => { if (e.target && e.target.id === 'eCall' && $('cxRow')) check(); });
  function clearRow() { const D = def(); D.rcvd.forEach(f => { const el = $(fid(f)); if (el) el.value = ''; }); if ($('cxGota')) $('cxGota').classList.remove('on'); lastCall = ''; check(); }

  /* ======================================================================== FILES: Cabrillo + contest ADIF tags */
  const cabMode = q => { const mc = mcOf(q.mode); return mc === 'CW' ? 'CW' : mc === 'PH' ? (q.mode === 'FM' ? 'FM' : 'PH') : q.mode === 'RTTY' ? 'RY' : 'DG'; };
  const cabFreq = q => { const v = { '6m': '50', '2m': '144', '1.25m': '222', '70cm': '432', '33cm': '902', '23cm': '1.2G' }[String(q.band).toLowerCase()]; return v || String(Math.round(+q.khz || 0)); };
  function cabrillo() {
    recalc(); const D = def(), me = AP.me(), call = me.station || me.call, k = CF.cat, ops = [...new Set(R.list.map(q => q.op).filter(Boolean))];
    const h = ['START-OF-LOG: 3.0', 'CONTEST: ' + D.cab, 'CALLSIGN: ' + call, 'LOCATION: ' + (CF.sent.sec || CF.sent.loc || (me.cnty || '').split(',')[0] || ''),
      'CATEGORY-OPERATOR: ' + k.ops, 'CATEGORY-ASSISTED: ' + (k.assisted ? 'ASSISTED' : 'NON-ASSISTED'), 'CATEGORY-BAND: ' + k.bands, 'CATEGORY-MODE: ' + k.mode, 'CATEGORY-POWER: ' + k.power, 'CATEGORY-TRANSMITTER: ' + k.tx];
    if (k.overlay) h.push('CATEGORY-OVERLAY: ' + k.overlay);
    h.push('CLAIMED-SCORE: ' + R.score); if (CF.club) h.push('CLUB: ' + CF.club); h.push('OPERATORS: ' + (ops.join(' ') || call)); if (me.grid) h.push('GRID-LOCATOR: ' + me.grid.slice(0, 4));
    h.push('CREATED-BY: KPC app ' + AP.VER);
    if (D.fd) h.push('SOAPBOX: Field Day power multiplier x' + fdPower() + ', bonus points ' + R.bonus);
    const multi = k.ops !== 'SINGLE-OP' || k.tx === 'TWO';
    const lines = R.list.map(q => {
      const x = xOf(q), d = new Date(q.t), ds = d.toISOString().slice(0, 10), tm = d.toISOString().slice(11, 16).replace(':', '');
      const sc = q.station || call;
      const cols = ['QSO:', cabFreq(q).padStart(5), cabMode(q), ds, tm, sc.padEnd(13), ...D.cabS(x, Object.assign({}, CF.sent, (q.cx || {}).s || {})).map(v => String(v || '').padEnd(5)), x.call.padEnd(13), ...D.cabR(x).map(v => String(v || '').padEnd(5))];
      if (multi) cols.push(String((q.cx && q.cx.tx) || 0));
      return cols.join(' ').replace(/\s+$/, '');
    });
    return h.concat(lines, ['END-OF-LOG:', '']).join('\r\n');
  }
  /* ADIF: kpc-log.js adif() adds these for a contest contact (CONTEST_ID, the exchange in SRX/STX + their proper fields) */
  function adifTags(q) {
    if (!q.cx) return '';
    const f = (k, v) => v ? '<' + k + ':' + String(v).length + '>' + v + ' ' : '', D = all().find(c => c.id === q.cx.c) || def(), r = q.cx.r || {}, s = q.cx.s || {};
    return f('CONTEST_ID', D.adif) + f('SRX', r.nr) + f('STX', s.nr) + f('SRX_STRING', D.rcvd.map(x => r[x.k]).filter(Boolean).join(' ')) + f('STX_STRING', D.sent.map(x => s[x.k]).filter(Boolean).join(' ')) +
      f('ARRL_SECT', r.sec) + f('CLASS', r.cls) + f('PRECEDENCE', r.prec) + f('CHECK', r.chk) + (D.dx && r.zone && /^\d+$/.test(r.zone) ? f(D.id === 'iaru-hf' ? 'ITUZ' : 'CQZ', r.zone) : '');
  }

  /* ======================================================================== LIVE SCORE: Contest Online Scoreboard
     <dynamicresults> XML (blog.contestonlinescore.com/online-scoring-xml-specification), POST with Basic auth (call + the scoreboard
     password), every 2 minutes while online (their real-time spec wants a post every 2 min even with no change). Offline = nothing
     queued: a score is a snapshot, the next post sends the newest. */
  const COSMT = { zone: 'zone', country: 'country', state: 'state', section: 'state', county: 'state', prefix: 'wpxprefix', hq: 'hq', call: 'prefix', xe: 'state', dx: 'country' };
  const xe = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  function cosXml(now) {
    const D = def(), me = AP.me(), my = myInfo(), k = CF.cat, call = me.station || me.call, ops = [...new Set(R.list.map(q => q.op).filter(Boolean))];
    const b = { '160m': '160', '80m': '80', '40m': '40', '20m': '20', '15m': '15', '10m': '10', '6m': '6', '2m': '2', '1.25m': '222', '70cm': '432' };
    const mm = mc => mc === 'CW' ? 'CW' : mc === 'PH' ? 'PH' : /rtty/.test(D.id) ? 'RTTY' : 'DIG';
    const bd = [];
    Object.values(R.rows).forEach(r => { const bb = b[r.band] || r.band.replace('m', ''), m = mm(r.mc); bd.push(`    <qso band="${bb}" mode="${m}">${r.q}</qso>`, `    <point band="${bb}" mode="${m}">${r.p}</point>`); Object.entries(r.m).forEach(([t, n]) => bd.push(`    <mult band="${bb}" mode="${m}" type="${COSMT[t] || t}">${n}</mult>`)); });
    bd.push(`    <qso band="total" mode="ALL">${R.qsos}</qso>`); Object.entries(R.byType).forEach(([t, n]) => bd.push(`    <mult band="total" mode="ALL" type="${COSMT[t] || t}">${n}</mult>`)); bd.push(`    <point band="total" mode="ALL">${R.pts}</point>`);
    const single = k.ops === 'SINGLE-OP', g = (me.grid || '').toUpperCase();
    return ['<?xml version="1.0"?>', '<dynamicresults>', `  <contest>${xe(D.cos)}</contest>`, `  <call>${xe(call)}</call>`, `  <ops>${xe((ops.length ? ops : [call]).join(',').slice(0, 250))}</ops>`,
      '  <soft>KPC app</soft>', `  <version>${xe(AP.VER)}</version>`,
      `  <class power="${xe(k.power)}" assisted="${k.assisted ? 'ASSISTED' : 'NON-ASSISTED'}" transmitter="${single ? (k.tx === 'TWO' ? 'TWO' : 'ONE') : 'UNLIMITED'}" ops="${single ? 'SINGLE-OP' : 'MULTI-OP'}" bands="${xe(k.bands)}" mode="${xe(k.mode === 'SSB' ? 'PH' : k.mode)}" overlay="${xe(k.overlay || 'N/A')}"></class>`,
      `  <club>${xe(CF.club)}</club>`, '  <qth>', `    <dxcccountry>${xe(my.dxcc || (my.us ? 'K' : my.ca ? 'VE' : ''))}</dxcccountry>`, `    <cqzone>${xe(CF.sent.zone || my.cq || '')}</cqzone>`, `    <iaruzone>${xe(my.itu || '')}</iaruzone>`,
      `    <arrlsection>${xe(CF.sent.sec || '')}</arrlsection>`, `    <stprvoth>${xe(CF.sent.loc || (me.cnty || '').split(',')[0] || '')}</stprvoth>`, g.length >= 6 ? `    <grid6>${xe(g.slice(0, 6))}</grid6>` : `    <grid4>${xe(g.slice(0, 4))}</grid4>`, '  </qth>',
      '  <breakdown>', ...bd, '  </breakdown>', `  <score>${R.score}</score>`, `  <timestamp>${(now || new Date()).toISOString().replace('T', ' ').slice(0, 19)}</timestamp>`, '</dynamicresults>'].join('\n');
  }
  async function cosPost() {
    if (!on('cos') || !COS.on || !COS.user || !COS.pass) return null;
    recalc();
    const r = await AP.net.raw(COS.url || COS_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml', Authorization: 'Basic ' + btoa(COS.user.toUpperCase() + ':' + COS.pass) }, body: cosXml(), ms: 20000 });
    let st = r && r.status, msg = (r && (r.text || r.err)) || 'no answer';
    try { const j = JSON.parse(String(r.text || '').replace(/^CFM\s*/, '')); st = +(j.status || st); msg = j.status_message || j.Status || msg; } catch (e) {}
    COS.last = { ok: !!(r && r.ok) && (st === 200 || st == null), st, msg: String(msg).slice(0, 120), t: Date.now() }; saveCos(); drawCos();
    return COS.last;
  }
  setInterval(() => { if (on('cos') && COS.on && (!AP.net.online || AP.net.online())) cosPost().catch(() => {}); }, 120000);

  /* ======================================================================== LOG ON THE CONTEST SCREEN
     Nov 6 (Brandon: 'the contest screen needs a way to log in it'): a CALL box + the exchange boxes + LOG right on the 🏆 tab.
     It drives the same LOG-screen line underneath (eCall + the cxRow boxes + lgForm), so dupes, history, SCP, the network and the
     score work exactly the same. Enter = log, Esc = wipe. Frequency + mode come from the radio (or the LOG screen's dock). */
  const eid = f => 'cxE_' + f.k;
  function entry() {
    const box = $('cxEntry'); if (!box) return;
    if (!CF.on || document.body.dataset.screen !== 'contest') return;
    const D = def(), open = KPCLog.cur() === LOGID(), sig = (open ? 'o' : 'c') + '|' + (on('log') ? 1 : 0) + '|' + D.id + '|' + D.rcvd.map(f => f.k).join(',');
    if (box.dataset.sig === sig) { entryInfo(); return; }
    box.dataset.sig = sig;
    if (!on('log')) { box.innerHTML = '<section class="card cxent"><p class="hint">Turn on <b>Contest log line</b> in STATION → CONTESTING to log from here.</p></section>'; return; }
    if (!open) { box.innerHTML = `<section class="card cxent"><div class="row"><button type="button" class="b gold" id="cxEOpen">📒 OPEN THE ${esc(D.name.toUpperCase())} LOG TO LOG HERE</button></div></section>`; $('cxEOpen').onclick = () => openLog(true); return; }
    box.innerHTML = `<section class="card cxent"><form id="cxEF" autocomplete="off"><div class="cxerow">
      <label class="e cxecall">CALL<input id="cxECall" autocapitalize="characters" spellcheck="false" autocomplete="off" enterkeyhint="done"></label>
      ${D.rcvd.map(f => `<label class="e cxe" style="--w:${f.w}">${esc(f.l)}<input id="${eid(f)}" ${f.list ? 'list="' + f.list + '"' : ''} autocapitalize="characters" spellcheck="false" autocomplete="off" enterkeyhint="done"></label>`).join('')}
      ${D.fd ? '<button type="button" class="chip" id="cxEGota">GOTA</button>' : ''}
      <button type="submit" class="b gold cxego">LOG ⏎</button><button type="button" class="b" id="cxEWipe" title="Esc">WIPE</button></div>
      <div class="cxeinfo"><span class="cxst" id="cxESt"></span><span class="cxeon" id="cxEOn"></span></div></form></section>`;
    const C = $('cxECall');
    const mirror = () => { const ec = $('eCall'); if (ec) { ec.value = C.value; ec.dispatchEvent(new Event('input', { bubbles: true })); }
      D.rcvd.forEach(f => { const a = $(eid(f)), b = $(fid(f)); if (a && b) { if (a.value) b.value = a.value; else if (b.value && f.k !== 'nr' && f.k !== 'rst') a.value = b.value; } }); check(); entryInfo(); };
    C.addEventListener('input', () => { const p = C.selectionStart; C.value = C.value.toUpperCase(); try { C.setSelectionRange(p, p); } catch (e) {} D.rcvd.forEach(f => { const a = $(eid(f)), b = $(fid(f)); if (a && !a.dataset.typed) a.value = ''; if (b && a && !a.dataset.typed) b.value = ''; }); mirror(); });
    D.rcvd.forEach(f => { const a = $(eid(f)); a.addEventListener('input', () => { if (f.up) { const p = a.selectionStart; a.value = a.value.toUpperCase(); try { a.setSelectionRange(p, p); } catch (e) {} } a.dataset.typed = a.value ? '1' : ''; const b = $(fid(f)); if (b) b.value = a.value; check(); entryInfo(); }); });
    if ($('cxEGota')) $('cxEGota').onclick = () => { $('cxEGota').classList.toggle('on'); const g = $('cxGota'); if (g) g.classList.toggle('on', $('cxEGota').classList.contains('on')); };
    $('cxEWipe').onclick = () => wipeEntry(true);
    $('cxEF').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); wipeEntry(true); } });
    $('cxEF').onsubmit = e => { e.preventDefault(); logEntry(); };
    entryInfo();
  }
  function entryInfo() {
    const st = $('cxESt'), o = $('cxEOn'); if (!st) return;
    const src = $('cxSt'); st.className = src ? src.className : 'cxst'; st.innerHTML = src ? src.innerHTML : '';
    const dk = KPCLog.dock || {}; o.textContent = dk.khz ? 'on ' + (dk.khz / 1000).toFixed(3) + ' MHz · ' + (dk.mode || '') + ' · ' + (KPCLog.band(+dk.khz) || '') : 'pick the band + mode on the LOG screen or connect the radio';
  }
  function logEntry() {
    const C = $('cxECall'), D = def(); if (!C) return false;
    const call = C.value.trim(); if (!call) { AP.toast('Type a call sign first.', 2500, 'bad'); C.focus(); return false; }
    if (!$('cxRow')) dockRow();
    const ec = $('eCall'), form = $('lgForm'); if (!ec || !form || !$('cxRow')) { AP.toast('The contest log line is not ready: open the contest log.', 3500, 'bad'); return false; }
    ec.value = call; D.rcvd.forEach(f => { const a = $(eid(f)), b = $(fid(f)); if (a && b) b.value = a.value.trim(); });
    if ($('cxEGota') && $('cxGota')) $('cxGota').classList.toggle('on', $('cxEGota').classList.contains('on'));
    const n0 = R.list.length;
    if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
    setTimeout(() => { if (!ec.value || R.list.length > n0) wipeEntry(true); }, 120);
    return true;
  }
  function wipeEntry(focus) {
    const D = def(); if (!$('cxECall')) return;
    $('cxECall').value = ''; D.rcvd.forEach(f => { const a = $(eid(f)); if (a) { a.value = ''; a.dataset.typed = ''; } });
    if ($('cxEGota')) $('cxEGota').classList.remove('on');
    const ec = $('eCall'); if (ec && ec.value) { ec.value = ''; ec.dispatchEvent(new Event('input', { bubbles: true })); }
    clearRow(); entryInfo(); if (focus) $('cxECall').focus();
  }

  /* ======================================================================== THE CONTEST SCREEN (🏆 tab) */
  const main = document.querySelector('main');
  if (main && !$('scrCx')) main.insertAdjacentHTML('beforeend', '<section class="scr" id="scrCx" aria-label="Contest"><div id="cxEntry"></div><div id="cxBody"></div></section>');
  const tabs = document.querySelector('.tabs');
  function tabVis() {
    if (!tabs) return; let t = tabs.querySelector('[data-go="contest"]');
    if (!t && CF.on) { const st = tabs.querySelector('[data-go="station"]'); st.insertAdjacentHTML('beforebegin', '<button type="button" data-go="contest"><i>🏆</i><span>CONTEST</span></button>'); t = tabs.querySelector('[data-go="contest"]'); t.onclick = () => AP.go('contest'); }
    if (t) t.hidden = !CF.on;
    if (!CF.on && document.body.dataset.screen === 'contest') AP.go('log');
  }
  AP.on('screen', n => { if (n === 'contest') { $('ttl').textContent = 'Contest'; draw(); if (G.KPCSkim) KPCSkim.wake(); } });

  const SEL = (id, list, cur) => `<select id="${id}">${list.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
  function sentHtml(D) {
    return D.sent.map(f => `<label class="e">MY ${esc(f.l)}<input id="cxS_${f.k}" value="${esc(CF.sent[f.k] || '')}" ${f.list ? 'list="' + f.list + '"' : ''} autocapitalize="characters" spellcheck="false"></label>`).join('') +
      (D.serial ? '<label class="e">MY NUMBER<input value="next: ' + nextNr() + '" disabled></label>' : '');
  }
  let drawLater = false;
  function draw() {
    tabVis(); dockRow(); entry();
    const box = $('cxBody'); if (!box || document.body.dataset.screen !== 'contest') return;
    const ae = document.activeElement;   /* never redraw under the member's fingers (a contact from another station arrives while typing MY SECTION) */
    if (ae && box.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) { if (!drawLater) { drawLater = true; ae.addEventListener('blur', () => { drawLater = false; setTimeout(draw, 0); }, { once: true }); } return; }
    const D = def(), rt = rates(), open = KPCLog.cur() === LOGID(), k = CF.cat;
    const typeTxt = Object.entries(R.byType).map(([t, n]) => n + ' ' + t + (n > 1 ? (t === 'country' ? ' (countries)' : 's') : '')).join(' · ') || (D.mults ? 'no multipliers yet' : 'no multipliers in this one');
    const rows = Object.values(R.rows).sort((a, b) => FDB.indexOf(a.band) - FDB.indexOf(b.band) || a.mc.localeCompare(b.mc));
    box.innerHTML = `
      <div class="strip cxtop"><span class="kv"><i>SCORE</i><b id="cxScore">${R.score.toLocaleString()}</b></span><span class="kv"><i>QSOS</i><b>${R.qsos}</b></span><span class="kv"><i>POINTS</i><b>${R.pts}</b></span><span class="kv"><i>MULTS</i><b>${R.mt}</b></span><span class="kv"><i>LAST HOUR</i><b>${rt.hour}</b></span><span class="kv"><i>RATE</i><b>${rt.last10 ? rt.last10 + '/h' : '—'}</b></span></div>
      <div class="cxgrid">
      <section class="card"><h2>This contest</h2>
        <div class="grid2"><label class="e">CONTEST${SEL('cxId', all().map(c => [c.id, c.name]), CF.id)}</label><label class="e">YEAR<input id="cxYr" inputmode="numeric" maxlength="4" value="${esc(CF.yr || YEAR)}"></label></div>
        <div class="grid2">${sentHtml(D)}</div>
        <div class="row"><button type="button" class="b gold" id="cxOpen">${open ? '✓ CONTEST LOG IS OPEN' : '📒 OPEN THE CONTEST LOG'}</button><button type="button" class="b" id="cxCat">🏷 MY CATEGORY</button>${D.fd ? '<button type="button" class="b" id="cxBonus">🎁 FIELD DAY BONUS</button>' : ''}${D.wfd ? '<button type="button" class="b" id="cxOm">🎯 OBJECTIVES</button>' : ''}</div>
        <div class="st">${open ? 'Every contact on the LOG screen goes into <b>' + esc(D.name) + ' ' + esc(CF.yr) + '</b>: the exchange boxes sit above the CALL box, and the line says DUPE or NEW before you log.' : 'Open the contest log to log this contest (it is one of MY LOGS, so your other logs stay apart).'}${D.fd ? '<br>Power: ' + esc(CF.watts) + ' W on ' + esc(String(CF.psrc).toLowerCase()) + ' = ×' + fdPower() + '. Category ' + esc(CF.sent.cls || '?') + ' ' + esc(CF.sent.sec || '?') + '.' : '<br>' + esc(k.ops) + ' · ' + esc(k.power) + ' · ' + (k.assisted ? 'assisted' : 'not assisted') + ' · ' + esc(k.bands) + ' · ' + esc(k.mode)}</div>
        <p class="hint">${esc(D.notes || '')} <a href="${esc(D.url)}" target="_blank" rel="noopener">The rules ›</a></p></section>
      <section class="card"><h2>Score</h2><div class="cxbig">${R.score.toLocaleString()}</div>
        <div class="st">${R.qsos} contacts · ${R.pts} points${D.mults ? ' × ' + R.mt + ' multipliers' : ''}${D.fd ? ' × ' + fdPower() + ' power + ' + R.bonus + ' bonus' : ''}${D.wfd ? ' × ' + (+CF.om || 1) + ' objectives' : ''}<br>${esc(typeTxt)}</div>
        ${rows.length ? `<table class="cxtab"><tr><th>BAND</th><th>MODE</th><th>QSOS</th><th>PTS</th><th>MULTS</th></tr>${rows.map(r => `<tr><td>${esc(r.band)}</td><td>${esc(r.mc)}</td><td>${r.q}</td><td>${r.p}</td><td>${Object.values(r.m).reduce((a, b) => a + b, 0) || ''}</td></tr>`).join('')}</table>` : ''}
        ${D.sweep ? sweepHtml() : ''}</section>
      ${on('map') ? '<section class="card cxmapc"><h2>Band map <span class="cxsub">who is where · tap = tune + log line</span></h2><div class="chips" id="cxBands"></div><canvas id="cxWf" class="cxwf"></canvas><div class="cxleg"><span class="m">new mult</span><span class="n">needed</span><span class="d">dupe</span><span class="x">busted?</span><span class="me">you</span></div></section>' : ''}
      ${on('skim') ? '<section class="card"><h2>Skimmers by region</h2><div id="cxSkim"></div></section><section class="card"><h2>Who hears me</h2><div id="cxHeard"></div></section>' : ''}
      ${on('cos') ? '<section class="card"><h2>Live score</h2><div id="cxCos"></div></section>' : ''}
      ${on('share') ? '<section class="card"><h2>Field Day / multi-op network</h2><div id="cxNet"></div></section>' : ''}
      <section class="card"><h2>Files</h2><div class="row"><button type="button" class="b gold" id="cxCab">⬇ SAVE CABRILLO</button><button type="button" class="b" id="cxAdif">⬇ CONTEST ADIF</button></div>
        <div class="row"><button type="button" class="b" id="cxCtyG">🌍 ${CTY ? 'CTY.DAT ✓ (' + CTY.n + ')' : '⬇ GET CTY.DAT'}</button><button type="button" class="b" id="cxScpG">🔎 ${SCP ? 'MASTER.SCP ✓ (' + SCP.size.toLocaleString() + ')' : '⬇ GET MASTER.SCP'}</button><button type="button" class="b" id="cxFileB">📂 LOAD A FILE</button><input type="file" id="cxFile" accept=".dat,.scp,.SCP,.txt,.json" hidden></div>
        <p class="hint">Cabrillo is the file every contest takes (Field Day: the ARRL web app takes it too). CTY.DAT (country-files.com) gives countries, continents and zones for DX contests; MASTER.SCP (supercheckpartial.com) gives the partial-call list under the CALL box and the busted-call check. Get both again before each big contest. A QSO party = 📂 a .json with its counties.</p></section>
      </div>`;
    wire(D);
    if (on('map') && G.KPCSkim) KPCSkim.mountMap($('cxWf'), $('cxBands'));
    if (on('skim') && G.KPCSkim) { KPCSkim.drawRegions($('cxSkim')); KPCSkim.drawHeard($('cxHeard')); }
    drawCos(); drawNet();
  }
  function sweepHtml() {
    const got = new Set(R.list.map(q => q.cx && q.cx.r && String(q.cx.r.sec || '').toUpperCase()).filter(Boolean));
    return `<div class="cxsweep" title="Sections worked">${SEC.map(s => `<span class="${got.has(s.abbr) ? 'on' : ''}" title="${esc(s.name)}">${s.abbr}</span>`).join('')}</div><p class="hint">${got.size} of 85 sections${got.size === 85 ? ' — CLEAN SWEEP! 🧹' : ''}</p>`;
  }
  function wire(D) {
    const re = () => { save(); recalc(); draw(); };
    $('cxId').onchange = () => { CF.id = $('cxId').value; CF.sent = Object.assign({}, CF.sent); re(); };
    $('cxYr').onchange = () => { CF.yr = +$('cxYr').value || YEAR; re(); };
    D.sent.forEach(f => { const el = $('cxS_' + f.k); if (el) el.onchange = () => { CF.sent[f.k] = el.value.trim().toUpperCase(); el.value = CF.sent[f.k]; save(); }; });   /* save only: a redraw here would pull the next box out from under the finger */
    $('cxOpen').onclick = () => openLog();
    $('cxCat').onclick = catSheet;
    if ($('cxBonus')) $('cxBonus').onclick = bonusSheet;
    if ($('cxOm')) $('cxOm').onclick = () => { AP.sheet('Winter Field Day objectives', `<p class="hint">Add up the objective multipliers you earned (the WFD rules list them each year) and put the total here. The score = QSO points × this number.</p><label class="e">OBJECTIVE MULTIPLIER (TOTAL)<input id="cxOmV" inputmode="numeric" value="${esc(CF.om || 1)}"></label>`, () => { CF.om = Math.max(1, +($('cxOmV') || {}).value || 1); save(); recalc(); }); };
    $('cxCab').onclick = () => { if (!R.list.length) { AP.toast('No contacts in the contest log yet.', 3000, 'bad'); return; } AP.saveFile(cabrillo(), ((AP.me().station || 'log').replace(/[^A-Z0-9]/gi, '') + '-' + def().cab + '-' + CF.yr + '.log'), 'text/plain'); };
    $('cxAdif').onclick = () => { if (!R.list.length) { AP.toast('No contacts in the contest log yet.', 3000, 'bad'); return; } AP.saveFile(KPCLog.adif(R.list), ((AP.me().station || 'log').replace(/[^A-Z0-9]/gi, '') + '-' + def().cab + '-' + CF.yr + '.adi'), 'text/plain'); };
    $('cxCtyG').onclick = () => fetchFile(CTY_URL, ctySet, 'CTY.DAT');
    $('cxScpG').onclick = () => fetchFile(SCP_URL, scpSet, 'MASTER.SCP');
    $('cxFileB').onclick = () => $('cxFile').click();
    $('cxFile').onchange = async () => { const f = $('cxFile').files[0]; if (!f) return; const t = await f.text(); $('cxFile').value = ''; loadText(t, f.name); };
  }
  async function fetchFile(url, set, label) {
    AP.toast('Getting ' + label + '…', 2500);
    const r = await AP.net.raw(url, { ms: 60000 });
    if (r && r.ok && set(r.text)) { draw(); return; }
    AP.toast('Could not get ' + label + ' (' + esc((r && (r.status || r.err)) || 'no signal') + '). Download it on a computer and use 📂 LOAD A FILE.', 7000, 'bad');
  }
  function loadText(t, name) {
    if (/^\s*\{/.test(t)) { try { const j = JSON.parse(t); if (j.state && j.counties) { const id = 'qp-' + String(j.state).toLowerCase() + (j.id ? '-' + j.id : ''); QP[id] = j; SV('kpcAppQp', QP); CF.id = id; save(); recalc(); draw(); AP.toast('🗺 ' + esc(j.name || id) + ' added (' + Object.keys(j.counties).length + ' counties).', 4000, 'log'); return; } } catch (e) {} AP.toast('That .json is not a QSO party file (it needs "state" and "counties").', 5000, 'bad'); return; }
    if (/;/.test(t) && /:\s*\d+:\s*\d+:/.test(t)) { if (ctySet(t)) draw(); return; }
    if (scpSet(t)) draw();
  }
  function openLog(stay) {
    const D = def(), id = LOGID();
    if (!KPCLog.ops().some(o => o.id === id)) KPCLog.opNew('event', '🏆 ' + D.name + ' ' + (CF.yr || YEAR), [], id); else KPCLog.opOpen(id);
    recalc(); dockRow(); draw(); entry(); if (stay === true) { AP.toast('🏆 ' + esc(D.name) + ' log is open: log right here.', 3000, 'log'); return; } AP.go('log'); AP.toast('🏆 ' + esc(D.name) + ' log is open. Type a call: the line says DUPE or NEW.', 4000, 'log');
  }
  function catSheet() {
    const k = CF.cat, D = def();
    AP.sheet('My category', `<div class="grid2"><label class="e">OPERATORS${SEL('cxCo', [['SINGLE-OP', 'single operator'], ['MULTI-OP', 'multi operator'], ['CHECKLOG', 'check log']], k.ops)}</label>
      <label class="e">POWER${SEL('cxCp', [['HIGH', 'high'], ['LOW', 'low (100 W)'], ['QRP', 'QRP (5 W)']], k.power)}</label>
      <label class="e">SPOTS / SKIMMERS${SEL('cxCa', [['0', 'not assisted'], ['1', 'assisted']], k.assisted ? '1' : '0')}</label>
      <label class="e">TRANSMITTERS${SEL('cxCt', ['ONE', 'TWO', 'LIMITED', 'UNLIMITED'], k.tx)}</label>
      <label class="e">BANDS${SEL('cxCb', ['ALL', '160M', '80M', '40M', '20M', '15M', '10M', '6M', '2M'], k.bands)}</label>
      <label class="e">MODE${SEL('cxCm', ['MIXED', 'CW', 'SSB', 'RTTY', 'DIGI', 'FM'], k.mode)}</label>
      <label class="e">OVERLAY${SEL('cxCov', [['', 'none'], 'ROOKIE', 'CLASSIC', 'TB-WIRES', 'WIRE-ONLY', 'YOUTH'], k.overlay)}</label>
      <label class="e">CLUB<input id="cxClub" value="${esc(CF.club || '')}"></label>
      ${D.fd ? `<label class="e">MOST POWER USED (W)<input id="cxW" inputmode="numeric" value="${esc(CF.watts)}"></label><label class="e">POWERED BY${SEL('cxPs', [['GENERATOR', 'generator'], ['COMMERCIAL', 'mains'], ['BATTERY', 'battery'], ['SOLAR', 'solar'], ['NATURAL', 'wind / water']], CF.psrc)}</label>` : ''}</div>
      <p class="hint">These go in the Cabrillo header and the live score. Assisted = you used spots or skimmers.</p>`, () => {
      const v = id => ($(id) || {}).value;
      Object.assign(k, { ops: v('cxCo') || k.ops, power: v('cxCp') || k.power, assisted: v('cxCa') === '1', tx: v('cxCt') || k.tx, bands: v('cxCb') || k.bands, mode: v('cxCm') || k.mode, overlay: v('cxCov') || '' });
      CF.club = (v('cxClub') || '').trim(); if (D.fd) { CF.watts = +v('cxW') || CF.watts; CF.psrc = v('cxPs') || CF.psrc; }
      save(); recalc(); draw();
    });
  }
  function bonusSheet() {
    const cls = (String(CF.sent.cls || '1A').replace(/\d+/, '') || 'A').toUpperCase()[0];
    AP.sheet('Field Day bonus points', FD_BONUS.map(([k, t, p, cl]) => { const n = typeof p === 'function', okc = cl.includes(cls);
      return `<label class="cxbon${okc ? '' : ' off'}">${n ? `<input type="number" min="0" max="99" data-bk="${k}" value="${esc(CF.bonus[k] || '')}" ${okc ? '' : 'disabled'}>` : `<input type="checkbox" data-bk="${k}" ${CF.bonus[k] ? 'checked' : ''} ${okc ? '' : 'disabled'}>`}<span>${esc(t)}${n ? '' : ' · ' + p}${okc ? '' : ' <i>(not class ' + cls + ')</i>'}</span></label>`; }).join('') +
      '<p class="hint">GOTA contacts add 5 each by themselves (tap GOTA on the log line). Keep the proof for the entry.</p>', () => {
      document.querySelectorAll('[data-bk]').forEach(el => { CF.bonus[el.dataset.bk] = el.type === 'checkbox' ? el.checked : (+el.value || 0); }); save(); recalc();
    });
  }
  function drawCos() {
    const el = $('cxCos'); if (!el) return; const l = COS.last;
    el.innerHTML = `<button type="button" class="b upsw${COS.on ? ' on' : ''}" id="cxCosOn"><b>${COS.on ? 'ON' : 'OFF'}</b> <span>Post my score every 2 minutes</span></button>
      <div class="grid2"><label class="e">SCOREBOARD CALL<input id="cxCosU" value="${esc(COS.user || AP.me().station || '')}" autocapitalize="characters"></label><label class="e">SCOREBOARD PASSWORD<input id="cxCosP" type="password" value="${esc(COS.pass || '')}" autocomplete="off"></label>
      <label class="e">SEND TO${SEL('cxCosT', [[COS_URL, 'Contest Online Scoreboard'], [SD_URL, 'Score Distributor (several boards)']], COS.url)}</label></div>
      <div class="row"><button type="button" class="b" id="cxCosNow">📤 POST NOW</button><button type="button" class="b" id="cxCosX">👁 WHAT IT SENDS</button></div>
      <div class="st">${l ? (l.ok ? '✅ ' : '⚠ ') + 'Last post ' + AP.utc(l.t) + 'z: ' + esc(l.msg || l.st || '') : 'Not posted yet.'}</div>
      <p class="hint">Make a free account on contestonlinescore.com first. The password stays on this device only (not in backups or reports). With no signal nothing is lost: the next post sends the newest score.</p>`;
    $('cxCosOn').onclick = () => { COS.on = !COS.on; saveCos(); drawCos(); if (COS.on) cosPost().catch(() => {}); };
    $('cxCosU').onchange = () => { COS.user = $('cxCosU').value.trim().toUpperCase(); saveCos(); };
    $('cxCosP').onchange = () => { COS.pass = $('cxCosP').value; saveCos(); };
    $('cxCosT').onchange = () => { COS.url = $('cxCosT').value; saveCos(); };
    $('cxCosNow').onclick = async () => { if (!COS.user || !COS.pass) { AP.toast('Put the scoreboard call + password in first.', 3000, 'bad'); return; } const was = COS.on; COS.on = true; const r = await cosPost(); COS.on = was; saveCos(); AP.toast(r && r.ok ? '📤 Score posted.' : 'The scoreboard said: ' + esc((r && r.msg) || 'no answer'), 4000, r && r.ok ? 'log' : 'bad'); };
    $('cxCosX').onclick = () => { recalc(); AP.sheet('Live score (XML)', `<textarea class="adif" readonly style="min-height:300px">${esc(cosXml())}</textarea>`); };
  }
  function drawNet() {
    const el = $('cxNet'); if (!el) return;
    const R2 = G.KPCRemote, base = R2 && R2.base, link = R2 && R2.link ? R2.link() : null;
    const bySrc = {}; R.list.forEach(q => { const k = q.op || q.station || '?'; bySrc[k] = (bySrc[k] || 0) + 1; });
    el.innerHTML = `<div class="st">${!R2 ? 'The remote link is not in this version of the app (KPC Lite): use 📂 KPC log files to merge the stations after the event.' : base ? '🖥 This PC is the hub. Each phone or tablet: STATION → Remote → turn on <b>📒 SHARE THE LOG ONLY</b>, then CONNECT with this PC\'s pair code. Their contacts come here and go on to every other station.' : link && link.paired ? '🔗 On the link to ' + esc(link.name || 'the PC') + (R2.logOnly && R2.logOnly() ? ' (sharing the log only: this device keeps its own radio)' : '') + '.' : 'Not on the link. STATION → Remote → 📒 SHARE THE LOG ONLY → CONNECT to the PC that is the hub.'}</div>
      <div class="oplist">${Object.entries(bySrc).map(([k, n]) => `<div class="op">👤 <b>${esc(k)}</b><i></i><small>${n} contacts</small></div>`).join('') || '<div class="op"><i>No contacts yet.</i></div>'}</div>
      <p class="hint">Works with no internet: the PC and the phones only need the same WiFi (a travel router at the site). Dupes and the score count every station's contacts. With no network at all: 💾 SAVE KPC LOG FILE on each one and 📂 ADD A LOG FILE on the PC after.</p>`;
  }

  /* ======================================================================== STATION → 🏆 CONTESTING (the options) */
  const FEAT = [['log', '📝 Contest logging', 'exchange boxes on the LOG line, DUPE / NEW check, score, Cabrillo'], ['map', '🌊 Band map + waterfall', 'who is where on the band, coloured by what you still need'],
    ['skim', '📡 Skimmers by region', 'every US + Canada skimmer that hears the band, by region, and who hears you'], ['cos', '📈 Live score', 'post your score to the Contest Online Scoreboard'], ['share', '🤝 Field Day / multi-op', 'share one contest log between the PC and phones on the same WiFi']];
  function stationCard() {
    const st = $('scrStation'); if (!st) return;
    let c = $('stCx');
    if (!c) { const a = st.querySelector('[data-grp^="alerts notifications"]'); (a || st.lastElementChild).insertAdjacentHTML('beforebegin', '<section class="card" id="stCx" data-grp="contest contesting field day sweepstakes cabrillo skimmer rbn score multi-op"><h2>🏆 Contesting</h2><div id="stCxB"></div></section>'); c = $('stCx'); }
    $('stCxB').innerHTML = `<button type="button" class="b upsw${CF.on ? ' on' : ''}" id="cxOn"><b>${CF.on ? 'ON' : 'OFF'}</b> <span>Contest tools (adds a 🏆 CONTEST tab)</span></button>
      <div id="cxFeat"${CF.on ? '' : ' hidden'}>${FEAT.map(([k, t, h]) => `<button type="button" class="b upsw${CF.feat[k] ? ' on' : ''}" data-cf="${k}"><b>${CF.feat[k] ? 'ON' : 'OFF'}</b> <span>${esc(t)} <small>${esc(h)}</small></span></button>`).join('')}
      <div class="row"><button type="button" class="b gold" id="cxGo">🏆 OPEN THE CONTEST SCREEN</button></div></div>
      <p class="hint">Pick only the parts you want: everything else stays out of sight. Field Day, Winter Field Day, Sweepstakes, CQ WW, WPX, ARRL DX, NAQP, Sprint, ARRL 10 / 160 m, RTTY Roundup, IARU, CWT, SST and state QSO parties.</p>`;
    $('cxOn').onclick = () => { CF.on = !CF.on; save(); stationCard(); tabVis(); recalc(); if (CF.on) AP.toast('🏆 Contest tools on: pick the parts below, then the CONTEST tab.', 4000, 'log'); };
    document.querySelectorAll('[data-cf]').forEach(b => { b.onclick = () => { const k = b.dataset.cf; CF.feat[k] = !CF.feat[k]; save(); stationCard(); dockRow(); if (G.KPCSkim) KPCSkim.wake(); }; });
    if ($('cxGo')) $('cxGo').onclick = () => AP.go('contest');
  }

  /* ---------------- wiring ---------------- */
  let rT = null;
  AP.on('log', ev => { clearTimeout(rT); rT = setTimeout(() => { recalc(); if (ev && ev.why === 'add' && $('cxRow')) clearRow(); else check(); entryInfo(); }, 60); });
  AP.on('dial', () => entryInfo());
  AP.on('me', () => { IC.clear(); setTimeout(recalc, 50); });
  /* the open log changes (MY LOGS): the dock row comes and goes */
  let lastCur = null; setInterval(() => { const c = KPCLog.cur(); if (c !== lastCur) { lastCur = c; dockRow(); entry(); } }, 700);
  if (KPCLog.ready && !KPCLog.ready()) { const w = setInterval(() => { if (KPCLog.ready()) { clearInterval(w); recalc(); } }, 200); }

  G.KPCContest = {
    S: CF, save, on, contests: all, def, key: KEY, logId: LOGID, recalc, state: () => R, status, dupeOf, previewMults, history, rates,
    entryCx, adifTags, cabrillo, cosXml, cosPost, cos: COS, info, wpx, sections: SEC, section: a => SECM.get(String(a || '').toUpperCase()), secsOfState, usArea, caProv,
    specialSec: a => SPECIAL_SEC[a], partial, inScp: c => !!(SCP && SCP.has(norm(c))), scpSize: () => (SCP ? SCP.size : 0), edits, ctySet, scpSet, loadText, openLog, fdPower, draw, stationCard, entry, logEntry
  };
  stationCard(); tabVis(); recalc();
})(window);
