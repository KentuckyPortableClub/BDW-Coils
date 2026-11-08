/* KPC app: ONE SMALL MAP (Opus, Oct 22) for the offline parks viewer and the APRS map. A canvas, Web Mercator, drag to
   pan, pinch / wheel to zoom, tap to ask what is there. No library, so it works with no signal: outlines and pins are
   drawn from what is on the device. With signal it can lay satellite pictures underneath (Esri World Imagery, credited
   on the map; Brandon Oct 22: 'a sat style map would be nice'); with none the background is plain.
     const m = KPCMap.create(canvas, { draw(ctx, P, z), tap(la, lo, x, y), sat: true })
     m.view(la, lo, zoom)   m.fit([[la,lo],…])   m.redraw()   m.sat(on)   P(la, lo) -> [x, y] on the canvas */
(function (G) {
  'use strict';
  const T = 256, AG = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  /* Brandon Oct 22: 'sat+street please' = the pictures, then roads and place names on top (Esri's reference layers) */
  const LAYERS = [AG + 'World_Imagery/MapServer/tile/', AG + 'Reference/World_Transportation/MapServer/tile/', AG + 'Reference/World_Boundaries_and_Places/MapServer/tile/'];
  const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/';
  const X = (lo, z) => (lo + 180) / 360 * T * 2 ** z;
  const Y = (la, z) => { const s = Math.sin(la * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * T * 2 ** z; };
  const LO = (x, z) => x / (T * 2 ** z) * 360 - 180;
  const LA = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (T * 2 ** z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const tiles = new Map();
  function create(cv, o) {
    o = o || {};
    let la = 37.8, lo = -85.5, z = 7, sat = !!o.sat, raf = 0; const MINZ = o.minZ || 3;   /* the QSO map zooms out to the whole world (minZ 1) */
    const ctx = cv.getContext('2d');
    function size() { const r = cv.getBoundingClientRect(), d = G.devicePixelRatio || 1, w = Math.max(100, Math.round(r.width)), h = Math.max(100, Math.round(r.height)); if (cv.width !== w * d || cv.height !== h * d) { cv.width = w * d; cv.height = h * d; } ctx.setTransform(d, 0, 0, d, 0, 0); return [w, h]; }
    function P(a, b) { const [w, h] = [cv.clientWidth, cv.clientHeight]; return [X(b, z) - X(lo, z) + w / 2, Y(a, z) - Y(la, z) + h / 2]; }
    function un(x, y) { const [w, h] = [cv.clientWidth, cv.clientHeight]; return [LA(Y(la, z) + y - h / 2, z), LO(X(lo, z) + x - w / 2, z)]; }
    function tile(tz, tx, ty, L) {
      const k = (L || 0) + ':' + tz + '/' + ty + '/' + tx; let t = tiles.get(k);
      if (!t) { t = new Image(); t.onload = () => redraw();
        /* Oct 24 (Brandon: 'sat and streets has a black background' on the tablet): a picture that fails tries the USGS
           imagery + roads map once (US, free, no key); the first failure goes in the builders' report */
        t.onerror = () => { if (!t.alt && !L) { t.alt = 1; if (!tile.said) { tile.said = 1; console.warn('map: satellite tile failed, trying USGS: ' + t.src); } t.src = USGS + tz + '/' + ty + '/' + tx; return; } t.bad = 1; if (!tile.said2) { tile.said2 = 1; console.warn('map: tile failed: ' + t.src); } redraw(); };
        t.src = LAYERS[L || 0] + tz + '/' + ty + '/' + tx; tiles.set(k, t); if (tiles.size > 900) tiles.delete(tiles.keys().next().value); }
      return t.complete && !t.bad && t.naturalWidth ? t : null;
    }
    function paint() {
      raf = 0; const [w, h] = size(), dark = document.documentElement.dataset.theme !== 'light';
      ctx.fillStyle = dark ? '#0b0f14' : '#eef0e8'; ctx.fillRect(0, 0, w, h);
      const online = navigator.onLine !== false, zi = Math.max(0, Math.min(19, Math.round(z)));
      if (sat && online) {
        const sc = 2 ** (z - zi), cx = X(lo, zi), cy = Y(la, zi), x0 = cx - w / 2 / sc, y0 = cy - h / 2 / sc, n = 2 ** zi;
        for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + h / sc) / T); ty++) for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + w / sc) / T); tx++) {
          if (ty < 0 || ty >= n) continue; for (let L = 0; L < LAYERS.length; L++) { const im = tile(zi, ((tx % n) + n) % n, ty, L); if (im) ctx.drawImage(im, (tx * T - x0) * sc, (ty * T - y0) * sc, T * sc + 0.5, T * sc + 0.5); }
        }
      }
      if (o.draw) { try { o.draw(ctx, P, z, { w, h, sat: sat && online, dark }); } catch (e) { console.error('map draw: ' + e.message); } }
      ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = sat && online ? '#fff' : (dark ? '#9AA6B5' : '#5A6270');
      ctx.fillText(sat && online ? 'Imagery + labels © Esri, Maxar, Earthstar Geographics, HERE, Garmin' : (sat ? 'No signal: satellite pictures need the internet' : ''), w - 6, h - 6);
    }
    function redraw() { if (!raf) raf = requestAnimationFrame(paint); }
    /* touch + mouse */
    const pts = new Map(); let moved = 0, pinch = null;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z }; } });
    cv.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2 && pinch) { pts.set(e.pointerId, [e.offsetX, e.offsetY]); const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); z = Math.max(MINZ, Math.min(18, pinch.z + Math.log2(d / (pinch.d || 1)))); moved = 99; redraw(); return; }
      const dx = e.offsetX - p[0], dy = e.offsetY - p[1]; moved += Math.abs(dx) + Math.abs(dy); pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      const [nla, nlo] = un(cv.clientWidth / 2 - dx, cv.clientHeight / 2 - dy); la = Math.max(-84, Math.min(84, nla)); lo = nlo; redraw();
    });
    const up = e => { const p = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (p && moved < 8 && o.tap) { const [a, b] = un(e.offsetX, e.offsetY); o.tap(a, b, e.offsetX, e.offsetY); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); const [a, b] = un(e.offsetX, e.offsetY); z = Math.max(MINZ, Math.min(18, z - Math.sign(e.deltaY) * 0.5)); const [c, d] = un(e.offsetX, e.offsetY); la += a - c; lo += b - d; redraw(); }, { passive: false });
    G.addEventListener('resize', redraw);
    const m = {
      view(a, b, zz) { if (isFinite(a) && isFinite(b)) { la = a; lo = b; } if (isFinite(zz)) z = zz; redraw(); return m; },
      fit(list) {
        list = (list || []).filter(p => isFinite(p[0]) && isFinite(p[1])); if (!list.length) return m;
        const a = Math.min(...list.map(p => p[0])), b = Math.max(...list.map(p => p[0])), c = Math.min(...list.map(p => p[1])), d = Math.max(...list.map(p => p[1]));
        la = (a + b) / 2; lo = (c + d) / 2; const w = cv.clientWidth || 360, h = cv.clientHeight || 300;
        z = 16; while (z > MINZ && (X(d, z) - X(c, z) > w * 0.85 || Y(a, z) - Y(b, z) > h * 0.85)) z -= 0.5;
        redraw(); return m;
      },
      redraw, P, sat(on) { if (on !== undefined) { sat = !!on; redraw(); } return sat; }, center: () => [la, lo, z]
    };
    redraw();
    return m;
  }
  G.KPCMap = { create };
})(window);
