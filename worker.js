// artifact-share — Cloudflare Worker + KV.
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

const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  )

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

// Two layered plates — a board and the round behind it. Transport chrome only:
// the board's own identity lives inside the board HTML, which we never touch.
const MARK =
  `<a href="/" title="artifact-share" class="bs-mk"><svg viewBox="0 0 120 120" width="22" height="22" aria-hidden="true">` +
  `<rect x="44" y="16" width="60" height="60" rx="13" fill="none" stroke="#191713" stroke-width="9" opacity=".34"/>` +
  `<rect x="16" y="44" width="60" height="60" rx="13" fill="#191713"/></svg></a>`

// Outer chrome injected above a board (claude.ai-artifact style): mark,
// round-history dropdown, share button. Pure prepend — board HTML untouched.
//
// `canonical` is the /s/<slug> link — the one that always resolves to the
// newest round. Share copies THAT, never location.href, because a pinned
// /share/<id> link freezes whoever you send it to on today's round.
function topbar(canonical, slugName, list, curId) {
  const cur = list.find((e) => e.id === curId) || {}
  const latest = list[list.length - 1] || {}
  const live = latest.id === curId
  const items = [...list]
    .reverse()
    .map(
      (e) =>
        `<a class="bs-it${e.id === curId ? " bs-on" : ""}" href="${e.id === latest.id ? canonical : canonical.replace(/\/s\/[\w-]+$/, "/share/" + e.id) + "?series=" + slugName}">` +
        `<span class="bs-rd">${esc(e.round)}</span>` +
        `<span class="bs-tt">${esc(e.title) || "&mdash;"}</span>` +
        `${e.id === latest.id ? '<em class="bs-lt">Latest</em>' : ""}` +
        `${e.id === curId && e.id !== latest.id ? '<em class="bs-pn">Viewing</em>' : ""}` +
        `<time>${esc((e.ts || "").slice(0, 10))}</time></a>`,
    )
    .join("")
  return `<div id="bs-top" data-live="${live ? "1" : "0"}">
<style>
/* NOTE: this block lives inside a template literal. Keep backticks and dollar-brace
   interpolation out of these comments, or the literal closes early / interpolates and
   the worker fails to build. Both mistakes were made writing this very comment.

   color-scheme:light is load-bearing, not cosmetic. A <button> does not inherit
   color — the UA supplies buttontext — and this chrome is injected above a page we
   do not control. The moment that page declares support for dark, which is just a
   <meta name="color-scheme" content="light dark">, a dark-mode browser resolves
   buttontext to WHITE and the round title and the Share button vanish against this
   cream. Measured, not guessed: both computed to rgb(255,255,255) here.
   Pinning the scheme keeps every UA-supplied color (button text, scrollbars, focus
   rings) in the same light world the rest of these hex values live in; the explicit
   color:inherit on each button is the belt to that suspenders.

   The warm-paper palette does NOT follow the board into dark mode, on purpose: it is
   the frame that identifies the series across rounds, and a frame that changed with
   its contents would stop reading as the same frame. */
#bs-top{--bs-cream:#FCF8F1;--bs-ink:#191713;--bs-line:#E2D8C8;--bs-mut:#7A7166;--bs-hov:#F0E8DA;--bs-live:#2E7D4F;--bs-pin:#B4522F;
  position:fixed;top:0;left:0;right:0;height:48px;z-index:2147483000;color-scheme:light;
  background:var(--bs-cream);border-bottom:1px solid var(--bs-line);
  box-shadow:0 1px 0 rgba(25,23,19,.02),0 6px 18px -14px rgba(25,23,19,.5);
  display:flex;align-items:center;gap:10px;padding:0 12px;
  font:13.5px/1.4 -apple-system,"PingFang SC",sans-serif;color:var(--bs-ink)}
#bs-top .bs-mk{display:flex;flex:0 0 auto;opacity:.9;transition:opacity .15s}
#bs-top .bs-mk:hover{opacity:1}
#bs-top .bs-t{display:flex;align-items:center;gap:8px;min-width:0;max-width:min(52vw,560px);
  padding:6px 10px;border-radius:9px;border:1px solid transparent;background:transparent;
  font:inherit;color:inherit;cursor:pointer;transition:background .14s,border-color .14s}
#bs-top .bs-t:hover{background:var(--bs-hov);border-color:var(--bs-line)}
#bs-top .bs-t[aria-expanded="true"]{background:var(--bs-hov);border-color:var(--bs-line)}
#bs-top .bs-sl{font-weight:700;white-space:nowrap}
#bs-top .bs-sep{color:var(--bs-line)}
#bs-top .bs-cu{color:var(--bs-mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#bs-top .bs-ch{opacity:.5;flex:0 0 auto;transition:transform .18s}
#bs-top .bs-t[aria-expanded="true"] .bs-ch{transform:rotate(180deg)}
/* State chip. Live = this URL re-resolves to the newest round on every refresh.
   Pinned = you are looking at an older round through a frozen /share/<id> link. */
#bs-top .bs-st{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;
  font-size:11.5px;font-weight:600;letter-spacing:.02em;padding:3px 9px 3px 7px;border-radius:99px;
  border:1px solid;text-decoration:none}
#bs-top .bs-st b{width:6px;height:6px;border-radius:99px;background:currentColor}
#bs-top[data-live="1"] .bs-st{color:var(--bs-live);border-color:color-mix(in srgb,var(--bs-live) 32%,transparent);background:color-mix(in srgb,var(--bs-live) 8%,transparent)}
#bs-top[data-live="1"] .bs-st b{animation:bs-pulse 2.4s ease-in-out infinite}
#bs-top[data-live="0"] .bs-st{color:var(--bs-pin);border-color:color-mix(in srgb,var(--bs-pin) 34%,transparent);background:color-mix(in srgb,var(--bs-pin) 9%,transparent)}
#bs-top[data-live="0"] .bs-st:hover{background:color-mix(in srgb,var(--bs-pin) 16%,transparent)}
@keyframes bs-pulse{0%,100%{opacity:1}50%{opacity:.32}}
@media (prefers-reduced-motion:reduce){#bs-top *{animation:none!important;transition:none!important}}
#bs-top .bs-by{color:var(--bs-mut);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bs-top .bs-share{margin-left:auto;flex:0 0 auto;font:inherit;color:inherit;font-weight:600;
  padding:6px 15px;border-radius:9px;border:1px solid var(--bs-ink);background:transparent;cursor:pointer;
  transition:background .14s,color .14s}
#bs-top .bs-share:hover{background:var(--bs-ink);color:var(--bs-cream)}
#bs-top .bs-share:active{transform:translateY(.5px)}
@media (max-width:640px){
  #bs-top{gap:8px;padding:0 10px}
  #bs-top .bs-by{display:none}
  #bs-top .bs-st span{display:none}
  #bs-top .bs-st{padding:3px 7px}
}
/* #bs-pop nests inside #bs-top, so it already inherits that color — the pin here is
   only so the popup survives being moved out of the topbar later. */
#bs-pop{position:fixed;top:54px;left:12px;z-index:2147483000;color-scheme:light;
  background:#fff;color:#191713;border:1px solid #E2D8C8;border-radius:13px;
  box-shadow:0 1px 2px rgba(25,23,19,.05),0 16px 40px -12px rgba(25,23,19,.26);
  min-width:340px;max-width:min(92vw,440px);max-height:min(66vh,520px);overflow:auto;
  padding:6px;display:none}
#bs-pop.bs-open{display:block;animation:bs-in .16s cubic-bezier(.2,.8,.3,1)}
@keyframes bs-in{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}
#bs-pop h4{margin:8px 10px 6px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:#A79C8D;font-weight:700}
#bs-pop .bs-it{display:flex;gap:9px;align-items:baseline;padding:9px 10px;border-radius:9px;color:inherit;text-decoration:none}
#bs-pop .bs-it:hover{background:#F5EFE4}
#bs-pop .bs-it.bs-on{background:#F0E8DA}
#bs-pop .bs-rd{flex:0 0 auto;min-width:22px;font-variant-numeric:tabular-nums;font-weight:700;font-size:12.5px}
#bs-pop .bs-rd::before{content:"#"; color:#C4B8A6; font-weight:600}
#bs-pop .bs-tt{color:#5C5449;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}
#bs-pop .bs-it em{font-style:normal;font-size:11px;font-weight:700;letter-spacing:.02em;
  padding:2px 7px;border-radius:99px;flex:0 0 auto}
#bs-pop .bs-lt{color:#2E7D4F;background:rgba(46,125,79,.10)}
#bs-pop .bs-pn{color:#B4522F;background:rgba(180,82,47,.10)}
#bs-pop .bs-it time{margin-left:auto;color:#A79C8D;font-size:11.5px;font-variant-numeric:tabular-nums;flex:0 0 auto}
#bs-pop .bs-ft{margin:4px 10px 8px;font-size:11.5px;line-height:1.5;color:#A79C8D}
</style>
${MARK}
<button class="bs-t" id="bs-tbtn" aria-haspopup="menu" aria-expanded="false" aria-controls="bs-pop">
<span class="bs-sl">${esc(slugName)}</span><span class="bs-sep">/</span>
<span class="bs-cu">round ${esc(cur.round || "?")}${cur.title ? " · " + esc(cur.title) : ""}</span>
<svg class="bs-ch" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3 L5 7 L9 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></button>
${
  live
    ? `<span class="bs-st" title="This link always resolves to the newest round"><b></b><span>Live</span></span>`
    : `<a class="bs-st" href="${canonical}" title="You are on a pinned round — go to the newest"><b></b><span>Pinned &middot; latest &rarr;</span></a>`
}
${cur.by ? `<span class="bs-by">by ${esc(cur.by)}</span>` : ""}
<button class="bs-share" id="bs-shr">Share</button>
<div id="bs-pop" role="menu"><h4>Round history</h4>${items}<p class="bs-ft">The shared link always opens the newest round.</p></div>
</div>
<script>
(function(){
  var CANON = ${JSON.stringify(canonical)};
  document.body.style.paddingTop = "48px";
  document.addEventListener("DOMContentLoaded", function(){
    var nav = document.getElementById("roundNav"); if (nav) nav.style.display = "none";
  });
  var pop = document.getElementById("bs-pop"), btn = document.getElementById("bs-tbtn");
  function setOpen(on){ pop.classList.toggle("bs-open", on); btn.setAttribute("aria-expanded", on ? "true" : "false"); }
  btn.addEventListener("click", function(e){ e.stopPropagation(); setOpen(!pop.classList.contains("bs-open")); });
  document.addEventListener("click", function(){ setOpen(false); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") setOpen(false); });
  document.getElementById("bs-shr").addEventListener("click", function(){
    var b = document.getElementById("bs-shr");
    (navigator.clipboard ? navigator.clipboard.writeText(CANON) : Promise.reject()).then(
      function(){ b.textContent = "已复制 \\u2713"; setTimeout(function(){ b.textContent = "Share"; }, 1600); },
      function(){ prompt("复制链接:", CANON); });
  });
})();
</script>`
}

// Serve a stored board, re-arm its TTL, and prepend series chrome when the
// board belongs to one. Shared by /share/<id> and /s/<slug> so both routes
// render identically — only the address bar differs.
async function serveBoard(env, id, seriesName, canonical) {
  const html = await env.SHARES.get(`s:${id}`)
  if (html === null) {
    return new Response("这个 share 已过期(闲置超过 1 天)或不存在。", {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
  await touch(env, `s:${id}`, html)
  let body = html
  if (seriesName) {
    const raw = await env.SHARES.get(`x:${seriesName}`)
    const list = raw ? JSON.parse(raw) : []
    if (list.length) body = topbar(canonical, seriesName, list, id) + html
  }
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

    let id = null
    let tail = null
    let seriesName = null
    let canonical = null

    // Series routes: /s/<slug> SERVES the newest round in place — it does not
    // redirect. A redirect put a frozen /share/<id> in the address bar, so a
    // refresh (or a bookmark, or a re-send) stayed on whatever round was newest
    // the first time it was opened. Resolving the slug to an id here instead
    // keeps the URL stable, so refresh is always the newest round — and
    // /s/<slug>/verdict(s) work, which matters because boards post to
    // location.pathname + "/verdict".
    const sm = url.pathname.match(/^\/s\/([\w-]{1,64})(?:\/(index\.json|verdicts?))?$/)
    if (sm) {
      const [, name, sub] = sm
      const raw = await env.SHARES.get(`x:${name}`)
      const list = raw ? JSON.parse(raw) : []
      if (raw) await touch(env, `x:${name}`, raw)
      if (sub === "index.json") {
        if (req.method !== "GET") return json({ error: "method not allowed" }, 405)
        return json({ series: name, rounds: list })
      }
      const latest = list[list.length - 1]
      if (!latest) return new Response("series not found (or expired)", { status: 404 })
      id = latest.id
      tail = sub || null
      seriesName = name
      canonical = `${url.origin}/s/${name}`
    } else {
      const m = url.pathname.match(/^\/share(?:\/([0-9a-f]{16}))?(?:\/(verdicts?))?$/)
      if (!m) {
        return new Response("artifact-share. POST /share -> {url}. See / for docs.", {
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
        })
      }
      ;[, id, tail] = m
      id = id || null
      tail = tail || null
      seriesName = (url.searchParams.get("series") || "").match(/^[\w-]{1,64}$/)?.[0] || null
      // A /share/<id> link is a pinned round; the stable link for the series is
      // always /s/<slug>, and that is what Share copies.
      canonical = seriesName ? `${url.origin}/s/${seriesName}` : `${url.origin}/share/${id}`

      // POST /share[?series=<slug>&round=<n>&title=<t>] — publish a board.
      if (!id && req.method === "POST") {
        const html = await req.text()
        if (!html || html.length > 4_000_000) return json({ error: "empty or >4MB" }, 400)
        const newId = fnv1a(html) // content-derived => idempotent republish
        await touch(env, `s:${newId}`, html)
        let shareUrl = `${url.origin}/share/${newId}`
        if (seriesName) {
          await seriesUpsert(env, seriesName, {
            round: url.searchParams.get("round") || "1",
            title: url.searchParams.get("title") || "",
            by: (url.searchParams.get("by") || "").slice(0, 40),
            id: newId,
            ts: new Date().toISOString(),
          })
          // The link worth sending is the series one — it survives the next round.
          shareUrl = `${url.origin}/s/${seriesName}`
        }
        return json({
          id: newId,
          url: shareUrl,
          series: seriesName || null,
          round: `${url.origin}/share/${newId}${seriesName ? `?series=${seriesName}` : ""}`,
        })
      }
      if (!id) return json({ error: "not found" }, 404)
    }

    // POST .../verdict — one reviewer's decisions, keyed to the resolved board.
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
      return json({ ok: true, id, name: body.name, count: body.decisions.length })
    }

    // GET .../verdicts — merged submissions (agent-readable).
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

    if (!tail && req.method === "GET") return serveBoard(env, id, seriesName, canonical)

    return json({ error: "method not allowed" }, 405)
  },
}
