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

// Series index: `x:<slug>` holds [{round, title, id, ts}] so a whole review
// series lives behind one stable URL with switchable rounds (artifact
// version-history style).
async function seriesUpsert(env, slug, entry) {
  const raw = await env.SHARES.get(`x:${slug}`);
  const list = raw ? JSON.parse(raw) : [];
  const i = list.findIndex((e) => String(e.round) === String(entry.round));
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  list.sort((a, b) => Number(a.round) - Number(b.round));
  await touch(env, `x:${slug}`, JSON.stringify(list));
  return list;
}

function seriesPage(origin, slug, list) {
  const rows = [...list].reverse().map((e, i) =>
    `<a href="${origin}/share/${e.id}?series=${slug}"><b>round ${e.round}</b> · ${e.title || ""}${i === 0 ? ' <span class="cur">latest</span>' : ""}<span class="ts">${(e.ts || "").slice(0, 10)}</span></a>`,
  ).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${slug} · rounds</title>
<style>body{font:15px/1.6 -apple-system,"PingFang SC",sans-serif;background:#F3EDE3;color:#191713;max-width:560px;margin:8vh auto;padding:0 20px}
h1{font-size:22px}h1 span{color:#B4532A;font-family:ui-monospace,Menlo,monospace;font-size:13px;letter-spacing:.12em;display:block}
a{display:flex;gap:10px;align-items:baseline;padding:13px 16px;margin:8px 0;background:#FCF8F1;border:1px solid #E2D8C8;border-radius:9px;color:inherit;text-decoration:none}
a:hover{border-color:#191713}.ts{margin-left:auto;color:#7A7166;font-size:12.5px;font-variant-numeric:tabular-nums}
.cur{background:#2E7D4F;color:#fff;border-radius:99px;font-size:11px;padding:1px 8px}</style>
<h1><span>brand-studio · series</span>${slug}</h1>${rows || "<p>还没有任何 round。</p>"}`;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // Series routes: GET /s/<slug> (round picker page), GET /s/<slug>/index.json
    const sm = url.pathname.match(/^\/s\/([\w-]{1,64})(\/index\.json)?$/);
    if (sm && req.method === "GET") {
      const [, slug, wantJson] = sm;
      const raw = await env.SHARES.get(`x:${slug}`);
      const list = raw ? JSON.parse(raw) : [];
      if (raw) await touch(env, `x:${slug}`, raw);
      if (wantJson) return json({ series: slug, rounds: list });
      return new Response(seriesPage(url.origin, slug, list), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const m = url.pathname.match(/^\/share(?:\/([0-9a-f]{16}))?(?:\/(verdicts?))?$/);
    if (!m) {
      return new Response("brand-studio share server. POST /share -> {url}", {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
      });
    }
    const [, id, tail] = m;

    // POST /share[?series=<slug>&round=<n>&title=<t>] — publish a board.
    if (!id && req.method === "POST") {
      const html = await req.text();
      if (!html || html.length > 4_000_000) return json({ error: "empty or >4MB" }, 400);
      const newId = fnv1a(html); // content-derived => idempotent republish
      await touch(env, `s:${newId}`, html);
      const series = (url.searchParams.get("series") || "").match(/^[\w-]{1,64}$/)?.[0];
      let shareUrl = `${url.origin}/share/${newId}`;
      if (series) {
        await seriesUpsert(env, series, {
          round: url.searchParams.get("round") || "1",
          title: url.searchParams.get("title") || "",
          id: newId,
          ts: new Date().toISOString(),
        });
        shareUrl += `?series=${series}`;
      }
      return json({ id: newId, url: shareUrl, series: series || null });
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
