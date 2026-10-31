'use strict';
/**
 * Guest drafts (openvibe.website, plan 5.9: "making websites and code without needing OpenVibe logins";
 * the owner, 2026-10-28: "serious sites, no login needed").
 *
 * A visitor who is not signed in makes a draft on openvibe.space. The draft has no owner and a random edit
 * secret; of the secret only its sha256 is kept (as OpenVibe.Design keeps guest_hash for its guest designs,
 * server/designs.js). The secret opens /spaces/<id>/edit?key=..., and a signed-in person who holds it can claim
 * the draft: it becomes theirs, the secret is cleared, and it follows every rule a signed-in person's space does.
 *
 * A guest draft is static: no publishing, no data or kv for a visitor, no server functions. What it may do is
 * build, edit and preview. The limits are the abuse screen's first half (per address a few drafts and AI builds
 * a day, per draft a few AI edits, a service-wide cap on the drafts a day) and the drafts expire seven days
 * after their last edit, which a job cleans up.
 */
const crypto = require('crypto');

/** A new edit secret: 24 random bytes, base64url (32 characters). */
function newKey() { return crypto.randomBytes(24).toString('base64url'); }

/** The secret's hash, hex. This is all that is ever stored. */
function keyHash(key) { return crypto.createHash('sha256').update(String(key)).digest('hex'); }

/**
 * Constant-time: the stored hash and the hash of the key that was offered are compared with
 * crypto.timingSafeEqual, so the answer never depends on how much of the secret was right.
 */
function keyMatches(hash, key) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return false;
    if (typeof key !== 'string' || !key) return false;
    const stored = Buffer.from(hash, 'hex');
    const given = Buffer.from(keyHash(key), 'hex');
    if (stored.length !== given.length) return false;
    return crypto.timingSafeEqual(stored, given);
}

module.exports = { newKey, keyHash, keyMatches };
