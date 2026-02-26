//! INGEST: Load perushim (Malbim + Or HaChaim) and articles from MySQL into unified chunks.

use anyhow::Result;
use serde::Serialize;
use sqlx::MySqlPool;

/// One searchable chunk; source_type distinguishes perush vs article.
#[derive(Clone, Debug, Serialize)]
pub struct Chunk {
    pub source_type: String, // "perush" | "article"
    pub perek_id: i32,
    pub text: String,
    pub author: String,
    pub perush_id: Option<i32>,
    pub perush_name: Option<String>,
    pub pasuk: Option<i16>,
    pub note_idx: Option<i16>,
    pub article_id: Option<i32>,
    pub article_name: Option<String>,
}

// ─── Perushim (Malbim + Or HaChaim) ────────────────────────────────────────

const PERUSH_PARSHAN_NAMES: &[&str] = &["מלבי\"ם", "חיים בן עטר"];

pub async fn load_perush_chunks(pool: &MySqlPool) -> Result<Vec<Chunk>> {
    let placeholders = PERUSH_PARSHAN_NAMES
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        r#"
        SELECT
            n.perush_id, p.name AS perush_name, a.name AS author,
            n.perek_id, n.pasuk, n.note_idx, n.note_content AS text
        FROM note n
        JOIN perush p ON p.id = n.perush_id
        JOIN parshan a ON a.id = p.parshan_id
        WHERE a.name IN ({placeholders})
        ORDER BY n.perek_id, n.pasuk, n.note_idx
        "#
    );

    let mut q = sqlx::query_as::<_, PerushRow>(&sql);
    for name in PERUSH_PARSHAN_NAMES {
        q = q.bind(*name);
    }
    let rows: Vec<PerushRow> = q.fetch_all(pool).await?;

    Ok(rows
        .into_iter()
        .map(|r| Chunk {
            source_type: "perush".into(),
            perek_id: r.perek_id,
            text: strip_html(&r.text),
            author: r.author,
            perush_id: Some(r.perush_id),
            perush_name: Some(r.perush_name),
            pasuk: Some(r.pasuk),
            note_idx: Some(r.note_idx),
            article_id: None,
            article_name: None,
        })
        .collect())
}

#[derive(Debug, sqlx::FromRow)]
struct PerushRow {
    perush_id: i32,
    perush_name: String,
    author: String,
    perek_id: i32,
    pasuk: i16,
    note_idx: i16,
    text: String,
}

// ─── Articles ──────────────────────────────────────────────────────────────

fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Split text into paragraph-based chunks up to max_chunk_len chars.
fn chunk_text(text: &str, max_chunk_len: usize) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    let paragraphs: Vec<&str> = trimmed
        .split("\n\n")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if paragraphs.is_empty() {
        if trimmed.len() <= max_chunk_len {
            return vec![trimmed.to_string()];
        }
        return trimmed
            .chars()
            .collect::<Vec<_>>()
            .chunks(max_chunk_len)
            .map(|c| c.iter().collect::<String>())
            .collect();
    }
    let mut chunks = Vec::new();
    let mut current = String::new();
    for p in paragraphs {
        if current.len() + p.len() + 2 > max_chunk_len && !current.is_empty() {
            chunks.push(std::mem::take(&mut current).trim().to_string());
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(p);
    }
    let tail = current.trim().to_string();
    if !tail.is_empty() {
        chunks.push(tail);
    }
    chunks
}

pub async fn load_article_chunks(pool: &MySqlPool) -> Result<Vec<Chunk>> {
    let rows: Vec<ArticleRow> = sqlx::query_as::<_, ArticleRow>(
        r#"
        SELECT a.id AS article_id, a.perek_id, a.name AS article_name,
               a.content, a.abstract AS abstract_field, au.name AS author
        FROM tanah_article a
        JOIN tanah_author au ON a.author_id = au.id
        ORDER BY a.perek_id, a.id
        "#,
    )
    .fetch_all(pool)
    .await?;

    const MAX_CHUNK: usize = 600;

    let mut out = Vec::new();
    for r in rows {
        let mut combined = String::new();
        if let Some(ref abs) = r.abstract_field {
            let stripped = strip_html(abs);
            let trimmed = stripped.trim();
            if !trimmed.is_empty() {
                combined.push_str(trimmed);
                combined.push_str("\n\n");
            }
        }
        if let Some(ref c) = r.content {
            combined.push_str(&strip_html(c));
        }
        for piece in chunk_text(&combined, MAX_CHUNK) {
            out.push(Chunk {
                source_type: "article".into(),
                perek_id: r.perek_id,
                text: piece,
                author: r.author.clone(),
                perush_id: None,
                perush_name: None,
                pasuk: None,
                note_idx: None,
                article_id: Some(r.article_id),
                article_name: Some(r.article_name.clone()),
            });
        }
    }
    Ok(out)
}

#[derive(Debug, sqlx::FromRow)]
struct ArticleRow {
    article_id: i32,
    perek_id: i32,
    article_name: String,
    content: Option<String>,
    abstract_field: Option<String>,
    author: String,
}
