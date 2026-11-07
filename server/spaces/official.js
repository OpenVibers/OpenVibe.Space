'use strict';
/**
 * The official example spaces (plan §4 Space, "official example spaces"): a link page, a portfolio and an
 * event page, owned by the official OpenVibe account and published at <slug>.openvibe.website. They are
 * adaptations of the Space kit's site-links, site-portfolio and site-event templates, so what the gallery
 * shows is a real page built the way the kit says, not a placeholder.
 *
 * seeds/official-spaces/spaces.json is the list; each file is one self-contained index.html. This module is
 * idempotent: a space whose slug exists and already belongs to the official account is left alone (and
 * published if its first publish never finished); { revise: true } also rewrites files and settings that
 * differ from the seed. A slug that belongs to someone else is reported, never taken or changed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'seeds', 'official-spaces');

/** The seed as the seed function takes it: [{ slug, name, description, capabilities, files: [{ path, content }] }]. */
function loadOfficialSpaces() {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'spaces.json'), 'utf8'));
    return (manifest.spaces || []).map((s) => ({
        slug: String(s.slug || ''),
        name: String(s.name || ''),
        description: String(s.description || ''),
        capabilities: Array.isArray(s.capabilities) ? s.capabilities : [],
        files: (s.files || []).map((f) => ({
            path: String(f.path || ''),
            content: fs.readFileSync(path.join(DIR, path.basename(String(f.file || ''))), 'utf8'),
        })),
    }));
}

/** Whether the files the site's active deploy serves are exactly the seed's. */
function servesFiles(deployed, wanted) {
    if (!deployed || deployed.length !== wanted.length) return false;
    const byPath = new Map(deployed.map((f) => [f.path, f.sha256]));
    return wanted.every((f) => byPath.get(f.path) === crypto.createHash('sha256').update(f.content).digest('hex'));
}

/** Whether the stored files are already exactly the seed's. */
function sameFiles(stored, wanted) {
    if (stored.length !== wanted.length) return false;
    const byPath = new Map(stored.map((f) => [f.path, f.content]));
    return wanted.every((f) => byPath.get(f.path) === f.content);
}

/** The settings the seed holds, as a space row carries them. */
function sameSettings(space, def) {
    const caps = (v) => {
        let list = v;
        if (typeof v === 'string') { try { list = JSON.parse(v); } catch { list = []; } }
        return [...new Set((Array.isArray(list) ? list : []).map(String))].sort();
    };
    return space.name === def.name && space.description === def.description
        && JSON.stringify(caps(space.capabilities)) === JSON.stringify([...def.capabilities].map(String).sort());
}

/**
 * Create and publish the official examples. `spaces` is app.locals.ctx.spaces (the service's own module);
 * `viewer` is the official account as the module sees a signed-in staff person. Answers one result per
 * seed: { slug, id, action, url } where action is created | revised | unchanged | published | conflict.
 */
async function seedOfficialSpaces({ spaces, viewer, log = console, revise = false }) {
    if (!viewer || viewer.kind !== 'user' || !viewer.subject) throw new Error('seedOfficialSpaces needs the official account as a signed-in viewer');
    const out = [];
    for (const def of loadOfficialSpaces()) {
        let space = await spaces.getBySlug(def.slug);
        let action = 'unchanged';
        if (space && space.owner_subject !== viewer.subject) {
            // Never take a person's address or change their space: report it and move on.
            log.warn(`[official-spaces] ${def.slug} belongs to ${space.owner_subject || 'someone'}, not the official account: skipped`);
            out.push({ slug: def.slug, id: space.id, action: 'conflict', url: null });
            continue;
        }
        if (!space) {
            space = await spaces.create(viewer, { ...def, slug: def.slug });
            action = 'created';
            log.info(`[official-spaces] created ${def.slug} (${space.id})`);
        } else if (revise) {
            const filesChanged = !sameFiles(await spaces.files(space), def.files);
            const settingsChanged = !sameSettings(space, def);
            if (filesChanged) await spaces.saveFiles(viewer, space, def.files);
            if (settingsChanged) await spaces.updateSettings(viewer, space, {
                name: def.name, description: def.description, capabilities: def.capabilities,
            });
            if (filesChanged || settingsChanged) {
                action = 'revised';
                log.info(`[official-spaces] revised ${def.slug} (${space.id})`);
            }
        }
        // Publish when the site does not serve anything (a first publish, a deleted site, or a run that saved the
        // files and died before deploying). With --revise, also when it serves something other than the seed.
        const deployed = await spaces.publishedFiles(space);
        if (!deployed || (revise && !servesFiles(deployed, def.files))) {
            const published = await spaces.publish(viewer, space);
            space = published.space;
            if (action === 'unchanged') action = 'published';
            log.info(`[official-spaces] published ${def.slug} at ${published.url}`);
        }
        out.push({ slug: def.slug, id: space.id, action, url: spaces.urlOf(space) });
    }
    return out;
}

module.exports = { loadOfficialSpaces, seedOfficialSpaces, sameFiles, sameSettings };
