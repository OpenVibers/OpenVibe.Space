#!/usr/bin/env node
'use strict';

/**
 * Create and publish the official example spaces (plan §4 Space) through Space's own modules:
 *
 *   node scripts/seed-official-spaces.js            # create what is missing; publish what is not published
 *   node scripts/seed-official-spaces.js --revise   # also rewrite files and settings that differ from the seed
 *
 * The seeds are seeds/official-spaces/ (spaces.json and one index.html each), adaptations of the Space kit's
 * site-links, site-portfolio and site-event templates. Ownership follows the official OpenVibe account, the
 * signed-in staff account the other official content uses; it is never inferred from a request.
 *
 *   SPACE_OFFICIAL_SUBJECT      the account's usr_… subject (default: the owner's account)
 *   SPACE_OFFICIAL_USERNAME     its @name (default: goosely)
 *
 * Runs with the service's environment (DATABASE_URL, DATABASE_DIRECT_URL, SPACE_STORAGE_DIR, …); in development
 * without DATABASE_URL it uses the embedded PGlite database. Writes are idempotent: running it twice changes
 * nothing.
 */
require('dotenv').config();
const express = require('express');
const config = require('../server/config');
const { load } = require('../server/hosting-config');
const { openDb } = require('../server/db');
const { createHosting } = require('../server/hosting');
const { seedOfficialSpaces } = require('../server/spaces/official');

const OFFICIAL = {
    subject: process.env.SPACE_OFFICIAL_SUBJECT || 'usr_01KKT9AC60KM7CRTB3WN1Z8P56',
    username: process.env.SPACE_OFFICIAL_USERNAME || 'goosely',
};

(async () => {
    const hostingConfig = load(process.env);
    const db = await openDb(config);
    const app = express();
    app.locals.metrics = null;
    createHosting(app, { db, auth: { verify: async () => null, keys: { loaded: () => false } }, config: hostingConfig, log: console });
    const viewer = { kind: 'user', subject: OFFICIAL.subject, staff: true, user: { username: OFFICIAL.username, display_name: OFFICIAL.username } };
    try {
        const results = await seedOfficialSpaces({ spaces: app.locals.ctx.spaces, viewer, log: console, revise: process.argv.includes('--revise') });
        for (const r of results) console.log(`[official-spaces] ${r.action.padEnd(9)} ${r.slug}${r.url ? ` → ${r.url}` : ''}`);
        const failed = results.filter((r) => r.action === 'conflict').length;
        console.log(`[official-spaces] ${results.length} seed(s), ${failed} conflict(s)`);
        if (failed) process.exitCode = 1;
    } finally {
        await db.close();
    }
})().catch((err) => { console.error('[official-spaces] failed:', err && err.stack || err); process.exit(1); });
