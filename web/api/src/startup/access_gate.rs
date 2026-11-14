//! Global API access gate (issue #3066) — the non-production proof of the
//! owner-approved contract: native apps sign GraphQL requests with a
//! build-time-injected HMAC key; the API verifies signatures and, once
//! enforcement is switched on, rejects unsigned calls except authenticated
//! (manager-scope bearer) callers.
//!
//! Rollout model (see `docs/api/access-keys-abuse-controls.md`):
//! `API_REQUIRE_SIGNATURE=observe` (default) counts signed vs unsigned calls
//! during the ~2-week client-upgrade grace window; `=enforce` rejects the
//! unsigned lane with 401. The flag is env-reversible — rollback is a config
//! change, not a redeploy. The gate applies only to `POST /` (the GraphQL
//! endpoint); `/health`, `/health/ready` and dev tooling stay reachable so
//! health checks and local development are unaffected.
//!
//! Honest scope: a key compiled into a distributed native app is extractable.
//! The signature raises the cost of anonymous API access — it is not proof of
//! an untampered app and never satisfies the `*_manager` authorization scopes.

use std::{
    collections::{HashMap, VecDeque},
    env,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use actix_web::{
    Error, HttpResponse,
    body::{BoxBody, MessageBody},
    dev::{Payload, ServiceRequest, ServiceResponse},
    error::{ErrorPayloadTooLarge, PayloadError},
    http::header::HeaderMap,
    middleware::Next,
    web,
};
use anyhow::bail;
use chrono::Utc;
use futures_util::StreamExt;

use crate::common::{
    auth::{ApiAuth, extract_bearer},
    signing::{self, SignatureHeaderParse, SignatureHeaders},
};

/// `observe` (default) lets unsigned requests through and logs the verdict;
/// `enforce` rejects them — flipped when the ~2-week upgrade grace closes.
pub const MODE_ENV: &str = "API_REQUIRE_SIGNATURE";

/// Comma-separated `key-id:secret` pairs; several entries let key rotation
/// accept the previous cohort (N-1) while new builds sign with the new id.
pub const KEYS_ENV: &str = "API_SIGNING_KEYS";

/// Accepted clock skew around the request timestamp, in seconds (±).
pub const TOLERANCE_ENV: &str = "API_SIGNATURE_TOLERANCE_SECS";

const DEFAULT_TOLERANCE_SECS: i64 = 300;

/// The gate must buffer a body to hash it. The bound mirrors the deployed
/// edge cap (NGINX `client_max_body_size`, default 1 MiB), so it changes the
/// effective contract only for traffic that bypasses the edge — it does not
/// introduce a new request-size policy.
const MAX_SIGNABLE_BODY_BYTES: usize = 1024 * 1024;

/// Bound on remembered nonces; oldest entries evict first. Flooding only
/// re-enables replays inside the ±tolerance window, which is already the
/// residual risk of timestamp-only freshness.
const NONCE_CAPACITY: usize = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateMode {
    /// Count/lane-mark only; unsigned requests still reach the GraphQL layer.
    Observe,
    /// Reject unsigned requests with 401.
    Enforce,
}

/// Startup-resolved gate configuration. `Clone` is cheap (`Arc` internals)
/// and `web::Data<AccessGate>` shares one nonce cache across all workers.
#[derive(Clone)]
pub struct AccessGate {
    mode: GateMode,
    keys: Arc<HashMap<String, Vec<u8>>>,
    tolerance_secs: i64,
    nonces: Arc<Mutex<NonceCache>>,
}

/// What the headers alone already prove — avoids buffering the body for
/// requests that cannot be signed anyway.
enum HeaderVerdict {
    Final(Verdict),
    /// All header-phase checks passed; the HMAC itself needs the body.
    Candidate(SignatureHeaders),
}

/// Gate outcome for one request.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Valid manager-scope bearer — the authenticated lane (#3066 contract).
    Authenticated,
    /// Valid app signature for the given key cohort.
    Signed { key_id: String },
    /// Not signed, or signature rejected; reason codes are logged, never
    /// key material, signatures or nonces.
    Unsigned(&'static str),
}

impl AccessGate {
    /// Resolves the gate from the process environment. Fails fast on the one
    /// dangerous misconfiguration — `enforce` without verification keys would
    /// silently lock out every unsigned client, so the server refuses to
    /// start instead.
    pub fn resolve() -> anyhow::Result<Self> {
        Self::resolve_with(|name| env::var(name).ok())
    }

    fn resolve_with(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let mode = match get(MODE_ENV)
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref()
        {
            None | Some("") | Some("observe") => GateMode::Observe,
            Some("enforce") => GateMode::Enforce,
            Some(other) => {
                tracing::warn!(
                    "Unrecognized {MODE_ENV}={other:?} — access gate stays in observe mode"
                );
                GateMode::Observe
            }
        };
        let keys = parse_signing_keys(get(KEYS_ENV).as_deref().unwrap_or_default());
        if mode == GateMode::Enforce && keys.is_empty() {
            bail!("{MODE_ENV}=enforce requires at least one {KEYS_ENV} entry");
        }
        let tolerance_secs = match get(TOLERANCE_ENV) {
            None => DEFAULT_TOLERANCE_SECS,
            Some(raw) => match raw.trim().parse::<i64>() {
                Ok(secs) => secs,
                Err(_) => {
                    tracing::warn!(
                        "Unparseable {TOLERANCE_ENV}={raw:?} — using {DEFAULT_TOLERANCE_SECS}s"
                    );
                    DEFAULT_TOLERANCE_SECS
                }
            },
        };
        Ok(Self::new(mode, keys, tolerance_secs))
    }

    fn new(mode: GateMode, keys: HashMap<String, Vec<u8>>, tolerance_secs: i64) -> Self {
        Self {
            mode,
            keys: Arc::new(keys),
            tolerance_secs,
            nonces: Arc::new(Mutex::new(NonceCache::new(NONCE_CAPACITY))),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(mode: GateMode, keys: &[(&str, &str)], tolerance_secs: i64) -> Self {
        Self::new(
            mode,
            keys.iter()
                .map(|(id, secret)| (id.to_string(), secret.as_bytes().to_vec()))
                .collect(),
            tolerance_secs,
        )
    }

    /// Header-phase classification: the authenticated lane first (the
    /// fail-closed `ApiAuth` scope check), then everything provable without
    /// the body. Only a full candidate is worth buffering the body for.
    fn header_verdict(&self, auth: &ApiAuth, headers: &HeaderMap, now_unix: i64) -> HeaderVerdict {
        if auth.is_authorized_manager() {
            return HeaderVerdict::Final(Verdict::Authenticated);
        }
        match signing::parse_signature_headers(headers) {
            SignatureHeaderParse::Absent => {
                HeaderVerdict::Final(Verdict::Unsigned("missing-signature"))
            }
            SignatureHeaderParse::Malformed => {
                HeaderVerdict::Final(Verdict::Unsigned("malformed-signature-headers"))
            }
            SignatureHeaderParse::Present(hdrs) => {
                if !self.keys.contains_key(&hdrs.key_id) {
                    HeaderVerdict::Final(Verdict::Unsigned("unknown-key-id"))
                } else if !signing::timestamp_fresh(now_unix, hdrs.timestamp, self.tolerance_secs) {
                    HeaderVerdict::Final(Verdict::Unsigned("stale-timestamp"))
                } else {
                    HeaderVerdict::Candidate(hdrs)
                }
            }
        }
    }

    /// Body-phase classification for a header candidate: HMAC over the
    /// canonical request, then the nonce replay check. The nonce is recorded
    /// only for *valid* signatures — otherwise anyone could burn a victim's
    /// nonce and deny their legitimate request inside the window.
    fn body_verdict(
        &self,
        hdrs: &SignatureHeaders,
        method: &str,
        path: &str,
        body: &[u8],
    ) -> Verdict {
        let Some(secret) = self.keys.get(&hdrs.key_id) else {
            return Verdict::Unsigned("unknown-key-id");
        };
        let canonical = signing::canonical_v1(
            &hdrs.key_id,
            method,
            path,
            hdrs.timestamp,
            &hdrs.nonce,
            &signing::body_sha256_hex(body),
        );
        if !signing::verify_signature(secret, &canonical, &hdrs.signature) {
            return Verdict::Unsigned("signature-mismatch");
        }
        let nonce_ttl = Duration::from_secs(
            // A signature stays acceptable for ±tolerance, so a captured nonce
            // must be remembered across its whole replayable life (2×).
            self.tolerance_secs.unsigned_abs().saturating_mul(2),
        );
        let mut nonces = self
            .nonces
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match nonces.record(&hdrs.key_id, &hdrs.nonce, nonce_ttl, Instant::now()) {
            NonceOutcome::Replayed => Verdict::Unsigned("nonce-replayed"),
            NonceOutcome::Fresh => Verdict::Signed {
                key_id: hdrs.key_id.clone(),
            },
        }
    }

    /// Lets a passing verdict continue to the GraphQL handler; applies the
    /// mode to an unsigned verdict and logs the outcome (reason codes only —
    /// never credentials, signatures or bodies).
    async fn finish<B: MessageBody + 'static>(
        &self,
        req: ServiceRequest,
        next: Next<B>,
        verdict: Verdict,
    ) -> Result<ServiceResponse<BoxBody>, Error> {
        let reject = match &verdict {
            Verdict::Authenticated => {
                tracing::info!(api_access_verdict = "authenticated");
                false
            }
            Verdict::Signed { key_id } => {
                tracing::info!(api_access_verdict = "signed", api_key_id = %key_id);
                false
            }
            Verdict::Unsigned(reason) => match self.mode {
                GateMode::Observe => {
                    tracing::info!(api_access_verdict = "unsigned", api_access_reason = reason);
                    false
                }
                GateMode::Enforce => {
                    tracing::warn!(api_access_verdict = "rejected", api_access_reason = reason);
                    true
                }
            },
        };
        if reject {
            Ok(req.into_response(unsigned_response()))
        } else {
            next.call(req)
                .await
                .map(ServiceResponse::map_into_boxed_body)
        }
    }
}

/// `from_fn` middleware on the `POST /` resource. Buffers the body only when
/// the headers are already a plausible signature — unsigned and unverifiable
/// requests never pay the copy.
pub async fn gate_middleware(
    req: ServiceRequest,
    next: Next<impl MessageBody + 'static>,
) -> Result<ServiceResponse<BoxBody>, Error> {
    let Some(gate) = req.app_data::<web::Data<AccessGate>>().cloned() else {
        // Unregistered gate means no gate — the observe contract is fail-open
        // by design so a wiring change cannot lock clients out.
        return next
            .call(req)
            .await
            .map(ServiceResponse::map_into_boxed_body);
    };
    let auth = ApiAuth::new(extract_bearer(req.request()));
    match gate.header_verdict(&auth, req.headers(), Utc::now().timestamp()) {
        HeaderVerdict::Final(verdict) => gate.finish(req, next, verdict).await,
        HeaderVerdict::Candidate(hdrs) => {
            let (parts, payload) = req.into_parts();
            let body = match read_capped(payload).await {
                Ok(body) => body,
                Err(err) => {
                    let req = ServiceRequest::from_parts(parts, Payload::None);
                    return Ok(req.error_response(ErrorPayloadTooLarge(err)));
                }
            };
            let verdict = gate.body_verdict(&hdrs, parts.method().as_str(), parts.path(), &body);
            // The GraphQL extractor still needs the body — hand the buffered
            // bytes back as the request payload.
            let req = ServiceRequest::from_parts(parts, Payload::from(body));
            gate.finish(req, next, verdict).await
        }
    }
}

/// The rejection contract: an ordinary HTTP 401 with a GraphQL-shaped error
/// payload — deliberately not a `data`/`errors` 200 so transport layers
/// treat it as an access failure, not a query result.
fn unsigned_response() -> HttpResponse {
    HttpResponse::Unauthorized().json(serde_json::json!({
        "errors": [{ "message": "unsigned or invalid API request" }]
    }))
}

/// Drains the payload into one buffer for hashing. Bounded only by the
/// existing edge body cap this mirrors; overflow is an error in every mode —
/// an unverifiable body is not silently re-injected.
async fn read_capped(mut payload: Payload) -> Result<web::Bytes, PayloadError> {
    let mut body = web::BytesMut::new();
    while let Some(chunk) = payload.next().await {
        let chunk = chunk?;
        if body.len() + chunk.len() > MAX_SIGNABLE_BODY_BYTES {
            return Err(PayloadError::Overflow);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body.freeze())
}

/// `key-id:secret` pairs, comma-separated. Entries without a colon or with an
/// empty side are skipped with a warning — under `enforce`, an empty result
/// still fails startup in `resolve_with`.
fn parse_signing_keys(raw: &str) -> HashMap<String, Vec<u8>> {
    raw.split(',')
        .filter_map(|pair| {
            let pair = pair.trim();
            if pair.is_empty() {
                return None;
            }
            match pair.split_once(':') {
                Some((id, secret)) => {
                    let id = id.trim();
                    let secret = secret.trim();
                    if id.is_empty() || secret.is_empty() {
                        tracing::warn!("Ignoring {KEYS_ENV} entry with empty key-id or secret");
                        None
                    } else {
                        Some((id.to_string(), secret.as_bytes().to_vec()))
                    }
                }
                None => {
                    tracing::warn!("Ignoring malformed {KEYS_ENV} entry (expected key-id:secret)");
                    None
                }
            }
        })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
enum NonceOutcome {
    Fresh,
    Replayed,
}

/// Bounded in-memory nonce registry: remembers `(key-id, nonce)` for the
/// signature's replayable lifetime. Insertion order approximates expiry
/// order (uniform TTL), so a front-pop evicts the oldest entry in O(1).
struct NonceCache {
    entries: HashMap<(String, String), Instant>,
    order: VecDeque<((String, String), Instant)>,
    capacity: usize,
}

impl NonceCache {
    fn new(capacity: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            capacity,
        }
    }

    /// `Fresh` records the nonce; `Replayed` means it was seen inside its
    /// TTL. Expired entries may be re-recorded.
    fn record(&mut self, key_id: &str, nonce: &str, ttl: Duration, now: Instant) -> NonceOutcome {
        let key = (key_id.to_owned(), nonce.to_owned());
        if let Some(&expiry) = self.entries.get(&key) {
            if expiry > now {
                return NonceOutcome::Replayed;
            }
            self.entries.remove(&key);
        }
        while self.entries.len() >= self.capacity {
            let Some((stale, recorded_expiry)) = self.order.pop_front() else {
                break;
            };
            // A re-recorded nonce leaves a stale index entry; only evict when
            // the front still points at the live record.
            if self.entries.get(&stale) == Some(&recorded_expiry) {
                self.entries.remove(&stale);
            }
        }
        let expiry = now + ttl;
        self.entries.insert(key.clone(), expiry);
        self.order.push_back((key, expiry));
        NonceOutcome::Fresh
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test as aw_test;
    use actix_web::{
        App, HttpResponse, guard,
        http::{StatusCode, header::HeaderValue},
        web,
    };
    use hmac::{Hmac, KeyInit, Mac};

    const SECRET: &str = "test-secret-1";
    const SECRET_2: &str = "test-secret-2";

    fn unsigned_auth() -> ApiAuth {
        ApiAuth::with_revision_api_key(None, None)
    }

    fn manager_auth() -> ApiAuth {
        ApiAuth::with_revision_api_key(Some("mgr".to_string()), Some("mgr".to_string()))
    }

    fn gate(mode: GateMode) -> AccessGate {
        AccessGate::for_test(
            mode,
            &[("k1", SECRET), ("k2", SECRET_2)],
            DEFAULT_TOLERANCE_SECS,
        )
    }

    fn now() -> i64 {
        Utc::now().timestamp()
    }

    fn sign(key_id: &str, secret: &str, timestamp: i64, nonce: &str, body: &[u8]) -> String {
        let canonical = signing::canonical_v1(
            key_id,
            "POST",
            "/",
            timestamp,
            nonce,
            &signing::body_sha256_hex(body),
        );
        let mut mac = <Hmac<sha2::Sha256> as KeyInit>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(canonical.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    fn header_map(pairs: &[(&str, String)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                actix_web::http::header::HeaderName::try_from(*name).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    fn signed_headers(
        key_id: &str,
        secret: &str,
        timestamp: i64,
        nonce: &str,
        body: &[u8],
    ) -> HeaderMap {
        header_map(&[
            ("x-api-key-id", key_id.to_string()),
            ("x-api-timestamp", timestamp.to_string()),
            ("x-api-nonce", nonce.to_string()),
            (
                "x-api-signature",
                sign(key_id, secret, timestamp, nonce, body),
            ),
        ])
    }

    // --- header_verdict / body_verdict decision matrix ---

    #[test]
    fn authenticated_bearer_is_the_authenticated_lane() {
        let g = gate(GateMode::Enforce);
        assert!(matches!(
            g.header_verdict(&manager_auth(), &HeaderMap::new(), now()),
            HeaderVerdict::Final(Verdict::Authenticated)
        ));
    }

    #[test]
    fn unsigned_reasons_never_need_the_body() {
        let g = gate(GateMode::Enforce);
        for (headers, reason) in [
            (HeaderMap::new(), "missing-signature"),
            (
                header_map(&[("x-api-key-id", "k1".into())]),
                "malformed-signature-headers",
            ),
            (
                signed_headers("stranger", SECRET, now(), "n1", b"{}"),
                "unknown-key-id",
            ),
            (
                signed_headers("k1", SECRET, now() - 600, "n2", b"{}"),
                "stale-timestamp",
            ),
        ] {
            match g.header_verdict(&unsigned_auth(), &headers, now()) {
                HeaderVerdict::Final(Verdict::Unsigned(r)) => assert_eq!(r, reason),
                _ => panic!("expected unsigned:{reason}"),
            }
        }
    }

    #[test]
    fn valid_signature_passes_and_replay_is_rejected() {
        let g = gate(GateMode::Enforce);
        let body = br#"{"query":"{ x }"}"#;
        let headers = signed_headers("k1", SECRET, now(), "nonce-1", body);
        let HeaderVerdict::Candidate(hdrs) = g.header_verdict(&unsigned_auth(), &headers, now())
        else {
            panic!("expected candidate");
        };
        assert_eq!(
            g.body_verdict(&hdrs, "POST", "/", body),
            Verdict::Signed {
                key_id: "k1".to_string()
            }
        );
        // Same signature again — the nonce is recorded, so replay is caught.
        let HeaderVerdict::Candidate(hdrs) = g.header_verdict(&unsigned_auth(), &headers, now())
        else {
            panic!("expected candidate");
        };
        assert_eq!(
            g.body_verdict(&hdrs, "POST", "/", body),
            Verdict::Unsigned("nonce-replayed")
        );
    }

    #[test]
    fn tampered_body_or_wrong_secret_mismatch() {
        let g = gate(GateMode::Enforce);
        let signed_body = br#"{"query":"{ a }"}"#;
        let headers = signed_headers("k1", SECRET, now(), "nonce-t", signed_body);
        let HeaderVerdict::Candidate(hdrs) = g.header_verdict(&unsigned_auth(), &headers, now())
        else {
            panic!("expected candidate");
        };
        // Signature was made over a different body — classic tamper.
        assert_eq!(
            g.body_verdict(&hdrs, "POST", "/", br#"{"query":"{ b }"}"#),
            Verdict::Unsigned("signature-mismatch")
        );
        // Signed with an unknown secret under a known key-id.
        let forged = signed_headers("k1", "wrong-secret", now(), "nonce-f", signed_body);
        let HeaderVerdict::Candidate(hdrs) = g.header_verdict(&unsigned_auth(), &forged, now())
        else {
            panic!("expected candidate");
        };
        assert_eq!(
            g.body_verdict(&hdrs, "POST", "/", signed_body),
            Verdict::Unsigned("signature-mismatch")
        );
    }

    #[test]
    fn key_rotation_accepts_both_cohorts_and_revokes_the_old() {
        let g = gate(GateMode::Enforce);
        let body = b"{}";
        // Both k1 and k2 verify while the overlap is configured.
        for (kid, secret) in [("k1", SECRET), ("k2", SECRET_2)] {
            let headers = signed_headers(kid, secret, now(), "n-rot", body);
            let HeaderVerdict::Candidate(hdrs) =
                g.header_verdict(&unsigned_auth(), &headers, now())
            else {
                panic!("expected candidate for {kid}");
            };
            assert!(matches!(
                g.body_verdict(&hdrs, "POST", "/", body),
                Verdict::Signed { .. }
            ));
        }
        // Retiring k1 (revocation/compromise) degrades its cohort to unsigned.
        let retired = AccessGate::for_test(GateMode::Enforce, &[("k2", SECRET_2)], 300);
        let headers = signed_headers("k1", SECRET, now(), "n-old", body);
        assert!(matches!(
            retired.header_verdict(&unsigned_auth(), &headers, now()),
            HeaderVerdict::Final(Verdict::Unsigned("unknown-key-id"))
        ));
    }

    // --- resolve_with env parsing ---

    fn resolver<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    }

    #[test]
    fn resolve_defaults_to_observe_without_keys() {
        for pairs in [
            &[][..],
            &[(MODE_ENV, "")][..],
            &[(MODE_ENV, "observe")][..],
            &[(MODE_ENV, "  observe  ")][..],
            &[(MODE_ENV, "OBSERVE")][..],
            &[(MODE_ENV, "loud-typo")][..],
        ] {
            let gate = AccessGate::resolve_with(resolver(pairs)).unwrap();
            assert_eq!(gate.mode, GateMode::Observe, "{pairs:?}");
        }
    }

    #[test]
    fn resolve_enforce_requires_keys() {
        assert!(AccessGate::resolve_with(resolver(&[(MODE_ENV, "enforce")])).is_err());
        let gate = AccessGate::resolve_with(resolver(&[
            (MODE_ENV, "enforce"),
            (KEYS_ENV, "k1:s1,k2:s2"),
        ]))
        .unwrap();
        assert_eq!(gate.mode, GateMode::Enforce);
        assert_eq!(gate.keys.len(), 2);
    }

    #[test]
    fn parse_keys_skips_malformed_and_empty_entries() {
        let keys = parse_signing_keys("k1:s1,,no-colon,:empty-id,empty-sec:,k2:s2");
        assert_eq!(keys.len(), 2);
        assert_eq!(keys["k1"], b"s1");
        assert_eq!(keys["k2"], b"s2");
    }

    #[test]
    fn resolve_parses_tolerance_and_falls_back_on_garbage() {
        let gate = AccessGate::resolve_with(resolver(&[(TOLERANCE_ENV, "120")])).unwrap();
        assert_eq!(gate.tolerance_secs, 120);
        let gate = AccessGate::resolve_with(resolver(&[(TOLERANCE_ENV, "soon")])).unwrap();
        assert_eq!(gate.tolerance_secs, DEFAULT_TOLERANCE_SECS);
    }

    // --- middleware over HTTP ---

    async fn echo_handler(body: web::Bytes) -> HttpResponse {
        HttpResponse::Ok().body(format!("bytes:{}", body.len()))
    }

    async fn init_gate_service(
        gate: &AccessGate,
    ) -> impl actix_web::dev::Service<actix_http::Request, Response = ServiceResponse, Error = Error>
    {
        aw_test::init_service(
            App::new().app_data(web::Data::new(gate.clone())).service(
                web::resource("/")
                    .guard(guard::Post())
                    .wrap(actix_web::middleware::from_fn(gate_middleware))
                    .to(echo_handler),
            ),
        )
        .await
    }

    fn post(body: &'static str) -> aw_test::TestRequest {
        aw_test::TestRequest::post()
            .uri("/")
            .insert_header(("content-type", "application/json"))
            .set_payload(body)
    }

    #[actix_web::test]
    async fn observe_mode_passes_unsigned_and_signed_through() {
        let g = gate(GateMode::Observe);
        let app = init_gate_service(&g).await;
        let response = aw_test::call_service(&app, post("hello").to_request()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = actix_web::body::to_bytes(response.into_body())
            .await
            .unwrap();
        assert_eq!(&body[..], b"bytes:5");

        let headers = signed_headers("k1", SECRET, now(), "obs-n", b"{}");
        let mut req = post("{}");
        for (name, value) in headers.iter() {
            req = req.insert_header((name.clone(), value.clone()));
        }
        let response = aw_test::call_service(&app, req.to_request()).await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn enforce_rejects_unsigned_and_accepts_signed() {
        let g = gate(GateMode::Enforce);
        let app = init_gate_service(&g).await;
        for (req, expected) in [
            (post("{}").to_request(), StatusCode::UNAUTHORIZED),
            (
                post("{}")
                    .insert_header(("x-api-key-id", "k1"))
                    .to_request(),
                StatusCode::UNAUTHORIZED,
            ),
        ] {
            let response = aw_test::call_service(&app, req).await;
            assert_eq!(response.status(), expected);
            let body = actix_web::body::to_bytes(response.into_body())
                .await
                .unwrap();
            assert!(std::str::from_utf8(&body).unwrap().contains("unsigned"));
        }

        let body = r#"{"query":"{ starter { generatedAt } }"}"#;
        let headers = signed_headers("k1", SECRET, now(), "enf-n", body.as_bytes());
        let mut req = post(body);
        for (name, value) in headers.iter() {
            req = req.insert_header((name.clone(), value.clone()));
        }
        let response = aw_test::call_service(&app, req.to_request()).await;
        assert_eq!(response.status(), StatusCode::OK);
        // The GraphQL extractor's contract is preserved — the body survives.
        let echoed = actix_web::body::to_bytes(response.into_body())
            .await
            .unwrap();
        assert_eq!(
            std::str::from_utf8(&echoed).unwrap(),
            format!("bytes:{}", body.len())
        );
    }

    #[actix_web::test]
    async fn enforce_rejects_stale_tampered_and_replayed_over_http() {
        let g = gate(GateMode::Enforce);
        let app = init_gate_service(&g).await;
        for (headers, case) in [
            (
                signed_headers("k1", SECRET, now() - 900, "s", b"{}"),
                "stale",
            ),
            (
                signed_headers("k1", SECRET, now(), "t", b"{}"),
                "tampered-body",
            ),
            (
                signed_headers("gone", SECRET, now(), "u", b"{}"),
                "unknown-key",
            ),
        ] {
            let payload = if case == "tampered-body" {
                "{\"different\":true}"
            } else {
                "{}"
            };
            let mut req = post(payload);
            for (name, value) in headers.iter() {
                req = req.insert_header((name.clone(), value.clone()));
            }
            let response = aw_test::call_service(&app, req.to_request()).await;
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{case}");
        }
        // Replay: identical signed request twice → the nonce is burned.
        let headers = signed_headers("k1", SECRET, now(), "replay-n", b"{}");
        for attempt in 0..2 {
            let mut req = post("{}");
            for (name, value) in headers.iter() {
                req = req.insert_header((name.clone(), value.clone()));
            }
            let response = aw_test::call_service(&app, req.to_request()).await;
            assert_eq!(
                response.status(),
                if attempt == 0 {
                    StatusCode::OK
                } else {
                    StatusCode::UNAUTHORIZED
                },
                "attempt {attempt}"
            );
        }
    }

    #[actix_web::test]
    async fn oversized_signed_body_is_a_413_not_a_silent_pass() {
        let g = gate(GateMode::Enforce);
        let app = init_gate_service(&g).await;
        let big = "x".repeat(MAX_SIGNABLE_BODY_BYTES + 1);
        let headers = signed_headers("k1", SECRET, now(), "big", big.as_bytes());
        let mut req = aw_test::TestRequest::post()
            .uri("/")
            .insert_header(("content-type", "application/json"))
            .set_payload(big);
        for (name, value) in headers.iter() {
            req = req.insert_header((name.clone(), value.clone()));
        }
        let response = aw_test::call_service(&app, req.to_request()).await;
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    /// The one env-mutating test: `ApiAuth` reads manager keys per request, so
    /// the authenticated lane needs a real env value. `env::set_var` is unsafe
    /// under edition 2024 (process-wide effect); no other test in this crate
    /// reads or writes this variable concurrently — `resolve_with` tests use a
    /// injected lookup, not the process environment.
    // The env lock must span the whole test (set → requests → restore), so the
    // guard deliberately lives across awaits.
    #[allow(clippy::await_holding_lock)]
    #[actix_web::test]
    async fn authorized_manager_bearer_passes_unsigned_under_enforce() {
        let _guard = ENV_LOCK.lock().unwrap();
        let g = gate(GateMode::Enforce);
        let app = init_gate_service(&g).await;
        let previous = env::var(REVISION_ENV).ok();
        // SAFETY: serialized by ENV_LOCK; the variable is restored before
        // the lock is released.
        unsafe { env::set_var(REVISION_ENV, "mgr-key") };
        let response = aw_test::call_service(
            &app,
            post("{}")
                .insert_header(("authorization", "Bearer mgr-key"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        // An invalid bearer earns no exemption.
        let response = aw_test::call_service(
            &app,
            post("{}")
                .insert_header(("authorization", "Bearer wrong"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        match previous {
            // SAFETY: see above.
            Some(value) => unsafe { env::set_var(REVISION_ENV, value) },
            None => unsafe { env::remove_var(REVISION_ENV) },
        }
    }

    const REVISION_ENV: &str = crate::common::auth::REVISION_API_KEY_ENV;
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    // --- nonce cache ---

    #[test]
    fn nonce_cache_replays_expire_and_evict_oldest() {
        let ttl = Duration::from_secs(60);
        let mut cache = NonceCache::new(2);
        let t0 = Instant::now();
        assert_eq!(cache.record("k", "a", ttl, t0), NonceOutcome::Fresh);
        assert_eq!(cache.record("k", "a", ttl, t0), NonceOutcome::Replayed);
        // Expired nonce can be re-recorded.
        let later = t0 + ttl + Duration::from_secs(1);
        assert_eq!(cache.record("k", "a", ttl, later), NonceOutcome::Fresh);
        // Capacity pressure evicts the oldest (a), keeping newer entries.
        assert_eq!(cache.record("k", "b", ttl, later), NonceOutcome::Fresh);
        assert_eq!(cache.record("k", "c", ttl, later), NonceOutcome::Fresh);
        assert_eq!(cache.record("k", "a", ttl, later), NonceOutcome::Fresh);
        assert_eq!(cache.record("k", "c", ttl, later), NonceOutcome::Replayed);
    }
}
