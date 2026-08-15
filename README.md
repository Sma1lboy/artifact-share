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

```bash
git clone https://github.com/Sma1lboy/artifact-share
cd artifact-share
bunx wrangler kv namespace create SHARES   # paste the id into wrangler.toml
bunx wrangler deploy
```

Point `routes` at your own hostname, or drop the block and use the
`*.workers.dev` subdomain. The landing page lives in `site/` and is served by the
same Worker (`[assets]` + `run_worker_first`, so `/share` and `/s/*` stay dynamic).

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
