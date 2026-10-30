// Route Desk live tracking (Cloudflare Worker + Durable Object).
// The in-game tablet app sends the aircraft's state every couple of seconds; the website polls it.
//   PUT /pos/ABCD2345   body: aircraft state JSON        -> stores latest state, extends the track
//   GET /pos/ABCD2345?since=N                            -> {pos, age, n, trail (points from index N)}
// One Durable Object per tablet code keeps the state in memory and saves the track every minute.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function nm(a, b) {
  const r = Math.PI / 180, f1 = a[0] * r, f2 = b[0] * r, df = f2 - f1, dl = (b[1] - a[1]) * r;
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

export class LiveFlight {
  constructor(state) { this.state = state; this.pos = null; this.trail = null; this.saved = 0; this.dirty = false; }
  async load() {
    if (this.trail !== null) return;
    this.trail = (await this.state.storage.get('trail')) || [];
    this.pos = (await this.state.storage.get('pos')) || null;
  }
  async save(force) {
    if (!this.dirty || (!force && Date.now() - this.saved < 60000)) return;
    this.saved = Date.now(); this.dirty = false;
    await this.state.storage.put({ trail: this.trail, pos: this.pos });
  }
  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    if (request.method === 'PUT') {
      let p; try { p = JSON.parse(await request.text()); } catch (e) { return json({ error: 'not JSON' }, 400); }
      if (!p || !isFinite(p.lat) || !isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return json({ error: 'bad position' }, 400);
      p.rt = Date.now();
      const pt = [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5, Math.round(p.alt || 0)];
      const last = this.trail[this.trail.length - 1];
      if (p.reset || (last && nm(last, pt) > 30)) this.trail = [];
      const lastNow = this.trail[this.trail.length - 1];
      if (!lastNow || nm(lastNow, pt) >= (p.ground ? 0.004 : 0.08)) {
        this.trail.push(pt);
        if (this.trail.length > 8000) this.trail = this.trail.filter((x, i) => i >= 4000 || i % 2 === 0);
      }
      delete p.reset;
      this.pos = p; this.dirty = true;
      await this.save(false);
      return json({ ok: true });
    }
    if (request.method === 'GET') {
      const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
      const n = this.trail.length, reset = since > n;
      return json({ pos: this.pos, age: this.pos ? Date.now() - this.pos.rt : null, n, reset, trail: this.trail.slice(reset ? 0 : since) });
    }
    return json({ error: 'method not allowed' }, 405);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/') return json({ ok: true, service: 'Route Desk live tracking', do: !!env.LIVE });
    const m = url.pathname.match(/^\/pos\/([A-Z0-9]{8})$/);
    if (!m) return json({ error: 'not found' }, 404);
    const stub = env.LIVE.get(env.LIVE.idFromName(m[1]));
    const res = await stub.fetch(request);
    return new Response(res.body, { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};
