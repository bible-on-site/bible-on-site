//! Lexical search over published Tanahpedia entries — the API counterpart of
//! the website's `searchTanahpediaEntries` provider
//! (`web/bible-on-site/src/lib/search/db-content.ts`), so the native app and
//! the site share one matching/relevance contract.
//!
//! Every `tanahpedia_entry` row is public (proposals stay in
//! `tanahpedia_entry_revision` until applied), so the whole table is in scope.
//! Candidates are gated by the website's chunk-union `REGEXP_LIKE` shape —
//! the only pattern proven safe at any row size — then normalized and scored
//! in Rust with a port of `score.ts` (itself a port of the app's
//! `Helpers/SearchText.cs`). The website additionally runs a word-anchored
//! rank estimate before its row cap because the perushim corpus can admit
//! tens of thousands of gated rows; the published entry corpus stays far under
//! `CANDIDATE_LIMIT`, so scoring every candidate yields identical results and
//! never sheds a real hit.

use std::collections::HashMap;

use sea_orm::{DatabaseBackend, FromQueryResult, Statement};

use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::tanahpedia_entries::TanahpediaSearchHit,
    providers::Database,
    services::article_search::text,
    services::articles_service::{MAX_SEARCH_PHRASE_CHARS, SEARCH_MAX_LIMIT},
    services::tanahpedia_entries_service,
};

/// Rows pulled from MySQL before scoring. Bounded so a query for a very common
/// term cannot transfer the whole table — same cap the website applies to its
/// candidate pool.
const CANDIDATE_LIMIT: u64 = 1000;

/// Default hit count when the caller passes no `limit`.
const SEARCH_DEFAULT_LIMIT: i32 = 10;

/// Query sanity bounds — the same guards the app's `SearchIndexService`
/// applies (`terms.Length is 0 or > 16 || term.Length > 64`).
const MAX_TERMS: usize = 16;
const MAX_TERM_CHARS: usize = 64;

/// Excerpt length budget in characters — the same budget article search uses.
const EXCERPT_CHARS: usize = 220;

/// Bound a single statement's wall-clock time so a rare-term full scan cannot
/// stall the request path — the website's `QUERY_TIME_BUDGET_MS`.
const QUERY_TIME_BUDGET_MS: u32 = 12000;

/// Raw-storage characters the normalization pipeline erases without leaving a
/// word boundary: combining marks (niqqud/taamim), quote-like characters
/// (geresh, gershayim, typographic quotes), HTML tags and entities. Same
/// fragment as the website's `IGNORABLE_RUN`.
const IGNORABLE_RUN: &str = r#"(?:\p{M}|["'׳״‘’“”]|<[^>]+>|&[a-zA-Z#0-9]+;)"#;

/// A fragment's letters in order, allowing ignorable runs between them — the
/// shape every candidate alternand is built from.
fn letters_regexp(fragment: &str) -> String {
    fragment
        .chars()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(&format!("{IGNORABLE_RUN}*"))
}

/// Split a normalized term into `maxEdits(term) + 1` contiguous chunks as
/// equal in length as possible. Each edit corrupts at most one chunk, so every
/// word within the scorer's bounded edit distance keeps one chunk intact — the
/// pigeonhole filter making the gate a superset of the fuzzy-eligible rows.
fn term_chunks(term: &str) -> Vec<String> {
    let count = text::max_edits(term) + 1;
    let chars: Vec<char> = term.chars().collect();
    let base = chars.len() / count;
    let mut chunks = Vec::with_capacity(count);
    let mut offset = 0;
    for i in 0..count {
        let width = base + usize::from(i < chars.len() % count);
        chunks.push(chars[offset..offset + width].iter().collect());
        offset += width;
    }
    chunks
}

/// The candidate-selection pattern WHERE applies per field per term: the OR
/// of the term's chunks as bare ordered-letters patterns, anchor-free — the
/// cheapest `REGEXP_LIKE` shape and a true superset of every row the scorer
/// can rate.
fn term_gate_regexp(term: &str) -> String {
    let chunks: Vec<String> = term_chunks(term)
        .iter()
        .map(|chunk| letters_regexp(chunk))
        .collect();
    if chunks.len() == 1 {
        chunks.into_iter().next().unwrap_or_default()
    } else {
        format!("(?:{})", chunks.join("|"))
    }
}

/// Search-text normalization for scoring and tokenizing — `normalize_strict`
/// keeps the app's `SearchText` semantics (no final-letter folding), which is
/// what the website's `normalizeSearchText`/`searchScore` use.
fn search_tokens(phrase: &str) -> Vec<String> {
    let normalized = text::normalize_strict(phrase);
    if normalized.is_empty() {
        return Vec::new();
    }
    normalized.split(' ').map(str::to_string).collect()
}

/// Score a single normalized word against a single normalized term — the
/// `tokenScore` tiers: exact 90, prefix 80, bounded-edit-distance 60.
fn token_score(word: &str, term: &str) -> i32 {
    if word == term {
        return 90;
    }
    if word.starts_with(term) {
        return 80;
    }
    let edits = text::max_edits(term);
    if edits > 0 && text::distance(word, term, edits) <= edits {
        60
    } else {
        0
    }
}

/// Port of the website's `searchScore` (and the app's `SearchText.Score`):
/// whole-text equality 110, whole-word phrase containment 100, otherwise every
/// query term must match some word — the group's score is the minimum term
/// score so all terms must match.
fn search_score(text_value: &str, query: &str) -> i32 {
    score_normalized(&text::normalize_strict(text_value), query)
}

fn score_normalized(normalized: &str, query: &str) -> i32 {
    let phrase = text::normalize_strict(query);
    if phrase.is_empty() {
        return 0;
    }
    if normalized == phrase {
        return 110;
    }
    if format!(" {normalized} ").contains(&format!(" {phrase} ")) {
        return 100;
    }
    let words: Vec<&str> = normalized
        .split(' ')
        .filter(|word| !word.is_empty())
        .collect();
    let scores: Vec<i32> = phrase
        .split(' ')
        .filter(|term| !term.is_empty())
        .map(|term| {
            words
                .iter()
                .map(|word| token_score(word, term))
                .max()
                .unwrap_or(0)
        })
        .collect();
    if !scores.is_empty() && scores.iter().all(|score| *score > 0) {
        scores.iter().min().copied().unwrap_or(0)
    } else {
        0
    }
}

#[derive(FromQueryResult)]
struct SearchCandidateRow {
    id: String,
    unique_name: String,
    title: String,
    content: Option<String>,
}

#[derive(FromQueryResult)]
struct AliasRow {
    entry_id: String,
    name: String,
}

/// Candidate fragment matching an entry reachable through a synonym name —
/// directly (`syn.entry_id`) or as a disambiguation target (`dis.entry_id`),
/// mirroring the `/pedia/[slug]` resolution rules so an ambiguous name
/// surfaces every target entry instead of silently picking one. Binds the
/// term's chunk-union gate to `syn.name`.
const SYNONYM_MATCH: &str = "EXISTS (
        SELECT 1
          FROM tanahpedia_entry_synonym syn
          LEFT JOIN tanahpedia_entry_synonym_disambiguation dis
            ON dis.synonym_id = syn.id
         WHERE (syn.entry_id = e.id OR dis.entry_id = e.id)
           AND REGEXP_LIKE(syn.name, ?, 'i'))";

/// The entity predicate a single taxonomy category key contributes to a
/// scoped search — evaluated against `en`, the linked `tanahpedia_entity`
/// row inside `CATEGORY_SCOPE`. Person roles and animal classifications are
/// sub-filters of their parent entity type, not entity types of their own,
/// exactly like the listing resolver (`get_entities_with_entries`).
fn category_key_predicate(key: &str) -> (String, Vec<sea_orm::Value>) {
    if tanahpedia_entries_service::PERSON_ROLE_CATEGORIES.contains(&key) {
        let role_table = if key == "PROPHET" {
            "tanahpedia_person_role_prophet"
        } else {
            debug_assert_eq!(key, "KING", "role keys are validated by the caller");
            "tanahpedia_person_role_king"
        };
        (
            format!(
                "EXISTS (SELECT 1 FROM tanahpedia_person tp \
                 JOIN {role_table} r ON r.person_id = tp.id \
                 WHERE tp.entity_id = en.id)"
            ),
            Vec::new(),
        )
    } else if tanahpedia_entries_service::is_animal_kind_category(key)
        || tanahpedia_entries_service::is_animal_purity_category(key)
    {
        let (table, column) = if tanahpedia_entries_service::is_animal_kind_category(key) {
            ("tanahpedia_animal_kind", "kind")
        } else {
            ("tanahpedia_animal_purity", "purity")
        };
        (
            format!(
                "EXISTS (SELECT 1 FROM tanahpedia_animal ta \
                 JOIN {table} ac ON ac.animal_id = ta.id \
                 WHERE ta.entity_id = en.id AND ac.{column} = ?)"
            ),
            vec![key.into()],
        )
    } else {
        ("en.entity_type = ?".to_string(), vec![key.into()])
    }
}

/// Category-scope predicate appended to the candidate WHERE when
/// `categories` is non-empty: an entry qualifies when at least one of its
/// linked entities matches any selected category (a union — overlapping
/// selections never duplicate a hit because the match lives inside a single
/// EXISTS). Returning `(clause, params)` keeps the bound values ordered with
/// the statement's other placeholders.
fn category_scope(
    categories: &[String],
) -> Result<Option<(String, Vec<sea_orm::Value>)>, ServiceError> {
    if categories.is_empty() {
        return Ok(None);
    }
    let mut predicates: Vec<String> = Vec::with_capacity(categories.len());
    let mut params: Vec<sea_orm::Value> = Vec::new();
    for key in categories {
        if !tanahpedia_entries_service::is_category_key(key) {
            return Err(ServiceError::bad_request(&format!(
                "Unknown Tanahpedia category: {key}"
            )));
        }
        let (predicate, mut values) = category_key_predicate(key);
        predicates.push(predicate);
        params.append(&mut values);
    }
    Ok(Some((
        format!(
            "EXISTS (SELECT 1 FROM tanahpedia_entry_entity ee \
             JOIN tanahpedia_entity en ON en.id = ee.entity_id \
             WHERE ee.entry_id = e.id AND ({}))",
            predicates.join(" OR ")
        ),
        params,
    )))
}

/// Lexical Tanahpedia entry search over title, unique_name, synonym names and
/// body content — one hit per entry, so an entry reached through several
/// aliases still returns a single result. Scoring keeps the website's weights:
/// name fields (title, unique_name, aliases) at ×2, body content at ×1.
/// `categories` optionally restricts hits to entries linked to entities of
/// the given taxonomy category keys (entity types, person roles, animal
/// kind/purity); the restriction is applied in the candidate query itself,
/// before limiting, so a narrowed search never sheds valid matches.
pub async fn search_entries(
    db: &Database,
    phrase: &str,
    limit: Option<i32>,
    categories: Option<Vec<String>>,
) -> Result<Vec<TanahpediaSearchHit>, ServiceError> {
    tracing::info_span!("tanahpedia_search_service::search_entries");
    if phrase.chars().count() > MAX_SEARCH_PHRASE_CHARS {
        return Err(ServiceError::bad_request(
            "Search phrase exceeds 256 characters",
        ));
    }
    let limit = limit.unwrap_or(SEARCH_DEFAULT_LIMIT);
    if !(1..=SEARCH_MAX_LIMIT).contains(&limit) {
        return Err(ServiceError::bad_request("limit must be between 1 and 50"));
    }

    let terms = search_tokens(phrase);
    if terms.is_empty()
        || terms.len() > MAX_TERMS
        || terms
            .iter()
            .any(|term| term.chars().count() > MAX_TERM_CHARS)
    {
        return Ok(Vec::new());
    }

    // Per-term candidate predicate: the term's chunk gate must match at least
    // one searchable field (AND across terms, OR across fields).
    let per_term = format!(
        "(REGEXP_LIKE(e.title, ?, 'i') OR REGEXP_LIKE(e.unique_name, ?, 'i') \
         OR REGEXP_LIKE(e.content, ?, 'i') OR {SYNONYM_MATCH})"
    );
    let where_clause = terms
        .iter()
        .map(|_| per_term.as_str())
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut params: Vec<sea_orm::Value> = Vec::with_capacity(terms.len() * 4);
    for term in &terms {
        let gate = term_gate_regexp(term);
        for _ in 0..4 {
            params.push(gate.clone().into());
        }
    }
    let scope = category_scope(categories.as_deref().unwrap_or_default())?;
    let scoped_clause = match &scope {
        Some((clause, _)) => format!("{where_clause} AND {clause}"),
        None => where_clause.clone(),
    };
    if let Some((_, values)) = scope {
        params.extend(values);
    }
    let candidates_sql = format!(
        "SELECT /*+ MAX_EXECUTION_TIME({QUERY_TIME_BUDGET_MS}) */ \
                e.id, e.unique_name, e.title, e.content \
           FROM tanahpedia_entry e \
          WHERE {scoped_clause} \
          ORDER BY e.id \
          LIMIT {CANDIDATE_LIMIT}"
    );
    let rows = SearchCandidateRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        candidates_sql,
        params,
    ))
    .all(db.get_connection())
    .await
    .map_err(|db_err| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err)))?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    // Every name resolving to a candidate entry — its own aliases and the
    // disambiguation targets pointing at it — so scoring sees all of them.
    let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let alias_sql = format!(
        "SELECT syn.entry_id AS entry_id, syn.name AS name \
           FROM tanahpedia_entry_synonym syn \
          WHERE syn.entry_id IN ({placeholders}) \
          UNION \
         SELECT dis.entry_id AS entry_id, syn.name AS name \
           FROM tanahpedia_entry_synonym_disambiguation dis \
           JOIN tanahpedia_entry_synonym syn ON syn.id = dis.synonym_id \
          WHERE dis.entry_id IN ({placeholders})"
    );
    let alias_params: Vec<sea_orm::Value> = ids
        .iter()
        .chain(ids.iter())
        .map(|id| id.clone().into())
        .collect();
    let alias_rows = AliasRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        alias_sql,
        alias_params,
    ))
    .all(db.get_connection())
    .await
    .map_err(|db_err| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err)))?;
    let mut aliases_by_entry: HashMap<String, Vec<String>> = HashMap::new();
    for row in alias_rows {
        aliases_by_entry
            .entry(row.entry_id)
            .or_default()
            .push(row.name);
    }

    // Excerpt matching runs on the article-search normalization (folding
    // included) — a superset only used to window the snippet, never to score.
    let excerpt_terms = text::tokenize(phrase);
    let mut hits: Vec<TanahpediaSearchHit> = rows
        .into_iter()
        .filter_map(|row| {
            let aliases = aliases_by_entry.get(&row.id).cloned().unwrap_or_default();
            let title_score =
                search_score(&row.title, phrase).max(search_score(&row.unique_name, phrase));
            let synonym_score = aliases
                .iter()
                .map(|name| search_score(name, phrase))
                .max()
                .unwrap_or(0);
            let content_plain = text::strip_html(row.content.as_deref().unwrap_or_default());
            let content_score = score_normalized(&text::normalize_strict(&content_plain), phrase);
            // Title and aliases are the name fields (×2 like author/article
            // names); body content is the weak signal.
            let score = (title_score.max(synonym_score) * 2).max(content_score);
            if score <= 0 {
                return None;
            }
            // The snippet explains the match: the body excerpt when content
            // scored, the alias list when an alias outscored the title, else
            // the body lead-in — empty when the entry has neither.
            let plain = if content_score > 0 {
                content_plain
            } else if synonym_score > title_score {
                format!("נקרא גם: {}", aliases.join(", "))
            } else {
                content_plain
            };
            Some(TanahpediaSearchHit {
                id: row.id,
                unique_name: row.unique_name,
                title: row.title,
                excerpt: text::excerpt(&plain, &excerpt_terms, EXCERPT_CHARS),
                score,
            })
        })
        .collect();
    // Score desc; then title — UTF-8 byte order is Hebrew codepoint order,
    // matching the website's `localeCompare(title, "he")` for plain-letter
    // titles — then id for a deterministic tail.
    hits.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.id.cmp(&right.id))
    });
    hits.truncate(limit as usize);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, Value};
    use std::collections::BTreeMap;

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    fn candidate(
        id: &str,
        unique_name: &str,
        title: &str,
        content: Option<&str>,
    ) -> BTreeMap<String, Value> {
        mock_row([
            ("id", id.into()),
            ("unique_name", unique_name.into()),
            ("title", title.into()),
            (
                "content",
                match content {
                    Some(body) => Value::String(Some(body.to_string())),
                    None => Value::String(None),
                },
            ),
        ])
    }

    fn alias(entry_id: &str, name: &str) -> BTreeMap<String, Value> {
        mock_row([("entry_id", entry_id.into()), ("name", name.into())])
    }

    fn db_with(
        candidates: Vec<BTreeMap<String, Value>>,
        aliases: Vec<BTreeMap<String, Value>>,
    ) -> Database {
        Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    candidates,
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    aliases,
                ])
                .into_connection(),
        )
    }

    #[test]
    fn term_chunks_split_by_edit_budget() {
        // Short terms stay whole; the chunk count grows with max_edits.
        assert_eq!(term_chunks("אב"), vec!["אב"]);
        assert_eq!(term_chunks("אבגד"), vec!["אב", "גד"]);
        // 7 chars, 1 edit → two chunks (4 + 3).
        assert_eq!(term_chunks("ירושלימ"), vec!["ירוש", "לימ"]);
        // 10 chars, 2 edits → three chunks (4 + 3 + 3).
        assert_eq!(term_chunks("אברהםאבינו"), vec!["אברה", "םאב", "ינו"]);
    }

    #[test]
    fn term_gate_regexp_is_anchor_free_chunk_union() {
        // A single-chunk term produces a bare ordered-letters pattern.
        assert_eq!(
            term_gate_regexp("משה"),
            format!("מ{0}*ש{0}*ה", IGNORABLE_RUN)
        );
        // Multi-chunk terms union their chunk patterns.
        let gate = term_gate_regexp("אבגד");
        assert!(gate.starts_with("(?:"));
        assert!(gate.ends_with(')'));
        assert!(gate.contains('|'));
        assert!(
            gate.contains("א") && gate.contains("ב") && gate.contains("ג") && gate.contains("ד")
        );
    }

    #[test]
    fn search_score_assigns_the_website_tiers() {
        // Whole-text equality and whole-word containment.
        assert_eq!(search_score("משה רבנו", "משה רבנו"), 110);
        assert_eq!(search_score("דברי משה רבנו הנביא", "משה רבנו"), 100);
        // Exact word / prefix / fuzzy / miss per single term.
        assert_eq!(search_score("משה ואהרן", "משה"), 100);
        assert_eq!(search_score("בראשית", "ברא"), 80);
        assert_eq!(search_score("בראשים", "בראשית"), 60);
        assert_eq!(search_score("קוראים לו משה", "דוד"), 0);
        // Every term must match — the group's score is the weakest term's.
        assert_eq!(search_score("משה רבנו", "משה חסר"), 0);
        assert_eq!(search_score("משה רבנו עלינו", "משה עלינו"), 90);
        // Niqqud and quote characters normalize away — בְּרֵאשִׁית ≡ בראשית.
        assert_eq!(search_score("בְּרֵאשִׁית בָּרָא", "בראשית"), 100);
        assert_eq!(search_score("שליט\"א", "שליטא"), 110);
    }

    #[tokio::test]
    async fn search_entries_rejects_out_of_range_arguments() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let long = "א".repeat(MAX_SEARCH_PHRASE_CHARS + 1);
        assert!(search_entries(&db, &long, None, None).await.is_err());
        assert!(search_entries(&db, "משה", Some(0), None).await.is_err());
        assert!(search_entries(&db, "משה", Some(51), None).await.is_err());
    }

    #[tokio::test]
    async fn search_entries_returns_empty_for_blank_or_huge_queries() {
        // No appended mock results: a DB hit would error, proving the guard
        // short-circuits before the query.
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        assert!(
            search_entries(&db, "   ", None, None)
                .await
                .unwrap()
                .is_empty()
        );
        let many_terms = (0..17)
            .map(|i| format!("מ{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            search_entries(&db, &many_terms, None, None)
                .await
                .unwrap()
                .is_empty()
        );
        let long_term = "א".repeat(MAX_TERM_CHARS + 1);
        assert!(
            search_entries(&db, &long_term, None, None)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn search_entries_title_hit_needs_no_body() {
        let db = db_with(vec![candidate("e1", "משה-רבנו", "משה רבנו", None)], vec![]);
        let hits = search_entries(&db, "משה רבנו", Some(10), None)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].unique_name, "משה-רבנו");
        assert_eq!(hits[0].score, 220, "title equality is name-weighted ×2");
        assert!(hits[0].excerpt.is_empty(), "no body → no snippet text");
    }

    #[tokio::test]
    async fn search_entries_alias_hit_surfaces_alias_list() {
        // "בינ נון" matches only the alias, not the title — the excerpt is the
        // alias list and the score is the alias's name weight.
        let db = db_with(
            vec![candidate(
                "e1",
                "יהושע-בן-נון",
                "יהושע בן נון",
                Some("<p>מושלם</p>"),
            )],
            vec![alias("e1", "בינ נון")],
        );
        let hits = search_entries(&db, "בינ נון", None, None).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].score, 220);
        assert!(hits[0].excerpt.contains("נקרא גם:"));
        assert!(hits[0].excerpt.contains("בינ נון"));
    }

    #[tokio::test]
    async fn search_entries_disambiguation_alias_counts_for_scoring() {
        // The alias pull's UNION covers disambiguation targets — a name that
        // resolves to the entry through tanahpedia_entry_synonym_disambiguation
        // scores the entry exactly like a direct alias.
        let db = db_with(
            vec![candidate("e1", "דתן-ואבירם", "דתן ואבירם", None)],
            vec![alias("e1", "בני קרח")],
        );
        let hits = search_entries(&db, "בני קרח", None, None).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].unique_name, "דתן-ואבירם");
        assert!(hits[0].excerpt.contains("בני קרח"));
    }

    #[tokio::test]
    async fn search_entries_content_hit_excerpts_the_body() {
        let body = "<p>ענן הכבוד כיסה את ההר ויקרא אל משה</p>";
        let db = db_with(
            vec![candidate("e1", "הר-סיני", "הר סיני", Some(body))],
            vec![],
        );
        let hits = search_entries(&db, "ענן הכבוד", None, None).await.unwrap();
        assert_eq!(hits.len(), 1);
        // Content matches score at the weak weight — the whole-word phrase
        // tier (100) stays under any name hit.
        assert_eq!(hits[0].score, 100);
        assert!(hits[0].excerpt.contains("ענן"));
        assert!(hits[0].excerpt.contains("הכבוד"));
    }

    #[tokio::test]
    async fn search_entries_ranks_exact_name_over_prefix_and_limits() {
        let db = db_with(
            vec![
                candidate("e1", "דודו", "דודו", None),
                candidate("e2", "דוד", "דוד", None),
            ],
            vec![],
        );
        let hits = search_entries(&db, "דוד", Some(1), None).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].unique_name, "דוד", "exact title beats prefix hit");
    }

    #[tokio::test]
    async fn search_entries_drops_zero_score_candidates() {
        // The gate is a superset — rows whose only match was a stray chunk get
        // filtered out by the score > 0 rule.
        let db = db_with(
            vec![candidate(
                "e1",
                "שלמה",
                "שלמה המלך",
                Some("<p>בנה את הבית</p>"),
            )],
            vec![],
        );
        let hits = search_entries(&db, "אברם", None, None).await.unwrap();
        assert!(hits.is_empty());
    }

    #[tokio::test]
    async fn search_entries_propagates_db_errors() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_errors([DbErr::Custom("Connection lost".to_string())])
                .into_connection(),
        );
        assert!(matches!(
            search_entries(&db, "משה", None, None).await,
            Err(ServiceError::InternalServerError(_))
        ));
    }

    #[tokio::test]
    async fn search_entries_rejects_unknown_category() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        assert!(matches!(
            search_entries(&db, "משה", None, Some(vec!["WIZARD".to_string()])).await,
            Err(ServiceError::BadRequest(_))
        ));
    }

    #[tokio::test]
    async fn search_entries_categories_scope_the_candidate_query() {
        // Person role + base type + animal kind in one union: the statement
        // must carry the entity EXISTS before the limit and bind the scoped
        // keys, and must still return the hit (mock candidates pass through).
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![candidate("e1", "משה-רבנו", "משה רבנו", None)],
            ])
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![],
            ])
            .into_connection();
        let db = Database::from_connection(conn.clone());

        let hits = search_entries(
            &db,
            "משה רבנו",
            Some(10),
            Some(vec![
                "PERSON".to_string(),
                "PROPHET".to_string(),
                "KING".to_string(),
                "BEHEMA".to_string(),
                "TAHOR".to_string(),
            ]),
        )
        .await
        .unwrap();
        assert_eq!(hits.len(), 1);

        let log = conn.into_transaction_log();
        let sql = format!("{:?}", log[0]);
        assert!(
            sql.contains("tanahpedia_entry_entity ee"),
            "scope joins linked entities: {sql}"
        );
        assert!(sql.contains("en.entity_type"), "base type predicate: {sql}");
        assert!(
            sql.contains("tanahpedia_person_role_prophet")
                && sql.contains("tanahpedia_person_role_king"),
            "role keys narrow to the person role tables: {sql}"
        );
        assert!(
            sql.contains("tanahpedia_animal_kind") && sql.contains("ac.kind"),
            "BEHEMA narrows to the animal-kind classification: {sql}"
        );
        assert!(
            sql.contains("tanahpedia_animal_purity") && sql.contains("ac.purity"),
            "TAHOR narrows to the animal-purity classification: {sql}"
        );
        assert!(
            sql.contains("PERSON") && sql.contains("BEHEMA"),
            "keys bind: {sql}"
        );
    }

    #[tokio::test]
    async fn search_entries_no_categories_keeps_plain_query() {
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![candidate("e1", "משה-רבנו", "משה רבנו", None)],
            ])
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![],
            ])
            .into_connection();
        let db = Database::from_connection(conn.clone());

        search_entries(&db, "משה רבנו", None, Some(vec![]))
            .await
            .unwrap();

        let log = conn.into_transaction_log();
        let sql = format!("{:?}", log[0]);
        assert!(
            !sql.contains("tanahpedia_entry_entity"),
            "an empty selection must not scope the query: {sql}"
        );
    }
}
