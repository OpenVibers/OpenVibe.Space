'use strict';

/**
 * Capability checks for service tokens (audience openvibe.space), by openvibe-contracts' manifests:
 *
 *   space.site.manage    projects, members, sites, quotas (read), deleting deploys
 *   space.deploy.create  upload deploys, list them and their logs, activate, roll back
 *   space.domain.manage  add, verify and remove custom domains
 *   space.site.config    read, set and reset a site's response headers, redirects and SPA fallback
 *   space.resource.read  read the resource index (GET /api/v1/resources; ADR-048 section 3, plan T13 step 8)
 *   space.resource.control  delete a site, deploy or domain for a person (POST /api/v1/resources/control; plan T13 step 10)
 *   space.build.read     the person's own spaces and their files, as their agent works on them (plan 2026-10-22 §Z, stage Z1)
 *   space.build.create   make a new space for the person (their agent, OpenVibe.Actor)
 *   space.build.write    write the files of one of the person's own spaces
 *   space.build.publish  ask to publish one of them; the person answers before anything goes live
 *
 * A service token is judged by its capability AND by the project role of the principal it acts
 * as (domain/access.js). Browsers are judged by their role alone.
 */


const { capabilities } = require('openvibe-contracts');

const CAPABILITIES = Object.freeze({
    SITE_MANAGE: 'space.site.manage',
    DEPLOY_CREATE: 'space.deploy.create',
    DOMAIN_MANAGE: 'space.domain.manage',
    SITE_CONFIG: 'space.site.config',
    RESOURCE_READ: 'space.resource.read',
    RESOURCE_CONTROL: 'space.resource.control',
    // The builder as the person's one agent works on it (plan 2026-10-22 §Z, stage Z1)
    BUILD_READ: 'space.build.read',
    BUILD_CREATE: 'space.build.create',
    BUILD_WRITE: 'space.build.write',
    BUILD_PUBLISH: 'space.build.publish',
});

/** → { allowed, code, reason } (capabilities.check(); space.* since openvibe-contracts 0.149.0). */
function checkCapability(claims, capabilityId) {
    return capabilities.check(claims, capabilityId);
}

module.exports = { CAPABILITIES, checkCapability };
