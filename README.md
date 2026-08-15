<div align="center">

<img src="site/mark.svg" width="72" alt="">

# artifact-share

**Publish an HTML page. Get the verdicts back.**

[share.sma1lboy.me](https://share.sma1lboy.me) · Cloudflare Worker + KV · ~200 lines

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Sma1lboy/artifact-share)

</div>

An agent builds a self-contained HTML page — a review board, a diff, a report —
and `POST`s it. Out comes a public link anyone can open. They decide in the
browser; the agent reads those decisions back as JSON.

No account, no build step, no dashboard. Links expire after a day idle.

```bash
# publish
curl -X POST https://share.sma1lboy.me/share --data-binary @board.html
# {"id":"a3f10c88b2e94d71","url":"https://share.sma1lboy.me/share/a3f10c88b2e94d71"}

# …reviewers open it, click, submit…

# collect
curl https://share.sma1lboy.me/share/a3f10c88b2e94d71/verdicts
# {"id":"…","count":2,"submissions":[{"name":"jackson","decisions":[…]}]}
```

## API

| Method + path | Purpose |
| --- | --- |
| `POST /share[?series=&round=&title=&by=]` (body = self-contained HTML, ≤4MB) | Publish a page → `{id, url}`. Content-derived id, so republishing is idempotent. `series`/`round`/`title` file it under a stable slug; `by` is the publisher's name, shown in the injected topbar. |
| `GET /share/<id>` | Serve the page, re-arm its TTL. `410` when expired. With `?series=` a thin topbar (round history, share button) is prepended — stored HTML is never rewritten. |
| `POST /share/<id>/verdict` (`{name, decisions[], next?}`) | One reviewer's submission; keyed by name, so resubmitting overwrites. |
| `GET /share/<id>/verdicts` | Every submission merged: `{id, count, submissions[]}`. This is what an agent polls. |
| `GET /s/<slug>` | One stable URL per series — 302s to the newest round. `/s/<slug>/index.json` lists the history. |

## Lifetime

Every key is written with `expirationTtl = 86400`. Any hit (page view, verdict
submit) re-arms both the page and its verdicts, so an active review lives on and
an idle one dies after a day. Republish the same content — same id — to revive it.

## Constraints, on purpose

- **No auth.** Ids are unguessable 64-bit content hashes; treat a link as a
  capability token. Combined with the short TTL, there is nothing worth stealing.
- **No renderer.** The server stores bytes and hands them back. Pages must be
  self-contained: inline CSS, inline SVG, data-URI images.
- **No dashboard.** The agent that published a link is what reads it back. A
  series slug is the only index that exists.

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

## Board template

Any self-contained HTML works. A page becomes *interactive* by wiring two fetches:

```js
fetch(location.pathname + "/verdict", {           // submit
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, decisions, next }),
})
fetch(location.pathname + "/verdicts")            // aggregate
```

[brand-studio](https://github.com/Sma1lboy/brand-studio) ships a ready-made
round-review board wired to exactly this transport, and consumes this repo as a
submodule.

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
