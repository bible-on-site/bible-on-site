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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Handle compass-stages format separately (no MongoDB connection needed)
    if matches!(cli.format, Some(OutputFormat::CompassStages)) {
        return commands::compass_stages::generate();
    }

    let format = cli
        .format
        .context("--format is required for json/mysql/sqlite output")?;

    let results = fetch_from_mongodb(&cli.dump_name).await?;

    // Extract entities from pipeline output
    println!("📊 Extracting parshanim, perushim, and notes...");
    let extracted = data::extract::extract(&results);
    println!(
        "   {} parshanim, {} perushim, {} notes",
        extracted.parshanim.len(),
        extracted.perushim.len(),
        extracted.notes.len()
    );

    match format {
        OutputFormat::Json => {
            commands::json::generate(&extracted, &cli.dump_name, cli.output_to_dependant_modules)?;
        }
        OutputFormat::Mysql => {
            commands::mysql::generate(&extracted, &cli.dump_name, cli.output_to_dependant_modules)?;
        }
        OutputFormat::Sqlite => {
            commands::sqlite::generate(
                &extracted,
                &cli.dump_name,
                cli.output_to_dependant_modules,
            )?;
        }
        OutputFormat::CompassStages => unreachable!("Handled above"),
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
    fn mongo_host_port_and_uri_use_defaults_and_overrides() {
        assert_eq!(
            mongo_host_port_from_vars(|_| None),
            ("localhost".to_string(), "27017".to_string())
        );
        assert_eq!(
            mongo_host_port_from_vars(|key| match key {
                "MONGO_HOST" => Some("mongo".to_string()),
                "MONGO_PORT" => Some("28017".to_string()),
                _ => None,
            }),
            ("mongo".to_string(), "28017".to_string())
        );
        assert_eq!(mongodb_uri("mongo", "28017"), "mongodb://mongo:28017");
    }
}
