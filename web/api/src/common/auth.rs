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
}

impl ApiAuth {
    pub fn new(bearer: Option<String>) -> Self {
        Self { bearer }
    }

    /// Authorizes a request to submit an entry revision.
    ///
    /// Fails closed: if `TANAHPEDIA_REVISION_API_KEY` is unset/empty the endpoint
    /// is disabled and every request is rejected. The presented token is compared
    /// to the configured key in constant time to avoid leaking it via timing.
    pub fn authorize_revision_submitter(&self) -> Result<(), ServiceError> {
        let expected = env::var(REVISION_API_KEY_ENV)
            .ok()
            .filter(|key| !key.is_empty());

        match (expected, self.bearer.as_deref()) {
            (Some(expected), Some(presented)) if constant_time_eq(&expected, presented) => Ok(()),
            (None, _) => Err(ServiceError::unauthorized(
                "Revision submission is not configured",
            )),
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

    // Serialize tests that mutate the shared process env var.
    use std::sync::Mutex;
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn constant_time_eq_matches_std_equality() {
        assert!(constant_time_eq("secret-key", "secret-key"));
        assert!(!constant_time_eq("secret-key", "secret-keyy"));
        assert!(!constant_time_eq("secret-key", "wrong-key0"));
        assert!(!constant_time_eq("", "x"));
        assert!(constant_time_eq("", ""));
    }

    #[test]
    fn authorize_fails_when_key_not_configured() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { env::remove_var(REVISION_API_KEY_ENV) };
        let auth = ApiAuth::new(Some("anything".to_string()));
        assert!(auth.authorize_revision_submitter().is_err());
    }

    #[test]
    fn authorize_fails_with_wrong_or_missing_token() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { env::set_var(REVISION_API_KEY_ENV, "correct-horse") };
        assert!(
            ApiAuth::new(Some("wrong".to_string()))
                .authorize_revision_submitter()
                .is_err()
        );
        assert!(ApiAuth::new(None).authorize_revision_submitter().is_err());
        unsafe { env::remove_var(REVISION_API_KEY_ENV) };
    }

    #[test]
    fn authorize_succeeds_with_correct_token() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { env::set_var(REVISION_API_KEY_ENV, "correct-horse") };
        assert!(
            ApiAuth::new(Some("correct-horse".to_string()))
                .authorize_revision_submitter()
                .is_ok()
        );
        unsafe { env::remove_var(REVISION_API_KEY_ENV) };
    }
}
