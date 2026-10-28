# OpenVibe.Space

**https://openvibe.space — spaces (apps people make on their OpenVibe account) and static hosting for the OpenVibe network.**

## Purpose and status

Space owns static hosting. The Stage B engine moved here from OpenVibe.Host as code; production had no projects, sites or deploys to migrate. It supports projects and members, immutable content-addressed deploys, activation and one-step rollback, private previews, CI Git ingest, per-site configuration, verified custom domains, takedowns, Media-backed objects, Host-header tenant serving, and a resource index. Tenant names serve at `<name>.openvibe.website`.

Public hosting remains off by default (`SPACE_PUBLIC_HOSTING=off`). Only OpenVibe staff can create projects. Abuse handling and a designated DMCA agent precede public launch.

**Spaces** (plan T20 step 2; `server/spaces/`, `docs/spaces.md`) are small web apps people make here: described to the AI
builder (OpenVibe.AI `space.app.build`), started from a template (guestbook, AI buddy, poll, reaction game, trivia,
private to-dos, blank) or forked, then edited in a browser editor with a live preview. A space uses the visitor's
OpenVibe account through the space SDK (`/_openvibe/sdk.js`): sign-in that the visitor approves once, shared lists
(`OV.items`), private storage (`OV.kv`), the space's own AI (`OV.ai.ask`, OpenVibe.AI `space.app.ask` on behalf of
the visitor) and its own server code (`functions/<name>.js`, run in a QuickJS WebAssembly sandbox at `/api/<name>`
and from `OV.fn`). Making, editing, previewing and the AI builder work for everyone signed in. Publishing deploys a space to
a site of its maker's Spaces project at `<slug>.openvibe.website`, so it follows the same launch switch: staff until
`SPACE_PUBLIC_HOSTING=on`.

OpenVibe.Host is the hosting price comparison; its copy of the engine is being removed, and its old hosting URLs will answer 410 with a link here.

## Owns

- Spaces: their source files and settings, the gallery, the editor, the space SDK and its API, each space's shared lists,
  its visitors' private storage, the sign-ins visitors approved, and the daily AI allowances of spaces and builders.
- Static hosting: projects and members, sites, immutable content-addressed deploys, activation and rollback,
  previews, Git ingest, per-site configuration, custom domains with TXT verification, and takedowns.
- Serving tenant sites by Host header at `<name>.openvibe.website` and on verified custom domains.
- Its tables in `ov_space` (`space_*`), its control log and its outbox (`space.deploy.*`, `space.domain.verified`).

## Does not own

- People, sessions and projects' identity (OpenVibe.Network), stored bytes when `SPACE_OBJECT_STORE=media`
  (OpenVibe.Media), money and usage rating (OpenVibe.Billing), the forum (OpenVibe.Community, see below) and the
  hosting price comparison (OpenVibe.Host).

## Depends on

- **OpenVibe.Network:** sign-in (OAuth with PKCE), tokens and their keys, project membership.
- **OpenVibe.Events:** the outbox relay, when `EVENTS_URL` is set, and account export and deletion (ADR-033):
  `network.account.export_requested` and `network.account.deleted` reach the loopback `/internal/events` consumer
  (`server/account-data.js`, openvibe-sdk/account-data), signed with `SPACE_EVENTS_SECRET`. A person's spaces are
  exported with their files; on deletion their published spaces stop serving and the spaces go with what others kept
  in them, and their list items, private storage and sign-ins leave other people's spaces.
- **OpenVibe.Media:** tenant objects, when `SPACE_OBJECT_STORE=media`.
- **OpenVibe.Billing:** storage readings, when `SPACE_BILLING_INTERVAL_MS` is on.
- **OpenVibe.Services:** reads the resource index and sends control requests.
- **OpenVibe.AI:** the space builder and a space's own AI (`space.*` workflows; Network grants `ai.run.create` and
  `ai.run.read` on `space.*`).

## The forum moved to OpenVibe.Community

The forum lived here from 3 October 2026 (it moved off Community then). On **2026-10-08 the owner
moved it back**: OpenVibe.Community owns the forum (spaces, threads, posts, votes, categories,
per-space moderators, the Discord relay) again, and Space became the network's hosting (static sites now; dynamic pages and spaces next).

So Space keeps no forum code and **every forum URL answers a permanent redirect to the same path and
query on https://openvibe.community**:

| Path | Methods | Status |
| --- | --- | --- |
| `/s`, `/s/*` (pages, feeds) | GET, HEAD | `301` |
| `/s`, `/s/*` | anything else | `308` (the method and body are preserved) |
| `/api/v1/spaces*`, `/api/v1/posts/*`, `/api/v1/space-groups*`, `/api/v1/relay*` | all | `308` |

A redirected bookmark, crawler or API client therefore lands on Community's copy of the same page.
Nothing that is not a forum path redirects.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Spaces and static hosting |
| `/spaces`, `/spaces/new`, `/spaces/mine`, `/spaces/:slug` | The gallery and templates, making a space (template or AI builder), your spaces, a space's page |
| `/spaces/:slug/edit` and its JSON calls (`files`, `settings`, `ai`, `publish`, `unpublish`, `delete`, `preview`) | The editor (maker or staff; same origin with the form token in `X-CSRF-Token`) |
| `/spaces/:slug/fork`, `/spaces/:slug/connect` | Fork a space; the sign-in a visitor approves for a published space |
| `/_openvibe/sdk.js` | The space SDK: live on a space's own address, preview mode on openvibe.space |
| `/api/v1/apps/:id/token`, `/api/v1/apps/:id/run`, `/api/v1/apps/:id/items/:collection` | The space SDK's API, from the space's own origin only (CORS for that origin, Bearer space token, never cookies) |
| `/dashboard`, `/projects/:id`, `/sites/:id`, `/deploys/:id` | Signed-in hosting dashboard and forms |
| `/preview/:deployId/*` | Private, sandboxed deploy preview |
| `/api/v1/projects`, `/api/v1/sites`, `/api/v1/deploys`, `/api/v1/domains` | Hosting API (Bearer tokens, no cookie auth) |
| `/api/v1/resources` | First-party resource index |
| `POST /api/v1/resources/control` | First-party control: `delete` a site, deploy or domain for a person (Space's own roles decide) |
| `/limits.json` | Enforced hosting limits |
| `/auth/login|callback|fedcm|logout|me|refresh` | Space's Network OAuth client |
| `/robots.txt`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml` | Discovery for Space's public page |
| `/api/health`, `/api/ready`, `/release.json`, `/metrics` | Health, release and observability |

Sitemap entries carry lastmod from the release commit or, for hosted pages, the active deploy.

Tenant requests are dispatched by Host header before dashboard routes. `deploy/nginx/openvibe.website.conf` is a reference wildcard vhost; the existing `openvibe.space` vhost includes larger upload locations. Neither is installed by this code change. Unknown hosts answer 404. Tenant sites cannot reach the dashboard, API, auth or metrics. A custom domain serves only after TXT verification.

## Capabilities and events

The hosting API guards `space.site.manage`, `space.site.config`, `space.deploy.create`, `space.domain.manage`, `space.resource.read` and `space.resource.control` (openvibe-contracts 0.170.0, owner `space`); every route names exactly one, and `npx openvibe-contracts-check --service space` checks the code against the release. Service tokens need audience `openvibe.space`, and project membership still applies. The per-actor limits (`server/http/actor-limits.js`) count uploads, domain checks, project creation and writes per person or app; those are limit buckets, not capabilities. The retired `space.forum.*` contracts are unrelated to hosting. The control route (`server/registry/resource-control.js`, plan T13 step 10) takes a `common.resource-control-request@1` from OpenVibe.Services and acts as the person in `on_behalf_of` through the same domain code as the DELETE routes: deleting needs maintainer or owner, a non-member gets `resources.unknown_resource`, and the served deploy (`deploy.active`), a default domain (`domain.default`) and anything taken down are refused with Space's own reason. Dry runs; repeats with the same key return the first answer (`space_control_log`).

The transactional outbox emits `space.deploy.created`, `space.deploy.activated`, `space.deploy.failed` and `space.domain.verified`; each has a payload schema in openvibe-contracts, and the SDK outbox refuses any other type.

## Data and configuration

`migrations/0002_initial.sql` through `0005_git_sources.sql` create the hosting tables, `0006_billing_readings.sql` the usage-reading outbox,, indexes and immutable-artifact triggers from Host Stage B with `space_` names. They run through `openvibe-sdk/db` at boot; tables are never created by a request. `0001_initial.sql` remains the historical forum schema, which this release does not drop. This is a code move, with no data copy.

`migrations/0009_spaces.sql` creates the spaces tables (`space_apps`, `space_app_files`, `space_app_projects`, `space_app_items`, `space_app_kv`, `space_app_grants`, `space_app_codes`, `space_app_tokens`, `space_app_counters`). Only hashes of sign-in codes and tokens are kept.
`migrations/0010_account_data.sql` creates openvibe-sdk/account-data's `account_data_events` (the forum-era table of that name is kept as `account_data_events_forum`).

Request telemetry is aggregated by route template, method and status class, never by raw URL. Once a minute one `http.request` sample per key, plus the active-requests, p95 latency and event-loop-lag gauges, is written to this service's own `telemetry_samples` table (openvibe-sdk 0.46 telemetry, the `platform.telemetry-sample@1` shape), which `migrations/0008_telemetry.sql` creates; rows older than 14 days are deleted daily. `/shared` files, static assets, health, readiness and `/metrics` are not counted. `server/app.js` mounts openvibe-sdk's `telemetryMiddleware` (a no-op until init); `server/index.js` calls `telemetry.init()` at production start, runs the 14-day retention and flushes on stop.

Copy `.env.example` to `.env`. Production uses `/etc/openvibe/space.env` (0600). Important values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SPACE_PUBLIC_HOSTING` | `off` | Staff-only project creation (and publishing spaces) until launch |
| `SPACE_EVENTS_SECRET` | unset | Signs OpenVibe.Events deliveries to `/internal/events` (account export and deletion); unset answers 503 |
| `SPACE_AI`, `OV_AI_INTERNAL_URL` | `on`, `http://127.0.0.1:4700` | The space builder and spaces' AI through OpenVibe.AI |
| `SPACE_SPACES_PER_OWNER`, `SPACE_AI_BUILDS_PER_DAY`, `SPACE_AI_ASKS_PER_SPACE_PER_DAY` | 25, 20, 500 | Spaces per person, AI builds per person a day, AI answers per space a day (more `SPACE_SPACE_*` limits in `server/hosting-config.js`) |
| `SPACE_SITES_DOMAIN` | `openvibe.website` | Tenant names |
| `SPACE_STORAGE_DIR` | `./data/objects` | Content-addressed local object store |
| `SPACE_OBJECT_STORE` | `local` | Set `media` for Media write-through and cache |
| `SPACE_FORM_SECRET` | random per process | Dashboard CSRF form signing |
| `SPACE_WORKER` | on | Domain rechecks, object sweep, outbox pruning |
| `EVENTS_URL` | unset | Outbox relay destination; unset keeps rows queued |
| `SPACE_BILLING_INTERVAL_MS` | `0` (off) | Daily `gb-month` storage readings to OpenVibe.Billing (`OV_BILLING_URL`) in local mode, per OpenVibe.Network project (`network_project_id`; a project that names none gets no reading); Media mode emits none (Media bills the bytes) |
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | unset | PostgreSQL serving and owner migration connections |

Other `SPACE_*` quota, upload, domain and DNS settings are listed in `.env.example` and `server/hosting-config.js`. Space keeps its existing OAuth and forum redirect settings.

## Tests and running

```sh
npm install
npm start
npm test
```

`test/hosting-core.test.js` exercises migrations, launch gate, project/site creation, tenant dispatch, immutable deploys, pointer rollback and events directly against PGlite without a socket. The ported Stage B integration files under `test/hosting-*.test.js` use `test/stageb/boot.js` and raw HTTP for Host-header and request-target cases. The existing `home`, `redirects`, and `boot` tests cover Space's public app and forum redirects.

## Security and dependencies

Static uploads are validated before storage; tenant content runs on a separate registrable domain and previews use a sandbox CSP. APIs ignore cookies. OpenVibe.Network supplies identity; `svc:space` needs `events.event.publish`, `billing.usage.record` (audience `openvibe.billing`) once `SPACE_BILLING_INTERVAL_MS` is on, and, when `SPACE_OBJECT_STORE=media`, the `media.object.upload/read/list/delete` grants for the `space` namespace. OpenVibe.Media may hold tenant objects; OpenVibe.Events receives the outbox when configured. Space's own database is `ov_space` through `openvibe-sdk/db`. See [SECURITY.md](SECURITY.md).

## Deploy

`sudo ovhost deploy space` on the host: the release layout under `/opt/openvibe.space`, `/etc/openvibe/space.env`, the
`openvibe-space` unit, migrations at boot. The vhosts are `deploy/nginx/` (installed with `ov-vhost-install`).

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<!-- versions:start -->
- openvibe-contracts: v0.222.0
- openvibe-sdk: v0.67.0
- openvibe-shared: v4.26.1
<!-- versions:end -->
