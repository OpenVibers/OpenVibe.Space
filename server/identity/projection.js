'use strict';

/**
 * The identity bookkeeping Space keeps locally (moved here from Community's pastes/store.js when the
 * forum became its own service): a display cache of what the Network says about a subject, and the
 * map from pre-subject Network numeric ids to the subjects they became. Neither is authority — the
 * Network is (ADR-009); both are only ever read to render a name or resolve an old id.
 */

/** Map subject id → projection row. */
async function getProjections(db, subjectIds) {
    const out = new Map();
    const ids = [...new Set((subjectIds || []).filter(Boolean))];
    const stmt = db.prepare('SELECT * FROM subject_projection WHERE subject_id = ?');
    for (const id of ids) { const r = await stmt.get(id); if (r) out.set(id, r); }
    return out;
}

/** Upsert what we were told about a subject. Fields left undefined keep their stored value. */
async function upsertProjection(db, p) {
    if (!p || !p.subject_id) return;
    await db.prepare(`INSERT INTO subject_projection (subject_id, username, display_name, avatar_url, profile_color, refreshed_at)
                VALUES (@subject_id, @username, @display_name, @avatar_url, @profile_color, ov_now())
                ON CONFLICT(subject_id) DO UPDATE SET
                    username = COALESCE(excluded.username, subject_projection.username),
                    display_name = COALESCE(excluded.display_name, subject_projection.display_name),
                    avatar_url = COALESCE(excluded.avatar_url, subject_projection.avatar_url),
                    profile_color = COALESCE(excluded.profile_color, subject_projection.profile_color),
                    refreshed_at = ov_now()`)
        .run({
            subject_id: p.subject_id, username: p.username ?? null, display_name: p.display_name ?? null,
            avatar_url: p.avatar_url ?? null, profile_color: p.profile_color ?? null,
        });
}

/** Subjects whose cached username matches (case-insensitive), most recently refreshed first. */
async function subjectsByUsername(db, username) {
    return (await db.prepare('SELECT subject_id FROM subject_projection WHERE lower(username) = lower(?) ORDER BY refreshed_at DESC')
        .all(String(username))).map((r) => r.subject_id);
}

// ── Legacy id map ────────────────────────────────────────────

async function mapGet(db, system, type, id) {
    return await db.prepare('SELECT target_type, target_id FROM legacy_id_map WHERE source_system = ? AND source_type = ? AND source_id = ?')
        .get(String(system), String(type), String(id)) || null;
}

async function mapSet(db, system, type, id, targetType, targetId) {
    await db.prepare(`INSERT INTO legacy_id_map (source_system, source_type, source_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(source_system, source_type, source_id) DO UPDATE SET target_type = excluded.target_type, target_id = excluded.target_id`)
        .run(String(system), String(type), String(id), String(targetType), String(targetId));
}

module.exports = { getProjections, upsertProjection, subjectsByUsername, mapGet, mapSet };
