/*
  Route Desk for the MSFS 2024 EFB (tablet).

  Receives flights sent from the Route Desk website ("Send to tablet") and loads them into
  the sim's flight plan, the aircraft's avionics and ATC, using the sim's own route API
  (FlightPlanRouteManager, the same path the EFB uses for flight plans).

  Plain JavaScript, no build step. Uses the globals the EFB provides:
    window.EFB_API   the EFB container (use())
    window.msfssdk   @microsoft/msfs-sdk (FSComponent, DisplayComponent, Subject,
                     FlightPlanRouteManager, FlightPlanRouteUtils, ICAO)

  Flights travel through the Route Desk relay (a small Cloudflare Worker): the website stores
  the flight under the tablet code shown in this app, and this app checks for it every few
  seconds while it is open. Flights are kept for 24 hours.

  Structure follows the MIT-licensed msfs-efb-iframe sample by Rafael Coelho
  (https://github.com/RCCSilva/msfs-efb-iframe).
*/
(function () {
  'use strict';

  var APP_NAME = 'Route Desk';
  var INTERNAL_NAME = 'RouteDesk';            // must match folder + file name
  var VERSION = '1.0.0';
  var BUILD = '1.6.0'; // package version, kept in step with version.json by build_package.py
  var EFB_API_VERSION = '1.0.3';
  var RELAY = 'https://routedesk-relay.scjjohn2005.workers.dev';
  var LIVE = 'https://routedesk-live.scjjohn2005.workers.dev';
  var LIVE_MS = 2000;
  var POLL_MS = 5000;
  var CODE_KEY = 'ROUTEDESK_TABLET_CODE';
  var BASE_URL = 'coui://html_ui/efb_ui/efb_apps/' + INTERNAL_NAME;
  var STYLE_ID = 'routedesk-efb-style';
  var LOG = '[RouteDesk] ';

  function getSdk() { return window.msfssdk || (typeof msfssdk !== 'undefined' ? msfssdk : null); }

  /* ---------- storage that survives sim restarts ---------- */
  function readStore(key) {
    try { if (typeof GetStoredData === 'function') { var v = GetStoredData(key); if (v) return v; } } catch (e) { }
    try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch (e) { return null; }
  }
  function writeStore(key, val) {
    try { if (typeof SetStoredData === 'function') SetStoredData(key, val); } catch (e) { }
    try { if (window.localStorage) window.localStorage.setItem(key, val); } catch (e) { }
  }
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function newCode() {
    var s = '';
    for (var i = 0; i < 8; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return s;
  }
  function getCode() {
    var c = readStore(CODE_KEY);
    if (!c || !/^[A-Z0-9]{8}$/.test(c)) { c = newCode(); writeStore(CODE_KEY, c); }
    return c;
  }
  function prettyCode(c) { return c.substr(0, 4) + '-' + c.substr(4); }

  /* ---------- styles (kept simple: the sim's browser is old) ---------- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.rd-root{position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;background:#0e151c;color:#e2e9ee;font-family:Roboto,Arial,sans-serif;}' +
      '.rd-head{position:absolute;left:0;right:0;top:0;height:64px;padding:0 24px;background:#121c25;border-bottom:1px solid #25313b;}' +
      '.rd-title{position:absolute;left:24px;top:14px;font-size:26px;font-weight:bold;letter-spacing:1px;}' +
      '.rd-title span{color:#ff4cae;}' +
      '.rd-code{position:absolute;right:24px;top:10px;text-align:right;font-size:13px;color:#8796a3;}' +
      '.rd-code b{display:block;font-family:Consolas,monospace;font-size:24px;color:#4cc0da;letter-spacing:2px;}' +
      '.rd-body{position:absolute;left:0;right:0;top:65px;bottom:0;padding:20px 24px;overflow-y:auto;}' +
      '.rd-card{background:#121c25;border:1px solid #25313b;border-radius:10px;padding:18px 20px;margin-bottom:14px;}' +
      '.rd-wait{font-size:19px;line-height:28px;color:#c9d3db;}' +
      '.rd-wait b{color:#4cc0da;font-family:Consolas,monospace;letter-spacing:2px;}' +
      '.rd-muted{color:#8796a3;font-size:14px;line-height:20px;margin-top:10px;}' +
      '.rd-od{font-size:38px;font-weight:bold;letter-spacing:2px;}' +
      '.rd-od span{color:#ff4cae;font-size:30px;padding:0 12px;}' +
      '.rd-sub{color:#8796a3;font-size:15px;margin-top:4px;}' +
      '.rd-row{display:flex;flex-direction:row;padding:7px 0;border-top:1px solid #1d2933;font-size:16px;line-height:22px;}' +
      '.rd-row .k{width:150px;flex-shrink:0;color:#8796a3;text-transform:uppercase;font-size:12px;letter-spacing:1px;padding-top:2px;}' +
      '.rd-row .v{flex:1;font-family:Consolas,monospace;word-wrap:break-word;}' +
      '.rd-btns{display:flex;flex-direction:row;flex-wrap:wrap;margin-top:6px;}' +
      '.rd-btn{background:#1d2933;color:#e2e9ee;border:1px solid #33424e;border-radius:8px;padding:14px 20px;margin:0 12px 12px 0;font-size:17px;font-weight:bold;cursor:pointer;}' +
      '.rd-btn.primary{background:#0a6a86;border-color:#0a6a86;color:#fff;}' +
      '.rd-btn:hover{border-color:#4cc0da;}' +
      '.rd-status{font-size:15px;line-height:21px;color:#c9d3db;min-height:21px;}' +
      '.rd-status.ok{color:#5fd38d;} .rd-status.bad{color:#ff7b7b;}' +
      '.rd-link{color:#4cc0da;cursor:pointer;text-decoration:underline;font-size:13px;}' +
      '.rd-tabs{position:absolute;left:250px;top:14px;}' +
      '.rd-tab{display:inline-block;padding:8px 22px;margin-right:6px;border:1px solid #33424e;border-radius:18px;font-size:16px;font-weight:bold;color:#c9d3db;cursor:pointer;}' +
      '.rd-tab.on{background:#0a6a86;border-color:#0a6a86;color:#fff;}' +
      '.rd-mapwrap{position:absolute;left:0;right:0;top:65px;bottom:0;overflow:hidden;}' +
      '.mm-view{position:absolute;left:0;top:0;right:0;bottom:46px;overflow:hidden;background:#1b2630;cursor:move;}' +
      '.mm-tiles{position:absolute;left:0;top:0;}' +
      '.mm-tiles img{position:absolute;width:256px;height:256px;}' +
      '.mm-svg{position:absolute;left:0;top:0;pointer-events:none;}' +
      '.mm-lbls{position:absolute;left:0;top:0;pointer-events:none;}' +
      '.mm-lbl{position:absolute;font-family:Consolas,monospace;font-size:12px;font-weight:bold;color:#16212a;background:rgba(255,255,255,0.88);padding:0 4px;border-radius:2px;white-space:nowrap;}' +
      '.mm-lbl.apt{background:#0a6a86;color:#fff;font-size:13px;}' +
      '.mm-plane{position:absolute;width:46px;height:46px;margin-left:-23px;margin-top:-23px;pointer-events:none;}' +
      '.mm-ctl{position:absolute;right:12px;top:12px;width:120px;}' +
      '.mm-btn{background:rgba(18,28,37,0.92);color:#e2e9ee;border:1px solid #33424e;border-radius:8px;padding:9px 0;margin-bottom:8px;text-align:center;font-size:15px;font-weight:bold;cursor:pointer;}' +
      '.mm-btn.on{background:#0a6a86;border-color:#0a6a86;}' +
      '.mm-note{position:absolute;left:20px;top:20px;right:150px;padding:12px 14px;background:rgba(18,28,37,0.92);border:1px solid #33424e;border-radius:8px;font-size:15px;line-height:21px;color:#c9d3db;}' +
      '.mm-info{position:absolute;left:0;right:0;bottom:0;height:46px;background:#121c25;border-top:1px solid #25313b;font-family:Consolas,monospace;font-size:16px;line-height:46px;color:#e2e9ee;padding:0 16px;white-space:nowrap;overflow:hidden;}' +
      '.mm-info span{color:#8796a3;font-size:12px;margin:0 6px 0 18px;}' +
      '.mm-info span.first{margin-left:0;}' +
      '.mm-attr{position:absolute;right:6px;bottom:2px;font-size:10px;color:#ffffff;text-shadow:0 0 2px #000;}' +
      '.rd-hidden{display:none;}';
    var el = document.createElement('style');
    el.id = STYLE_ID; el.type = 'text/css';
    el.appendChild(document.createTextNode(css));
    document.head.appendChild(el);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function fmtN(n) { n = Math.round(+n || 0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtAlt(a) { a = +a || 0; return a >= 18000 ? 'FL' + ('00' + Math.round(a / 100)).slice(-3) : fmtN(a) + ' ft'; }
  function hm(min) { min = Math.max(0, Math.round(+min || 0)); return Math.floor(min / 60) + ':' + ('0' + (min % 60)).slice(-2); }

  /* ---------- aircraft position from the sim, recorded from the moment the tablet loads ---------- */
  var D2R = Math.PI / 180;
  function gcNm(a, b) {
    var f1 = a[0] * D2R, f2 = b[0] * D2R, df = f2 - f1, dl = (b[1] - a[1]) * D2R;
    var h = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
  }
  var TRACK = { pts: [], pos: null, err: '', listeners: [], timer: null };
  function simv(name, unit) { return SimVar.GetSimVarValue(name, unit); }
  function sampleAircraft() {
    if (typeof SimVar === 'undefined' || !SimVar.GetSimVarValue) { TRACK.err = 'nosimvar'; notifyTrack(); return; }
    try {
      var lat = simv('PLANE LATITUDE', 'degrees'), lon = simv('PLANE LONGITUDE', 'degrees');
      if (!isFinite(lat) || !isFinite(lon) || (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001)) { TRACK.pos = null; notifyTrack(); return; }
      var p = {
        lat: lat, lon: lon,
        hdg: simv('PLANE HEADING DEGREES TRUE', 'degrees'),
        gs: simv('GROUND VELOCITY', 'knots'),
        alt: simv('INDICATED ALTITUDE', 'feet'),
        vs: simv('VERTICAL SPEED', 'feet per minute'),
        ground: !!simv('SIM ON GROUND', 'bool'),
        t: Date.now()
      };
      // extra flight data for the live view on the website (each read is guarded: not every aircraft has every value)
      var extra = [['ias', 'AIRSPEED INDICATED', 'knots'], ['tas', 'AIRSPEED TRUE', 'knots'], ['mach', 'AIRSPEED MACH', 'mach'],
        ['hdgm', 'PLANE HEADING DEGREES MAGNETIC', 'degrees'], ['agl', 'PLANE ALT ABOVE GROUND', 'feet'], ['altt', 'PLANE ALTITUDE', 'feet'],
        ['wdir', 'AMBIENT WIND DIRECTION', 'degrees'], ['wspd', 'AMBIENT WIND VELOCITY', 'knots'], ['oat', 'AMBIENT TEMPERATURE', 'celsius'],
        ['fuel', 'FUEL TOTAL QUANTITY WEIGHT', 'pounds'], ['ap', 'AUTOPILOT MASTER', 'bool'], ['flaps', 'FLAPS HANDLE INDEX', 'number'],
        ['gear', 'GEAR HANDLE POSITION', 'bool'], ['pbrake', 'BRAKE PARKING POSITION', 'bool'], ['eng', 'GENERAL ENG COMBUSTION:1', 'bool'],
        ['baro', 'KOHLSMAN SETTING HG', 'inHg']];
      for (var k = 0; k < extra.length; k++) { try { var v = simv(extra[k][1], extra[k][2]); if (isFinite(v)) p[extra[k][0]] = Math.round(v * 100) / 100; } catch (e) { } }
      try { var title = SimVar.GetSimVarValue('TITLE', 'string'); if (title) p.title = String(title).slice(0, 60); } catch (e) { }
      TRACK.err = '';
      var last = TRACK.pts.length ? TRACK.pts[TRACK.pts.length - 1] : null;
      if (last && gcNm(last, [lat, lon]) > 30) TRACK.pts = [];           // new flight or a jump in position
      last = TRACK.pts.length ? TRACK.pts[TRACK.pts.length - 1] : null;
      var minNm = p.ground ? 0.004 : 0.08;                                // ~7 m on the ground, ~150 m in the air
      if (!last || gcNm(last, [lat, lon]) >= minNm) {
        TRACK.pts.push([lat, lon]);
        if (TRACK.pts.length > 6000) {                                    // thin the oldest half
          var keep = [], half = Math.floor(TRACK.pts.length / 2);
          for (var i = 0; i < TRACK.pts.length; i++) if (i >= half || i % 2 === 0) keep.push(TRACK.pts[i]);
          TRACK.pts = keep;
        }
      }
      TRACK.pos = p;
    } catch (e) { TRACK.err = String(e); }
    notifyTrack();
  }
  /* ---------- landing detection: a fast check near the ground catches the touchdown ---------- */
  var LAND = { wasGround: null, airborneAt: 0, maxG: 1, gUntil: 0, last: null, lastVs: 0, lastPitch: 0, lastBank: 0 };
  function sv(name, unit, dflt) { try { var v = SimVar.GetSimVarValue(name, unit); return isFinite(v) ? v : dflt; } catch (e) { return dflt; } }
  function landingCheck() {
    if (typeof SimVar === 'undefined' || !SimVar.GetSimVarValue) return;
    var now = Date.now(), g = !!sv('SIM ON GROUND', 'bool', 0), agl = sv('PLANE ALT ABOVE GROUND', 'feet', 9999), gf = sv('G FORCE', 'gforce', 1);
    if (LAND.wasGround === null) { LAND.wasGround = g; return; }
    if (!g) {
      if (LAND.wasGround) { LAND.airborneAt = now; LAND.maxG = 1; }
      if (agl < 300) { LAND.lastVs = sv('VERTICAL SPEED', 'feet per minute', 0); LAND.lastPitch = -sv('PLANE PITCH DEGREES', 'degrees', 0); LAND.lastBank = -sv('PLANE BANK DEGREES', 'degrees', 0); }
      if (agl > 1000) LAND.maxG = 1;
    }
    if (agl < 300 || now < LAND.gUntil) LAND.maxG = Math.max(LAND.maxG, gf);
    if (g && !LAND.wasGround && LAND.airborneAt && now - LAND.airborneAt > 4000 && sv('AIRSPEED INDICATED', 'knots', 0) > 30) {
      var L = LAND.last;
      if (L && now - L.t < 15000) { L.bounces = (L.bounces || 0) + 1; }      // touched down again right after: a bounce
      else {
        var tdv = sv('PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per second', 0);
        var rate = tdv ? -Math.abs(tdv * 60) : Math.min(0, LAND.lastVs);
        var tlat = sv('PLANE TOUCHDOWN LATITUDE', 'degrees', 0), tlon = sv('PLANE TOUCHDOWN LONGITUDE', 'degrees', 0);
        if (!tlat && !tlon) { tlat = sv('PLANE LATITUDE', 'degrees', 0); tlon = sv('PLANE LONGITUDE', 'degrees', 0); }
        LAND.last = {
          t: now, rate: Math.round(rate), ias: Math.round(sv('AIRSPEED INDICATED', 'knots', 0)), gs: Math.round(sv('GROUND VELOCITY', 'knots', 0)),
          pitch: Math.round(LAND.lastPitch * 10) / 10, bank: Math.round(LAND.lastBank * 10) / 10,
          hdg: Math.round(sv('PLANE HEADING DEGREES TRUE', 'degrees', 0)), hdgm: Math.round(sv('PLANE HEADING DEGREES MAGNETIC', 'degrees', 0)),
          lat: Math.round(tlat * 1e6) / 1e6, lon: Math.round(tlon * 1e6) / 1e6,
          wdir: Math.round(sv('AMBIENT WIND DIRECTION', 'degrees', 0)), wspd: Math.round(sv('AMBIENT WIND VELOCITY', 'knots', 0)),
          flaps: sv('FLAPS HANDLE INDEX', 'number', null), g: Math.round(LAND.maxG * 100) / 100, bounces: 0,
          wt: Math.round(sv('TOTAL WEIGHT', 'pounds', 0)) || null
        };
        try { var tt = SimVar.GetSimVarValue('TITLE', 'string'); if (tt) LAND.last.title = String(tt).slice(0, 60); } catch (e) { }
      }
      LAND.gUntil = now + 1500;
    }
    if (LAND.last && now < LAND.gUntil + 200 && now - LAND.last.t < 4000) LAND.last.g = Math.max(LAND.last.g || 1, Math.round(LAND.maxG * 100) / 100);
    LAND.wasGround = g;
  }

  function notifyTrack() { for (var i = 0; i < TRACK.listeners.length; i++) { try { TRACK.listeners[i](); } catch (e) { } } }
  // send the aircraft state to the live-tracking server so the website can follow the flight on another screen
  var LIVE_STATE = { busy: false, reset: false, last: 0, ok: null };
  function sendLive() {
    var p = TRACK.pos; if (!p || LIVE_STATE.busy) return;
    var code = getCode();
    var body = {}; for (var k in p) body[k] = p[k];
    body.lat = Math.round(p.lat * 1e6) / 1e6; body.lon = Math.round(p.lon * 1e6) / 1e6;
    body.hdg = Math.round(p.hdg * 10) / 10; body.gs = Math.round(p.gs * 10) / 10; body.alt = Math.round(p.alt); body.vs = Math.round(p.vs);
    if (LIVE_STATE.reset) body.reset = true;
    if (LAND.last) body.landing = LAND.last;
    body.v = BUILD;
    var xhr = new XMLHttpRequest();
    LIVE_STATE.busy = true;
    xhr.open('PUT', LIVE + '/pos/' + code);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 8000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      LIVE_STATE.busy = false; LIVE_STATE.ok = xhr.status === 200;
      if (xhr.status === 200) { LIVE_STATE.reset = false; LIVE_STATE.last = Date.now(); }
    };
    try { xhr.send(JSON.stringify(body)); } catch (e) { LIVE_STATE.busy = false; }
  }
  function startTracking() {
    if (!TRACK.timer) { sampleAircraft(); TRACK.timer = window.setInterval(sampleAircraft, 1000); }
    if (!LIVE_STATE.timer) LIVE_STATE.timer = window.setInterval(sendLive, LIVE_MS);
    if (!LAND.timer) LAND.timer = window.setInterval(landingCheck, 100);
  }

  /* ---------- a small slippy map (no libraries: the tablet's browser is old) ---------- */
  var LAYERS = {
    sat: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19, attr: 'Imagery © Esri, Maxar' },
    map: { url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, attr: '© OpenStreetMap contributors, © OpenTopoMap' }
  };
  function project(lat, lon, z) {
    var n = 256 * Math.pow(2, z), s = Math.sin(Math.max(-85, Math.min(85, lat)) * D2R);
    return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  function unproject(x, y, z) {
    var n = 256 * Math.pow(2, z), lon = x / n * 360 - 180;
    var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / D2R;
    return [lat, lon];
  }
  var PLANE_SVG = '<svg width="46" height="46" viewBox="-23 -23 46 46"><path d="M0 -20 L3 -8 L3 -3 L19 5 L19 9 L3 5 L2 14 L7 18 L7 21 L0 19 L-7 21 L-7 18 L-2 14 L-3 5 L-19 9 L-19 5 L-3 -3 L-3 -8 Z" fill="#ffd400" stroke="#16212a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  var NS = 'http://www.w3.org/2000/svg';

  function MovingMap(el, store) {
    var self = this;
    this.el = el; this.store = store;
    this.z = 15; this.center = [0, 0]; this.follow = true; this.autoZoom = true;
    this.layerMode = store.read('ROUTEDESK_MAP_LAYER') || 'auto';
    this.flight = null; this.tiles = {}; this.tileZ = -1; this.visible = false;
    el.innerHTML =
      '<div class="mm-view"><div class="mm-tiles"></div>' +
      '<svg class="mm-svg"><polyline class="r" fill="none" stroke="#ff4cae" stroke-width="3" stroke-linejoin="round"/>' +
      '<polyline class="t" fill="none" stroke="#00e5ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>' +
      '<div class="mm-lbls"></div><div class="mm-plane rd-hidden">' + PLANE_SVG + '</div>' +
      '<div class="mm-note rd-hidden"></div>' +
      '<div class="mm-ctl">' +
      '<div class="mm-btn" data-m="in">+</div><div class="mm-btn" data-m="out">&#8722;</div>' +
      '<div class="mm-btn on" data-m="follow">Follow</div><div class="mm-btn" data-m="layer"></div>' +
      '<div class="mm-btn" data-m="clear">Clear track</div></div>' +
      '<div class="mm-attr"></div></div>' +
      '<div class="mm-info"></div>';
    this.view = el.querySelector('.mm-view'); this.tileEl = el.querySelector('.mm-tiles');
    this.svg = el.querySelector('.mm-svg'); this.rLine = el.querySelector('.r'); this.tLine = el.querySelector('.t');
    this.lbls = el.querySelector('.mm-lbls'); this.plane = el.querySelector('.mm-plane'); this.note = el.querySelector('.mm-note');
    this.info = el.querySelector('.mm-info'); this.attr = el.querySelector('.mm-attr');
    var btns = el.querySelectorAll('[data-m]');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', (function (b) {
      return function (e) { e.stopPropagation(); self.command(b.getAttribute('data-m')); };
    })(btns[i]));
    // drag to pan, wheel to zoom
    var drag = null;
    this.view.addEventListener('mousedown', function (e) { if (e.target.className && String(e.target.className).indexOf('mm-btn') >= 0) return; drag = [e.clientX, e.clientY]; });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag[0], dy = e.clientY - drag[1]; if (Math.abs(dx) + Math.abs(dy) < 2) return;
      drag = [e.clientX, e.clientY]; self.setFollow(false);
      var c = project(self.center[0], self.center[1], self.z); self.center = unproject(c[0] - dx, c[1] - dy, self.z); self.render();
    });
    window.addEventListener('mouseup', function () { drag = null; });
    this.view.addEventListener('wheel', function (e) { self.zoomBy(e.deltaY < 0 ? 1 : -1); });
    this.onTrack = function () { if (self.visible) self.update(); };
    TRACK.listeners.push(this.onTrack);
    this.updateLayerBtn();
  }
  MovingMap.prototype.destroy = function () { var i = TRACK.listeners.indexOf(this.onTrack); if (i >= 0) TRACK.listeners.splice(i, 1); };
  MovingMap.prototype.layer = function () {
    var m = this.layerMode;
    if (m === 'auto') m = (TRACK.pos && !TRACK.pos.ground) ? 'map' : 'sat';
    return m;
  };
  MovingMap.prototype.updateLayerBtn = function () {
    var b = this.el.querySelector('[data-m="layer"]');
    b.textContent = this.layerMode === 'auto' ? 'Auto map' : this.layerMode === 'sat' ? 'Satellite' : 'Topo';
  };
  MovingMap.prototype.setFollow = function (on) {
    this.follow = on; if (on) this.autoZoom = true;
    this.el.querySelector('[data-m="follow"]').className = 'mm-btn' + (on ? ' on' : '');
  };
  MovingMap.prototype.zoomBy = function (d) {
    this.autoZoom = false;
    this.z = Math.max(3, Math.min(LAYERS[this.layer()].max, this.z + d));
    this.render();
  };
  MovingMap.prototype.command = function (m) {
    if (m === 'in') this.zoomBy(1);
    else if (m === 'out') this.zoomBy(-1);
    else if (m === 'follow') { this.setFollow(!this.follow); this.update(); }
    else if (m === 'layer') {
      this.layerMode = this.layerMode === 'auto' ? 'sat' : this.layerMode === 'sat' ? 'map' : 'auto';
      this.store.write('ROUTEDESK_MAP_LAYER', this.layerMode); this.updateLayerBtn(); this.render();
    } else if (m === 'clear') { TRACK.pts = TRACK.pos ? [[TRACK.pos.lat, TRACK.pos.lon]] : []; LIVE_STATE.reset = true; this.render(); }
  };
  MovingMap.prototype.setFlight = function (f) { this.flight = f; if (this.visible) this.render(); };
  MovingMap.prototype.show = function (on) {
    this.visible = on;
    if (on) {
      if (!TRACK.pos && this.flight && this.flight.pts && this.flight.pts.length && this.center[0] === 0) {
        this.center = this.flight.pts[0]; this.z = 13;
      }
      this.update();
    }
  };
  MovingMap.prototype.update = function () {
    var p = TRACK.pos;
    if (p && this.follow) {
      this.center = [p.lat, p.lon];
      if (this.autoZoom) this.z = p.ground ? 16 : p.alt < 5000 ? 12 : p.alt < 15000 ? 10 : 8;
    }
    this.render();
  };
  MovingMap.prototype.render = function () {
    if (!this.visible) return;
    var w = this.view.offsetWidth, h = this.view.offsetHeight; if (!w || !h) return;
    var L = LAYERS[this.layer()]; if (this.z > L.max) this.z = L.max;
    var z = this.z, c = project(this.center[0], this.center[1], z), x0 = c[0] - w / 2, y0 = c[1] - h / 2, n = Math.pow(2, z);
    // tiles
    if (this.tileZ !== z || this.tileLayer !== this.layer()) { this.tileEl.innerHTML = ''; this.tiles = {}; this.tileZ = z; this.tileLayer = this.layer(); }
    var need = {};
    for (var tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + w) / 256); tx++) {
      for (var ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + h) / 256); ty++) {
        if (ty < 0 || ty >= n) continue;
        var wx = ((tx % n) + n) % n, key = tx + '_' + ty, img = this.tiles[key];
        if (!img) {
          img = document.createElement('img');
          img.src = L.url.replace('{z}', z).replace('{x}', wx).replace('{y}', ty);
          this.tileEl.appendChild(img); this.tiles[key] = img;
        }
        img.style.left = Math.round(tx * 256 - x0) + 'px'; img.style.top = Math.round(ty * 256 - y0) + 'px';
        need[key] = 1;
      }
    }
    for (var k in this.tiles) if (!need[k]) { if (this.tiles[k].parentNode) this.tiles[k].parentNode.removeChild(this.tiles[k]); delete this.tiles[k]; }
    this.attr.textContent = L.attr;
    // route and track
    this.svg.setAttribute('width', w); this.svg.setAttribute('height', h);
    var toXY = function (q) { var v = project(q[0], q[1], z); return [Math.round((v[0] - x0) * 10) / 10, Math.round((v[1] - y0) * 10) / 10]; };
    var f = this.flight, rp = (f && f.pts) || [], s = [], i;
    for (i = 0; i < rp.length; i++) s.push(toXY(rp[i]).join(','));
    this.rLine.setAttribute('points', s.join(' '));
    s = []; for (i = 0; i < TRACK.pts.length; i++) s.push(toXY(TRACK.pts[i]).join(','));
    if (TRACK.pos) s.push(toXY([TRACK.pos.lat, TRACK.pos.lon]).join(','));
    this.tLine.setAttribute('points', s.join(' '));
    // waypoint labels (skip ones that would overlap)
    var html = '', names = (f && f.pn) || [], lastXY = null;
    for (i = 0; i < rp.length; i++) {
      var v = toXY(rp[i]), apt = i === 0 || i === rp.length - 1;
      if (v[0] < -60 || v[1] < -30 || v[0] > w + 60 || v[1] > h + 30) continue;
      if (!apt && lastXY && Math.abs(v[0] - lastXY[0]) < 70 && Math.abs(v[1] - lastXY[1]) < 22) continue;
      html += '<div class="mm-lbl' + (apt ? ' apt' : '') + '" style="left:' + (v[0] + 6) + 'px;top:' + (v[1] - 20) + 'px">' + esc(names[i] || '') + '</div>';
      lastXY = v;
    }
    this.lbls.innerHTML = html;
    // aircraft
    var p = TRACK.pos;
    if (p) {
      var pv = toXY([p.lat, p.lon]);
      this.plane.className = 'mm-plane';
      this.plane.style.left = pv[0] + 'px'; this.plane.style.top = pv[1] + 'px';
      this.plane.style.transform = 'rotate(' + Math.round(p.hdg) + 'deg)';
    } else this.plane.className = 'mm-plane rd-hidden';
    // status note and info bar
    var note = '';
    if (TRACK.err === 'nosimvar') note = 'This tablet can\'t read the aircraft position.';
    else if (!p) note = 'Waiting for the aircraft position. It appears once you\'re in a flight.';
    else if (!this.follow) note = '';
    this.note.textContent = note; this.note.className = 'mm-note' + (note ? '' : ' rd-hidden');
    if (p) {
      var rem = '';
      if (f && rp.length) { rem = '<span>TO ' + esc(f.arr) + '</span>' + fmtN(gcNm([p.lat, p.lon], rp[rp.length - 1])) + ' nm'; }
      this.info.innerHTML = '<span class="first">GS</span>' + Math.round(p.gs) + ' kt<span>ALT</span>' + fmtN(p.alt) + ' ft' +
        '<span>HDG</span>' + ('00' + (Math.round(p.hdg) % 360)).slice(-3) + '&#176;<span>VS</span>' + (Math.round(p.vs / 10) * 10) + ' fpm' +
        (p.ground ? '<span>ON GROUND</span>' : '') + rem +
        (LAND.last && Date.now() - LAND.last.t < 600000 ? '<span>LANDED</span>' + LAND.last.rate + ' fpm · ' + LAND.last.g + ' G' + (LAND.last.bounces ? ' · ' + LAND.last.bounces + ' bounce' + (LAND.last.bounces > 1 ? 's' : '') : '') : '');
    } else this.info.innerHTML = '<span class="first">No position yet</span>';
  };

  /* ---------- turn a Route Desk flight into an MSFS FlightPlanRoute ---------- */
  function runwayId(sdk, rw) {
    var m = String(rw || '').toUpperCase().match(/^0?(\d{1,2})([LRC]?)/);
    return { __Type: 'JS_RunwayIdentifier', number: m ? ('0' + m[1]).slice(-2) : '', designator: m ? m[2] : '' };
  }
  function buildRoute(sdk, f) {
    var U = sdk.FlightPlanRouteUtils, ICAO = sdk.ICAO;
    var r = U.emptyRoute();
    r.departureAirport = ICAO.value('A', '', '', f.dep);
    r.destinationAirport = ICAO.value('A', '', '', f.arr);
    if (f.dr) r.departureRunway = runwayId(sdk, f.dr);
    if (f.ar) r.destinationRunway = runwayId(sdk, f.ar);
    r.departure = f.sid || '';
    r.departureTransition = f.sid ? (f.sidT || '') : '';
    r.arrival = f.star || '';
    r.arrivalTransition = f.star ? (f.starT || '') : '';
    if (f.app && f.app.length >= 4 && f.app[0]) {
      r.approach = { __Type: 'JS_ApproachIdentifier', type: f.app[0],
        runway: { __Type: 'JS_RunwayIdentifier', number: f.app[1] || '', designator: f.app[2] || '' }, suffix: f.app[3] || '' };
      r.approachTransition = f.appT || '';
    }
    if (f.crz) {
      var fl = f.crz >= 18000;
      r.cruiseAltitude = { __Type: 'JS_FlightAltitude', altitude: fl ? Math.round(f.crz / 100) : Math.round(f.crz), isFlightLevel: fl };
    }
    r.isVfr = !!f.vfr;
    (f.enr || []).forEach(function (l) {
      // [ident, type, region, airport, via, lat, lon]
      var leg = U.emptyEnrouteLeg();
      leg.via = String(l[4] || '').substr(0, 7);
      leg.name = l[0];
      if (l[1] === 'U' || !l[1]) {
        leg.hasLatLon = true; leg.lat = +l[5]; leg.lon = +l[6];
      } else {
        leg.fixIcao = ICAO.value(l[1], l[1] === 'A' ? '' : (l[2] || ''), l[3] || '', l[0]);
      }
      r.enroute.push(leg);
    });
    return r;
  }

  /* ---------- the app view ---------- */
  function createViewClass(sdk) {
    return class RouteDeskView extends sdk.DisplayComponent {
      constructor(props) {
        super(props);
        this.rootRef = sdk.FSComponent.createRef();
        this.code = getCode();
        this.flight = null;
        this.lastKey = '';
        this.lastCheck = 0;
        this.pollTimer = null;
        this.busy = false;
        this.destroyed = false;
        this.managerPromise = null;
        this.pageKeyActions = new Map();
      }

      render() {
        return sdk.FSComponent.buildComponent('div', { class: 'rd-root', ref: this.rootRef });
      }

      onAfterRender() {
        var root = this.rootRef.instance; if (!root) return;
        root.innerHTML = '<div class="rd-head"></div><div class="rd-body"></div><div class="rd-mapwrap rd-hidden"></div>';
        this.headEl = root.querySelector('.rd-head'); this.bodyEl = root.querySelector('.rd-body'); this.mapEl = root.querySelector('.rd-mapwrap');
        this.map = new MovingMap(this.mapEl, { read: readStore, write: writeStore });
        this.tab = readStore('ROUTEDESK_TAB') === 'map' ? 'map' : 'flight';
        startTracking();
        this.draw(); this.startPolling();
      }
      setTab(t) {
        this.tab = t; writeStore('ROUTEDESK_TAB', t);
        this.bodyEl.className = 'rd-body' + (t === 'map' ? ' rd-hidden' : '');
        this.mapEl.className = 'rd-mapwrap' + (t === 'map' ? '' : ' rd-hidden');
        var tabs = this.headEl.querySelectorAll('[data-tab]');
        for (var i = 0; i < tabs.length; i++) tabs[i].className = 'rd-tab' + (tabs[i].getAttribute('data-tab') === t ? ' on' : '');
        this.map.show(t === 'map');
      }

      startPolling() {
        var self = this;
        this.stopPolling();
        this.check();
        this.pollTimer = window.setInterval(function () { self.check(); }, POLL_MS);
      }
      stopPolling() { if (this.pollTimer) { window.clearInterval(this.pollTimer); this.pollTimer = null; } }

      check() {
        if (this.destroyed) return;
        var self = this, xhr = new XMLHttpRequest();
        xhr.open('GET', RELAY + '/flight/' + this.code + '?t=' + Date.now());
        xhr.timeout = 10000;
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4 || self.destroyed) return;
          self.lastCheck = Date.now();
          if (xhr.status === 200) { self.netOk = true; self.receive(xhr.responseText); }
          else if (xhr.status === 404) self.netOk = true;
          else self.netOk = false;
          self.drawStatusOnly();
        };
        try { xhr.send(); } catch (e) { this.netOk = false; }
      }

      receive(text) {
        var f;
        try { f = JSON.parse(text); } catch (e) { return; }
        if (!f || f.v !== 1 || !f.dep || !f.arr) return;
        var key = f.sent + '|' + f.dep + '|' + f.arr;
        if (key === this.lastKey) return;
        if (this.flight && f.sent && this.flight.sent && f.sent < this.flight.sent) return; // a stale cached copy
        this.lastKey = key; this.flight = f; this.status = ''; this.statusCls = '';
        this.draw();
      }

      manager() {
        if (!this.managerPromise) this.managerPromise = sdk.FlightPlanRouteManager.getManager();
        return this.managerPromise;
      }

      act(kind) {
        var self = this, f = this.flight;
        if (!f || this.busy) return;
        if (!sdk.FlightPlanRouteManager || !sdk.FlightPlanRouteUtils) { this.setStatus('This version of the sim does not offer the route API.', 'bad'); return; }
        this.busy = true;
        this.setStatus(kind === 'atc' ? 'Filing with ATC…' : kind === 'avionics' ? 'Sending to the aircraft…' : 'Loading the flight plan…', '');
        var route;
        try { route = buildRoute(sdk, f); } catch (e) { this.busy = false; this.setStatus('Could not read this flight: ' + e, 'bad'); return; }
        var timeout = new Promise(function (_, rej) { window.setTimeout(function () { rej('the sim did not respond in time'); }, 15000); });
        Promise.race([this.manager(), timeout]).then(function (m) {
          if (kind === 'atc') return m.fileRouteWithAtc(route);
          if (kind === 'avionics') return m.sendRouteToAvionics(route);
          return m.sendRouteToEfb(route).then(function () { return m.sendRouteToAvionics(route); });
        }).then(function () {
          self.busy = false;
          self.setStatus(kind === 'atc' ? 'Filed with ATC.' :
            kind === 'avionics' ? 'Sent to the aircraft. Check the FMS route page and activate it if asked.' :
            'Loaded into the flight plan and sent to the aircraft. Check the route on the FMS.', 'ok');
        }).catch(function (e) {
          self.busy = false;
          console.error(LOG, e);
          self.setStatus('That did not work: ' + e, 'bad');
        });
      }

      setStatus(text, cls) { this.status = text; this.statusCls = cls; this.drawStatusOnly(); }

      drawStatusOnly() {
        var root = this.rootRef.instance; if (!root) return;
        var st = root.querySelector('.rd-status'), chk = root.querySelector('.rd-check');
        if (st) { st.textContent = this.status || ''; st.className = 'rd-status' + (this.statusCls ? ' ' + this.statusCls : ''); }
        if (chk) {
          chk.textContent = this.netOk === false ? 'Cannot reach the Route Desk relay right now. Retrying…' :
            this.lastCheck ? 'Checked for new flights ' + new Date(this.lastCheck).toLocaleTimeString() : 'Checking for flights…';
        }
      }

      draw() {
        var root = this.rootRef.instance; if (!root || !this.bodyEl) return;
        var f = this.flight, c = prettyCode(this.code), h = '';
        this.headEl.innerHTML = '<div class="rd-title">ROUTE<span>/</span>DESK</div>' +
          '<div class="rd-tabs"><div class="rd-tab" data-tab="flight">Flight</div><div class="rd-tab" data-tab="map">Map</div></div>' +
          '<div class="rd-code">Tablet code<b>' + esc(c) + '</b></div>';
        if (!f) {
          h += '<div class="rd-card"><div class="rd-wait">No flight yet.<br>In Route Desk on your PC or phone, press <b style="letter-spacing:0">Send to tablet</b> and enter the code <b>' + esc(c) + '</b>.</div>' +
            '<div class="rd-muted">This screen checks for new flights every few seconds. Flights sent in the last 24 hours show up here.</div>' +
            '<div class="rd-btns" style="margin-top:12px"><div class="rd-btn" data-act="check">Check now</div></div>' +
            '<div class="rd-status"></div>' +
            '<div class="rd-muted rd-check"></div><div class="rd-muted"><span class="rd-link" data-act="newcode">Make a new tablet code</span></div></div>';
        } else {
          var dep = 'RWY ' + (f.dr || '—') + (f.sid ? ' · ' + f.sid + (f.sidT ? '.' + f.sidT : '') : '');
          var arr = (f.star ? (f.starT ? f.starT + '.' : '') + f.star + ' · ' : '') + (f.appN ? f.appN + (f.appT ? ' via ' + f.appT : '') : 'No approach') + ' · RWY ' + (f.ar || '—');
          h += '<div class="rd-card"><div class="rd-od">' + esc(f.dep) + '<span>&#9654;</span>' + esc(f.arr) + '</div>' +
            '<div class="rd-sub">' + esc([f.cs, f.acn, f.sent ? 'sent ' + new Date(f.sent).toLocaleTimeString() : ''].filter(Boolean).join(' · ')) + '</div>' +
            '<div style="margin-top:12px">' +
            row('Departure', dep) + row('Route', f.rs || 'Direct') + row('Arrival', arr) +
            row('Cruise', fmtAlt(f.crz)) +
            (f.dist ? row('Distance', fmtN(f.dist) + ' nm · ' + hm(f.ete) + ' air time') : '') +
            (f.fuel ? row('Block fuel', fmtN(f.fuel) + ' lb' + (f.res ? ' (incl. reserve ' + fmtN(f.res) + ')' : '')) : '') +
            (f.zfw ? row('Weights', 'ZFW ' + fmtN(f.zfw) + ' · TOW ' + fmtN(f.tow) + ' lb') : '') +
            (f.altn ? row('Alternate', f.altn) : '') +
            '</div></div>' +
            '<div class="rd-btns">' +
            '<div class="rd-btn primary" data-act="load">Load flight plan</div>' +
            '<div class="rd-btn" data-act="avionics">Send to aircraft only</div>' +
            '<div class="rd-btn" data-act="atc">File with ATC</div>' +
            '<div class="rd-btn" data-act="check">Check for a newer flight</div></div>' +
            '<div class="rd-status"></div>' +
            '<div class="rd-muted">Works with aircraft that use the sim\'s own avionics (default airliners and GA). PMDG, Fenix and FlyByWire keep their own FMS: load the route there from the FMC entry sheet or SimBrief.</div>' +
            '<div class="rd-muted rd-check"></div><div class="rd-muted">Tablet code ' + esc(c) + '</div>';
        }
        this.bodyEl.innerHTML = h;
        var self = this, btns = this.bodyEl.querySelectorAll('[data-act]');
        var tabs = this.headEl.querySelectorAll('[data-tab]');
        for (var j = 0; j < tabs.length; j++) tabs[j].addEventListener('click', (function (b) { return function () { self.setTab(b.getAttribute('data-tab')); }; })(tabs[j]));
        this.map.setFlight(f);
        this.setTab(this.tab);
        for (var i = 0; i < btns.length; i++) {
          btns[i].addEventListener('click', (function (b) {
            return function () {
              var a = b.getAttribute('data-act');
              if (a === 'newcode') { self.code = newCode(); writeStore(CODE_KEY, self.code); self.flight = null; self.lastKey = ''; self.draw(); self.startPolling(); }
              else if (a === 'check') { self.setStatus('Checking…', ''); self.check(); window.setTimeout(function () { if (self.status === 'Checking…') self.setStatus('', ''); }, 3000); }
              else self.act(a);
            };
          })(btns[i]));
        }
        this.drawStatusOnly();
        function row(k, v) { return '<div class="rd-row"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }
      }

      onOpen() { this.startPolling(); }
      onResume() { this.startPolling(); }
      onPause() { this.stopPolling(); }
      onClose() { this.stopPolling(); }
      onUpdate() { }
      routeGamepadInteractionEvent() { }
      handlePageKeyAction() { }

      destroy() { this.destroyed = true; this.stopPolling(); if (this.map) this.map.destroy(); super.destroy(); }
    };
  }

  /* ---------- register with the EFB ---------- */
  function registerApp() {
    var sdk = getSdk(), efb = window.EFB_API;
    if (!sdk || !efb || typeof efb.use !== 'function') return false;
    injectStyle();
    var View = createViewClass(sdk);

    class RouteDeskApp {
      constructor() {
        this.available = sdk.Subject.create(true);
        this.BootMode = 0;     // AppBootMode.COLD
        this.SuspendMode = 0;  // AppSuspendMode.SLEEP
        this._isReady = false;
        this._favoriteIndex = -1;
        this.bus = null;
      }
      get name() { return APP_NAME; }
      get internalName() { return INTERNAL_NAME; }
      get icon() { return BASE_URL + '/Assets/app-icon.svg'; }
      get isReady() { return this._isReady; }
      get favoriteIndex() { return this._favoriteIndex; }
      set favoriteIndex(v) { this._favoriteIndex = v; }
      get compatibleAircraftModels() { return undefined; }
      get unitsSettingsManager() { return this._unitsSettingsManager; }
      getIsSearchable() { return true; }
      getIsFavoritable() { return true; }
      getVersion() { return VERSION; }
      async install() { }
      async _install(props) {
        this.bus = props && props.bus;
        this._unitsSettingsManager = props && props.unitsSettingManager;
        this.notificationManager = props && props.notificationManager;
        this.efbSettingsManager = props && props.efbSettingsManager;
        this.options = props && props.options;
        await this.install(props);
        startTracking();
        this._isReady = true;
        try { if (window.Coherent && typeof window.Coherent.trigger === 'function') window.Coherent.trigger('EFB_APP_INSTALLED', APP_NAME, INTERNAL_NAME, EFB_API_VERSION, VERSION); } catch (e) { }
      }
      render() { return sdk.FSComponent.buildComponent(View, { bus: this.bus }); }
    }

    efb.use(RouteDeskApp);
    return true;
  }

  var REGISTER_RETRY_MS = 100, REGISTER_MAX_ATTEMPTS = 300;
  function registerWhenReady(attempt) {
    var ok = false;
    try { ok = registerApp(); } catch (e) { ok = false; }
    if (!ok && attempt < REGISTER_MAX_ATTEMPTS) window.setTimeout(function () { registerWhenReady(attempt + 1); }, REGISTER_RETRY_MS);
  }
  registerWhenReady(1);
})();
