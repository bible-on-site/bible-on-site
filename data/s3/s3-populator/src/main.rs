//! S3 Bucket Populator
//!
//! Populates S3 buckets with sample data for development and testing.
//! Supports both real AWS S3 and LocalStack for local development.

use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_sdk_s3::config::Credentials;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use clap::Parser;
use std::path::Path;

#[derive(Parser)]
#[command(name = "s3-populator")]
#[command(about = "Populate S3 buckets with test data")]
struct Cli {
    /// S3 bucket name
    #[arg(long, env = "S3_BUCKET", default_value = "bible-on-site-rabbis")]
    bucket: String,

    /// AWS region
    #[arg(long, env = "S3_REGION", default_value = "us-east-1")]
    region: String,

    /// S3 endpoint URL (for LocalStack/MinIO)
    #[arg(long, env = "S3_ENDPOINT")]
    endpoint: Option<String>,

    /// AWS access key ID
    #[arg(long, env = "S3_ACCESS_KEY_ID", default_value = "test")]
    access_key_id: String,

    /// AWS secret access key
    #[arg(long, env = "S3_SECRET_ACCESS_KEY", default_value = "test")]
    secret_access_key: String,

    /// Only clear the bucket (do not populate)
    #[arg(long, default_value = "false")]
    clear_only: bool,

    /// Skip clearing existing data
    #[arg(long, default_value = "false")]
    skip_clear: bool,
}

/// Sample author image as embedded bytes (a simple colored placeholder)
fn generate_placeholder_image(color: &str) -> Vec<u8> {
    // Simple 1x1 pixel PNG with the specified color
    // This is a minimal valid PNG file
    let (r, g, b) = match color {
        "blue" => (66, 133, 244),
        "green" => (52, 168, 83),
        "red" => (234, 67, 53),
        "yellow" => (251, 188, 4),
        _ => (128, 128, 128),
    };

    // Minimal PNG: 8-byte signature + IHDR + IDAT + IEND
    // For simplicity, we create a small 64x64 solid color image
    create_solid_png(64, 64, r, g, b)
}

fn create_solid_png(width: u32, height: u32, r: u8, g: u8, b: u8) -> Vec<u8> {
    let mut png_data = Vec::new();

    // PNG signature
    png_data.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // IHDR chunk
    let mut ihdr_data = Vec::new();
    ihdr_data.extend_from_slice(&width.to_be_bytes());
    ihdr_data.extend_from_slice(&height.to_be_bytes());
    ihdr_data.push(8); // bit depth
    ihdr_data.push(2); // color type (RGB)
    ihdr_data.push(0); // compression
    ihdr_data.push(0); // filter
    ihdr_data.push(0); // interlace
    write_chunk(&mut png_data, b"IHDR", &ihdr_data);

    // IDAT chunk - compressed image data
    // Each row has a filter byte (0 = none) followed by RGB pixels
    let row_size = 1 + (width as usize) * 3;
    let mut raw_data = Vec::with_capacity(row_size * (height as usize));
    for _ in 0..height {
        raw_data.push(0); // filter byte (none)
        raw_data.extend(std::iter::repeat_n([r, g, b], width as usize).flatten());
    }

    // Compress with zlib
    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw_data, 6);
    write_chunk(&mut png_data, b"IDAT", &compressed);

    // IEND chunk
    write_chunk(&mut png_data, b"IEND", &[]);

    png_data
}

fn write_chunk(output: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    let length = data.len() as u32;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(chunk_type);
    output.extend_from_slice(data);

    // Calculate CRC32 of type + data
    let mut crc_data = Vec::new();
    crc_data.extend_from_slice(chunk_type);
    crc_data.extend_from_slice(data);
    let crc = crc32fast::hash(&crc_data);
    output.extend_from_slice(&crc.to_be_bytes());
}

/// Sample data to populate - matches production structure: authors/high-res/{id}.jpg
struct SampleAuthorImage {
    author_id: u32,
    color: &'static str,
}

const SAMPLE_IMAGES: &[SampleAuthorImage] = &[
    SampleAuthorImage {
        author_id: 1,
        color: "blue",
    },
    SampleAuthorImage {
        author_id: 2,
        color: "green",
    },
    SampleAuthorImage {
        author_id: 3,
        color: "red",
    },
    SampleAuthorImage {
        author_id: 4,
        color: "yellow",
    },
];

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment files based on priority
    load_env_files();

    let cli = Cli::parse();

    println!("S3 Populator");
    println!("============");
    println!("Bucket: {}", cli.bucket);
    println!("Region: {}", cli.region);
    if let Some(ref endpoint) = cli.endpoint {
        println!("Endpoint: {} (LocalStack/MinIO mode)", endpoint);
    } else {
        println!("Endpoint: AWS S3");
    }

    // Build S3 client
    let client = build_s3_client(&cli).await?;

    // Ensure bucket exists (for LocalStack)
    if cli.endpoint.is_some() {
        ensure_bucket_exists(&client, &cli.bucket).await?;
    }

    // Clear existing data if not skipped
    if !cli.skip_clear {
        clear_bucket(&client, &cli.bucket).await?;
    }

    if cli.clear_only {
        println!("Bucket cleared successfully (--clear-only mode)");
        return Ok(());
    }

    // Populate with sample data
    populate_sample_images(&client, &cli.bucket).await?;

    println!("\nS3 population complete!");
    Ok(())
}

fn load_env_files() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.join("../../..");

    // Load in order of priority (later overrides earlier)
    let env_files = [".env", ".dev.env", ".test.env"];

    for file in &env_files {
        let path = repo_root.join(file);
        if path.exists() && dotenvy::from_path(&path).is_ok() {
            println!("Loaded environment from: {}", file);
        }
    }
}

async fn build_s3_client(cli: &Cli) -> Result<Client> {
    let credentials = Credentials::new(
        &cli.access_key_id,
        &cli.secret_access_key,
        None,
        None,
        "s3-populator",
    );

    let mut config_builder = aws_sdk_s3::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(aws_sdk_s3::config::Region::new(cli.region.clone()))
        .credentials_provider(credentials);

    if let Some(ref endpoint) = cli.endpoint {
        config_builder = config_builder
            .endpoint_url(endpoint)
            .force_path_style(true);
    }

    let config = config_builder.build();
    Ok(Client::from_conf(config))
}

async fn ensure_bucket_exists(client: &Client, bucket: &str) -> Result<()> {
    match client.head_bucket().bucket(bucket).send().await {
        Ok(_) => {
            println!("Bucket '{}' exists", bucket);
        }
        Err(_) => {
            println!("Creating bucket '{}'...", bucket);
            client
                .create_bucket()
                .bucket(bucket)
                .send()
                .await
                .context("Failed to create bucket")?;
            println!("Bucket '{}' created", bucket);
        }
    }
    Ok(())
}

async fn clear_bucket(client: &Client, bucket: &str) -> Result<()> {
    println!("Clearing bucket '{}'...", bucket);

    let mut continuation_token: Option<String> = None;
    let mut total_deleted = 0;

    loop {
        let mut list_req = client.list_objects_v2().bucket(bucket);
        if let Some(token) = continuation_token {
            list_req = list_req.continuation_token(token);
        }

        let response = match list_req.send().await {
            Ok(resp) => resp,
            Err(e) => {
                // Bucket might not exist yet
                println!("Note: Could not list bucket contents: {}", e);
                return Ok(());
            }
        };

        if let Some(contents) = response.contents {
            for object in contents {
                if let Some(key) = object.key {
                    client
                        .delete_object()
                        .bucket(bucket)
                        .key(&key)
                        .send()
                        .await
                        .with_context(|| format!("Failed to delete object: {}", key))?;
                    total_deleted += 1;
                }
            }
        }

        if response.is_truncated == Some(true) {
            continuation_token = response.next_continuation_token;
        } else {
            break;
        }
    }

    if total_deleted > 0 {
        println!("Deleted {} objects from bucket", total_deleted);
    }

    Ok(())
}

async fn populate_sample_images(client: &Client, bucket: &str) -> Result<()> {
    println!("\nPopulating sample author images...");

    // Upload default avatar (used when author has no image)
    let default_key = "authors/default.jpg";
    let default_image = generate_placeholder_image("gray");
    client
        .put_object()
        .bucket(bucket)
        .key(default_key)
        .body(ByteStream::from(default_image))
        .content_type("image/jpeg")
        .cache_control("max-age=31536000")
        .send()
        .await
        .with_context(|| format!("Failed to upload: {}", default_key))?;
    println!("  Uploaded: {} (default avatar)", default_key);

    // Upload sample author images - matches production: authors/high-res/{id}.jpg
    for sample in SAMPLE_IMAGES {
        let key = format!("authors/high-res/{}.jpg", sample.author_id);
        let image_data = generate_placeholder_image(sample.color);

        client
            .put_object()
            .bucket(bucket)
            .key(&key)
            .body(ByteStream::from(image_data))
            .content_type("image/jpeg")
            .cache_control("max-age=31536000")
            .send()
            .await
            .with_context(|| format!("Failed to upload: {}", key))?;

        println!("  Uploaded: {}", key);
    }

    println!("Uploaded {} sample images + 1 default avatar", SAMPLE_IMAGES.len());
    Ok(())
}
