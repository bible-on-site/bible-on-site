//! CLI entry point for perushim-view pipeline.

use anyhow::{Context, Result};
use bson::Document;
use clap::{Parser, ValueEnum};
use mongodb::{Client, options::ClientOptions};

use perushim_view::{aggregation, commands, data};

#[derive(Parser)]
#[command(name = "perushim-view")]
#[command(about = "Generate perushim (commentaries) view from MongoDB Sefaria data")]
struct Cli {
    /// Output format
    #[arg(long, value_enum)]
    format: Option<OutputFormat>,

    /// Dump name (e.g., sefaria-dump-5784-sivan-4)
    #[arg(long, default_value = "sefaria-dump-5784-sivan-4")]
    dump_name: String,

    /// Output to dependent modules (app/ for SQLite, web/ for JSON, data/mysql for MySQL)
    #[arg(long)]
    output_to_dependant_modules: bool,

    /// Input v1 notes SQLite (convert-notes) or v2 notes SQLite (search-index)
    #[arg(long)]
    input: Option<std::path::PathBuf>,

    /// Output file (convert-notes: v2 notes SQLite; search-index: index SQLite)
    #[arg(long)]
    output: Option<std::path::PathBuf>,

    /// tanah_view SQLite the search index reads verses and sefer ranges from
    /// (sqlite + search-index formats)
    #[arg(long, default_value_os_t = default_tanah_view())]
    tanah_view: std::path::PathBuf,
}

fn default_tanah_view() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
        "../../../../app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite",
    )
}

#[derive(Clone, ValueEnum)]
enum OutputFormat {
    /// Generate JSON files for parshan + perush (web static data)
    Json,
    /// Generate MySQL SQL for notes + catalog (web backend)
    Mysql,
    /// Generate SQLite: catalog (bundled) + notes (PAD/on-demand)
    Sqlite,
    /// Generate MongoDB Compass stages for debugging
    CompassStages,
    /// Convert a v1 notes SQLite to the v2 blob schema (no MongoDB needed)
    ConvertNotes,
    /// Build the delivered FTS5 search index from a v2 notes SQLite + tanah_view
    /// (no MongoDB needed)
    SearchIndex,
    /// Add/refresh the shared reading-metrics tables inside an existing v2
    /// notes SQLite (no MongoDB needed) — issue #2607
    NoteMetrics,
}

#[tokio::main]
async fn main() -> Result<()> {
    run(Cli::parse()).await
}

/// Runs the CLI after parsing — separated from `main` so the non-MongoDB
/// dispatches can be exercised by unit tests.
async fn run(cli: Cli) -> Result<()> {
    // Handle compass-stages format separately (no MongoDB connection needed)
    if matches!(cli.format, Some(OutputFormat::CompassStages)) {
        return commands::compass_stages::generate();
    }

    // convert-notes reads an existing notes DB — no MongoDB needed either
    if matches!(cli.format, Some(OutputFormat::ConvertNotes)) {
        let input = cli
            .input
            .context("--input <v1.sqlite> is required for convert-notes")?;
        let output = cli
            .output
            .context("--output <v2.sqlite> is required for convert-notes")?;
        return commands::convert_notes::generate(&input, &output);
    }

    // search-index rebuilds the delivered index from existing DBs — no MongoDB
    if matches!(cli.format, Some(OutputFormat::SearchIndex)) {
        let input = cli
            .input
            .context("--input <v2 notes.sqlite> is required for search-index")?;
        let output = cli
            .output
            .context("--output <hebrew_search.sqlite> is required for search-index")?;
        return commands::search_index::build_search_index(&input, &cli.tanah_view, &output);
    }

    // note-metrics decorates an existing v2 notes DB in place — no MongoDB
    if matches!(cli.format, Some(OutputFormat::NoteMetrics)) {
        let input = cli
            .input
            .context("--input <v2 notes.sqlite> is required for note-metrics")?;
        return commands::note_metrics::apply(&input);
    }

    let format = cli
        .format
        .as_ref()
        .context("--format is required for json/mysql/sqlite output")?;

    let results = fetch_from_mongodb(&cli.dump_name).await?;
    generate_output(format, &data::extract::extract(&results), &cli)
}

/// Writes the MongoDB extraction results in the requested format — kept
/// separate from `run` so tests can dispatch without a live database.
fn generate_output(
    format: &OutputFormat,
    extracted: &data::extract::Extracted,
    cli: &Cli,
) -> Result<()> {
    println!("📊 Extracting parshanim, perushim, and notes...");
    println!(
        "   {} parshanim, {} perushim, {} notes",
        extracted.parshanim.len(),
        extracted.perushim.len(),
        extracted.notes.len()
    );

    match format {
        OutputFormat::Json => {
            commands::json::generate(extracted, &cli.dump_name, cli.output_to_dependant_modules)?;
        }
        OutputFormat::Mysql => {
            commands::mysql::generate(extracted, &cli.dump_name, cli.output_to_dependant_modules)?;
        }
        OutputFormat::Sqlite => {
            commands::sqlite::generate(
                extracted,
                &cli.dump_name,
                cli.output_to_dependant_modules,
                &cli.tanah_view,
            )?;
        }
        OutputFormat::CompassStages
        | OutputFormat::ConvertNotes
        | OutputFormat::SearchIndex
        | OutputFormat::NoteMetrics => {
            unreachable!("Handled above")
        }
    }

    Ok(())
}

async fn fetch_from_mongodb(dump_name: &str) -> Result<Vec<Document>> {
    // Load environment variables
    dotenvy::from_path("../../setup-and-population/.env").ok();
    dotenvy::dotenv().ok();

    let (mongo_host, mongo_port) = mongo_host_port_from_env();

    println!(
        "🔗 Connecting to MongoDB at {}:{}...",
        mongo_host, mongo_port
    );

    let client_options = ClientOptions::parse(mongodb_uri(&mongo_host, &mongo_port))
        .await
        .context("Failed to parse MongoDB connection string")?;

    let client = Client::with_options(client_options)?;
    let db = client.database(dump_name);

    println!("📊 Running perushim aggregation pipeline...");

    let pipeline = aggregation::build_pipeline();

    // Run the aggregation against the `index` collection
    let collection = db.collection::<Document>("index");
    let mut cursor = collection.aggregate(pipeline).await?;

    let mut results: Vec<Document> = Vec::new();
    while cursor.advance().await? {
        let doc = cursor.deserialize_current()?;
        results.push(doc);
    }

    println!("✅ Retrieved {} pipeline documents", results.len());

    Ok(results)
}

fn mongo_host_port_from_env() -> (String, String) {
    mongo_host_port_from_vars(|key| std::env::var(key).ok())
}

fn mongo_host_port_from_vars(mut get_var: impl FnMut(&str) -> Option<String>) -> (String, String) {
    (
        get_var("MONGO_HOST").unwrap_or_else(|| "localhost".to_string()),
        get_var("MONGO_PORT").unwrap_or_else(|| "27017".to_string()),
    )
}

fn mongodb_uri(mongo_host: &str, mongo_port: &str) -> String {
    format!("mongodb://{}:{}", mongo_host, mongo_port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, Parser};
    use std::path::Path;

    fn cli_from(args: &[&str]) -> Cli {
        let mut argv = vec!["perushim-view"];
        argv.extend_from_slice(args);
        Cli::parse_from(argv)
    }

    #[test]
    fn cli_defaults_dump_name_and_requires_no_format_at_parse_time() {
        let cli = cli_from(&[]);

        assert!(cli.format.is_none());
        assert_eq!(cli.dump_name, "sefaria-dump-5784-sivan-4");
        assert!(!cli.output_to_dependant_modules);
    }

    #[test]
    fn cli_accepts_all_output_formats_and_dependant_output_flag() {
        let json = cli_from(&["--format", "json", "--output-to-dependant-modules"]);
        assert!(matches!(json.format, Some(OutputFormat::Json)));
        assert!(json.output_to_dependant_modules);

        let mysql = cli_from(&["--format", "mysql"]);
        assert!(matches!(mysql.format, Some(OutputFormat::Mysql)));

        let sqlite = cli_from(&["--format", "sqlite"]);
        assert!(matches!(sqlite.format, Some(OutputFormat::Sqlite)));

        let compass = cli_from(&["--format", "compass-stages"]);
        assert!(matches!(compass.format, Some(OutputFormat::CompassStages)));
    }

    #[test]
    fn cli_allows_dump_name_override() {
        let cli = cli_from(&["--dump-name", "sefaria-dump-custom"]);

        assert_eq!(cli.dump_name, "sefaria-dump-custom");
    }

    #[test]
    fn clap_metadata_matches_binary_contract() {
        let command = Cli::command();

        assert_eq!(command.get_name(), "perushim-view");
        assert_eq!(
            command.get_about().map(|about| about.to_string()),
            Some("Generate perushim (commentaries) view from MongoDB Sefaria data".to_string())
        );
    }

    #[test]
    fn cli_parses_input_output_and_tanah_view_overrides() {
        let cli = cli_from(&[
            "--format",
            "convert-notes",
            "--input",
            "in.sqlite",
            "--output",
            "out.sqlite",
            "--tanah-view",
            "tanah.sqlite",
        ]);

        assert!(matches!(cli.format, Some(OutputFormat::ConvertNotes)));
        assert_eq!(
            cli.input.as_deref(),
            Some(std::path::Path::new("in.sqlite"))
        );
        assert_eq!(
            cli.output.as_deref(),
            Some(std::path::Path::new("out.sqlite"))
        );
        assert_eq!(cli.tanah_view, std::path::Path::new("tanah.sqlite"));
    }

    #[test]
    fn cli_defaults_tanah_view_to_the_committed_app_db() {
        let cli = cli_from(&[]);

        assert!(
            cli.tanah_view
                .ends_with("sefaria-dump-5784-sivan-4.tanah_view.sqlite"),
            "unexpected default: {:?}",
            cli.tanah_view
        );
    }

    #[tokio::test]
    async fn run_convert_notes_requires_input_and_output() {
        let missing_both = run(cli_from(&["--format", "convert-notes"])).await;
        assert!(
            missing_both
                .unwrap_err()
                .to_string()
                .contains("--input <v1.sqlite> is required")
        );

        let missing_output = run(cli_from(&[
            "--format",
            "convert-notes",
            "--input",
            "in.sqlite",
        ]))
        .await;
        assert!(
            missing_output
                .unwrap_err()
                .to_string()
                .contains("--output <v2.sqlite> is required")
        );
    }

    #[tokio::test]
    async fn run_convert_notes_executes_end_to_end() {
        let dir = tempfile::Builder::new()
            .prefix("perushim_main_convert_")
            .tempdir()
            .unwrap()
            .keep();
        let input = dir.join("v1.sqlite");
        let output = dir.join("v2.sqlite");
        let conn = rusqlite::Connection::open(&input).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, \
                note_idx INTEGER, note_content TEXT);
             INSERT INTO _metadata VALUES ('build_timestamp','7');
             INSERT INTO note VALUES (5, 1, 1, 0, 'a note');",
        )
        .unwrap();
        conn.close().unwrap();

        run(cli_from(&[
            "--format",
            "convert-notes",
            "--input",
            input.to_str().unwrap(),
            "--output",
            output.to_str().unwrap(),
        ]))
        .await
        .unwrap();

        let converted = rusqlite::Connection::open(&output).unwrap();
        let version: String = converted
            .query_row(
                "SELECT value FROM _metadata WHERE key='schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, "2");
        converted.close().unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn run_search_index_requires_input_and_output() {
        let missing_both = run(cli_from(&["--format", "search-index"])).await;
        assert!(
            missing_both
                .unwrap_err()
                .to_string()
                .contains("--input <v2 notes.sqlite> is required")
        );

        let missing_output = run(cli_from(&[
            "--format",
            "search-index",
            "--input",
            "in.sqlite",
        ]))
        .await;
        assert!(
            missing_output
                .unwrap_err()
                .to_string()
                .contains("--output <hebrew_search.sqlite> is required")
        );
    }

    #[tokio::test]
    async fn run_search_index_rejects_a_v1_notes_db() {
        let dir = tempfile::Builder::new()
            .prefix("perushim_main_search_index_")
            .tempdir()
            .unwrap()
            .keep();
        let input = dir.join("v1.sqlite");
        let conn = rusqlite::Connection::open(&input).unwrap();
        conn.execute_batch("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        conn.close().unwrap();

        let err = run(cli_from(&[
            "--format",
            "search-index",
            "--input",
            input.to_str().unwrap(),
            "--output",
            dir.join("search.sqlite").to_str().unwrap(),
        ]))
        .await
        .unwrap_err();
        assert!(err.to_string().contains("v2 notes DB"), "unexpected: {err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn run_note_metrics_requires_input() {
        let err = run(cli_from(&["--format", "note-metrics"])).await;

        assert!(
            err.unwrap_err()
                .to_string()
                .contains("--input <v2 notes.sqlite> is required")
        );
    }

    #[tokio::test]
    async fn run_note_metrics_executes_end_to_end() {
        let dir = tempfile::Builder::new()
            .prefix("perushim_main_note_metrics_")
            .tempdir()
            .unwrap()
            .keep();
        let input = dir.join("notes.sqlite");
        let conn = rusqlite::Connection::open(&input).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE note_blob (perek_id INTEGER PRIMARY KEY, data BLOB NOT NULL);
             INSERT INTO _metadata VALUES ('schema_version','2');",
        )
        .unwrap();
        let note = data::extract::Note {
            perush_id: 1,
            perek_id: 1,
            pasuk: 1,
            note_idx: 0,
            note_content: "בראשית - בשביל התורה".into(),
        };
        let blob = commands::note_blob::encode_perek_blob(&[&note]).unwrap();
        conn.execute(
            "INSERT INTO note_blob VALUES (1, ?1)",
            rusqlite::params![blob],
        )
        .unwrap();
        conn.close().unwrap();

        run(cli_from(&[
            "--format",
            "note-metrics",
            "--input",
            input.to_str().unwrap(),
        ]))
        .await
        .unwrap();

        let decorated = rusqlite::Connection::open(&input).unwrap();
        let rows: i64 = decorated
            .query_row("SELECT COUNT(*) FROM tanah_perush_metric", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "the dispatch must backfill the metric tables");
        decorated.close().unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn run_without_format_fails_before_mongodb() {
        let err = run(cli_from(&[])).await.unwrap_err();
        assert!(err.to_string().contains("--format is required"));
    }

    #[tokio::test]
    async fn run_dispatches_compass_stages_without_mongodb() {
        // compass-stages never touches MongoDB, so `run` completes offline.
        run(cli_from(&["--format", "compass-stages"]))
            .await
            .unwrap();

        let stages_dir =
            Path::new(env!("CARGO_MANIFEST_DIR")).join(".output/mongodb-compass-stages");
        assert!(
            stages_dir
                .read_dir()
                .map(|mut d| d.next().is_some())
                .unwrap_or(false),
            "compass stage files should be generated"
        );
        std::fs::remove_dir_all(&stages_dir).ok();
    }

    /// Minimal entities for `generate_output` dispatch tests — the writes land
    /// under `.output/` next to the crate and are removed by unique dump name.
    fn extracted_fixture() -> data::extract::Extracted {
        data::extract::Extracted {
            parshanim: vec![data::extract::Parshan {
                id: 1,
                name: "רש\"י".into(),
                birth_year: Some(1040),
                has_pic: false,
            }],
            perushim: vec![data::extract::Perush {
                id: 1,
                name: "רש\"י על התורה".into(),
                parshan_id: 1,
                comp_date: None,
                pub_date: None,
                priority: 100,
            }],
            notes: vec![data::extract::Note {
                perush_id: 1,
                perek_id: 1,
                pasuk: 1,
                note_idx: 0,
                note_content: "בראשית - בשביל התורה".into(),
            }],
        }
    }

    fn cleanup_output(dump: &str, suffixes: &[&str]) {
        let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        for suffix in suffixes {
            let path = out_dir.join(format!("{dump}.{suffix}"));
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::remove_file(path.with_extension("sqlite.gz"));
        }
    }

    #[test]
    fn generate_output_writes_json_and_mysql_payloads() {
        let extracted = extracted_fixture();
        let dump = format!("main-dispatch-test-{}", std::process::id());
        cleanup_output(
            &dump,
            &[
                "parshanim.json",
                "perushim.json",
                "perush-names.ts",
                "perushim_data.sql",
            ],
        );

        let json_cli = cli_from(&["--format", "json", "--dump-name", &dump]);
        generate_output(&OutputFormat::Json, &extracted, &json_cli).unwrap();
        let mysql_cli = cli_from(&["--format", "mysql", "--dump-name", &dump]);
        generate_output(&OutputFormat::Mysql, &extracted, &mysql_cli).unwrap();

        let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        for suffix in [
            "parshanim.json",
            "perushim.json",
            "perush-names.ts",
            "perushim_data.sql",
        ] {
            assert!(
                out_dir.join(format!("{dump}.{suffix}")).exists(),
                "missing {dump}.{suffix}"
            );
        }
        cleanup_output(
            &dump,
            &[
                "parshanim.json",
                "perushim.json",
                "perush-names.ts",
                "perushim_data.sql",
            ],
        );
    }

    #[test]
    fn generate_output_writes_sqlite_payloads_against_tanah_view() {
        let dir = tempfile::Builder::new()
            .prefix("perushim_main_sqlite_")
            .tempdir()
            .unwrap()
            .keep();
        let tanah = dir.join("tanah.sqlite");
        let conn = rusqlite::Connection::open(&tanah).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO _metadata VALUES ('generated_at', '2026');
             CREATE TABLE tanah_sefer (id INTEGER PRIMARY KEY, name TEXT, \
                perek_id_from INTEGER, perek_id_to INTEGER);
             INSERT INTO tanah_sefer VALUES (1, 'בראשית', 1, 50);
             CREATE TABLE tanah_pasuk_segment (id INTEGER PRIMARY KEY, perek_id INTEGER, \
                pasuk_id INTEGER, segment_type TEXT);
             CREATE TABLE tanah_pasuk_segment_value (id INTEGER, value TEXT);
             INSERT INTO tanah_pasuk_segment VALUES (1, 1, 1, 'qri');
             INSERT INTO tanah_pasuk_segment_value VALUES (1, 'בראשית ברא');",
        )
        .unwrap();
        conn.close().unwrap();

        let dump = format!("main-sqlite-test-{}", std::process::id());
        let suffixes = [
            "perushim_catalog.sqlite",
            "perushim_notes.sqlite",
            "hebrew_search.sqlite",
        ];
        cleanup_output(&dump, &suffixes);

        let cli = cli_from(&[
            "--format",
            "sqlite",
            "--dump-name",
            &dump,
            "--tanah-view",
            tanah.to_str().unwrap(),
        ]);
        generate_output(&OutputFormat::Sqlite, &extracted_fixture(), &cli).unwrap();

        let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        for suffix in suffixes {
            assert!(
                out_dir.join(format!("{dump}.{suffix}")).exists(),
                "missing {dump}.{suffix}"
            );
        }
        cleanup_output(&dump, &suffixes);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[should_panic(expected = "Handled above")]
    fn generate_output_rejects_non_mongo_formats() {
        let cli = cli_from(&["--format", "convert-notes"]);
        let _ = generate_output(&OutputFormat::ConvertNotes, &extracted_fixture(), &cli);
    }

    #[test]
    fn mongo_host_port_and_uri_use_defaults_and_overrides() {
        assert_eq!(
            mongo_host_port_from_vars(|_| None),
            ("localhost".to_string(), "27017".to_string())
        );
        let vars = |key: &str| match key {
            "MONGO_HOST" => Some("mongo".to_string()),
            "MONGO_PORT" => Some("28017".to_string()),
            _ => None,
        };
        assert_eq!(
            mongo_host_port_from_vars(vars),
            ("mongo".to_string(), "28017".to_string())
        );
        assert_eq!(vars("UNRELATED"), None);
        assert_eq!(mongodb_uri("mongo", "28017"), "mongodb://mongo:28017");
    }
}
