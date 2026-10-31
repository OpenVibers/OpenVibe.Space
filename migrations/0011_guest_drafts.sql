-- phase: expand
-- Guest drafts (openvibe.website, plan 5.9: "making websites and code without needing OpenVibe logins"): a visitor
-- who is not signed in makes a draft on openvibe.space and edits it with a secret link; a signed-in person who
-- holds that link claims it later. The draft has no owner until it is claimed, so owner_subject becomes optional,
-- and the secret is kept only as a hash (as OpenVibe.Design keeps guest_hash for its guest designs).
--
-- Expand only: the columns are optional and the old code (which always writes an owner) keeps working. Nothing
-- here changes what an owned space does.
ALTER TABLE space_apps ALTER COLUMN owner_subject DROP NOT NULL;
ALTER TABLE space_apps ADD COLUMN guest_hash text COLLATE "C";
ALTER TABLE space_apps ADD COLUMN guest_ip text COLLATE "C";
ALTER TABLE space_apps ADD COLUMN guest_expires_at bigint;

-- The cleanup job reads the drafts whose time is up (seven days after the last edit).
CREATE INDEX space_apps_guest_expiry ON space_apps (guest_expires_at) WHERE guest_hash IS NOT NULL;
-- The abuse screen counts what one address made today.
CREATE INDEX space_apps_guest_ip ON space_apps (guest_ip, created_at DESC) WHERE guest_hash IS NOT NULL;
