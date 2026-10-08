//! Render an immutable daily bulletin input into matching email and PDF artifacts.
use std::path::Path;

use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::{pdf, tanach};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyArticle {
    pub id: i32,
    pub title: String,
    pub author: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyInput {
    pub date: String,
    pub hebrew_date: String,
    pub perek_id: i32,
    pub article: Option<DailyArticle>,
    #[serde(default)]
    pub dedications: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyArtifacts {
    pub subject: String,
    pub source: String,
    pub email_html: String,
    pub pdf_base64: String,
    pub filename: String,
}

fn normalize_authored(text: &str) -> String {
    text.replace('״', "\"")
        .replace('׳', "'")
        .replace(['־', '–', '—'], "-")
}

// Normalize visible article text without changing URLs or other HTML attributes.
// This runs after sanitization, where comments and malformed tags are removed.
fn normalize_html_text(html: &str) -> String {
    let mut in_tag = false;
    let mut quote = None;
    html.chars()
        .map(|c| {
            if in_tag {
                if quote == Some(c) {
                    quote = None;
                } else if quote.is_none() {
                    if c == '"' || c == '\'' {
                        quote = Some(c);
                    } else if c == '>' {
                        in_tag = false;
                    }
                }
                c
            } else if c == '<' {
                in_tag = true;
                c
            } else {
                match c {
                    '״' => '"',
                    '׳' => '\'',
                    '־' | '–' | '—' => '-',
                    _ => c,
                }
            }
        })
        .collect()
}

pub fn render(input: &DailyInput, fonts_dir: &Path) -> Result<DailyArtifacts> {
    let date = input.date.parse::<sea_orm::prelude::Date>()?;
    ensure!(
        date.format("%Y-%m-%d").to_string() == input.date,
        "Invalid bulletin date"
    );
    ensure!(
        !input.hebrew_date.trim().is_empty(),
        "Hebrew date is required"
    );
    let chapter = tanach::get_perek(input.perek_id)
        .ok_or_else(|| anyhow::anyhow!("Unknown perekId: {}", input.perek_id))?;
    let hebrew_date = normalize_authored(&input.hebrew_date);
    let source = format!(
        "{} {}",
        normalize_authored(&chapter.sefer_name),
        tanach::perek_to_hebrew(chapter.perek_in_sefer)
    );
    let subject = format!("תנ\"ך על הפרק - {} - {}", hebrew_date, source);
    let dedications: Vec<String> = input
        .dedications
        .iter()
        .map(|s| normalize_authored(s))
        .collect();
    let escape = ammonia::clean_text;
    let mut html = format!(
        "<!doctype html><html lang=\"he\" dir=\"rtl\"><head><meta charset=\"utf-8\"><title>{}</title></head><body style=\"margin:0;background:#def3f9;direction:rtl;font-family:Arial,sans-serif\"><table role=\"presentation\" width=\"100%\"><tr><td align=\"center\"><table role=\"presentation\" width=\"600\" style=\"max-width:100%;background:white;padding:24px;text-align:right\"><tr><td><h1>תנ\"ך על הפרק</h1><p>{}</p><h2>{}</h2>",
        escape(&subject),
        escape(&hebrew_date),
        escape(&source)
    );
    if !dedications.is_empty() {
        html.push_str("<h3>הלימוד מוקדש</h3>");
        for dedication in &dedications {
            html.push_str(&format!("<p>{}</p>", escape(dedication)));
        }
    }
    html.push_str("<h3>הפרק</h3>");
    for (i, verse) in chapter.pesukim.iter().enumerate() {
        html.push_str(&format!(
            "<p><strong>{}</strong> {}</p>",
            tanach::perek_to_hebrew((i + 1) as u32),
            escape(verse)
        ));
    }
    let mut articles = vec![];
    if let Some(article) = &input.article {
        let title = normalize_authored(&article.title);
        let author = normalize_authored(&article.author);
        // Use the same sanitized content in both formats. Canonical scripture above
        // retains its biblical maqaf and cantillation marks.
        let content = normalize_html_text(
            &ammonia::Builder::default()
                .url_relative(ammonia::UrlRelative::RewriteWithBase(ammonia::Url::parse(
                    "https://תנך.com/",
                )?))
                .clean(&article.html)
                .to_string(),
        );
        html.push_str(&format!(
            "<h3>{} / {}</h3>{}",
            escape(&title),
            escape(&author),
            content
        ));
        articles.push((title, author, content));
    }
    html.push_str(&format!("<p><a href=\"https://תנך.com/929/{}\">ללימוד הפרק באתר</a></p></td></tr></table></td></tr></table></body></html>", input.perek_id));
    let req = pdf::PdfRequest {
        sefer_name: normalize_authored(&chapter.sefer_name),
        perakim: vec![pdf::PdfPerekInput {
            perek_heb: tanach::perek_to_hebrew(chapter.perek_in_sefer),
            header: normalize_authored(&chapter.header),
            pesukim: chapter.pesukim.clone(),
            articles,
        }],
        include_cover: false,
        include_toc: false,
        cover_accent_hex: "48A9C4".into(),
    };
    let bytes = pdf::build_daily_pdf(&req, fonts_dir, &hebrew_date, &dedications)?;
    let filename = format!("{}-{}.pdf", input.date, source);
    Ok(DailyArtifacts {
        subject,
        source,
        email_html: html,
        pdf_base64: STANDARD.encode(bytes),
        filename,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_preserves_scripture_and_sanitizes_article_and_dedications() {
        let input = DailyInput {
            date: "2026-10-08".into(), hebrew_date: "כ״ז תשרי תשפ״ז".into(), perek_id: 1,
            article: Some(DailyArticle { id: 7, title: "מאמר״".into(), author: "מחבר".into(), html: "<p>תנ״ך</p><script>attack()</script><img src=x onerror=attack()><a href=/929/1>קישור</a>".into() }),
            dedications: vec!["<script>not markup</script>".into()],
        };
        let result = render(&input, &Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts")).unwrap();
        assert_eq!(result.source, "בראשית א");
        assert!(!result.email_html.contains("attack()"));
        assert!(!result.email_html.contains("<script>"));
        assert!(result.email_html.contains("&lt;script&gt;"));
        assert!(result.email_html.contains("<p>תנ\"ך</p>"));
        assert!(result.email_html.contains("rel=\"noopener noreferrer\""));
        assert!(
            STANDARD
                .decode(result.pdf_base64)
                .unwrap()
                .starts_with(b"%PDF")
        );
        assert!(result.subject.contains("כ\"ז"));
    }

    #[test]
    fn text_normalization_keeps_link_destinations_intact() {
        assert_eq!(
            normalize_html_text("<a href=\"/תנ״ך־פרק\" title=\"a>b\">תנ״ך־פרק</a>"),
            "<a href=\"/תנ״ך־פרק\" title=\"a>b\">תנ\"ך-פרק</a>"
        );
    }

    #[test]
    fn invalid_dates_and_chapters_are_rejected_before_rendering() {
        let mut input = DailyInput {
            date: "2026-02-30".into(),
            hebrew_date: "תאריך".into(),
            perek_id: 1,
            article: None,
            dedications: vec![],
        };
        assert!(render(&input, Path::new("missing")).is_err());
        input.date = "2026-10-08".into();
        input.perek_id = 930;
        assert!(render(&input, Path::new("missing")).is_err());
    }
}
