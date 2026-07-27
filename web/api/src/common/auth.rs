use std::env;

use crate::common::error_handling::ServiceError;

/// Name of the environment variable holding the shared secret that external AI
/// clients must present (as a `Authorization: Bearer <key>` header) to submit
/// Tanahpedia entry revisions.
pub const REVISION_API_KEY_ENV: &str = "TANAHPEDIA_REVISION_API_KEY";

/// Bearer token extracted from the incoming HTTP request and injected into the
/// GraphQL context. `None` means no usable `Authorization: Bearer` header was
/// present on the request.
#[derive(Clone, Debug, Default)]
pub struct ApiAuth {
    bearer: Option<String>,
    revision_api_key: Option<String>,
}

impl ApiAuth {
    pub fn new(bearer: Option<String>) -> Self {
        let revision_api_key = env::var(REVISION_API_KEY_ENV)
            .ok()
            .filter(|key| !key.is_empty());
        Self {
            bearer,
            revision_api_key,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_revision_api_key(
        bearer: Option<String>,
        revision_api_key: Option<String>,
    ) -> Self {
        Self {
            bearer,
            revision_api_key,
        }
    }

    /// Authorizes a request to submit or apply an entry revision.
    ///
    /// Fails closed: if `TANAHPEDIA_REVISION_API_KEY` is unset/empty the endpoint
    /// is disabled and every request is rejected. The presented token is compared
    /// to the configured key in constant time to avoid leaking it via timing.
    pub fn authorize_revision_manager(&self) -> Result<(), ServiceError> {
        match (self.revision_api_key.as_deref(), self.bearer.as_deref()) {
            (Some(expected), Some(presented)) if constant_time_eq(expected, presented) => Ok(()),
            (None, _) => Err(ServiceError::unauthorized("Revision API is not configured")),
            _ => Err(ServiceError::unauthorized("Invalid or missing API key")),
        }
    }
}

/// Constant-time string comparison. Returns `false` immediately on length
/// mismatch (length is not secret here) and otherwise ORs the XOR of every byte
/// so the running time does not depend on where the first difference is.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_eq_matches_std_equality() {
        assert!(constant_time_eq("secret-key", "secret-key"));
        assert!(!constant_time_eq("secret-key", "secret-keyy"));
        assert!(!constant_time_eq("secret-key", "wrong-key0"));
        assert!(!constant_time_eq("", "x"));
        assert!(constant_time_eq("", ""));
    }

    #[test]
    fn new_captures_current_process_configuration() {
        let expected = env::var(REVISION_API_KEY_ENV)
            .ok()
            .filter(|key| !key.is_empty());
        let auth = ApiAuth::new(None);
        assert_eq!(auth.revision_api_key, expected);
    }

    #[test]
    fn authorize_fails_when_key_not_configured() {
        let auth = ApiAuth::with_revision_api_key(Some("anything".to_string()), None);
        assert!(auth.authorize_revision_manager().is_err());
    }

    #[test]
    fn authorize_fails_with_wrong_or_missing_token() {
        let expected = Some("correct-horse".to_string());
        assert!(
            ApiAuth::with_revision_api_key(Some("wrong".to_string()), expected.clone())
                .authorize_revision_manager()
                .is_err()
        );
        assert!(
            ApiAuth::with_revision_api_key(None, expected)
                .authorize_revision_manager()
                .is_err()
        );
    }

    #[test]
    fn authorize_succeeds_with_correct_token() {
        assert!(
            ApiAuth::with_revision_api_key(
                Some("correct-horse".to_string()),
                Some("correct-horse".to_string()),
            )
            .authorize_revision_manager()
            .is_ok()
        );
    }
}
