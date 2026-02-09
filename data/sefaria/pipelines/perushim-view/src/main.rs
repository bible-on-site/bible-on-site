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
    /// Generate SQLite: catalog (bundled) + notes (OBB/on-demand)
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

    let mongo_host = std::env::var("MONGO_HOST").unwrap_or_else(|_| "localhost".to_string());
    let mongo_port = std::env::var("MONGO_PORT").unwrap_or_else(|_| "27017".to_string());

    println!(
        "🔗 Connecting to MongoDB at {}:{}...",
        mongo_host, mongo_port
    );

    let client_options = ClientOptions::parse(format!("mongodb://{}:{}", mongo_host, mongo_port))
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
