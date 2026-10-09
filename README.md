# OpenVibe.Space

**https://openvibe.space — code and dynamic pages for the OpenVibe network.**

## Purpose

Space is being rebuilt to host **code** and **dynamic pages**, and **spaces**: apps people build
that use their OpenVibe account, the network's services and the SDK.

Nothing is published here yet. The site is honest about that: the home page says what is coming and
nothing else, and no feature is faked.

## The forum moved to OpenVibe.Community

The forum lived here from 3 October 2026 (it moved off Community then). On **2026-10-08 the owner
moved it back**: OpenVibe.Community owns the forum (spaces, threads, posts, votes, categories,
per-space moderators, the Discord relay) again, and Space becomes code hosting and spaces.

So Space keeps no forum code and **every forum URL answers a permanent redirect to the same path and
query on https://openvibe.community**:

| Path | Methods | Status |
| --- | --- | --- |
| `/s`, `/s/*` (pages, feeds) | GET, HEAD | `301` |
| `/s`, `/s/*` | anything else | `308` (the method and body are preserved) |
| `/api/v1/spaces*`, `/api/v1/posts/*`, `/api/v1/space-groups*`, `/api/v1/relay*` | all | `308` |

A redirected bookmark, crawler or API client therefore lands on Community's copy of the same page.
Nothing that is not a forum path redirects.

## What is here today

- **`GET /`** — the home page (server-rendered through the shared OpenVibe Frame), with a clear link to
  the forum at https://openvibe.community/s.
- **Sign-in** — the Network OAuth2 client `space`: `/auth/login|callback|fedcm|logout|me|refresh`.
  No signed-in surface needs it yet; it is kept because the shared navbar signs people in everywhere.
- **Discovery** — `/robots.txt`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml` (the home page alone).
- **Health and release** — `/api/health`, `/api/ready`, `/release.json`, `/metrics` (loopback only).

## Does not own

- the forum, pastes, typed comment threads, Pulse and submissions — OpenVibe.Community's
- identity, accounts and tokens — OpenVibe.Network's
- images, memberships and chat rooms — OpenVibe.Media's, OpenVibe.VIP's and OpenVibe.Chat's

## Depends on

- OpenVibe.Network (SSO, JWKS, the `space` OAuth client)
- OpenVibe.Community (where every forum URL redirects)
- `openvibe-contracts` v0.112.0, `openvibe-sdk` v0.35.0, `openvibe-shared` v2.17.0, pinned by release tarball

## What Space applies from the network: nothing

Space holds **no user content**, so it consumes no network events and has nothing to export or erase:

- **Account export and deletion are gone.** Space's former export/deletion hooks (`network.account.export_requested`,
  `network.account.deleted`) only ever touched the **forum tables** — threads, posts, attachments, votes,
  reactions, the moderator list. Those tables' rows are the forum's, and the forum is
  OpenVibe.Community's, so **the forum's account data is Community's** and Space's hooks were removed.
- **Platform blocks, subject merges and VIP membership changes are gone** for the same reason: they only
  updated forum projections.
- The **token-cutoff projection** (`network.user.token_valid_after`) went with them: without signed-in
  content there is nothing here for a cutoff to protect.

The forum tables stay in Space's database (migrations `0001_initial.sql` onward still create them).
This release writes **no drop migration**; the rows are Community's, and dropping them is a later
decision.

## Configuration

Copy `.env.example` to `.env` (production: `/etc/openvibe/space.env`, mode 0600).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `4940` / `127.0.0.1` | Listen address (nginx in front) |
| `BASE_URL` | `https://openvibe.space` in production | Canonical origin |
| `TRUST_PROXY` | `2` | X-Forwarded-For hops (Cloudflare → nginx → Node) |
| `OV_NETWORK_URL` | `https://openvibe.network` | Issuer / authorize URL / JWKS |
| `OV_NETWORK_INTERNAL_URL` | `http://127.0.0.1:4000` | Token grants, JWKS (tried first) |
| `OV_OAUTH_CLIENT_ID` | `space` | Registered on the Network |
| `OV_OAUTH_CLIENT_SECRET` | — | **Required** for sign-in |
| `OV_OAUTH_REDIRECT_URI` | `https://openvibe.space/auth/callback` | Must match the registration |
| `OV_COMMUNITY_URL` | `https://openvibe.community` | Where every forum URL redirects |
| `OV_LIVE_URL` | `https://openvibe.live` | Legal pages the shared footer links |
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | unset (development: embedded PGlite in `data/pglite`) | PostgreSQL through PgBouncer, and the owner's direct connection for migrations (written by OpenVibe.Host `roles/data/add-service.sh space`) |

## Run

```
npm install
npm start          # http://127.0.0.1:4940
npm test           # boots the Network mock in-process; no network needed
```

## Acceptance

`npm test` runs every `test/*.test.js`:

- `home` — the home page says what Space will host and links the forum on Community; discovery, health,
  readiness and sign-in answer; an unknown path is an honest 404;
- `redirects` — `/s`, `/s/*` (301 for GET/HEAD, 308 otherwise) and the forum APIs (308) redirect to the
  same path and query on openvibe.community, and nothing else redirects;
- `boot` — the real process on a fresh PGlite database: migrations run, `/api/ready` is 2xx, the home
  page renders, the forum URLs redirect, and SIGTERM stops it cleanly.

## Security

Reporting a vulnerability: [SECURITY.md](SECURITY.md). The rules the code keeps:

- **Auth.** Browsers use Network JWTs (the `ov_token` cookie); the session layer verifies them offline
  against the Network's JWKS. The OAuth `state` cookie is required, and post-auth targets are restricted
  to this site or `https://openvibe.network/…`.
- **Egress.** Space calls only its configured Network host.
- **Secrets.** `OV_OAUTH_CLIENT_SECRET` lives in `/etc/openvibe/space.env` (0600), by name only.

## Deploy

```
/opt/openvibe.space                     # git checkout, `npm ci --omit=dev`
/etc/openvibe/space.env                 # secrets (0600)
deploy/systemd/openvibe-space.service   # → /etc/systemd/system/, User=ubuntu, port 4940
deploy/nginx/openvibe.space.conf        # → /etc/nginx/sites-available/, TLS from
                                        #   /etc/letsencrypt/live/openvibe.space/
```

The database is `ov_space` on the host's data role. Rollback: ovhost puts the previous sha back when
`/api/ready` does not answer 2xx after the restart.

## Layout

```
server/
  index.js            process entry (listen, graceful stop)
  app.js              Express app factory: redirects, home page, sign-in, discovery, health
  config.js           env → config
  db.js               PostgreSQL (openvibe-sdk/db): initDb/getDb, migrations/ applied at boot
  discovery.js        robots disallow set, llms sections, the sitemap (the home page alone)
  observability.js    truthful /api/ready (the database is required; the Network key degrades)
  auth/routes.js      OAuth2 client (login/callback/fedcm/logout/me/refresh)
  render/layout.js    page shell (openvibe-shared/shell) and the redirect/site constants
  render/pages.js     the home page and the error pages
public/               css/space.css, assets/ (logo, og-default), manifest.webmanifest
migrations/           the shared schema, including the forum tables Space no longer serves
deploy/               systemd unit, nginx vhost
test/                 run.js + home/redirects/boot tests
```

## What is next

Code hosting (repositories, releases) and dynamic pages, then "spaces": apps people build on their
OpenVibe account, the network's services and the SDK.

## Related services

- Identity/SSO: https://openvibe.network (OpenVibers/OpenVibe.Network)
- The forum and the hub: https://openvibe.community (OpenVibers/OpenVibe.Community)
- Streaming: https://openvibe.live (OpenVibers/OpenVibe.Live)
- Tools: https://openvibe.tools (OpenVibers/OpenVibe.Tools)
- Media: https://openvibe.media (OpenVibers/OpenVibe.Media)

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<!-- versions:start -->
- openvibe-contracts: v0.122.1
- openvibe-sdk: v0.35.0
- openvibe-shared: v2.17.0
<!-- versions:end -->
