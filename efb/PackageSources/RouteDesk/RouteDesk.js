/*
  Route Desk for the MSFS 2024 EFB (tablet).

  Receives flights sent from the Route Desk website ("Send to tablet") and loads them into
  the sim's flight plan, the aircraft's avionics and ATC, using the sim's own route API
  (FlightPlanRouteManager, the same path the EFB uses for flight plans).

  Plain JavaScript, no build step. Uses the globals the EFB provides:
    window.EFB_API   the EFB container (use())
    window.msfssdk   @microsoft/msfs-sdk (FSComponent, DisplayComponent, Subject,
                     FlightPlanRouteManager, FlightPlanRouteUtils, ICAO)

  Flights travel through a mailbox in the Route Desk GitHub repository: the website writes
  tablet/<tablet code>.json on the "tablet" branch, and this app reads it (GitHub API when the
  app opens or on "Check now", the raw file server in the background).

  Structure follows the MIT-licensed msfs-efb-iframe sample by Rafael Coelho
  (https://github.com/RCCSilva/msfs-efb-iframe).
*/
(function () {
  'use strict';

  var APP_NAME = 'Route Desk';
  var INTERNAL_NAME = 'RouteDesk';            // must match folder + file name
  var VERSION = '1.0.0';
  var EFB_API_VERSION = '1.0.3';
  var REPO = 'badzepplinflyer/route-desk';     // owner/repo that hosts the mailbox
  var BRANCH = 'tablet';
  var RAW_POLL_MS = 15000;                      // raw.githubusercontent.com: no hourly limit, may lag up to 5 min
  var API_POLL_MS = 120000;                     // api.github.com: 60 unauthenticated requests per hour
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
        this.rawTimer = null;
        this.apiTimer = null;
        this.rateLimited = 0;
        this.busy = false;
        this.destroyed = false;
        this.managerPromise = null;
        this.pageKeyActions = new Map();
      }

      render() {
        return sdk.FSComponent.buildComponent('div', { class: 'rd-root', ref: this.rootRef });
      }

      onAfterRender() { this.draw(); this.startPolling(); }

      startPolling() {
        var self = this;
        this.stopPolling();
        this.checkApi();
        this.rawTimer = window.setInterval(function () { self.checkRaw(); }, RAW_POLL_MS);
        this.apiTimer = window.setInterval(function () { if (!self.rateLimited || Date.now() > self.rateLimited) self.checkApi(); }, API_POLL_MS);
      }
      stopPolling() {
        if (this.rawTimer) { window.clearInterval(this.rawTimer); this.rawTimer = null; }
        if (this.apiTimer) { window.clearInterval(this.apiTimer); this.apiTimer = null; }
      }
      mailPath() { return 'tablet/' + this.code + '.json'; }

      // Fresh read through the GitHub API (uses one of 60 unauthenticated requests per hour)
      checkApi() {
        if (this.destroyed) return;
        var self = this, xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.github.com/repos/' + REPO + '/contents/' + this.mailPath() + '?ref=' + BRANCH + '&t=' + Date.now());
        xhr.setRequestHeader('Accept', 'application/vnd.github+json');
        xhr.timeout = 10000;
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4 || self.destroyed) return;
          self.lastCheck = Date.now();
          if (xhr.status === 200) {
            self.netOk = true;
            try {
              var j = JSON.parse(xhr.responseText);
              var txt = decodeURIComponent(escape(atob(String(j.content || '').replace(/\s/g, ''))));
              self.receive(txt);
            } catch (e) { console.warn(LOG + 'could not read the mailbox file', e); }
          } else if (xhr.status === 404) { self.netOk = true; }
          else if (xhr.status === 403 || xhr.status === 429) { self.netOk = true; self.rateLimited = Date.now() + 15 * 60000; self.checkRaw(); }
          else { self.netOk = false; self.checkRaw(); }
          self.drawStatusOnly();
        };
        try { xhr.send(); } catch (e) { this.netOk = false; this.checkRaw(); }
      }

      // Background read from the raw file server (no hourly limit; GitHub may cache it for a few minutes)
      checkRaw() {
        if (this.destroyed) return;
        var self = this, xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/' + this.mailPath() + '?t=' + Date.now());
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
          chk.textContent = this.netOk === false ? 'Cannot reach GitHub right now. Retrying…' :
            this.lastCheck ? 'Checked for new flights ' + new Date(this.lastCheck).toLocaleTimeString() : 'Checking for flights…';
        }
      }

      draw() {
        var root = this.rootRef.instance; if (!root) return;
        var f = this.flight, c = prettyCode(this.code), h = '';
        h += '<div class="rd-head"><div class="rd-title">ROUTE<span>/</span>DESK</div>' +
          '<div class="rd-code">Tablet code<b>' + esc(c) + '</b></div></div><div class="rd-body">';
        if (!f) {
          h += '<div class="rd-card"><div class="rd-wait">No flight yet.<br>In Route Desk on your PC or phone, press <b style="letter-spacing:0">Send to tablet</b> and enter the code <b>' + esc(c) + '</b>.</div>' +
            '<div class="rd-muted">This screen checks for new flights by itself. If one doesn\'t appear within a minute, tap Check now.</div>' +
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
        h += '</div>';
        root.innerHTML = h;
        var self = this, btns = root.querySelectorAll('[data-act]');
        for (var i = 0; i < btns.length; i++) {
          btns[i].addEventListener('click', (function (b) {
            return function () {
              var a = b.getAttribute('data-act');
              if (a === 'newcode') { self.code = newCode(); writeStore(CODE_KEY, self.code); self.flight = null; self.lastKey = ''; self.draw(); self.startPolling(); }
              else if (a === 'check') { self.setStatus('Checking…', ''); self.checkApi(); self.checkRaw(); window.setTimeout(function () { if (self.status === 'Checking…') self.setStatus('', ''); }, 4000); }
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

      destroy() { this.destroyed = true; this.stopPolling(); super.destroy(); }
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
