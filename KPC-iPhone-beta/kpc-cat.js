/* KPC radio control (CAT) + QRZ logbook sender — shared by the members Hunters Lounge and its CAT & QRZ tab (Brandon Oct 17 2026).
   CAT uses the browser's Web Serial (Chrome / Edge on a computer, plugged in by USB). Settings live only in this browser
   (localStorage kpcCat). The QRZ logbook key lives only in this browser too (localStorage kpcQrz) and goes only to logbook.qrz.com.

   window.KPCCat: get(), set(o), supported(), connect(ask), connected(), tune(kHz, mode) -> Promise<bool>, read() -> {khz, mode}|null, ptt(on, via) -> Promise<bool>,
                  test(), onStatus(fn), follow(fn) (poll the radio every 2 s while 'follow' is on)
   window.KPCQrz: get(), set(o), on(), send(adifRecord) -> Promise<{ok, sure, msg}>                                                     */
(function () {
  const LS = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const SV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const DEF = { on: false, proto: 'kenwood', baud: 38400, civ: '94', data: 'usb', follow: false, model: '' };
  let S = Object.assign({}, DEF, LS('kpcCat') || {});
  /* Oct 18 (Brandon's FT-710: 1-10 W out, ALC high): plain USB makes Yaesu / Icom take the sound from the MIC jack, so FT8 now uses the radio's DATA mode (DATA-U / USB-D) on those radios, like WSJT-X 'Data/Pkt' */
  const DATAOK = r => /^(yaesu|yaesu8|icom)$/.test(r.proto) && r.model !== 'xiegu';
  /* Oct 19 (Brandon): DATA mode stays; the low power was the radio's DATA MOD SOURCE menu (set it to USB), not the mode */
  /* Oct 19 7:37 PM: back to no power after DATA mode came back, so Brandon's menu fix is on the plain USB side: plain USB again for everyone */
  /* Oct 19 7:52 PM (Brandon, final): radio in DATA mode (DATA-U) + the radio's DATA MOD SOURCE menu set to USB */
  if (S.dv !== 5) { S.data = DATAOK(S) ? 'data' : 'usb'; S.dv = 5; SV('kpcCat', S); }
  let port = null, writer = null, reader = null, rbuf = [], busy = Promise.resolve(), subs = [], fol = null;
  const say = (t, ok) => subs.forEach(f => { try { f(t, ok); } catch (e) {} });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /* Bluetooth serial (SPP) radios show in the port list too on Chrome for Android (IC-705's Bluetooth data, BT CAT dongles) */
  const PICK = { allowedBluetoothServiceClassIds: ['00001101-0000-1000-8000-00805f9b34fb'] };

  /* ---- what each kind of radio wants ---- */
  const M = s => String(s || '').toUpperCase();
  function kind(mode, khz) { // CW / SSB(USB|LSB) / FM / AM / DATA
    const m = M(mode);
    if (/CW/.test(m)) return 'CW';
    if (/^(DATAL|DATA-L|PKTLSB|LSB-D|DIGL)$/.test(m)) return 'DATAL';   /* Oct 26 (Fable): data on the LOWER sideband (SSTV / voice via the data input on 40 m and 80 m) */
    if (/FT8|FT4|JS8|PSK|RTTY|DATA|DIG|OLIVIA|MFSK|VARA|SSTV|WSPR/.test(m)) return 'DATA';
    if (m === 'FM') return 'FM'; if (m === 'AM') return 'AM';
    if (m === 'LSB') return 'LSB'; if (m === 'USB') return 'USB';
    return khz && khz < 10000 ? 'LSB' : 'USB'; // SSB / PHONE: LSB below 10 MHz, USB above (60 m is USB)
  }
  const sb = (k, khz) => (k === 'USB' || k === 'LSB') ? (khz >= 5300 && khz <= 5410 ? 'USB' : k) : k;
  const pad = (n, w) => String(Math.round(n)).padStart(w, '0');
  const asc = t => new TextEncoder().encode(t);
  const bcdLE = (hz, bytes) => { const d = pad(hz, bytes * 2); const o = []; for (let i = bytes - 1; i >= 0; i--) o.push(parseInt(d.substr(i * 2, 2), 16)); return o; };
  const civ = () => parseInt(S.civ || '94', 16) & 255;
  const icom = body => new Uint8Array([0xFE, 0xFE, civ(), 0xE0, ...body, 0xFD]);

  const PROTOS = {
    kenwood: { // Kenwood, Elecraft K3/K4/KX2/KX3, QRP Labs QMX/QDX, (tr)uSDX, Lab599 TX-500, FlexRadio (SmartSDR CAT)
      tune(khz, k) { const md = { LSB: 1, USB: 2, CW: 3, FM: 4, AM: 5, DATA: S.data === 'data' ? (S.model === 'elecraft' ? 6 : 2) : 2, DATAL: S.data === 'data' ? (S.model === 'elecraft' ? 9 : 1) : 1 }[k] || 2;
        const out = [asc('FA' + pad(khz * 1000, 11) + ';'), asc('MD' + md + ';')]; if (/^DATA/.test(k) && S.data === 'data' && S.model !== 'elecraft') out.push(asc('DA1;')); return out; },
      ask: () => asc('FA;IF;'),
      parse(t) { const f = /FA(\d{11});/.exec(t); const md = /IF[\d+\- ]{27}(\d)/.exec(t); if (!f) return null;
        return { khz: +f[1] / 1000, mode: md ? ({ 1: 'LSB', 2: 'USB', 3: 'CW', 4: 'FM', 5: 'AM', 6: 'DATA', 7: 'CW', 9: 'DATA' }[md[1]] || '') : '' }; }
    },
    yaesu: { // newer Yaesu CAT: FT-991A, FT-891, FT-710, FTDX10, FTDX101, FT-DX3000/5000
      tune(khz, k) { const md = { LSB: '1', USB: '2', CW: '3', FM: '4', AM: '5', DATA: S.data === 'data' ? 'C' : '2', DATAL: S.data === 'data' ? '8' : '1' }[k] || '2'; return [asc('FA' + pad(khz * 1000, 9) + ';'), asc('MD0' + md + ';')]; },
      ask: () => asc('FA;MD0;'),
      parse(t) { const f = /FA(\d{9});/.exec(t); const md = /MD0([0-9A-E]);/.exec(t); if (!f) return null;
        return { khz: +f[1] / 1000, mode: md ? ({ 1: 'LSB', 2: 'USB', 3: 'CW', 4: 'FM', 5: 'AM', 6: 'DATA', 7: 'CW', 8: 'DATAL', 9: 'DATA', C: 'DATA', B: 'FM' }[md[1]] || '') : '' }; }
    },
    yaesu8: { // older 'new CAT' Yaesu with 8-digit frequency: FT-450D, FT-950, FT-2000, FTDX1200, FTDX3000, FTDX5000
      tune(khz, k) { const md = { LSB: '1', USB: '2', CW: '3', FM: '4', AM: '5', DATA: S.data === 'data' ? 'C' : '2', DATAL: S.data === 'data' ? '8' : '1' }[k] || '2'; return [asc('FA' + pad(khz * 1000, 8) + ';'), asc('MD0' + md + ';')]; },
      ask: () => asc('FA;MD0;'),
      parse(t) { const f = /FA(\d{8});/.exec(t); const md = /MD0([0-9A-E]);/.exec(t); if (!f) return null;
        return { khz: +f[1] / 1000, mode: md ? ({ 1: 'LSB', 2: 'USB', 3: 'CW', 4: 'FM', 5: 'AM', 6: 'DATA', 7: 'CW', 8: 'DATAL', 9: 'DATA', C: 'DATA', B: 'FM' }[md[1]] || '') : '' }; }
    },
    yaesuold: { // FT-817 / FT-818 / FT-857 / FT-897 (5-byte binary commands)
      tune(khz, k) { const d = pad(khz * 100, 8); const f = [0, 2, 4, 6].map(i => parseInt(d.substr(i, 2), 16));
        const md = { LSB: 0, USB: 1, CW: 2, FM: 8, AM: 4, DATA: S.data === 'data' ? 0x0A : 1, DATAL: S.data === 'data' ? 0x0A : 0 }[k]; return [new Uint8Array([...f, 0x01]), new Uint8Array([md == null ? 1 : md, 0, 0, 0, 0x07])]; },
      ask: () => new Uint8Array([0, 0, 0, 0, 0x03]),
      parse(t, raw) { if (!raw || raw.length < 5) return null; const b = raw.slice(-5); const h = b.slice(0, 4).map(x => x.toString(16).padStart(2, '0')).join('');
        if (!/^\d{8}$/.test(h)) return null; return { khz: +h / 100, mode: ({ 0: 'LSB', 1: 'USB', 2: 'CW', 3: 'CW', 4: 'AM', 8: 'FM', 0x0A: 'DATA', 0x0C: 'DATA' }[b[4]] || '') }; }
    },
    hamlib: { // Hamlib's rigctld (text over TCP, port 4532): any of its 300+ radios, incl. the IC-705 over WiFi through rigctld on the PC
      tune(khz, k) { const md = { LSB: 'LSB', USB: 'USB', CW: 'CW', FM: 'FM', AM: 'AM', DATA: S.data === 'data' ? 'PKTUSB' : 'USB', DATAL: S.data === 'data' ? 'PKTLSB' : 'LSB' }[k] || 'USB'; return [asc('F ' + Math.round(khz * 1000) + '\n'), asc('M ' + md + ' 0\n')]; },
      ask: () => asc('f\nm\n'),
      parse(t) { const L = t.split(/\r?\n/).map(x => x.trim()).filter(Boolean); const hz = L.find(x => /^\d{4,}$/.test(x)); if (!hz) return null; const i = L.indexOf(hz); const mdl = L.slice(i + 1).find(x => /^[A-Z]{2,7}$/.test(x)) || '';
        return { khz: +hz / 1000, mode: /PKT|DIG|DATA/.test(mdl) ? (/LSB|DIGL|DATAL/.test(mdl) ? 'DATAL' : 'DATA') : mdl }; }
    },
    icom: { // Icom CI-V: IC-705, IC-7300, IC-7610, IC-9700, IC-7100, IC-718; Xiegu G90 / X6100 / X5105 (CI-V)
      tune(khz, k) { const md = { LSB: 0, USB: 1, AM: 2, CW: 3, FM: 5, DATA: 1, DATAL: 0 }[k]; const o = [icom([0x05, ...bcdLE(khz * 1000, 5)]), icom([0x06, md == null ? 1 : md, 0x01])];
        const dt = /^DATA/.test(k) && S.data === 'data' ? 1 : 0; if (S.model !== 'xiegu') o.push(icom([0x1A, 0x06, dt, dt])); return o; },
      ask: () => new Uint8Array([...icom([0x03]), ...icom([0x04])]),
      parse(t, raw) { if (!raw) return null; let khz = 0, mode = '';
        for (let i = 0; i < raw.length - 5; i++) { if (raw[i] === 0xFE && raw[i + 1] === 0xFE && raw[i + 2] === 0xE0) { const c = raw[i + 4];
          if ((c === 0x03 || c === 0x00) && raw[i + 10] === 0xFD) { let s = ''; for (let j = 4; j >= 0; j--) s += raw[i + 5 + j].toString(16).padStart(2, '0'); if (/^\d{10}$/.test(s)) khz = +s / 1000; }
          if ((c === 0x04 || c === 0x01) && raw[i + 7] === 0xFD) mode = { 0: 'LSB', 1: 'USB', 2: 'AM', 3: 'CW', 4: 'DATA', 5: 'FM', 7: 'CW', 8: 'DATA' }[raw[i + 5]] || ''; } }
        return khz ? { khz, mode } : null; }
    }
  };


  /* ---- Oct 18 (Brandon's tablet + FT-710: Chrome on Android listed NO serial ports): Android's Web Serial only sees some USB chips,
     so on Android we also talk to the radio's USB chip straight over WebUSB with our own small drivers:
     Silicon Labs CP210x (Yaesu FT-710/891/991, FTDX10/101, Icom, most CAT cables; dual chips = 2 ports: 1st = CAT, 2nd = PTT/keying lines),
     FTDI, and standard USB serial (CDC-ACM: QMX, QDX, truSDX, Arduino-type radios). Each one looks like a Web Serial port to the code below. */
  const USBF = [{ vendorId: 0x10C4 }, { vendorId: 0x0403 }, { vendorId: 0x0483 }, { vendorId: 0x2E8A }, { vendorId: 0x2341 }, { vendorId: 0x239A }, { vendorId: 0x1FC9 }, { vendorId: 0x04D8 }, { classCode: 2 }];
  const ANDROID = /Android/i.test(navigator.userAgent || '');
  const useUsb = () => !!navigator.usb && (ANDROID || !('serial' in navigator));
  /* KPC APP (Oct 20): inside the Android app the USB radio goes through the app's own serial code (kpc-native.js), which looks like Web Serial ports here */
  const NAT = () => (window.KPCNative && KPCNative.serial) || null;
  function UsbPort(dev, ifc, n) { this.dev = dev; this.ifc = ifc; this.n = n; this.readable = null; this.writable = null; this.isUsb = true; }
  UsbPort.prototype.getInfo = function () { return { usbVendorId: this.dev.vendorId, usbProductId: this.dev.productId, usbInterface: this.n }; };
  UsbPort.prototype._ctl = function (setup, data) { return this.dev.controlTransferOut(Object.assign({ index: this.ifc.interfaceNumber }, setup), data); };
  UsbPort.prototype.open = async function (o) {
    const d = this.dev, v = d.vendorId, alt = this.ifc.alternates[0], baud = +o.baudRate || 38400, stop2 = o.stopBits === 2;
    if (!d.opened) await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    let dataIfc = this.ifc;
    if (v === 0x10C4) { // CP210x: enable, baud, 8 data bits + stop bits, no parity
      await d.claimInterface(this.ifc.interfaceNumber);
      await this._ctl({ requestType: 'vendor', recipient: 'interface', request: 0x00, value: 0x0001 });
      const b = new ArrayBuffer(4); new DataView(b).setUint32(0, baud, true);
      await this._ctl({ requestType: 'vendor', recipient: 'interface', request: 0x1E, value: 0 }, b);
      await this._ctl({ requestType: 'vendor', recipient: 'interface', request: 0x03, value: 0x0800 | (stop2 ? 2 : 0) });
      this.kind = 'cp';
    } else if (v === 0x0403) { // FTDI: reset, baud divisor (3 MHz base, 1/8 steps), 8N1 / 8N2
      await d.claimInterface(this.ifc.interfaceNumber);
      const ix = d.configuration.interfaces.length > 1 ? this.ifc.interfaceNumber + 1 : 0;
      await d.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0, value: 0, index: ix });
      const div = 3000000 / baud, i = Math.floor(div), f = Math.round((div - i) * 8) & 7, FR = [0, 3, 2, 4, 1, 5, 6, 7], c = FR[f];
      await d.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 3, value: (i & 0x3FFF) | ((c & 3) << 14), index: (c >> 2) | (ix << 8) });
      await d.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 4, value: 8 | (stop2 ? 0x1000 : 0), index: ix });
      this.kind = 'ftdi'; this.fix = ix;
    } else { // CDC-ACM: comm interface gets the line settings, data interface carries the bytes
      const all = d.configuration.interfaces;
      const comm = all.find(x => x.alternates[0].interfaceClass === 2) || this.ifc;
      dataIfc = all.find(x => x.alternates[0].interfaceClass === 10) || this.ifc;
      for (const x of new Set([comm, dataIfc])) { try { await d.claimInterface(x.interfaceNumber); } catch (e) { if (x === dataIfc) throw e; } }
      const lc = new ArrayBuffer(7), dv = new DataView(lc); dv.setUint32(0, baud, true); dv.setUint8(4, stop2 ? 2 : 0); dv.setUint8(5, 0); dv.setUint8(6, 8);
      try { await d.controlTransferOut({ requestType: 'class', recipient: 'interface', request: 0x20, value: 0, index: comm.interfaceNumber }, lc); } catch (e) {}
      this.kind = 'cdc'; this.comm = comm;
    }
    const eps = dataIfc.alternates[0].endpoints, inEp = eps.find(e => e.direction === 'in' && e.type === 'bulk'), outEp = eps.find(e => e.direction === 'out' && e.type === 'bulk');
    if (!inEp || !outEp) throw new Error('this USB device has no data line');
    const me = this, size = inEp.packetSize || 64; me.alive = true;
    this.readable = new ReadableStream({ async pull(ctl) {
      for (;;) {
        if (!me.alive) { ctl.close(); return; }
        let r; try { r = await d.transferIn(inEp.endpointNumber, size * 4); } catch (e) { ctl.error(e); return; }
        let u = r.data ? new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength) : new Uint8Array(0);
        if (me.kind === 'ftdi') { const o = []; for (let k = 0; k < u.length; k += size) o.push(...u.slice(k + 2, k + size)); u = new Uint8Array(o); } // FTDI: 2 status bytes per packet
        if (u.length) { ctl.enqueue(u); return; }
        await sleep(20);
      } } });
    this.writable = new WritableStream({ async write(ch) { await d.transferOut(outEp.endpointNumber, ch); } });
  };
  UsbPort.prototype.setSignals = async function (o) {
    this.sig = Object.assign({ dataTerminalReady: false, requestToSend: false }, this.sig || {}, o || {});
    const dtr = this.sig.dataTerminalReady ? 1 : 0, rts = this.sig.requestToSend ? 1 : 0, d = this.dev;
    if (!d.opened) { await d.open(); if (!d.configuration) await d.selectConfiguration(1); try { await d.claimInterface(this.ifc.interfaceNumber); } catch (e) {} }
    if (this.kind === 'ftdi') {
      await d.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 1, value: 0x0100 | dtr, index: this.fix || 0 });
      await d.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 1, value: 0x0200 | (rts << 1), index: this.fix || 0 });
    } else if (this.kind === 'cdc') {
      await d.controlTransferOut({ requestType: 'class', recipient: 'interface', request: 0x22, value: dtr | (rts << 1), index: this.comm.interfaceNumber });
    } else { // CP210x (also a 2nd CP2105 port used only for PTT / keying)
      try { await d.claimInterface(this.ifc.interfaceNumber); } catch (e) {}
      try { await this._ctl({ requestType: 'vendor', recipient: 'interface', request: 0x00, value: 0x0001 }); } catch (e) {}
      await this._ctl({ requestType: 'vendor', recipient: 'interface', request: 0x07, value: dtr | (rts << 1) | 0x0300 });
    }
  };
  UsbPort.prototype.close = async function () { this.alive = false; try { await this.dev.releaseInterface(this.ifc.interfaceNumber); } catch (e) {} if (!USBP.some(p => p !== this && p.dev === this.dev && p.alive)) { try { await this.dev.close(); } catch (e) {} } };
  let USBP = [];
  async function usbPorts() {
    if (!navigator.usb) return [];
    const ds = await navigator.usb.getDevices(), out = [];
    for (const d of ds) {
      let cfg = d.configuration; try { if (!cfg) { await d.open(); await d.selectConfiguration(1); cfg = d.configuration; } } catch (e) {}
      const ifs = cfg ? cfg.interfaces : [];
      let list = d.vendorId === 0x10C4 || d.vendorId === 0x0403 ? ifs.filter(x => x.alternates[0].interfaceClass === 255) : ifs.filter(x => x.alternates[0].interfaceClass === 2).slice(0, 1);
      if (!list.length && ifs.length) list = [ifs[0]];
      list.forEach((x, n) => { const old = USBP.find(p => p.dev === d && p.ifc.interfaceNumber === x.interfaceNumber); out.push(old || new UsbPort(d, x, n)); });
    }
    USBP = out; return out;
  }
  /* ---- THE RADIO FRAME (Fable, Oct 22): how the bytes reach the radio = a 'link'. serial (USB cable: Web Serial / WebUSB / the app's
     native serial), rigctld (Hamlib over TCP, Windows app only), flrig (XML-RPC over HTTP, any platform). A link looks like a
     Web Serial port, so everything below works unchanged; flrig is 'direct' (it does the whole job itself, no bytes). ---- */
  const KN = () => (window.kpcNet && kpcNet.tcpOpen) ? window.kpcNet : null;
  function TcpPort(host, port) { this.host = host; this.port = port; this.readable = null; this.writable = null; this.isTcp = true; this.alive = false; }
  TcpPort.prototype.getInfo = function () { return { name: 'rigctld ' + this.host + ':' + this.port }; };
  TcpPort.prototype.open = async function () {
    const r = await KN().tcpOpen({ host: this.host, port: this.port, ms: 4000 }); if (!r.ok) throw new Error(r.err || 'no rigctld at ' + this.host + ':' + this.port + ' (start rigctld, or flrig)');
    this.id = r.id; this.alive = true; const q = []; let wake = null, closed = false; const self = this;
    const kick = () => { if (wake) { const w = wake; wake = null; w(); } };
    if (!TcpPort.wired) { TcpPort.wired = true; KN().onTcpData(d => { const p = TcpPort.all[d.id]; if (p) { p.q.push(Uint8Array.from(d.data, c => c.charCodeAt(0))); p.kick(); } }); KN().onTcpClose(d => { const p = TcpPort.all[d.id]; if (p) { p.closed = true; p.alive = false; p.kick(); } }); }
    TcpPort.all[this.id] = this; this.q = q; this.kick = kick;
    Object.defineProperty(this, 'closed', { get: () => closed, set: v => { closed = v; } });
    this.readable = { getReader: () => ({ read: async () => { while (!q.length && !closed) await new Promise(r2 => { wake = r2; }); return q.length ? { value: q.shift(), done: false } : { value: undefined, done: true }; }, cancel: async () => { closed = true; kick(); }, releaseLock: () => {} }) };
    this.writable = { getWriter: () => ({ write: async bytes => { KN().tcpWrite(self.id, String.fromCharCode(...bytes)); }, releaseLock: () => {} }) };
  };
  TcpPort.prototype.setSignals = async function () {};
  TcpPort.prototype.close = async function () { this.alive = false; if (this.id) { try { KN().tcpClose(this.id); } catch (e) {} delete TcpPort.all[this.id]; } if (this.kick) { this.closed = true; this.kick(); } };
  TcpPort.all = {};
  /* flrig: XML-RPC. rig.set_vfo / rig.set_mode / rig.set_ptt / rig.get_vfo / rig.get_mode / rig.get_modes */
  const FLRIG = {
    direct: true, modes: null,
    url: () => 'http://' + (S.host || 'localhost') + ':' + (+S.port || 12345) + '/',
    async call(m, params) {
      const x = (params || []).map(p => '<param><value>' + (typeof p === 'number' ? '<double>' + p + '</double>' : '<string>' + String(p).replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;') + '</string>') + '</value></param>').join('');
      const body = '<?xml version="1.0"?><methodCall><methodName>' + m + '</methodName><params>' + x + '</params></methodCall>';
      const raw = window.KPCApp && KPCApp.net && KPCApp.net.raw;
      const r = raw ? await raw(FLRIG.url(), { method: 'POST', headers: { 'content-type': 'text/xml' }, body, ms: 4000 }) : await fetch(FLRIG.url(), { method: 'POST', headers: { 'content-type': 'text/xml' }, body }).then(async q => ({ ok: q.ok, text: await q.text() })).catch(e => ({ ok: false, err: e.message }));
      if (!r.ok) throw new Error(r.err || 'flrig did not answer at ' + FLRIG.url() + ' (is flrig running with XML-RPC on?)');
      if (/<fault>/.test(r.text)) throw new Error('flrig fault');
      const v = /<value>(?:<(?:string|double|int|i4)>)?([^<]*)/.exec(r.text); return v ? v[1] : '';
    },
    async modeFor(k) {
      if (!FLRIG.modes) { try { const t = await FLRIG.call('rig.get_modes'); FLRIG.modes = (t.match(/[A-Z0-9\-]+/g) || []); } catch (e) { FLRIG.modes = []; } }
      const L = FLRIG.modes, pick = re => L.find(m => re.test(m));
      if (k === 'DATA') return (S.data === 'data' && (pick(/^(DATA-U|PKT-U|USB-D|DIGU|DATA|PKTUSB|USB-DATA)$/) || pick(/DATA|PKT|DIG/))) || pick(/^USB$/) || 'USB';
      if (k === 'DATAL') return (S.data === 'data' && pick(/^(DATA-L|PKT-L|LSB-D|DIGL|PKTLSB|LSB-DATA)$/)) || pick(/^LSB$/) || 'LSB';
      return pick(new RegExp('^' + k + '$')) || k;
    },
    async setFreqMode(khz, k) { await FLRIG.call('rig.set_vfo', [Math.round(khz * 1000)]); await FLRIG.call('rig.set_mode', [await FLRIG.modeFor(k)]); },
    async get() { const f = await FLRIG.call('rig.get_vfo'), m = await FLRIG.call('rig.get_mode'); return { khz: +f / 1000, mode: /PKT|DIG|DATA|-D$/.test(m) ? (/L/.test(m.replace(/DATA|DIG|PKT/g, '')) ? 'DATAL' : 'DATA') : m }; },
    async ptt(on) { await FLRIG.call('rig.set_ptt', [on ? 1 : 0]); }
  };
  /* the PRETEND radio (Fable, Oct 22): a link that answers like a radio with no cable, so the app can be tried end to end */
  const FAKE = { on: false, khz: 14074, mode: 'DATA', ptt: false };
  const fakeOk = () => { try { return localStorage.getItem('kpcFake') === '1'; } catch (e) { return false; } };
  const LINK = () => S.link || 'serial';
  const linkOk = () => LINK() === 'serial' ? ('serial' in navigator || !!navigator.usb || !!NAT()) : LINK() === 'rigctld' ? !!KN() : true;
  const linkWhy = () => LINK() === 'rigctld' ? 'rigctld (Hamlib) only works from the Windows app.' : 'This browser can\'t talk to a radio. Use Chrome or Edge on a computer, or Chrome on an Android phone or tablet (with a USB-C cable). iPhones can\'t do this yet.';
  let flrigOn = false;
  async function allPorts() { if (LINK() === 'rigctld') return [TcpPort.all[Object.keys(TcpPort.all)[0]] || new TcpPort(S.host || 'localhost', +S.port || 4532)]; if (LINK() === 'flrig') return []; if (NAT()) return NAT().ports(); const a = []; if ('serial' in navigator && !useUsb()) a.push(...await navigator.serial.getPorts()); if (useUsb()) a.push(...await usbPorts()); return a; }
  async function askPort() {
    if (NAT()) { const ps = await NAT().ports(); if (!ps.length) throw Object.assign(new Error('No USB radio found'), { name: 'NotFoundError' }); return ps[0]; }
    if (useUsb()) { const d = await navigator.usb.requestDevice({ filters: USBF }); const ps = await usbPorts(); return ps.find(p => p.dev === d) || ps[0]; }
    /* Oct 23: in the Windows app, PICK A DIFFERENT PORT shows Windows' own names (Enhanced / Standard COM Port) */
    if (window.kpcNet && window.kpcNet.portList && window.KPCApp && KPCApp.pickSerial) { const p = await KPCApp.pickSerial('Pick the radio\'s port', PICK); if (!p) throw Object.assign(new Error('No port picked'), { name: 'NotFoundError' }); return p; }
    return navigator.serial.requestPort(PICK);
  }
  async function openPort(p) {
    port = p; await port.open({ baudRate: +S.baud || 38400, dataBits: 8, stopBits: S.proto === 'yaesuold' ? 2 : 1, parity: 'none', flowControl: 'none' });
    /* Oct 22 (Brandon's FT-710 on Windows: 'connected, but the radio did not answer'): Yaesu's CAT RTS menu is ON from the factory, and then
       the radio ignores every command unless the RTS line is held up. On a PC hold RTS + DTR up (unless one of them IS the PTT line).
       On Android the held line keeps the USB port open and mutes the radio's sound card, so there they stay down as before. */
    const pcLines = !port.isNative && !port.isTcp;
    try { await port.setSignals({ dataTerminalReady: S.ptt === 'dtr' ? false : (pcLines ? true : !!S.dtr), requestToSend: S.ptt === 'rts' ? false : (pcLines ? true : !!S.rts) }); } catch (e) {}
    writer = port.writable.getWriter(); readLoop();
    say('Radio connected.', true); return true;
  }
  async function readLoop() {
    try { reader = port.readable.getReader(); for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) { const v = S.proto === 'icom' && window.KPCScope ? KPCScope.tap(value) : value; if (v.length) rbuf.push(...v); if (rbuf.length > 4096) rbuf = rbuf.slice(-2048); } } }   /* Nov 6: Icom scope frames (27 00) go to kpc-scope.js, never into rbuf */
    catch (e) {} finally { try { reader.releaseLock(); } catch (e) {} }
  }
  /* ---- WHICH PORT (Fable, Oct 23; Brandon's laptop: 'Failed to open serial port' every time after 0.6.6 saved port 9 of 10 — a Bluetooth one;
     'we can't pick a port cause other people's PCs might be different'). Rules now:
       · a port is remembered by WHAT it is (USB maker:product:serial, or the native id), never by its place in a list;
       · only a port that ANSWERS the radio is remembered; one that will not open, or stays silent, is skipped and forgotten;
       · with nothing remembered the app PROBES: USB ports first (the radio's own chip family first), ports with no USB id (Bluetooth,
         built-in) last; each open gets 4 s, then on to the next;
       · one open at a time (a second CONNECT while one runs waits for it: 'A call to open() is already in progress'). */
  const keyOf = p => { const f = (p.getInfo && p.getInfo()) || {}; if (p.isNative) return 'n:' + (p.info && p.info.id); if (p.isTcp) return 'tcp'; if (f.usbVendorId != null) return 'u:' + f.usbVendorId.toString(16) + ':' + (f.usbProductId || 0).toString(16) + ':' + (f.serialNumber || '') + ':' + (p.kpcName || ''); return 'o:' + (p.kpcName || ''); };
  const FAM = { yaesu: [0x10C4], yaesu8: [0x10C4, 0x0403], yaesuold: [0x0403, 0x067B, 0x10C4], icom: [0x10C4, 0x0C26], kenwood: [0x10C4, 0x0403, 0x1A86, 0x0483, 0x2E8A, 0x2341, 0x0B28] };
  function orderPorts(ps) {
    const fam = FAM[S.proto] || [], key = S.portKey || '';
    const score = p => { if (key && keyOf(p) === key) return 0; const f = (p.getInfo && p.getInfo()) || {}; if (p.isNative || p.isTcp) return 1; if (f.usbVendorId == null) return 9; return fam.includes(f.usbVendorId) ? 2 : 3; };
    return ps.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => a.s - b.s || a.i - b.i);
  }
  const withTimeout = (pr, ms, what) => Promise.race([pr, new Promise((_, x) => setTimeout(() => x(new Error(what || 'no answer in ' + ms / 1000 + ' s')), ms))]);
  /* open it, ask the radio once, keep it only if it answers */
  async function probe(p) {
    try { await withTimeout(openPort(p), 4000, 'the port did not open in 4 s'); } catch (e) { try { await p.close(); } catch (e2) {} port = writer = reader = null; return { ok: false, why: String(e.message || e) }; }
    const P = PROTOS[LINK() === 'rigctld' ? 'hamlib' : S.proto] || PROTOS.kenwood;
    let r = null;
    for (let t = 0; t < 2 && !r; t++) { rbuf = []; try { await write(P.ask()); } catch (e) { break; } await sleep(300); const raw = rbuf.slice(); r = P.parse(String.fromCharCode(...raw), raw); }
    if (!r) { await disconnect(true); return { ok: false, why: 'silent' }; }
    S.portKey = keyOf(p); SV('kpcCat', S); lastRead = r; return { ok: true, r };
  }
  let lastRead = null, connecting = null;
  function connect(ask) {
    if (connecting) return connecting;
    connecting = connect2(ask).finally(() => { connecting = null; });
    return connecting;
  }
  async function connect2(ask) {
    if (LINK() === 'fake') { if (!fakeOk()) { say('The pretend radio is off (STATION → Alerts & help).', false); return false; } if (!FAKE.on) { FAKE.on = true; say('Pretend radio connected (no real radio).', true); } return true; }
    if (LINK() === 'flrig') { if (flrigOn) return true; try { FLRIG.modes = null; await FLRIG.get(); flrigOn = true; say('flrig connected.', true); return true; } catch (e) { flrigOn = false; say(e.message || String(e), false); return false; } }
    if (!linkOk()) { say(linkWhy(), false); return false; }
    if (port && writer) {
      if (!((port.isNative || port.isTcp) && port.alive === false)) return true;
      await disconnect(true);                                /* NAT() Oct 22: Android dropped the USB port: open it again instead of writing into nothing */
    }
    let ps = [];
    try { ps = await allPorts(); } catch (e) { ps = []; }
    if (!ps.length && ask) { try { const p = await askPort(); if (p) ps = [p]; } catch (e) {
      const none = /no (port|device) selected|NotFoundError/i.test(String(e && (e.name + ' ' + e.message)));
      say(none ? (ANDROID ? 'No radio picked. Plug the radio into the tablet/phone with a USB cable (a data cable, not charge-only), turn the radio on, then press CONNECT and pick it in the list. If Android asks to allow access to the USB device, say yes.' : 'No port picked. Plug in the radio, turn it on and press CONNECT again.') : 'Could not open the radio: ' + (e.message || e), false); return false; } }
    if (!ps.length) { if (ask) say('No USB port found. Plug the radio in with a data cable and press CONNECT again.', false); return false; }
    const tried = [];
    for (const { p, i } of orderPorts(ps)) {
      if (LINK() !== 'rigctld' && tried.length >= 6 && !(S.portKey && keyOf(p) === S.portKey)) break;   /* a laptop with ten ports: six probes is plenty */
      if (ask) say('Trying port ' + (i + 1) + ' of ' + ps.length + '…', null);
      const r = await probe(p);
      if (r.ok) { say('Radio answers on port ' + (i + 1) + ' (' + (r.r.khz / 1000).toFixed(4) + ' MHz ' + (r.r.mode || '') + ').', true); return true; }
      tried.push('port ' + (i + 1) + ': ' + (r.why === 'silent' ? 'opens but the radio does not answer there' : r.why));
      if (S.portKey && keyOf(p) === S.portKey) { S.portKey = ''; SV('kpcCat', S); }   /* the remembered one failed: forget it */
    }
    say('No port answered as a ' + (RADIO[S.radio] ? RADIO[S.radio].label : S.proto) + ' (' + tried.join(' · ') + '). Check: the radio type in MY RADIO, its CAT RATE menu = ' + (S.baud || 38400) + ', a data cable, and that no other program (WSJT-X, flrig) holds the port. PICK A DIFFERENT PORT lets you choose by hand.', false);
    return false;
  }
  const lastDial = () => lastRead;
  const TLOG = []; const tuneLog = () => TLOG.slice();
  async function disconnect(quiet) { flrigOn = false; FAKE.on = false; await keyPortClose(); try { if (reader) await reader.cancel(); } catch (e) {} try { if (writer) writer.releaseLock(); } catch (e) {} try { if (port) await port.close(); } catch (e) {} port = writer = reader = null; if (!quiet) say('Radio disconnected.', false); }
  async function write(bytes) { await writer.write(bytes); await sleep(S.proto === 'yaesuold' ? 80 : 40); }
  function tune(khz, mode) {
    khz = +khz; if (!S.on || !khz) return Promise.resolve(false);
    busy = busy.then(async () => {
      if (!await connect(false)) { say('Radio not connected: open the CAT & QRZ tab and press CONNECT MY RADIO.', false); return false; }
      const k = sb(kind(mode, khz), khz); lastMode = k;
      if (LINK() === 'fake') { await sleep(60); FAKE.khz = khz; FAKE.mode = k; say(`📻 Pretend radio set to ${(khz / 1000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} MHz ${k}.`, true); return true; }
      if (LINK() === 'flrig') { try { await FLRIG.setFreqMode(khz, k); say(`📻 Radio set to ${(khz / 1000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} MHz ${k} (flrig).`, true); return true; } catch (e) { flrigOn = false; say('flrig did not answer: ' + (e.message || e), false); return false; } }
      const P = PROTOS[LINK() === 'rigctld' ? 'hamlib' : S.proto] || PROTOS.kenwood;
      try { const C = P.tune(khz, k); for (const b of C.slice(1)) await write(b); await write(C[0]);   /* Oct 22 (Brandon: SSB spots 'sometimes 14.283 → 14282.3'): MODE FIRST, then the frequency — a Yaesu moves the dial by the CW offset when it leaves CW, so a mode sent after the frequency knocked it 0.7 kHz off */ say(`📻 Radio set to ${(khz / 1000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} MHz ${k}.`, true);
        /* Oct 25 (Brandon: 21.282 → the radio shows 21.2855, 7.186 → 7.1861; cause still unknown): read the dial straight back and again 3 s later,
           keep the last 12 in the report (KPCCat.tuneLog) and say it out loud when the radio sits more than 50 Hz from what was asked */
        try { rbuf = []; await write(P.ask()); await sleep(260); let r = P.parse(String.fromCharCode(...rbuf), rbuf.slice()); const e = { at: new Date().toISOString().slice(11, 19), ask: khz, mode: k, got: r && r.khz, gotMode: r && r.mode, later: null };
          TLOG.push(e); if (TLOG.length > 12) TLOG.shift();
          /* Oct 27 (Fable; Brandon: 7286 → 7285.3 on TX): a Yaesu shifts the dial by its CW / DATA offset when the MODE changes, after the
             frequency it was sent — so when the read-back sits more than 20 Hz off, send the frequency ONCE MORE and read again */
          if (r && r.khz && Math.abs(r.khz - khz) > 0.02) { try { await write(C[0]); await sleep(120); rbuf = []; await write(P.ask()); await sleep(260); const r3 = P.parse(String.fromCharCode(...rbuf), rbuf.slice()); if (r3 && r3.khz) { e.fixed = r3.khz; r = r3; } } catch (e2) {} }
          if (r && r.khz && Math.abs(r.khz - khz) > 0.05) say(`⚠ Asked for ${(khz / 1000).toFixed(4)} MHz, the radio says ${(r.khz / 1000).toFixed(4)} (${((r.khz - khz) * 1000).toFixed(0)} Hz off). Copy a builders' report now (STATION → Alerts & help).`, false);
          setTimeout(() => { read().then(r2 => { e.later = r2 && r2.khz; e.laterMode = r2 && r2.mode; if (r2 && r2.khz && Math.abs(r2.khz - khz) > 0.05 && !(r && r.khz && Math.abs(r.khz - khz) > 0.05)) console.warn('tune: asked ' + khz + ' ' + k + ', radio moved to ' + r2.khz + ' ' + (r2.mode || '') + ' within 3 s (scan? dial-follow? another tune?)'); }).catch(() => {}); }, 3000); } catch (e) {}
        return true; }
      catch (e) { const m = 'Radio did not answer: ' + (e.message || e); await disconnect(true); say(m, false); return false; }
    }).catch(() => false);
    return busy;
  }
  /* Oct 26 (Fable): set only the MODE, fast (no frequency, no read-back): the voice keyer / HOLD TO TALK put an SSB radio into DATA-U/L
     for the length of the transmission so the USB audio goes out (Brandon's FT-710: 'SSB no power out' = the radio's SSB MOD SOURCE is MIC;
     DATA MOD SOURCE = USB already works for FT8), then put the sideband back. */
  function mode(k, keep) {
    busy = busy.then(async () => {
      if (!await connect(false)) return false;
      k = kind(k, 0); lastMode = k; keep = +keep || 0;
      if (LINK() === 'fake') { await sleep(20); FAKE.mode = k; return true; }
      if (LINK() === 'flrig') { try { await FLRIG.call('rig.set_mode', [await FLRIG.modeFor(k)]); return true; } catch (e) { return false; } }
      const P = PROTOS[LINK() === 'rigctld' ? 'hamlib' : S.proto] || PROTOS.kenwood;
      try { const C = P.tune((lastRead && lastRead.khz) || 14000, k); for (const b of C.slice(1)) await write(b);
        if (keep > 100) { /* the dial must not move with the mode (Oct 27): check it 150 ms later, put it back when it did */
          await sleep(150); rbuf = []; await write(P.ask()); await sleep(200); const r = P.parse(String.fromCharCode(...rbuf), rbuf.slice());
          if (r && r.khz && Math.abs(r.khz - keep) > 0.02) { await write(P.tune(keep, k)[0]); MLOG.push({ at: new Date().toISOString().slice(11, 19), mode: k, was: keep, moved: r.khz }); if (MLOG.length > 8) MLOG.shift(); } }
        return true; } catch (e) { return false; }
    }).catch(() => false);
    return busy;
  }
  const MLOG = [];
  /* mode + frequency in ONE go, no read-back (the CW screen flips CW ⇄ DATA around every over: it has to be quick) */
  function tuneFast(khz, k) {
    khz = +khz; if (!S.on || !khz) return Promise.resolve(false);
    busy = busy.then(async () => {
      if (!await connect(false)) return false;
      k = sb(kind(k, khz), khz); lastMode = k;
      if (LINK() === 'fake') { await sleep(15); FAKE.khz = khz; FAKE.mode = k; return true; }
      if (LINK() === 'flrig') { try { await FLRIG.setFreqMode(khz, k); return true; } catch (e) { return false; } }
      const P = PROTOS[LINK() === 'rigctld' ? 'hamlib' : S.proto] || PROTOS.kenwood;
      try { const C = P.tune(khz, k); for (const b of C.slice(1)) await write(b); await write(C[0]); return true; } catch (e) { return false; }
    }).catch(() => false);
    return busy;
  }
  function read() {
    busy = busy.then(async () => {
      if (LINK() === 'fake') { if (!FAKE.on) return null; await sleep(30); return { khz: FAKE.khz, mode: FAKE.mode }; }
      if (LINK() === 'flrig') { if (!flrigOn) return null; try { return await FLRIG.get(); } catch (e) { flrigOn = false; return null; } }
      if (!port || !writer) return null; const P = PROTOS[LINK() === 'rigctld' ? 'hamlib' : S.proto] || PROTOS.kenwood;
      rbuf = []; try { await write(P.ask()); } catch (e) { return null; } await sleep(260);
      const raw = rbuf.slice(); const t = String.fromCharCode(...raw); return P.parse(t, raw);
    }).catch(() => null);
    return busy;
  }
  /* PTT for the FT8 tab in the KPC Logger (Brandon Oct 17). via: 'cat' (radio command), 'rts' / 'dtr' (serial line, e.g. Digirig), 'vox' (nothing sent) */
  /* ---- THE FRONT PANEL over CAT (Fable, Oct 22; Brandon: 'remote screen needs to be more like a real radio with filters, notch etc') ----
     extra(name, value): width (Hz), notch (0/1 auto notch), nb (0/1), nr (0/1), power (percent of full), mic (0-100).
     Set only (the panel remembers what it asked for); extras() lists what THIS radio family takes, so the panel hides the rest. */
  const YSH = { ssb: [200, 400, 600, 850, 1100, 1350, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2450, 2500, 2600, 2700, 2800, 2900, 3000, 3200], cw: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 800, 1200, 1400, 1700, 2000, 2400, 3000] };
  const near = (tab, hz) => { let b = 0; tab.forEach((v, i) => { if (Math.abs(v - hz) < Math.abs(tab[b] - hz)) b = i; }); return b + 1; };
  const pct255 = v => { const x = Math.round(Math.max(0, Math.min(100, v)) * 2.55), d = pad(x, 4); return [parseInt(d.slice(0, 2), 16), parseInt(d.slice(2), 16)]; };
  const EXTRA = {
    yaesu: { width: (hz, m) => [asc('SH0' + pad(near(/CW/.test(m) ? YSH.cw : YSH.ssb, hz), 2) + ';')], notch: on => [asc('BC0' + (on ? 1 : 0) + ';')], nb: on => [asc('NB0' + (on ? 1 : 0) + ';')], nr: on => [asc('NR0' + (on ? 1 : 0) + ';')], power: p => [asc('PC' + pad(Math.max(5, Math.min(100, p)), 3) + ';')], mic: v => [asc('MG' + pad(Math.max(0, Math.min(100, v)), 3) + ';')] },
    kenwood: { power: p => [asc('PC' + pad(Math.max(5, Math.min(100, p)), 3) + ';')], mic: v => [asc('MG' + pad(Math.max(0, Math.min(100, v)), 3) + ';')], nb: on => [asc('NB' + (on ? 1 : 0) + ';')], nr: on => [asc('NR' + (on ? 1 : 0) + ';')], notch: on => [asc('BC' + (on ? 1 : 0) + ';')], width: (hz, m) => S.model === 'elecraft' ? [asc('FW' + pad(Math.round(hz / 10), 4) + ';')] : null },
    icom: { width: (hz, m) => [icom([0x1A, 0x03, parseInt(pad(hz <= 500 ? Math.max(0, Math.round(hz / 50) - 1) : Math.min(49, 9 + Math.round((hz - 500) / 100)), 2), 16)])], notch: on => [icom([0x16, 0x41, on ? 1 : 0])], nb: on => [icom([0x16, 0x22, on ? 1 : 0])], nr: on => [icom([0x16, 0x40, on ? 1 : 0])], power: p => [icom([0x14, 0x0A, ...pct255(p)])], mic: v => [icom([0x14, 0x0B, ...pct255(v)])] },
    hamlib: { width: (hz, m) => [asc('M ' + (m || 'USB') + ' ' + Math.round(hz) + '\n')], notch: on => [asc('U ANF ' + (on ? 1 : 0) + '\n')], nb: on => [asc('U NB ' + (on ? 1 : 0) + '\n')], nr: on => [asc('U NR ' + (on ? 1 : 0) + '\n')], power: p => [asc('L RFPOWER ' + (Math.max(5, Math.min(100, p)) / 100).toFixed(2) + '\n')], mic: v => [asc('L MICGAIN ' + (Math.max(0, Math.min(100, v)) / 100).toFixed(2) + '\n')] }
  };
  /* Oct 26 (Brandon: 'tune button … real radio tuning'): start the radio's own antenna tuner. Yaesu AC002 (FT-710 / 991A / FTDX10 / 891 with an ATU),
     Kenwood AC111, Icom 0x1C 0x01 0x02, Hamlib vfo op TUNE. Elecraft / QRP kits: no (their tuners answer other commands or none). */
  EXTRA.yaesu.atu = () => [asc('AC002;')];
  EXTRA.kenwood.atu = () => S.model === 'elecraft' ? null : [asc('AC111;')];
  EXTRA.icom.atu = () => [icom([0x1C, 0x01, 0x02])];
  EXTRA.hamlib.atu = () => [asc('G TUNE\n')];
  EXTRA.yaesu8 = EXTRA.yaesu;
  /* ---- MORE CONTROLS (Nov 6, Opus; Brandon: 'make sure you do all the options for more radios than I own … it needs to work for many radios').
     The same command sets Hamlib / flrig / fldigi use, taken from each maker's CAT reference manual (Hamlib's code was not copied):
       shift (IF SHIFT / PBT, Hz ±1200) · nrl / nbl (NR / NB level 0–100 %) · agc ('off' 'fast' 'mid' 'slow' 'auto') · att (dB) · pre (0 = off / IPO, 1, 2)
       contour · apf · mnotch (manual notch on / off) + mnotchf (Hz) · split · rit · xit · ritoff (RIT / clarifier offset Hz, absolute; 0 = clear)
       swap (VFO A ⇄ B) · ab (A = B) · keyspd (wpm) · bkin (0 off, 1 semi, 2 full).
     CAPS below says which radio takes which, so the RADIO screen only shows what that radio understands. A radio not yet tried on the air
     with KPC says 'not checked on a real radio yet' (TESTED lists the ones that have been: Brandon's 'works on my radio' reports go there). */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
  const bcd4 = v => { const d = pad(clamp(v, 0, 9999), 4); return [parseInt(d.slice(0, 2), 16), parseInt(d.slice(2), 16)]; };
  const l255 = p => Math.round(clamp(p, 0, 100) * 2.55);
  const bcd1 = v => parseInt(pad(clamp(v, 0, 99), 2), 16);
  const DX10 = { ftdx10: 1, ftdx101: 1, ft710: 1, ftx1: 1 };      /* Yaesu's newest CAT: IS with the extra 0, ATT 6/12/18 dB steps, CLAR instead of RT/XT */
  const ysh = hz => { hz = Math.round(clamp(hz, -1200, 1200) / 20) * 20; const s = (hz < 0 ? '-' : '+') + pad(Math.abs(hz), 4); return asc((DX10[S.radio] ? 'IS00' : 'IS0') + s + ';'); };
  const YAGC = { off: 0, fast: 1, mid: 2, slow: 3, auto: 4 };
  const yatt = db => DX10[S.radio] ? Math.max(0, [0, 6, 12, 18].indexOf(+db)) : (+db > 0 ? 1 : 0);
  const MORE = {
    yaesu: { shift: hz => [ysh(hz)], nrl: p => [asc('RL0' + pad(1 + Math.round(clamp(p, 0, 100) / 100 * 14), 2) + ';')], nbl: p => [asc('NL0' + pad(Math.round(clamp(p, 0, 100) / 10), 3) + ';')],
      agc: a => YAGC[a] == null ? null : [asc('GT0' + YAGC[a] + ';')], att: db => [asc('RA0' + yatt(db) + ';')], pre: n => [asc('PA0' + clamp(n, 0, 2) + ';')],
      contour: on => [asc('CO0000' + (on ? '01' : '00') + ';')], apf: on => [asc('CO0200' + (on ? '01' : '00') + ';')],
      mnotch: on => [asc('BP0000' + (on ? 1 : 0) + ';')], mnotchf: hz => [asc('BP01' + pad(clamp(Math.round(hz / 10), 1, 320), 3) + ';')],
      split: on => [asc(on ? 'ST1;' : 'ST0;')], rit: on => [asc(on ? 'RT1;' : 'RT0;')], xit: on => [asc(on ? 'XT1;' : 'XT0;')],
      ritoff: hz => { hz = Math.round(clamp(hz, -9990, 9990)); return hz ? [asc('RC;'), asc((hz > 0 ? 'RU' : 'RD') + pad(Math.abs(hz), 4) + ';')] : [asc('RC;')]; },
      swap: () => [asc('SV;')], ab: () => [asc('AB;')], keyspd: w => [asc('KS' + pad(clamp(w, 4, 60), 3) + ';')], bkin: n => [asc('BI' + (n ? 1 : 0) + ';')] },
    kenwood: { nrl: p => [asc('RL' + pad(1 + Math.round(clamp(p, 0, 100) / 100 * 9), 2) + ';')], nbl: p => [asc('NL' + pad(1 + Math.round(clamp(p, 0, 100) / 100 * 9), 3) + ';')],
      agc: a => S.model === 'elecraft' ? (a === 'fast' ? [asc('GT002;')] : a === 'slow' ? [asc('GT004;')] : null) : ({ off: 0, slow: 1, mid: 2, fast: 3 }[a] == null ? null : [asc('GT' + { off: 0, slow: 1, mid: 2, fast: 3 }[a] + ';')]),
      att: db => (S.radio === 'ts890' || S.radio === 'ts990') ? [asc('RA' + Math.max(0, [0, 6, 12, 18].indexOf(+db)) + ';')] : [asc('RA0' + (+db > 0 ? 1 : 0) + ';')], pre: n => [asc('PA' + (n ? 1 : 0) + ';')],
      apf: on => [asc('AP' + (on ? 1 : 0) + ';')],
      split: on => S.model === 'elecraft' ? [asc(on ? 'FT1;' : 'FT0;')] : on ? [asc('FR0;'), asc('FT1;')] : [asc('FR0;'), asc('FT0;')],
      rit: on => [asc(on ? 'RT1;' : 'RT0;')], xit: on => [asc(on ? 'XT1;' : 'XT0;')],
      ritoff: hz => { hz = Math.round(clamp(hz, -9990, 9990)); if (S.model === 'elecraft' || !hz) return [asc('RC;')]; return [asc('RC;'), asc((hz > 0 ? 'RU' : 'RD') + pad(Math.abs(hz), 5) + ';')]; },
      ab: () => [asc('VV;')], keyspd: w => [asc('KS' + pad(clamp(w, 4, 60), 3) + ';')] },
    icom: { shift: hz => { const l = Math.round(clamp(128 + clamp(hz, -1200, 1200) / 1200 * 127, 0, 255)); return [icom([0x14, 0x07, ...bcd4(l)]), icom([0x14, 0x08, ...bcd4(l)])]; },
      nrl: p => [icom([0x14, 0x06, ...bcd4(l255(p))])], nbl: p => [icom([0x14, 0x12, ...bcd4(l255(p))])],
      agc: a => a === 'off' ? [icom([0x1A, 0x04, 0x00])] : { fast: 1, mid: 2, slow: 3 }[a] ? [icom([0x16, 0x12, { fast: 1, mid: 2, slow: 3 }[a]])] : null,
      att: db => [icom([0x11, bcd1(db)])], pre: n => [icom([0x16, 0x02, clamp(n, 0, 2)])], apf: on => [icom([0x16, 0x32, on ? 1 : 0])],
      mnotch: on => [icom([0x16, 0x48, on ? 1 : 0])], mnotchf: hz => [icom([0x14, 0x0D, ...bcd4(Math.round(clamp((hz - 200) / 2800, 0, 1) * 255))])],
      split: on => [icom([0x0F, on ? 1 : 0])], rit: on => [icom([0x21, 0x01, on ? 1 : 0])], xit: on => [icom([0x21, 0x02, on ? 1 : 0])],
      ritoff: hz => { hz = Math.round(clamp(hz, -9999, 9999)); const a = Math.abs(hz), d = pad(a, 4); return [icom([0x21, 0x00, parseInt(d.slice(2), 16), parseInt(d.slice(0, 2), 16), hz < 0 ? 1 : 0])]; },
      swap: () => [icom([0x07, 0xB0])], ab: () => [icom([0x07, 0xA0])],
      keyspd: w => [icom([0x14, 0x0C, ...bcd4(Math.round((clamp(w, 6, 48) - 6) / 42 * 255))])], bkin: n => [icom([0x16, 0x47, clamp(n, 0, 2)])] },
    hamlib: { shift: hz => [asc('L IF ' + Math.round(clamp(hz, -1200, 1200)) + '\n')], nrl: p => [asc('L NR ' + (clamp(p, 0, 100) / 100).toFixed(2) + '\n')], nbl: p => [asc('L NB ' + (clamp(p, 0, 100) / 100).toFixed(2) + '\n')],
      agc: a => ({ off: 0, fast: 2, mid: 5, slow: 3, auto: 6 }[a] == null ? null : [asc('L AGC ' + { off: 0, fast: 2, mid: 5, slow: 3, auto: 6 }[a] + '\n')]),
      att: db => [asc('L ATT ' + Math.round(+db || 0) + '\n')], pre: n => [asc('L PREAMP ' + clamp(n, 0, 2) * 10 + '\n')], apf: on => [asc('U APF ' + (on ? 1 : 0) + '\n')],
      mnotch: on => [asc('U MN ' + (on ? 1 : 0) + '\n')], mnotchf: hz => [asc('L NOTCHF ' + Math.round(hz) + '\n')],
      split: on => [asc(on ? 'S 1 VFOB\n' : 'S 0 VFOA\n')], rit: on => [asc('U RIT ' + (on ? 1 : 0) + '\n')], xit: on => [asc('U XIT ' + (on ? 1 : 0) + '\n')], ritoff: hz => [asc('J ' + Math.round(hz) + '\n')],
      swap: () => [asc('G XCHG\n')], ab: () => [asc('G CPY\n')], keyspd: w => [asc('L KEYSPD ' + Math.round(clamp(w, 4, 60)) + '\n')], bkin: n => [asc('U FBKIN ' + (n === 2 ? 1 : 0) + '\n'), asc('U SBKIN ' + (n === 1 ? 1 : 0) + '\n')] }
  };
  MORE.yaesu8 = Object.assign({}, MORE.yaesu, { split: on => [asc(on ? 'FT3;' : 'FT2;')] });
  EXTRA.yaesu8 = Object.assign({}, EXTRA.yaesu);   /* its own copy now: the old ones split with FT3 / FT2 */
  Object.keys(MORE).forEach(p => { EXTRA[p] = Object.assign(EXTRA[p] || {}, MORE[p]); });
  /* which radio takes which (the radio list's id → what to leave out, and the choices its AGC / ATT / PRE knobs have) */
  const ALLK = ['shift', 'nrl', 'nbl', 'agc', 'att', 'pre', 'contour', 'apf', 'mnotch', 'mnotchf', 'split', 'rit', 'xit', 'ritoff', 'swap', 'ab', 'keyspd', 'bkin'];
  const ICOM_NEW = { ic7300: 1, ic705: 1, ic9700: 1, ic7610: 1, ic905: 1, ic7851: 1 };
  const ICOM_PRE2 = { ic7300: 1, ic7610: 1, ic7851: 1, ic7100: 1, ic756: 1, ic7600: 1, ic7700: 1, ic7800: 1, ic7410: 1 };
  const ICOM_ATT = { ic7610: [0, 6, 12, 18], ic7851: [0, 6, 12, 18], ic7800: [0, 6, 12, 18], ic7700: [0, 6, 12, 18], ic756: [0, 6, 12, 18], ic9700: [0, 10], ic905: [0, 10] };
  function caps(id) {
    id = id == null ? S.radio : id; const r = RADIO[id] || { proto: S.proto, model: S.model };
    const L = LINK(), pr = L === 'rigctld' ? 'hamlib' : L === 'flrig' ? 'flrig' : L === 'fake' ? 'fake' : r.proto;
    let out = [], agc = [], att = [], pre = [];
    if (pr === 'fake' || pr === 'hamlib') { out = ALLK.slice(); agc = ['off', 'fast', 'mid', 'slow', 'auto']; att = [0, 6, 12, 18]; pre = [0, 1, 2]; }
    else if (pr === 'yaesu' || pr === 'yaesu8') {
      out = ALLK.filter(k => !(DX10[id] && (k === 'rit' || k === 'xit')));
      agc = ['off', 'fast', 'mid', 'slow', 'auto']; att = DX10[id] ? [0, 6, 12, 18] : [0, 12]; pre = (id === 'ft891' || id === 'ft450') ? [0, 1] : [0, 1, 2];
    } else if (pr === 'icom') {
      if (r.model === 'xiegu') { out = ['split', 'swap', 'ab', 'att', 'pre']; att = [0, 20]; pre = [0, 1]; }
      else {
        const old = !ICOM_NEW[id] && id !== 'ic7100';
        const mn = ICOM_NEW[id] || /^ic(7100|7600|7700|7800|7410|756)$/.test(id);
        out = ALLK.filter(k => k !== 'contour' && !(old && ['rit', 'xit', 'ritoff', 'apf'].includes(k)) && !(id === 'ic718' && k === 'shift') && !(!mn && (k === 'mnotch' || k === 'mnotchf')));
        agc = ICOM_NEW[id] ? ['off', 'fast', 'mid', 'slow'] : ['fast', 'mid', 'slow']; att = ICOM_ATT[id] || [0, 20]; pre = ICOM_PRE2[id] ? [0, 1, 2] : [0, 1];
      }
    } else if (pr === 'kenwood') {
      if (r.model === 'elecraft') { out = ['agc', 'att', 'pre', 'apf', 'split', 'rit', 'xit', 'ritoff', 'keyspd']; agc = ['fast', 'slow']; att = [0, 10]; pre = [0, 1]; }
      else if (id === 'ts590') { out = ['nrl', 'nbl', 'att', 'pre', 'split', 'rit', 'xit', 'ritoff', 'ab', 'keyspd']; att = [0, 12]; pre = [0, 1]; }
      else if (id === 'ts890' || id === 'ts990') { out = ['agc', 'att', 'pre', 'split', 'rit', 'xit', 'ritoff', 'ab', 'keyspd']; agc = ['off', 'slow', 'mid', 'fast']; att = [0, 6, 12, 18]; pre = [0, 1]; }
      else if (/^ts(480|2000|570)$/.test(id)) { out = ['att', 'pre', 'split', 'rit', 'xit', 'ritoff', 'keyspd']; att = [0, 12]; pre = [0, 1]; }
      else if (id === 'flex') { out = ['split', 'rit', 'xit', 'ritoff', 'keyspd']; }
      else if (/^(qmx|qdx|qcx|trusdx|tx500|discovery)$/.test(id)) { out = ['split', 'keyspd']; }
    }
    return { keys: out, agc, att, pre, tested: TESTED[id] || null, id, proto: pr };
  }
  /* radios tried on the air with these controls (Brandon's 'works on my radio' reports go in here: id → { by, date, ok: [...], bad: [...] }) */
  const TESTED = {};
  function cmdText(name, value) { const E = EXTRA[LINK() === 'rigctld' ? 'hamlib' : S.proto] || {}; if (!E[name]) return null; const c = E[name](value, lastMode); if (!c) return null;
    return c.map(b => S.proto === 'icom' && LINK() !== 'rigctld' ? [...b].map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ') : new TextDecoder().decode(b)).join(' | '); }
  const FLX = { power: p => FLRIG.call('rig.set_power', [Math.max(5, Math.min(100, Math.round(p)))]), mic: v => FLRIG.call('rig.set_micgain', [Math.max(0, Math.min(100, Math.round(v)))]), notch: on => FLRIG.call('rig.set_notch', [on ? 1 : 0]) };
  /* ---- METERS + RADIO POWER (Brandon Oct 24: 'always show ALC, with power up and down; radio power on and off' on the remote) ----
     meters() -> { alc: 0-100, po: 0-100 (of the meter scale), swr: 0-100, pwr: set power % } or null when this radio family cannot say.
     Yaesu: RM4 (ALC) RM5 (PO) RM6 (SWR) 0-255 + PC; · Kenwood: PC; only · hamlib: \get_level · Icom: 0x15 sub-meters 0-255 · fake: made up. */
  const M255 = v => Math.round(Math.max(0, Math.min(255, v)) / 2.55);
  /* Oct 26 (Brandon: 'add S meter and selectable digital and analog meters'): the S meter as dB over S9 (S9 = 0, S1 = −48, 6 dB a unit),
     from the radio's own scale: Yaesu RM1 / Icom 0x15 0x02 = 0–255 with S9 ≈ 120 and S9+60 ≈ 241; Kenwood SM0 = 0–30 with S9 = 15;
     hamlib STRENGTH is already dB over S9; flrig smeter 0–100 (×2.55). COMP / IDD / VDD where Yaesu gives them (RM3 / RM7 / RM8, 0–100 %). */
  const sdb = (v, s9, top) => v == null || !isFinite(v) ? null : v <= s9 ? Math.round((v / s9 * 9 - 9) * 6) : Math.round((v - s9) / (top - s9) * 60);
  let PTTW = 0;
  function meters() {
    if (!S.on) return Promise.resolve(null);
    busy = busy.then(async () => {
      if (PTTW) return null;
      const L = LINK();
      if (L === 'fake') { if (!FAKE.on) return null; const tx = !!(window.KPCApp && KPCApp.txing && KPCApp.txing()); return { s: tx ? null : Math.round(-18 + Math.random() * 30), alc: tx ? 30 + Math.round(Math.random() * 20) : 0, po: tx ? 70 + Math.round(Math.random() * 10) : 0, swr: tx ? 12 : 0, comp: tx ? 20 : 0, idd: tx ? 55 : 8, vdd: 54, pwr: FAKE.pwr || 100 }; }
      if (L === 'flrig') { if (!flrigOn) return null; try { const pw = await FLRIG.call('rig.get_power', []); let sm = null; try { sm = sdb(+(await FLRIG.call('rig.get_smeter', [])) * 2.55, 120, 241); } catch (e) {} return { s: sm, alc: null, po: null, swr: null, pwr: +pw || null }; } catch (e) { return null; } }
      if (!port || !writer || connecting) return null;   /* Nov 6 (Opus, found by the scope tests): a meter read DURING CONNECT's probe emptied rbuf under it → 'the radio does not answer there' */
      const pr = L === 'rigctld' ? 'hamlib' : S.proto;
      try {
        if (pr === 'yaesu' || pr === 'yaesu8') { rbuf = []; await write(asc('RM1;RM3;RM4;RM5;RM6;RM7;RM8;PC;')); await sleep(260); const t = String.fromCharCode(...rbuf); const g = k => { const m = new RegExp(k + '(\\d{3})(?:\\d{3})?;').exec(t); return m ? M255(+m[1]) : null; }, pc = /PC(\d{3});/.exec(t);   /* Oct 25: the FT-710 / FTDX10 answer 'RM4120000;' (value + three fixed zeros): the old 3-digit match never fitted, so the bars stayed empty */ const raw = k => { const m = new RegExp(k + '(\\d{3})(?:\\d{3})?;').exec(t); return m ? +m[1] : null; }; return { s: sdb(raw('RM1'), 120, 241), comp: g('RM3'), alc: g('RM4'), po: g('RM5'), swr: g('RM6'), idd: g('RM7'), vdd: g('RM8'), pwr: pc ? +pc[1] : null }; }
        if (pr === 'kenwood') { rbuf = []; await write(asc('SM0;PC;')); await sleep(220); const t = String.fromCharCode(...rbuf), pc = /PC(\d{3});/.exec(t), sm = /SM0(\d{4});/.exec(t); return { s: sm ? sdb(+sm[1], 15, 30) : null, alc: null, po: null, swr: null, pwr: pc ? +pc[1] : null }; }
        if (pr === 'hamlib') { rbuf = []; await write(asc('\\get_level ALC\n\\get_level SWR\n\\get_level RFPOWER\n\\get_level STRENGTH\n')); await sleep(340); const t = String.fromCharCode(...rbuf).split(/\s+/).map(Number).filter(x => isFinite(x)); return { s: t[3] != null ? Math.round(t[3]) : null, alc: t[0] != null ? Math.round(Math.min(100, t[0] * 100)) : null, po: null, swr: t[1] != null ? Math.round(Math.min(100, (t[1] - 1) * 50)) : null, pwr: t[2] != null ? Math.round(t[2] * 100) : null }; }
        if (pr === 'icom') { const one = async sub2 => { if (PTTW) return null; rbuf = []; await write(icom([0x15, sub2])); await sleep(180); const r = rbuf.slice(); const i = r.lastIndexOf(0xFD); if (i < 6) return null; const d = r.slice(0, i); const hi = d[d.length - 2], lo = d[d.length - 1]; const v = (hi >> 4) * 1000 + (hi & 15) * 100 + (lo >> 4) * 10 + (lo & 15); return M255(v); }; const sRaw = async () => { rbuf = []; await write(icom([0x15, 0x02])); await sleep(180); const r = rbuf.slice(), i = r.lastIndexOf(0xFD); if (i < 6) return null; const d = r.slice(0, i), hi = d[d.length - 2], lo = d[d.length - 1]; return (hi >> 4) * 1000 + (hi & 15) * 100 + (lo >> 4) * 10 + (lo & 15); };
          return { s: sdb(await sRaw(), 120, 241), alc: await one(0x13), po: await one(0x11), swr: await one(0x12), comp: await one(0x14), idd: await one(0x16), vdd: await one(0x15), pwr: null }; }
      } catch (e) { return null; }
      return null;
    }).catch(() => null);
    return busy;
  }
  /* Nov 1 (Brandon: 'cw decoder broken … loud and not decoding'): with the radio IN CW mode the station sounds at the RADIO's
     CW pitch, so the decoder must listen there. cwPitch() → Hz or null. Yaesu KP (00-75 = 300-1050 Hz in 10s: FT-710 / 991A /
     DX10 / DX101 / 891), Icom 0x14 0x09 (0-255 = 300-900 Hz), Hamlib CWPITCH, the pretend radio 600. */
  function cwPitch() {
    if (!S.on) return Promise.resolve(null);
    busy = busy.then(async () => {
      const L = LINK();
      if (L === 'fake') return FAKE.on ? 600 : null;
      if (L === 'flrig' || !port || !writer) return null;
      const pr = L === 'rigctld' ? 'hamlib' : S.proto;
      try {
        if (pr === 'yaesu' || pr === 'yaesu8') { rbuf = []; await write(asc('KP;')); await sleep(200); const m = /KP(\d{2});/.exec(String.fromCharCode(...rbuf)); return m ? 300 + 10 * +m[1] : null; }
        if (pr === 'icom') { rbuf = []; await write(icom([0x14, 0x09])); await sleep(180); const r = rbuf.slice(); const i = r.lastIndexOf(0xFD); if (i < 6) return null; const hi = r[i - 2], lo = r[i - 1]; const v = (hi >> 4) * 1000 + (hi & 15) * 100 + (lo >> 4) * 10 + (lo & 15); return v >= 0 && v <= 255 ? Math.round(300 + 600 * v / 255) : null; }
        if (pr === 'hamlib') { rbuf = []; await write(asc('\\get_level CWPITCH\n')); await sleep(250); const v = parseFloat(String.fromCharCode(...rbuf)); return v > 200 && v < 1500 ? Math.round(v) : null; }
      } catch (e) { return null; }
      return null;
    }).catch(() => null);
    return busy;
  }
  /* radio on / off over CAT. Off always works; ON works only when the radio listens while off (Yaesu/Kenwood: the CAT port stays awake on most USB radios; Icom needs the 0xFE wake-up string). */
  function power(on) {
    if (!S.on) return Promise.resolve(false);
    busy = busy.then(async () => {
      const L = LINK();
      if (L === 'fake') { FAKE.on = !!on; await sleep(60); return true; }
      if (L === 'flrig') { try { await FLRIG.call('rig.set_power_on', [on ? 1 : 0]); return true; } catch (e) { return false; } }
      if (!port || !writer) { if (!await connect(false)) return false; }
      const pr = L === 'rigctld' ? 'hamlib' : S.proto;
      try {
        if (pr === 'yaesu' || pr === 'yaesu8' || pr === 'kenwood') { if (on) { await write(asc('PS1;')); await sleep(1200); } await write(asc(on ? 'PS1;' : 'PS0;')); return true; }
        if (pr === 'hamlib') { await write(asc('\\set_powerstat ' + (on ? 1 : 0) + '\n')); return true; }
        if (pr === 'icom') { if (on) { const wake = new Uint8Array(150).fill(0xFE); await writer.write(wake); await sleep(50); } await write(icom([0x18, on ? 1 : 0])); return true; }
      } catch (e) { return false; }
      return false;
    }).catch(() => false);
    return busy;
  }
  function extras() {
    if (LINK() === 'flrig') return Object.keys(FLX);
    if (LINK() === 'fake') return ['width', 'notch', 'nb', 'nr', 'power', 'mic', 'atu'].concat(ALLK);
    const E = EXTRA[LINK() === 'rigctld' ? 'hamlib' : S.proto] || {}, C = caps(); return Object.keys(E).filter(k => !(k === 'width' && S.proto === 'kenwood' && S.model !== 'elecraft') && !(k === 'atu' && (S.model === 'elecraft' || S.model === 'xiegu')) && (!ALLK.includes(k) || C.keys.includes(k)));
  }
  let lastMode = '';
  function extra(name, value) {
    busy = busy.then(async () => {
      if (!await connect(false)) return false;
      if (LINK() === 'fake') { await sleep(40); return true; }
      if (LINK() === 'flrig') { if (!FLX[name]) return false; try { await FLX[name](value); return true; } catch (e) { return false; } }
      const E = EXTRA[LINK() === 'rigctld' ? 'hamlib' : S.proto]; if (!E || !E[name]) return false;
      const cmds = E[name](value, lastMode); if (!cmds) return false;
      try { for (const b of cmds) await write(b); return true; } catch (e) { return false; }
    }).catch(() => false);
    return busy;
  }
  const PTTC = { kenwood: on => [asc(on ? 'TX;' : 'RX;')], yaesu: on => [asc(on ? 'TX1;' : 'TX0;')], yaesu8: on => [asc(on ? 'TX1;' : 'TX0;')], yaesuold: on => [new Uint8Array([0, 0, 0, 0, on ? 0x08 : 0x88])], icom: on => [icom([0x1C, 0x00, on ? 1 : 0])] };
  function ptt(on, via) {
    via = via || S.ptt || 'cat'; if (via === 'vox') return Promise.resolve(true);
    PTTW++;   /* Nov 8 (Brandon: 'key is little delayed'): a waiting PTT makes the queued meter reads step aside */
    busy = busy.then(async () => {
      PTTW = Math.max(0, PTTW - 1);
      if (!await connect(false)) { say('Radio not connected, so no PTT. Connect it, or use VOX.', false); return false; }
      if (LINK() === 'fake') { FAKE.ptt = !!on; return true; }
      if (LINK() === 'flrig') { try { await FLRIG.ptt(!!on); return true; } catch (e) { say('flrig PTT did not work: ' + (e.message || e), false); return false; } }
      if (LINK() === 'rigctld') { try { await write(asc('T ' + (on ? 1 : 0) + '\n')); return true; } catch (e) { say('rigctld PTT did not work: ' + (e.message || e), false); return false; } }
      try { if (via === 'rts' || via === 'dtr') { await port.setSignals(via === 'rts' ? { requestToSend: !!on } : { dataTerminalReady: !!on }); return true; }
        for (const b of (PTTC[S.proto] || PTTC.kenwood)(!!on)) await write(b); return true; }
      catch (e) { say('PTT did not work: ' + (e.message || e), false); return false; }
    }).catch(() => false);
    return busy;
  }
  /* ---- CW from the keyboard (Brandon Oct 17: 'cw keyboard to cw') ----
     The radio's own keyer sends the text: Kenwood / Elecraft / QRP Labs 'KY text;', Icom CI-V 0x17. Yaesu radios can't take free text
     over CAT, so for them (or anything else) the page keys the DTR or RTS line itself (Digirig etc.: DTR = key). */
  /* Oct 27 (Fable, from POTACAT's rig table + code, checked against its FT-710 entry): the newer Yaesu (FT-710, FT-991A, FTDX10, FTX-1) DO take
     typed CW over CAT — `KY0 <text padded to 48>;` (immediate; up to 48 a chunk), speed `KS###;`; the FTDX101 wants KM5 + KYA. Not the
     8-digit / old ones. 'KY only plays memories' (0.7.1) was wrong for these. */
  const YKY = { ft710: 1, ft991: 1, ftdx10: 1, ftx1: 1, ft891: 1, ft450: 1, ft2000: 1, ftdx3000: 1, ftdx101: 2 };   /* POTACAT's table: FT-450 / 2000 / DX3000 / 891 too */
  const CWOK = { kenwood: 1, icom: 1 };
  const yky = () => (S.proto === 'yaesu' || S.proto === 'yaesu8') && YKY[S.radio] || 0;
  function cwCan() { return !!CWOK[S.proto] || !!yky(); }
  async function cwSpeed(wpm) { wpm = Math.max(6, Math.min(48, Math.round(wpm)));
    if (S.proto === 'kenwood' || yky()) await write(asc('KS' + pad(wpm, 3) + ';'));
    if (S.proto === 'icom') { const lv = Math.round((wpm - 6) / 42 * 255), d = pad(lv, 4); await write(icom([0x14, 0x0C, parseInt(d.slice(0, 2), 16), parseInt(d.slice(2), 16)])); } }
  function cw(text, wpm) {
    text = String(text || '').toUpperCase().replace(/[^A-Z0-9 /?.,=+\-]/g, '');
    busy = busy.then(async () => {
      if (!await connect(false)) { say('Radio not connected.', false); return false; }
      if (!cwCan()) { say('This radio type can\'t take typed CW over CAT: use the DTR or RTS key line, or audio.', false); return false; }
      try { if (wpm) await cwSpeed(wpm);
        if (yky() === 2) { for (let i = 0; i < text.length; i += 50) { await write(asc('KM5' + text.slice(i, i + 50) + ';')); await write(asc('KYA;')); } }
        else if (yky()) { for (let i = 0; i < text.length; i += 48) await write(asc('KY0 ' + text.slice(i, i + 48).padEnd(48, ' ') + ';')); }
        else if (S.proto === 'kenwood') { for (let i = 0; i < text.length; i += 24) await write(asc('KY ' + text.slice(i, i + 24).padEnd(24, ' ') + ';')); }
        else { for (let i = 0; i < text.length; i += 30) await write(icom([0x17, ...asc(text.slice(i, i + 30))])); }
        return true; }
      catch (e) { say('CW did not send: ' + (e.message || e), false); return false; }
    }).catch(() => false);
    return busy;
  }
  async function cwStop() { try { if (!port || !writer) return; if (yky()) await write(asc('KY0 ;TX0;')); else if (S.proto === 'kenwood') await write(asc('RX;'));
    if (S.proto === 'icom') await write(icom([0x17, 0xFF])); } catch (e) {} }
  /* ---- THE KEY PORT (Fable, Oct 25; Brandon's FT-710: 'never keys up in DTR or RTS') ----
     A Yaesu with two USB serial ports (FT-710, FT-991A, FTDX10/101) takes CW keying on its SECOND port (Windows: 'Standard COM Port';
     radio menu USB KEYING (CW) = DTR, CW BK-IN = ON), not on the CAT port the app talks on. A one-port cable (Digirig, SignaLink-type)
     keys on the CAT port itself. S.keyPort: '' = find the radio's second port by itself (same USB maker + product as the CAT port,
     not the CAT port), 'cat' = the CAT port, or a port key picked by hand. The key port is opened with both lines DOWN (key up) and
     stays open while the app runs. Android's plugin opens one port at a time, so there the CAT port is used (as before). */
  let kport = null, kportWhy = '';
  const sameUsb = (a, b) => { const fa = (a.getInfo && a.getInfo()) || {}, fb = (b.getInfo && b.getInfo()) || {}; return fa.usbVendorId != null && fa.usbVendorId === fb.usbVendorId && (fa.usbProductId || 0) === (fb.usbProductId || 0); };
  async function keyPortOpen() {
    if (kport) return kport;
    if (NAT() || LINK() !== 'serial' || S.keyPort === 'cat') { kportWhy = 'the CAT port'; return null; }
    let ps = []; try { ps = await allPorts(); } catch (e) { kportWhy = 'no port list'; return null; }
    let p = null;
    if (S.keyPort) p = ps.find(x => keyOf(x) === S.keyPort) || null;
    else if (port) { const others = ps.filter(x => x !== port && !x.isTcp && sameUsb(x, port)); p = others[0] || null; }
    if (!p) { kportWhy = S.keyPort ? 'the picked key port is not plugged in' : 'no second port found: using the CAT port'; return null; }
    try { await withTimeout(p.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }), 4000, 'the key port did not open in 4 s'); await p.setSignals({ dataTerminalReady: false, requestToSend: false }); kport = p; kportWhy = ''; say('CW key port open (the radio\'s second port).', true); return kport; }
    catch (e) { kportWhy = 'the key port did not open: ' + (e.message || e); try { await p.close(); } catch (e2) {} return null; }
  }
  async function keyPortClose() { if (!kport) return; try { await kport.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {} try { await kport.close(); } catch (e) {} kport = null; }
  async function pickKeyPort() {
    try { const p = await askPort(); if (!p) return false; await keyPortClose(); S.keyPort = keyOf(p); SV('kpcCat', S); return !!(await keyPortOpen()); } catch (e) { return false; }
  }
  const keyPortInfo = () => ({ open: !!kport, which: kport ? 'second port' : (S.keyPort === 'cat' || NAT() ? 'CAT port' : kportWhy || 'not opened yet'), setting: S.keyPort || '' });
  /* key a serial line on and off (true = key down): the key port when there is one, else the CAT port */
  async function keyLine(down, line) {
    const kp = kport || await keyPortOpen() || port; if (!kp) return false;
    try { await kp.setSignals(line === 'rts' ? { requestToSend: !!down } : { dataTerminalReady: !!down }); return true; } catch (e) { if (kp === kport) { kport = null; } return false; }
  }

  /* every radio we know how to talk to (Brandon Oct 17: 'add all radios it can run cat on'); [id, label, proto, baud, CI-V, model] */
  const RADIOS = [
    ['Icom', [['ic705', 'IC-705', 'icom', 115200, 'A4'], ['ic7300', 'IC-7300', 'icom', 115200, '94'], ['ic7610', 'IC-7610', 'icom', 115200, '98'], ['ic9700', 'IC-9700', 'icom', 115200, 'A2'], ['ic905', 'IC-905', 'icom', 115200, 'AC'],
      ['ic7100', 'IC-7100', 'icom', 19200, '88'], ['ic7851', 'IC-7851', 'icom', 19200, '8E'], ['ic7800', 'IC-7800', 'icom', 19200, '6A'], ['ic7700', 'IC-7700', 'icom', 19200, '74'], ['ic7600', 'IC-7600', 'icom', 19200, '7A'],
      ['ic7410', 'IC-7410', 'icom', 19200, '80'], ['ic7200', 'IC-7200', 'icom', 19200, '76'], ['ic9100', 'IC-9100', 'icom', 19200, '7C'], ['ic7000', 'IC-7000', 'icom', 19200, '70'], ['ic746', 'IC-746 / 746PRO', 'icom', 19200, '66'],
      ['ic756', 'IC-756PRO III', 'icom', 19200, '6E'], ['ic718', 'IC-718', 'icom', 9600, '5E'], ['ic703', 'IC-703', 'icom', 9600, '68']]],
    ['Yaesu', [['ftx1', 'FTX-1', 'yaesu', 38400], ['ft710', 'FT-710', 'yaesu', 38400], ['ft891', 'FT-891', 'yaesu', 38400], ['ft991', 'FT-991 / 991A', 'yaesu', 38400], ['ftdx10', 'FTDX10', 'yaesu', 38400], ['ftdx101', 'FTDX101D / MP', 'yaesu', 38400],
      ['ftdx3000', 'FTDX3000', 'yaesu8', 38400], ['ftdx1200', 'FTDX1200', 'yaesu8', 38400], ['ftdx5000', 'FTDX5000', 'yaesu8', 38400], ['ft950', 'FT-950', 'yaesu8', 38400], ['ft2000', 'FT-2000', 'yaesu8', 38400], ['ft450', 'FT-450 / 450D', 'yaesu8', 38400],
      ['ft818', 'FT-818', 'yaesuold', 9600], ['ft817', 'FT-817', 'yaesuold', 9600], ['ft857', 'FT-857', 'yaesuold', 9600], ['ft897', 'FT-897', 'yaesuold', 9600]]],
    ['Kenwood', [['ts990', 'TS-990', 'kenwood', 115200], ['ts890', 'TS-890', 'kenwood', 115200], ['ts590', 'TS-590S / SG', 'kenwood', 115200], ['ts480', 'TS-480', 'kenwood', 57600], ['ts2000', 'TS-2000', 'kenwood', 57600], ['ts570', 'TS-570', 'kenwood', 57600]]],
    ['Elecraft', [['kx2', 'KX2', 'kenwood', 38400, '', 'elecraft'], ['kx3', 'KX3', 'kenwood', 38400, '', 'elecraft'], ['k4', 'K4', 'kenwood', 38400, '', 'elecraft'], ['k3', 'K3 / K3S', 'kenwood', 38400, '', 'elecraft'], ['k2', 'K2', 'kenwood', 4800, '', 'elecraft'], ['kh1', 'KH1', 'kenwood', 38400, '', 'elecraft']]],
    ['Xiegu (CI-V)', [['g90', 'G90', 'icom', 19200, '70', 'xiegu'], ['x6100', 'X6100', 'icom', 19200, '70', 'xiegu'], ['x6200', 'X6200', 'icom', 19200, '70', 'xiegu'], ['g106', 'G106', 'icom', 19200, '70', 'xiegu'], ['x5105', 'X5105', 'icom', 19200, '70', 'xiegu']]],
    ['QRP Labs & kits', [['qmx', 'QMX / QMX+', 'kenwood', 115200], ['qdx', 'QDX', 'kenwood', 115200], ['qcx', 'QCX / QCX mini (CAT)', 'kenwood', 38400], ['trusdx', '(tr)uSDX', 'kenwood', 115200]]],
    ['Others', [['tx500', 'Lab599 TX-500', 'kenwood', 9600], ['discovery', 'Lab599 Discovery TX-500MP', 'kenwood', 9600], ['flex', 'FlexRadio (SmartSDR CAT port)', 'kenwood', 9600]]]
  ];
  const RADIO = {}; RADIOS.forEach(([g, L]) => L.forEach(r => { RADIO[r[0]] = { id: r[0], label: g.split(' ')[0] + ' ' + r[1], proto: r[2], baud: r[3], civ: r[4] || '', model: r[5] || '' }; }));
  /* fill a <select> with every radio; pick(id) sets the right settings */
  function fillSelect(sel) { if (!sel) return; const cur = S.radio || '';
    sel.innerHTML = '<option value="">Pick your radio…</option>' + RADIOS.map(([g, L]) => `<optgroup label="${g}">` + L.map(r => `<option value="${r[0]}"${r[0] === cur ? ' selected' : ''}>${(g === 'QRP Labs & kits' || g === 'Others') ? '' : g.split(' ')[0] + ' '}${r[1]}</option>`).join('') + '</optgroup>').join('') + '<option value="other">Something else (pick the settings by hand)</option>'; }
  function pickRadio(id) { const r = RADIO[id]; if (!r) { S.radio = id; SV('kpcCat', S); return null; } S = Object.assign({}, S, { radio: id, proto: r.proto, baud: r.baud, civ: r.civ || S.civ || '94', model: r.model, data: DATAOK(r) ? 'data' : 'usb' }); SV('kpcCat', S); return r; }

  function follow(fn) {
    if (fol) clearInterval(fol); fol = null; if (!fn) return; let last = '';
    fol = setInterval(async () => { if (!S.on || !S.follow || !port || document.hidden) return; const r = await read(); if (!r) return; const k = r.khz + '|' + r.mode; if (k !== last) { last = k; fn(r); } }, 2000);
  }
  /* change the port (Brandon Oct 17: 'a menu to change port if someone selects the wrong one') */
  const VEND = { 0x10C4: 'Silicon Labs CP210x (Icom, Yaesu, Xiegu, Elecraft cables)', 0x0403: 'FTDI (many CAT cables)', 0x067B: 'Prolific (older CAT cables)', 0x1A86: 'CH340 (QRP Labs, truSDX, cheap cables)', 0x0483: 'STMicro (QMX/QDX)', 0x2341: 'Arduino', 0x239A: 'Adafruit', 0x2E8A: 'Raspberry Pi Pico', 0x1FC9: 'NXP', 0x04D8: 'Microchip' };
  async function ports() {
    const ps = await allPorts();
    const NK = (() => { try { return JSON.parse(localStorage.getItem('kpcPortNick') || '{}'); } catch (e) { return {}; } })();   /* Oct 26: my own name for a port ('FT-710 shack') */
    return ps.map((p, i) => { const r = portRow(p, i); const nk = NK[keyOf(p)]; if (nk) { r.nick = nk; r.label = '★ ' + nk + ' · ' + r.label; } return r; });
  }
  function portRow(p, i) {
    { const f = (p.getInfo && p.getInfo()) || {}, v = f.usbVendorId;
      if (f.name) return { i, now: p === port, label: f.name + (f.chip ? ' · ' + f.chip : '') };
      if (window.KPCApp && KPCApp.portLabel && !NAT()) { const l = KPCApp.portLabel(p, i); if (!/USB port \d|COM port \d/.test(l)) return { i, now: p === port, label: l.replace(/^\S+ /, '') }; }
      return { i, now: p === port, label: (v != null ? (VEND[v] || 'USB maker ' + v.toString(16).toUpperCase().padStart(4, '0')) : 'Serial port') + (f.usbProductId != null ? ' · product ' + f.usbProductId.toString(16).toUpperCase().padStart(4, '0') : '') + (f.usbInterface != null ? (f.usbInterface === 0 ? ' · port 1 (CAT)' : ' · port ' + (f.usbInterface + 1) + ' (PTT / keying)') : '') }; }
  }
  async function usePort(i) { await disconnect(); const ps = await allPorts(); const p = ps[i]; if (!p) return false; S.portKey = keyOf(p); S.portIx = i; SV('kpcCat', S); return connect(false); }
  async function pickNew() {
    if (!('serial' in navigator) && !navigator.usb && !NAT()) return false;
    let p; try { p = await askPort(); } catch (e) { say('No port picked.', false); return false; }
    await disconnect(); const ps = await allPorts(); S.portIx = Math.max(0, ps.indexOf(p)); S.portKey = keyOf(p); SV('kpcCat', S);
    try { return await openPort(p); } catch (e) { port = writer = null; say('Could not open that port: ' + (e.message || e) + '. Close other radio programs and try again.', false); return false; }
  }
  async function forget(i) {
    const ps = await allPorts(), p = ps[i]; if (!p) return;
    if (p === port) await disconnect();
    try { if (p.isUsb) { if (p.dev.forget) await p.dev.forget(); } else if (p.forget) await p.forget(); } catch (e) {}
    S.portIx = 0; S.portKey = ''; SV('kpcCat', S); say(p.forget ? 'Port forgotten. Press PICK A DIFFERENT PORT to choose the right one.' : 'This browser can\'t forget ports: pick the right one with PICK A DIFFERENT PORT.', null);
  }
  /* radio PROFILES (Brandon Oct 20: 'home rig, field rig'): everything about one radio saved under a name, picked back in one tap */
  const PKEYS = ['radio', 'proto', 'baud', 'civ', 'model', 'data', 'link', 'host', 'port', 'portKey', 'ptt', 'dtr', 'rts', 'follow'];
  function profiles() { return (S.profiles || []).map(p => ({ name: p.name, cfg: p.cfg, now: p.name === S.profile })); }
  function saveProfile(name) { name = String(name || '').trim().slice(0, 30); if (!name) return false; const cfg = {}; PKEYS.forEach(k => { if (S[k] !== undefined) cfg[k] = S[k]; }); S.profiles = (S.profiles || []).filter(p => p.name !== name).concat([{ name, cfg }]); S.profile = name; SV('kpcCat', S); return true; }
  async function useProfile(name) { const p = (S.profiles || []).find(x => x.name === name); if (!p) return false; await disconnect(true); S = Object.assign({}, S, p.cfg, { profile: name }); FLRIG.modes = null; SV('kpcCat', S); say('Profile ' + name + ' picked: ' + (RADIO[S.radio] ? RADIO[S.radio].label : S.proto) + ' over ' + LINK() + '.', null); return true; }
  function dropProfile(name) { S.profiles = (S.profiles || []).filter(p => p.name !== name); if (S.profile === name) S.profile = ''; SV('kpcCat', S); }

  window.KPCCat = {
    get: () => Object.assign({}, S), set(o) { S = Object.assign({}, S, o || {}); SV('kpcCat', S); },
    supported: () => 'serial' in navigator || !!navigator.usb || !!NAT(), connect, disconnect, ports, usePort, pickNew, forget, connected: () => LINK() === 'flrig' ? flrigOn : LINK() === 'fake' ? FAKE.on : !!(port && writer), tune, read, follow, ptt, fake: () => FAKE,
    links: () => [{ id: 'serial', label: 'USB cable (CAT)', ok: 'serial' in navigator || !!navigator.usb || !!NAT() }, { id: 'rigctld', label: 'Hamlib rigctld (TCP)', ok: !!KN() }, { id: 'flrig', label: 'flrig (XML-RPC)', ok: true }].concat(fakeOk() ? [{ id: 'fake', label: '🧪 Pretend radio (no cable)', ok: true }] : []), link: LINK,
    profiles, saveProfile, useProfile, dropProfile, protos: PROTOS,
    raw(bytes) { busy = busy.then(async () => { if (LINK() !== 'serial' || !port || !writer) return false; try { await write(bytes); return true; } catch (e) { return false; } }).catch(() => false); return busy; },   /* Nov 6: kpc-scope.js turns the Icom scope on / off */
    onStatus(fn) { subs.push(fn); }, kind, PROTOS: Object.keys(PROTOS), RADIOS, RADIO, fillSelect, pickRadio, cw, cwCan, cwStop, keyLine, sdb, cwPitch, keyPortOpen, keyPortClose, pickKeyPort, keyPortInfo, extra, extras, caps, cmdText, TESTED, MOREKEYS: ALLK, lastDial, tuneLog, meters, power, mode, tuneFast, modeLog: () => MLOG.slice()
  };

  /* ---- QRZ logbook (ACTION=INSERT with the logbook's own API key; needs a QRZ XML/logbook subscription) ---- */
  let Z = Object.assign({ on: false, key: '' }, LS('kpcQrz') || {});
  /* QRZ answers web pages but doesn't let them read the answer (no CORS, checked Oct 17). With the KPC QRZ relay
     (kpc-qrz-relay.json url = a Google Apps Script web app) the page gets QRZ's real answer; without it, it sends ONCE
     straight to QRZ (before Oct 17 it sent twice) and can only say 'sent'. */
  let RELAY = null;
  const relayUrl = () => RELAY || (RELAY = fetch('kpc-qrz-relay.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).then(j => (j && /^https:\/\/script\.google(usercontent)?\.com\//.test(j.url || '') ? j.url : '')).catch(() => ''));
  const reasonOf = t => decodeURIComponent(((/REASON=([^&]*)/.exec(t) || [, ''])[1]).replace(/\+/g, ' ')).trim();
  async function viaRelay(action, rec) {
    const u = await relayUrl(); if (!u) return null;
    try { const r = await fetch(u, { method: 'POST', body: JSON.stringify({ key: Z.key, action, adif: rec || '' }) }); const j = await r.json(); return String(j.reply || ''); } catch (e) { return null; }
  }
  window.KPCQrz = {
    get: () => Object.assign({}, Z), set(o) { Z = Object.assign({}, Z, o || {}); SV('kpcQrz', Z); }, on: () => !!(Z.on && Z.key),
    relay: async () => !!(await relayUrl()),
    /* QRZ's OWN answer in a new tab (no relay needed): a normal form post opens logbook.qrz.com/api in a tab, and QRZ's
       plain-text reply (RESULT=OK / FAIL / AUTH + REASON) shows right there (Oct 17, Brandon: 'qrz still not working') */
    showAnswer(action, rec) {
      if (!Z.key) return false;
      const f = document.createElement('form'); f.method = 'POST'; f.action = 'https://logbook.qrz.com/api'; f.target = '_blank'; f.style.display = 'none';
      const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); };
      add('KEY', Z.key); add('ACTION', action); if (action === 'INSERT') add('ADIF', rec || '');
      document.body.appendChild(f); f.submit(); setTimeout(() => f.remove(), 2000); return true;
    },
    async test() {   /* ACTION=STATUS: is the key good? (needs the relay to see the answer) */
      if (!Z.key) return { ok: false, msg: 'No QRZ logbook key saved.' };
      const t = await viaRelay('STATUS'); if (t == null) return { ok: null, msg: 'A web page can\'t see QRZ\'s answer without the KPC QRZ relay, so this test can\'t run yet. Log one contact and check your QRZ logbook.' };
      if (/RESULT=OK/.test(t)) { const n = (/COUNT=(\d+)/.exec(t) || [])[1], c = (/CALLSIGN=([^&]*)/.exec(t) || [])[1]; return { ok: true, msg: `Key works${c ? ' for ' + decodeURIComponent(c) : ''}${n ? ' · ' + n + ' contacts in that logbook' : ''}.` }; }
      return { ok: false, msg: 'QRZ said: ' + (reasonOf(t) || t.slice(0, 120)) + (/AUTH/.test(t) ? ' (check the key: QRZ.com → Logbook → Settings → API key; it needs a QRZ subscription that includes the logbook API)' : '') };
    },
    async send(rec) {
      if (!Z.key) return { ok: false, msg: 'No QRZ logbook key saved.' };
      const t = await viaRelay('INSERT', rec);
      if (t != null) { const ok = /RESULT=(OK|REPLACE)/.test(t), dup = /duplicate/i.test(t);
        return { ok: ok || dup, sure: true, msg: ok ? 'Saved in your QRZ logbook.' : dup ? 'Already in your QRZ logbook.' : 'QRZ said: ' + (reasonOf(t) || t.slice(0, 120)) }; }
      try { await fetch('https://logbook.qrz.com/api', { method: 'POST', body: new URLSearchParams({ KEY: Z.key, ACTION: 'INSERT', ADIF: rec }), mode: 'no-cors' });
        return { ok: true, sure: false, msg: 'Sent to QRZ. (A web page can\'t see QRZ\'s reply, so check your QRZ logbook once to be sure.)' }; }
      catch (e) { return { ok: false, msg: 'Could not reach QRZ (no signal?). Download your log for QRZ later.' }; }
    }
  };
})();
