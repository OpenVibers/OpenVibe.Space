'use strict';
/**
 * One worker thread of the space functions pool (server/spaces/functions.js): it runs a function's code in QuickJS
 * (WebAssembly), one fresh runtime per call, so a slow or hostile function never holds Space's own event loop. The
 * function's `ov` calls come back to the main thread as messages; nothing else leaves the sandbox.
 *
 *   main → worker  { type: 'run', id, name, code, request, context, limits: { memory, deadlineMs, cpuMs } }
 *   worker → main  { type: 'op', id, opId, op, args }          main → worker  { type: 'reply', id, opId, reply }
 *   worker → main  { type: 'done', id, result: { out } | { failed } | { error }, logs }
 */
const { parentPort } = require('worker_threads');

let quickjs = null;
const engine = async () => (quickjs ||= await require('quickjs-emscripten').getQuickJS());
const pendingOps = new Map();   // `${id}:${opId}` → (reply) => void

const PRELUDE = String.raw`
const __logs = [];
const __line = (a) => a.map((x) => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ').slice(0, 500);
const __log = (level) => (...a) => { if (__logs.length < 50) __logs.push([level, __line(a)]); };
globalThis.console = { log: __log('log'), info: __log('log'), warn: __log('warn'), error: __log('error') };
const __call = async (op, args) => {
  const r = JSON.parse(await __host(op, JSON.stringify(args === undefined ? {} : args)));
  if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
  return r.result;
};
// CommonJS spellings work too: module.exports = { handle } or module.exports = async (request, ov) => …
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;
const __ctx = JSON.parse(__context);
globalThis.ov = Object.freeze({
  user: __ctx.user ? Object.freeze(__ctx.user) : null,
  space: Object.freeze(__ctx.space),
  items: Object.freeze({
    list: (collection, o = {}) => __call('items.list', { collection, limit: o.limit, before: o.before }),
    add: (collection, value) => __call('items.add', { collection, value }),
    set: (collection, value) => __call('items.set', { collection, value }),
    remove: (collection, id) => __call('items.remove', { collection, id: String(id) }),
  }),
  store: Object.freeze({
    get: (key) => __call('store.get', { key }),
    set: (key, value) => __call('store.set', { key, value }),
    remove: (key) => __call('store.remove', { key }),
  }),
  ai: Object.freeze({ ask: (input) => __call('ai.ask', { input }) }),
});
`;

function errText(e) {
    if (!e) return 'unknown error';
    if (typeof e === 'string') return e.slice(0, 300);
    return `${e.name ? `${e.name}: ` : ''}${e.message || JSON.stringify(e)}`.slice(0, 300);
}

async function run({ id, name, code, request, context, limits }) {
    const Q = await engine();
    const runtime = Q.newRuntime();
    runtime.setMemoryLimit(limits.memory);
    runtime.setMaxStackSize(512 * 1024);
    const deadline = Date.now() + limits.deadlineMs;
    // CPU: the time spent inside QuickJS (evaluating, running jobs), apart from waiting on `ov` calls.
    let cpu = 0;
    let since = 0;
    const enter = () => { since = Date.now(); };
    const leave = () => { if (since) cpu += Date.now() - since; since = 0; };
    let stopped = null;
    runtime.setInterruptHandler(() => {
        const t = Date.now();
        if (t > deadline) stopped = 'time';
        else if (since && cpu + (t - since) > limits.cpuMs) stopped = 'cpu';
        return Boolean(stopped);
    });
    const vm = runtime.newContext();
    const deferred = new Set();
    let opSeq = 0;
    const jobs = () => { enter(); try { runtime.executePendingJobs(); } finally { leave(); } };
    try {
        vm.newString(JSON.stringify(context)).consume((h) => vm.setProp(vm.global, '__context', h));
        vm.newString(JSON.stringify(request)).consume((h) => vm.setProp(vm.global, '__request', h));
        vm.newFunction('__host', (opHandle, argsHandle) => {
            const op = vm.getString(opHandle);
            const args = vm.getString(argsHandle);
            const promise = vm.newPromise();
            deferred.add(promise);
            const opId = ++opSeq;
            pendingOps.set(`${id}:${opId}`, (reply) => {
                if (!vm.alive || !promise.alive) return;
                vm.newString(reply).consume((h) => promise.resolve(h));
                jobs();
            });
            parentPort.postMessage({ type: 'op', id, opId, op, args });
            return promise.handle;
        }).consume((h) => vm.setProp(vm.global, '__host', h));

        enter();
        let loaded;
        try {
            vm.unwrapResult(vm.evalCode(PRELUDE, 'prelude.js')).dispose();
            loaded = vm.evalCode(code, `functions/${name}.js`, { type: 'global' });
        } finally { leave(); }
        if (loaded.error) {
            const e = vm.dump(loaded.error); loaded.error.dispose();
            return { error: stopped ? `ran out of ${stopped === 'cpu' ? 'CPU time' : 'time'} while loading` : `did not load: ${errText(e)}` };
        }
        loaded.value.dispose();
        enter();
        let started;
        try {
            started = vm.evalCode(`(async () => {
  const m = globalThis.module.exports;
  const fn = typeof handle === 'function' ? handle : typeof m === 'function' ? m : m && (typeof m.handle === 'function' ? m.handle : typeof m.default === 'function' ? m.default : null);
  if (!fn) throw new Error('it must define handle(request, ov)');
  const out = await fn(JSON.parse(__request), ov);
  return JSON.stringify({ out: out === undefined ? null : out, logs: __logs });
})().catch((e) => {
  const at = new RegExp('functions/[^:)]+:([0-9]+)').exec(String((e && e.stack) || ''));
  return JSON.stringify({ failed: String((e && e.message) || e) + (at ? ' (line ' + at[1] + ')' : ''), logs: __logs });
})`, 'run.js');
        } finally { leave(); }
        const promiseHandle = vm.unwrapResult(started);
        const settled = vm.resolvePromise(promiseHandle);
        jobs();
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()) + 20); });
        const out = await Promise.race([settled, timeout]);
        clearTimeout(timer);
        promiseHandle.dispose();
        if (out === 'timeout' || stopped) {
            if (out !== 'timeout' && out.error) out.error.dispose();
            if (out !== 'timeout' && out.value) out.value.dispose();
            return { error: `ran out of ${stopped === 'cpu' ? 'CPU time' : 'time'}` };
        }
        if (out.error) { const e = vm.dump(out.error); out.error.dispose(); return { error: `failed: ${errText(e)}` }; }
        const raw = vm.getString(out.value); out.value.dispose();
        const parsed = JSON.parse(raw);
        return parsed.failed !== undefined ? { failed: parsed.failed, logs: parsed.logs } : { out: parsed.out, logs: parsed.logs };
    } catch (err) {
        const msg = String((err && err.message) || err);
        if (stopped) return { error: `ran out of ${stopped === 'cpu' ? 'CPU time' : 'time'}` };
        if (/out of memory|memory/i.test(msg)) return { error: 'ran out of memory' };
        if (/stack overflow|too much recursion/i.test(msg)) return { error: 'recursed too deeply' };
        return { error: `failed: ${msg.slice(0, 300)}` };
    } finally {
        for (const key of [...pendingOps.keys()]) if (key.startsWith(`${id}:`)) pendingOps.delete(key);
        for (const p of deferred) { try { if (p.alive) p.dispose(); } catch { /* gone */ } }
        try { vm.dispose(); } catch { /* a leak is not worth crashing the worker for */ }
        try { runtime.dispose(); } catch { /* same */ }
    }
}

parentPort.on('message', (msg) => {
    if (msg.type === 'reply') {
        const fn = pendingOps.get(`${msg.id}:${msg.opId}`);
        if (fn) { pendingOps.delete(`${msg.id}:${msg.opId}`); fn(msg.reply); }
        return;
    }
    if (msg.type === 'run') {
        run(msg).then(
            (result) => parentPort.postMessage({ type: 'done', id: msg.id, result }),
            (err) => parentPort.postMessage({ type: 'done', id: msg.id, result: { error: `failed: ${String((err && err.message) || err).slice(0, 300)}` } }),
        );
    }
});
