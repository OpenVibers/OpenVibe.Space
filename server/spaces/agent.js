'use strict';
/**
 * Space → OpenVibe.Actor, for the person's one agent (plan 2026-10-22 §Z stage Z1).
 *
 * Space's builder is not its own AI any more: "Describe it and OpenVibe AI builds it" starts a task of the
 * person's agent (OpenVibe.Actor's engine), and the Dock's one timeline shows the step while Space shows the
 * space's live preview. Space asks Actor for the task and reads it back; the agent works on the space through
 * Space's builder API (the space_* tools).
 *
 * The task is the person's: Space calls Actor with its own service token (audience openvibe.actor) and names the
 * person in X-OV-Subject, so the task is theirs (their allowance, their task list, Space recorded as the service
 * that started it). Actor answers 429/422/5xx in its own words; those pass through to the person.
 */
const { serviceAuth } = require('openvibe-contracts');

const TASK_ID = /^tsk_[0-9A-HJKMNP-TV-Z]{26}$/;
const SCOPE = 'actor.task.create actor.task.read';

/**
 * What a task's state means for a space: running, waiting (the task itself asks the person something), done or
 * failed. Actor's own states are the source; a space only keeps these four.
 */
const STATE = {
    queued: 'running',
    running: 'running',
    verifying: 'running',
    needs_you: 'waiting',
    succeeded: 'done',
    failed: 'failed',
    cancelled: 'failed',
};

/**
 * The instruction Actor receives: what to build, in plain words, with the space it works on. The tools are named
 * so the model does not have to guess them.
 */
function taskText(space, prompt, files) {
    const have = (files || []).map((f) => f.path).join(', ');
    return [
        'Build a space on OpenVibe.Space for the person who asked for it.',
        `The space is ${space.id} ("${space.name}"). Its files now are: ${have || 'none yet'}.`,
        'Write the space with space_files_write (index.html first, then the rest): the files you send replace the space\'s files as a whole, so send every file it should have.',
        'Read what is there with space_files_read, and show where the space lives with space_preview.',
        'Ask before it goes live with space_publish: the person answers, so nothing is published until they do.',
        'When the space is done, say in one line what it is and where they can see it.',
        '',
        'What the person asked for:',
        String(prompt || '').trim(),
    ].join('\n');
}

function createSpaceAgent({ config, fetchImpl = globalThis.fetch, log = console }) {
    const base = String((config.builder && config.builder.actorUrl) || '').replace(/\/+$/, '');
    const clientSecret = config.oauth && config.oauth.clientSecret;
    const enabled = Boolean(base && clientSecret);
    const tokens = enabled ? serviceAuth.createTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`,
        clientId: (config.oauth && config.oauth.clientId) || 'space',
        clientSecret,
        audience: 'openvibe.actor',
        scope: SCOPE,
        fetchImpl,
    }) : null;
    const timeoutMs = (config.builder && config.builder.timeoutMs) || 15_000;

    /** One call to Actor for one person. */
    async function call(method, path, person, body, extraHeaders) {
        const headers = { Accept: 'application/json', 'X-OV-Subject': person, ...(await tokens.authHeaders()), ...(extraHeaders || {}) };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        } catch (err) {
            log.warn('[Spaces agent] Actor did not answer:', (err && err.message) || err);
            return { status: 502, data: { code: 'actor.unavailable', detail: 'OpenVibe.Actor did not answer. Try again in a moment.' } };
        }
        const text = await res.text().catch(() => '');
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        return { status: res.status, data: data || {} };
    }

    /**
     * Start a task for the person. Answers { id, state } or { error: { code, message } } when Actor refused
     * (its own words: an allowance that is used up, a budget, a task that is too long).
     */
    async function createTask({ person, task, idempotencyKey }) {
        if (!enabled) return { error: { code: 'actor.unavailable', message: 'Your agent is not available right now. Start from a template instead.' } };
        const key = String(idempotencyKey || '').slice(0, 128) || `space:${person}:${Date.now()}`;
        const out = await call('POST', '/api/v1/tasks', person, { task, idempotency_key: key }, { 'Idempotency-Key': key });
        if (out.status >= 400) {
            const d = out.data || {};
            return { error: { code: d.code || 'actor.refused', message: String(d.detail || d.title || 'Your agent could not start that task.').slice(0, 300) } };
        }
        const id = out.data && out.data.id;
        if (!id || !TASK_ID.test(String(id))) return { error: { code: 'actor.invalid_response', message: 'Your agent did not answer with a task.' } };
        return { id, state: out.data.state || 'queued' };
    }

    /** The task as it is now: { id, state, title, result } or null when Actor does not know it. */
    async function task({ person, id }) {
        if (!enabled) return null;
        if (!TASK_ID.test(String(id || ''))) return null;
        const out = await call('GET', `/api/v1/tasks/${encodeURIComponent(id)}`, person);
        if (out.status >= 400) return null;
        const d = out.data || {};
        return {
            id: d.id || id,
            state: d.state || 'queued',
            title: typeof d.task === 'string' ? d.task.slice(0, 200) : '',
            result: d.result && typeof d.result === 'object' ? d.result : null,
            error: d.error_code || d.error || null,
        };
    }

    return { enabled, createTask, task, taskText, stateOf: (s) => STATE[s] || null };
}

module.exports = { createSpaceAgent, taskText, TASK_ID, SCOPE, STATE };
