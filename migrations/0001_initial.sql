-- phase: expand
-- OpenVibe.Space on PostgreSQL (ADR-035): the forum engine moved off OpenVibe.Community (plan T10 step 3), its
-- tables as Community's migrations/0001_initial.sql + 0005_space_moderators.sql defined them — text COLLATE "C"
-- compares like SQLite, integers are bigint, identities keep their ids. Never edited after it runs.
--
-- Space owns what a forum owns: space groups, spaces, categories, threads, their posts and versions, thread
-- votes, attachments (Media objects), post reactions, a space's chat room, per-space moderators, the Discord
-- relay's mappings/deliveries/message map/cursors/failures, the block projection and the account-data
-- bookkeeping, plus the openvibe-sdk inbox and outbox.
--
-- Not here, because Space is not their authority: pastes (Community), typed comment threads (Community),
-- Pulse (Community), submissions (Community), search documents (OpenVibe.Search) and game progress (Games).
-- SQLite's text timestamps and date functions (openvibe-sdk tools/asyncify SQLITE_DATE_FUNCTIONS).
CREATE FUNCTION ov_ts(t text) RETURNS timestamp LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF t IS NULL THEN RETURN NULL; END IF;
    IF t = 'now' THEN RETURN statement_timestamp() AT TIME ZONE 'UTC'; END IF;
    IF t ~ '\d\d:\d\d(:\d\d(\.\d+)?)?\s*(Z|[+-]\d\d(:?\d\d)?)$' THEN RETURN t::timestamptz AT TIME ZONE 'UTC'; END IF;
    RETURN t::timestamp;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
CREATE FUNCTION ov_now() RETURNS text LANGUAGE sql STABLE AS $$ SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$;
CREATE FUNCTION ov_now_iso() RETURNS text LANGUAGE sql STABLE AS $$ SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
CREATE FUNCTION datetime(t text, modifier text DEFAULT NULL) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE ts timestamp := ov_ts(t);
BEGIN
    IF ts IS NULL THEN RETURN NULL; END IF;
    IF modifier IS NOT NULL THEN ts := ts + modifier::interval; END IF;
    RETURN to_char(ts, 'YYYY-MM-DD HH24:MI:SS');
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
CREATE FUNCTION julianday(t text) RETURNS double precision LANGUAGE sql STABLE AS $$ SELECT extract(epoch FROM ov_ts(t))::double precision / 86400.0 + 2440587.5 $$;
-- The forum's hot rank (server/forum/store.js): (score + 1) / (age in hours + 2)^1.5, the Hacker News gravity.
CREATE FUNCTION ov_hot(score double precision, age_hours double precision) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT (COALESCE(score, 0) + 1) / power(GREATEST(COALESCE(age_hours, 0), 0) + 2, 1.5) $$;

-- Display cache of what OpenVibe.Network says about a subject (server/identity/network.js). Never authority.
CREATE TABLE subject_projection (
    subject_id text COLLATE "C" PRIMARY KEY,
    username text COLLATE "C",
    display_name text COLLATE "C",
    avatar_url text COLLATE "C",
    profile_color text COLLATE "C",
    refreshed_at text COLLATE "C" NOT NULL DEFAULT ov_now()
);

-- A pre-subject Network numeric id → the subject it became (forums imported from Community, once the data
-- cutover runs): server/identity/network.js resolves through it.
CREATE TABLE legacy_id_map (
    source_system text COLLATE "C" NOT NULL,
    source_type text COLLATE "C" NOT NULL,
    source_id text COLLATE "C" NOT NULL,
    target_type text COLLATE "C" NOT NULL,
    target_id text COLLATE "C" NOT NULL,
    PRIMARY KEY (source_system, source_type, source_id)
);

CREATE TABLE space_groups (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug text COLLATE "C" UNIQUE NOT NULL,
    name text COLLATE "C" NOT NULL,
    description text COLLATE "C",
    position bigint NOT NULL DEFAULT 0
);

CREATE TABLE spaces (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug text COLLATE "C" UNIQUE NOT NULL,
    name text COLLATE "C" NOT NULL,
    description text COLLATE "C",
    visibility text COLLATE "C" NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'members', 'staff')),
    created_by text COLLATE "C",
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    members_only_owner text COLLATE "C",
    thread_kind text COLLATE "C" NOT NULL DEFAULT 'discussion',
    style text COLLATE "C" NOT NULL DEFAULT 'feed',
    votes bigint NOT NULL DEFAULT 1,
    reactions bigint NOT NULL DEFAULT 1,
    group_id bigint REFERENCES space_groups(id) ON DELETE SET NULL,
    parent_id bigint REFERENCES spaces(id) ON DELETE SET NULL,
    position bigint NOT NULL DEFAULT 0
);

CREATE TABLE categories (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    space_id bigint NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    slug text COLLATE "C" NOT NULL,
    name text COLLATE "C" NOT NULL,
    description text COLLATE "C",
    position bigint NOT NULL DEFAULT 0,
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    UNIQUE (space_id, slug)
);

CREATE TABLE threads (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    space_id bigint NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    slug text COLLATE "C" NOT NULL,
    title text COLLATE "C" NOT NULL,
    author_subject text COLLATE "C",
    origin text COLLATE "C" NOT NULL DEFAULT 'user' CHECK(origin IN ('user', 'ai', 'discord', 'system')),
    pinned bigint NOT NULL DEFAULT 0,
    locked bigint NOT NULL DEFAULT 0,
    score bigint NOT NULL DEFAULT 0,
    reply_count bigint NOT NULL DEFAULT 0,
    last_activity_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    deleted_at text COLLATE "C",
    members_only_owner text COLLATE "C",
    kind text COLLATE "C" NOT NULL DEFAULT 'discussion',
    status text COLLATE "C",
    category_id bigint REFERENCES categories(id) ON DELETE SET NULL,
    external_key text COLLATE "C",
    views bigint NOT NULL DEFAULT 0,
    crosspost_of bigint REFERENCES threads(id) ON DELETE SET NULL,
    UNIQUE (space_id, slug)
);

CREATE TABLE posts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    author_subject text COLLATE "C",
    origin text COLLATE "C" NOT NULL DEFAULT 'user' CHECK(origin IN ('user', 'ai', 'discord', 'system')),
    is_opening bigint NOT NULL DEFAULT 0,
    body_markdown text COLLATE "C" NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    updated_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    deleted_at text COLLATE "C",
    relay_author text COLLATE "C"
);

CREATE TABLE post_versions (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    revision bigint NOT NULL,
    body_markdown text COLLATE "C" NOT NULL,
    edited_by text COLLATE "C",
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    PRIMARY KEY (post_id, revision)
);

CREATE TABLE thread_votes (
    thread_id bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    subject_id text COLLATE "C" NOT NULL,
    value bigint NOT NULL CHECK(value IN (-1, 1)),
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    updated_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    PRIMARY KEY (thread_id, subject_id)
);

-- Images on posts: OpenVibe.Media objects (med_ ids), claimed by the post that names them.
CREATE TABLE attachments (
    media_id text COLLATE "C" PRIMARY KEY,
    owner_subject text COLLATE "C" NOT NULL,
    post_id bigint REFERENCES posts(id) ON DELETE CASCADE,
    position bigint NOT NULL DEFAULT 0,
    filename text COLLATE "C",
    mime text COLLATE "C" NOT NULL,
    size_bytes bigint NOT NULL,
    url text COLLATE "C" NOT NULL,
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now()
);

CREATE TABLE post_reactions (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    subject_id text COLLATE "C" NOT NULL,
    reaction text COLLATE "C" NOT NULL,
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    PRIMARY KEY (post_id, subject_id)
);

-- A space's chat room on OpenVibe.Chat (server/chat-rooms.js); Chat owns the room itself.
CREATE TABLE space_chat_rooms (
    space_id bigint PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
    room_id text COLLATE "C",
    room_slug text COLLATE "C" NOT NULL,
    room_name text COLLATE "C" NOT NULL,
    room_kind text COLLATE "C" NOT NULL DEFAULT 'community',
    room_visibility text COLLATE "C" NOT NULL DEFAULT 'public',
    attached_by text COLLATE "C",
    attached_at text COLLATE "C" NOT NULL DEFAULT ov_now()
);

-- Per-space moderators (moved from Community's migrations/0005_space_moderators.sql): a person listed here
-- moderates that space (thread state and status, deletes, settings, categories, members-only, its chat room)
-- as discussion staff do everywhere; the board index and creating spaces stay with staff. People are Network
-- subjects (usr_…), never a local integer; account deletion erases a row and a subject merge moves it
-- (server/identity/account-data.js, subject-merge.js).
CREATE TABLE space_moderators (
    space_id bigint NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    subject_id text COLLATE "C" NOT NULL,
    added_by text COLLATE "C",
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    PRIMARY KEY (space_id, subject_id)
);

CREATE TABLE relay_mappings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    space_id bigint NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    direction text COLLATE "C" NOT NULL DEFAULT 'out' CHECK(direction IN ('out')),
    webhook_url_ref text COLLATE "C" NOT NULL,
    enabled bigint NOT NULL DEFAULT 1,
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    discord_channel_id text COLLATE "C",
    discord_thread_id text COLLATE "C",
    inbound bigint NOT NULL DEFAULT 0,
    UNIQUE (space_id, direction, webhook_url_ref)
);

CREATE TABLE relay_deliveries (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    post_id bigint REFERENCES posts(id) ON DELETE CASCADE,
    mapping_id bigint NOT NULL REFERENCES relay_mappings(id) ON DELETE CASCADE,
    action text COLLATE "C" NOT NULL DEFAULT 'create' CHECK(action IN ('create', 'edit', 'delete')),
    dedupe_key text COLLATE "C" UNIQUE NOT NULL,
    source text COLLATE "C" NOT NULL DEFAULT 'direct' CHECK(source IN ('direct', 'events')),
    event_id text COLLATE "C",
    status text COLLATE "C" NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'failed', 'dropped', 'skipped')),
    attempts bigint NOT NULL DEFAULT 0,
    next_attempt_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    last_status bigint,
    last_error text COLLATE "C",
    delivered_at text COLLATE "C",
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    updated_at text COLLATE "C" NOT NULL DEFAULT ov_now()
);

CREATE TABLE relay_message_map (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform text COLLATE "C" NOT NULL DEFAULT 'discord' CHECK(platform IN ('discord')),
    mapping_id bigint NOT NULL REFERENCES relay_mappings(id) ON DELETE CASCADE,
    direction text COLLATE "C" NOT NULL CHECK(direction IN ('out', 'in')),
    local_type text COLLATE "C" NOT NULL CHECK(local_type IN ('thread', 'post')),
    local_id bigint NOT NULL,
    thread_id bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    external_channel_id text COLLATE "C" NOT NULL,
    external_thread_id text COLLATE "C",
    external_message_id text COLLATE "C" NOT NULL,
    external_webhook_id text COLLATE "C",
    external_deleted_at text COLLATE "C",
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    updated_at text COLLATE "C" NOT NULL DEFAULT ov_now(),
    UNIQUE (platform, external_message_id),
    UNIQUE (platform, mapping_id, local_type, local_id)
);

CREATE TABLE relay_cursors (
    name text COLLATE "C" PRIMARY KEY,
    cursor bigint NOT NULL,
    latest_seq bigint,
    updated_at text COLLATE "C" NOT NULL DEFAULT ov_now()
);

CREATE TABLE relay_inbound_failures (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mapping_id bigint REFERENCES relay_mappings(id) ON DELETE SET NULL,
    event text COLLATE "C" NOT NULL,
    external_channel_id text COLLATE "C",
    external_message_id text COLLATE "C",
    external_author_id text COLLATE "C",
    error text COLLATE "C" NOT NULL,
    dismissed_at text COLLATE "C",
    created_at text COLLATE "C" NOT NULL DEFAULT ov_now()
);

-- platform blocks (WS-E task 5) projected from network.block.changed; the newest revision per pair wins.
CREATE TABLE network_blocks (
    blocker_subject text COLLATE "C" NOT NULL,
    blocked_subject text COLLATE "C" NOT NULL,
    active bigint NOT NULL,
    revision bigint NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (blocker_subject, blocked_subject)
);

-- account export/deletion bookkeeping (server/identity/account-data.js): one row per export or deletion,
-- applied once, answered after Network took the part or the confirmation.
CREATE TABLE account_data_events (
    id text COLLATE "C" PRIMARY KEY,
    kind text COLLATE "C" NOT NULL,
    subject text COLLATE "C" NOT NULL,
    outcome text COLLATE "C",
    sent_at text COLLATE "C",
    applied_at text COLLATE "C" NOT NULL DEFAULT ov_now_iso()
);

CREATE INDEX idx_subject_projection_username ON subject_projection(lower(username));
CREATE INDEX idx_threads_space_new ON threads(space_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_threads_author ON threads(author_subject, created_at DESC);
CREATE INDEX idx_posts_thread ON posts(thread_id, id);
CREATE INDEX idx_posts_author ON posts(author_subject, created_at DESC);
CREATE INDEX idx_attachments_post ON attachments(post_id, position) WHERE post_id IS NOT NULL;
CREATE INDEX idx_post_reactions_post ON post_reactions(post_id, reaction);
CREATE INDEX idx_space_moderators_subject ON space_moderators (subject_id);
CREATE INDEX idx_relay_deliveries_due ON relay_deliveries(status, next_attempt_at);
CREATE INDEX idx_relay_message_map_thread ON relay_message_map(thread_id);
CREATE UNIQUE INDEX idx_threads_external_key ON threads(space_id, external_key) WHERE external_key IS NOT NULL;
CREATE INDEX idx_threads_category ON threads(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_relay_deliveries_thread ON relay_deliveries(thread_id, post_id);
CREATE INDEX idx_relay_mappings_channel ON relay_mappings(discord_channel_id) WHERE discord_channel_id IS NOT NULL;
CREATE INDEX idx_network_blocks_blocked ON network_blocks(blocked_subject, active);

-- The board the forum opens with: the same groups, spaces and categories Community seeded (the Roadmap
-- space follows docs/roadmap/public.json — server/forum/roadmap.js).
INSERT INTO space_groups (id, slug, name, description, position) OVERRIDING SYSTEM VALUE VALUES
    (1, 'openvibe', 'OpenVibe', 'The network itself: talk, help, requests and what is coming next.', 1),
    (2, 'community', 'Community', 'What the people of OpenVibe make, and everything else.', 2);
SELECT setval(pg_get_serial_sequence('space_groups', 'id'), (SELECT MAX(id) FROM space_groups));
INSERT INTO spaces (id, slug, name, description, visibility, created_by, members_only_owner, thread_kind, style, votes, reactions, group_id, parent_id, position) OVERRIDING SYSTEM VALUE VALUES
    (1, 'general', 'General', 'Anything about OpenVibe and the people on it.', 'public', 'system', NULL, 'discussion', 'forum', 0, 1, 1, NULL, 1),
    (2, 'feedback', 'Feedback', 'Feature requests, bugs and ideas for every OpenVibe site. Vote for what matters to you; staff mark what is planned and done.', 'public', 'system', NULL, 'request', 'feed', 1, 1, 1, NULL, 3),
    (3, 'showcase', 'Showcase', 'Show what you made: streams, clips, art, code, tools.', 'public', 'system', NULL, 'discussion', 'feed', 1, 1, 2, NULL, 1),
    (4, 'roadmap', 'Roadmap', 'What OpenVibe is building next and where each piece stands. Every item has its own thread: ask about it or argue for it there.', 'public', 'system', NULL, 'roadmap', 'feed', 1, 1, 1, NULL, 4),
    (5, 'help', 'Help', 'Stuck on something? Ask here: streaming, tools, your account, anything on OpenVibe.', 'public', 'system', NULL, 'discussion', 'forum', 0, 1, 1, NULL, 2),
    (6, 'off-topic', 'Off-topic', 'Anything that is not about OpenVibe.', 'public', 'system', NULL, 'discussion', 'forum', 0, 1, 2, NULL, 2);
SELECT setval(pg_get_serial_sequence('spaces', 'id'), (SELECT MAX(id) FROM spaces));
INSERT INTO categories (id, space_id, slug, name, description, position) OVERRIDING SYSTEM VALUE VALUES
    (1, 2, 'ideas', 'Ideas', 'Something new, or something better.', 1),
    (2, 2, 'bugs', 'Bugs', 'Something is broken or wrong.', 2),
    (3, 2, 'questions', 'Questions', 'How do I…? Why does…?', 3),
    (4, 4, 'launches', 'New sites', 'Sites that open next.', 1),
    (5, 4, 'features', 'Features', 'New things on sites that are already open.', 2),
    (6, 4, 'platform', 'Under the hood', 'Accounts, safety, reliability and the shared systems every site uses.', 3);
SELECT setval(pg_get_serial_sequence('categories', 'id'), (SELECT MAX(id) FROM categories));

-- openvibe-sdk/events inbox: one receipt per (consumer, event) handled (server/events-consumer.js)
CREATE TABLE IF NOT EXISTS space_event_inbox (
    consumer     text NOT NULL,
    event_id     text NOT NULL,
    processed_at bigint NOT NULL,
    PRIMARY KEY (consumer, event_id)
);

-- openvibe-sdk/auth createPgRevocationStore: Network's per-person token cutoffs (revocationSchema('token_revocations'))
CREATE TABLE IF NOT EXISTS token_revocations (
    subject_id     text COLLATE "C" PRIMARY KEY,
    valid_after_ms bigint NOT NULL,
    reason         text,
    updated_at     bigint NOT NULL
);

-- openvibe-sdk/events PostgreSQL outbox (server/events.js): Space → OpenVibe.Events
CREATE TABLE IF NOT EXISTS event_outbox (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id        text NOT NULL UNIQUE,
    envelope        jsonb NOT NULL,
    traceparent     text,
    created_at      bigint NOT NULL,
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at bigint NOT NULL DEFAULT 0,
    sent_at         bigint,
    seq             bigint,
    rejected_at     bigint,
    last_error      text
);
CREATE INDEX IF NOT EXISTS event_outbox_due ON event_outbox (next_attempt_at, id) WHERE sent_at IS NULL AND rejected_at IS NULL;
CREATE INDEX IF NOT EXISTS event_outbox_sent ON event_outbox (sent_at) WHERE sent_at IS NOT NULL;
