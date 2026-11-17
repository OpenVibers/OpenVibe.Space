-- phase: expand
-- Spaces that keep working (plan §AD.15): a published space's schedules.json runs its functions on a clock
-- (server/spaces/schedules.js); the last run of each, per site, for the editor and for the next due time.
CREATE TABLE IF NOT EXISTS space_schedule_runs (
    site_id      text COLLATE "C" NOT NULL,
    fn           text COLLATE "C" NOT NULL,
    every_s      integer NOT NULL,
    last_run_at  timestamptz,
    last_status  text COLLATE "C" CHECK (last_status IN ('ok', 'error')),
    last_ms      integer,
    last_error   text,
    runs         integer NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, fn)
);
