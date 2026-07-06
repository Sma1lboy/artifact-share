// brand-studio share server — Cloudflare Worker + KV.
// Shares a self-contained review-board HTML at /share/<id> and collects
// per-reviewer verdicts the agent can read back directly (GET .../verdicts).
// ponytail: no auth by design — org-internal links, content-hash ids, short TTL.

const TTL = 86400; // seconds idle before a share dies; every hit re-arms it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function fnv1a(str) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(str)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

const slug = (s) => s.replace(/[^\w一-鿿-]+/g, "_").slice(0, 60);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });

async function touch(env, key, value) {
  await env.SHARES.put(key, value, { expirationTtl: TTL });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/share(?:\/([0-9a-f]{16}))?(?:\/(verdicts?))?$/);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (!m) {
      return new Response("brand-studio share server. POST /share -> {url}", {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
      });
    }
    const [, id, tail] = m;

    // POST /share — publish a self-contained board HTML, get a link back.
    if (!id && req.method === "POST") {
      const html = await req.text();
      if (!html || html.length > 4_000_000) return json({ error: "empty or >4MB" }, 400);
      const newId = fnv1a(html); // content-derived => idempotent republish
      await touch(env, `s:${newId}`, html);
      return json({ id: newId, url: `${url.origin}/share/${newId}` });
    }
    if (!id) return json({ error: "not found" }, 404);

    // POST /share/:id/verdict — one reviewer's decisions.
    if (tail === "verdict" && req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!body.name || !Array.isArray(body.decisions)) {
        return json({ error: "need {name, decisions[]}" }, 400);
      }
      body.ts = new Date().toISOString();
      const boardKey = `s:${id}`;
      const board = await env.SHARES.get(boardKey);
      if (board === null) return json({ error: "share expired" }, 410);
      await touch(env, `v:${id}:${slug(body.name)}`, JSON.stringify(body));
      await touch(env, boardKey, board); // activity re-arms the board too
      return json({ ok: true, name: body.name, count: body.decisions.length });
    }

    // GET /share/:id/verdicts — merged submissions (agent-readable).
    if (tail === "verdicts" && req.method === "GET") {
      const list = await env.SHARES.list({ prefix: `v:${id}:` });
      const submissions = [];
      for (const k of list.keys) {
        const v = await env.SHARES.get(k.name);
        if (v) submissions.push(JSON.parse(v));
      }
      submissions.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
      return json({ id, count: submissions.length, submissions });
    }

    // GET /share/:id — serve the board, re-arm its TTL.
    if (!tail && req.method === "GET") {
      const html = await env.SHARES.get(`s:${id}`);
      if (html === null) {
        return new Response("这个 share 已过期(闲置超过 1 天)或不存在。", {
          status: 410,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      await touch(env, `s:${id}`, html);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
