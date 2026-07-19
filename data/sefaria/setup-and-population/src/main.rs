use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
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

    let (mongo_host, mongo_port) = mongo_host_port_from_env();

    println!("📦 Populating MongoDB...\n");
    println!("   Host: {}:{}", mongo_host, mongo_port);

    // Find the dump directory
    let raw_dir = Path::new("../.raw");
    let dump_dir = find_sefaria_dump_dir(raw_dir)?;

    println!("   Dump: {}\n", dump_dir.display());

    // Find mongorestore
    let mongorestore = find_mongorestore();

    println!("🚀 Running mongorestore...\n");

    let args = mongorestore_args(&mongo_host, &mongo_port, &dump_dir);
    let status = Command::new(&mongorestore)
        .args(&args)
        .status()
        .context("Failed to run mongorestore. Is it installed and in PATH?")?;

    if status.success() {
        println!("\n✅ MongoDB populated successfully!");
    } else {
        anyhow::bail!("mongorestore failed with exit code: {:?}", status.code());
    }

    Ok(())
}

fn mongo_host_port_from_env() -> (String, String) {
    mongo_host_port_from_vars(|key| env::var(key).ok())
}

fn mongo_host_port_from_vars(mut get_var: impl FnMut(&str) -> Option<String>) -> (String, String) {
    (
        get_var("MONGO_HOST").unwrap_or_else(|| "localhost".to_string()),
        get_var("MONGO_PORT").unwrap_or_else(|| "27017".to_string()),
    )
}

fn find_sefaria_dump_dir(raw_dir: &Path) -> Result<PathBuf> {
    if !raw_dir.exists() {
        anyhow::bail!(
            "Raw directory not found at {:?}. Please download the Sefaria dump first.\nSee ../retrieval/README.md for instructions.",
            raw_dir.canonicalize().unwrap_or(raw_dir.to_path_buf())
        );
    }

    let dump_dir = std::fs::read_dir(raw_dir)?
        .filter_map(|entry| entry.ok())
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("sefaria_dump_")
        });

    match dump_dir {
        Some(dir) => Ok(dir.path()),
        None => anyhow::bail!(
            "No sefaria_dump_* directory found in {:?}. Please extract the dump first.",
            raw_dir
        ),
    }
}

fn find_mongorestore() -> PathBuf {
    if cfg!(target_os = "windows") {
        let tools_dir = Path::new(r"C:\Program Files\MongoDB\Tools");
        find_mongorestore_under_tools(tools_dir).unwrap_or_else(|| "mongorestore".into())
    } else {
        "mongorestore".into()
    }
}

fn find_mongorestore_under_tools(tools_dir: &Path) -> Option<PathBuf> {
    if !tools_dir.exists() {
        return None;
    }

    let entries = std::fs::read_dir(tools_dir).ok()?;
    for entry in entries.filter_map(|entry| entry.ok()) {
        let bin_path = entry.path().join("bin").join("mongorestore.exe");
        if bin_path.exists() {
            return Some(bin_path);
        }
    }
    None
}

fn mongorestore_args(mongo_host: &str, mongo_port: &str, dump_dir: &Path) -> Vec<OsString> {
    vec![
        "--host".into(),
        format!("{}:{}", mongo_host, mongo_port).into(),
        "--drop".into(),
        dump_dir.as_os_str().to_os_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, Parser};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("sefaria-setup-test-{}-{}", name, suffix))
    }

    #[test]
    fn cli_parses_setup_and_populate_subcommands() {
        let setup = Cli::parse_from(["sefaria-setup", "setup"]);
        assert!(matches!(setup.command, Commands::Setup));

        let populate = Cli::parse_from(["sefaria-setup", "populate"]);
        assert!(matches!(populate.command, Commands::Populate));
    }

    #[test]
    fn clap_command_metadata_matches_binary_contract() {
        let command = Cli::command();

        assert_eq!(command.get_name(), "sefaria-setup");
        assert_eq!(
            command.get_about().map(|about| about.to_string()),
            Some("Setup and populate MongoDB with Sefaria data".to_string())
        );
    }

    #[test]
    fn mongo_host_port_uses_defaults_and_env_overrides() {
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
    }

    #[test]
    fn find_sefaria_dump_dir_reports_missing_raw_and_missing_dump() {
        let missing = temp_dir("missing");
        let error = find_sefaria_dump_dir(&missing).unwrap_err().to_string();
        assert!(error.contains("Raw directory not found"));

        let empty = temp_dir("empty");
        fs::create_dir_all(&empty).unwrap();
        let error = find_sefaria_dump_dir(&empty).unwrap_err().to_string();
        assert!(error.contains("No sefaria_dump_* directory"));
        fs::remove_dir_all(empty).unwrap();
    }

    #[test]
    fn find_sefaria_dump_dir_returns_first_matching_dump() {
        let raw = temp_dir("raw");
        let dump = raw.join("sefaria_dump_5784-sivan-4");
        fs::create_dir_all(&dump).unwrap();
        fs::create_dir_all(raw.join("other")).unwrap();

        assert_eq!(find_sefaria_dump_dir(&raw).unwrap(), dump);

        fs::remove_dir_all(raw).unwrap();
    }

    #[test]
    fn find_mongorestore_under_tools_detects_versioned_windows_tool_layout() {
        let tools = temp_dir("tools");
        let restore = tools.join("100.9.5").join("bin").join("mongorestore.exe");
        fs::create_dir_all(restore.parent().unwrap()).unwrap();
        fs::write(&restore, b"").unwrap();

        assert_eq!(find_mongorestore_under_tools(&tools), Some(restore));

        fs::remove_dir_all(tools).unwrap();
    }

    #[test]
    fn find_mongorestore_under_tools_falls_back_when_missing() {
        let missing = temp_dir("tools-missing");

        assert_eq!(find_mongorestore_under_tools(&missing), None);
    }

    #[test]
    fn mongorestore_args_build_expected_host_drop_and_dump_arguments() {
        let dump = Path::new("../.raw/sefaria_dump_5784-sivan-4");

        assert_eq!(
            mongorestore_args("mongo", "28017", dump),
            vec![
                OsString::from("--host"),
                OsString::from("mongo:28017"),
                OsString::from("--drop"),
                dump.as_os_str().to_os_string(),
            ]
        );
    }
}
