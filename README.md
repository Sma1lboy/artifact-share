# brand-studio share server

Multi-reviewer round boards at `https://brand-studio.sma1lboy.me/share/<id>`,
so a review round can be shared as one public link and the agent can read the
verdicts back directly — no artifact private-wall, no copy/paste shuttle.

Cloudflare Worker + KV (`worker.js`, deployed via `bunx wrangler deploy` from
this directory; uses the wrangler OAuth login, not `CLOUDFLARE_API_TOKEN`).
Modeled on the mc-launcher share store: content-derived FNV-1a ids, idempotent
republish. No auth by design — org-internal links, short TTL.

## Lifetime

Every key is written with `expirationTtl = 86400`. Any hit (board view, verdict
submit) re-arms both the board and its verdicts, so an active review lives on;
an idle share dies after one day. Republish (same content → same id) to revive.

## API

| Method + path | Purpose |
| --- | --- |
| `POST /share[?series=&round=&title=&by=]` (body = self-contained HTML, ≤4MB) | Publish a board → `{id, url}`. Content-derived id, idempotent. `series/round/title` register it in a series (round switcher + `/s/<slug>` picker); `by` is the publisher's everyday name, shown in the injected topbar ("Board by jackson") and the series page. |
| `GET /share/<id>` | Serve the board (re-arms TTL). `410` when expired. |
| `POST /share/<id>/verdict` (`{name, decisions[], next?}`) | One reviewer's submission; keyed by name, resubmit overwrites. |
| `GET /share/<id>/verdicts` | Merged submissions, agent-readable: `{id, count, submissions[]}`. |

## Board template

`skills/brand-studio/assets/share-review.html` — the round-review board wired
to this transport (submit → `POST <path>/verdict`, aggregate → `GET
<path>/verdicts`, drafts in `localStorage`). Fill `__ITEMS_JSON__` (items with
inline `svg` markup or data-URI `jpg`) and `__GOAL__`, then `POST /share` the
result. The board must stay self-contained: inline SVGs / data-URI images only.
