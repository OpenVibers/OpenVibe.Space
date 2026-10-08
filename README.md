# OpenVibe.Space

**https://openvibe.space — the forums of OpenVibe.**

## Purpose

The forum service of the OpenVibe network: public, members-only and staff **spaces**, their
**threads**, **posts**, votes, ratings, categories, per-space **moderators** and the **Discord
relay**. The forum engine moved here from OpenVibe.Community (plan T10 step 3, decisions D11/D12/D29):
Community stays the hub (pastes, comment threads, Pulse, submissions) and Space owns the forums, in
its own database.

It is a small Node/Express app (CommonJS, no framework, one PostgreSQL database) that server-renders
every page — crawlers and no-JS readers get the whole thing, every action is a link or a form post —
and adds a little progressive JavaScript for comfort.

## Owns

- spaces (groups, categories, child boards, per-space settings), threads, posts, post versions,
  thread votes, post ratings and image attachments (Media objects it names)
- the board index, the space pages, the thread pages and their reads and writes: `GET /s`,
  `GET /api/v1/spaces…`, `GET|POST|PUT|DELETE /api/v1/posts…`
- per-space moderators (`space_moderators`) — a data row, not a capability: a person the space lists
  moderates that space as discussion staff do everywhere, while the board index and creating spaces
  stay with staff
- a space's chat-room link (OpenVibe.Chat owns the room), the Discord relay's mappings, deliveries,
  message map, cursors and inbound failures, the block projection, the account-data records, the
  `space.*` events and one PostgreSQL database (`ov_space`, ADR-035; schema in [migrations/](migrations/);
  embedded PGlite in development), with Valkey for the per-actor limit counters

## Does not own

- identity and SSO (OpenVibe.Network), image bytes (OpenVibe.Media), memberships (OpenVibe.VIP),
  chat rooms (OpenVibe.Chat) and the Discord API itself
- **pastes, typed comment threads, Pulse and submissions**: they are OpenVibe.Community's, and they
  stay there (plan T10 D3). A thread's replies are its own posts — the forum does not use the comment
  service — and Space records no Pulse item and keeps no paste table.

## Depends on

- OpenVibe.Network (SSO, JWKS, service tokens, `identity.subject.resolve` for author names)
- OpenVibe.Media (attachment uploads through the Object API), OpenVibe.VIP (members-only gates),
  OpenVibe.Chat (a space's room), OpenVibe.Events (the outbox relay and the block/account/VIP
  subscriptions), OpenVibe.Community (the hub: the Pulse feed Space's pages link)
- `openvibe-contracts` v0.110.0, `openvibe-sdk` v0.35.0, `openvibe-shared` v2.14.1, pinned by release tarball

## How it fits the network

| Concern | Where it lives | How Space reaches it |
| --- | --- | --- |
| Spaces, threads, posts, votes, ratings | **Space's PostgreSQL** (`ov_space`, `server/forum/*`) | own database |
| Image bytes | **OpenVibe.Media** (Object API v2, tenant `space`) | service token (`media.object.upload`) |
| Identity / SSO | **OpenVibe.Network** (OAuth2 + RS256 JWKS) | OAuth client `space` |
| Shared chrome, themes | `https://openvibe.network/shared/*.js` | loaded in every page |
| VIP memberships (members-only spaces/threads) | **OpenVibe.VIP** (`POST /api/v1/policies/evaluate`) | `OV_VIP_INTERNAL_URL`, service token (audience `openvibe.vip`, `vip.resource.policy.evaluate`) |
| A space's chat room | **OpenVibe.Chat** (`POST/DELETE /api/chat/rooms/:room/attachments`) | `OV_CHAT_INTERNAL_URL`, the signed-in person's own Network token (no service grant) |
| Pulse (the network's public activity) | **OpenVibe.Community** | a link (`OV_COMMUNITY_URL/pulse`); Space stores none of it |
| Blocks, token cutoffs, account export/deletion, subject merge | **OpenVibe.Network** through **OpenVibe.Events** | `POST /internal/events`, signed with `SPACE_EVENTS_SECRET` |

Space resolves the visitor itself: a Network JWT names the account by its `subject_id` (`usr_…`),
which is exactly what Space stores, so there is no second identity to map and no proxy.

## Endpoints

Pages (server-rendered) and API:

| Page | API |
| --- | --- |
| `GET /s` — the board index (every space, grouped, with topics, posts and the last post) | `GET /api/v1/spaces`, `GET /api/v1/space-groups` |
| `GET /s/:space` — a space's threads (`?sort=hot\|new\|top\|active&page=&category=&status=`) | `GET /api/v1/spaces/:space/threads` |
| `GET /s/:space/t/:slug` — a thread with its posts (`?page=`, `?quote=<post id>`) | `GET /api/v1/spaces/:space/threads/:slug` |
| `GET /s/:space/new`, `POST /s/:space/new` — start a thread | `POST /api/v1/spaces/:space/threads` |
| `POST /s/:space/t/:slug/reply` — reply (multipart images allowed) | `POST /api/v1/spaces/:space/threads/:slug/posts` |
| `POST /s/:space/t/:slug/vote` — 1, −1 or 0 | `POST /api/v1/spaces/:space/threads/:slug/votes` |
| `POST …/state`, `…/delete`, `…/members-only`, `…/status`, `…/category`, `…/crosspost` — moderation, no JS | `PUT /api/v1/spaces/:space/threads/:slug/…`, `PUT\|DELETE /api/v1/posts/:id` |
| `POST /s/:space/chat-room`, `…/chat-room/detach` | `PUT\|DELETE /api/v1/spaces/:space/chat-room` |
| `POST /s/:space/moderators`, `…/moderators/remove` | `GET\|PUT\|DELETE /api/v1/spaces/:space/moderators[/:subject]` |
| `GET /s/feed.xml`, `/s/:space/feed.xml` — RSS | `GET /robots.txt`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml` |
| `GET /auth/login\|callback\|logout\|me\|refresh` | `GET /api/health`, `/api/ready`, `/release.json`, `/metrics` (loopback) |
| `GET /`, `/updates` — 301/302 to `/s` and the community's log | `POST /internal/events` (signed Events deliveries) |

## The forum

A space is one of three visibilities — `public` (anyone reads, people post), `members` (signed-in
people read and post) and `staff` (moderators only; it looks missing to everyone else) — and one of
two styles: `feed` (ranked by votes, hot/new/top, like a subreddit) or `forum` (the newest reply on
top, author panels, quotes; like a classic board). A thread is a `discussion`, a `request` (Feedback:
open → planned → in progress → done, or declined) or a `roadmap` item (the Roadmap space, synced from
`docs/roadmap/public.json` at every boot), each with its own statuses and its own thread.

Writing needs a person: the browser's Network JWT, or a service naming one in `X-OV-Subject` (or
`X-OV-Origin: ai` for AI output, stored with origin `ai` and no author). Per-person limits
(server/limits.js) hold: threads 3 a minute, replies 6 a minute, votes and ratings 60, uploads 12,
plus a daily thread cap; per-actor limits (server/actor-limits.js) cap requests per route family.

Images on posts go to OpenVibe.Media as `med_` objects (`kind: attachment`, `visibility: unlisted`),
owned by the person who uploaded them; the post names at most four `media_id`s. Post bodies are
Markdown through `server/render/markdown.js` — a small, safe renderer: every piece of text is escaped
first and only a fixed tag set leaves it.

### Per-space moderators

A space lists its own moderators (`space_moderators`, people only, added by `@username` or `usr_…`
resolved through the Network). In that space they act as discussion staff do everywhere: thread
state and status, deletes and edits, settings, categories, members-only gating and the chat room.
They can add and remove each other, and step down. Creating spaces, the board index (groups, a
space's place on it), roadmap items and staff spaces stay with discussion staff
(`identity/capabilities.js`).

### Members-only spaces and threads (OpenVibe.VIP)

A space (its creator, or a moderator for any creator) or a single thread (its author, for their own
members, or a moderator) can be opened to one creator's VIP members: `members_only_owner` is the
creator's `usr_…` subject. Reading, posting, voting and editing then need an active entitlement,
asked of VIP with a service token and cached (a "yes" at most `VIP_CACHE_TTL_MS`); the owner and
moderators always pass, and every doubt (signed out, VIP down, no grant) fails closed with
`403 vip.members_only` and a join link. A gated thread's title is listed with its `members_only`
flag, never a body; gated things never reach the sitemap, feeds or the Discord relay.

## Discord relay

`server/relay/discord.js` mirrors new threads and replies in mapped public spaces to a Discord
webhook, with attribution, a link and no mentions, and follows edits and deletes through the
message map. Webhook URLs live in environment variables named by a mapping (`webhook_url_ref`) —
never in the database. `server/relay/events-worker.js` can queue the creates from
`space.thread.created` / `space.post.created` off OpenVibe.Events instead (the default when
`EVENTS_URL` and the client secret are set); `server/relay/inbound.js` + `discord-gateway.js` bring
replies written on Discord back as posts, with the Discord name and `origin 'discord'`, honouring
locks, members-only gates and per-author limits. The whole relay is off unless
`DISCORD_RELAY_ENABLED` (inbound also needs `DISCORD_RELAY_INBOUND=on` and `DISCORD_BOT_TOKEN`);
see [docs/discord-relay.md](docs/discord-relay.md) (the moved doc from Community).

## What Space applies from the network

`POST /internal/events` (server/events-consumer.js) is Space's Events subscription endpoint
(consumer `space`, signature v2 under `SPACE_EVENTS_SECRET`, loopback only). Exactly once, through
the SDK inbox:

- `network.user.token_valid_after` — the person's token cutoff moves (sign out everywhere, password
  change, ban) and their older tokens are refused here at once
- `network.block.changed` — the block projection (`network_blocks`): nobody replies in a thread whose
  author blocked them, or reacts to a post whose author blocked them
- `network.subject.merged` — the folded-in subject's rows become the survivor's
- `network.account.export_requested` / `network.account.deleted` — Space's part of an account export,
  and what the person wrote goes (or becomes an authorless tombstone when others replied under it,
  so their replies keep their place); `space_moderators` and `network_blocks` rows go, `created_by`
  and `added_by` are cleared, and Space confirms the counts
- `vip.membership.changed` — the cached members-only answers for that creator are dropped at once

## Capabilities

Space's capabilities are `space.*` (openvibe-contracts `manifests/services/space.json`); v0.110.0
registers them active and lists them on the Space manifest:

| Capability | What it covers |
| --- | --- |
| `space.forum.read` | list the spaces the caller can open, one space's metadata, `GET /s` |
| `space.forum.manage` | moderation and staff administration of spaces (create, rename, settings, categories, moderators, visibility, members-only) |
| `space.thread.read` | a space's threads and one thread with its posts, the feeds |
| `space.post.write` | create threads and replies, vote, edit or delete one's own posts |

`space.thread.write` (a thread lifecycle grant on its own) and `space.pulse.read` (the Pulse activity
beside the forums) stay planned in Contracts and Space serves neither: `space.post.write` carries
thread writes and Community serves the Pulse feed.

Service tokens are held to these (`server/http/v1.js` `serviceCap`/`serviceAnyCap`); browsers and
anonymous callers pass the middlewares and are judged by Space's own rules instead. Staff powers come
from the contracts staff map (`staff.moderation.discussions`), so a person is staff on every OpenVibe
site at once.

## Per-actor limits

`server/actor-limits.js` counts requests per caller (a person, a first-party service relaying a
visitor, a service acting as itself, else the address) per route family, once `req.viewer` is
resolved: reads get `SPACE_LIMITS_MINUTE`/`SPACE_LIMITS_HOUR` (120/3000), writes their own numbers
where they are mounted. Past a limit the route answers `429 rate_limited` with `Retry-After` before
it does any work, counted in `space_rate_limited_total{limit,window}`. The per-address `/api/` limit
stays in front, and `/internal/events`, `/api/health`, `/api/ready`, `/release.json` and `/metrics`
are never limited.

## SEO

Every page carries the full head through `openvibe-shared/shell`: description, canonical, robots,
Open Graph, Twitter card, an ai-summary and JSON-LD (`WebSite`, `BreadcrumbList`, and
`DiscussionForumPosting` for a thread, with its replies; never for a gated page). `/robots.txt`,
`/llms.txt`, `/llms-full.txt`, `/sitemap.xml` (rebuilt at most hourly, members-only spaces and
threads never in it), `/s/feed.xml` and `/s/:space/feed.xml` come from `server/discovery.js` and
`openvibe-shared/seo`; with `INDEXNOW_KEY` set, a public, indexable page appearing, changing or going
away pings the engines.

## Configuration

Copy [.env.example](.env.example) to `.env` (or `/etc/openvibe/space.env` in production, 0600).
Everything has a working default except the OAuth client secret and the database. The keys that
change behaviour:

- `PORT` (4940), `HOST` (127.0.0.1), `BASE_URL`, `TRUST_PROXY` (2: Cloudflare → nginx → Node)
- `OV_NETWORK_URL`, `OV_NETWORK_INTERNAL_URL`, `OV_OAUTH_CLIENT_ID` (`space`),
  `OV_OAUTH_CLIENT_SECRET`, `OV_OAUTH_REDIRECT_URI`
- `DATABASE_URL` (PgBouncer) and `DATABASE_DIRECT_URL` (the owner, migrations); without them,
  development uses an embedded PGlite database in `data/pglite` (`SPACE_PGLITE_DIR` overrides the path)
- `VALKEY_URL` / `VALKEY_PREFIX` (`ov:space:`) — shared per-actor counters
- `OV_MEDIA_URL` / `OV_MEDIA_INTERNAL_URL`, `OV_VIP_URL` / `OV_VIP_INTERNAL_URL`,
  `OV_CHAT_URL` / `OV_CHAT_INTERNAL_URL`, `OV_COMMUNITY_URL`
- `EVENTS_URL`, `SPACE_EVENTS_SECRET`, `INDEXNOW_KEY`
- `DISCORD_RELAY_*`, `DISCORD_BOT_TOKEN`, `DISCORD_GATEWAY_URL`

## Run

```sh
npm ci
cp .env.example .env       # fill in OV_OAUTH_CLIENT_SECRET; without DATABASE_URL it uses PGlite
npm run dev                # http://localhost:4940
npm test                   # every test in test/ (PGlite)
npm run test:pg            # the same, on PostgreSQL + PgBouncer + Valkey (openvibe-sdk scripts/test-services.sh)
```

## Acceptance

- `npm test` green: the forum rules and API, SSR, the two styles (feed/forum), per-space moderators,
  members-only gating, chat rooms, attachments, the safe Markdown renderer, votes under race,
  categories and the roadmap, the Discord relay (outbound, inbound through a fake gateway, and the
  Events worker), and `test/boot.test.js` — the real process on a fresh database: `/api/ready` 2xx,
  `GET /s` renders, SIGTERM stops it cleanly.
- `openvibe-contracts-check` for `space` in CI, and no `community.` id anywhere under `server/`.

## Security

- [SECURITY.md](SECURITY.md) — how to report a vulnerability.
- Identity never comes from a request body or query: a service token is judged on the token, a bad
  one is refused rather than downgraded to anonymous, and a first-party service acting for someone
  must name a subject the token allows.
- Post bodies are rendered by the safe Markdown renderer; every other user value is escaped.
- The relay never stores a webhook URL (only the name of the environment variable holding it), and
  `/internal/events` refuses any request that came through a proxy.
- Per-address and per-actor limits on every API surface, plus the per-person write limits.

## Deploy

`deploy/systemd/openvibe-space.service` (unit `openvibe-space`, `127.0.0.1:4940`,
`WorkingDirectory=/opt/openvibe.space`, `EnvironmentFile=/etc/openvibe/space.env`) and
`deploy/nginx/openvibe.space.conf` (TLS, www → apex, the auth and API rate limits, `/metrics`
refused from the edge). The database is OpenVibe.Host's `add-service.sh space`
(`ov_space` on the data role). Deployed with the host's `ovhost deploy space`.

## Layout

```
server/
  index.js, app.js        process entry and the Express app
  config.js, db.js        configuration and the PostgreSQL handle (migrations at boot)
  events.js               Space → OpenVibe.Events (the outbox)
  events-consumer.js      OpenVibe.Events → Space (blocks, accounts, cutoffs, VIP)
  observability.js        readiness for GET /api/ready
  auth/routes.js          the OAuth2 client session (Network)
  identity/               subjects, capabilities, authors, blocks, projection, account data, merge
  forum/                  store (SQL), service (rules), api (JSON), routes (pages/forms), reactions, roadmap
  relay/                  discord (outbound), events-worker, discord-gateway + inbound, api
  render/                 layout, pages, forum + board (the two styles), markdown, highlight, jsonld
  http/v1.js              problems, capability guards, cursors, CORS
  limits.js, actor-limits.js, votes.js, chat-rooms.js, media/, vip/, discovery.js
migrations/0001_initial.sql   the whole schema (forum, relay, blocks, accounts, outbox, inbox)
public/                       space.css, space.js, the app icons and og-default.png
test/                         the suites (test/run.js runs them) and their mocks
deploy/                       systemd unit and nginx vhost
docs/roadmap/public.json      the Roadmap space's source (synced at boot)
```

## What is next

- **The data cutover** (plan T10 step 4, not this repository's job): move Community's forum tables
  into `ov_space`, 301 `/s/*` on Community to Space, drop Community's forum tables and the
  deprecated `community.*` forum capabilities, and remove the Sites placeholder for openvibe.space.
- **Contracts**: v0.110.0 registers Space live and its capabilities active, and publishes the
  `space.thread.created` / `space.post.created` / `space.moderation.action` event payloads, so the
  outbox only waits on `EVENTS_URL` and `OV_OAUTH_CLIENT_SECRET`; `space.thread.write` and
  `space.pulse.read` stay planned (`space.post.write` carries thread writes, Community serves Pulse).
- **Search**: Space pushes no Search documents yet (there is no `space.index_document.*` contract),
  so `/search` on every site does not see forum threads; there is no `/search` page here.
- **Pulse**: forum activity no longer publishes to the network Pulse feed. Restoring it belongs to
  Community's side (its consumer subscribing to `space.thread.*`) or to a `community.pulse.write`
  grant Space could use.
- **Paste cards on posts**: Community's forum let a post attach pastes; pastes are Community's, so
  Space posts do not carry them. If the feature is wanted, it needs a cross-service read of
  Community's paste metadata (a decision, not code that exists).

## Related services

- **OpenVibe.Community** (https://openvibe.community) — the hub: pastes, comment threads, Pulse, submissions
- **OpenVibe.Network** (https://openvibe.network) — identity, SSO and the shared chrome
- **OpenVibe.Media** (https://openvibe.media) — objects and image bytes
- **OpenVibe.VIP** (https://openvibe.vip) — memberships and the members-only gate
- **OpenVibe.Chat** (https://openvibe.chat) — a space's chat room
- **OpenVibe.Events** (https://openvibe.events) — the events fabric

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<!-- versions:start -->
- openvibe-contracts: v0.112.0
- openvibe-sdk: v0.35.0
- openvibe-shared: v2.14.1
<!-- versions:end -->
