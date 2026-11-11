-- phase: expand
-- A person's preferred audience when a draft becomes a published space. Drafts remain Only me.
CREATE TABLE IF NOT EXISTS space_share_defaults (
    owner_subject text COLLATE "C" PRIMARY KEY,
    audience text NOT NULL CHECK (audience IN ('public', 'link')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
