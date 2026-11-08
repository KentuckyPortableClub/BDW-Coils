/* KPC app: the packet engine behind APRS (Fable, Oct 22). Plain functions, no screen, so tests can feed it made-up sound.
     KPCAX25.Demod(rate, baud, mark, space)   feed(Float32Array) → calls onFrame(bytes) for every frame with a good CRC
     KPCAX25.modulate(bytes, rate, baud, mark, space, preambleFlags) → Float32Array of sound (HDLC + NRZI + AFSK)
     KPCAX25.build({dest, src, path:['WIDE1-1'], info})  → the AX.25 UI frame bytes;  parse(bytes) → {dest, src, path, info}
     KPCAX25.aprs(info, dest)                 → what an APRS packet means: position, symbol, comment, message, status…
     KPCAX25.kiss.encode(frame) / kiss.Decoder().feed(bytes) → frames      (KISS TNCs: radios with a built-in TNC, Mobilinkd…)
     KPCAX25.passcode(call)                   → the APRS-IS passcode for a call (the iGate login) */
(function (G) {
  'use strict';

  /* ---------------- CRC-16 (X.25 / HDLC FCS) ---------------- */
  const CRC = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x8408 : c >>> 1; CRC[i] = c; }
  function crc16(bytes, n) { let c = 0xFFFF; for (let i = 0; i < (n == null ? bytes.length : n); i++) c = (c >>> 8) ^ CRC[(c ^ bytes[i]) & 0xFF]; return (~c) & 0xFFFF; }

  /* ---------------- AFSK demodulator: sliding-window correlation + a bit clock that follows the transitions ---------------- */
  function Demod(rate, baud, mark, space) {
    rate = rate || 12000; baud = baud || 1200; mark = mark || 1200; space = space || 2200;
    const N = Math.round(rate / baud);                     /* samples per bit: 10 at 1200 bd, 40 at 300 bd */
    const W = N;                                             /* correlation window = one bit */
    const buf = new Float32Array(W); let bp = 0;
    /* band-pass around the two tones first (windowed sinc): noise outside the tones should not vote */
    const FT = 31, fir = new Float32Array(FT), fh = new Float32Array(FT); let fp = 0;
    { const lo = Math.max(100, Math.min(mark, space) - 400) / rate, hi = (Math.max(mark, space) + 400) / rate, mid = (FT - 1) / 2;
      for (let i = 0; i < FT; i++) { const m = i - mid, w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FT - 1)); fir[i] = (m === 0 ? 2 * (hi - lo) : (Math.sin(2 * Math.PI * hi * m) - Math.sin(2 * Math.PI * lo * m)) / (Math.PI * m)) * w; } }
    const mi = new Float32Array(W), mq = new Float32Array(W), si = new Float32Array(W), sq = new Float32Array(W);
    for (let i = 0; i < W; i++) { mi[i] = Math.cos(2 * Math.PI * mark * i / rate); mq[i] = Math.sin(2 * Math.PI * mark * i / rate); si[i] = Math.cos(2 * Math.PI * space * i / rate); sq[i] = Math.sin(2 * Math.PI * space * i / rate); }
    /* bit clock: phase runs 0..1 per bit; a tone change pulls the phase toward the middle */
    let ph = 0, tone = 0, lastTone = 0, lp = 0;
    const inc = baud / rate;
    /* HDLC */
    let sr = 0, ones = 0, nbits = 0, fr = new Uint8Array(400), fl = 0, inFrame = false, cur = 0, cbits = 0;
    const self = { onFrame: null, frames: 0, bad: 0, feed, N, W };
    function hdlcBit(b) {
      sr = ((sr << 1) | b) & 0xFF; nbits++;
      if (sr === 0x7E) {                                   /* a flag: end of a frame (or just between frames) */
        if (inFrame && fl >= 17 && cbits === 7) { if (crc16(fr, fl - 2) === (fr[fl - 2] | (fr[fl - 1] << 8))) { self.frames++; if (self.onFrame) self.onFrame(fr.slice(0, fl - 2)); } else self.bad++; }
        inFrame = true; fl = 0; cur = 0; cbits = 0; ones = 0; return;
      }
      if (!inFrame) return;
      if (b) { ones++; if (ones > 6) { inFrame = false; return; } }      /* seven 1s = abort */
      else if (ones === 5) { ones = 0; return; }                          /* a stuffed 0: drop it */
      else ones = 0;
      cur |= b << cbits; cbits++;
      if (cbits === 8) { if (fl < fr.length) fr[fl++] = cur; else inFrame = false; cur = 0; cbits = 0; }
    }
    function feed(pcm) {
      for (let s = 0; s < pcm.length; s++) {
        fh[fp] = pcm[s]; fp = (fp + 1) % FT; let v0 = 0;
        for (let i = 0, j = fp; i < FT; i++, j = (j + 1) % FT) v0 += fh[j] * fir[i];
        buf[bp] = v0; bp = (bp + 1) % W;
        let a = 0, b = 0, c = 0, d = 0;
        for (let i = 0, j = bp; i < W; i++, j = (j + 1) % W) { const v = buf[j]; a += v * mi[i]; b += v * mq[i]; c += v * si[i]; d += v * sq[i]; }
        const diff = (a * a + b * b) - (c * c + d * d);
        lp += (diff - lp) * (N > 16 ? 0.35 : 0.6);                           /* a little smoothing against noise */
        const t = lp > 0 ? 1 : 0;
        if (t !== tone) { tone = t; ph += (0.5 - ph) * 0.25; }  /* pull the clock so we sample mid-bit */
        ph += inc;
        if (ph >= 1) { ph -= 1; hdlcBit(tone === lastTone ? 1 : 0); lastTone = tone; }   /* NRZI: no change = 1 */
      }
    }
    return self;
  }

  /* ---------------- modulator: bytes → HDLC bits (stuffed, flags, CRC) → NRZI → continuous-phase AFSK ---------------- */
  function modulate(bytes, rate, baud, mark, space, pre, post) {
    rate = rate || 48000; baud = baud || 1200; mark = mark || 1200; space = space || 2200; pre = pre == null ? 30 : pre; post = post == null ? 3 : post;
    const bits = [];
    const flag = () => { for (let i = 0; i < 8; i++) bits.push((0x7E >> i) & 1); };
    const crc = crc16(bytes), all = Array.from(bytes).concat([crc & 0xFF, crc >> 8]);
    for (let i = 0; i < pre; i++) flag();
    let ones = 0;
    for (const by of all) for (let i = 0; i < 8; i++) { const b = (by >> i) & 1; bits.push(b); if (b) { ones++; if (ones === 5) { bits.push(0); ones = 0; } } else ones = 0; }
    for (let i = 0; i < post; i++) flag();
    const spb = rate / baud, out = new Float32Array(Math.ceil(bits.length * spb));
    let tone = 0, phase = 0, n = 0;
    for (const b of bits) {
      if (!b) tone ^= 1;                                   /* NRZI: a 0 flips the tone */
      const f = tone ? space : mark, end = Math.round((n + 1) * spb), st = Math.round(n * spb);
      for (let i = st; i < end && i < out.length; i++) { phase += 2 * Math.PI * f / rate; out[i] = Math.sin(phase) * 0.9; }
      n++;
    }
    return out;
  }

  /* ---------------- AX.25 UI frames ---------------- */
  function addr(call, last, h) {
    const m = String(call || '').toUpperCase().match(/^([A-Z0-9]{1,6})(?:-(\d{1,2}))?$/); if (!m) throw new Error('bad call ' + call);
    const out = new Uint8Array(7); const c = m[1].padEnd(6, ' ');
    for (let i = 0; i < 6; i++) out[i] = c.charCodeAt(i) << 1;
    out[6] = 0x60 | ((+m[2] || 0) << 1) | (last ? 1 : 0) | (h ? 0x80 : 0);
    return out;
  }
  function build(o) {
    const path = (o.path || []).filter(Boolean).slice(0, 8), parts = [addr(o.dest || 'APZKPC', false), addr(o.src, !path.length)];
    path.forEach((p, i) => parts.push(addr(p.replace(/\*$/, ''), i === path.length - 1, /\*$/.test(p))));
    const info = typeof o.info === 'string' ? Array.from(new TextEncoder().encode(o.info)) : Array.from(o.info || []);
    const len = parts.length * 7 + 2 + info.length, out = new Uint8Array(len); let k = 0;
    parts.forEach(p => { out.set(p, k); k += 7; }); out[k++] = 0x03; out[k++] = 0xF0; out.set(info, k);
    return out;
  }
  function rdAddr(b, i) { let c = ''; for (let k = 0; k < 6; k++) { const ch = String.fromCharCode(b[i + k] >> 1); if (ch !== ' ') c += ch; } const ssid = (b[i + 6] >> 1) & 15; return { call: c + (ssid ? '-' + ssid : ''), last: !!(b[i + 6] & 1), h: !!(b[i + 6] & 0x80) }; }
  function parse(b) {
    if (!b || b.length < 16) return null;
    const dest = rdAddr(b, 0), src = rdAddr(b, 7), path = []; let i = 14, a = src;
    while (!a.last && i + 7 <= b.length && path.length < 8) { a = rdAddr(b, i); path.push(a.call + (a.h ? '*' : '')); i += 7; }
    if (i + 2 > b.length) return null;
    const ctl = b[i], pid = b[i + 1]; i += 2;
    let info = ''; try { info = new TextDecoder('latin1').decode(b.subarray(i)); } catch (e) { for (let k = i; k < b.length; k++) info += String.fromCharCode(b[k]); }
    return { dest: dest.call, src: src.call, path, ctl, pid, info, ui: ctl === 0x03 };
  }
  const tnc2 = p => p.src + '>' + p.dest + (p.path.length ? ',' + p.path.join(',') : '') + ':' + p.info;

  /* ---------------- what an APRS packet means ---------------- */
  const SYM = { '/-': 'house', '/>': 'car', '/k': 'truck', '/j': 'jeep', '/b': 'bike', '/[': 'walker', '/r': 'repeater', '/#': 'digi', '/_': 'weather', '/y': 'home station', '\\;': 'park', '/;': 'campground', '/a': 'ambulance', '/s': 'boat', '/Y': 'sailboat', '/\'': 'plane', '/v': 'van', '/U': 'bus', '/=': 'train', '/O': 'balloon', '/p': 'dog', '/u': 'truck', '/<': 'motorcycle', '/`': 'dish', '/(': 'mobile sat', '/$': 'phone', '/?': 'file', '/l': 'laptop', '/n': 'node', '/&': 'gateway', '/\\': 'marker' };
  function uncomp(s) {
    const m = s.match(/^(\d{2})(\d{2}\.\d{2})([NS])(.)(\d{3})(\d{2}\.\d{2})([EW])(.)/); if (!m) return null;
    const lat = (+m[1] + m[2] / 60) * (m[3] === 'S' ? -1 : 1), lon = (+m[5] + m[6] / 60) * (m[7] === 'W' ? -1 : 1);
    return { lat, lon, sym: m[4] + m[8], rest: s.slice(m[0].length), amb: (s.match(/ /g) || []).length };
  }
  function comp(s) {
    if (s.length < 13) return null;
    const b91 = t => { let v = 0; for (let i = 0; i < t.length; i++) v = v * 91 + (t.charCodeAt(i) - 33); return v; };
    const lat = 90 - b91(s.slice(1, 5)) / 380926, lon = -180 + b91(s.slice(5, 9)) / 190463;
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
    return { lat, lon, sym: s[0] + s[9], rest: s.slice(13) };
  }
  /* Mic-E: the position is split between the destination call and the info field (most handhelds send this) */
  function mice(info, dest) {
    if (!dest || dest.length < 6 || info.length < 9) return null;
    const d = dest.split('-')[0].padEnd(6, ' ');
    const dig = c => { const x = c.charCodeAt(0); if (x >= 48 && x <= 57) return { n: x - 48, b: 0 }; if (x >= 65 && x <= 74) return { n: x - 65, b: 1 }; if (x >= 80 && x <= 89) return { n: x - 80, b: 1 }; if (c === 'K' || c === 'L' || c === 'Z') return { n: 0, b: c === 'Z' ? 0 : 1 }; return null; };
    const ds = []; for (let i = 0; i < 6; i++) { const x = dig(d[i]); if (!x) return null; ds.push(x); }
    let lat = ds[0].n * 10 + ds[1].n + (ds[2].n * 10 + ds[3].n + (ds[4].n * 10 + ds[5].n) / 100) / 60;
    const north = /[P-Z]/.test(d[3]) || d[3] === 'Z' ? true : /[0-9L]/.test(d[3]) ? false : true;
    if (!north) lat = -lat;
    const lonOff = /[P-Z]/.test(d[4]) ? 100 : 0, west = /[P-Z]/.test(d[5]);
    let ld = info.charCodeAt(1) - 28 + lonOff; if (ld >= 180 && ld <= 189) ld -= 80; else if (ld >= 190 && ld <= 199) ld -= 190;
    let lm = info.charCodeAt(2) - 28; if (lm >= 60) lm -= 60;
    const lh = info.charCodeAt(3) - 28;
    let lon = ld + (lm + lh / 100) / 60; if (west) lon = -lon;
    const sp = (info.charCodeAt(4) - 28) * 10 + Math.floor((info.charCodeAt(5) - 28) / 10), crs = ((info.charCodeAt(5) - 28) % 10) * 100 + (info.charCodeAt(6) - 28);
    const sym = info[8] + info[7];
    let rest = info.slice(9); if (/^[>\]`']/.test(rest)) rest = rest.slice(1); rest = rest.replace(/[\]`'=^]\s*$/, '');
    return { lat, lon, sym, rest, speed: sp > 799 ? sp - 800 : sp, course: crs > 400 ? crs - 400 : crs };
  }
  function aprs(info, dest) {
    const t = info[0] || '', r = { type: t, text: info };
    const pos = (s, time) => { const p = s[0] >= '0' && s[0] <= '9' ? uncomp(s) : comp(s); if (p) Object.assign(r, { kind: 'pos', lat: p.lat, lon: p.lon, sym: p.sym, what: SYM[p.sym] || '', comment: p.rest.replace(/^\d{3}\/\d{3}/, '').trim(), time }); };
    if (t === '!' || t === '=') pos(info.slice(1));
    else if (t === '/' || t === '@') pos(info.slice(8), info.slice(1, 8));
    else if (t === '`' || t === '\'') { const m = mice(info, dest); if (m) Object.assign(r, { kind: 'pos', lat: m.lat, lon: m.lon, sym: m.sym, what: SYM[m.sym] || '', comment: m.rest.trim(), speed: m.speed, course: m.course }); }
    else if (t === ':') {
      const m = info.match(/^:([^:]{9}):(.*)$/);
      if (m) { const to = m[1].trim(), body = m[2], ack = body.match(/^ack(\S+)$/), rej = body.match(/^rej(\S+)$/), id = body.match(/\{(\S{1,5})$/);
        Object.assign(r, { kind: ack ? 'ack' : rej ? 'rej' : 'msg', to, msg: id ? body.slice(0, -id[0].length) : body, id: ack ? ack[1] : rej ? rej[1] : id ? id[1] : '' }); }
    }
    else if (t === '>') Object.assign(r, { kind: 'status', comment: info.slice(1).replace(/^\d{6}[zh]/, '') });
    else if (t === ';') { const m = info.match(/^;(.{9})(\*|_)(\d{6}[zh\/])(.*)$/); if (m) { const p = uncomp(m[4]); Object.assign(r, { kind: 'obj', name: m[1].trim(), live: m[2] === '*' }, p ? { lat: p.lat, lon: p.lon, sym: p.sym, what: SYM[p.sym] || '', comment: p.rest.trim() } : {}); } }
    else if (t === 'T') Object.assign(r, { kind: 'tele' });
    else if (t === '_') Object.assign(r, { kind: 'wx' });
    else r.kind = 'other';
    return r;
  }
  /* position → the uncompressed APRS form */
  function posText(lat, lon, sym, comment, kind) {
    const dm = (v, w) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return String(d).padStart(w, '0') + m.toFixed(2).padStart(5, '0'); };
    sym = sym || '\\;';
    return (kind || '!') + dm(lat, 2) + (lat >= 0 ? 'N' : 'S') + sym[0] + dm(lon, 3) + (lon >= 0 ? 'E' : 'W') + sym[1] + (comment || '');
  }
  const msgText = (to, text, id) => ':' + String(to).toUpperCase().padEnd(9, ' ').slice(0, 9) + ':' + text + (id ? '{' + id : '');
  const ackText = (to, id) => ':' + String(to).toUpperCase().padEnd(9, ' ').slice(0, 9) + ':ack' + id;

  /* ---------------- KISS (for radios with a TNC inside, and TNC boxes) ---------------- */
  const FEND = 0xC0, FESC = 0xDB, TFEND = 0xDC, TFESC = 0xDD;
  const kiss = {
    encode(frame, port) { const o = [FEND, ((port || 0) << 4) & 0xF0]; for (const b of frame) { if (b === FEND) o.push(FESC, TFEND); else if (b === FESC) o.push(FESC, TFESC); else o.push(b); } o.push(FEND); return new Uint8Array(o); },
    Decoder() { let cur = [], esc = false, inF = false; return { feed(bytes) { const out = []; for (const b of bytes) { if (b === FEND) { if (inF && cur.length > 1 && (cur[0] & 15) === 0) out.push(new Uint8Array(cur.slice(1))); cur = []; esc = false; inF = true; continue; } if (!inF) continue; if (esc) { cur.push(b === TFEND ? FEND : b === TFESC ? FESC : b); esc = false; } else if (b === FESC) esc = true; else cur.push(b); } return out; } }; }
  };
  /* the APRS-IS passcode (the well-known hash every client uses) */
  function passcode(call) { let h = 0x73E2; const c = String(call).toUpperCase().split('-')[0]; for (let i = 0; i < c.length; i += 2) { h ^= c.charCodeAt(i) << 8; if (i + 1 < c.length) h ^= c.charCodeAt(i + 1); } return h & 0x7FFF; }
  /* distance + bearing between two places (km, degrees) */
  function geo(lat1, lon1, lat2, lon2) {
    const R = 6371, r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(a));
    const y = Math.sin(dLon) * Math.cos(lat2 * r), x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
    return { km, deg: (Math.atan2(y, x) / r + 360) % 360 };
  }
  G.KPCAX25 = { Demod, modulate, build, parse, tnc2, aprs, posText, msgText, ackText, kiss, passcode, crc16, geo, SYM };
})(typeof window !== 'undefined' ? window : globalThis);
