//! CLI entry point for tanah-view pipeline.

use anyhow::{Context, Result};
use bson::Document;
use clap::{Parser, ValueEnum};
use mongodb::{options::ClientOptions, Client};
use std::path::Path;

use tanah_view::{aggregation, commands, models::Sefer};

#[derive(Parser)]
#[command(name = "tanah-view")]
#[command(about = "Generate Tanah view from MongoDB Sefaria data")]
struct Cli {
    /// Output format
    #[arg(long, value_enum)]
    format: Option<OutputFormat>,

    /// Dump name (e.g., sefaria-dump-5784-sivan-4)
    #[arg(long, default_value = "sefaria-dump-5784-sivan-4")]
    dump_name: String,

    /// Output to dependent modules (web/bible-on-site for JSON, app/BibleOnSite for SQLite)
    #[arg(long)]
    output_to_dependant_modules: bool,
}

#[derive(Clone, ValueEnum)]
enum OutputFormat {
    Json,
    Sqlite,
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
        .context("--format is required for json/sqlite output")?;

    let sefarim = fetch_from_mongodb(&cli.dump_name).await?;

    // TODO: Validate sefarim against tanah_view.schema.json before generating output
    // This will ensure the aggregation pipeline output matches the expected schema

    match format {
        OutputFormat::Json => {
            commands::json::generate(&sefarim, &cli.dump_name, cli.output_to_dependant_modules)?
        }
        OutputFormat::Sqlite => {
            commands::sqlite::generate(&sefarim, &cli.dump_name, cli.output_to_dependant_modules)?
        }
        OutputFormat::CompassStages => unreachable!("Handled above"),
    }

    Ok(())
}

async fn fetch_from_mongodb(dump_name: &str) -> Result<Vec<Sefer>> {
    // Load environment variables
    dotenvy::from_path("../../setup-and-population/.env").ok();
    dotenvy::dotenv().ok();

    let mongo_host = std::env::var("MONGO_HOST").unwrap_or_else(|_| "localhost".to_string());
    let mongo_port = std::env::var("MONGO_PORT").unwrap_or_else(|_| "27017".to_string());

    println!(
        "🔗 Connecting to MongoDB at {}:{}...",
        mongo_host, mongo_port
    );

    // Connect to MongoDB
    let client_options = ClientOptions::parse(format!("mongodb://{}:{}", mongo_host, mongo_port))
        .await
        .context("Failed to parse MongoDB connection string")?;

    let client = Client::with_options(client_options)?;
    let db = client.database(dump_name);

    println!("📊 Running aggregation pipeline...");

    // Build the aggregation pipeline with data from the data/ directory
    let data_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let pipeline = aggregation::build_pipeline(&data_root)?;

    // Run the aggregation
    let collection = db.collection::<Document>("texts");
    let mut cursor = collection.aggregate(pipeline).await?;

    let mut results: Vec<Sefer> = Vec::new();
    while cursor.advance().await? {
        let doc = cursor.deserialize_current()?;
        results.push(bson::from_document(doc)?);
    }

    println!("✅ Retrieved {} sefarim", results.len());

    Ok(results)
}
