# Cutover runbook: PR #43, billing readings outbox (`migrations/0006_billing_readings.sql`)

What changes in data: two new tables, `billing_readings` (outbox of `platform.usage-sample@1` readings, with a trigger that refuses editing a stored reading) and `billing_periods` (closed UTC days already aggregated), plus two indexes and one trigger function. Nothing existing is altered, dropped or copied. The migration is phase `expand` (additive only).

The new code is off by default: `SPACE_BILLING_INTERVAL_MS` is unset or `0`, so `billing.start()` starts no timer, aggregates nothing and posts nothing. The migration alone changes no behaviour.

## Order

1. **Backup** (before the deploy, on the production host, owner connection):
   `pg_dump --format=custom --file=ov_space-pre-0006-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_DIRECT_URL"`
   Keep the dump until step 5 has passed. A table-level dump is enough, because the migration only adds tables, but the full dump is cheap and also covers rollback of the code.
2. **Deploy** this PR's merged `main` through the normal pipeline (`ov deploy OpenVibe.Space "<why>"`). Space runs `migrations/0006_billing_readings.sql` through `openvibe-sdk/db` at boot; tables are never created by a request. The migration runs once; a second boot applies nothing.
3. **Verify the schema** (see Verification). Billing stays off at this point.
4. **Enable (separate, later step, not part of this cutover):** grant `svc:space` the `billing.usage.record` capability (audience `openvibe.billing`), then set `SPACE_BILLING_INTERVAL_MS` to a positive value and restart. Local store mode only; Media mode emits no readings.
5. **Close:** once step 3 is green, the dump from step 1 may be discarded after the owner's retention window.

## Verification

Run on production after step 2 (read-only `\d`/count queries):

- `SELECT to_regclass('billing_readings'), to_regclass('billing_periods');` returns both names, not NULL.
- `SELECT count(*) FROM billing_readings;` and `... FROM billing_periods;` return `0` while billing is off.
- `SELECT tgname FROM pg_trigger WHERE tgrelid = 'billing_readings'::regclass AND NOT tgisinternal;` lists `billing_readings_frozen`.
- The service answers its health check and `ov access run openvibe-ovh health` is green; the journal of the Space unit shows no migration error.
- When billing is later enabled (step 4): `SELECT count(*) FILTER (WHERE sent_at IS NULL AND rejected_at IS NULL) FROM billing_readings;` drains to 0 shortly after each daily run, and `billing_periods` gains one `gb-month` row per closed UTC day.

Rehearsal on a scratch PostgreSQL (run by the harness, `ov rehearse OpenVibe.Space 43`): main's migrations, the repository's fixtures, this PR's migrations, a second migration run that must apply nothing, then the commands below. They check that both tables and the trigger exist, that a repeated `event_id` inserts nothing, that delivery columns can move, that editing the reading is refused, and that its test row is removed afterwards.

```rehearse
# both tables and the trigger exist; a repeated key inserts nothing; delivery columns move; the reading cannot be edited
psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DO $do$ DECLARE n bigint; refused boolean := false; BEGIN IF to_regclass($b$billing_readings$b$) IS NULL OR to_regclass($b$billing_periods$b$) IS NULL THEN RAISE EXCEPTION $b$rehearsal: billing tables missing$b$; END IF; INSERT INTO billing_readings (event_id, envelope, created_at) VALUES ($b$rh-1$b$, $b${"a":1}$b$, 1); INSERT INTO billing_readings (event_id, envelope, created_at) VALUES ($b$rh-1$b$, $b${"a":1}$b$, 1) ON CONFLICT (event_id) DO NOTHING; GET DIAGNOSTICS n = ROW_COUNT; IF n <> 0 THEN RAISE EXCEPTION $b$rehearsal: a repeated idempotency key inserted a row$b$; END IF; UPDATE billing_readings SET attempts = 1, sent_at = 2, seq = 3 WHERE event_id = $b$rh-1$b$; BEGIN UPDATE billing_readings SET envelope = $b${"a":2}$b$ WHERE event_id = $b$rh-1$b$; EXCEPTION WHEN raise_exception THEN refused := true; END; IF NOT refused THEN RAISE EXCEPTION $b$rehearsal: editing a stored reading was allowed$b$; END IF; DELETE FROM billing_readings WHERE event_id = $b$rh-1$b$; END $do$;'
```

## Way back

The migration is additive and the code is off by default, so the way back is cheap and has no data loss for existing features:

1. **Code only (preferred):** if the new code misbehaves, set `SPACE_BILLING_INTERVAL_MS=0` (or remove it) and restart. The timer stops; the new tables stay, unused and empty or holding unsent readings. Or roll the release back with the pipeline's guarded rollback; the old code ignores the extra tables.
2. **Tables too (only if the owner wants them gone):** nothing else references them, so they drop cleanly. Run as the owner role:
   `DROP TABLE IF EXISTS billing_periods; DROP TABLE IF EXISTS billing_readings; DROP FUNCTION IF EXISTS billing_readings_frozen();`
   then delete the `0006_billing_readings.sql` row from the migrations bookkeeping table of `openvibe-sdk/db`, or the next boot of a build that still contains the file will recreate the tables. Unsent readings in `billing_readings` are lost with the table; readings already posted stay recorded at Billing, and the idempotency key makes a repost harmless.
3. **Full restore (not expected):** `pg_restore --clean --if-exists --dbname="$DATABASE_DIRECT_URL" ov_space-pre-0006-<stamp>.dump` from the step 1 backup. This rewinds any Space writes made since the backup, so use it only if the database itself is damaged.
