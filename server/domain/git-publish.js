'use strict';
/**
 * A site published from a person's OpenVibe.Git repository (plan §AD.10 step 2; the owner, 11-15: "use
 * openvibe.space to host whatever it wants, any code, any repository").
 *
 * Host still never fetches a repository and holds no credential for one (domain/deploys.js): OpenVibe.Git sends the
 * folder of each push to the published branch to this site's git deploy door (POST /api/v1/sites/:id/source/deploys),
 * as the person, and it lands as the site's preview. Here Host only tells Git what to publish, acting as that person:
 * Space's own Network service token for openvibe.git (git.repo.read, git.repo.write) with the person in X-OV-Subject.
 * Git checks the repository is theirs; the site's source row (provider openvibe) is what the deploy door matches.
 *
 *   createGitPublish({ config, fetchImpl, log }) →
 *     enabled
 *     repos(viewer) → [{ full_name, default_branch, visibility }]   the person's own repositories
 *     status(viewer, repo) → { site_id, branch, folder, last } | null
 *     set(viewer, repo, { site_id, branch, folder }) → the setting
 *     stop(viewer, repo)
 *     deployNow(viewer, repo) → the setting
 *     repoUrl('owner/name') → https://git.openvibe.codes/owner/name     repoOf(source) → 'owner/name' | null
 */
const { serviceAuth } = require('openvibe-contracts');
const { ApiError } = require('../http/errors');

const REPO_RE = /^[a-z0-9][a-z0-9._-]{0,99}\/[a-z0-9][a-z0-9._-]{0,99}$/;
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;

function createGitPublish({ config, fetchImpl = globalThis.fetch, log = console, tokens = null } = {}) {
    const cfg = config.git || {};
    const publicUrl = String(cfg.url || 'https://git.openvibe.codes').replace(/\/+$/, '');
    const host = (() => { try { return new URL(publicUrl).hostname; } catch { return 'git.openvibe.codes'; } })();
    const enabled = Boolean(cfg.internalUrl) && (Boolean(tokens) || Boolean(config.oauth && config.oauth.clientSecret));
    const client = tokens || (enabled ? serviceAuth.createTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: (config.oauth && config.oauth.clientId) || 'space', clientSecret: config.oauth.clientSecret,
        audience: 'openvibe.git', scope: 'git.repo.read git.repo.write', fetchImpl,
    }) : null);

    const repoOk = (repo) => {
        const r = String(repo || '').trim().toLowerCase();
        if (!REPO_RE.test(r)) throw new ApiError(422, 'publish.repo_invalid', 'name the repository as owner/name');
        return r;
    };
    const repoUrl = (repo) => `${publicUrl}/${repoOk(repo)}`;
    /** The repository a site's source names, when it is on OpenVibe.Git. */
    const repoOf = (source) => {
        if (!source || source.provider !== 'openvibe') return null;
        const m = /^https:\/\/([^/]+)\/([^/]+\/[^/]+)$/.exec(String(source.repo_url || ''));
        return m && m[1] === host ? m[2].toLowerCase() : null;
    };

    async function call(viewer, method, path, body) {
        if (!enabled) throw new ApiError(503, 'publish.off', 'publishing from OpenVibe.Git is not set up on this server');
        const subject = viewer && viewer.subject;
        if (!SUBJECT_RE.test(String(subject || ''))) throw new ApiError(401, 'auth.required', 'sign in first');
        let res;
        try {
            res = await fetchImpl(`${cfg.internalUrl}${path}`, {
                method,
                headers: { Accept: 'application/json', 'X-OV-Subject': subject, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await client.authHeaders()) },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                redirect: 'error', signal: AbortSignal.timeout(cfg.timeoutMs || 15_000),
            });
        } catch (err) {
            log.warn(`[space] git publish ${method} ${path}: ${String((err && err.message) || err).slice(0, 200)}`);
            throw new ApiError(502, 'publish.git_unreachable', 'OpenVibe.Git did not answer; try again in a moment');
        }
        if (res.status === 204) return null;
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(res.status === 404 ? 404 : res.status === 403 ? 403 : 422, out.code || 'publish.git_refused', out.detail || out.title || `OpenVibe.Git answered ${res.status}`);
        return out;
    }
    const at = (repo) => `/api/v1/repos/${repoOk(repo).split('/').map(encodeURIComponent).join('/')}/space-publish`;

    async function repos(viewer) {
        const out = await call(viewer, 'GET', '/api/v1/repos?mine=1&sort=updated&limit=100');
        return (Array.isArray(out && out.repositories) ? out.repositories : []).map((r) => ({
            full_name: String(r.full_name || '').toLowerCase(), default_branch: r.default_branch || 'main', visibility: r.visibility || 'public',
        })).filter((r) => REPO_RE.test(r.full_name));
    }
    async function status(viewer, repo) { const out = await call(viewer, 'GET', at(repo)); return (out && out.publish) || null; }
    async function set(viewer, repo, { site_id, branch, folder = '' }) {
        const out = await call(viewer, 'PUT', at(repo), { site_id, branch, folder });
        return out && out.publish;
    }
    async function stop(viewer, repo) { await call(viewer, 'DELETE', at(repo)); }
    async function deployNow(viewer, repo) { const out = await call(viewer, 'POST', `${at(repo)}/deploy`, {}); return out && out.publish; }

    return { enabled, host, repos, status, set, stop, deployNow, repoUrl, repoOf, repoOk };
}

module.exports = { createGitPublish };
