-- phase: expand
-- What started each run (server/spaces/schedules.js): 'every <seconds>' for schedules.json, 'on <event type>' for
-- events.json (plan §AD.15). Rows written before this column read as schedules.
ALTER TABLE space_schedule_runs ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT '';
