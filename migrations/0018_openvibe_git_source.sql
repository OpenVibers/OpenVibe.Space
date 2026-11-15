-- phase: expand
-- A site's source may be on OpenVibe.Git (plan §AD.10 step 2, 2026-11-15): provider 'openvibe', a repository at
-- https://git.openvibe.codes/<owner>/<name>. Git sends the folder of each push itself (server/domain/git-publish.js);
-- Host still never fetches a repository. The check only widens: rows and code that know three providers are unchanged.
ALTER TABLE space_site_sources DROP CONSTRAINT IF EXISTS space_site_sources_provider_check;
ALTER TABLE space_site_sources ADD CONSTRAINT space_site_sources_provider_check
    CHECK (provider IN ('github', 'gitlab', 'codeberg', 'openvibe'));
