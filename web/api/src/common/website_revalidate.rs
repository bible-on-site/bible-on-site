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

#[derive(serde::Serialize)]
struct PediaEntriesChange<'a> {
    kind: &'a str,
    #[serde(rename = "uniqueNames")]
    unique_names: &'a [String],
}

#[derive(serde::Serialize)]
struct ChangesBody<'a> {
    changes: [PediaEntriesChange<'a>; 1],
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
        let (Some(base), Some(secret)) = (self.base_url.as_deref(), self.secret.as_deref()) else {
            tracing::warn!(
                "website revalidation skipped: WEBSITE_URL/REVALIDATE_SECRET not configured"
            );
            return Revalidation::Skipped;
        };

        let body = ChangesBody {
            changes: [PediaEntriesChange {
                kind: "pedia-entries",
                unique_names: names,
            }],
        };
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
