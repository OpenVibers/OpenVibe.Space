-- phase: expand
-- Every change to a space's files is a version (plan §AD.15: "every change, an agent's or a person's, is a version you
-- can see, compare and undo"): the files after the change, who or what made it (the editor, the AI, the person's agent,
-- a restore), and when. server/spaces/spaces.js keeps the last 20 of each space and skips a save that changed nothing.
CREATE TABLE IF NOT EXISTS space_app_versions (
    space_id    text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    n           integer NOT NULL,
    files       text NOT NULL,
    by_subject  text COLLATE "C",
    by_name     text,
    source      text COLLATE "C" NOT NULL DEFAULT 'editor',
    note        text,
    bytes       integer NOT NULL DEFAULT 0,
    created_at  bigint NOT NULL,
    PRIMARY KEY (space_id, n)
);
