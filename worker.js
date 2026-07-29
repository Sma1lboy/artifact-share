// brand-studio share server — Cloudflare Worker + KV.
// Shares a self-contained review-board HTML at /share/<id> and collects
// per-reviewer verdicts the agent can read back directly (GET .../verdicts).
// ponytail: no auth by design — org-internal links, content-hash ids, short TTL.

const TTL = 86400 // seconds idle before a share dies; every hit re-arms it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function fnv1a(str) {
  let h = 0xcbf29ce484222325n
  for (const b of new TextEncoder().encode(str)) {
    h ^= BigInt(b)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, "0")
}

const slug = (s) => s.replace(/[^\w一-鿿-]+/g, "_").slice(0, 60)

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  })

async function touch(env, key, value) {
  await env.SHARES.put(key, value, { expirationTtl: TTL })
}

// Series index: `x:<slug>` holds [{round, title, id, ts}] so a whole review
// series lives behind one stable URL with switchable rounds (artifact
// version-history style).
async function seriesUpsert(env, slug, entry) {
  const raw = await env.SHARES.get(`x:${slug}`)
  const list = raw ? JSON.parse(raw) : []
  const i = list.findIndex((e) => String(e.round) === String(entry.round))
  if (i >= 0) list[i] = entry
  else list.push(entry)
  list.sort((a, b) => Number(a.round) - Number(b.round))
  await touch(env, `x:${slug}`, JSON.stringify(list))
  return list
}

// Outer chrome injected above a board (claude.ai-artifact style): org glyph,
// round-history dropdown, share button. Pure prepend — board HTML untouched.
function topbar(origin, slug, list, curId) {
  const cur = list.find((e) => e.id === curId) || {}
  const items = [...list]
    .reverse()
    .map(
      (e) =>
        `<a class="bs-it${e.id === curId ? " bs-on" : ""}" href="${origin}/share/${e.id}?series=${slug}">` +
        `<b>round ${e.round}</b><span>${e.title || ""}</span>` +
        `${e.id === curId ? "<em>Current</em>" : ""}<time>${(e.ts || "").slice(0, 10)}</time></a>`,
    )
    .join("")
  const glyph = `<svg viewBox="0 0 120 120" width="22" height="22" aria-hidden="true"><path fill-rule="evenodd" fill="#191713" d="M60 12 L102 36 V84 L60 108 L18 84 V36 Z M42 68 L37 42 L52 53 H68 L83 42 L78 68 L60 90 Z"/></svg>`
  return `<div id="bs-top">
<style>
#bs-top{position:fixed;top:0;left:0;right:0;height:48px;z-index:99;background:#FCF8F1;border-bottom:1px solid #E2D8C8;display:flex;align-items:center;gap:12px;padding:0 14px;font:13.5px/1.4 -apple-system,"PingFang SC",sans-serif;color:#191713}
#bs-top .bs-t{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;border:none;background:transparent;font:inherit;font-weight:700;cursor:pointer}
#bs-top .bs-t:hover{background:#F0E8DA}
#bs-top .bs-t svg.bs-ch{opacity:.55}
#bs-top .bs-by{color:#7A7166}
#bs-top .bs-share{margin-left:auto;font:inherit;font-weight:600;padding:6px 16px;border-radius:8px;border:1px solid #191713;background:transparent;cursor:pointer}
#bs-top .bs-share:hover{background:#191713;color:#FCF8F1}
#bs-pop{position:fixed;top:52px;left:14px;z-index:99;background:#fff;border:1px solid #E2D8C8;border-radius:12px;box-shadow:0 12px 32px rgba(25,23,19,.14);min-width:320px;padding:6px;display:none}
#bs-pop h4{margin:6px 10px;font-size:12px;color:#7A7166;font-weight:600}
#bs-pop .bs-it{display:flex;gap:8px;align-items:baseline;padding:9px 10px;border-radius:8px;color:inherit;text-decoration:none}
#bs-pop .bs-it:hover{background:#F5EFE4}
#bs-pop .bs-it.bs-on{background:#F0E8DA}
#bs-pop .bs-it span{color:#7A7166;font-size:12.5px}
#bs-pop .bs-it em{font-style:normal;color:#2E7D4F;font-size:11.5px;font-weight:700}
#bs-pop .bs-it time{margin-left:auto;color:#A79C8D;font-size:11.5px;font-variant-numeric:tabular-nums}
</style>
${glyph}
<button class="bs-t" id="bs-tbtn">${slug} · round ${cur.round || "?"}${cur.title ? " · " + cur.title : ""}
<svg class="bs-ch" width="10" height="10" viewBox="0 0 10 10"><path d="M1 3 L5 7 L9 3" stroke="#191713" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></button>
<span class="bs-by">Board${cur.by ? " by " + cur.by : " · brand-studio"}</span>
<button class="bs-share" id="bs-shr">Share</button>
<div id="bs-pop"><h4>Round history</h4>${items}</div>
<script>
(function(){
  document.body.style.paddingTop = "48px";
  document.addEventListener("DOMContentLoaded", function(){
    var nav = document.getElementById("roundNav"); if (nav) nav.style.display = "none";
  });
  var pop = document.getElementById("bs-pop"), btn = document.getElementById("bs-tbtn");
  btn.addEventListener("click", function(e){ e.stopPropagation(); pop.style.display = pop.style.display === "block" ? "none" : "block"; });
  document.addEventListener("click", function(){ pop.style.display = "none"; });
  document.getElementById("bs-shr").addEventListener("click", function(){
    var u = location.href;
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(
      function(){ var b=document.getElementById("bs-shr"); b.textContent="已复制 ✓"; setTimeout(function(){ b.textContent="Share"; }, 1600); },
      function(){ prompt("复制链接:", u); });
  });
})();
</script>
</div>`
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

    // Series routes: GET /s/<slug> 302s to the LATEST round's board (no
    // intermediate picker page — round history lives in the board topbar),
    // GET /s/<slug>/index.json feeds that dropdown.
    const sm = url.pathname.match(/^\/s\/([\w-]{1,64})(\/index\.json)?$/)
    if (sm && req.method === "GET") {
      const [, slug, wantJson] = sm
      const raw = await env.SHARES.get(`x:${slug}`)
      const list = raw ? JSON.parse(raw) : []
      if (raw) await touch(env, `x:${slug}`, raw)
      if (wantJson) return json({ series: slug, rounds: list })
      const latest = list[list.length - 1]
      if (!latest) return new Response("series not found (or expired)", { status: 404 })
      return Response.redirect(`${url.origin}/share/${latest.id}?series=${slug}`, 302)
    }

    const m = url.pathname.match(/^\/share(?:\/([0-9a-f]{16}))?(?:\/(verdicts?))?$/)
    if (!m) {
      return new Response("brand-studio share server. POST /share -> {url}", {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
      })
    }
    const [, id, tail] = m

    // POST /share[?series=<slug>&round=<n>&title=<t>] — publish a board.
    if (!id && req.method === "POST") {
      const html = await req.text()
      if (!html || html.length > 4_000_000) return json({ error: "empty or >4MB" }, 400)
      const newId = fnv1a(html) // content-derived => idempotent republish
      await touch(env, `s:${newId}`, html)
      const series = (url.searchParams.get("series") || "").match(/^[\w-]{1,64}$/)?.[0]
      let shareUrl = `${url.origin}/share/${newId}`
      if (series) {
        await seriesUpsert(env, series, {
          round: url.searchParams.get("round") || "1",
          title: url.searchParams.get("title") || "",
          by: (url.searchParams.get("by") || "").slice(0, 40),
          id: newId,
          ts: new Date().toISOString(),
        })
        shareUrl += `?series=${series}`
      }
      return json({ id: newId, url: shareUrl, series: series || null })
    }
    if (!id) return json({ error: "not found" }, 404)

    // POST /share/:id/verdict — one reviewer's decisions.
    if (tail === "verdict" && req.method === "POST") {
      let body
      try {
        body = await req.json()
      } catch {
        return json({ error: "invalid json" }, 400)
      }
      if (!body.name || !Array.isArray(body.decisions)) {
        return json({ error: "need {name, decisions[]}" }, 400)
      }
      body.ts = new Date().toISOString()
      const boardKey = `s:${id}`
      const board = await env.SHARES.get(boardKey)
      if (board === null) return json({ error: "share expired" }, 410)
      await touch(env, `v:${id}:${slug(body.name)}`, JSON.stringify(body))
      await touch(env, boardKey, board) // activity re-arms the board too
      return json({ ok: true, name: body.name, count: body.decisions.length })
    }

    // GET /share/:id/verdicts — merged submissions (agent-readable).
    if (tail === "verdicts" && req.method === "GET") {
      const list = await env.SHARES.list({ prefix: `v:${id}:` })
      const submissions = []
      for (const k of list.keys) {
        const v = await env.SHARES.get(k.name)
        if (v) submissions.push(JSON.parse(v))
      }
      submissions.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""))
      return json({ id, count: submissions.length, submissions })
    }

    // GET /share/:id — serve the board, re-arm its TTL. With ?series= the
    // server injects an outer chrome topbar (round history dropdown, share),
    // so every board — old or new — gets it without touching stored HTML.
    if (!tail && req.method === "GET") {
      const html = await env.SHARES.get(`s:${id}`)
      if (html === null) {
        return new Response("这个 share 已过期(闲置超过 1 天)或不存在。", {
          status: 410,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        })
      }
      await touch(env, `s:${id}`, html)
      let body = html
      const series = (url.searchParams.get("series") || "").match(/^[\w-]{1,64}$/)?.[0]
      if (series) {
        const raw = await env.SHARES.get(`x:${series}`)
        const list = raw ? JSON.parse(raw) : []
        if (list.length) body = topbar(url.origin, series, list, id) + html
      }
      return new Response(body, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      })
    }

    return json({ error: "method not allowed" }, 405)
  },
}
