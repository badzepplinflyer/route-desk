// Route Desk relay (Cloudflare Worker).
// Holds the latest flight sent to each tablet code for 24 hours, so the website can hand
// flights to the in-game tablet app without anyone needing an account.
//   PUT /flight/ABCD2345   body: a Route Desk flight (JSON)   -> stores it
//   GET /flight/ABCD2345                                      -> returns it (404 if none)
// Needs a KV namespace bound to this Worker with the variable name FLIGHTS.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function reply(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' ) return reply({ ok: true, service: 'Route Desk relay', kv: !!env.FLIGHTS });
    const m = url.pathname.match(/^\/flight\/([A-Z0-9]{8})$/);
    if (!m) return reply({ error: 'not found' }, 404);
    if (!env.FLIGHTS) return reply({ error: 'KV namespace FLIGHTS is not bound to this Worker' }, 500);
    const key = 'flight:' + m[1];

    if (request.method === 'GET') {
      const saved = await env.FLIGHTS.get(key);
      return saved ? reply(saved) : reply({ error: 'no flight for this code' }, 404);
    }
    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > 16000) return reply({ error: 'flight too large' }, 413);
      let flight;
      try { flight = JSON.parse(body); } catch (e) { return reply({ error: 'not JSON' }, 400); }
      if (!flight || flight.v !== 1 || !flight.dep || !flight.arr) return reply({ error: 'not a Route Desk flight' }, 400);
      await env.FLIGHTS.put(key, body, { expirationTtl: 86400 });
      return reply({ ok: true });
    }
    return reply({ error: 'method not allowed' }, 405);
  },
};
