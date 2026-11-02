use async_graphql::SimpleObject;

use entities::{
    tanah_article_metric, tanah_article_metric_block, tanah_perek_metric, tanah_perek_pasuk_metric,
    tanahpedia::{entry_metric, entry_metric_block},
};

/// Shared persisted reading metrics for one content item (issue #2607):
/// the decoration every GUI consumes — website badges, the app's offline
/// packs, and JSON-LD all read this same contract.
#[derive(SimpleObject, Debug, Clone)]
pub struct ReadingMetric {
    /// Words counted over the complete content. `null` = unknown or not yet
    /// computed; `0` = verified empty body — never a fabricated estimate.
    pub word_count: Option<i32>,
    /// `ceil(word_count * 60 / words_per_minute)`; `null` when `word_count` is.
    /// A silent-reading baseline, not study or recitation time.
    pub estimated_seconds: Option<i32>,
    /// Baseline Hebrew silent-reading rate the estimate was computed with.
    pub words_per_minute: i32,
    /// Counting-policy version that produced the row. Consumers compare this
    /// (and `sourceHash`) to detect stale packaged/offline copies.
    pub calc_version: i32,
    /// sha256 hex of the normalized counted text — staleness detection for
    /// content edits, imports and restores.
    pub source_hash: String,
}

impl From<tanah_perek_metric::Model> for ReadingMetric {
    fn from(value: tanah_perek_metric::Model) -> Self {
        Self {
            word_count: value.word_count,
            estimated_seconds: value.estimated_seconds,
            words_per_minute: value.words_per_minute,
            calc_version: value.calc_version,
            source_hash: value.source_hash,
        }
    }
}

impl From<tanah_article_metric::Model> for ReadingMetric {
    fn from(value: tanah_article_metric::Model) -> Self {
        Self {
            word_count: value.word_count,
            estimated_seconds: value.estimated_seconds,
            words_per_minute: value.words_per_minute,
            calc_version: value.calc_version,
            source_hash: value.source_hash,
        }
    }
}

impl From<entry_metric::Model> for ReadingMetric {
    fn from(value: entry_metric::Model) -> Self {
        Self {
            word_count: value.word_count,
            estimated_seconds: value.estimated_seconds,
            words_per_minute: value.words_per_minute,
            calc_version: value.calc_version,
            source_hash: value.source_hash,
        }
    }
}

/// Ordered reading-position unit enabling word-weighted progress without
/// re-parsing rendered text: pasuk rows for a perek, readable-block rows for
/// articles and Tanahpedia entries.
#[derive(SimpleObject, Debug, Clone)]
pub struct ReadingProgressUnit {
    /// Pasuk number for a perek; 0-based block index for article/entry bodies.
    pub key: String,
    /// Words in this unit.
    pub word_count: i32,
    /// Words up to and including this unit, in canonical order.
    pub cumulative_words: i32,
}

impl From<tanah_perek_pasuk_metric::Model> for ReadingProgressUnit {
    fn from(value: tanah_perek_pasuk_metric::Model) -> Self {
        Self {
            key: value.pasuk.to_string(),
            word_count: value.word_count,
            cumulative_words: value.cumulative_words,
        }
    }
}

impl From<tanah_article_metric_block::Model> for ReadingProgressUnit {
    fn from(value: tanah_article_metric_block::Model) -> Self {
        Self {
            key: value.block_idx.to_string(),
            word_count: value.word_count,
            cumulative_words: value.cumulative_words,
        }
    }
}

impl From<entry_metric_block::Model> for ReadingProgressUnit {
    fn from(value: entry_metric_block::Model) -> Self {
        Self {
            key: value.block_idx.to_string(),
            word_count: value.word_count,
            cumulative_words: value.cumulative_words,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metric_model() -> tanah_article_metric::Model {
        tanah_article_metric::Model {
            article_id: 9,
            word_count: Some(1234),
            estimated_seconds: Some(337),
            words_per_minute: 220,
            calc_version: 1,
            source_hash: "a".repeat(64),
            computed_at: chrono::NaiveDate::from_ymd_opt(2026, 7, 19)
                .unwrap()
                .and_hms_opt(12, 0, 0)
                .unwrap(),
        }
    }

    #[test]
    fn reading_metric_maps_all_contract_fields() {
        let dto = ReadingMetric::from(metric_model());

        assert_eq!(dto.word_count, Some(1234));
        assert_eq!(dto.estimated_seconds, Some(337));
        assert_eq!(dto.words_per_minute, 220);
        assert_eq!(dto.calc_version, 1);
        assert_eq!(dto.source_hash.len(), 64);
    }

    #[test]
    fn reading_metric_preserves_unknown_and_verified_empty_counts() {
        let mut unknown = metric_model();
        unknown.word_count = None;
        unknown.estimated_seconds = None;
        let dto = ReadingMetric::from(unknown);
        assert_eq!(dto.word_count, None);
        assert_eq!(dto.estimated_seconds, None);

        let mut empty = metric_model();
        empty.word_count = Some(0);
        empty.estimated_seconds = Some(0);
        let dto = ReadingMetric::from(empty);
        assert_eq!(dto.word_count, Some(0));
        assert_eq!(dto.estimated_seconds, Some(0));
    }

    #[test]
    fn progress_unit_uses_pasuk_as_key_for_perek_units() {
        let dto = ReadingProgressUnit::from(tanah_perek_pasuk_metric::Model {
            perek_id: 42,
            pasuk: 7,
            word_count: 12,
            cumulative_words: 80,
            calc_version: 1,
        });

        assert_eq!(dto.key, "7");
        assert_eq!(dto.word_count, 12);
        assert_eq!(dto.cumulative_words, 80);
    }

    #[test]
    fn progress_unit_uses_block_index_as_key_for_body_units() {
        let dto = ReadingProgressUnit::from(entry_metric_block::Model {
            entry_id: "entry-1".to_string(),
            block_idx: 3,
            word_count: 40,
            cumulative_words: 400,
            calc_version: 1,
        });

        assert_eq!(dto.key, "3");
        assert_eq!(dto.word_count, 40);
        assert_eq!(dto.cumulative_words, 400);
    }
}
