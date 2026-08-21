<div align="center">

<img src="site/mark.svg" width="72" alt="">

# artifact-share

**A `curl` away from a public link for any HTML you have.**

[share.sma1lboy.me](https://share.sma1lboy.me) · Cloudflare Worker + KV · ~200 lines

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Sma1lboy/artifact-share)

</div>

You have an HTML file — a report your agent generated, a diff, a chart, a mockup.
You want someone else to look at it. Everything else is heavy: commit it to a repo
and wait for a deploy, paste it into a gist that renders as source, spin up a
bucket, or screenshot it into a chat and lose the interactivity.

```bash
curl -X POST https://share.sma1lboy.me/share --data-binary @report.html
# {"id":"a3f10c88b2e94d71","url":"https://share.sma1lboy.me/share/a3f10c88b2e94d71"}
```

That's it. Send the URL. Whoever opens it sees the page, JavaScript and all. No
account on either end, no build step, nothing to install.

Links expire after a day idle, which is the point — this is a transit desk, not
a host.

## The core: two endpoints

| Method + path | Purpose |
| --- | --- |
| `POST /share` (body = self-contained HTML, ≤4MB) | Publish → `{id, url}`. The id is a hash of the content, so re-POSTing the same page returns the same link. |
| `GET /share/<id>` | Serve it back, re-arming the TTL. `410` once it has lapsed. |

Everything below is optional and layered on top.

## Series: one stable URL across revisions

If you're publishing revisions of the same thing, a fresh link each time means
whoever you sent v1 to is still looking at v1.

```bash
curl -X POST "https://share.sma1lboy.me/share?series=q3-report&round=2&title=after+feedback" \
     --data-binary @report.html
```

| Method + path | Purpose |
| --- | --- |
| `GET /s/<slug>` | 302s to the newest round. A link you sent last week lands on today's page. |
| `GET /s/<slug>/index.json` | The round history, as JSON. |

Serving a page with `?series=` prepends a thin topbar (revision dropdown, share
button). Your stored HTML is never rewritten — the chrome is added at read time.

`?by=<name>` puts a byline in that topbar.

## Verdicts: collect decisions on the page

**Optional.** ~25 of the worker's ~200 lines. Skip this section entirely if you
just want to share a page.

If the page you publish is something people need to *decide* on — approve/reject,
keep/kill, pick one of N — you can collect those decisions instead of chasing
replies:

| Method + path | Purpose |
| --- | --- |
| `POST /share/<id>/verdict` (`{name, decisions[], next?}`) | One person's submission; keyed by name, so resubmitting overwrites rather than duplicates. |
| `GET /share/<id>/verdicts` | Everything merged: `{id, count, submissions[]}`. Poll this. |

The server does not care what's in `decisions[]` — it stores and returns the
array as-is. Wire the two fetches into your page and the shape is yours:

```js
fetch(location.pathname + "/verdict", {           // submit
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, decisions, next }),
})
fetch(location.pathname + "/verdicts")            // aggregate
```

[brand-studio](https://github.com/Sma1lboy/brand-studio) is the reason this layer
exists: it publishes rounds of generated brand candidates and reads keep/kill
decisions back. It ships a ready-made board wired to exactly these two calls.

## Lifetime

Every key is written with `expirationTtl = 86400`. Any hit — page view or verdict
submit — re-arms it, so the clock measures **idle**, not age: an active link never
expires under you, an abandoned one disappears. Republish the same content (same
id) to revive a dead link.

## Constraints, on purpose

- **No auth.** Ids are unguessable 64-bit content hashes; treat a link as a
  capability token, the way you'd treat a doc link. Combined with the short TTL,
  there is nothing worth stealing.
- **No renderer.** The server stores bytes and hands them back. Pages must be
  self-contained: inline CSS, inline SVG, data-URI images.
- **No dashboard.** There's nowhere to log in and browse what you've published.
  Whatever published a link is what reads it back; a series slug is the only
  index that exists.

## Both themes, because nothing here supplies one

"No renderer" has a second half people discover late: the server never touches
your colors, so a page that only designed one theme *is* a page that looks wrong
to half the people you send it to. Whoever opens the link is on whatever their OS
says, and that is the only signal in play.

Define the palette as custom properties on `:root`, style components through those
tokens, and redefine **only the tokens** in the dark block:

```css
:root{ --bg:#faf9f7; --ink:#16150f; --accent:#2f5fd0; }
@media (prefers-color-scheme:dark){
  :root{ --bg:#131316; --ink:#eceae4; --accent:#7ea1f5; }
}
.card{ background:var(--bg); color:var(--ink); }   /* never restyled per theme */
```

Give the second theme the same care as the first — don't invert. An accent that
carries on paper usually goes muddy on a dark ground and needs to lift, the way
`#2f5fd0` becomes `#7ea1f5` above.

A page may deliberately commit to a single visual world — a neon terminal, a
letterpress invitation. That is a choice; shipping one theme because you forgot
the other is not.

Two things differ here from a claude.ai artifact, and copying that advice across
gets both wrong:

- **There is no CSP.** External font and script URLs work. They still cost a
  round trip and fail silently offline, so a system stack or an inlined
  `@font-face` data URI is the better default — but it is a performance call,
  not a hard wall.
- **There is no theme toggle.** `:root[data-theme="dark"]` has nothing on this
  server to stamp it. `prefers-color-scheme` is the whole mechanism.

The topbar injected above a `?series=` page keeps its own warm-paper palette in
both themes, on purpose: it is chrome that identifies the board across rounds,
and a topbar that changed with the page would stop reading as the same frame.

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Sma1lboy/artifact-share)

**Click the button.** Cloudflare forks this repo into your GitHub account, creates
the KV namespace, wires the binding, and deploys — you get a working
`https://artifact-share.<your-subdomain>.workers.dev` at the end. There is nothing
to paste and no config to edit.

Free tier covers it: 100k Worker requests/day, 1k KV writes/day. No container, no
always-on process, no database bill.

<details>
<summary><b>Prefer the CLI?</b></summary>

```bash
git clone https://github.com/<you>/artifact-share   # fork first
cd artifact-share
bunx wrangler deploy
```

`wrangler.toml` declares `SHARES` **without an id on purpose** — Wrangler
provisions a fresh namespace on first deploy and writes the id back for you. Don't
paste anyone else's id in.

</details>

### The three settings

Everything else is defaults. These are the only knobs, and you can ignore all
three to start.

| Setting | Where | Default |
| --- | --- | --- |
| **Custom domain** | `routes` in `wrangler.toml` (commented out) | free `*.workers.dev` URL |
| **Link lifetime** | `TTL` at the top of `worker.js` | `86400` — 1 day idle |
| **Max page size** | the `4_000_000` check in `worker.js` | 4 MB |

**Custom domain.** Uncomment the `routes` block and put your hostname in. The zone
has to already be on your Cloudflare account — a domain you own but haven't added
to Cloudflare won't work.

```toml
routes = [
  { pattern = "share.example.com", custom_domain = true },
]
```

**Link lifetime.** Every key is written with `expirationTtl = TTL` and any hit
re-arms it, so the clock measures *idle*, not age. Raise it if reviews in your team
sit for a week; lower it if you want links to die faster.

**Max page size.** Boards with a lot of inlined data-URI images get big. KV's hard
ceiling is 25 MB per value, so you have room to raise this — but a board that large
is slow to open, and slicing the round in two is usually the better fix.

<details>
<summary><b>Hand the whole thing to your agent instead</b></summary>

If you'd rather not click through the Cloudflare UI, paste this into Claude Code /
Codex / Cursor from your clone:

``````text
Deploy this artifact-share fork to my own Cloudflare account.

Steps:
1. Check `bunx wrangler whoami`. If not logged in, run `bunx wrangler login`
   and wait for me to finish the browser flow.
2. In `wrangler.toml`, set `name` to something unique to me. Leave the
   `[[kv_namespaces]]` block WITHOUT an id — Wrangler provisions a fresh
   namespace on first deploy and writes the id back. Do not paste in an id.
3. Ask me whether I want a custom domain:
   - yes → uncomment `routes` and use my hostname; tell me the zone must
     already be on my Cloudflare account
   - no  → leave it commented; I get a free *.workers.dev URL
4. Run `bunx wrangler deploy --dry-run` and show me the bindings. Only if both
   SHARES and ASSETS are bound, run `bunx wrangler deploy`. Tell me the URL.
5. Smoke-test the deployed URL end to end and show me the actual output:
   - `GET /` returns the landing page (200, text/html)
   - `POST /share` with a small HTML body returns {id, url}
   - `GET /share/<id>` returns that HTML back
   - `POST /share/<id>/verdict` with {"name":"test","decisions":[]} returns ok
   - `GET /share/<id>/verdicts` shows that submission
6. If `wrangler.toml` now has a KV id in it, ask me before committing —
   it's harmless to publish, but it's my namespace.

Constraints: don't add dependencies, don't restructure the worker, don't change
the TTL unless I ask. If a step fails, stop and show me the real error instead
of working around it.
``````

</details>

> **Cloudflare only — not Railway/Vercel/Fly.** The entrypoint is
> `export default { fetch }` (the Workers runtime contract, not a Node server that
> listens on a port), and all state lives in `env.SHARES`, a Workers KV binding the
> platform injects. On a container host there is nothing to boot and that binding is
> undefined. Porting means rewriting the entrypoint as an HTTP server and replacing
> KV with Redis or Postgres — including its TTL semantics and prefix scans. That's a
> different project, not a config change.

## Maintainer note

`share.sma1lboy.me` deploys from `wrangler.production.toml`, which pins the real
KV namespace and the custom domain:

```bash
bunx wrangler deploy -c wrangler.production.toml
```

A bare `wrangler deploy` here uses `wrangler.toml` instead — which would drop the
custom domain and provision an *empty* namespace, orphaning every live share. The
split exists so the repo can stay one-click deployable for everyone else; the
`-c` flag is the price.

## Origin

Built for brand-studio, which needed to put a round of generated logo candidates
in front of several people and read the keep/kill decisions back without anyone
opening a tool. Nothing about that is specific to brand assets, so it lives on
its own.

## License

MIT
