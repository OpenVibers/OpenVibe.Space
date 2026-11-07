'use strict';
/**
 * The official example spaces (plan §4 Space): seeds/official-spaces/ creates three real, published spaces
 * through Space's own modules, owned by the official account, and running it again changes nothing. Also
 * checks the pages a visitor gets, that a slug is never taken from a person, and that a conflict is reported
 * rather than overwriting someone else's space.
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { loadOfficialSpaces, seedOfficialSpaces } = require('../server/spaces/official');

const quiet = { info() {}, warn() {}, error() {} };
const OFFICIAL = { kind: 'user', subject: 'usr_01JZ0000000000000000000AAA', staff: true, user: { username: 'goosely', display_name: 'goosely' } };

(async () => {
    const t = await boot();
    try {
        await check('the seed files are one self-contained page each, on the Space SDK', async () => {
            const seeds = loadOfficialSpaces();
            assert.strictEqual(seeds.length, 3);
            assert.deepStrictEqual(seeds.map((s) => s.slug), ['ov-links', 'ov-portfolio', 'ov-night']);
            for (const s of seeds) {
                assert.strictEqual(s.files.length, 1);
                assert.strictEqual(s.files[0].path, 'index.html');
                const html = s.files[0].content;
                assert.ok(/<meta name="viewport"/.test(html), `${s.slug} has no viewport meta`);
                assert.ok(html.includes('src="/_openvibe/sdk.js"') === (s.capabilities.length > 0), `${s.slug}: the SDK is loaded exactly when it asks for a capability`);
                assert.ok(/<title>[^<]+<\/title>/.test(html), `${s.slug} has no title`);
                assert.ok(!/data-ov-share-gate/.test(html), `${s.slug} carries a share gate it has no share API for`);
            }
        });

        const first = await seedOfficialSpaces({ spaces: t.ctx.spaces, viewer: OFFICIAL, log: quiet });
        await check('the first run creates and publishes all three, owned by the official account', async () => {
            assert.deepStrictEqual(first.map((r) => r.action), ['created', 'created', 'created']);
            const gallery = await t.ctx.spaces.gallery({ limit: 10 });
            assert.strictEqual(gallery.length, 3);
            for (const row of gallery) {
                assert.strictEqual(row.owner_subject, OFFICIAL.subject);
                assert.ok(row.site_id, `${row.slug} is not published`);
                assert.strictEqual(row.visibility, 'public');
            }
        });

        await check('each published space serves its page at <slug>.openvibe.website', async () => {
            const expected = {
                'ov-links': 'Every OpenVibe site in one place',
                'ov-portfolio': 'A family of sites that share',
                'ov-night': 'OpenVibe community night',
            };
            for (const [slug, words] of Object.entries(expected)) {
                const r = await t.get(`${slug}.openvibe.website`, '/');
                assert.strictEqual(r.status, 200, `${slug} → ${r.status}`);
                assert.ok(r.text.includes(words), `${slug} page is missing "${words}"`);
            }
        });

        await check('a second run changes nothing', async () => {
            const again = await seedOfficialSpaces({ spaces: t.ctx.spaces, viewer: OFFICIAL, log: quiet });
            assert.deepStrictEqual(again.map((r) => r.action), ['unchanged', 'unchanged', 'unchanged']);
            assert.strictEqual((await t.ctx.spaces.gallery({ limit: 10 })).length, 3);
        });

        await check('a slug a seed owns is refused to anyone else, and the space is untouched', async () => {
            const person = { kind: 'user', subject: 'usr_01JZ0000000000000000000BBB', staff: false, user: { username: 'alex', display_name: 'Alex' } };
            const before = await t.ctx.spaces.getBySlug('ov-links');
            await assert.rejects(
                t.ctx.spaces.create(person, { name: 'Mine', slug: 'ov-links', files: [{ path: 'index.html', content: '<h1>mine</h1>' }] }),
                (e) => e.status === 409 && e.code === 'space.slug_taken',
            );
            assert.strictEqual((await t.ctx.spaces.getBySlug('ov-links')).id, before.id);
        });

        await check('--revise repairs drift and deploys it, and a third run is unchanged again', async () => {
            const space = await t.ctx.spaces.getBySlug('ov-links');
            await t.ctx.spaces.saveFiles(OFFICIAL, space, [{ path: 'index.html', content: '<h1>drift</h1>' }]);
            await t.ctx.spaces.publish(OFFICIAL, space);
            assert.ok((await t.get('ov-links.openvibe.website', '/')).text.includes('drift'), 'the drift is what is live before the revise');
            const revised = await seedOfficialSpaces({ spaces: t.ctx.spaces, viewer: OFFICIAL, log: quiet, revise: true });
            assert.deepStrictEqual(revised.map((r) => r.action), ['revised', 'unchanged', 'unchanged']);
            const r = await t.get('ov-links.openvibe.website', '/');
            assert.ok(r.text.includes('Every OpenVibe site in one place'), 'the revise was deployed, not only stored');
            const again = await seedOfficialSpaces({ spaces: t.ctx.spaces, viewer: OFFICIAL, log: quiet, revise: true });
            assert.deepStrictEqual(again.map((r) => r.action), ['unchanged', 'unchanged', 'unchanged']);
        });

        await check('a slug that belongs to someone else is reported, never created over or changed', async () => {
            const calls = { create: 0, publish: 0, save: 0 };
            const fake = {
                async getBySlug(slug) { return { id: 'spc_other', slug, owner_subject: 'usr_01JZ0000000000000000000CCC', site_id: 'site_other' }; },
                async create() { calls.create++; },
                async publish() { calls.publish++; },
                async saveFiles() { calls.save++; },
                async files() { return []; },
                urlOf() { return 'https://someone.openvibe.website'; },
            };
            const out = await seedOfficialSpaces({ spaces: fake, viewer: OFFICIAL, log: quiet });
            assert.deepStrictEqual(out.map((r) => r.action), ['conflict', 'conflict', 'conflict']);
            assert.deepStrictEqual(calls, { create: 0, publish: 0, save: 0 });
        });
    } finally {
        await t.close();
    }
    done();
})();
