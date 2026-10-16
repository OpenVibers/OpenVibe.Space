'use strict';
/**
 * Space functions: a space's server-side code (plan T20 step 2, "dynamic pages"). A file functions/<name>.js defines
 * `async function handle(request, ov)`; a published space serves it at https://<slug>.openvibe.website/api/<name>
 * (GET or POST, the published deploy's copy), the editor's preview runs the unsaved copy as the maker, and the space SDK
 * calls it with OV.fn(name, body).
 *
 * The code runs in QuickJS compiled to WebAssembly (quickjs-emscripten) on a small pool of worker threads
 * (functions-worker.js), a fresh runtime per call: no network, no files, no Node, at most FN_MEMORY bytes, FN_CPU_MS of
 * its own computing and FN_DEADLINE_MS in all; a worker that overstays is terminated and replaced. Its only way out is
 * `ov`, answered here:
 *
 *   ov.user                       the signed-in visitor ({ username, display_name }) or null
 *   ov.space                      { id, slug, name }
 *   ov.items.list|add|set|remove  the space's shared lists; an add or set is the visitor's when they signed in and
 *                                 approved "data", otherwise the space's own; a function may remove any item
 *   ov.store.get|set|remove       the space's own server-side storage (visitors never read it directly)
 *   ov.ai.ask                     the space's AI, for a signed-in visitor who approved "ai"
 *   console.log|warn|error        kept with the call (the editor shows them)
 *
 * What handle returns becomes the response: a string (HTML when it starts with "<", else text), { status, headers,
 * body } (only content-type and cache-control headers), any other value as JSON, nothing as 204.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const { ApiError } = require('../http/errors');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FN_MEMORY = 32 * 1024 * 1024;
const FN_CPU_MS = 1000;
const FN_DEADLINE_MS = 5000;
const MAX_SOURCE = 64 * 1024;
const MAX_OPS = 100;
const MAX_BODY = 256 * 1024;

function createSpaceFunctions({ data, workers = 2, queueMax = 32, log = console, now = Date.now } = {}) {
    const pool = [];
    const queue = [];
    let seq = 0;
    let closed = false;

    function spawn() {
        const w = new Worker(path.join(__dirname, 'functions-worker.js'));
        w.unref();
        const slot = { w, job: null };
        w.on('message', (msg) => onMessage(slot, msg));
        w.on('error', (err) => { log.warn('[Spaces functions] worker failed:', err && err.message); retire(slot, 'the function runner stopped'); });
        w.on('exit', () => retire(slot, 'the function runner stopped'));
        pool.push(slot);
        return slot;
    }
    function retire(slot, why) {
        const i = pool.indexOf(slot);
        if (i < 0) return;
        pool.splice(i, 1);
        if (slot.job) { const job = slot.job; slot.job = null; clearTimeout(job.kill); job.resolve({ error: why }); }
        slot.w.terminate().catch(() => {});
        pump();
    }
    function onMessage(slot, msg) {
        const job = slot.job;
        if (!job || msg.id !== job.id) return;
        if (msg.type === 'op') {
            if (++job.ops > MAX_OPS) return slot.w.postMessage({ type: 'reply', id: job.id, opId: msg.opId, reply: JSON.stringify({ error: { code: 'quota', message: `a call makes at most ${MAX_OPS} ov calls` } }) });
            let args = {};
            try { args = JSON.parse(msg.args); } catch { /* {} */ }
            Promise.resolve()
                .then(() => { const fn = job.ops_ && job.ops_[msg.op]; if (!fn) throw new ApiError(400, 'space.unknown_op', `unknown ov call ${String(msg.op).slice(0, 40)}`); return fn(args && typeof args === 'object' ? args : {}); })
                .then((result) => ({ result: result === undefined ? null : result }), (err) => ({ error: { code: (err && err.code) || 'error', message: (err && err.message) || 'failed' } }))
                .then((reply) => { if (slot.job === job) slot.w.postMessage({ type: 'reply', id: job.id, opId: msg.opId, reply: JSON.stringify(reply) }); });
            return;
        }
        if (msg.type === 'done') {
            slot.job = null;
            clearTimeout(job.kill);
            job.resolve(msg.result || { error: 'failed' });
            pump();
        }
    }
    function pump() {
        if (closed) return;
        while (queue.length) {
            let slot = pool.find((s) => !s.job);
            if (!slot && pool.length < workers) slot = spawn();
            if (!slot) return;
            const job = queue.shift();
            slot.job = job;
            // The worker stops the code itself at the deadline; this is the backstop if it cannot.
            job.kill = setTimeout(() => { if (slot.job === job) retire(slot, `ran out of time (${FN_DEADLINE_MS / 1000} s)`); }, FN_DEADLINE_MS + 1500);
            slot.w.postMessage({ type: 'run', id: job.id, name: job.name, code: job.code, request: job.request, context: job.context,
                limits: { memory: FN_MEMORY, deadlineMs: FN_DEADLINE_MS, cpuMs: FN_CPU_MS } });
        }
    }
    function submit(job) {
        if (closed) return Promise.resolve({ error: 'the function runner is stopped' });
        if (queue.length >= queueMax) return Promise.resolve({ busy: true });
        return new Promise((resolve) => { queue.push({ ...job, id: ++seq, ops: 0, resolve }); pump(); });
    }

    // Calls per minute: each space, and each caller of a space.
    const windows = new Map();
    function throttle(key, max) {
        const t = now();
        const list = (windows.get(key) || []).filter((x) => t - x < 60000);
        if (list.length >= max) throw new ApiError(429, 'quota', 'this space\'s functions are busy; wait a minute and try again');
        list.push(t);
        windows.set(key, list);
        if (windows.size > 5000) for (const [k, v] of windows) if (!v.some((x) => t - x < 60000)) windows.delete(k);
    }

    /** The `ov` calls of one run: the space acts as itself unless the visitor signed in and approved. */
    function opsFor(space, visitor) {
        const self = { subject: `space:${space.id}`, username: space.slug, name: space.name };
        const caps = visitor ? visitor.capabilities : [];
        const writer = visitor && caps.includes('data') ? visitor.person : self;
        return {
            'items.list': (a) => data.listItems(space, a.collection, { limit: a.limit, before: a.before }, visitor ? visitor.person : null),
            'items.add': (a) => data.addItem(space, writer, a.collection, a.value),
            'items.set': (a) => data.setItem(space, writer, a.collection, a.value),
            'items.remove': (a) => data.removeItem(space, writer, a.collection, a.id, true),
            'store.get': (a) => data.kvGet(space, self, a.key),
            'store.set': (a) => data.kvSet(space, self, a.key, a.value),
            'store.remove': (a) => data.kvRemove(space, self, a.key),
            'ai.ask': async (a) => {
                if (!visitor) throw new ApiError(401, 'auth.required', 'the visitor has to sign in for the space\'s AI');
                if (!caps.includes('ai')) throw new ApiError(403, 'space.capability', 'the visitor did not approve "ai" for this space');
                return (await data.run('ai.ask', { input: a.input }, { space, person: visitor.person, capabilities: caps, owner: false })).text;
            },
        };
    }

    /**
     * Run `code` (functions/<name>.js of `space`) for `request` ({ method, path, query, headers, body }). `visitor`:
     * { person, capabilities } or null; `caller`: a key for the per-caller limit (an address, a person).
     * → { status, headers, body (string), logs: [[level, line]] }
     */
    async function call(space, name, code, request, { visitor = null, caller = 'anon', perMinute = 120, perCallerPerMinute = 30 } = {}) {
        if (!NAME_RE.test(String(name))) throw new ApiError(404, 'space.function_not_found', 'no such function');
        if (typeof code !== 'string' || Buffer.byteLength(code) > MAX_SOURCE) throw new ApiError(413, 'space.function_too_large', 'a function is at most 64 KB');
        throttle(`s:${space.id}`, perMinute);
        throttle(`c:${space.id}:${caller}`, perCallerPerMinute);
        const context = {
            user: visitor ? { username: visitor.person.username, display_name: visitor.person.name || visitor.person.username } : null,
            space: { id: space.id, slug: space.slug, name: space.name },
        };
        const r = await submit({ name, code, request, context, ops_: opsFor(space, visitor) });
        const fail = (status, text, logs = []) => ({ status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: text, logs });
        if (r.busy) return fail(503, 'Space functions are busy right now; try again in a moment.');
        if (r.error) {
            const status = /time/.test(r.error) ? 504 : /memory|recursed/.test(r.error) ? 503 : 500;
            return fail(status, `functions/${name}.js ${r.error}`, r.logs || []);
        }
        if (r.failed !== undefined) return fail(500, `functions/${name}.js failed: ${String(r.failed).slice(0, 300)}`, r.logs || []);
        const out = toResponse(r.out);
        if (Buffer.byteLength(out.body) > MAX_BODY) return fail(500, `functions/${name}.js answered more than ${MAX_BODY / 1024} KB`, r.logs || []);
        return { ...out, logs: r.logs || [] };
    }

    async function close() {
        closed = true;
        for (const job of queue.splice(0)) job.resolve({ error: 'the function runner is stopped' });
        await Promise.all(pool.splice(0).map((s) => { if (s.job) { clearTimeout(s.job.kill); s.job.resolve({ error: 'the function runner is stopped' }); } return s.w.terminate().catch(() => {}); }));
    }

    return { call, close, NAME_RE };
}

/** What handle returned → { status, headers, body (string) }. */
function toResponse(out) {
    const kind = (s) => (/^\s*</.test(s) ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
    if (out === null || out === undefined) return { status: 204, headers: {}, body: '' };
    if (typeof out === 'string') return { status: 200, headers: { 'content-type': kind(out) }, body: out };
    if (typeof out === 'object' && !Array.isArray(out) && 'body' in out && ('status' in out || 'headers' in out)) {
        const status = Number.isInteger(out.status) && out.status >= 200 && out.status <= 599 ? out.status : 200;
        const headers = {};
        for (const [k, v] of Object.entries(out.headers && typeof out.headers === 'object' ? out.headers : {})) {
            const key = String(k).toLowerCase();
            if ((key === 'content-type' || key === 'cache-control') && typeof v === 'string' && v.length < 200 && !/[\r\n]/.test(v)) headers[key] = v;
        }
        const body = out.body == null ? '' : typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
        if (!headers['content-type']) headers['content-type'] = typeof out.body === 'string' ? kind(out.body) : 'application/json; charset=utf-8';
        return { status, headers, body };
    }
    return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(out) };
}

module.exports = { createSpaceFunctions, toResponse, NAME_RE, FN_DEADLINE_MS, FN_CPU_MS, MAX_SOURCE };
