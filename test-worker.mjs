// Smoke test: fake KV, real worker. Run: node test-worker.mjs
import assert from "node:assert/strict"
import worker from "./worker.js"

const store = new Map()
const env = {
  SHARES: {
    async put(k, v) { store.set(k, v) },
    async get(k) { return store.has(k) ? store.get(k) : null },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) } },
  },
}
const F = (url, init) => worker.fetch(new Request(url, init), env)
const O = "https://x.test"

// publish round 1 + 2 of a series
const r1 = await (await F(`${O}/share?series=demo&round=1&title=first`, { method: "POST", body: "<p>one</p>" })).json()
const r2 = await (await F(`${O}/share?series=demo&round=2&title=second`, { method: "POST", body: "<p>two</p>" })).json()
assert.equal(r1.url, `${O}/s/demo`, "publish returns the stable series link, not a pinned id link")
assert.notEqual(r1.id, r2.id)

// /s/<slug> SERVES the newest round in place — no redirect, so refresh stays newest
const live = await F(`${O}/s/demo`)
assert.equal(live.status, 200, "no 302: the slug URL is the page")
const html = await live.text()
assert.match(html, /<p>two<\/p>/, "serves the newest round")
assert.match(html, /id="bs-top"/, "series chrome injected")
assert.match(html, /data-live="1"/, "newest round reads as Live")

// verdicts work through the slug route — boards post to location.pathname + /verdict
const v = await F(`${O}/s/demo/verdict`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "jackson", decisions: [{ item: "a", verdict: "keep" }] }),
})
assert.equal(v.status, 200)
assert.equal((await v.json()).id, r2.id, "slug verdict lands on the newest round's id")
const agg = await (await F(`${O}/s/demo/verdicts`)).json()
assert.equal(agg.count, 1)

// a pinned old-round link still renders, and says so
const pinned = await (await F(`${O}/share/${r1.id}?series=demo`)).text()
assert.match(pinned, /<p>one<\/p>/)
assert.match(pinned, /data-live="0"/, "older round reads as Pinned")
assert.match(pinned, new RegExp(`href="${O}/s/demo"`), "pinned round links back to the live URL")

// publishing round 3 moves /s/demo without touching the sent link
await F(`${O}/share?series=demo&round=3&title=third`, { method: "POST", body: "<p>three</p>" })
assert.match(await (await F(`${O}/s/demo`)).text(), /<p>three<\/p>/, "same URL, newest round")

// index.json + plain (non-series) share still work
assert.equal((await (await F(`${O}/s/demo/index.json`)).json()).rounds.length, 3)
const plain = await (await F(`${O}/share`, { method: "POST", body: "<p>solo</p>" })).json()
assert.equal(plain.url, `${O}/share/${plain.id}`)
assert.equal((await (await F(plain.url)).text()), "<p>solo</p>", "no series => no chrome")

// escaping: a title can't inject markup into the topbar
await F(`${O}/share?series=xss&round=1&title=%3Cimg+src%3Dx%3E`, { method: "POST", body: "<p>z</p>" })
assert.doesNotMatch(await (await F(`${O}/s/xss`)).text(), /<img src=x>/, "title is escaped")

console.log("ok — all share/series/verdict routes pass")
