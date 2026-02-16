//! PDF generation using genpdf.
//!
//! Handles Hebrew RTL text by reversing grapheme clusters so the
//! LTR-only PDF renderer produces the correct visual result.

use std::path::Path;

use genpdf::elements::{Break, PageBreak, Paragraph};
use genpdf::fonts;
use genpdf::style::Style;
use genpdf::{Alignment, Document, Margins, SimplePageDecorator};
use unicode_segmentation::UnicodeSegmentation;

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
}

/// Reverse grapheme clusters in a string so that an LTR renderer draws it
/// as correct visual RTL. Preserves combining marks attached to their bases.
pub fn reverse_graphemes(text: &str) -> String {
    text.graphemes(true).rev().collect()
}

/// Strip Hebrew cantillation marks (taamim, U+0591–U+05AF) while keeping
/// nikud (U+05B0–U+05BD, U+05BF, U+05C1–U+05C2, U+05C4–U+05C5, U+05C7).
pub fn strip_taamim(text: &str) -> String {
    text.chars()
        .filter(|&c| !(('\u{0591}'..='\u{05AF}').contains(&c)))
        .collect()
}

/// Build a PDF document from the request payload.
pub fn build_pdf(
    req: &PdfRequest,
    articles: &[(String, String, String)], // (name, author_name, content)
    fonts_dir: &Path,
) -> anyhow::Result<Document> {
    // Load font family from files.
    // genpdf::fonts::from_files expects files named FrankRuhlLibre-{Regular,Bold,Italic,BoldItalic}.ttf
    let font_family = fonts::from_files(fonts_dir, "FrankRuhlLibre", None)
        .map_err(|e| anyhow::anyhow!("Failed to load fonts: {}", e))?;

    let mut doc = Document::new(font_family);
    doc.set_title(req.sefer_name.clone());
    doc.set_paper_size(genpdf::PaperSize::A4);

    // Page decorator with margins
    let mut decorator = SimplePageDecorator::new();
    decorator.set_margins(Margins::trbl(20, 15, 20, 15));
    doc.set_page_decorator(decorator);

    // ── Title ──
    let title_text = reverse_graphemes(&strip_taamim(&req.sefer_name));
    doc.push(
        Paragraph::new("")
            .aligned(Alignment::Center)
            .styled_string(title_text, Style::new().bold().with_font_size(22)),
    );
    doc.push(Break::new(1));

    // ── Perakim ──
    for (idx, perek) in req.perakim.iter().enumerate() {
        if idx > 0 {
            doc.push(PageBreak::new());
        }
        push_perek(&mut doc, perek, &req.sefer_name);
    }

    // ── Articles ──
    if !articles.is_empty() {
        doc.push(Break::new(1.5));
        doc.push(
            Paragraph::new("")
                .aligned(Alignment::Center)
                .styled_string(
                    reverse_graphemes("מאמרים"),
                    Style::new().bold().with_font_size(16),
                ),
        );
        doc.push(Break::new(0.5));

        for (name, author_name, content) in articles {
            push_article(&mut doc, name, author_name, content);
        }
    }

    Ok(doc)
}

/// Render a single perek into the document.
fn push_perek(doc: &mut Document, perek: &PdfPerekInput, sefer_name: &str) {
    // Combined title: "סֵפֶר פרק — header"
    let title_text = if perek.header.is_empty() {
        format!("{} {}", sefer_name, perek.perek_heb)
    } else {
        format!("{} {} — {}", sefer_name, perek.perek_heb, perek.header)
    };
    doc.push(
        Paragraph::new("")
            .aligned(Alignment::Right)
            .styled_string(
                reverse_graphemes(&strip_taamim(&title_text)),
                Style::new().bold().with_font_size(14),
            ),
    );
    doc.push(Break::new(0.5));

    // Section label
    doc.push(
        Paragraph::new("")
            .aligned(Alignment::Right)
            .styled_string(
                reverse_graphemes("הפרק"),
                Style::new().bold().with_font_size(12),
            ),
    );
    doc.push(Break::new(0.3));

    // Pesukim
    for (i, pasuk_text) in perek.pesukim.iter().enumerate() {
        let cleaned = strip_taamim(pasuk_text);
        if cleaned.trim().is_empty() {
            continue;
        }

        let prefix = to_hebrew_letter(i + 1);
        let full_text = format!("{} {}", prefix, cleaned);

        doc.push(
            Paragraph::new("")
                .aligned(Alignment::Right)
                .styled_string(
                    reverse_graphemes(&full_text),
                    Style::new().with_font_size(11),
                ),
        );
    }
}

/// Render an article section.
fn push_article(doc: &mut Document, name: &str, author_name: &str, content: &str) {
    doc.push(Break::new(0.8));

    // Article title with author
    let header = format!("{} / {}", name, author_name);
    doc.push(
        Paragraph::new("")
            .aligned(Alignment::Right)
            .styled_string(
                reverse_graphemes(&header),
                Style::new().bold().with_font_size(12),
            ),
    );
    doc.push(Break::new(0.3));

    // Article content — split into paragraphs on double-newline
    for para_text in content.split("\n\n") {
        let trimmed = para_text.trim();
        if trimmed.is_empty() {
            continue;
        }
        doc.push(
            Paragraph::new("")
                .aligned(Alignment::Right)
                .styled_string(
                    reverse_graphemes(trimmed),
                    Style::new().with_font_size(10),
                ),
        );
        doc.push(Break::new(0.2));
    }
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

    // Special cases: 15 = ט"ו, 16 = ט"ז
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reverse_graphemes_simple() {
        assert_eq!(reverse_graphemes("אבג"), "גבא");
    }

    #[test]
    fn test_reverse_graphemes_with_nikud() {
        let input = "שָׁלוֹם";
        let reversed = reverse_graphemes(input);
        let clusters: Vec<&str> = input.graphemes(true).collect();
        let expected: String = clusters.iter().rev().copied().collect();
        assert_eq!(reversed, expected);
    }

    #[test]
    fn test_strip_taamim() {
        let input = "בְּ\u{0591}רֵאשִׁית";
        let stripped = strip_taamim(input);
        assert!(!stripped.contains('\u{0591}'));
        assert!(stripped.contains('ְ')); // nikud kept
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
}
