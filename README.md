<div align="center">

<img src="site/mark.svg" width="72" alt="">

# artifact-share

**Publish an HTML page. Get the verdicts back.**

[share.sma1lboy.me](https://share.sma1lboy.me) · Cloudflare Worker + KV · ~200 lines

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

## Self-host

**[Fork this repo](https://github.com/Sma1lboy/artifact-share/fork) first**, then
deploy your fork — that way your hostname, TTL, and any board tweaks travel with
you, and you can pull upstream fixes later.

```bash
git clone https://github.com/<you>/artifact-share
cd artifact-share
bunx wrangler kv namespace create SHARES   # paste the id into wrangler.toml
bunx wrangler deploy
```

That's the whole deploy. It fits inside the Cloudflare free tier (100k Worker
requests/day, 1k KV writes/day) and there is no container, no always-on process,
and no database to operate.

Point `routes` at your own hostname, or delete the `routes` block entirely and use
the `*.workers.dev` subdomain you get for free. The landing page lives in `site/`
and is served by the same Worker (`[assets]` + `run_worker_first`, so `/share` and
`/s/*` stay dynamic).

### Hand this to your agent

Fork the repo, then paste the block below into Claude Code / Codex / Cursor from
the clone. It covers the whole setup including the parts that are easy to miss
(the KV id has to be pasted back into `wrangler.toml`, and the custom domain must
already be a zone on your Cloudflare account).

``````text
Deploy this artifact-share fork to my own Cloudflare account.

Steps:
1. Check `bunx wrangler whoami`. If not logged in, run `bunx wrangler login`
   and wait for me to finish the browser flow.
2. Create the KV namespace: `bunx wrangler kv namespace create SHARES`.
   Take the `id` it prints and write it into `wrangler.toml` under
   `[[kv_namespaces]]` — replacing the existing id, which is mine, not yours.
3. In `wrangler.toml`, set `name` to something unique to me, and either:
   - point `routes` at a hostname whose zone is already on my Cloudflare
     account, or
   - delete the `routes` block entirely to use the free `*.workers.dev` subdomain.
   Ask me which, and tell me the resulting URL either way.
4. Run `bunx wrangler deploy --dry-run` first and show me the bindings it
   reports. Only if both SHARES and ASSETS are bound, run `bunx wrangler deploy`.
5. Smoke-test the deployed URL end to end and show me the output:
   - `GET /` returns the landing page (200, text/html)
   - `POST /share` with a small HTML body returns `{id, url}`
   - `GET /share/<id>` returns that HTML
   - `POST /share/<id>/verdict` with `{"name":"test","decisions":[]}` returns ok
   - `GET /share/<id>/verdicts` shows the submission
6. Do NOT commit the KV id if this fork is public and I say I want it private —
   ask before committing `wrangler.toml`.

Constraints: don't add dependencies, don't restructure the worker, don't change
the TTL unless I ask. If a step fails, stop and show me the actual error rather
than working around it.
``````

> **Not Railway/Vercel/Fly.** This runs on the Cloudflare Workers runtime and
> stores state in Workers KV — there's no Node server to boot and no `env.SHARES`
> outside Cloudflare. Porting it to a container host means replacing the storage
> layer (Redis or Postgres) and rewriting the entrypoint as an HTTP server. Doable,
> but that's a fork with a different shape, not a config change.

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

## Origin

Built for brand-studio, which needed to put a round of generated logo candidates
in front of several people and read the keep/kill decisions back without anyone
opening a tool. Nothing about that is specific to brand assets, so it lives on
its own.

## License

MIT
