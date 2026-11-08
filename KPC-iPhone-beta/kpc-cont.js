/* Which continent a spot is on (Opus Oct 24 2026; Brandon: 'our spotters to do list add filters by continent').
   KPCCont.of(spot) → 'NA' | 'SA' | 'EU' | 'AF' | 'AS' | 'OC' | 'AN' | ''.
   Uses the spot's own continent when the source gives one (Spothole: dx_continent), else its position (rough boxes,
   close enough for a filter), else the country / program prefix. Shared by the Hunters Lounge and On The Air Now. */
(function (G) {
  const L = [['NA', 'N. AMERICA'], ['SA', 'S. AMERICA'], ['EU', 'EUROPE'], ['AF', 'AFRICA'], ['AS', 'ASIA'], ['OC', 'OCEANIA'], ['AN', 'ANTARCTICA']];
  function byPos(la, lo) {
    if (!isFinite(la) || !isFinite(lo)) return '';
    if (la < -60) return 'AN';
    if (lo < -25 || lo > 179.9) {
      if (la > 36 && lo > -32) return 'EU';                       /* the Azores */
      if (lo < -140 && la < 30) return 'OC';                       /* Hawaii and the Pacific */
      if (la < 7 || (la < 12.6 && lo > -77.5 && lo < -59)) return 'SA';
      return 'NA';
    }
    if (lo > 160 || (la < -10 && lo > 110) || (lo >= 116.5 && la < 21) || (lo >= 95 && la < 1) || (lo > 108 && la < 7)) return 'OC';
    if (la < 37.6 && lo < 52 && !(lo > 34 && la > 12.5) && !(lo > 43 && la > 10)) return 'AF';
    if ((la >= 35.8 && lo < 26.5) || (la >= 40.5 && lo < 29.5) || (la >= 44.5 && lo < 60)) return 'EU';
    return 'AS';
  }
  const CTY = { 'united states': 'NA', 'canada': 'NA', 'mexico': 'NA', 'alaska': 'NA', 'hawaii': 'OC', 'puerto rico': 'NA', 'brazil': 'SA', 'argentina': 'SA', 'chile': 'SA', 'colombia': 'SA', 'peru': 'SA', 'uruguay': 'SA', 'venezuela': 'SA', 'ecuador': 'SA', 'bolivia': 'SA', 'paraguay': 'SA',
    'england': 'EU', 'scotland': 'EU', 'wales': 'EU', 'northern ireland': 'EU', 'ireland': 'EU', 'germany': 'EU', 'france': 'EU', 'italy': 'EU', 'spain': 'EU', 'portugal': 'EU', 'netherlands': 'EU', 'belgium': 'EU', 'switzerland': 'EU', 'austria': 'EU', 'poland': 'EU', 'czech republic': 'EU', 'slovakia': 'EU', 'hungary': 'EU', 'romania': 'EU', 'bulgaria': 'EU', 'greece': 'EU', 'croatia': 'EU', 'slovenia': 'EU', 'serbia': 'EU', 'sweden': 'EU', 'norway': 'EU', 'finland': 'EU', 'denmark': 'EU', 'iceland': 'EU', 'ukraine': 'EU', 'european russia': 'EU', 'lithuania': 'EU', 'latvia': 'EU', 'estonia': 'EU', 'belarus': 'EU', 'luxembourg': 'EU',
    'japan': 'AS', 'china': 'AS', 'india': 'AS', 'south korea': 'AS', 'republic of korea': 'AS', 'taiwan': 'AS', 'thailand': 'AS', 'asiatic russia': 'AS', 'kazakhstan': 'AS', 'israel': 'AS', 'turkey': 'AS', 'asiatic turkey': 'AS', 'saudi arabia': 'AS', 'united arab emirates': 'AS',
    'australia': 'OC', 'new zealand': 'OC', 'philippines': 'OC', 'indonesia': 'OC', 'south africa': 'AF', 'kenya': 'AF', 'egypt': 'AF', 'morocco': 'AF', 'nigeria': 'AF', 'namibia': 'AF', 'canary islands': 'AF' };
  /* POTA two-letter program prefixes we can name without a position */
  const PFX = { US: 'NA', CA: 'NA', MX: 'NA', K: 'NA', VE: 'NA', BR: 'SA', AR: 'SA', CL: 'SA', CO: 'SA', GB: 'EU', DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU', PT: 'EU', NL: 'EU', BE: 'EU', CH: 'EU', AT: 'EU', PL: 'EU', CZ: 'EU', SE: 'EU', NO: 'EU', FI: 'EU', DK: 'EU', IE: 'EU', HU: 'EU', HR: 'EU', SI: 'EU', SK: 'EU', GR: 'EU', RO: 'EU', BG: 'EU', UA: 'EU', JP: 'AS', IN: 'AS', KR: 'AS', TW: 'AS', TH: 'AS', CN: 'AS', AU: 'OC', NZ: 'OC', PH: 'OC', ID: 'OC', ZA: 'AF', KE: 'AF' };
  function of(s) {
    if (!s) return '';
    if (s.cont && /^(NA|SA|EU|AF|AS|OC|AN)$/.test(String(s.cont).toUpperCase())) return String(s.cont).toUpperCase();
    if (s.us || s.ca) return 'NA';
    const p = byPos(+s.la, +s.lo); if (p) return p;
    const c = CTY[String(s.cty || s.loc || s.country || '').toLowerCase()]; if (c) return c;
    const r0 = String(s.ref || (s.refs && s.refs[0]) || '').toUpperCase();
    const pre = r0.split('-')[0]; if (PFX[pre]) return PFX[pre];
    const as = r0.includes('/') ? r0.split('/')[0] : '';   /* a SOTA association (W4K/…, G/…, VK2/…) */
    if (as) { if (/^(W|K|N|A[A-L])\d|^(VE|VA|VY|VO|XE|KH|KL|KP)/.test(as)) return 'NA'; if (/^(VK|ZL|DU|YB|KH6)/.test(as)) return 'OC'; if (/^(JA|HL|BV|BY|VU|4X|TA|UA0|UA9|RA9|R9|R0)/.test(as)) return 'AS'; if (/^(ZS|5Z|CN|SU|EA8)/.test(as)) return 'AF'; if (/^(CE|LU|PY|CX|HK|OA|YV)/.test(as)) return 'SA'; if (/^[A-Z0-9]{1,3}$/.test(as)) return 'EU'; }
    return '';
  }
  G.KPCCont = { of, byPos, list: L, name: k => (L.find(x => x[0] === k) || [k, k])[1] };
})(window);
