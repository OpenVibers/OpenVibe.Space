# Changelog

## Unreleased

- The forum moved back to OpenVibe.Community (owner decision, 2026-10-08), so Space keeps none of it. Removed: `server/forum/*`, `server/relay/*`, `server/vip/*`, `server/media/*`, `server/identity/*`, `server/{chat-rooms,votes,limits,actor-limits,events,events-consumer}.js`, `server/http/v1.js`, `server/render/{board,forum,markdown,jsonld,highlight}.js`, `public/js/space.js`, the forum suites and their fixtures, `docs/discord-relay.md` and the roadmap JSON.
- Every forum URL answers a permanent redirect to the same path and query on https://openvibe.community: `/s` and `/s/*` by 301 for GET and HEAD and 308 otherwise (the method and body are preserved), and `/api/v1/spaces*`, `/api/v1/posts/*`, `/api/v1/space-groups*` and `/api/v1/relay*` by 308.
- Space's home page (`/`) is now a short, honest page: Space will host code and dynamic pages, and "spaces" — apps people build on their OpenVibe account, the network's services and the SDK — with a clear link to the forum at https://openvibe.community/s. It claims no feature Space does not have.
- Kept: sign-in (the Network OAuth2 client `space`), the discovery files (robots, llms.txt, llms-full.txt, a sitemap holding `/` alone), health/ready/release.json. Removed the account export/deletion hooks and the rest of the network-event consumer: they only ever touched the forum's tables, and the forum's account data is Community's. The forum tables stay in the database; this release writes no drop migration.
- The suite is now `home`, `redirects` and `boot` (the real process on a fresh database, ending in a clean SIGTERM).
