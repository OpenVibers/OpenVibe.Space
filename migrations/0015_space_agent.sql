-- phase: expand
-- Space's builder as a task of the person's one agent (plan 2026-10-22 section Z, stage Z1).
--
-- A space may carry the task of the person's agent that builds it: the task's id (Actor's tsk_…), what the task is
-- doing (running, done, failed), the step it shows in the Dock's one timeline, and the publish request waiting for
-- the person's answer. Times are epoch milliseconds like the other space tables.
ALTER TABLE space_apps ADD COLUMN IF NOT EXISTS agent_task_id   text COLLATE "C";
ALTER TABLE space_apps ADD COLUMN IF NOT EXISTS agent_task_state text COLLATE "C";
ALTER TABLE space_apps ADD COLUMN IF NOT EXISTS agent_step_id   text COLLATE "C";
ALTER TABLE space_apps ADD COLUMN IF NOT EXISTS agent_publish_id text COLLATE "C";
CREATE INDEX IF NOT EXISTS space_apps_agent_task ON space_apps (agent_task_id) WHERE agent_task_id IS NOT NULL;

-- A publish the agent asked for. The person answers it in the Dock ("Needs you") or on the space's page; nothing
-- goes live until they do. The row is kept after the answer, so the space's history says what was published and when.
CREATE TABLE IF NOT EXISTS space_publish_requests (
    id            text COLLATE "C" PRIMARY KEY,       -- apr_<ULID>
    space_id      text COLLATE "C" NOT NULL REFERENCES space_apps(id) ON DELETE CASCADE,
    owner_subject text COLLATE "C" NOT NULL,           -- usr_…
    state         text COLLATE "C" NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','declined','failed')),
    created_at    bigint NOT NULL,
    decided_at    bigint
);
CREATE INDEX IF NOT EXISTS space_publish_requests_pending ON space_publish_requests (owner_subject, state) WHERE state = 'pending';
