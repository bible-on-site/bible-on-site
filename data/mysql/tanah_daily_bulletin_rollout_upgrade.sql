-- Safe bulletin rollout schema upgrade. Existing subscribers, consent records and delivery history are retained.
-- Build table DDL in separate fragments to avoid the deployment rewrite.
--
-- Original-cohort gradual admission (#3382):
--   tanah_daily_bulletin_email_rollout   - singleton rollout control row (state machine + revision)
--   tanah_daily_bulletin_email_cohort    - stable original-cohort membership, populated only by a reviewed private data operation
--   tanah_daily_bulletin_email_admission - one row per cohort/Jerusalem local date, the atomic daily reservation

SET @rolloutSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_email_rollout (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    cohort VARCHAR(40) NOT NULL DEFAULT ''original'',
    state ENUM(''disabled'', ''running'', ''paused'', ''completed'') NOT NULL DEFAULT ''disabled'',
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    last_error VARCHAR(255) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE rolloutUpgrade FROM @rolloutSql;
EXECUTE rolloutUpgrade;
DEALLOCATE PREPARE rolloutUpgrade;
INSERT IGNORE INTO tanah_daily_bulletin_email_rollout (id, cohort) VALUES (1, 'original');

-- Cohort membership carries the deterministic original signup/import order in
-- position. Rows are inserted by the reviewed cohort plan, never inferred from
-- pending subscriber state. status tracks each member through the ramp:
-- pending (awaiting admission), admitted (activated by the rollout or already
-- active when selected), excluded (consent revoked or never eligible).
SET @rolloutSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_email_cohort (
    cohort VARCHAR(40) NOT NULL,
    subscriber_id BIGINT UNSIGNED NOT NULL,
    position INT UNSIGNED NOT NULL,
    status ENUM(''pending'', ''admitted'', ''excluded'') NOT NULL DEFAULT ''pending'',
    admission_date DATE NULL,
    excluded_reason VARCHAR(60) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (cohort, subscriber_id),
    UNIQUE KEY uq_bulletin_cohort_order (cohort, position),
    CONSTRAINT fk_bulletin_cohort_subscriber FOREIGN KEY (subscriber_id)
        REFERENCES tanah_daily_bulletin_subscriber(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE rolloutUpgrade FROM @rolloutSql;
EXECUTE rolloutUpgrade;
DEALLOCATE PREPARE rolloutUpgrade;

-- The (cohort, local_date) primary key is the atomic daily reservation: any
-- worker, retry, deployment or operator re-run on the same Jerusalem date sees
-- the existing row and cannot activate a second subscriber. reserved means the
-- day is claimed and the recorded subscriber is being reconciled through the
-- durable DB/SES activation. admitted is terminal success, exhausted means no
-- eligible member remained on that date, and lapsed records a past reservation
-- whose recorded subscriber became ineligible before completion.
SET @rolloutSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_email_admission (
    cohort VARCHAR(40) NOT NULL,
    local_date DATE NOT NULL,
    subscriber_id BIGINT UNSIGNED NULL,
    status ENUM(''reserved'', ''admitted'', ''exhausted'', ''lapsed'') NOT NULL DEFAULT ''reserved'',
    last_error VARCHAR(255) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (cohort, local_date),
    KEY ix_bulletin_admission_open (status, local_date),
    CONSTRAINT fk_bulletin_admission_subscriber FOREIGN KEY (subscriber_id)
        REFERENCES tanah_daily_bulletin_subscriber(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE rolloutUpgrade FROM @rolloutSql;
EXECUTE rolloutUpgrade;
DEALLOCATE PREPARE rolloutUpgrade;
