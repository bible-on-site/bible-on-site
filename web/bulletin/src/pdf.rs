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

/// Decode an HTML entity (the part between `&` and `;`) to a character or string.
fn decode_html_entity(entity: &str) -> String {
    match entity {
        "amp" => "&".into(),
        "lt" => "<".into(),
        "gt" => ">".into(),
        "quot" => "\"".into(),
        "apos" => "'".into(),
        "nbsp" => " ".into(),
        "lrm" | "rlm" => String::new(),
        _ if entity.starts_with('#') => {
            let num_str = entity.trim_start_matches('#').trim_start_matches('x');
            let radix = if entity.contains('x') { 16 } else { 10 };
            u32::from_str_radix(num_str, radix)
                .ok()
                .and_then(char::from_u32)
                .map_or_else(String::new, |c| c.to_string())
        }
        _ => format!("&{};", entity),
    }
}

/// Read an HTML entity from the char iterator (after the `&`),
/// consuming up to and including the `;`.
fn consume_html_entity(chars: &mut impl Iterator<Item = char>) -> String {
    let mut entity = String::new();
    for ec in chars {
        if ec == ';' {
            break;
        }
        entity.push(ec);
        if entity.len() > 10 {
            break;
        }
    }
    decode_html_entity(&entity)
}

/// Convert article HTML to Typst markup, preserving semantic structure.
///
/// Supported tags:
///   h2–h5  → Typst headings (=== / ==== levels, since article is nested content)
///   p      → paragraph break
///   b/strong → *bold*
///   i/em     → _italic_
///   u        → #underline[…]
///   br       → line break
///   blockquote → indented block
///   li       → bullet item
///   Other tags are silently consumed (content preserved).
fn html_to_typst(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();
    let mut bold_open = false;
    let mut italic_open = false;
    let mut underline_open = false;

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
            let is_closing = tag_lower.starts_with('/');
            let tag_name = tag_lower
                .trim_start_matches('/')
                .split_whitespace()
                .next()
                .unwrap_or("");

            match tag_name {
                "br" | "br/" | "br /" => {
                    out.push_str(" \\\n");
                }
                "p" | "div" => {
                    if is_closing {
                        out.push_str("\n\n");
                    }
                }
                "h2" => {
                    if !is_closing {
                        out.push_str("\n=== ");
                    } else {
                        out.push('\n');
                    }
                }
                "h3" => {
                    if !is_closing {
                        out.push_str("\n==== ");
                    } else {
                        out.push('\n');
                    }
                }
                "h4" | "h5" | "h6" => {
                    if !is_closing {
                        out.push_str("\n#text(weight: \"bold\")[");
                    } else {
                        out.push_str("]\n");
                    }
                }
                "b" | "strong" => {
                    if !is_closing && !bold_open {
                        out.push_str("#strong[");
                        bold_open = true;
                    } else if is_closing && bold_open {
                        out.push(']');
                        bold_open = false;
                    }
                }
                "i" | "em" => {
                    if !is_closing && !italic_open {
                        out.push_str("#emph[");
                        italic_open = true;
                    } else if is_closing && italic_open {
                        out.push(']');
                        italic_open = false;
                    }
                }
                "u" => {
                    if !is_closing && !underline_open {
                        out.push_str("#underline[");
                        underline_open = true;
                    } else if is_closing && underline_open {
                        out.push(']');
                        underline_open = false;
                    }
                }
                "blockquote" => {
                    if !is_closing {
                        out.push_str("\n#pad(right: 2em)[");
                    } else {
                        out.push_str("]\n");
                    }
                }
                "li" => {
                    if !is_closing {
                        out.push_str("\n- ");
                    } else {
                        out.push('\n');
                    }
                }
                "tr" => {
                    if is_closing {
                        out.push('\n');
                    }
                }
                "h1" => {
                    if !is_closing {
                        out.push_str("\n== ");
                    } else {
                        out.push('\n');
                    }
                }
                _ => {}
            }
            continue;
        }
        if c == '&' {
            let decoded = consume_html_entity(&mut chars);
            out.push_str(&typst_escape(&decoded));
            continue;
        }
        match c {
            '#' | '*' | '_' | '`' | '<' | '>' | '@' | '$' | '\\' | '~' | '/' | '[' | ']' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }

    if bold_open {
        out.push(']');
    }
    if italic_open {
        out.push(']');
    }
    if underline_open {
        out.push(']');
    }

    // Collapse excessive blank lines
    let mut cleaned = String::with_capacity(out.len());
    let mut newline_count = 0;
    for c in out.chars() {
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

    let hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
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

                let typst_content = html_to_typst(content_html);
                let trimmed = typst_content.trim();
                if !trimmed.is_empty() {
                    markup.push_str("#{\nset text(size: 10pt)\n[\n");
                    markup.push_str(trimmed);
                    markup.push_str("\n]\n}\n\n");
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
    fn test_html_to_typst_paragraphs() {
        let html = "<p>שלום</p><p>עולם</p>";
        let typst = html_to_typst(html);
        assert!(typst.contains("שלום"));
        assert!(typst.contains("עולם"));
        assert!(
            typst.contains("\n\n"),
            "paragraphs should produce blank line"
        );
    }

    #[test]
    fn test_html_to_typst_br() {
        let html = "שורה ראשונה<br>שורה שנייה";
        let typst = html_to_typst(html);
        assert!(typst.contains("שורה ראשונה \\\n"));
    }

    #[test]
    fn test_html_to_typst_entities() {
        let html = "a &amp; b &lt; c &gt; d";
        let typst = html_to_typst(html);
        assert!(typst.contains("\\<"), "< should be escaped");
        assert!(typst.contains("\\>"), "> should be escaped");
        assert!(typst.contains("& b"), "& decoded from &amp;");
    }

    #[test]
    fn test_html_to_typst_bold_italic() {
        let html = "<b>bold</b> and <i>italic</i> text";
        let typst = html_to_typst(html);
        assert!(typst.contains("#strong[bold]"));
        assert!(typst.contains("#emph[italic]"));
    }

    #[test]
    fn test_html_to_typst_headings() {
        let html = "<h2>כותרת</h2><p>תוכן</p>";
        let typst = html_to_typst(html);
        assert!(typst.contains("=== כותרת"));
    }

    #[test]
    fn test_html_to_typst_nested_bold_in_p() {
        let html = "<p>regular <strong>bold text</strong> regular</p>";
        let typst = html_to_typst(html);
        assert!(typst.contains("#strong[bold text]"));
    }

    #[test]
    fn test_html_to_typst_adjacent_to_hebrew() {
        let html = "ו<i>טקסט נטוי</i> בתוכה";
        let typst = html_to_typst(html);
        assert!(
            typst.contains("ו#emph[טקסט נטוי]"),
            "emph works adjacent to Hebrew: {}",
            typst
        );
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
