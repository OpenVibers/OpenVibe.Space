-- phase: expand
-- Spaces (plan T20 step 2; owner 2026-10-08: "a system where people can make spaces that interact with your openvibe
-- account and the network and interconnected with sdk and such"): small web apps a person makes on openvibe.space and
-- publishes at <slug>.openvibe.website, where the space SDK gives them the visitor's sign-in, shared lists, private
-- storage and OpenVibe AI (server/spaces/). The forum's old `spaces` table (migration 0001) is unrelated and untouched;
-- these tables are space_app*. Times are epoch milliseconds like the hosting tables.

-- A space: its source lives in space_app_files; a published space is also a site (site_id) in its owner's Spaces
-- project, served by the hosting engine.
CREATE TABLE space_apps (
    id               text COLLATE "C" PRIMARY KEY,               -- spc_<ULID>
    slug             text COLLATE "C" NOT NULL,                  -- the site name it publishes under
    owner_subject    text COLLATE "C" NOT NULL,                  -- usr_…
    owner_username   text COLLATE "C" NOT NULL DEFAULT '',
    owner_name       text NOT NULL DEFAULT '',
    name             text NOT NULL,
    description      text NOT NULL DEFAULT '',
    instructions     text NOT NULL DEFAULT '',                   -- what the space's AI is told (OV.ai.ask)
    capabilities     text NOT NULL DEFAULT '[]',                 -- JSON: profile, data, kv, ai
    template         text COLLATE "C",
    forked_from      text COLLATE "C",
    visibility       text COLLATE "C" NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted')),
    status           text COLLATE "C" NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
    site_id          text COLLATE "C",                           -- set while published
    building_run_id  text COLLATE "C",                           -- an AI build or change in progress
    building_prompt  text,
    forks            integer NOT NULL DEFAULT 0,
    created_at       bigint NOT NULL,
    updated_at       bigint NOT NULL,
    published_at     bigint,
    deleted_at       bigint
);
CREATE UNIQUE INDEX space_apps_slug ON space_apps (slug) WHERE status = 'active';
CREATE INDEX space_apps_owner ON space_apps (owner_subject, status);
CREATE INDEX space_apps_gallery ON space_apps (published_at DESC) WHERE status = 'active' AND site_id IS NOT NULL;
CREATE UNIQUE INDEX space_apps_site ON space_apps (site_id) WHERE site_id IS NOT NULL;

CREATE TABLE space_app_files (
    space_id    text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    path        text COLLATE "C" NOT NULL,
    content     text NOT NULL,
    updated_at  bigint NOT NULL,
    PRIMARY KEY (space_id, path)
);

-- The Spaces project of each person who has published one (created on their first publish).
CREATE TABLE space_app_projects (
    owner_subject text COLLATE "C" PRIMARY KEY,
    project_id    text COLLATE "C" NOT NULL REFERENCES space_projects(id),
    created_at    bigint NOT NULL
);

-- OV.items: shared lists, readable by anyone who can open the space. `mine` marks the one item a person keeps with
-- OV.items.set (a vote, a best score).
CREATE TABLE space_app_items (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    space_id       text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    collection     text COLLATE "C" NOT NULL,
    author_subject text COLLATE "C" NOT NULL,
    author_username text COLLATE "C" NOT NULL DEFAULT '',
    author_name    text NOT NULL DEFAULT '',
    value          text NOT NULL,
    mine           boolean NOT NULL DEFAULT false,
    created_at     bigint NOT NULL,
    updated_at     bigint NOT NULL
);
CREATE INDEX space_app_items_list ON space_app_items (space_id, collection, id DESC);
CREATE UNIQUE INDEX space_app_items_mine ON space_app_items (space_id, collection, author_subject) WHERE mine;
CREATE INDEX space_app_items_author ON space_app_items (author_subject);

-- OV.kv: each signed-in person's private storage in a space.
CREATE TABLE space_app_kv (
    space_id    text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    subject     text COLLATE "C" NOT NULL,
    key         text COLLATE "C" NOT NULL,
    value       text NOT NULL,
    updated_at  bigint NOT NULL,
    PRIMARY KEY (space_id, subject, key)
);
CREATE INDEX space_app_kv_subject ON space_app_kv (subject);

-- What a person approved for a space (the connect page asks once per set of capabilities).
CREATE TABLE space_app_grants (
    space_id      text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    subject       text COLLATE "C" NOT NULL,
    capabilities  text NOT NULL,
    granted_at    bigint NOT NULL,
    PRIMARY KEY (space_id, subject)
);

-- The connect flow: a one-time code (PKCE, two minutes) and the token it becomes (a day). Only hashes are kept.
CREATE TABLE space_app_codes (
    code_hash     text COLLATE "C" PRIMARY KEY,
    space_id      text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    subject       text COLLATE "C" NOT NULL,
    username      text COLLATE "C" NOT NULL DEFAULT '',
    display_name  text NOT NULL DEFAULT '',
    capabilities  text NOT NULL,
    challenge     text COLLATE "C" NOT NULL,
    expires_at    bigint NOT NULL
);
CREATE TABLE space_app_tokens (
    token_hash    text COLLATE "C" PRIMARY KEY,
    space_id      text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    subject       text COLLATE "C" NOT NULL,
    username      text COLLATE "C" NOT NULL DEFAULT '',
    display_name  text NOT NULL DEFAULT '',
    capabilities  text NOT NULL,
    created_at    bigint NOT NULL,
    expires_at    bigint NOT NULL
);
CREATE INDEX space_app_tokens_expiry ON space_app_tokens (expires_at);
CREATE INDEX space_app_tokens_subject ON space_app_tokens (subject);

-- Daily counters: AI builds per person ('build:<usr_…>'), a space's AI answers ('ask:<spc_…>').
CREATE TABLE space_app_counters (
    scope   text COLLATE "C" NOT NULL,
    day     text COLLATE "C" NOT NULL,
    n       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, day)
);
