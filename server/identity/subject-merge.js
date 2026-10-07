'use strict';
/**
 * network.subject.merged → Space (roadmap WS-B task 5, ADR-029; Contracts 0.69.0). Two Network accounts became
 * one: `from` is an alias of `into`. In one transaction Space repoints what it keys by subject:
 *   authorship  threads, posts, attachments, spaces a moderator was added by
 *   one per person per item  thread votes and post reactions: the survivor's stays where both
 *              had one (the other is dropped), then the item's cached score is recomputed from its rows
 *   the block projection: the survivor's stays; blocking oneself is dropped
 *   space moderators  the folded-in account's spaces become the survivor's (one row per space and person)
 * Idempotent: the events consumer's inbox applies an event once, and a second run finds nothing under `from`.
 */
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const MERGE_RE = /^mrg_[0-9A-HJKMNP-TV-Z]{26}$/;

const AUTHORSHIP = [
    ['threads', 'author_subject'], ['posts', 'author_subject'], ['attachments', 'owner_subject'],
    ['space_moderators', 'added_by'],
];
// Per person per item: [table, item column, recompute(db, itemId)]
const PER_ITEM = [
    ['thread_votes', 'thread_id', async (db, id) => await db.prepare('UPDATE threads SET score = (SELECT COALESCE(SUM(value), 0)::bigint FROM thread_votes WHERE thread_id = ?) WHERE id = ?').run(id, id)],
    ['post_reactions', 'post_id', null],
];

const hasColumn = async (db, table, col) => !!await db.prepare('SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?').get(table, col);

/** The payload, or 'ignored:<why>'. */
function payloadOf(event) {
    if (!event || event.event_type !== 'network.subject.merged') return 'ignored:type';
    if (event.source !== 'network') return 'ignored:source';
    const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
    if (!MERGE_RE.test(String(p.merge_id || '')) || !SUBJECT_RE.test(String(p.from || '')) || !SUBJECT_RE.test(String(p.into || '')) || p.from === p.into) return 'ignored:payload';
    return { merge_id: p.merge_id, from: p.from, into: p.into };
}

/** Apply one merge → 'merge:applied' (with counts logged). */
async function apply(db, { from, into, merge_id: mergeId }, { log = console } = {}) {
    const counts = await db.tx(async () => {
        const c = { authored: 0, moved: 0, dropped: 0 };
        for (const [table, col] of AUTHORSHIP) {
            if (await hasColumn(db, table, col)) c.authored += (await db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(into, from)).changes;
        }
        for (const [table, item, recompute] of PER_ITEM) {
            if (!await hasColumn(db, table, 'subject_id')) continue;
            for (const r of await db.prepare(`SELECT ${item} AS i FROM ${table} WHERE subject_id = ?`).all(from)) {
                const clash = await db.prepare(`SELECT 1 FROM ${table} WHERE ${item} = ? AND subject_id = ?`).get(r.i, into);
                if (clash) { await db.prepare(`DELETE FROM ${table} WHERE ${item} = ? AND subject_id = ?`).run(r.i, from); c.dropped++; if (recompute) recompute(db, r.i); }
                else { await db.prepare(`UPDATE ${table} SET subject_id = ? WHERE ${item} = ? AND subject_id = ?`).run(into, r.i, from); c.moved++; }
            }
        }
        if (await hasColumn(db, 'space_moderators', 'subject_id')) {
            await db.prepare('DELETE FROM space_moderators WHERE subject_id = ? AND space_id IN (SELECT space_id FROM space_moderators WHERE subject_id = ?)').run(from, into);
            c.moved += (await db.prepare('UPDATE space_moderators SET subject_id = ? WHERE subject_id = ?').run(into, from)).changes;
        }
        if (await hasColumn(db, 'network_blocks', 'blocker_subject')) {
            for (const [col, other] of [['blocker_subject', 'blocked_subject'], ['blocked_subject', 'blocker_subject']]) {
                for (const b of await db.prepare(`SELECT ${other} AS o FROM network_blocks WHERE ${col} = ?`).all(from)) {
                    const clash = b.o === into || await db.prepare(`SELECT 1 FROM network_blocks WHERE ${col} = ? AND ${other} = ?`).get(into, b.o);
                    if (clash) await db.prepare(`DELETE FROM network_blocks WHERE ${col} = ? AND ${other} = ?`).run(from, b.o);
                    else await db.prepare(`UPDATE network_blocks SET ${col} = ? WHERE ${col} = ? AND ${other} = ?`).run(into, from, b.o);
                }
            }
        }
        return c;
    });
    log.log(`[Merge] ${mergeId}: ${JSON.stringify(counts)}`);
    return 'merge:applied';
}

module.exports = { payloadOf, apply };
