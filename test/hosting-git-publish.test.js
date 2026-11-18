'use strict';
/**
 * Published from OpenVibe.Git (plan §AD.10 step 2): a maintainer chooses one of their OpenVibe.Git repositories, a
 * branch and a folder on the site's page; Host saves the site's source (provider openvibe) and tells Git, as that
 * person, to send that folder of every push here. Git's own deploy (its service token, the person in X-OV-Subject)
 * then lands as the site's preview through the git deploy door; the page shows Git's last send; Deploy now and Stop
 * reach Git as the person. Host never fetches the repository. A refusal from Git leaves no source behind.
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { site: siteTar } = require('./stageb/tar');

const SHA = 'c'.repeat(40);
const gitCalls = [];
let gitAnswer = null;
let publish = null;
const fakeGit = async (url, init = {}) => {
    const u = new URL(url);
    const call = { method: init.method || 'GET', path: u.pathname + u.search, subject: init.headers && init.headers['X-OV-Subject'], auth: init.headers && init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null };
    gitCalls.push(call);
    const json = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (gitAnswer) return gitAnswer(call, json);
    if (u.pathname === '/api/v1/repos') return json(200, { repositories: [{ full_name: 'alice/band', default_branch: 'main', visibility: 'private' }, { full_name: 'alice/notes', default_branch: 'trunk' }] });
    if (u.pathname === '/api/v1/repos/alice/band/space-publish') {
        if (call.method === 'PUT') { publish = { ...call.body, last: null }; return json(200, { publish }); }
        if (call.method === 'DELETE') { publish = null; return json(204, null); }
        return json(200, { publish });
    }
    if (u.pathname === '/api/v1/repos/alice/band/space-publish/deploy') { publish = { ...publish, last: { state: 'deployed', sha: SHA, at: new Date().toISOString() } }; return json(200, { publish }); }
    return json(404, { code: 'route.not_found' });
};

(async () => {
    const t = await boot({
        env: { OV_GIT_INTERNAL_URL: 'http://git.test' },
        fetchImpl: (url, init) => (String(url).startsWith('http://git.test/') ? fakeGit(url, init) : globalThis.fetch(url, init)),
    });
    const alice = t.user('alice');
    const dora = t.user('dora');
    const project = await t.project(alice, 'Band');
    const site = await t.site(alice, project.id, 'alice-band');
    await t.api('PUT', `/api/v1/projects/${project.id}/members/${dora.subject}`, { as: alice, json: { role: 'deployer' } });
    const { csrfToken } = require('../server/auth/forms');
    const origin = { origin: 'https://openvibe.space' };
    const form = (user, p, body) => t.api('POST', p, { session: user, form: { csrf: csrfToken({ formSecret: 'test-form-secret' }, { subject: user.subject }), ...body }, headers: origin });
    const page = async (user = alice) => (await t.api('GET', `/sites/${site.id}`, { session: user })).text;

    await check('the page offers the person\'s own repositories, read from Git as them', async () => {
        const html = await page();
        assert.match(html, /From a repository/);
        assert.match(html, /<option value="alice\/band" data-branch="main">alice\/band \(private\)<\/option>/);
        assert.match(html, /<option value="alice\/notes" data-branch="trunk">/);
        const listed = gitCalls.find((c) => c.path.startsWith('/api/v1/repos?mine=1'));
        assert.ok(listed, 'it asked Git for the person\'s repositories');
        assert.strictEqual(listed.subject, alice.subject, 'as alice');
        assert.match(String(listed.auth), /^Bearer /, 'with Space\'s own token');
        assert.doesNotMatch(await page(dora), /Publish from this repository/, 'a deployer is not offered the choice');
    });

    await check('publishing saves the source and tells Git, as the person; a deployer cannot', async () => {
        assert.strictEqual((await form(dora, `/sites/${site.id}/git-publish`, { repo: 'alice/band', branch: 'main' })).status, 403);
        const r = await form(alice, `/sites/${site.id}/git-publish`, { repo: 'Alice/Band', branch: 'main', folder: 'site' });
        assert.strictEqual(r.status, 303, r.text);
        const put = gitCalls.filter((c) => c.method === 'PUT').at(-1);
        assert.deepStrictEqual([put.path, put.subject, put.body], ['/api/v1/repos/alice/band/space-publish', alice.subject, { site_id: site.id, branch: 'main', folder: 'site' }]);
        const src = (await t.api('GET', `/api/v1/sites/${site.id}/source`, { as: alice })).json().source;
        assert.deepStrictEqual([src.provider, src.repo_url, src.ref], ['openvibe', 'https://git.openvibe.codes/alice/band', 'main']);
    });

    await check('Git\'s deploy, as the person, lands as the site\'s preview', async () => {
        const gitToken = t.network.serviceToken('git', ['space.deploy.create']);
        const r = await t.api('POST', `/api/v1/sites/${site.id}/source/deploys?ref=main&commit_sha=${SHA}`, {
            as: gitToken, headers: { 'x-ov-subject': alice.subject, 'content-type': 'application/gzip' }, body: siteTar({ 'index.html': '<h1>The band</h1>' }),
        });
        assert.strictEqual(r.status, 201, r.text);
        assert.strictEqual(r.json().activated, false, 'a preview, never live by itself');
        const wrongBranch = await t.api('POST', `/api/v1/sites/${site.id}/source/deploys?ref=draft&commit_sha=${SHA}`, {
            as: gitToken, headers: { 'x-ov-subject': alice.subject, 'content-type': 'application/gzip' }, body: siteTar({ 'index.html': 'x' }),
        });
        assert.notStrictEqual(wrongBranch.status, 201, 'only the published branch');
        const stranger = t.user('mallory');
        const notHers = await t.api('POST', `/api/v1/sites/${site.id}/source/deploys?ref=main&commit_sha=${SHA}`, {
            as: gitToken, headers: { 'x-ov-subject': stranger.subject, 'content-type': 'application/gzip' }, body: siteTar({ 'index.html': 'x' }),
        });
        assert.strictEqual(notHers.status, 404, 'Git acting for someone else cannot deploy alice\'s site');
    });

    await check('the page shows Git\'s setting; Deploy now and Stop reach Git as the person', async () => {
        assert.strictEqual((await form(dora, `/sites/${site.id}/git-publish/deploy`, {})).status, 303, 'a deployer may ask for a deploy');
        const html = await page();
        assert.match(html, /alice\/band/);
        assert.match(html, /<code>site\/<\/code>/);
        assert.match(html, /cccccccccccc/, 'the last commit Git sent');
        assert.match(html, /Deploy now/);
        assert.strictEqual(gitCalls.filter((c) => c.path === '/api/v1/repos/alice/band/space-publish/deploy').every((c) => [alice.subject, dora.subject].includes(c.subject)), true);
        assert.strictEqual((await form(dora, `/sites/${site.id}/git-publish/stop`, {})).status, 403, 'only a maintainer stops it');
        assert.strictEqual((await form(alice, `/sites/${site.id}/git-publish/stop`, {})).status, 303);
        assert.ok(gitCalls.some((c) => c.method === 'DELETE' && c.subject === alice.subject), 'Git is told, as alice');
        assert.strictEqual((await t.api('GET', `/api/v1/sites/${site.id}/source`, { as: alice })).json().source, null);
    });

    await check('a refusal from Git leaves no source behind', async () => {
        gitAnswer = (call, json) => (call.method === 'PUT' ? json(403, { code: 'repo.forbidden', detail: 'Only the repository\'s owner chooses where it is published.' }) : json(200, { repositories: [] }));
        const r = await form(alice, `/sites/${site.id}/git-publish`, { repo: 'bob/site', branch: 'main' });
        assert.strictEqual(r.status, 403, r.text);
        assert.strictEqual((await t.api('GET', `/api/v1/sites/${site.id}/source`, { as: alice })).json().source, null);
        gitAnswer = null;
    });

    await t.close();
    done();
})();
