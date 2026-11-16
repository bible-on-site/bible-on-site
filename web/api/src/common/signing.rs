//! Native-app request signing primitives (issue #3066).
//!
//! The native app signs each GraphQL request with an HMAC-SHA256 over a
//! canonical string:
//!
//! ```text
//! v1\n<key-id>\n<METHOD>\n<path>\n<unix-timestamp>\n<nonce>\n<hex-sha256(body)>
//! ```
//!
//! The API verifies the signature in `startup::access_gate`. The signing key is
//! held outside this repository (CI secret → packaged app asset; env/SSM on the
//! API), never in source control. A key compiled into a distributed native app
//! is extractable by design — the signature is a hurdle against obvious
//! unauthenticated API access, not proof of an untampered app.
//!
//! Header names carry no secrets: the key-id identifies the credential cohort,
//! the signature proves (bounded) possession, and the secret itself never
//! appears on the wire or in logs.

use actix_web::http::header::HeaderMap;
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

/// Identifies which signing credential produced the request (rotation cohort).
pub const KEY_ID_HEADER: &str = "x-api-key-id";
/// Unix-seconds timestamp the client signed at (bounded by server tolerance).
pub const TIMESTAMP_HEADER: &str = "x-api-timestamp";
/// Per-request random value; combined with the timestamp it bounds replay.
pub const NONCE_HEADER: &str = "x-api-nonce";
/// Hex-encoded HMAC-SHA256 of the canonical request string.
pub const SIGNATURE_HEADER: &str = "x-api-signature";

/// Canonical-string version prefix; bump on any format change.
pub const SIGNING_VERSION: &str = "v1";

const SIGNATURE_HEADERS: &[&str] = &[
    KEY_ID_HEADER,
    TIMESTAMP_HEADER,
    NONCE_HEADER,
    SIGNATURE_HEADER,
];

/// Parsed and structurally-validated signature headers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignatureHeaders {
    pub key_id: String,
    pub timestamp: i64,
    pub nonce: String,
    /// Hex-encoded expected HMAC, exactly as sent on the wire.
    pub signature: String,
}

/// Outcome of reading the `x-api-*` headers off a request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignatureHeaderParse {
    /// No signature header at all — an ordinary unsigned request.
    Absent,
    /// Some signature headers present but incomplete or malformed — the
    /// request is treated as unsigned (no body read is wasted on it).
    Malformed,
    /// All four headers present and structurally valid.
    Present(SignatureHeaders),
}

/// Reads the `x-api-*` signature headers. Header values must be non-empty and
/// the timestamp must parse as an integer; anything else is `Malformed`.
pub fn parse_signature_headers(headers: &HeaderMap) -> SignatureHeaderParse {
    if !SIGNATURE_HEADERS
        .iter()
        .any(|name| headers.contains_key(*name))
    {
        return SignatureHeaderParse::Absent;
    }
    let text = |name: &str| -> Option<String> {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let (Some(key_id), Some(timestamp), Some(nonce), Some(signature)) = (
        text(KEY_ID_HEADER),
        text(TIMESTAMP_HEADER),
        text(NONCE_HEADER),
        text(SIGNATURE_HEADER),
    ) else {
        return SignatureHeaderParse::Malformed;
    };
    let Ok(timestamp) = timestamp.parse::<i64>() else {
        return SignatureHeaderParse::Malformed;
    };
    SignatureHeaderParse::Present(SignatureHeaders {
        key_id,
        timestamp,
        nonce,
        signature,
    })
}

/// Lowercase-hex SHA-256 of the exact request-body bytes on the wire.
pub fn body_sha256_hex(body: &[u8]) -> String {
    hex::encode(Sha256::digest(body))
}

/// Builds the canonical string the HMAC covers. `\n`-joined fields in a fixed
/// order; the version prefix reserves room for a future format bump.
pub fn canonical_v1(
    key_id: &str,
    method: &str,
    path: &str,
    timestamp: i64,
    nonce: &str,
    body_sha256_hex: &str,
) -> String {
    [
        SIGNING_VERSION,
        key_id,
        method,
        path,
        &timestamp.to_string(),
        nonce,
        body_sha256_hex,
    ]
    .join("\n")
}

/// Whether `timestamp` is within `±tolerance_secs` of `now_unix`, absorbing
/// device clock skew while bounding the replay window.
pub fn timestamp_fresh(now_unix: i64, timestamp: i64, tolerance_secs: i64) -> bool {
    timestamp.abs_diff(now_unix) <= tolerance_secs.unsigned_abs()
}

/// Verifies `expected_signature_hex` against HMAC-SHA256(`secret`, `canonical`).
/// `verify_slice` compares in constant time, so a wrong signature leaks no
/// partial-match signal. Hex-decode failures are just mismatches.
pub fn verify_signature(secret: &[u8], canonical: &str, expected_signature_hex: &str) -> bool {
    let Ok(expected) = hex::decode(expected_signature_hex) else {
        return false;
    };
    let Ok(mut mac) = <Hmac<Sha256> as KeyInit>::new_from_slice(secret) else {
        return false;
    };
    mac.update(canonical.as_bytes());
    mac.verify_slice(&expected).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::{HeaderName, HeaderValue};

    /// Cross-language golden vector: the same inputs must produce this
    /// signature in the app's `ApiSigningHandler` (HMAC-SHA256, UTF-8 secret).
    pub(crate) const GOLDEN_SECRET: &str = "poc-secret-do-not-use-in-prod";
    pub(crate) const GOLDEN_KEY_ID: &str = "poc-key-1";
    pub(crate) const GOLDEN_TIMESTAMP: i64 = 1_770_000_000;
    pub(crate) const GOLDEN_NONCE: &str = "01ab23cd45ef";
    pub(crate) const GOLDEN_BODY: &str = r#"{"query":"{ starter { generatedAt } }"}"#;
    pub(crate) const GOLDEN_SIGNATURE: &str =
        "2aa0b630b4708872da3f898c176abf9bc577ac0e351565443816cd7a37fd2201";

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                HeaderName::try_from(*name).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    #[test]
    fn golden_vector_matches_the_app_canonicalization() {
        let body_sha = body_sha256_hex(GOLDEN_BODY.as_bytes());
        assert_eq!(
            body_sha,
            "4a3a5e8d9eacedde96151c445516b05e42bc909fdd9e8ba6d6a6fe10aefa3896"
        );
        let canonical = canonical_v1(
            GOLDEN_KEY_ID,
            "POST",
            "/",
            GOLDEN_TIMESTAMP,
            GOLDEN_NONCE,
            &body_sha,
        );
        assert_eq!(
            canonical,
            "v1\npoc-key-1\nPOST\n/\n1770000000\n01ab23cd45ef\n\
             4a3a5e8d9eacedde96151c445516b05e42bc909fdd9e8ba6d6a6fe10aefa3896"
        );
        assert!(verify_signature(
            GOLDEN_SECRET.as_bytes(),
            &canonical,
            GOLDEN_SIGNATURE
        ));
    }

    #[test]
    fn parse_absent_when_no_signature_headers_exist() {
        assert_eq!(
            parse_signature_headers(&headers(&[("content-type", "application/json")])),
            SignatureHeaderParse::Absent
        );
    }

    #[test]
    fn parse_malformed_on_partial_or_invalid_headers() {
        for pairs in [
            // Only some headers present.
            &[("x-api-key-id", "k1")][..],
            &[
                ("x-api-key-id", "k1"),
                ("x-api-timestamp", "1770000000"),
                ("x-api-nonce", "n"),
            ][..],
            // Empty values count as malformed.
            &[
                ("x-api-key-id", "k1"),
                ("x-api-timestamp", ""),
                ("x-api-nonce", "n"),
                ("x-api-signature", "ab"),
            ][..],
            // Non-integer timestamp.
            &[
                ("x-api-key-id", "k1"),
                ("x-api-timestamp", "soon"),
                ("x-api-nonce", "n"),
                ("x-api-signature", "ab"),
            ][..],
        ] {
            assert_eq!(
                parse_signature_headers(&headers(pairs)),
                SignatureHeaderParse::Malformed,
                "{pairs:?}"
            );
        }
    }

    #[test]
    fn parse_present_reads_all_fields() {
        let map = headers(&[
            ("x-api-key-id", " k1 "),
            ("x-api-timestamp", "1770000000"),
            ("x-api-nonce", "nonce-1"),
            ("x-api-signature", "deadbeef"),
        ]);
        assert_eq!(
            parse_signature_headers(&map),
            SignatureHeaderParse::Present(SignatureHeaders {
                key_id: "k1".to_string(),
                timestamp: 1_770_000_000,
                nonce: "nonce-1".to_string(),
                signature: "deadbeef".to_string(),
            })
        );
    }

    #[test]
    fn timestamp_freshness_honors_the_tolerance_window() {
        assert!(timestamp_fresh(1_000, 1_300, 300));
        assert!(timestamp_fresh(1_000, 700, 300));
        assert!(!timestamp_fresh(1_000, 1_301, 300));
        assert!(!timestamp_fresh(1_000, 699, 300));
    }

    #[test]
    fn verify_signature_rejects_wrong_key_and_bad_hex() {
        let canonical = canonical_v1("k1", "POST", "/", 1, "n", "x");
        assert!(!verify_signature(
            b"other-secret",
            &canonical,
            GOLDEN_SIGNATURE
        ));
        assert!(!verify_signature(
            GOLDEN_SECRET.as_bytes(),
            &canonical,
            "not-hex!"
        ));
        // Odd-length / truncated hex never matches.
        assert!(!verify_signature(
            GOLDEN_SECRET.as_bytes(),
            &canonical,
            &GOLDEN_SIGNATURE[..GOLDEN_SIGNATURE.len() - 1]
        ));
    }
}
