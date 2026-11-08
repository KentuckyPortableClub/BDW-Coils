/* KPC app: THE REAL SPOT SOURCES (Opus, Oct 22, step 4; Brandon: 'Spots they not pota,wwff,sota,dx cluster etc').
   Each one is a poll function on the spot frame (kpc-spots.js), the same way the website's Hunters Lounge reads them
   (kpc-links/kpc-hunt.js):
     POTA   api.pota.app/spot/activator            every 60 s
     SOTA   api2.sota.org.uk/api/spots/50/all      every 60 s
     WWFF + DX cluster   spothole.app (one ~1 MB list for both, a small hobby service: every 3 min, and only while one of
            the two is switched on; RBN skimmer spots are left out, they swamp the list)
   They go through AP.net.raw (no CORS wall in the app) and only run while the device is online; the frame does the rest
   (no doubles, filters, watchlist, tap = tune + log line). */
(function (G) {
  'use strict';
  const AP = G.KPCApp, SPx = G.KPCSpots;
  if (!AP || !SPx) return;
  const toKhz = f => { f = Number(f); if (!isFinite(f) || f <= 0) return null; return f < 1000 ? f * 1000 : f < 1e6 ? f : f / 1000; };
  const toMs = t => { if (t == null) return Date.now(); if (typeof t === 'number') return t < 1e12 ? t * 1000 : t; const s = String(t); const d = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z'); return isFinite(d) ? d : Date.now(); };
  async function getJson(url, ms) {
    const r = AP.net.raw ? await AP.net.raw(url, { ms: ms || 25000 }) : null;
    if (r) { if (!r.ok) throw new Error('HTTP ' + (r.status || r.err || '?')); return JSON.parse(r.text || 'null'); }
    const x = await AP.net.fetch(url, {}, ms || 25000); if (!x.ok) throw new Error('HTTP ' + x.status); return x.json();
  }

  /* Oct 26 (Brandon: 'make sure the spots show state'): POTA's locationDesc 'US-KY' (or 'US-KY,US-TN' on a line) → 'KY' / 'KY/TN'; Canada 'CA-ON' → 'ON' */
  const stOf = d => [...new Set(String(d || '').split(/[,\s]+/).map(c => (/^(US|CA|MX|AU)-([A-Z]{2,3})$/i.exec(c) || [])[2]).filter(Boolean).map(x => x.toUpperCase()))].join('/');
  SPx.source({ id: 'pota', label: 'POTA', every: 60, poll: async () => {
    const L = await getJson('https://api.pota.app/spot/activator');
    return (L || []).map(x => ({ call: x.activator, khz: toKhz(x.frequency), mode: x.mode, refs: x.reference ? [x.reference] : [], t: toMs(x.spotTime),
      comment: [x.name, x.locationDesc, x.comments].filter(Boolean).join(' · '), grid: x.grid6 || x.grid4 || '', spotter: x.spotter || '', la: +x.latitude, lo: +x.longitude, st: stOf(x.locationDesc) })).filter(s => s.khz);
  } });

  SPx.source({ id: 'sota', label: 'SOTA', every: 60, poll: async () => {
    const L = await getJson('https://api2.sota.org.uk/api/spots/50/all');
    return (L || []).map(x => ({ call: x.activatorCallsign, khz: toKhz(x.frequency), mode: x.mode, refs: x.associationCode ? [(x.associationCode + '/' + (x.summitCode || '')).toUpperCase()] : [],
      t: toMs(x.timeStamp), comment: [x.summitDetails, x.comments].filter(Boolean).join(' · '), spotter: x.callsign || '' })).filter(s => s.khz);
  } });

  /* one Spothole fetch feeds two sources */
  let holeLast = 0, holeBusy = false;
  async function hole() {
    if (holeBusy || Date.now() - holeLast < 170000) return;
    const off = SPx.S.off || []; if (['wwff', 'dx', 'progs', 'rbn'].every(k => off.includes(k))) return;
    holeBusy = true; holeLast = Date.now();
    try {
      const j = await getJson('https://spothole.app/api/v1/spots?max_age=2700', 60000);
      const L = Array.isArray(j) ? j : (j && j.spots) || [], W = [], D = [], O = [], RB = [];
      L.forEach(x => {
        const sig = String(x.sig || ''), src0 = String(x.source || '');
        if (/^(POTA|SOTA)$/i.test(sig) || x.qrt) return;
        const rbn = /RBN|SKIM/i.test(src0);
        const khz = toKhz(x.freq != null ? x.freq : x.frequency); if (!khz) return;
        const s = { call: x.dx_call || x.activator, khz, mode: x.mode, t: toMs(x.time), cont: String(x.dx_continent || '').toUpperCase(), la: +(x.dx_latitude ?? NaN), lo: +(x.dx_longitude ?? NaN), cty: x.dx_country || '', st: String(x.dx_state || x.state || '').toUpperCase().slice(0, 6), sig: String(x.sig || ''), spotter: x.de_call || '', comment: [x.dx_name, x.dx_country, x.comment].filter(Boolean).join(' · ') };
        const rr = x.sig_refs || [], refs = (Array.isArray(rr) ? rr : [rr]).map(v => typeof v === 'string' ? v : (v.id || v.ref || '')).filter(Boolean);
        if (rbn) { s.refs = []; s.comment = [x.comment, 'skimmer ' + (x.de_call || '')].filter(Boolean).join(' · '); RB.push(s); }   /* Oct 24: RBN skimmers, its own source (off to start: hundreds a minute) */
        else if (/WWFF/i.test(sig)) { s.refs = refs; if (s.refs.length) W.push(s); }
        else if (sig && !/^dxped/i.test(sig)) { s.refs = refs; s.comment = [sig + (refs.length ? ' ' + refs.join('+') : ''), s.comment].filter(Boolean).join(' · '); O.push(s); }   /* GMA, IOTA, WWBOTA, LLOTA, castles, lighthouses… */
        else { s.refs = []; D.push(s); }
      });
      if (!off.includes('wwff')) SPx.feed('wwff', W);
      if (!off.includes('dx')) SPx.feed('dx', D);
      if (!off.includes('progs')) SPx.feed('progs', O);
      if (!off.includes('rbn')) SPx.feed('rbn', RB.slice(-300));
      const so = SPx.sources(); ['wwff', 'dx', 'progs', 'rbn'].forEach(k => { if (so[k]) so[k].err = ''; });
    } catch (e) { const so = SPx.sources(); ['wwff', 'dx', 'progs', 'rbn'].forEach(k => { if (so[k]) so[k].err = String(e.message || e); }); SPx.draw(); }
    finally { holeBusy = false; }
  }
  SPx.source({ id: 'wwff', label: 'WWFF', every: 180, poll: async () => { await hole(); return []; } });
  SPx.source({ id: 'dx', label: 'DX cluster', every: 180, poll: async () => { await hole(); return []; } });
  SPx.source({ id: 'progs', label: 'Other programs', every: 180, poll: async () => { await hole(); return []; } });
  if (!SPx.S.rbnSeen) { SPx.S.rbnSeen = 1; if (!SPx.S.off.includes('rbn')) SPx.S.off.push('rbn'); SPx.save(); }   /* starts OFF */
  SPx.source({ id: 'rbn', label: 'RBN skimmers', every: 180, poll: async () => { await hole(); return []; } });
})(window);
