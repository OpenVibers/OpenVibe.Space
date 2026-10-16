-- phase: expand
-- Account export and deletion (ADR-033) through openvibe-sdk/account-data (server/account-data.js): its idempotency
-- table. The forum-era table of the same name (0001: text columns, written by the forum's own consumer) is kept under
-- another name; nothing reads it since the forum moved to OpenVibe.Community.
ALTER TABLE IF EXISTS account_data_events RENAME TO account_data_events_forum;
ALTER INDEX IF EXISTS account_data_events_pkey RENAME TO account_data_events_forum_pkey;
CREATE TABLE IF NOT EXISTS account_data_events (
    id          text PRIMARY KEY,
    kind        text NOT NULL,
    subject     text NOT NULL,
    outcome     jsonb,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    sent_at     timestamptz
);
