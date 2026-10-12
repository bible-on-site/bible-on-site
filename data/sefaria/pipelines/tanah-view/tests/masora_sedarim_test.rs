//! Parity test for the sedarim verification (issue #2187).
//!
//! The Tanach Yomi sedarim reference (fixtures/masora-sedarim-
//! tanachyomi.json) lists the first pasuk of every Masoretic seder in
//! Neviim and Ketuvim. `verify` classifies every listed head against
//! the ptuha/stuma-derived מסורה units and runs the integrity checks.
//! The outcome is pinned by a checked-in expected snapshot so that
//! corpus or fixture changes cannot silently change the result —
//! regenerate it deliberately with `cargo make verify-masora-sedarim`.

use std::path::Path;
use tanah_view::masora_sedarim::{self, Disposition, SedarimVerification, SederAlignment};
use tanah_view::models::Sefer;

fn manifest_path(rel: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)
}

fn corpus() -> Vec<Sefer> {
    let path = manifest_path(
        "../../../../web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
    );
    let json =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&json).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

fn reference() -> masora_sedarim::SedarimReference {
    masora_sedarim::load_reference(&manifest_path("fixtures/masora-sedarim-tanachyomi.json"))
        .expect("sedarim reference fixture must parse")
}

fn verified() -> SedarimVerification {
    masora_sedarim::verify(&corpus(), &reference(), "sefaria-dump-5784-sivan-4")
        .expect("sedarim verification must run")
}

#[test]
fn reference_fixture_parses_and_matches_provenance() {
    let reference = reference();
    assert_eq!(reference.provenance.pages, 1);
    assert_eq!(
        reference.provenance.sha256,
        "c958940c28ea85bd41ed0ea3484f1ca0af5346b4e13edf204e1270994482d7dd"
    );
    assert_eq!(reference.groups.len(), 19);
    // Group order is canonical N"K order, matching corpus order.
    let expected_groups = [
        "יהושע",
        "שופטים",
        "שמואל",
        "מלכים",
        "ישעיהו",
        "ירמיהו",
        "יחזקאל",
        "תרי עשר",
        "תהלים",
        "משלי",
        "איוב",
        "שיר השירים",
        "רות",
        "איכה",
        "קהלת",
        "אסתר",
        "דניאל",
        "עזרא נחמיה",
        "דברי הימים",
    ];
    let actual: Vec<&str> = reference.groups.iter().map(|g| g.book.as_str()).collect();
    assert_eq!(actual, expected_groups);
}

#[test]
fn all_verification_checks_pass() {
    let v = verified();
    let failed: Vec<_> = v.checks.iter().filter(|c| c.status == "fail").collect();
    assert!(
        failed.is_empty(),
        "verification checks failed: {:?}",
        failed.iter().map(|c| &c.name).collect::<Vec<_>>()
    );
}

#[test]
fn alignment_counts_match_the_verified_baseline() {
    let s = verified().summary;
    // Verified baseline (issue #2187): seder heads mostly do NOT sit
    // on parasha boundaries — the two systems differ by design.
    assert_eq!(s.total, 297);
    assert_eq!(s.regular, 293);
    assert_eq!(s.parenthesized, 4);
    assert_eq!(s.parasha_boundary, 66);
    assert_eq!(s.mid_pasuk_boundary, 1);
    assert_eq!(s.parasha_last_pasuk, 92);
    assert_eq!(s.interior_of_parasha, 138);
    assert_eq!(s.unresolved, 0);
    assert_eq!(s.corpus_units, 3197);
}

#[test]
fn the_only_mid_pasuk_boundary_is_yechezkel_43_27() {
    let v = verified();
    let mid: Vec<_> = v
        .sedarim
        .iter()
        .filter(|e| matches!(e.alignment, SederAlignment::MidPasukBoundary { .. }))
        .collect();
    assert_eq!(mid.len(), 1);
    assert_eq!(mid[0].reference, "יחזקאל מג כז");
}

#[test]
fn documented_mid_parasha_heads_keep_their_dispositions() {
    let v = verified();
    // Documented mid-parasha seder heads (חלוקת התנ"ך לסדרים, Hebrew
    // Wikipedia) — expected system difference, not a corpus defect.
    let documented = [
        ("יהושע", "יב"),
        ("שמואל", "ו"),
        ("מלכים", "ד"),
        ("מלכים", "לג"),
        ("ירמיהו", "יב"),
        ("ירמיהו", "כ"),
        ("דברי הימים", "ג"),
    ];
    for (book, seder) in documented {
        let entry = v
            .sedarim
            .iter()
            .find(|e| e.book == book && e.seder == seder)
            .unwrap_or_else(|| panic!("missing entry {book} {seder}"));
        assert_eq!(
            entry.disposition,
            Disposition::DocumentedSystemDifference,
            "{book} {seder}"
        );
    }
    // שמואל סדר ג is documented as the second pasuk of a two-pasuk
    // parasha; the corpus parasha has three — an edition divergence.
    let shmuel_g = v
        .sedarim
        .iter()
        .find(|e| e.book == "שמואל" && e.seder == "ג")
        .expect("missing entry שמואל ג");
    assert!(
        matches!(shmuel_g.disposition, Disposition::EditionDivergence { .. }),
        "שמואל ג disposition is {:?}",
        shmuel_g.disposition
    );
}

#[test]
fn verification_outcome_matches_the_checked_in_snapshot() {
    let computed = verified();
    let expected: SedarimVerification = serde_json::from_str(
        &std::fs::read_to_string(manifest_path(
            "fixtures/masora-sedarim-verification.expected.json",
        ))
        .expect("expected snapshot must exist — run cargo make verify-masora-sedarim"),
    )
    .expect("expected snapshot must parse");
    assert_eq!(
        computed, expected,
        "sedarim verification drifted — regenerate the snapshot with \
         cargo make verify-masora-sedarim and review the diff deliberately"
    );
}

#[test]
fn committed_report_matches_the_expected_snapshot() {
    let expected: SedarimVerification = serde_json::from_str(
        &std::fs::read_to_string(manifest_path(
            "fixtures/masora-sedarim-verification.expected.json",
        ))
        .expect("expected snapshot must exist — run cargo make verify-masora-sedarim"),
    )
    .expect("expected snapshot must parse");
    let committed = std::fs::read_to_string(manifest_path(
        "../../../../docs/data/masora-sedarim-verification.md",
    ))
    .expect("committed report must exist — run cargo make verify-masora-sedarim");
    assert_eq!(
        tanah_view::commands::sedarim_report::render_markdown(&expected),
        committed,
        "the committed report is stale — regenerate it with \
         cargo make verify-masora-sedarim"
    );
}
