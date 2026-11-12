# AGENTS.md — OpenVibe.Space

## Project overview

OpenVibe.Space (`https://openvibe.space`) owns the network's static hosting and "spaces": small web
apps a person makes on their OpenVibe account, with a browser editor, an AI builder, templates, a
space SDK and a QuickJS sandbox for a space's own functions. It also serves tenant sites by Host
header at `<name>.openvibe.website` and on verified custom domains.

- **Entry:** `server/index.js` (Express); app in `server/app.js`; port/service id `space`.
- **Hosting:** `server/artifacts/` (immutable content-addressed deploys, archive, path rules),
  `server/http/upload.js`, `server/http/dashboard.js` (projects/sites/deploys/domains),
  `server/http/tenant.js` (Host-header serving), `server/registry/` (resource index/control).
- **Spaces:** `server/spaces/` — `spaces.js`, `data.js`, `pages.js`, `render.js`, `sdk.js`
  (the `/_openvibe/sdk.js` client), `ai.js`, `agent.js`, `templates.js`, `functions-worker.js`
  (QuickJS WebAssembly sandbox), `content-check.js`, `guest.js`.
- **Pages:** `server/render/` (`website.js`, `hosting-pages.js`, `layout.js`, `pages.js`,
  `short.js`); the editor is `public/js/space-editor.js`; public assets in `public/assets`,
  `public/css`, `public/js`; manifest in `public/manifest.webmanifest`. No bundler.
- **Docs:** `docs/spaces.md` (the spaces model), `docs/cutover-pr-openvibe-space-43.md` (billing
  readings cutover); deployment `deploy/nginx/openvibe.space.conf`, `openvibe.website.conf`.

## Owns, does not own

Owns: spaces and their source files/settings, the gallery, editor, space SDK and API, shared lists
(`OV.items`), visitors' private storage (`OV.kv`), approved sign-ins and daily AI allowances; projects
and members, sites, immutable deploys, activation/rollback, previews, Git ingest, per-site
configuration, custom domains with TXT verification and takedowns; tenant serving; its `ov_space`
`space_*` tables, control log and outbox (`space.deploy.*`, `space.domain.verified`).

Does not own: people, sessions or project identity (Network); stored bytes when
`SPACE_OBJECT_STORE=media` (Media); money and usage rating (Billing); the forum (Community); the
hosting price comparison (Host). The old forum URLs redirect to Community.

## Who calls it, what it calls

People and their apps use the pages and the API; SDK `openvibe-sdk/space` is the client surface
(`deploys.uploadArchive/uploadFiles/uploadSourceBuild`, `sites.*`, `domains.*`, `projects.*`).
CI and Git ingest deploy through the same project-scoped app tokens. Space calls OpenVibe.Network
(identity, projects, JWKS), OpenVibe.AI (`space.app.build`, `space.app.ask`), OpenVibe.Media when
`SPACE_OBJECT_STORE=media` (`media.object.upload/read/list/delete` in the `space` namespace),
OpenVibe.Billing (`billing.usage.record` once `SPACE_BILLING_INTERVAL_MS` is on) and OpenVibe.Events
(the outbox when configured). `svc:space` needs `events.event.publish` and the Media grants above.

## Database and migrations

PostgreSQL `ov_space` through `openvibe-sdk/db` (ADR-035): `migrations/0002_initial.sql` through
`0005_git_sources.sql` create the hosting tables with Host Stage B's `space_` names; `0006` the
billing-readings outbox; `0008` telemetry; `0009` the spaces tables (`space_apps`,
`space_app_files`, `space_app_projects`, `space_app_items`, `space_app_kv`, `space_app_grants`,
`space_app_codes`, `space_app_tokens`, `space_app_counters`); `0010` account data. `0001` is the
historical forum schema and is not dropped. Migrations run at boot; tables are never created by a
request. Only hashes of sign-in codes and tokens are stored.

## Auth and exposure

Network SSO and JWTs. APIs ignore cookies; a person's session is the pages' auth and the API uses
bearer tokens. A space's visitor approves a sign-in once and Space keeps only the code/token hash.
Static uploads are validated before storage; tenant content runs on a separate registrable domain and
previews use a sandbox CSP. `/_openvibe/sdk.js` is the space SDK; function code runs in the QuickJS
sandbox at `/api/<name>` and from `OV.fn`. `/internal/events` is HMAC-verified and loopback-only.

**Public hosting is off by default** (`SPACE_PUBLIC_HOSTING=off`): only OpenVibe staff can create
projects. Abuse handling and a designated DMCA agent precede public launch — do not flip the switch
in a normal change.

## Deploy

`sudo ovhost deploy space`: release layout under `/opt/openvibe.space`, env `/etc/openvibe/space.env`,
unit `openvibe-space`, migrations at boot; rollback with `sudo ovhost rollback space --to <sha>`.
Vhosts live in `deploy/nginx/` (installed with `ov-vhost-install`). The `.gitignore` keeps
`node_modules`, data and keys out of the repository.

## Commands and tests

```bash
npm ci
npm run dev                 # http://127.0.0.1:PORT
npm test                    # every test/*.test.js, in-process Network/Media/Chat/VIP mocks
npm test -- spaces deploy   # only matching files
npm run test:pg             # the same on the PostgreSQL containers
```

`test/run.js` uses `openvibe-shared/test-runner` (60 s, serial); tests boot mocks and a temp database,
never the network. They cover upload validation and immutable deploys, activation/rollback, the
Host-header tenant and custom domains, site config/CSP, spaces (files, lists, kv, sign-ins, sandbox
functions, AI calls, templates), project export/deletion, the outbox and telemetry. `VERBOSE=1` is
not wired here; use `npm test -- <word>`.

## Conventions and pitfalls

- CommonJS, 4-space indent, single quotes, semicolons; problem+json for API errors and escaped,
  server-rendered HTML for pages. No framework and no build step.
- **Deploys are immutable and content-addressed.** Never overwrite an artifact; activation and
  rollback point a site at a deploy, and `deploy/*` rows are an audit trail.
- **Tenant isolation:** a tenant site is served only by Host header and never through the
  first-party cookie; previews use the sandbox CSP. Do not add a route that mixes origins.
- **A space's server code is untrusted:** it runs in the QuickJS sandbox with the space's grants;
  never eval it in Node and never give it the service token.
- **Limits and allowances are per space/person per day** (`server/spaces/ai.js`); a new AI call needs
  the same accounting.
- **The forum is gone from here:** old forum URLs redirect to Community; do not revive the `0001`
  tables or add endpoints against them.
- New environment variables go into `.env.example` and the README; values live only in
  `/etc/openvibe/space.env`.
