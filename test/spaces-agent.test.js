'use strict';
/**
 * The builder as the person's own agent (plan 2026-10-22 §Z, stage Z1).
 *
 * "Describe it and OpenVibe AI builds it" starts a task of the person's one agent (OpenVibe.Actor): the space
 * is the task's subject, the agent works on it through Space's builder API, and the page shows the space as the
 * agent writes it. Publishing waits for the person: the agent asks, the person answers.
 *
 * The tests here are Space's side of it: the task is asked for with the person named, the builder API reaches
 * only that person's own spaces, the page carries the task and follows it, and nothing goes live before the
 * person says so.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot, check, done } = require('./stageb/boot');
const { csrfToken } = require('../server/auth/forms');

const ORIGIN = 'https://openvibe.space';
const TASK = 'tsk_01M4W5JBFEG3QG9ER8W1A2K0RX';
const BUILD_CAPS = ['space.build.read', 'space.build.create', 'space.build.write', 'space.build.publish'];

(async () => {
    const actorCalls = [];
    let taskState = 'running';
    // The fake OpenVibe.Actor: it takes the task Space asks for and answers how it is doing. Everything else
    // (the token for the service) goes to the network the test runs.
    const fetchImpl = async (url, init = {}) => {
        const u = new URL(url);
        if (u.host !== 'actor.test') return await fetch(url, init);
        const headers = init.headers || {};
        actorCalls.push({
            method: init.method || 'GET', path: u.pathname, subject: headers['X-OV-Subject'],
            auth: headers.Authorization || null, body: init.body ? JSON.parse(init.body) : null,
        });
        const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (init.method === 'POST') return json(201, { id: TASK, state: 'queued' });
        return json(200, {
            id: TASK, state: taskState, task: 'build it',
            result: taskState === 'succeeded' ? { answer: 'A little quiz about the nineties.' } : null,
        });
    };

    const t = await boot({ env: { SPACE_BUILDER: 'agent', OV_ACTOR_INTERNAL_URL: 'http://actor.test' }, fetchImpl });
    const alice = t.user('alice'), bob = t.user('bob');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, p, fields) => t.api('POST', p, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const agent = (method, p, person, json) => t.api(method, p, { as: t.network.serviceToken('actor', BUILD_CAPS), json, headers: { 'x-ov-subject': person.subject } });

    let slug = null;
    let spaceId = null;

    await check('the Describe it box starts a task of the person\'s own agent', async () => {
        const r = await form(alice, '/spaces/new', { prompt: 'A trivia quiz about 90s cartoons with a leaderboard' });
        assert.strictEqual(r.status, 303, r.text);
        slug = String(r.headers.location || '').split('/').slice(-2)[0];
        assert.ok(slug, 'the space was made');
        const call = actorCalls.find((c) => c.method === 'POST' && c.path === '/api/v1/tasks');
        assert.ok(call, 'the agent was asked for a task');
        assert.strictEqual(call.subject, alice.subject, 'the task is the person\'s');
        assert.ok(/X-OV-Subject|subject/.test(JSON.stringify(call)), 'the person is named for the agent');
        assert.match(call.body.task, /space/i, 'the task says what to build');
        assert.match(call.body.task, /spc_[0-9A-HJKMNP-TV-Z]{26}/, 'the task names the space it works on');
    });

    await check('the editor carries the task, so the Dock opens at it', async () => {
        const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
        assert.strictEqual(page.status, 200);
        assert.ok(page.text.includes(TASK), 'the page carries the task id');
        const boot = JSON.parse(page.text.match(/<script type="application\/json" id="sp-boot">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
        assert.strictEqual(boot.agent.task, TASK);
        assert.strictEqual(boot.agent.state, 'running');
        spaceId = boot.space.id;
        // The page opens the Dock at that task: the shared navbar's API (the Dock's Agent panel marks the step).
        const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'space-editor.js'), 'utf8');
        assert.ok(/OpenVibeNavbar\.openDock\('agent', \{ task: agent\.task \}\)/.test(js), 'the editor opens the Dock at the task');
    });

    await check('the agent works on the space through the builder API, and the page shows it', async () => {
        assert.ok(spaceId, 'the space has an id');
        const write = await agent('PUT', `/api/v1/builder/spaces/${spaceId}/files`, alice, { files: [{ path: 'index.html', content: '<h1>90s cartoons</h1>' }] });
        assert.strictEqual(write.status, 200, write.text);
        assert.strictEqual(write.json().files[0].path, 'index.html');
        // The page follows the task and shows the space as the agent wrote it.
        const follow = await t.api('GET', `/spaces/${slug}/agent`, { session: alice, headers: { origin: ORIGIN, 'x-csrf-token': csrf(alice) } });
        assert.strictEqual(follow.status, 200, follow.text);
        assert.strictEqual(follow.json().task, TASK);
        assert.strictEqual(follow.json().status, 'running');
        assert.strictEqual(follow.json().files[0].content, '<h1>90s cartoons</h1>', 'the page shows what the agent wrote');
    });

    await check('the editor\'s own change box starts a task of the agent too', async () => {
        const r = await t.api('POST', `/spaces/${slug}/ai`, { session: alice, json: { prompt: 'make the buttons bigger' }, headers: { origin: ORIGIN, 'x-csrf-token': csrf(alice) } });
        assert.strictEqual(r.status, 200, r.text);
        assert.ok(r.json().task, 'the answer names the task of the agent');
        assert.strictEqual(r.json().building, true);
        const call = actorCalls.filter((c) => c.method === 'POST' && c.path === '/api/v1/tasks').pop();
        assert.strictEqual(call.subject, alice.subject);
        assert.match(call.body.task, /make the buttons bigger/, 'the agent is told what to change');
    });

    await check('another person\'s space is refused: the same 404 as one that does not exist', async () => {
        const r = await agent('GET', `/api/v1/builder/spaces/${spaceId}`, bob, null);
        assert.strictEqual(r.status, 404, r.text);
        const files = await agent('GET', `/api/v1/builder/spaces/${spaceId}/files`, bob, null);
        assert.strictEqual(files.status, 404, files.text);
    });

    await check('publishing waits for the person: nothing goes live before they answer', async () => {
        const ask = await agent('POST', `/api/v1/builder/spaces/${spaceId}/publish`, alice, {});
        assert.strictEqual(ask.status, 200, ask.text);
        assert.strictEqual(ask.json().state, 'pending');
        const approval = ask.json().approval_id;
        assert.ok(approval, 'the request the person answers has an id');
        // Still a draft while it waits.
        const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
        assert.ok(!/"published":true/.test(page.text), 'nothing is live yet');

        const answer = await t.api('POST', `/api/v1/agent/approvals/${approval}/decide`, { as: alice, json: { decision: 'approve' }, headers: { origin: ORIGIN } });
        assert.strictEqual(answer.status, 200, answer.text);
        assert.strictEqual(answer.json().state, 'approved');
        const after = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
        assert.ok(/"published":true/.test(after.text), 'the space is live after the answer');
    });

    await check('the step the agent takes reaches the network\'s agent namespace', async () => {
        const steps = await t.events('agent.step.started');
        assert.ok(steps.length, 'the step was published');
        const step = steps[0];
        assert.strictEqual(step.source, 'space');
        assert.strictEqual(step.subject.id, alice.subject, 'the step is the person\'s');
        assert.strictEqual(step.payload.mode, 'act');
        assert.strictEqual(step.payload.product, 'space');
        assert.strictEqual(step.payload.step_id, TASK);
    });

    await check('while public hosting is off, the agent is told at once that a space cannot go live', async () => {
        const t2 = await boot({ env: { SPACE_BUILDER: 'agent', OV_ACTOR_INTERNAL_URL: 'http://actor.test', SPACE_PUBLIC_HOSTING: 'off' }, fetchImpl });
        try {
            const carol = t2.user('carol');
            const csrf2 = (u) => csrfToken(t2.config, { subject: u.subject });
            const made = await t2.api('POST', '/spaces/new', { session: carol, form: { csrf: csrf2(carol), prompt: 'A small diary for my notes' }, headers: { origin: ORIGIN } });
            assert.strictEqual(made.status, 303, made.text);
            const slug2 = String(made.headers.location || '').split('/').slice(-2)[0];
            const page = await t2.api('GET', `/spaces/${slug2}/edit`, { session: carol });
            const id2 = JSON.parse(page.text.match(/<script type="application\/json" id="sp-boot">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<')).space.id;
            const ask = await t2.api('POST', `/api/v1/builder/spaces/${id2}/publish`, {
                as: t2.network.serviceToken('actor', BUILD_CAPS), json: {}, headers: { 'x-ov-subject': carol.subject },
            });
            assert.strictEqual(ask.status, 403, ask.text);
            assert.match(ask.text, /public hosting/, 'the reason says why');
        } finally {
            await t2.close();
        }
    });

    await t.close();
    done();
})().catch((e) => { console.error(e); process.exit(1); });
