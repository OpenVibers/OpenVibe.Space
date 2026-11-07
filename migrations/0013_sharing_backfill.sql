-- phase: migrate
-- Every space that existed before sharing is registered once, so canView has a row for all of them.
--
--   published (site_id IS NOT NULL), visibility public   → public  (Everyone, in the gallery)
--   published, visibility unlisted                       → link
--   a draft (no site)                                    → private (Only me)
--
-- The owner is the space's owner_subject; a guest draft with no account yet gets Space itself,
-- which nobody can sign in as (its secret link is still how its maker edits it). Removed spaces are
-- not registered.
INSERT INTO shares (service, kind, resource_id, owner_subject, audience)
SELECT
    'space', 'space', a.id,
    CASE
        WHEN a.owner_subject LIKE 'usr\_%' THEN jsonb_build_object('type', 'user', 'id', a.owner_subject)
        WHEN a.owner_subject LIKE 'gst\_%' THEN jsonb_build_object('type', 'guest', 'id', a.owner_subject)
        ELSE jsonb_build_object('type', 'service', 'id', 'space')
    END,
    CASE
        WHEN a.site_id IS NULL THEN 'private'
        WHEN a.visibility = 'public' THEN 'public'
        ELSE 'link'
    END
FROM space_apps a
WHERE a.status = 'active'
ON CONFLICT (service, kind, resource_id) DO NOTHING;
