-- LLM article-linking proposal storage upgrade for issue #3103.
-- Existing articles, relationships and proposals are retained. Safe to re-run
-- on every deploy.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus CREATE, which would destroy stored review decisions, so the
-- DDL below is built inside strings the rewriter cannot match (same idiom as
-- tanah_article_covering_source_upgrade.sql). Never write the creation
-- keywords literally in this file, including in comments.
--
-- tanah_article_link_proposal stores draft linkings ONLY: rows are never read
-- by public consumers and never mutate the live relationship tables. A human
-- review in the admin approves or rejects each proposal. Approval applies the
-- reviewed patch through the typed relationship write path (#3102) inside one
-- transaction that also marks the row applied.
SET @linkProposalSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_article_link_proposal (
    id CHAR(36) NOT NULL,
    run_id CHAR(36) NOT NULL COMMENT ''generation run grouping'',
    article_id MEDIUMINT NOT NULL,
    relationship_key VARCHAR(40) NOT NULL COMMENT ''shared registry key (#3102)'',
    action VARCHAR(10) NOT NULL COMMENT ''add|remove|replace|clear'',
    target_json JSON NOT NULL COMMENT ''canonical normalized target payload'',
    target_label VARCHAR(500) NOT NULL,
    evidence_json JSON NULL COMMENT ''[{quote,spanStart,spanEnd}] in the plain-text view'',
    rationale TEXT NULL,
    confidence DECIMAL(4,3) NULL COMMENT ''advisory only — never auto-approves'',
    conflict VARCHAR(500) NULL COMMENT ''collision/ambiguity surfaced to the reviewer'',
    status VARCHAR(12) NOT NULL DEFAULT ''pending'' COMMENT ''pending|held|approved|rejected|applied|stale'',
    dedupe_key CHAR(64) NOT NULL COMMENT ''sha256 incl. generator+prompt_version+content_hash'',
    decision_key CHAR(64) NOT NULL COMMENT ''sha256 of article+relationship+action+canonical target'',
    generator VARCHAR(120) NOT NULL COMMENT ''openai:<model> | heuristic:<ver>'',
    model VARCHAR(120) NULL,
    prompt_version VARCHAR(40) NOT NULL,
    base_content_hash CHAR(32) NOT NULL DEFAULT '''' COMMENT ''freshness token; empty when undeployed'',
    base_snapshot_json JSON NULL,
    prompt_tokens INT NULL,
    completion_tokens INT NULL,
    review_patch_json JSON NULL COMMENT ''human-edited final patch, separate from model output'',
    review_notes VARCHAR(1000) NULL,
    reviewer VARCHAR(200) NULL COMMENT ''Cognito sub, or local in dev'',
    reviewed_at TIMESTAMP(6) NULL,
    applied_at TIMESTAMP(6) NULL,
    applied_snapshot_json JSON NULL COMMENT ''post-apply relationship state'',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_link_proposal_dedupe (dedupe_key),
    KEY idx_link_proposal_queue (status, article_id),
    KEY idx_link_proposal_run (run_id),
    KEY idx_link_proposal_decision (decision_key),
    CONSTRAINT fk_link_proposal_article FOREIGN KEY (article_id)
        REFERENCES tanah_article (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE linkProposalUpgrade FROM @linkProposalSql;
EXECUTE linkProposalUpgrade;
DEALLOCATE PREPARE linkProposalUpgrade;

-- Resumable-run checkpointing: one row per
-- (article, generator, prompt_version, content_hash) already processed, so an
-- unchanged article never costs a second model call on rerun.
SET @linkProposalSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_article_link_checkpoint (
    article_id MEDIUMINT NOT NULL,
    generator VARCHAR(120) NOT NULL,
    prompt_version VARCHAR(40) NOT NULL,
    content_hash CHAR(32) NOT NULL DEFAULT '''',
    run_id CHAR(36) NOT NULL,
    proposal_count INT NOT NULL DEFAULT 0,
    processed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (article_id, generator, prompt_version, content_hash),
    CONSTRAINT fk_link_checkpoint_article FOREIGN KEY (article_id)
        REFERENCES tanah_article (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE linkProposalUpgrade FROM @linkProposalSql;
EXECUTE linkProposalUpgrade;
DEALLOCATE PREPARE linkProposalUpgrade;
