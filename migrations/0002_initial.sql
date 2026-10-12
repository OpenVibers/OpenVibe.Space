-- phase: expand
-- OpenVibe.Space on PostgreSQL (ADR-035, roadmap WS-X2): the tables as they were on SQLite (converted by openvibe-sdk
-- tools/asyncify/sqlite-schema-to-pg: text COLLATE "C" compares like SQLite, integers are bigint, identities keep their ids),
-- then the openvibe-publishing stores and the openvibe-sdk inbox and outbox. Generated once on 2026-09-28; never edited after it runs.

CREATE TABLE space_projects (
    id                  text COLLATE "C" PRIMARY KEY,                  -- prj_<ULID>
    seq               bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- insertion order (the SQLite rowid tiebreak)
    network_project_id  text COLLATE "C",                              -- OpenVibe.Network project id (ADR-014), when it exists
    owner_subject       text COLLATE "C" NOT NULL,                     -- usr_…
    name                text COLLATE "C" NOT NULL,
    environment         text COLLATE "C" NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox')),
    status              text COLLATE "C" NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
    created_at          bigint NOT NULL,
    updated_at          bigint NOT NULL,
    deleted_at          bigint
);
CREATE UNIQUE INDEX space_projects_network ON space_projects (network_project_id) WHERE network_project_id IS NOT NULL AND status = 'active';
CREATE INDEX space_projects_owner ON space_projects (owner_subject, status);

CREATE TABLE space_project_members (
    project_id  text COLLATE "C" NOT NULL REFERENCES space_projects(id),
    principal   text COLLATE "C" NOT NULL,                             -- usr_… | app:app_… | svc:<id>
    role        text COLLATE "C" NOT NULL CHECK (role IN ('owner','maintainer','deployer')),
    added_by    text COLLATE "C",
    created_at  bigint NOT NULL,
    PRIMARY KEY (project_id, principal)
);
CREATE INDEX space_project_members_principal ON space_project_members (principal);

CREATE TABLE space_quotas (
    project_id       text COLLATE "C" PRIMARY KEY REFERENCES space_projects(id),
    storage_bytes    bigint,
    deploys_per_day  bigint,
    max_files        bigint,
    max_file_bytes   bigint,
    sites            bigint,
    custom_domains   bigint,
    updated_by       text COLLATE "C",
    updated_at       bigint NOT NULL
);

CREATE TABLE space_sites (
    id                text COLLATE "C" PRIMARY KEY,                    -- site_<ULID>
    seq               bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- insertion order (the SQLite rowid tiebreak)
    project_id        text COLLATE "C" NOT NULL REFERENCES space_projects(id),
    name              text COLLATE "C" NOT NULL,                       -- the <name>.openvibe.space label
    active_deploy_id  text COLLATE "C",
    status            text COLLATE "C" NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
    created_by        text COLLATE "C" NOT NULL,
    created_at        bigint NOT NULL,
    updated_at        bigint NOT NULL,
    deleted_at        bigint
);
CREATE UNIQUE INDEX space_sites_name ON space_sites (name) WHERE status = 'active';
CREATE INDEX space_sites_project ON space_sites (project_id, status);

CREATE TABLE space_deploys (
    id               text COLLATE "C" PRIMARY KEY,                     -- dpl_<ULID>
    seq               bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- insertion order (the SQLite rowid tiebreak)
    project_id       text COLLATE "C" NOT NULL REFERENCES space_projects(id),
    site_id          text COLLATE "C" NOT NULL REFERENCES space_sites(id),
    state            text COLLATE "C" NOT NULL CHECK (state IN ('ready','failed','deleted')),
    source           text COLLATE "C" NOT NULL CHECK (source IN ('archive','files')),
    manifest         text COLLATE "C",                                 -- JSON space.deploy-manifest@1 (NULL when failed)
    manifest_sha256  text COLLATE "C",
    file_count       bigint NOT NULL DEFAULT 0,
    total_bytes      bigint NOT NULL DEFAULT 0,
    new_bytes        bigint NOT NULL DEFAULT 0,           -- bytes this deploy added to the project's storage
    failure_code     text COLLATE "C",
    created_by       text COLLATE "C" NOT NULL,
    created_at       bigint NOT NULL,
    deleted_at       bigint
);
CREATE INDEX space_deploys_site ON space_deploys (site_id, created_at);
CREATE INDEX space_deploys_project_day ON space_deploys (project_id, created_at);

CREATE TABLE space_deploy_files (
    deploy_id     text COLLATE "C" NOT NULL REFERENCES space_deploys(id),
    path          text COLLATE "C" NOT NULL,
    sha256        text COLLATE "C" NOT NULL,
    size          bigint NOT NULL,
    content_type  text COLLATE "C" NOT NULL,
    PRIMARY KEY (deploy_id, path)
);
CREATE INDEX space_deploy_files_sha ON space_deploy_files (sha256);

CREATE TABLE space_blobs (
    project_id  text COLLATE "C" NOT NULL,
    sha256      text COLLATE "C" NOT NULL,
    size        bigint NOT NULL,
    created_at  bigint NOT NULL,
    PRIMARY KEY (project_id, sha256)
);

CREATE TABLE space_activations (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id             text COLLATE "C" NOT NULL REFERENCES space_sites(id),
    deploy_id           text COLLATE "C" NOT NULL,
    previous_deploy_id  text COLLATE "C",
    kind                text COLLATE "C" NOT NULL CHECK (kind IN ('activate','rollback')),
    actor               text COLLATE "C" NOT NULL,
    created_at          bigint NOT NULL
);
CREATE INDEX space_activations_site ON space_activations (site_id, id);

CREATE TABLE space_deploy_logs (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    deploy_id   text COLLATE "C" NOT NULL,
    level       text COLLATE "C" NOT NULL CHECK (level IN ('info','warn','error')),
    message     text COLLATE "C" NOT NULL,
    created_at  bigint NOT NULL
);
CREATE INDEX space_deploy_logs_deploy ON space_deploy_logs (deploy_id, id);

CREATE TABLE space_domains (
    id                     text COLLATE "C" PRIMARY KEY,               -- dom_<ULID>
    seq               bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- insertion order (the SQLite rowid tiebreak)
    project_id             text COLLATE "C" NOT NULL REFERENCES space_projects(id),
    site_id                text COLLATE "C" NOT NULL REFERENCES space_sites(id),
    hostname               text COLLATE "C" NOT NULL,
    kind                   text COLLATE "C" NOT NULL CHECK (kind IN ('default','custom')),
    status                 text COLLATE "C" NOT NULL CHECK (status IN ('pending','verified','failed','lapsed')),
    token                  text COLLATE "C",                           -- the TXT verification value (custom only; public in DNS, not a secret)
    created_by             text COLLATE "C" NOT NULL,
    created_at             bigint NOT NULL,
    verified_at            bigint,
    last_checked_at        bigint,
    last_error             text COLLATE "C",
    check_count            bigint NOT NULL DEFAULT 0,
    record_missing_since   bigint                         -- verified domain whose TXT record disappeared
);
CREATE UNIQUE INDEX space_domains_verified ON space_domains (hostname) WHERE status = 'verified';
CREATE UNIQUE INDEX space_domains_site_host ON space_domains (site_id, hostname);
CREATE INDEX space_domains_status ON space_domains (kind, status, last_checked_at);

-- Abuse takedowns (staff only): a site, or every site of a project, stops being served (451) while
-- its deploys, files and objects are KEPT for review. Rows are never deleted: a lift is recorded.
CREATE TABLE space_takedowns (
    id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    target_kind  text COLLATE "C" NOT NULL CHECK (target_kind IN ('project','site')),
    target_id    text COLLATE "C" NOT NULL,                             -- prj_… or site_…
    reason       text COLLATE "C" NOT NULL,
    created_by   text COLLATE "C" NOT NULL,
    created_at   bigint NOT NULL,
    lifted_by    text COLLATE "C",
    lifted_at    bigint,
    lift_note    text COLLATE "C"
);
CREATE UNIQUE INDEX space_takedowns_active ON space_takedowns (target_kind, target_id) WHERE lifted_at IS NULL;

-- Deploy artifacts are immutable: only state / deleted_at may change, and never back from 'deleted'.
CREATE FUNCTION space_deploys_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TRUE THEN RAISE EXCEPTION 'space: deploy artifacts are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER space_deploys_immutable BEFORE UPDATE OF id, project_id, site_id, source, manifest, manifest_sha256, file_count, total_bytes, new_bytes, created_by, created_at ON space_deploys FOR EACH ROW EXECUTE FUNCTION space_deploys_immutable();
CREATE FUNCTION space_deploys_no_undelete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.state = 'deleted' OR (OLD.state = 'failed' AND NEW.state = 'ready') THEN RAISE EXCEPTION 'space: a deleted or failed deploy cannot become ready'; END IF; RETURN NEW; END $$;
CREATE TRIGGER space_deploys_no_undelete BEFORE UPDATE OF state ON space_deploys FOR EACH ROW EXECUTE FUNCTION space_deploys_no_undelete();
CREATE FUNCTION space_deploy_files_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TRUE THEN RAISE EXCEPTION 'space: deploy files are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER space_deploy_files_immutable BEFORE UPDATE ON space_deploy_files FOR EACH ROW EXECUTE FUNCTION space_deploy_files_immutable();
CREATE FUNCTION space_deploy_files_delete_only_deleted() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT state FROM space_deploys WHERE id = OLD.deploy_id) <> 'deleted' THEN RAISE EXCEPTION 'space: files of a live deploy cannot be removed'; END IF; RETURN OLD; END $$;
CREATE TRIGGER space_deploy_files_delete_only_deleted BEFORE DELETE ON space_deploy_files FOR EACH ROW EXECUTE FUNCTION space_deploy_files_delete_only_deleted();

-- openvibe-sdk/events inbox: one receipt per (consumer, event) handled
CREATE TABLE IF NOT EXISTS idempotency_receipts (
    consumer     text NOT NULL,
    event_id     text NOT NULL,
    processed_at bigint NOT NULL,
    PRIMARY KEY (consumer, event_id)
);

-- openvibe-sdk/events PostgreSQL outbox
