-- phase: expand
-- Agent Streams S6: the throwaway scratch sites of a chat plays session (OpenVibe.Codes' shared sandbox desk
-- leaves one behind). A scratch site is a site like any other, with one difference: it is removed after
-- 24 hours unless the owner keeps it.
--
-- Expand only: the columns are optional and an older release ignores them. A site that is not a scratch
-- site has scratch = false and no expiry, and behaves exactly as before.

ALTER TABLE space_sites ADD COLUMN scratch boolean NOT NULL DEFAULT false;
ALTER TABLE space_sites ADD COLUMN scratch_expires_at bigint;
ALTER TABLE space_sites ADD COLUMN scratch_kept boolean NOT NULL DEFAULT false;

-- The cleanup job reads the scratch sites whose day is up (and that nobody kept).
CREATE INDEX space_sites_scratch_expiry ON space_sites (scratch_expires_at) WHERE scratch = true AND scratch_kept = false;
