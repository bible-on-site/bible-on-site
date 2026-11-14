use std::env;
use std::time::Duration;

/// Name of the environment variable holding the public website origin the API
/// posts invalidations to (e.g. `http://website.bible-on-site.local:3000`).
pub const WEBSITE_URL_ENV: &str = "WEBSITE_URL";

/// Name of the environment variable holding the shared secret that guards the
/// website's `POST /api/revalidate` (the same SSM parameter the admin task
/// uses). Server-side only — it travels in the `x-revalidate-secret` header,
/// never the URL.
pub const REVALIDATE_SECRET_ENV: &str = "REVALIDATE_SECRET";

const TIMEOUT: Duration = Duration::from_secs(5);

/// Outcome of a post-commit website invalidation — mirrors the admin server's
/// `RevalidateOutcome`. `Skipped` is the documented no-op (endpoint not
/// configured on this instance), distinct from `Failed` so callers can tell a
/// real freshness problem apart from an intentionally unconfigured one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Revalidation {
    Applied,
    Failed,
    Skipped,
}

impl Revalidation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Revalidation::Applied => "APPLIED",
            Revalidation::Failed => "FAILED",
            Revalidation::Skipped => "SKIPPED",
        }
    }
}

/// Post-commit invalidation of the public website's content caches — the API
/// counterpart of the admin server's `website-revalidate.ts`, minus the
/// debounce queue (authorized API writes are far rarer than admin edits).
///
/// The website caches all DB-backed content indefinitely and prerenders pages,
/// so a committed change only becomes public after `POST /api/revalidate`
/// expires the relevant dependencies. The typed `EntityChange` body is used —
/// callers name entities, never routes — and the website resolves each change
/// to the cache tags and route paths that consume it.
#[derive(Clone, Debug, Default)]
pub struct WebsiteRevalidator {
    base_url: Option<String>,
    secret: Option<String>,
}

/// A pasuk-granular span of article covering-source rows — mirrors the
/// admin/website `ArticleCoveringSpan` contract shape.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleCoveringSpan {
    pub perek_id: i32,
    pub pasuk_from: i32,
    pub pasuk_to: i32,
}

/// An inclusive canonical perek-id range — the dedication change's
/// `perekRanges` element shape.
#[derive(Clone, Debug, serde::Serialize)]
pub struct PerekRange {
    pub low: i32,
    pub high: i32,
}

/// The typed entity-change body the website's `/api/revalidate` consumes —
/// a subset of the admin `EntityChange` contract, serialized identically
/// (`kind` tags + camelCase fields), so the website's dependency resolver
/// handles API-originated writes exactly like admin ones.
#[derive(serde::Serialize)]
#[serde(tag = "kind")]
enum EntityChange<'a> {
    #[serde(rename = "pedia-entries")]
    PediaEntries {
        #[serde(rename = "uniqueNames")]
        unique_names: &'a [String],
    },
    /// An article create/update/move/delete — `perek_ids` is old ∪ new.
    #[serde(rename = "article", rename_all = "camelCase")]
    Article {
        id: i32,
        perek_ids: &'a [i32],
        #[serde(skip_serializing_if = "Option::is_none")]
        author_ids: Option<&'a [i32]>,
        /// Covering spans destroyed by the change (replaced/removed side).
        #[serde(skip_serializing_if = "Option::is_none")]
        covering_spans: Option<&'a [ArticleCoveringSpan]>,
    },
    /// A moed create/update/delete or a link-set change touching it (#3101)
    /// — `old_slug` expires the pre-rename route on slug edits and deletes.
    #[serde(rename = "moed", rename_all = "camelCase")]
    Moed {
        id: i32,
        slug: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        old_slug: Option<&'a str>,
    },
    /// A dedication create/update/delete — assignment sets are old ∪ new.
    #[serde(rename = "dedication", rename_all = "camelCase")]
    Dedication {
        id: i32,
        #[serde(skip_serializing_if = "Option::is_none")]
        perek_ranges: Option<&'a [PerekRange]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sefer_ids: Option<&'a [i32]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        helek_ids: Option<&'a [i32]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parasha_ids: Option<&'a [i32]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        article_ids: Option<&'a [i32]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        entry_ids: Option<&'a [String]>,
        #[serde(skip_serializing_if = "Option::is_none")]
        masora: Option<bool>,
    },
}

/// The assignment set of one dedication change — mirrors the admin
/// `dedicationChange` input; empty lists are omitted from the payload.
#[derive(Clone, Debug, Default)]
pub struct DedicationAssignments {
    pub perek_ranges: Vec<PerekRange>,
    pub sefer_ids: Vec<i32>,
    pub helek_ids: Vec<i32>,
    pub parasha_ids: Vec<i32>,
    pub article_ids: Vec<i32>,
    pub entry_ids: Vec<String>,
    pub masora: bool,
}

/// The association set of an article change — mirrors the admin
/// `articleChange` input.
#[derive(Clone, Debug, Default)]
pub struct ArticleAssociations {
    /// Old ∪ new primary perek ids — required by the website resolver.
    pub perek_ids: Vec<i32>,
    /// Old ∪ new author ids.
    pub author_ids: Vec<i32>,
    /// Destroyed covering spans (the website unions the live rows itself).
    pub covering_spans: Vec<ArticleCoveringSpan>,
}

#[derive(serde::Serialize)]
struct ChangesBody<'a> {
    changes: Vec<EntityChange<'a>>,
}

impl WebsiteRevalidator {
    /// Reads `WEBSITE_URL` + `REVALIDATE_SECRET` from the environment. Either
    /// unset/empty makes every invalidation a `Skipped` no-op — matching the
    /// admin behavior for unconfigured instances (unit tests, tooling).
    pub fn from_env() -> Self {
        let read = |key: &str| env::var(key).ok().filter(|value| !value.is_empty());
        Self {
            base_url: read(WEBSITE_URL_ENV),
            secret: read(REVALIDATE_SECRET_ENV),
        }
    }

    #[cfg(test)]
    pub(crate) fn new(base_url: Option<String>, secret: Option<String>) -> Self {
        Self { base_url, secret }
    }

    /// Expires the `/pedia/<name>` pages (entries, aliases and disambiguation
    /// pages share that route), the `/pedia` index and the name-keyed mention
    /// resolution cache. `names` is the changed alias name plus the unique
    /// names of every entry whose alias membership changed — the website's
    /// `pedia-entries` change resolves each to its route path.
    pub async fn invalidate_pedia_names(&self, names: &[String]) -> Revalidation {
        self.post_changes(vec![EntityChange::PediaEntries {
            unique_names: names,
        }])
        .await
    }

    /// Expires every scoped page/tag a dedication's old ∪ new assignments
    /// render on — perek ranges, sefer/helek/parasha/article/entry scopes and
    /// the masora feature (#2731, #3102).
    pub async fn invalidate_dedication(
        &self,
        id: i32,
        assignments: &DedicationAssignments,
    ) -> Revalidation {
        self.post_changes(vec![EntityChange::Dedication {
            id,
            perek_ranges: non_empty(&assignments.perek_ranges),
            sefer_ids: non_empty(&assignments.sefer_ids),
            helek_ids: non_empty(&assignments.helek_ids),
            parasha_ids: non_empty(&assignments.parasha_ids),
            article_ids: non_empty(&assignments.article_ids),
            entry_ids: non_empty(&assignments.entry_ids),
            masora: assignments.masora.then_some(true),
        }])
        .await
    }

    /// Posts an article change — the same `{changes}` body the admin server
    /// sends (article page/tag, old ∪ new perek listings, old ∪ new author
    /// pages and the destroyed covering spans, #3102) — plus, for a
    /// `updateArticleRelationships.moedIds` write, one moed change per
    /// affected moed so every touched moed page expires atomically (#3101).
    pub async fn invalidate_article_with_moadim(
        &self,
        id: i32,
        associations: &ArticleAssociations,
        moadim: &[(i32, String)],
    ) -> Revalidation {
        let mut changes = vec![EntityChange::Article {
            id,
            perek_ids: &associations.perek_ids,
            author_ids: non_empty(&associations.author_ids),
            covering_spans: non_empty(&associations.covering_spans),
        }];
        changes.extend(moadim.iter().map(|(moed_id, slug)| EntityChange::Moed {
            id: *moed_id,
            slug: slug.as_str(),
            old_slug: None,
        }));
        self.post_changes(changes).await
    }

    /// Expires the surfaces one moed change touches: its detail page/tag
    /// under the current slug, the catalogue and — on rename/delete — the
    /// old slug's prerendered route (`old_slug`, #3101).
    pub async fn invalidate_moed(
        &self,
        id: i32,
        slug: &str,
        old_slug: Option<&str>,
    ) -> Revalidation {
        self.post_changes(vec![EntityChange::Moed { id, slug, old_slug }])
            .await
    }

    /// Posts one `{changes}` body to the website's `/api/revalidate`. The
    /// `Skipped`/`Failed`/`Applied` outcomes mirror the admin server's
    /// semantics — `Failed` callers surface the string in their result so the
    /// client knows the committed write is not yet visible publicly.
    async fn post_changes(&self, changes: Vec<EntityChange<'_>>) -> Revalidation {
        let (Some(base), Some(secret)) = (self.base_url.as_deref(), self.secret.as_deref()) else {
            tracing::warn!(
                "website revalidation skipped: WEBSITE_URL/REVALIDATE_SECRET not configured"
            );
            return Revalidation::Skipped;
        };

        let body = ChangesBody { changes };
        let url = format!("{}/api/revalidate", base.trim_end_matches('/'));
        let client = match reqwest::Client::builder().timeout(TIMEOUT).build() {
            Ok(client) => client,
            Err(err) => {
                tracing::error!(%err, "website revalidation client build failed");
                return Revalidation::Failed;
            }
        };

        match client
            .post(url)
            .header("x-revalidate-secret", secret)
            .json(&body)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => Revalidation::Applied,
            Ok(response) => {
                tracing::error!(status = %response.status(), "website revalidation failed");
                Revalidation::Failed
            }
            Err(err) => {
                tracing::error!(%err, "website revalidation request failed");
                Revalidation::Failed
            }
        }
    }
}

fn non_empty<T>(items: &[T]) -> Option<&[T]> {
    (!items.is_empty()).then_some(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    #[test]
    fn revalidation_status_strings_are_stable() {
        assert_eq!(Revalidation::Applied.as_str(), "APPLIED");
        assert_eq!(Revalidation::Failed.as_str(), "FAILED");
        assert_eq!(Revalidation::Skipped.as_str(), "SKIPPED");
    }

    #[tokio::test]
    async fn skips_when_not_configured() {
        let revalidator = WebsiteRevalidator::new(None, Some("s".to_string()));
        assert_eq!(
            revalidator
                .invalidate_pedia_names(&["משה".to_string()])
                .await,
            Revalidation::Skipped
        );
        let revalidator = WebsiteRevalidator::new(Some("http://x".to_string()), None);
        assert_eq!(
            revalidator
                .invalidate_pedia_names(&["משה".to_string()])
                .await,
            Revalidation::Skipped
        );
    }

    #[tokio::test]
    async fn reports_failure_when_the_website_is_unreachable() {
        let revalidator = WebsiteRevalidator::new(
            Some("http://127.0.0.1:1".to_string()),
            Some("s".to_string()),
        );
        assert_eq!(
            revalidator
                .invalidate_pedia_names(&["משה".to_string()])
                .await,
            Revalidation::Failed
        );
    }

    /// Serves one HTTP response so the request can be inspected: captures the
    /// request head + body, replies with `status`.
    fn serve_once(status: &str) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let status = status.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut request = String::new();
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().unwrap();
                }
                if line == "\r\n" {
                    break;
                }
                request.push_str(&line);
            }
            let mut body = vec![0u8; content_length];
            std::io::Read::read_exact(&mut reader, &mut body).unwrap();
            request.push_str(&String::from_utf8_lossy(&body));
            let response = format!("HTTP/1.1 {}\r\ncontent-length: 0\r\n\r\n", status);
            reader.get_mut().write_all(response.as_bytes()).unwrap();
            tx.send(request).unwrap();
        });
        (format!("http://127.0.0.1:{}", port), rx)
    }

    #[tokio::test]
    async fn posts_the_pedia_entries_change_with_the_secret_header() {
        let (base, rx) = serve_once("200 OK");
        let revalidator = WebsiteRevalidator::new(Some(base), Some("sekret".to_string()));

        let outcome = revalidator
            .invalidate_pedia_names(&["משה".to_string(), "משה-רבנו".to_string()])
            .await;

        assert_eq!(outcome, Revalidation::Applied);
        let request = rx.recv().unwrap();
        assert!(request.starts_with("POST /api/revalidate HTTP/1.1\r\n"));
        assert!(request.contains("x-revalidate-secret: sekret\r\n"));
        assert!(request.contains(
            r#"{"changes":[{"kind":"pedia-entries","uniqueNames":["משה","משה-רבנו"]}]}"#
        ));
    }

    #[tokio::test]
    async fn posts_moed_changes_with_old_slug_and_link_pairs() {
        let (base, rx) = serve_once("200 OK");
        let revalidator = WebsiteRevalidator::new(Some(base), Some("sekret".to_string()));

        let outcome = revalidator
            .invalidate_moed(3, "סוכות", Some("סוכות-ישן"))
            .await;

        assert_eq!(outcome, Revalidation::Applied);
        let request = rx.recv().unwrap();
        assert!(
            request.contains(
                r#"{"changes":[{"kind":"moed","id":3,"slug":"סוכות","oldSlug":"סוכות-ישן"}]}"#
            ),
            "{request}"
        );

        // A link edit batches one moed change per affected moed after the
        // article change — no `oldSlug` on link updates (#3101).
        let (base, rx) = serve_once("200 OK");
        let revalidator = WebsiteRevalidator::new(Some(base), Some("sekret".to_string()));
        let outcome = revalidator
            .invalidate_article_with_moadim(
                7,
                &ArticleAssociations {
                    perek_ids: vec![1],
                    author_ids: vec![2],
                    covering_spans: Vec::new(),
                },
                &[(1, "פסח".to_string()), (2, "סוכות".to_string())],
            )
            .await;
        assert_eq!(outcome, Revalidation::Applied);
        let request = rx.recv().unwrap();
        assert!(
            request.contains(r#"{"kind":"article","id":7,"perekIds":[1],"authorIds":[2]}"#),
            "{request}"
        );
        assert!(
            request.contains(r#"{"kind":"moed","id":1,"slug":"פסח"}"#),
            "{request}"
        );
        assert!(
            request.contains(r#"{"kind":"moed","id":2,"slug":"סוכות"}"#),
            "{request}"
        );
    }

    #[tokio::test]
    async fn reports_failure_on_a_non_success_status() {
        let (base, _rx) = serve_once("503 Service Unavailable");
        let revalidator = WebsiteRevalidator::new(Some(base), Some("sekret".to_string()));
        assert_eq!(
            revalidator
                .invalidate_pedia_names(&["משה".to_string()])
                .await,
            Revalidation::Failed
        );
    }
}
