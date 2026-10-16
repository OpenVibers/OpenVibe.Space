'use strict';
/**
 * Spaces (plan T20 step 2; owner 2026-10-08: "a system where people can make spaces that interact with your openvibe
 * account and the network and interconnected with sdk and such, compete with openai chatgpt spaces type of product but
 * better"): small web apps a person makes here — from a template, from a sentence through the AI builder, or by forking
 * someone else's — edited and run in the browser, and published at <slug>.openvibe.website, where the space SDK
 * (/_openvibe/sdk.js, server/spaces/sdk.js) gives them the visitor's sign-in, shared lists, private storage and AI.
 *
 * A space is a row in space_apps (spc_<ULID>) with its source files in space_app_files. Publishing deploys those files
 * to a site of the same name in the owner's Spaces project, so the hosting engine serves it (immutable deploys,
 * takedowns, quotas) and publishing opens with hosting (SPACE_PUBLIC_HOSTING, or OpenVibe staff). Making, editing,
 * previewing and the AI builder need no hosting: the preview runs in a sandboxed frame on the editor's own page.
 */
const crypto = require('crypto');
const { ids } = require('openvibe-contracts');
const { ApiError } = require('../http/errors');

const SPACE_RE = /^spc_[0-9A-HJKMNP-TV-Z]{26}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;
const CAPABILITIES = ['profile', 'data', 'kv', 'ai'];
const DAY = 24 * 3600 * 1000;

/** A file path a space may have: up to four short segments of safe characters, relative, never "..". */
function cleanPath(p) {
    const s = String(p || '').trim().replace(/^\.?\/+/, '');
    if (!s || s.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){0,3}$/.test(s) || s.split('/').includes('..')) return null;
    return s;
}

const text = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const capsOf = (v) => {
    let list = v;
    if (typeof v === 'string') { try { list = JSON.parse(v); } catch { list = []; } }
    return [...new Set((Array.isArray(list) ? list : []).map(String).filter((c) => CAPABILITIES.includes(c)))];
};

/** "My Pizza Poll!" → "my-pizza-poll" (a DNS label), padded so it is at least three characters. */
function slugBase(name) {
    const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
    return s.length >= 3 ? s : `space-${s}`.replace(/-+$/, '');
}

function createSpaces({ store, config, projects, sites, deploys, takedowns, log = console }) {
    const { db } = store;
    const limits = config.spaces;
    const q = {
        byId: db.prepare("SELECT * FROM space_apps WHERE id = ? AND status = 'active'"),
        bySlug: db.prepare("SELECT * FROM space_apps WHERE slug = ? AND status = 'active'"),
        bySite: db.prepare("SELECT * FROM space_apps WHERE site_id = ? AND status = 'active'"),
        slugUsed: db.prepare("SELECT 1 FROM space_apps WHERE slug = ? AND status = 'active' UNION ALL SELECT 1 FROM space_sites WHERE name = ? AND status = 'active'"),
        ownedCount: db.prepare("SELECT COUNT(*) AS n FROM space_apps WHERE owner_subject = ? AND status = 'active'"),
        mine: db.prepare("SELECT * FROM space_apps WHERE owner_subject = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 100"),
        insert: db.prepare(`INSERT INTO space_apps (id, slug, owner_subject, owner_username, owner_name, name, description, instructions, capabilities,
                            template, forked_from, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?)`),
        files: db.prepare('SELECT path, content FROM space_app_files WHERE space_id = ? ORDER BY path'),
        clearFiles: db.prepare('DELETE FROM space_app_files WHERE space_id = ?'),
        addFile: db.prepare('INSERT INTO space_app_files (space_id, path, content, updated_at) VALUES (?, ?, ?, ?)'),
        touch: db.prepare('UPDATE space_apps SET updated_at = ? WHERE id = ?'),
        settings: db.prepare('UPDATE space_apps SET name = ?, description = ?, instructions = ?, capabilities = ?, visibility = ?, updated_at = ? WHERE id = ?'),
        building: db.prepare('UPDATE space_apps SET building_run_id = ?, building_prompt = ?, updated_at = ? WHERE id = ?'),
        built: db.prepare('UPDATE space_apps SET building_run_id = NULL, building_prompt = NULL, name = ?, description = ?, instructions = ?, capabilities = ?, updated_at = ? WHERE id = ? AND building_run_id = ?'),
        buildFailed: db.prepare('UPDATE space_apps SET building_run_id = NULL, building_prompt = NULL, updated_at = ? WHERE id = ? AND building_run_id = ?'),
        forked: db.prepare('UPDATE space_apps SET forks = forks + 1 WHERE id = ?'),
        published: db.prepare('UPDATE space_apps SET site_id = ?, published_at = ?, updated_at = ? WHERE id = ?'),
        unpublished: db.prepare('UPDATE space_apps SET site_id = NULL, published_at = NULL, updated_at = ? WHERE id = ?'),
        // Deleting is for good: its files, lists, everyone's private storage and sign-ins in it go too (ON DELETE CASCADE).
        remove: db.prepare('DELETE FROM space_apps WHERE id = ?'),
        project: db.prepare('SELECT project_id FROM space_app_projects WHERE owner_subject = ?'),
        addProject: db.prepare('INSERT INTO space_app_projects (owner_subject, project_id, created_at) VALUES (?, ?, ?) ON CONFLICT (owner_subject) DO NOTHING'),
        gallery: db.prepare(`SELECT * FROM space_apps WHERE status = 'active' AND site_id IS NOT NULL AND visibility = 'public'
                             AND (? = '' OR name ILIKE ? OR description ILIKE ? OR owner_username ILIKE ?)
                             ORDER BY CASE WHEN ? = 'popular' THEN forks ELSE 0 END DESC, published_at DESC LIMIT ?`),
        counter: db.prepare(`INSERT INTO space_app_counters (scope, day, n) VALUES (?, ?, 1)
                             ON CONFLICT (scope, day) DO UPDATE SET n = space_app_counters.n + 1 RETURNING n`),
        counterGet: db.prepare('SELECT n FROM space_app_counters WHERE scope = ? AND day = ?'),
    };

    const isSpaceId = (v) => typeof v === 'string' && SPACE_RE.test(v);
    const hostnameOf = (space) => `${space.slug}.${config.sitesDomain}`;
    const urlOf = (space) => {
        const u = new URL(config.baseUrl);
        return `${u.protocol}//${hostnameOf(space)}${u.port ? `:${u.port}` : ''}`;
    };
    const today = () => new Date(store.now()).toISOString().slice(0, 10);
    const personOf = (viewer) => {
        if (!viewer || viewer.kind !== 'user' || !ids.isSubjectId('user', viewer.subject)) throw new ApiError(401, 'auth.required', 'sign in with OpenVibe first');
        const u = viewer.user || {};
        return { subject: viewer.subject, username: text(u.username || u.preferred_username, 40), name: text(u.display_name || u.name || u.username, 80) };
    };

    async function get(id) { return isSpaceId(id) ? (await q.byId.get(id)) || null : null; }
    async function getBySlug(slug) { return typeof slug === 'string' && SLUG_RE.test(slug) ? (await q.bySlug.get(slug)) || null : null; }
    async function forSite(siteId) { return siteId ? (await q.bySite.get(siteId)) || null : null; }

    const isOwner = (viewer, space) => Boolean(viewer && viewer.kind === 'user' && viewer.subject === space.owner_subject);
    /** read: a published space anyone can open, or the owner's (and staff's) own drafts. own: the owner or staff. */
    async function load(viewer, slug, need = 'read') {
        const space = await getBySlug(slug);
        const notFound = new ApiError(404, 'space.not_found', 'no such space');
        if (!space) throw notFound;
        const owner = isOwner(viewer, space) || Boolean(viewer && viewer.staff);
        if (need === 'own' && !owner) throw isOwner(viewer, space) || space.site_id ? new ApiError(403, 'space.not_owner', 'only the space\'s maker can change it') : notFound;
        if (need === 'read' && !owner && !space.site_id) throw notFound;
        return { space, owner };
    }

    async function files(space) { return await q.files.all(space.id); }

    /** Checked file list: safe unique paths, an index.html, within the file and size limits. */
    function checkFiles(list) {
        if (!Array.isArray(list) || !list.length) throw new ApiError(422, 'space.files_required', 'a space needs at least an index.html');
        if (list.length > limits.maxFiles) throw new ApiError(422, 'space.too_many_files', `a space has at most ${limits.maxFiles} files`);
        const seen = new Set();
        let total = 0;
        const out = [];
        for (const f of list) {
            const path = cleanPath(f && f.path);
            if (!path) throw new ApiError(422, 'space.invalid_path', `"${String(f && f.path).slice(0, 80)}" is not a file path a space can have (letters, digits, ".", "-", "_", up to four folders)`);
            if (seen.has(path.toLowerCase())) throw new ApiError(422, 'space.duplicate_path', `${path} is there twice`);
            if (typeof f.content !== 'string') throw new ApiError(422, 'space.invalid_content', `${path} has no text content`);
            seen.add(path.toLowerCase());
            total += Buffer.byteLength(f.content);
            out.push({ path, content: f.content });
        }
        if (total > limits.maxBytes) throw new ApiError(413, 'space.too_large', `a space's files add up to at most ${Math.round(limits.maxBytes / 1024)} KB`);
        if (!seen.has('index.html')) throw new ApiError(422, 'space.index_required', 'a space needs an index.html');
        return out;
    }

    async function writeFiles(space, list, now) {
        await store.tx(async () => {
            await q.clearFiles.run(space.id);
            for (const f of list) await q.addFile.run(space.id, f.path, f.content, now);
            await q.touch.run(now, space.id);
        });
    }

    async function uniqueSlug(name) {
        const base = slugBase(name);
        for (let i = 0; i < 8; i++) {
            const tail = crypto.randomBytes(3).toString('hex').slice(0, 4);
            const slug = `${base.slice(0, 34).replace(/-+$/, '')}-${tail}`;
            try { sites.checkName(slug); } catch { continue; }
            if (!(await q.slugUsed.get(slug, slug))) return slug;
        }
        throw new ApiError(503, 'space.slug_unavailable', 'could not find a free address for the space; try another name');
    }

    /** A new space owned by the viewer: from given files (a template, a fork, an AI build) and settings. */
    async function create(viewer, input = {}) {
        const person = personOf(viewer);
        if ((await q.ownedCount.get(person.subject)).n >= limits.maxPerOwner) throw new ApiError(429, 'quota.spaces', `you have ${limits.maxPerOwner} spaces already; delete one to make another`);
        const name = text(input.name, 40) || 'Untitled space';
        const fileList = checkFiles(input.files);
        const now = store.now();
        const id = `spc_${ids.ulid(now)}`;
        const slug = await uniqueSlug(name);
        await store.tx(async () => {
            await q.insert.run(id, slug, person.subject, person.username, person.name, name, text(input.description, 400), String(input.instructions || '').trim().slice(0, 4000),
                JSON.stringify(capsOf(input.capabilities)), input.template ? text(input.template, 40) : null, input.forked_from || null, now, now);
            for (const f of fileList) await q.addFile.run(id, f.path, f.content, now);
        });
        return await get(id);
    }

    async function saveFiles(viewer, space, list) {
        const checked = checkFiles(list);
        await writeFiles(space, checked, store.now());
        return checked;
    }

    async function updateSettings(viewer, space, input = {}) {
        const name = input.name !== undefined ? text(input.name, 40) : space.name;
        if (!name) throw new ApiError(422, 'space.invalid_name', 'a space needs a name');
        const visibility = input.visibility !== undefined ? String(input.visibility) : space.visibility;
        if (!['public', 'unlisted'].includes(visibility)) throw new ApiError(422, 'space.invalid_visibility', 'visibility is public (in the gallery) or unlisted (only by its link)');
        await q.settings.run(name, input.description !== undefined ? text(input.description, 400) : space.description,
            input.instructions !== undefined ? String(input.instructions || '').trim().slice(0, 4000) : space.instructions,
            JSON.stringify(input.capabilities !== undefined ? capsOf(input.capabilities) : capsOf(space.capabilities)), visibility, store.now(), space.id);
        return await get(space.id);
    }

    async function fork(viewer, space) {
        const copy = await create(viewer, {
            name: `${space.name}`.slice(0, 33) + ' (fork)', description: space.description, instructions: space.instructions,
            capabilities: capsOf(space.capabilities), files: await files(space), template: space.template, forked_from: space.id,
        });
        await q.forked.run(space.id);
        return copy;
    }

    // ── AI builds: a run in progress is remembered on the space, so a reload of the editor keeps waiting for it ──
    async function startBuild(space, runId, prompt) { await q.building.run(runId, text(prompt, 2000), store.now(), space.id); }
    /** The build's output replaces the files and settings, once (only while that run is still the space's build). */
    async function finishBuild(space, runId, out) {
        const list = checkFiles(out.files);
        const now = store.now();
        let applied = false;
        await store.tx(async () => {
            const r = await q.built.run(text(out.name, 40) || space.name, text(out.description, 400), String(out.instructions || '').slice(0, 4000), JSON.stringify(capsOf(out.capabilities)), now, space.id, runId);
            if (!r.changes) return;
            applied = true;
            await q.clearFiles.run(space.id);
            for (const f of list) await q.addFile.run(space.id, f.path, f.content, now);
        });
        return applied;
    }
    async function failBuild(space, runId) { await q.buildFailed.run(store.now(), space.id, runId); }

    /** Count one use of a daily allowance; false when `max` is already used up today. */
    async function spend(scope, max) {
        const day = today();
        const cur = await q.counterGet.get(scope, day);
        if (cur && cur.n >= max) return false;
        await q.counter.get(scope, day);
        return true;
    }
    async function used(scope) { const cur = await q.counterGet.get(scope, today()); return cur ? cur.n : 0; }

    // ── Publishing: the hosting engine serves a published space ──
    const canPublish = (viewer) => Boolean(config.publicHosting || (viewer && viewer.staff));

    async function spacesProject(viewer, person) {
        const row = await q.project.get(person.subject);
        if (row) {
            const p = await projects.get(row.project_id);
            if (p && p.status !== 'deleted') return p;
        }
        const p = await projects.create(viewer, { name: 'Spaces' });
        await q.addProject.run(person.subject, p.id, store.now());
        return p;
    }

    async function publish(viewer, space, { traceparent } = {}) {
        const person = personOf(viewer);
        if (!isOwner(viewer, space)) throw new ApiError(403, 'space.not_owner', 'only the space\'s maker publishes it');
        if (!canPublish(viewer)) throw new ApiError(403, 'space.not_launched', 'Publishing a space at its own address opens with OpenVibe.Space\'s public hosting. Until then a space runs here, in its editor.');
        if (space.building_run_id) throw new ApiError(409, 'space.building', 'the AI is still changing this space; publish when it is done');
        const project = await spacesProject(viewer, person);
        let site = space.site_id ? await sites.get(space.site_id) : null;
        if (!site || site.status !== 'active') site = await sites.create(viewer, project, { name: space.slug });
        const entries = (await files(space)).map((f) => ({ path: f.path, data: Buffer.from(f.content, 'utf8') }));
        const pre = await deploys.precheck(viewer, site.id);
        const deploy = await deploys.create(viewer, pre, entries, { source: 'files', activate: true, notes: [`space ${space.id}`], traceparent });
        const now = store.now();
        await q.published.run(site.id, space.published_at || now, now, space.id);
        return { space: await get(space.id), site, deploy, url: urlOf(space) };
    }

    async function unpublish(viewer, space) {
        if (!space.site_id) return await get(space.id);
        const site = await sites.get(space.site_id);
        if (site && site.status === 'active') await sites.remove(viewer, site.id, { deploys });
        await q.unpublished.run(store.now(), space.id);
        return await get(space.id);
    }

    async function remove(viewer, space) {
        if (space.site_id) await unpublish(viewer, space);
        await q.remove.run(space.id);
    }

    async function gallery({ q: query = '', sort = 'new', limit = 48 } = {}) {
        const s = text(query, 80);
        const like = `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        const rows = await q.gallery.all(s, like, like, like, sort === 'popular' ? 'popular' : 'new', Math.min(100, Math.max(1, limit)));
        const out = [];
        for (const r of rows) {
            const site = await sites.get(r.site_id);
            if (site && site.status === 'active' && !(takedowns && await takedowns.ofSite(site))) out.push(r);
        }
        return out;
    }
    async function mine(viewer) { return await q.mine.all(personOf(viewer).subject); }

    return {
        CAPABILITIES, isSpaceId, get, getBySlug, forSite, load, isOwner, files, create, saveFiles, updateSettings, fork,
        startBuild, finishBuild, failBuild, spend, used, canPublish, publish, unpublish, remove, gallery, mine, hostnameOf, urlOf,
        personOf, capsOf, checkFiles, DAY,
    };
}

module.exports = { createSpaces, cleanPath, slugBase, CAPABILITIES };
