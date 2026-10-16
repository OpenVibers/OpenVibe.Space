'use strict';
/**
 * Account export and deletion → Space (ADR-033; openvibe-sdk/account-data). What Space holds about a person:
 *
 *   their spaces        exported with their files and settings; on deletion each published one stops serving (its site
 *                       and deploys are marked deleted, as removing it would; the worker sweeps the objects), its
 *                       Spaces project closes, and the space goes, with everything other people kept in it (by
 *                       ON DELETE CASCADE: files, list items, private storage, sign-ins).
 *   in other spaces     the list items they added and their private storage are exported, then deleted; the sign-ins
 *                       they approved (grants, codes, tokens) go.
 *   hosting             their membership of hosting projects goes (staff-only today); a project they own is closed
 *                       with its sites.
 *   AI allowances       today's AI build counter goes.
 *
 * Nothing exported is a secret: sign-in codes and tokens are stored as hashes and never exported.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

const TABLES = [
    { table: 'space_app_items', subject: 'author_subject', file: 'space-list-items.json', columns: ['space_id', 'collection', 'value', 'created_at', 'updated_at'], order: 'created_at' },
    { table: 'space_app_kv', subject: 'subject', file: 'space-private-storage.json', columns: ['space_id', 'key', 'value', 'updated_at'], order: 'updated_at' },
    { table: 'space_app_grants', subject: 'subject', file: 'space-sign-ins.json', columns: ['space_id', 'capabilities', 'granted_at'], order: 'granted_at' },
    { table: 'space_app_tokens', subject: 'subject', file: null },
    { table: 'space_app_codes', subject: 'subject', file: null },
    { table: 'space_app_counters', subject: 'scope', value: (usr) => `build:${usr}`, file: null },
    { table: 'space_project_members', subject: 'principal', file: 'hosting-project-roles.json', columns: ['project_id', 'role', 'created_at'] },
];

async function extraExport(db, subject) {
    const spaces = await db.many(`SELECT id, slug, name, description, instructions, capabilities, template, forked_from, visibility, site_id IS NOT NULL AS published,
        forks, created_at, updated_at, published_at FROM space_apps WHERE owner_subject = $1 AND status = 'active' ORDER BY created_at`, [subject]);
    if (!spaces.length) return [];
    const files = await db.many('SELECT space_id, path, content FROM space_app_files WHERE space_id = ANY($1::text[]) ORDER BY space_id, path', [spaces.map((s) => s.id)]);
    const byId = new Map(spaces.map((s) => [s.id, { ...s, capabilities: JSON.parse(s.capabilities || '[]'), files: [] }]));
    for (const f of files) byId.get(f.space_id).files.push({ path: f.path, content: f.content });
    return [{ name: 'spaces.json', content: [...byId.values()] }];
}

/** Close sites (and their deploys) the way removing them does; the worker sweeps the objects nothing references. */
async function closeSites(t, siteIds, now) {
    if (!siteIds.length) return 0;
    const n = await t.exec(`UPDATE space_sites SET status = 'deleted', active_deploy_id = NULL, preview_deploy_id = NULL, preview_expires_at = NULL, deleted_at = $2, updated_at = $2
        WHERE id = ANY($1::text[]) AND status = 'active'`, [siteIds, now]);
    await t.exec("UPDATE space_deploys SET state = 'deleted', deleted_at = $2 WHERE site_id = ANY($1::text[]) AND state <> 'deleted'", [siteIds, now]);
    await t.exec('DELETE FROM space_deploy_files WHERE deploy_id IN (SELECT id FROM space_deploys WHERE site_id = ANY($1::text[]))', [siteIds]);
    return n;
}

async function extraErase(t, subjects, counts) {
    const now = Date.now();
    // Their spaces: published ones stop serving, then the spaces go with what others kept in them.
    const spaces = await t.many("SELECT id, site_id FROM space_apps WHERE owner_subject = ANY($1::text[])", [subjects]);
    await closeSites(t, spaces.map((s) => s.site_id).filter(Boolean), now);
    counts.add(counts.erased, 'space_apps', await t.exec('DELETE FROM space_apps WHERE owner_subject = ANY($1::text[])', [subjects]));
    // Projects they own (their Spaces project, or a staff hosting project): closed with their sites.
    const projects = await t.many("SELECT id FROM space_projects WHERE owner_subject = ANY($1::text[]) AND status = 'active'", [subjects]);
    if (projects.length) {
        const ids = projects.map((p) => p.id);
        const sites = await t.many("SELECT id FROM space_sites WHERE project_id = ANY($1::text[]) AND status = 'active'", [ids]);
        await closeSites(t, sites.map((s) => s.id), now);
        await t.exec("UPDATE space_projects SET status = 'deleted', deleted_at = $2, updated_at = $2 WHERE id = ANY($1::text[])", [ids, now]);
        counts.add(counts.erased, 'space_projects', ids.length);
    }
    await t.exec('DELETE FROM space_app_projects WHERE owner_subject = ANY($1::text[])', [subjects]);
}

/** The account-data handle over Space's database. */
function create({ db, log = console } = {}) {
    return createAccountData({ db, service: 'space', tables: TABLES, extraExport, extraErase, log });
}

module.exports = { create, TABLES, TOPICS };
