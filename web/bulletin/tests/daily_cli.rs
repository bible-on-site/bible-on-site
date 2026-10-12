//! Exercise the complete transport used by local admin previews.
use std::io::Write;
use std::process::{Command, Stdio};

use base64::{Engine, engine::general_purpose::STANDARD};

fn preview(input: &serde_json::Value) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_bulletin"))
        .arg("--daily-preview")
        .env_remove("AWS_LAMBDA_RUNTIME_API")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn local_preview_returns_complete_artifacts_and_rejects_invalid_dates() {
    let mut input = serde_json::json!({
        "date": "2026-10-08", "hebrewDate": "כז תשרי תשפז", "perekId": 1,
        "article": { "id": 7, "title": "מאמר", "author": "מחבר", "html": "<p>תוכן</p>" },
        "dedications": ["לזכרון"]
    });
    let output = preview(&input);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let artifacts: bulletin::daily::DailyArtifacts =
        serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(artifacts.source, "בראשית א");
    assert!(artifacts.subject.contains("כז תשרי תשפז"));
    assert!(artifacts.email_html.contains("<p>תוכן</p>"));
    assert!(artifacts.email_html.contains("לזכרון"));
    assert!(
        STANDARD
            .decode(artifacts.pdf_base64)
            .unwrap()
            .starts_with(b"%PDF-")
    );
    assert!(artifacts.filename.starts_with("2026-10-08-"));

    input["date"] = "2026-02-30".into();
    let invalid = preview(&input);
    assert!(!invalid.status.success());
    assert!(
        invalid.stdout.is_empty(),
        "failed previews must not return artifacts"
    );
}
