//! PDF generation using the Typst typesetting engine.
//!
//! Generates Typst markup from the request data, compiles it in-process
//! via `typst-as-lib`, and exports to PDF via `typst-pdf`.
//! Typst uses rustybuzz (HarfBuzz port) for text shaping, so Hebrew
//! taamim and nikud are positioned correctly via OpenType GPOS tables.

use std::path::Path;

use typst_as_lib::TypstEngine;

/// Lightweight request types for PDF generation — decoupled from HTTP models.
/// The binary's `models` module converts into these.
#[derive(Debug, Clone)]
pub struct PdfRequest {
    pub sefer_name: String,
    pub perakim: Vec<PdfPerekInput>,
}

#[derive(Debug, Clone)]
pub struct PdfPerekInput {
    pub perek_heb: String,
    pub header: String,
    pub pesukim: Vec<String>,
    /// Articles that belong to this perek: (name, author_name, content_html)
    pub articles: Vec<(String, String, String)>,
}

/// Strip Hebrew cantillation marks (taamim, U+0591–U+05AF) while keeping
/// nikud (U+05B0–U+05BD, U+05BF, U+05C1–U+05C2, U+05C4–U+05C5, U+05C7).
pub fn strip_taamim(text: &str) -> String {
    text.chars()
        .filter(|&c| !(('\u{0591}'..='\u{05AF}').contains(&c)))
        .collect()
}

/// Remove spaces immediately after a Hebrew maqaf (U+05BE ־) so that
/// hyphenated pairs stay visually connected.
fn collapse_maqaf_spaces(text: &str) -> String {
    text.replace("־ ", "־")
}

/// Strip HTML tags and decode basic HTML entities to plain text.
fn html_to_plain_text(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag_content = String::new();
            for tc in chars.by_ref() {
                if tc == '>' {
                    break;
                }
                tag_content.push(tc);
            }
            let tag_lower = tag_content.to_lowercase();
            let tag_name = tag_lower
                .trim_start_matches('/')
                .split_whitespace()
                .next()
                .unwrap_or("");
            if tag_name == "br" || tag_name == "br/" || tag_name == "br /" {
                result.push('\n');
            } else if tag_lower.starts_with('/') {
                match tag_name {
                    "p" | "div" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "tr"
                    | "blockquote" => {
                        result.push('\n');
                    }
                    _ => {}
                }
            }
            continue;
        }
        if c == '&' {
            let mut entity = String::new();
            for ec in chars.by_ref() {
                if ec == ';' {
                    break;
                }
                entity.push(ec);
                if entity.len() > 10 {
                    break;
                }
            }
            match entity.as_str() {
                "amp" => result.push('&'),
                "lt" => result.push('<'),
                "gt" => result.push('>'),
                "quot" => result.push('"'),
                "apos" => result.push('\''),
                "nbsp" => result.push(' '),
                "lrm" | "rlm" => {}
                _ if entity.starts_with('#') => {
                    let num_str = entity.trim_start_matches('#').trim_start_matches('x');
                    let radix = if entity.contains('x') { 16 } else { 10 };
                    if let Ok(code) = u32::from_str_radix(num_str, radix) {
                        if let Some(ch) = char::from_u32(code) {
                            result.push(ch);
                        }
                    }
                }
                _ => {
                    result.push('&');
                    result.push_str(&entity);
                    result.push(';');
                }
            }
            continue;
        }
        result.push(c);
    }

    let mut cleaned = String::with_capacity(result.len());
    let mut newline_count = 0;
    for c in result.chars() {
        if c == '\n' || c == '\r' {
            newline_count += 1;
            if newline_count <= 2 {
                cleaned.push('\n');
            }
        } else {
            newline_count = 0;
            cleaned.push(c);
        }
    }

    cleaned
}

/// Convert a number (1-based) to its Hebrew letter representation.
/// Covers 1–999 which is more than enough for pesukim.
fn to_hebrew_letter(n: usize) -> String {
    if n == 0 {
        return String::new();
    }

    let hundreds = [
        "", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק",
    ];
    let tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    let ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];

    let mut result = String::new();
    let mut remaining = n;

    if remaining >= 100 {
        result.push_str(hundreds[remaining / 100]);
        remaining %= 100;
    }

    if remaining == 15 {
        result.push_str("טו");
    } else if remaining == 16 {
        result.push_str("טז");
    } else {
        if remaining >= 10 {
            result.push_str(tens[remaining / 10]);
            remaining %= 10;
        }
        if remaining > 0 {
            result.push_str(ones[remaining]);
        }
    }

    result
}

/// Escape special Typst markup characters so literal text is safe to embed.
fn typst_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '#' | '*' | '_' | '`' | '<' | '>' | '@' | '$' | '\\' | '~' | '/' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Generate Typst markup string from the request data.
fn generate_typst_markup(req: &PdfRequest) -> String {
    let mut markup = String::with_capacity(16 * 1024);

    // Page and text settings
    markup.push_str(
        r#"#set page(paper: "a4", margin: (top: 20mm, bottom: 20mm, left: 15mm, right: 15mm))
#set text(font: "Taamey D", size: 11pt, dir: rtl, lang: "he")
#set par(justify: true)
"#,
    );

    for (idx, perek) in req.perakim.iter().enumerate() {
        if idx > 0 {
            markup.push_str("#pagebreak()\n");
        }

        // Title
        let title_text = if perek.header.is_empty() {
            format!("{} {}", req.sefer_name, perek.perek_heb)
        } else {
            format!("{} {} - {}", req.sefer_name, perek.perek_heb, perek.header)
        };
        markup.push_str(&format!(
            "#align(center, text(size: 16pt, weight: \"bold\")[{}])\n",
            typst_escape(&strip_taamim(&title_text))
        ));
        markup.push_str("#v(0.5em)\n");

        // Section header
        markup.push_str("#align(right, text(size: 12pt, weight: \"bold\")[הפרק])\n");
        markup.push_str("#v(0.3em)\n");

        // Pesukim
        for (i, pasuk_text) in perek.pesukim.iter().enumerate() {
            if pasuk_text.trim().is_empty() {
                continue;
            }
            let prefix = to_hebrew_letter(i + 1);
            let cleaned = collapse_maqaf_spaces(pasuk_text);
            markup.push_str(&format!(
                "*{}* {}\n\n",
                typst_escape(&prefix),
                typst_escape(&cleaned)
            ));
        }

        // Articles
        if !perek.articles.is_empty() {
            markup.push_str("#v(1em)\n");
            for (name, author_name, content_html) in &perek.articles {
                markup.push_str("#v(0.6em)\n");
                markup.push_str(&format!(
                    "#text(weight: \"bold\")[{} \\/ {}]\n\n",
                    typst_escape(name),
                    typst_escape(author_name)
                ));

                let plain_text = html_to_plain_text(content_html);
                for para_text in plain_text.split("\n\n") {
                    let trimmed = para_text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let flowing = trimmed.replace('\n', " ");
                    markup.push_str(&format!(
                        "#text(size: 10pt)[{}]\n\n",
                        typst_escape(&flowing)
                    ));
                }
            }
        }
    }

    markup
}

/// Build a PDF document from the request payload.
/// Uses Typst for proper Hebrew text shaping (taamim, nikud via GPOS).
pub fn build_pdf(req: &PdfRequest, fonts_dir: &Path) -> anyhow::Result<Vec<u8>> {
    let markup = generate_typst_markup(req);

    let font_path = fonts_dir.join("TaameyD-Regular.ttf");
    let font_bytes = std::fs::read(&font_path)
        .map_err(|e| anyhow::anyhow!("Failed to read font {}: {}", font_path.display(), e))?;

    let font_refs: [&[u8]; 1] = [font_bytes.as_slice()];
    let engine = TypstEngine::builder()
        .main_file(markup)
        .fonts(font_refs)
        .build();

    let compiled = engine.compile();
    let doc = compiled
        .output
        .map_err(|e| anyhow::anyhow!("Typst compilation failed: {}", e))?;

    let options = typst_pdf::PdfOptions::default();
    let pdf_bytes = typst_pdf::pdf(&doc, &options)
        .map_err(|e| anyhow::anyhow!("PDF export failed: {:?}", e))?;

    Ok(pdf_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_taamim() {
        let input = "בְּ\u{0591}רֵאשִׁית";
        let stripped = strip_taamim(input);
        assert!(!stripped.contains('\u{0591}'));
        assert!(stripped.contains('ְ'));
    }

    #[test]
    fn test_to_hebrew_letter() {
        assert_eq!(to_hebrew_letter(1), "א");
        assert_eq!(to_hebrew_letter(2), "ב");
        assert_eq!(to_hebrew_letter(10), "י");
        assert_eq!(to_hebrew_letter(15), "טו");
        assert_eq!(to_hebrew_letter(16), "טז");
        assert_eq!(to_hebrew_letter(20), "כ");
        assert_eq!(to_hebrew_letter(100), "ק");
        assert_eq!(to_hebrew_letter(119), "קיט");
    }

    #[test]
    fn test_html_to_plain_text_basic() {
        let html = "<p>שלום</p><p>עולם</p>";
        let plain = html_to_plain_text(html);
        assert!(plain.contains("שלום"));
        assert!(plain.contains("עולם"));
    }

    #[test]
    fn test_html_to_plain_text_br() {
        let html = "שורה ראשונה<br>שורה שנייה";
        let plain = html_to_plain_text(html);
        assert!(plain.contains("שורה ראשונה\nשורה שנייה"));
    }

    #[test]
    fn test_html_to_plain_text_entities() {
        let html = "a &amp; b &lt; c &gt; d";
        let plain = html_to_plain_text(html);
        assert_eq!(plain, "a & b < c > d");
    }

    #[test]
    fn test_html_to_plain_text_strips_tags() {
        let html = "<b>bold</b> and <i>italic</i> text";
        let plain = html_to_plain_text(html);
        assert_eq!(plain, "bold and italic text");
    }

    #[test]
    fn test_collapse_maqaf_spaces() {
        assert_eq!(collapse_maqaf_spaces("עַל־ פְּנֵי"), "עַל־פְּנֵי");
        assert_eq!(collapse_maqaf_spaces("no maqaf here"), "no maqaf here");
    }

    #[test]
    fn test_typst_escape() {
        assert_eq!(typst_escape("plain text"), "plain text");
        assert_eq!(typst_escape("a #b *c"), "a \\#b \\*c");
        assert_eq!(typst_escape("a/b"), "a\\/b");
    }

    #[test]
    fn test_generate_typst_markup_structure() {
        let req = PdfRequest {
            sefer_name: "בראשית".to_string(),
            perakim: vec![PdfPerekInput {
                perek_heb: "א".to_string(),
                header: "בריאת העולם".to_string(),
                pesukim: vec!["בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים".to_string()],
                articles: vec![],
            }],
        };
        let markup = generate_typst_markup(&req);
        assert!(markup.contains("Taamey D"));
        assert!(markup.contains("rtl"));
        assert!(markup.contains("בראשית א - בריאת העולם"));
        assert!(markup.contains("בְּרֵאשִׁ֖ית")); // taamim preserved in pesukim
    }
}
