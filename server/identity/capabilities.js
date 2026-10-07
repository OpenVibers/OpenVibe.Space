'use strict';

/**
 * Capability checks for service tokens, through openvibe-contracts' manifests.
 */
const { capabilities } = require('openvibe-contracts');

/** → { allowed, code, reason } like capabilities.check(). */
function checkCapability(claims, capabilityId) {
    return capabilities.check(claims, capabilityId);
}

/** Does this viewer's service token grant the capability? (Browsers and anonymous: never.) */
function serviceHas(viewer, capabilityId) {
    return !!(viewer && viewer.kind === 'service' && checkCapability(viewer.claims, capabilityId).allowed);
}

/**
 * Staff for the forum: a browser holding staff.moderation.discussions, or a service that vouches
 * for a staff person with X-OV-Staff: 1 and holds space.forum.manage.
 */
function discussionStaff(viewer) {
    if (!viewer) return false;
    if (viewer.kind === 'user') return !!(viewer.discussionStaff !== undefined ? viewer.discussionStaff : viewer.staff);
    return viewer.kind === 'service' && !!viewer.vouchesStaff && serviceHas(viewer, 'space.forum.manage');
}

/**
 * A forum moderator: discussion staff, or a service holding space.forum.manage that acts as itself
 * (no X-OV-Subject) — e.g. an owner service hiding the thread of an entity it took down. A service
 * acting for a person moderates only when it vouches that person is staff. A space's own moderators
 * (space_moderators) are people, and forum/service.js asks for them separately.
 */
function discussionModerator(viewer) {
    return discussionStaff(viewer) || (!!viewer && viewer.kind === 'service' && !viewer.subject && serviceHas(viewer, 'space.forum.manage'));
}

module.exports = { checkCapability, serviceHas, discussionStaff, discussionModerator };
