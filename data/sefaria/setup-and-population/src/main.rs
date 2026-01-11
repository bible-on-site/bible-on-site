use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::env;
use std::path::Path;
use std::process::Command;

#[derive(Parser)]
#[command(name = "sefaria-setup")]
#[command(about = "Setup and populate MongoDB with Sefaria data")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check MongoDB installation and setup environment
    Setup,
    /// Populate MongoDB with Sefaria dump
    Populate,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Setup => run_setup(),
        Commands::Populate => run_populate(),
    }
}

fn run_setup() -> Result<()> {
    println!("🔍 Checking MongoDB installation...\n");

    // Check MongoDB Server
    let mongodb_server_path = if cfg!(target_os = "windows") {
        Path::new(r"C:\Program Files\MongoDB\Server")
    } else {
        Path::new("/usr/bin/mongod")
    };

    if cfg!(target_os = "windows") {
        if mongodb_server_path.exists() {
            println!(
                "✅ MongoDB Server found at: {}",
                mongodb_server_path.display()
            );
        } else {
            println!(
                "❌ MongoDB Server not found at: {}",
                mongodb_server_path.display()
            );
            println!("\n📋 TODO: Automate MongoDB installation");
            println!(
                "   For now, manually install from: https://www.mongodb.com/try/download/community"
            );
        }

        // Check MongoDB Tools
        let tools_path = Path::new(r"C:\Program Files\MongoDB\Tools");
        if tools_path.exists() {
            println!("✅ MongoDB Tools found at: {}", tools_path.display());
        } else {
            println!("❌ MongoDB Tools not found at: {}", tools_path.display());
            println!("\n📋 TODO: Automate MongoDB Tools installation");
            println!(
                "   For now, manually install from: https://www.mongodb.com/try/download/database-tools"
            );
        }
    } else {
        println!("📋 TODO: Add MongoDB check for non-Windows platforms");
    }

    // Setup .env file
    println!("\n🔧 Setting up environment...\n");

    let env_path = Path::new(".env");
    let env_example_path = Path::new(".env.example");

    if env_path.exists() {
        println!("✅ .env file already exists");
    } else if env_example_path.exists() {
        std::fs::copy(env_example_path, env_path).context("Failed to copy .env.example to .env")?;
        println!("✅ Created .env from .env.example");
    } else {
        println!("❌ No .env.example found");
        println!("\n📋 TODO: Interactively generate .env");
    }

    println!("\n✨ Setup complete!");
    Ok(())
}

fn run_populate() -> Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();

    let mongo_host = env::var("MONGO_HOST").unwrap_or_else(|_| "localhost".to_string());
    let mongo_port = env::var("MONGO_PORT").unwrap_or_else(|_| "27017".to_string());

    println!("📦 Populating MongoDB...\n");
    println!("   Host: {}:{}", mongo_host, mongo_port);

    // Find the dump directory
    let raw_dir = Path::new("../.raw");
    if !raw_dir.exists() {
        anyhow::bail!(
            "Raw directory not found at {:?}. Please download the Sefaria dump first.\nSee ../retrieval/README.md for instructions.",
            raw_dir.canonicalize().unwrap_or(raw_dir.to_path_buf())
        );
    }

    // Find sefaria dump folder (e.g., sefaria_dump_5784-sivan-4)
    let dump_dir = std::fs::read_dir(raw_dir)?
        .filter_map(|entry| entry.ok())
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("sefaria_dump_")
        });

    let dump_dir = match dump_dir {
        Some(dir) => dir.path(),
        None => anyhow::bail!(
            "No sefaria_dump_* directory found in {:?}. Please extract the dump first.",
            raw_dir
        ),
    };

    println!("   Dump: {}\n", dump_dir.display());

    // Find mongorestore
    let mongorestore = if cfg!(target_os = "windows") {
        // Try to find mongorestore in common paths
        let tools_dir = Path::new(r"C:\Program Files\MongoDB\Tools");
        if tools_dir.exists() {
            let mut found = None;
            if let Ok(entries) = std::fs::read_dir(tools_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let bin_path = entry.path().join("bin").join("mongorestore.exe");
                    if bin_path.exists() {
                        found = Some(bin_path);
                        break;
                    }
                }
            }
            found.unwrap_or_else(|| "mongorestore".into())
        } else {
            "mongorestore".into()
        }
    } else {
        "mongorestore".into()
    };

    println!("🚀 Running mongorestore...\n");

    let status = Command::new(&mongorestore)
        .arg("--host")
        .arg(format!("{}:{}", mongo_host, mongo_port))
        .arg("--drop")
        .arg(&dump_dir)
        .status()
        .context("Failed to run mongorestore. Is it installed and in PATH?")?;

    if status.success() {
        println!("\n✅ MongoDB populated successfully!");
    } else {
        anyhow::bail!("mongorestore failed with exit code: {:?}", status.code());
    }

    Ok(())
}
