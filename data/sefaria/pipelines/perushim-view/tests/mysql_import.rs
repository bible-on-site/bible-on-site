//! Exercise real generated SQL through both production Lambda parser paths on MySQL.
#![cfg(feature = "integration")]

use std::process::Command;

use perushim_view::{
    commands::mysql,
    data::extract::{Extracted, Note, Parshan, Perush},
};

#[test]
fn generated_import_preserves_live_identity_through_actual_lambda() {
    assert!(
        std::env::var("MYSQL_IMPORT_TEST_DB_URL").is_ok(),
        "Set MYSQL_IMPORT_TEST_DB_URL to a local MySQL server; the harness creates disposable databases"
    );
    let authors = [
        (1, "רש\"י", 1040),
        (2, "Other author", 1100),
        (3, "New author", 1500),
    ];
    let works = [
        (85, "רש\"י", 1),
        (84, "Other work", 2),
        (105, "New work", 3),
    ];
    let notes = [
        (85, 1, 1, "fresh Rashi; quoted 'text'"),
        (85, 1, 2, "fresh second verse"),
        (85, 3, 1, "common removal chapter"),
        (85, 4, 1, "common addition chapter"),
        (85, 4, 2, "added note"),
        (84, 3, 1, "fresh Other"),
        (105, 1, 1, "fresh New"),
    ];
    let extracted = Extracted {
        parshanim: authors
            .into_iter()
            .map(|(id, name, birth_year)| Parshan {
                id,
                name: name.into(),
                birth_year: Some(birth_year),
                has_pic: true,
            })
            .collect(),
        perushim: works
            .into_iter()
            .map(|(id, name, parshan_id)| Perush {
                id,
                name: name.into(),
                parshan_id,
                comp_date: Some("[1000, 1500]".into()),
                pub_date: None,
                priority: 100,
            })
            .collect(),
        notes: notes
            .into_iter()
            .map(|(perush_id, perek_id, pasuk, note_content)| Note {
                perush_id,
                perek_id,
                pasuk,
                note_idx: 1,
                note_content: note_content.into(),
            })
            .collect(),
    };
    let temporary = tempfile::tempdir().unwrap();
    let sql_path = temporary.path().join("generated.sql");
    mysql::generate_sql(&sql_path, &extracted, "mysql-import-regression").unwrap();
    let mut bad_author = Extracted {
        parshanim: extracted.parshanim.clone(),
        perushim: extracted.perushim.clone(),
        notes: extracted.notes.clone(),
    };
    bad_author.perushim[0].parshan_id = 9999;
    let bad_author_path = temporary.path().join("missing-author.sql");
    mysql::generate_sql(&bad_author_path, &bad_author, "missing-author-regression").unwrap();
    let mut bad_note = Extracted {
        parshanim: extracted.parshanim.clone(),
        perushim: extracted.perushim.clone(),
        notes: extracted.notes.clone(),
    };
    bad_note.notes[0].perush_id = 9999;
    let bad_note_path = temporary.path().join("missing-note-work.sql");
    mysql::generate_sql(&bad_note_path, &bad_note, "missing-note-work-regression").unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .unwrap();
    let python = std::env::var("MYSQL_IMPORT_TEST_PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into());
    let result = Command::new(python)
        .env("PYTHONIOENCODING", "utf-8")
        .arg("-B")
        .arg(root.join("devops/deploy/data-deploy/mysql_import_regression.py"))
        .arg("--sql")
        .arg(sql_path)
        .arg("--bad-author-sql")
        .arg(bad_author_path)
        .arg("--bad-note-sql")
        .arg(bad_note_path)
        .output()
        .expect(
            "Python with PyMySQL must be available for the required MySQL integration regression",
        );
    assert!(
        result.status.success(),
        "Actual Lambda/MySQL import regression failed:\n{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr),
    );
    println!("{}", String::from_utf8_lossy(&result.stderr));
}
