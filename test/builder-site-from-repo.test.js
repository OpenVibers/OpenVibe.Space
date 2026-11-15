'use strict';
/**
 * A website from a person's OpenVibe.Git repository, made by their agent (plan §AD.10): Actor, acting for the person
 * (X-OV-Subject) with space.build.publish, asks POST /api/v1/builder/sites/from-repo; Space makes a site in the person's
 * Spaces project named after the repository, connects it as the source and tells Git, as the person, to publish that
 * folder of each push there. A second site from the same repository gets the next free name; without the capability
 * nothing happens; a refusal from Git leaves no site behind.
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');

const gitCalls = [];
let refuse = false;
const fakeGit = async (url, init = {}) => {
    const u = new URL(url);
    const call = { method: init.method || 'GET', path: u.pathname, subject: init.headers && init.headers['X-OV-Subject'], body: init.body ? JSON.parse(init.body) : null };
    gitCalls.push(call);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (refuse) return json(403, { code: 'repo.forbidden', detail: 'Only the repository\'s owner chooses where it is published.' });
    if (call.method === 'PUT') return json(200, { publish: { ...call.body, last: null } });
    return json(404, { code: 'route.not_found' });
};

(async () => {
    const t = await boot({ env: { OV_GIT_INTERNAL_URL: 'http://git.test' }, fetchImpl: (url, init) => (String(url).startsWith('http://git.test/') ? fakeGit(url, init) : globalThis.fetch(url, init)) });
    const alice = t.user('alice');
    const actor = t.network.serviceToken('actor', ['space.build.read', 'space.build.create', 'space.build.write', 'space.build.publish']);
    const readOnly = t.network.serviceToken('actor', ['space.build.read']);
    const ask = (token, body, subject = alice.subject) => t.api('POST', '/api/v1/builder/sites/from-repo', { as: token, headers: { 'x-ov-subject': subject }, json: body });

    await check('Actor makes a site from the person\'s repository, as them; Git is told where to publish', async () => {
        const r = await ask(actor, { repo: 'alice/band', branch: 'main', folder: 'site' });
        assert.strictEqual(r.status, 201, r.text);
        const { site, publish } = r.json();
        assert.deepStrictEqual([site.name, site.url], ['band', 'https://band.openvibe.website/']);
        assert.match(site.dashboard, new RegExp(`/sites/${site.id}$`));
        assert.deepStrictEqual([publish.site_id, publish.branch, publish.folder], [site.id, 'main', 'site']);
        const put = gitCalls.filter((c) => c.method === 'PUT').at(-1);
        assert.deepStrictEqual([put.path, put.subject], ['/api/v1/repos/alice/band/space-publish', alice.subject]);
        const src = (await t.api('GET', `/api/v1/sites/${site.id}/source`, { as: alice })).json().source;
        assert.deepStrictEqual([src.provider, src.repo_url, src.ref], ['openvibe', 'https://git.openvibe.codes/alice/band', 'main']);
        const again = await ask(actor, { repo: 'alice/band' });
        assert.strictEqual(again.status, 201, again.text);
        assert.strictEqual(again.json().site.name, 'band-2', 'the next free name');
    });

    await check('without space.build.publish, or with no person, nothing is made', async () => {
        assert.strictEqual((await ask(readOnly, { repo: 'alice/band' })).status, 403);
        const before = gitCalls.length;
        assert.strictEqual((await t.api('POST', '/api/v1/builder/sites/from-repo', { as: actor, json: { repo: 'alice/band' } })).status, 401);
        assert.strictEqual(gitCalls.length, before);
    });

    await check('a refusal from Git leaves no site behind', async () => {
        refuse = true;
        const r = await ask(actor, { repo: 'bob/site', name: 'Bobs Site' });
        assert.strictEqual(r.status, 403, r.text);
        refuse = false;
        const mine = await t.api('GET', '/api/v1/projects', { as: alice });
        const names = [];
        for (const p of mine.json().projects || []) {
            const s = await t.api('GET', `/api/v1/projects/${p.id}/sites`, { as: alice });
            for (const x of (s.json().sites || [])) names.push(x.name);
        }
        assert.ok(!names.includes('bobs-site'), `no site left (${names})`);
    });

    await t.close();
    done();
})();
