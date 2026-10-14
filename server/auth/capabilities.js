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
});

/** → { allowed, code, reason } (capabilities.check(); space.* since openvibe-contracts 0.149.0). */
function checkCapability(claims, capabilityId) {
    return capabilities.check(claims, capabilityId);
}

module.exports = { CAPABILITIES, checkCapability };
