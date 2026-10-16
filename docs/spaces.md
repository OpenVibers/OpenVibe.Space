# Spaces

A **space** is a small web app someone makes on openvibe.space that uses the visitor's OpenVibe account. The owner asked
for it on 2026-10-08: "a system where people can make spaces that interact with your openvibe account and the network
and interconnected with sdk and such, compete with openai chatgpt spaces type of product but better". This is plan T20
step 2.

## Making one

- **Describe it:** `/spaces/new` sends the description to OpenVibe.AI's `space.app.build`. The run is on behalf of the
  person building, who gets 20 builds a day by default. The editor waits for the run and loads the result: name,
  description, the instructions its AI follows, the SDK features it uses, and its files.
- **Start from a template:** guestbook, AI buddy, quick poll, reaction game, private to-dos, or blank
  (`templates/spaces/`). Each is one self-contained `index.html` and an example of the SDK.
- **Fork** any space you can open; the copy is your own draft.

The editor (`/spaces/:slug/edit`) has the files in tabs, a live preview, "Ask AI to change it", settings and Publish.
On a phone the preview and the code take turns, with the preview first and the AI box above both.

The preview runs the space in a sandboxed frame (`srcdoc`, an opaque origin with no `allow-same-origin`), so the
space's code never acts as openvibe.space. Its SDK calls are postMessages to the editor, which runs them as the
signed-in maker (`POST /spaces/:slug/preview`).

## Publishing

Publishing deploys the files to a site named after the space's slug, in its maker's **Spaces** project. The space is
then served at `https://<slug>.openvibe.website` by the hosting engine, with immutable deploys and staff takedowns.
Publishing follows hosting's launch switch: until `SPACE_PUBLIC_HOSTING=on`, only OpenVibe staff publish; everyone
else makes, edits and previews.

A published space is served with its own policy: inline scripts, pinned CDN scripts, styles and fonts, and
`connect-src` to its own origin and openvibe.space. It runs on its own registrable domain, apart from every network
site, and openvibe.space may embed it on the space's page.

## The SDK

Load it before your own script:

```html
<script src="/_openvibe/sdk.js"></script>
```

| Call | What it does |
| --- | --- |
| `await OV.ready` | Resolves once the SDK knows whether the visitor is signed in. |
| `OV.user` | `null`, or `{ username, display_name, avatar_url }`. `OV.on('user', fn)` hears changes. |
| `OV.signIn()`, `OV.signOut()` | Sends the visitor to openvibe.space to approve the space and back; forgets them here. |
| `OV.items.list(collection, { limit, before })` | The shared list, newest first, readable by anyone: `[{ id, value, author, created_at, mine }]`. |
| `OV.items.add(collection, value)` | Adds the signed-in visitor's item (any JSON up to 8 KB). |
| `OV.items.set(collection, value)` | The visitor's one item in that list (a vote, a best score), replaced each time. |
| `OV.items.remove(collection, id)` | Removes the visitor's own item (the space's maker may remove any). |
| `OV.kv.get(key)`, `OV.kv.set(key, value)`, `OV.kv.remove(key)` | The visitor's private storage in this space (up to 16 KB a value, 200 keys). |
| `OV.ai.ask(text \| { messages })` | An answer from OpenVibe AI that follows the space's instructions, on behalf of the visitor. |
| `OV.fn(name[, body][, { method, query }])` | Runs the space's `functions/<name>.js` on the server (POST when there is a body) and resolves with what it answered: JSON parsed, anything else as text. |

Every call returns a Promise. A failure is an `Error` with `.code`: `auth.required` (call `OV.signIn()`), `quota`
(try later), `space.capability` (the space did not ask for it), and so on. Collection names and keys are 1-64
characters of letters, digits, `.`, `-` and `_`.

## Functions (server code)

A space may keep code that runs on the server instead of in the visitor's browser: answers nobody should see, a
counter every visitor shares, a check before something is saved, a page put together per request. Each file
`functions/<name>.js` (a name of 1-40 characters: `a-z`, `0-9`, `-`) defines one handler:

```js
// functions/hello.js
async function handle(request, ov) {
  const visits = ((await ov.store.get('visits')) || 0) + 1;
  await ov.store.set('visits', visits);
  return { hello: ov.user ? ov.user.display_name : 'stranger', visits };
}
```

- **How to write it:** a plain script. `export function handle`, `export default function (…)` and
  `module.exports = { handle }` work too; there is no `import` or `require`. An error answers 500 with its message and
  line number.
- **Where it runs:** on a published space at `https://<slug>.openvibe.website/api/<name>` (GET, HEAD and POST; it is
  the published copy that runs, so a saved change waits for the next publish). The page calls it with
  `OV.fn('hello')`, and a link or form may point at `/api/hello` directly. In the editor, the preview runs the copy in
  the editor (unsaved changes too) as the maker, and each call's status and console lines show in **Function log**
  under the preview. The files under `functions/` are never served as files, so their source stays private.
- **`request`:** `{ method, path, query, headers, body }`. `headers` carries only `content-type`, `accept`,
  `accept-language` and `user-agent`; `body` is parsed JSON, a form as an object, or text (64 KB at most). The
  visitor's address and cookies never reach a function.
- **`ov`:** `ov.user` (the visitor signed in through the SDK, or `null`), `ov.space` (`{ id, slug, name }`),
  `ov.items.list/add/set/remove` (the shared lists: an add or set is the visitor's when they approved "data", otherwise
  the space's own; a function may remove any item), `ov.store.get/set/remove` (the space's own storage on the server,
  which no visitor reads directly), `ov.ai.ask` (for a signed-in visitor who approved "ai") and
  `console.log/warn/error`.
- **What it returns** becomes the answer: a string (HTML when it starts with `<`, text otherwise), any other value as
  JSON, nothing as 204, or `{ status, headers, body }` (only `content-type` and `cache-control` headers are kept). An
  answer to a signed-in visitor or to a POST is never cached.
- **The sandbox:** each call runs in a fresh QuickJS runtime compiled to WebAssembly, on a worker thread: no network,
  no files, no timers, no Node. It has 32 MB of memory, 1 s of its own computing and 5 s in all (time spent waiting on
  `ov` is not computing), and at most 100 `ov` calls. A call that overstays answers 504; a thrown error answers 500
  with its message.

Starting from the **Trivia** template gives a working example: its answers live in `functions/check.js`.

## Sign-in, step by step

1. `OV.signIn()` makes a PKCE verifier and state, keeps them in `sessionStorage`, and goes to
   `https://openvibe.space/spaces/:slug/connect?challenge=…&state=…&return=…`.
2. The visitor, signed in to openvibe.space, sees the space's name, maker and what it may do (its capabilities:
   profile, data, kv, ai). Approving stores the grant. The next sign-in skips the page unless the space asks for more.
3. openvibe.space redirects to the space's own address with `#ov_code=…&ov_state=…`. The return path is always a path
   on that host.
4. The SDK posts the code and verifier to `POST /api/v1/apps/:id/token` from the space's origin. CORS answers that one
   origin; a request naming another origin, or none, is refused. The code works once, within two minutes.
5. The token is a day-long Bearer token for that space only, kept in the space's `sessionStorage`. Space stores only
   its hash, and `DELETE /api/v1/apps/:id/token` signs the visitor out.

## Limits

These are per person or per space, set in `server/hosting-config.js`:

- 25 spaces per person, 20 files and 1 MB per space.
- 20,000 list items per space, 30 writes a minute per person and space.
- 20 AI builds per person a day, 6 AI questions a minute per person and space, 500 AI answers per space a day.
- Functions: 240 calls a minute per space and 60 per caller (a signed-in visitor, or an address), two worker threads
  (`SPACE_FN_WORKERS`), and 300 writes a minute for the space's own writes (ten times a person's).
- Each OpenVibe AI run also counts against the person's own daily allowance in OpenVibe.AI.

## Code

| Path | What it is |
| --- | --- |
| `server/spaces/spaces.js` | The spaces, their files, builds, forks and publishing. |
| `server/spaces/data.js` | Lists, storage, the AI call and the sign-in codes and tokens; `run()` is the one entry point. |
| `server/spaces/api.js` | The API a space's page calls. |
| `server/spaces/pages.js` and `render.js` | The pages, the editor's calls and the connect flow. |
| `server/spaces/sdk.js` | The SDK. |
| `server/spaces/functions.js`, `functions-worker.js` | Space functions: the worker pool, the `ov` calls and limits, and the QuickJS sandbox. |
| `server/spaces/ai.js` | The OpenVibe.AI client. |
| `server/spaces/templates.js` | The templates. |
| `public/js/space-editor.js`, `public/css/spaces.css` | The editor and the styles. |
| `test/spaces.test.js`, `test/space-functions.test.js` | The tests. |
