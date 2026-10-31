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

// Preserve the archive's chapter-based naming convention. Sanitization affects
// the download name only; scripture and stored chapter metadata stay intact.
fn bulletin_filename(perek_id: i32, source: &str, header: &str) -> String {
    let header = normalize_authored(header);
    let name = if header.trim().is_empty() {
        format!("{perek_id}_{source} - {perek_id}")
    } else {
        format!("{perek_id}_{source} - {perek_id} - {header}")
    };
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    // UTF-8's byte limit also fits Windows' UTF-16 unit limit. Reserve four
    // bytes for .pdf and stop before a character that would cross the limit.
    let mut stem = String::new();
    for c in cleaned.chars() {
        if stem.len() + c.len_utf8() > 251 {
            break;
        }
        stem.push(c);
    }
    format!("{}.pdf", stem.trim_end_matches([' ', '.']))
}

const WEBSITE_ORIGIN: &str = "https://xn--febl3a.co.il";
const LOGO_URL: &str = "https://bible-on-site-assets.s3.il-central-1.amazonaws.com/branding/daily-bulletin/logo-header-bfaa157e34c2.jpg";

// The transport replaces this tbody-level slot with the native unsubscribe and
// public contact row. Keeping it inside the card gives every section one edge.
const EMAIL_FOOTER_MARKER: &str = "<!--BULLETIN_EMAIL_FOOTER-->";

fn render_email(
    input: &DailyInput,
    chapter: &tanach::PerekData,
    subject: &str,
    source: &str,
    hebrew_date: &str,
    dedications: &[String],
    articles: &[(String, String, String)],
) -> String {
    let escape = ammonia::clean_text;
    let mut html = format!(
        r##"<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{subject}</title>
<style>
body,table,td,a {{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }}
table {{ border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }}
.bulletin-article p {{ margin:0 0 12px; }}
.bulletin-article h1,.bulletin-article h2,.bulletin-article h3,.bulletin-article h4 {{ margin:18px 0 8px; font-size:19px; line-height:1.5; color:#173e52; }}
.bulletin-article a {{ color:#28758a; text-decoration:underline; }}
.bulletin-article img {{ max-width:100%; height:auto; }}
.bulletin-article blockquote {{ margin:12px 0; padding:4px 14px; border-right:3px solid #d8bd82; color:#637780; }}
@media only screen and (max-width:480px) {{
.bulletin-padding {{ padding-right:20px !important; padding-left:20px !important; }}
.bulletin-title {{ font-size:28px !important; }}
.bulletin-scripture {{ font-size:18px !important; }}
}}
</style>
</head>
<body style="margin:0;padding:0;background:#f4f1ea;direction:rtl;color:#173e52;font-family:Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">{source} | {hebrew_date}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f1ea">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" dir="rtl" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border:1px solid #dce5e7;border-top:5px solid #28758a">
<tbody>
<tr><td class="bulletin-padding" align="right" style="padding:20px 28px;background:#ffffff;border-bottom:1px solid #dce5e7">
<h1 class="bulletin-title" style="margin:0;color:#173e52;font-size:32px;line-height:1.25"><a href="{website}/" style="text-decoration:none"><img src="{logo}" width="220" height="110" alt="תנ&quot;ך על הפרק" style="display:block;width:220px;max-width:100%;height:auto;border:0"></a></h1>
<p style="margin:12px 0 0;color:#637780;font-size:15px;line-height:24px"><strong style="color:#173e52;font-size:18px">{source}</strong><span style="padding:0 8px;color:#b4a17c"> | </span>{hebrew_date}</p>
</td></tr>
"##,
        subject = escape(subject),
        source = escape(source),
        hebrew_date = escape(hebrew_date),
        website = WEBSITE_ORIGIN,
        logo = LOGO_URL,
    );
    if !dedications.is_empty() {
        html.push_str("<tr><td class=\"bulletin-padding\" align=\"right\" style=\"padding:20px 28px 0\"><div style=\"padding:12px 14px;background:#faf7f0;border-right:3px solid #d8bd82;color:#637780;font-size:14px;line-height:1.6\"><strong style=\"color:#173e52\">הלימוד מוקדש</strong>");
        for dedication in dedications {
            html.push_str(&format!(
                "<p style=\"margin:4px 0 0\">{}</p>",
                escape(dedication)
            ));
        }
        html.push_str("</div></td></tr>\n");
    }
    html.push_str("<tr><td class=\"bulletin-padding\" align=\"right\" style=\"padding:24px 28px\"><h2 style=\"margin:0 0 12px;font-size:13px;line-height:20px;color:#28758a\">הפרק היומי</h2><p class=\"bulletin-scripture\" dir=\"rtl\" style=\"margin:0;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.75;text-align:justify;text-align-last:right;color:#233d48\">");
    for (index, verse) in chapter.pesukim.iter().enumerate() {
        html.push_str(&format!(
            "<span class=\"bulletin-verse\"><span class=\"bulletin-verse-number\" style=\"color:#28758a;font-family:Arial,sans-serif;font-size:14px;font-weight:700;vertical-align:baseline;line-height:inherit\">{}</span> {}</span> ",
            tanach::perek_to_hebrew((index + 1) as u32),
            escape(verse),
        ));
    }
    html.push_str("</p></td></tr>\n");
    for (title, author, content) in articles {
        // Share the PDF's complete leading-heading rule so rich article content
        // keeps its title once, with the author immediately after that title.
        let (heading, body) = pdf::split_article_header(content);
        let title = heading.as_deref().unwrap_or(title);
        html.push_str(&format!(
            "<tr><td class=\"bulletin-padding\" align=\"right\" style=\"padding:24px 28px;border-top:1px solid #dce5e7\"><p style=\"margin:0 0 6px;color:#28758a;font-size:13px;line-height:20px\">מאמר על הפרק</p><h2 style=\"margin:0 0 6px;color:#173e52;font-size:23px;line-height:1.4\">{}</h2><p style=\"margin:0 0 18px;color:#637780;font-size:14px;line-height:22px\">{}</p><div class=\"bulletin-article\" dir=\"rtl\" style=\"font-size:16px;line-height:1.75;color:#233d48;text-align:justify;text-align-last:right\">{}</div></td></tr>\n",
            escape(title), escape(author), body,
        ));
    }
    html.push_str(&format!(
        "<tr><td class=\"bulletin-padding\" align=\"right\" style=\"padding:0 28px 24px\"><a href=\"{}/929/{}\" style=\"display:inline-block;padding:11px 20px;border:1px solid #28758a;background:#28758a;color:#ffffff;text-decoration:none;font-size:14px;line-height:20px;font-weight:700;border-radius:7px\">להמשך לימוד על הפרק</a></td></tr>\n{}\n</tbody></table></td></tr></table></body></html>",
        WEBSITE_ORIGIN, input.perek_id, EMAIL_FOOTER_MARKER,
    ));
    html
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
        articles.push((title, author, content));
    }
    let html = render_email(
        input,
        chapter,
        &subject,
        &source,
        &hebrew_date,
        &dedications,
        &articles,
    );
    let req = pdf::PdfRequest {
        sefer_name: normalize_authored(&chapter.sefer_name),
        perakim: vec![pdf::PdfPerekInput {
            perek_heb: tanach::perek_to_hebrew(chapter.perek_in_sefer),
            header: normalize_authored(&chapter.header),
            pesukim: pdf::plain_pesukim(&chapter.pesukim),
            images: vec![],
            articles,
        }],
        include_cover: false,
        include_toc: false,
        cover_accent_hex: "48A9C4".into(),
        cover_text: pdf::PdfCoverText::default(),
    };
    let bytes = pdf::build_daily_pdf(&req, fonts_dir, &hebrew_date, &dedications)?;
    let filename = bulletin_filename(input.perek_id, &source, &chapter.header);
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

    fn layout_input() -> DailyInput {
        DailyInput {
            date: "2026-10-28".into(),
            hebrew_date: "יז חשוון תשפז".into(),
            perek_id: 502,
            article: None,
            dedications: vec![],
        }
    }

    #[test]
    fn file_names_match_archived_chapter_convention() {
        assert_eq!(
            bulletin_filename(1, "בראשית א", "בריאת העולם"),
            "1_בראשית א - 1 - בריאת העולם.pdf"
        );
        let chapter = tanach::get_perek(305).unwrap();
        assert_eq!(
            bulletin_filename(305, "מלכים א יח", &chapter.header),
            "305_מלכים א יח - 305 - אליהו הנביא נראה לאחאב, מעמד אליהו ונביאי הבעל בכרמל.pdf"
        );
        let chapter = tanach::get_perek(306).unwrap();
        assert_eq!(
            bulletin_filename(306, "מלכים א יט", &chapter.header),
            "306_מלכים א יט - 306 - אליהו הנביא בורח מאיזבל, מבקש למות, התגלות ה' אליו.pdf"
        );
    }

    #[test]
    fn file_names_are_portable_without_mutating_headings() {
        let header = "כותרת: עם / נתיב? \\ וקישור | ועוד* <טקסט>\n";
        let original = header.to_string();
        let name = bulletin_filename(5, "בראשית ה", header);
        assert!(name.starts_with("5_בראשית ה - 5 - "));
        assert!(
            !name
                .chars()
                .any(|c| c.is_control() || r#"<>:"/\|?*"#.contains(c))
        );
        assert_eq!(header, original);
        assert_eq!(bulletin_filename(1, "בראשית א", " "), "1_בראשית א - 1.pdf");
        let long = bulletin_filename(1, "בראשית א", &"כותרת 🌍 ".repeat(100));
        assert!(long.encode_utf16().count() <= 255);
        assert!(long.len() <= 255, "{} UTF-8 bytes", long.len());
        assert!(long.ends_with(".pdf"));
    }

    #[test]
    fn file_name_byte_limit_preserves_complete_unicode_characters() {
        let ascii = bulletin_filename(1, "x", &"a".repeat(300));
        assert_eq!(ascii.len(), 255);
        let header = format!("{}🌍", "a".repeat(240));
        let unicode = bulletin_filename(1, "x", &header);
        assert_eq!(unicode, format!("1_x - 1 - {}.pdf", "a".repeat(240)));
    }

    #[test]
    fn every_canonical_chapter_has_a_portable_archive_name() {
        for id in 1..=929 {
            let chapter = tanach::get_perek(id).unwrap();
            let source = format!(
                "{} {}",
                chapter.sefer_name,
                tanach::perek_to_hebrew(chapter.perek_in_sefer)
            );
            let name = bulletin_filename(id, &source, &chapter.header);
            assert!(name.starts_with(&format!("{id}_")));
            assert!(name.ends_with(".pdf"));
            assert!(name.encode_utf16().count() <= 255);
            assert!(name.len() <= 255, "oversized chapter {id} filename");
            assert!(
                !name
                    .chars()
                    .any(|c| c.is_control() || r#"<>:"/\|?*"#.contains(c))
            );
        }
    }

    #[test]
    fn email_has_one_branded_header_compact_metadata_and_an_aligned_footer_slot() {
        let input = layout_input();
        let chapter = tanach::get_perek(input.perek_id).unwrap();
        let html = render_email(
            &input,
            chapter,
            "עלון יומי",
            "הושע ב",
            &input.hebrew_date,
            &[],
            &[],
        );
        assert_eq!(html.matches("<h1 ").count(), 1);
        assert!(
            !html.contains(">תנ\"ך על הפרק</h1>"),
            "the real wordmark is the heading, without a repeated visible brand"
        );
        assert!(html.contains("alt=\"תנ&quot;ך על הפרק\""));
        assert!(html.contains(&format!("src=\"{LOGO_URL}\"")));
        assert!(html.contains("width=\"220\" height=\"110\""));
        assert!(html.contains("width:220px;max-width:100%;height:auto"));
        assert!(html.contains("max-width:680px"));
        assert!(html.contains(&format!(
            "<strong style=\"color:#173e52;font-size:18px\">{}</strong>",
            ammonia::clean_text("הושע ב")
        )));
        assert!(html.contains(&ammonia::clean_text(&input.hebrew_date)));
        assert!(html.contains("href=\"https://xn--febl3a.co.il/929/502\""));
        assert_eq!(html.matches(EMAIL_FOOTER_MARKER).count(), 1);
        assert!(html.contains(&format!("</td></tr>\n{EMAIL_FOOTER_MARKER}\n</tbody>")));
        assert!(!html.contains("הלימוד מוקדש"));
        assert!(!html.contains("מאמר על הפרק"));
    }

    #[test]
    fn email_flows_all_verses_in_one_paragraph_without_changing_canonical_text() {
        let input = layout_input();
        let chapter = tanach::get_perek(input.perek_id).unwrap();
        let html = render_email(
            &input,
            chapter,
            "עלון יומי",
            "הושע ב",
            &input.hebrew_date,
            &[],
            &[],
        );
        let scripture = html
            .split("<p class=\"bulletin-scripture\"")
            .nth(1)
            .unwrap()
            .split("</p>")
            .next()
            .unwrap();
        assert_eq!(html.matches("<p class=\"bulletin-scripture\"").count(), 1);
        assert_eq!(
            scripture.matches("class=\"bulletin-verse\"").count(),
            chapter.pesukim.len()
        );
        assert_eq!(
            scripture.matches("class=\"bulletin-verse-number\"").count(),
            chapter.pesukim.len()
        );
        assert_eq!(
            scripture
                .matches(
                    "font-size:14px;font-weight:700;vertical-align:baseline;line-height:inherit"
                )
                .count(),
            chapter.pesukim.len(),
            "every verse letter must share the text baseline with readable inline sizing"
        );
        assert!(!scripture.contains("vertical-align:super"));
        assert!(!scripture.contains("line-height:0"));
        assert!(!scripture.contains("<sup"));
        assert!(!scripture.contains("<p"));
        assert!(!scripture.contains("<br"));
        assert!(scripture.contains("text-align:justify;text-align-last:right"));
        for verse in &chapter.pesukim {
            assert!(
                scripture.contains(&ammonia::clean_text(verse)),
                "canonical verse must retain its taamim and biblical maqaf"
            );
        }
        assert!(scripture.contains('־'));
        assert!(scripture.contains('֑'));
    }

    #[test]
    fn email_keeps_the_complete_article_heading_once_then_author_and_body() {
        let input = layout_input();
        let chapter = tanach::get_perek(input.perek_id).unwrap();
        let articles = vec![(
            "שם חלופי".into(),
            "מחבר".into(),
            "<h1>כותרת ראשונה</h1> <h1>כותרת שנייה</h1><p>תוכן מלא <strong>מודגש</strong></p>"
                .into(),
        )];
        let html = render_email(
            &input,
            chapter,
            "עלון",
            "הושע ב",
            &input.hebrew_date,
            &[],
            &articles,
        );
        let heading = ammonia::clean_text("כותרת ראשונה כותרת שנייה");
        assert_eq!(html.matches(&heading).count(), 1);
        assert!(!html.contains("שם חלופי"));
        assert_eq!(
            html.matches("<h1 ").count(),
            1,
            "article H1s must not compete with the brand header"
        );
        assert!(html.find(&heading).unwrap() < html.find("מחבר").unwrap());
        assert!(html.find("מחבר").unwrap() < html.find("<p>תוכן מלא").unwrap());
        assert!(html.contains("<strong>מודגש</strong>"));
        assert!(html.contains(">מאמר על הפרק</p>"));
        assert!(html.contains(">להמשך לימוד על הפרק</a>"));
        assert!(html.contains("class=\"bulletin-article\" dir=\"rtl\" style=\"font-size:16px;line-height:1.75;color:#233d48;text-align:justify;text-align-last:right\""));
        assert!(
            articles[0].2.starts_with("<h1>כותרת ראשונה</h1>"),
            "PDF input content must remain intact"
        );
    }

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
