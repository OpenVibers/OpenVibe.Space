# OpenVibe.Space

**https://openvibe.space — static hosting for the OpenVibe network.**

## Purpose and status

Space owns static hosting. The Stage B engine moved here from OpenVibe.Host as code; production had no projects, sites or deploys to migrate. It supports projects and members, immutable content-addressed deploys, activation and one-step rollback, private previews, CI Git ingest, per-site configuration, verified custom domains, takedowns, Media-backed objects, Host-header tenant serving, and a resource index. Tenant names serve at `<name>.openvibe.website`.

Public hosting remains off by default (`SPACE_PUBLIC_HOSTING=off`). Only OpenVibe staff can create projects. Abuse handling and a designated DMCA agent precede public launch. Dynamic pages and spaces (small apps on a person's OpenVibe account) are planned and not built.

OpenVibe.Host is the hosting price comparison; its copy of the engine is being removed, and its old hosting URLs will answer 410 with a link here.

## Owns

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
- **OpenVibe.Events:** the outbox relay, when `EVENTS_URL` is set.
- **OpenVibe.Media:** tenant objects, when `SPACE_OBJECT_STORE=media`.
- **OpenVibe.Billing:** storage readings, when `SPACE_BILLING_INTERVAL_MS` is on.
- **OpenVibe.Services:** reads the resource index and sends control requests.

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
| `/` | Public status and static hosting description |
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

Copy `.env.example` to `.env`. Production uses `/etc/openvibe/space.env` (0600). Important values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SPACE_PUBLIC_HOSTING` | `off` | Staff-only project creation until launch |
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
- openvibe-contracts: v0.186.0
- openvibe-sdk: v0.44.0
- openvibe-shared: v4.2.0
<!-- versions:end -->
