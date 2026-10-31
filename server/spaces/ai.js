'use strict';
/**
 * Space → OpenVibe.AI for spaces (namespace space; Network grants Space ai.run.create / ai.run.read on space.*):
 *
 *   build(person, { prompt, name, current })   space.app.build, the AI builder: starts a run on behalf of the person
 *                                               building and answers its id (a whole app takes longer than one request
 *                                               may wait, so the editor polls result(id)). A guest draft has no
 *                                               person: its run is Space's own (person is null).
 *   result(runId)                               { status: 'running' | 'succeeded' | 'failed', output, error }
 *   ask(space, person, { transcript, message }) space.app.ask, a space's own AI, on behalf of the visitor: the text.
 *
 * Space's own service token (client space, audience openvibe.ai) through openvibe-sdk/ai. Without
 * OV_OAUTH_CLIENT_SECRET or with SPACE_AI=off there is no AI, and every call says so.
 */
const { ApiError } = require('../http/errors');

function createSpacesAi({ config, client: injected = null, log = console }) {
    let ai = injected;
    const enabled = () => Boolean(injected || (config.spaces.ai.enabled && config.oauth.clientSecret));

    function client() {
        if (ai) return ai;
        const { createClient } = require('openvibe-sdk');
        const { createServiceTokenClient } = require('openvibe-sdk/auth');
        const { createAiClient } = require('openvibe-sdk/ai');
        const tokens = createServiceTokenClient({
            tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
            audience: 'openvibe.ai', scope: 'ai.run.create ai.run.read',
        });
        ai = createAiClient(createClient({ tokenProvider: tokens, timeoutMs: 70000 }), { baseUrl: config.spaces.ai.url });
        return ai;
    }
    const unavailable = () => new ApiError(503, 'space.ai_unavailable', 'OpenVibe AI is not available here right now');
    const subjectRef = (person) => ({ type: 'user', id: person.subject });

    /**
     * The AI builder. `person` is the signed-in maker the run acts for; a guest draft has none, so its run is
     * Space's own (server/spaces/pages.js, the guest drafts of openvibe.website).
     */
    async function build(person, { prompt, name, current, spaceId }) {
        if (!enabled()) throw unavailable();
        const input = { prompt: String(prompt || '').slice(0, 4000), ...(name ? { name: String(name).slice(0, 40) } : {}), ...(current && current.length ? { current } : {}) };
        let body;
        try {
            body = await client().runs.create('space.app.build', input, {
                wait: 0, ...(person ? { onBehalfOf: subjectRef(person) } : {}),
                ...(spaceId ? { attribution: { service: 'space', type: 'space', id: spaceId } } : {}),
            });
        } catch (err) {
            log.warn(`[Spaces AI] build: ${err && err.message}`);
            if (err && (err.status === 429 || err.code === 'quota.exceeded')) throw new ApiError(429, 'quota', 'your OpenVibe AI allowance for today is used up; try again tomorrow');
            throw unavailable();
        }
        const run = body && (body.run || body);
        if (!run || !run.id) throw unavailable();
        return run.id;
    }

    async function result(runId) {
        if (!enabled()) throw unavailable();
        let run;
        try { const r = await client().runs.get(runId); run = r && (r.run || r); } catch (err) {
            log.warn(`[Spaces AI] result ${runId}: ${err && err.message}`);
            return { status: 'running' };
        }
        if (!run) return { status: 'running' };
        if (run.status === 'succeeded' && run.output) return { status: 'succeeded', output: run.output, synthetic: Boolean(run.synthetic) };
        if (['failed', 'cancelled', 'expired'].includes(run.status) || run.status === 'succeeded') {
            return { status: 'failed', error: (run.error && run.error.code) || 'failed' };
        }
        return { status: 'running' };
    }

    async function ask(space, person, { transcript, message }) {
        if (!enabled()) throw unavailable();
        let body;
        try {
            body = await client().runs.create('space.app.ask', {
                space: String(space.name || 'Space').slice(0, 40), instructions: String(space.instructions || '').slice(0, 4000),
                transcript: String(transcript || '').slice(-16000), message: String(message || '').slice(0, 4000),
            }, { wait: 30000, onBehalfOf: subjectRef(person), attribution: { service: 'space', type: 'space', id: space.id } });
        } catch (err) {
            if (err && (err.status === 429 || err.code === 'quota.exceeded')) throw new ApiError(429, 'quota', 'the OpenVibe AI allowance for today is used up; try again tomorrow');
            log.warn(`[Spaces AI] ask: ${err && err.message}`);
            throw unavailable();
        }
        const run = body && (body.run || body);
        if (!run || run.status !== 'succeeded' || !run.output || typeof run.output.text !== 'string') throw unavailable();
        return run.output.text.trim();
    }

    return { enabled, build, result, ask };
}

module.exports = { createSpacesAi };
