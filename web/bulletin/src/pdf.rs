//! PDF generation using the Typst typesetting engine.
//!
//! Generates Typst markup from the request data, compiles it in-process
//! via `typst-as-lib`, and exports to PDF via `typst-pdf`.
//! Typst uses rustybuzz (HarfBuzz port) for text shaping, so Hebrew
//! taamim and nikud are positioned correctly via OpenType GPOS tables.

use std::path::Path;

use base64::{Engine, engine::general_purpose::STANDARD};
use typst_as_lib::TypstEngine;

mod daily;

/// Lightweight request types for PDF generation — decoupled from HTTP models.
/// The binary's `models` module converts into these.
#[derive(Debug, Clone)]
pub struct PdfRequest {
    pub sefer_name: String,
    pub perakim: Vec<PdfPerekInput>,
    pub include_cover: bool,
    pub include_toc: bool,
    pub cover_accent_hex: String,
    pub cover_text: PdfCoverText,
}

/// Front-cover lines mirrored from the website's Sefer reader cover, top to
/// bottom; empty lines are skipped and an empty title falls back to the sefer name.
#[derive(Debug, Clone, Default)]
pub struct PdfCoverText {
    pub branding: String,
    pub title: String,
    pub subtitle: String,
    pub edition: String,
}

#[derive(Debug, Clone, Default)]
pub struct PdfPerekInput {
    pub perek_heb: String,
    pub header: String,
    /// One entry per pasuk; each pasuk keeps its קרי/כתיב word segments.
    pub pesukim: Vec<Vec<PdfSegment>>,
    /// Perek illustrations, already encoded as JPEG/PNG/WebP bytes.
    pub images: Vec<PdfImage>,
    /// Articles that belong to this perek: (name, author_name, content_html)
    pub articles: Vec<(String, String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SegmentKind {
    /// Regular word (or a whole pre-joined pasuk string).
    #[default]
    Word,
    /// כתיב that differs from its קרי — printed plain, like the website.
    Ktiv,
    /// קרי that differs from its כתיב — printed as `(קְרִי: …)`, like the website.
    Qri,
}

#[derive(Debug, Clone, Default)]
pub struct PdfSegment {
    pub kind: SegmentKind,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct PdfImage {
    pub bytes: Vec<u8>,
    /// File extension Typst uses to pick the decoder (`jpg`, `png`, `webp`, ...).
    pub ext: String,
    pub caption: String,
}

/// Wrap pre-joined pasuk strings (embedded Tanach data) as single-word pesukim.
pub fn plain_pesukim(pesukim: &[String]) -> Vec<Vec<PdfSegment>> {
    pesukim
        .iter()
        .map(|text| {
            vec![PdfSegment {
                kind: SegmentKind::Word,
                text: text.clone(),
            }]
        })
        .collect()
}

/// Virtual files (images) referenced by the generated markup.
type TypstFiles = Vec<(String, Vec<u8>)>;

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

/// Dashes that no bundled font has a glyph for are printed as ASCII hyphens.
/// En/em dash and minus render via the Frank Ruhl Libre fallback font, and the
/// biblical maqaf (U+05BE) is never touched.
fn normalize_unsupported_dash(c: char) -> char {
    match c {
        '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2015}' => '-',
        _ => c,
    }
}

/// Plain text of an inline HTML fragment (tags dropped, entities decoded).
/// `<br>` and block tags become spaces so words never merge.
fn html_inline_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut chars = html.chars();
    while let Some(c) = chars.next() {
        match c {
            '<' => {
                let tag: String = chars.by_ref().take_while(|&tc| tc != '>').collect();
                let name = tag
                    .trim_start_matches('/')
                    .split(|ch: char| ch.is_whitespace() || ch == '/')
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if matches!(name.as_str(), "br" | "p" | "div" | "li") {
                    out.push(' ');
                }
            }
            '&' => out.push_str(&consume_html_entity(&mut chars)),
            _ => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// True when `lower` has an `<h1` opening tag at byte index `i`.
fn h1_open_at(lower: &str, i: usize) -> bool {
    lower[i..].starts_with("<h1")
        && matches!(
            lower.as_bytes().get(i + 3),
            Some(b'>' | b' ' | b'\t' | b'\n' | b'\r' | b'/')
        )
}

/// Split off the article's complete header: its first `<h1>` plus every `<h1>`
/// that immediately follows it (separated only by whitespace) — a multi-line
/// title is stored as consecutive h1s, and the author must follow the whole
/// header rather than sit between its lines (#2336, #2409).
/// Returns the joined plain text (if any) and the remaining HTML with those
/// headings removed, so each is printed once.
pub(crate) fn split_article_header(html: &str) -> (Option<String>, String) {
    let lower = html.to_ascii_lowercase();
    let Some(open) = lower
        .match_indices("<h1")
        .map(|(i, _)| i)
        .find(|&i| h1_open_at(&lower, i))
    else {
        return (None, html.to_string());
    };
    let mut parts: Vec<String> = Vec::new();
    let mut cursor = open;
    // End of the consumed header run; body resumes here.
    let mut rest_start = open;
    while let Some(content_start) = lower[cursor..].find('>').map(|i| cursor + i + 1) {
        let (content_end, after) = match lower[content_start..].find("</h1") {
            Some(i) => {
                let end = content_start + i;
                let after = lower[end..].find('>').map_or(html.len(), |j| end + j + 1);
                (end, after)
            }
            None => (html.len(), html.len()),
        };
        let text = html_inline_text(&html[content_start..content_end]);
        if text.is_empty() {
            break;
        }
        parts.push(text);
        rest_start = after;
        // The header continues only when another h1 opens right after this
        // one (whitespace between is fine); anything else is body content.
        let skipped = lower[rest_start..].len() - lower[rest_start..].trim_start().len();
        let next = rest_start + skipped;
        if h1_open_at(&lower, next) {
            cursor = next;
        } else {
            break;
        }
    }
    if parts.is_empty() {
        return (None, html.to_string());
    }
    (
        Some(parts.join(" ")),
        format!("{}{}", &html[..open], &html[rest_start..]),
    )
}

/// Decode a `data:image/...;base64,` URI into (extension, bytes).
fn decode_data_image(src: &str) -> Option<(String, Vec<u8>)> {
    let rest = src.trim().strip_prefix("data:image/")?;
    let (mime, data) = rest.split_once(";base64,")?;
    let ext = match mime.to_ascii_lowercase().as_str() {
        "png" => "png",
        "jpeg" | "jpg" => "jpg",
        "gif" => "gif",
        "webp" => "webp",
        "svg+xml" => "svg",
        _ => return None,
    };
    let cleaned: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD
        .decode(cleaned)
        .ok()
        .map(|bytes| (ext.to_string(), bytes))
}

/// Value of an HTML attribute inside a raw tag body (`img src="..." alt=x`).
fn html_attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let start = from + i;
        from = start + name.len();
        let before_ok = start == 0 || lower.as_bytes()[start - 1].is_ascii_whitespace();
        let after = lower[from..].trim_start();
        if !before_ok || !after.starts_with('=') {
            continue;
        }
        let value_start = tag.len() - after.len() + 1;
        let raw = tag[value_start..].trim_start();
        return Some(match raw.chars().next() {
            Some(q @ ('"' | '\'')) => raw[1..].split(q).next().unwrap_or("").to_string(),
            _ => raw.split_whitespace().next().unwrap_or("").to_string(),
        });
    }
    None
}

fn typst_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
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
fn html_to_typst(html: &str, files: &mut TypstFiles) -> String {
    html_to_typst_with_headings(html, files, false)
}

fn daily_html_to_typst(html: &str, files: &mut TypstFiles) -> String {
    html_to_typst_with_headings(html, files, true)
}

fn html_to_typst_with_headings(html: &str, files: &mut TypstFiles, daily_headings: bool) -> String {
    let mut out = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();
    let mut bold_open = false;
    let mut italic_open = false;
    let mut underline_open = false;
    let mut span_closures = Vec::new();

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

            if daily_headings {
                let level = match tag_name {
                    "h1" => Some(1),
                    "h2" => Some(2),
                    "h3" => Some(3),
                    "h4" => Some(4),
                    "h5" => Some(5),
                    "h6" => Some(6),
                    _ => None,
                };
                if let Some(level) = level {
                    if is_closing {
                        out.push_str("];\n");
                    } else {
                        out.push_str(&format!("\n#heading(level: {level}, numbering: none)["));
                    }
                    continue;
                }
            }
            match tag_name {
                "span" => {
                    if is_closing {
                        if let Some(count) = span_closures.pop() {
                            for _ in 0..count {
                                out.push_str("];");
                            }
                        }
                    } else {
                        let style = crate::article_style::InlineStyle::parse(
                            &html_attr(&tag_content, "style").unwrap_or_default(),
                        );
                        let mut options = Vec::new();
                        if let Some(weight) = style.weight {
                            options.push(format!("weight: {weight}"));
                        }
                        if let Some(italic) = style.italic {
                            // Frank Ruhl Libre has no italic face. Use the bundled
                            // Hebrew family with real italic/bold-italic outlines.
                            if italic {
                                options.push("font: \"Taamey Frank CLM\"".into());
                            }
                            options.push(format!(
                                "style: \"{}\"",
                                if italic { "italic" } else { "normal" }
                            ));
                        }
                        let mut count = 0;
                        if !options.is_empty() {
                            out.push_str(&format!("#text({})[", options.join(", ")));
                            count += 1;
                        }
                        if style.underline {
                            out.push_str("#underline[");
                            count += 1;
                        }
                        if style.strike {
                            out.push_str("#strike[");
                            count += 1;
                        }
                        span_closures.push(count);
                    }
                }
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
                        out.push_str("];\n");
                    }
                }
                "img" => {
                    let src = html_attr(&tag_content, "src").unwrap_or_default();
                    if let Some((ext, bytes)) = decode_data_image(&src) {
                        let name = format!("article-image-{}.{}", files.len(), ext);
                        out.push_str(&format!(
                            "\n#align(center, image({}, width: 70%))\n",
                            typst_string(&name)
                        ));
                        files.push((name, bytes));
                    } else if src.starts_with("http://") || src.starts_with("https://") {
                        out.push_str(&format!("#link({})[תמונה];", typst_string(&src)));
                    }
                }
                "b" | "strong" => {
                    if !is_closing && !bold_open {
                        out.push_str("#strong[");
                        bold_open = true;
                    } else if is_closing && bold_open {
                        out.push_str("];");
                        bold_open = false;
                    }
                }
                "i" | "em" => {
                    if !is_closing && !italic_open {
                        out.push_str("#emph[");
                        italic_open = true;
                    } else if is_closing && italic_open {
                        out.push_str("];");
                        italic_open = false;
                    }
                }
                "u" => {
                    if !is_closing && !underline_open {
                        out.push_str("#underline[");
                        underline_open = true;
                    } else if is_closing && underline_open {
                        out.push_str("];");
                        underline_open = false;
                    }
                }
                "blockquote" => {
                    if !is_closing {
                        out.push_str("\n#pad(right: 2em)[");
                    } else {
                        out.push_str("];\n");
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
            _ => out.push(normalize_unsupported_dash(c)),
        }
    }

    for count in span_closures.into_iter().rev() {
        for _ in 0..count {
            out.push_str("];");
        }
    }
    if bold_open {
        out.push_str("];");
    }
    if italic_open {
        out.push_str("];");
    }
    if underline_open {
        out.push_str("];");
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
            '#' | '*' | '_' | '`' | '<' | '>' | '@' | '$' | '\\' | '~' | '/' | '[' | ']' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(normalize_unsupported_dash(c)),
        }
    }
    out
}

fn accent_hex_clean(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('#')
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect()
}

/// Quote text as a Typst string literal: unlike markup, strings keep ASCII
/// quotes literal (no smart quotes) and need no markup escaping.
fn typst_str(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' | '"' => {
                out.push('\\');
                out.push(c);
            }
            '\n' => out.push_str("\\n"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Full-bleed cover in the sefer color, mirroring the reader's `.cover`
/// styles (sefer.module.css): ornament, branding, title, divider, subtitle, edition.
/// Sizes keep the reader's cover-width ratios (title 2.5rem on a ~460px cover).
fn append_cover_page(markup: &mut String, req: &PdfRequest) {
    let hex = accent_hex_clean(&req.cover_accent_hex);
    let hex = if hex.is_empty() {
        "475569".to_string()
    } else {
        hex
    };
    let cover = &req.cover_text;
    let title = if cover.title.is_empty() {
        &req.sefer_name
    } else {
        &cover.title
    };
    let subtitle_line = |text: &str| {
        format!(
            "#text(size: 23pt, fill: white.transparentize(15%), tracking: 0.08em, {})\n\n",
            typst_str(&strip_taamim(text))
        )
    };

    markup.push_str(&format!(
        r#"#page(margin: 0pt, fill: rgb("{hex}"))[
#place(rect(width: 100%, height: 100%, fill: gradient.radial(white.transparentize(94%), white.transparentize(100%), center: (30%, 20%), radius: 60%)))
#place(rect(width: 100%, height: 100%, fill: gradient.linear((white.transparentize(96%), 0%), (white.transparentize(100%), 40%), (black.transparentize(88%), 100%), angle: 90deg)))
#rect(width: 100%, height: 100%, inset: 24pt, stroke: 3pt + white.transparentize(85%))[
#set align(center + horizon)
#set par(justify: false, spacing: 10pt)
#set text(fill: white)
#polygon(fill: white.transparentize(50%), (12pt, 0pt), (15.5pt, 8.5pt), (24pt, 12pt), (15.5pt, 15.5pt), (12pt, 24pt), (8.5pt, 15.5pt), (0pt, 12pt), (8.5pt, 8.5pt))

#v(10pt)
"#,
    ));
    if !cover.branding.is_empty() {
        markup.push_str(&subtitle_line(&cover.branding));
    }
    markup.push_str(&format!(
        "#text(size: 52pt, weight: \"bold\", tracking: 0.05em, {})\n\n#v(8pt)\n#box(width: 40%, height: 1pt, fill: gradient.linear(white.transparentize(100%), white.transparentize(50%), white.transparentize(100%)))\n\n#v(8pt)\n",
        typst_str(&strip_taamim(title))
    ));
    if !cover.subtitle.is_empty() {
        markup.push_str(&subtitle_line(&cover.subtitle));
    }
    if !cover.edition.is_empty() {
        markup.push_str(&format!(
            "#text(size: 18pt, fill: white.transparentize(45%), tracking: 0.04em, {})\n\n",
            typst_str(&strip_taamim(&cover.edition))
        ));
    }
    markup.push_str("]\n]\n");
}

fn append_toc_page(markup: &mut String, req: &PdfRequest) {
    markup.push_str("#align(center)[#text(17pt, weight: \"bold\")[תוכן העניינים]]\n#v(1.2em)\n");
    for (idx, p) in req.perakim.iter().enumerate() {
        let mut line = format!("{} {}", req.sefer_name, p.perek_heb);
        if !p.header.is_empty() {
            line.push_str(" - ");
            line.push_str(&p.header);
        }
        // Link + page number both resolve the perek's label after final layout.
        let label = perek_label(idx);
        markup.push_str(&format!(
            "#block(inset: (right: 0.2em))[#link({label})[{} #box(width: 1fr, repeat[.]) #context counter(page).at({label}).first()]]\n#v(0.28em)\n",
            typst_escape(&strip_taamim(&line))
        ));
    }
}

fn perek_label(idx: usize) -> String {
    format!("<perek-{}>", idx + 1)
}

/// Pasuk markup from its segments, mirroring the website reader: a differing
/// כתיב prints plain and its קרי follows as `(קְרִי: …)` in the reader's label color.
fn pasuk_markup(segments: &[PdfSegment]) -> String {
    let mut out = String::new();
    let mut joins_next = true;
    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }
        if !joins_next {
            out.push(' ');
        }
        joins_next = text.ends_with('־');
        let escaped = typst_escape(&collapse_maqaf_spaces(text));
        if seg.kind == SegmentKind::Qri {
            out.push_str(&format!(
                "(#text(size: 0.75em, fill: rgb(\"#637598\"))[קְרִי:]#h(0.25em);{escaped})"
            ));
        } else {
            out.push_str(&escaped);
        }
    }
    out
}

/// Generate Typst markup string from the request data.
fn generate_typst_markup(req: &PdfRequest) -> (String, TypstFiles) {
    let mut markup = String::with_capacity(16 * 1024);
    let mut files: TypstFiles = Vec::new();

    // Page and text settings. Frank Ruhl Libre supplies glyphs Taamey D lacks
    // (en/em dash, minus) so they don't vanish from article text.
    markup.push_str(
        r#"#set page(paper: "a4", margin: (top: 20mm, bottom: 20mm, left: 15mm, right: 15mm))
#set text(font: ("Taamey D", "Frank Ruhl Libre"), size: 11pt, dir: rtl, lang: "he")
#set par(justify: true)
"#,
    );
    if req.include_toc {
        // Printed numbers match the TOC (both are the physical page counter).
        markup.push_str(
            "#set page(footer: context { let n = counter(page).get().first(); if n > 1 { align(center, text(9pt)[#n]) } })\n",
        );
    }

    if req.include_cover {
        append_cover_page(&mut markup, req);
    }

    if req.include_toc {
        append_toc_page(&mut markup, req);
        markup.push_str("#pagebreak()\n");
    }

    for (idx, perek) in req.perakim.iter().enumerate() {
        if idx > 0 {
            markup.push_str("#pagebreak()\n");
        }
        markup.push_str(&format!("#metadata(none) {}\n", perek_label(idx)));

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

        for (img_idx, image) in perek.images.iter().enumerate() {
            let name = format!("perek-{}-image-{}.{}", idx + 1, img_idx, image.ext);
            markup.push_str(&format!(
                "#align(center, image({}, width: 75%))\n",
                typst_string(&name)
            ));
            if !image.caption.trim().is_empty() {
                markup.push_str(&format!(
                    "#align(center, text(size: 9pt)[{}])\n",
                    typst_escape(image.caption.trim())
                ));
            }
            markup.push_str("#v(0.4em)\n");
            files.push((name, image.bytes.clone()));
        }

        // Section header
        markup.push_str("#align(right, text(size: 12pt, weight: \"bold\")[הפרק])\n");
        markup.push_str("#v(0.3em)\n");

        // Pesukim
        for (i, segments) in perek.pesukim.iter().enumerate() {
            let text = pasuk_markup(segments);
            if text.is_empty() {
                continue;
            }
            let prefix = to_hebrew_letter(i + 1);
            markup.push_str(&format!("*{}* {}\n\n", typst_escape(&prefix), text));
        }

        // Articles
        if !perek.articles.is_empty() {
            markup.push_str("#v(1em)\n");
            for (name, author_name, content_html) in &perek.articles {
                markup.push_str("#v(0.6em)\n");
                // Header is the article's complete leading-h1 run (#2336,
                // interim for #1186); the article name is the fallback, never
                // the abstract. The author follows the complete header after
                // " / " in the same typography (#2409) — not a byline between
                // title lines.
                let (h1, body_html) = split_article_header(content_html);
                let header = h1.unwrap_or_else(|| name.trim().to_string());
                let header_text = match author_name.trim() {
                    "" => header,
                    author => format!("{} / {}", header, author),
                };
                markup.push_str(&format!(
                    "#text(size: 12pt, weight: \"bold\")[{}]\n\n",
                    typst_escape(&header_text)
                ));

                let typst_content = html_to_typst(&body_html, &mut files);
                let trimmed = typst_content.trim();
                if !trimmed.is_empty() {
                    markup.push_str("#{\nset text(size: 10pt)\n[\n");
                    markup.push_str(trimmed);
                    markup.push_str("\n]\n}\n\n");
                }
            }
        }
    }

    (markup, files)
}

/// Build a PDF document from the request payload.
/// Uses Typst for proper Hebrew text shaping (taamim, nikud via GPOS).
pub fn build_pdf(req: &PdfRequest, fonts_dir: &Path) -> anyhow::Result<Vec<u8>> {
    let (markup, files) = generate_typst_markup(req);
    compile_pdf(markup, files, fonts_dir)
}

pub fn build_daily_pdf(
    req: &PdfRequest,
    fonts_dir: &Path,
    date: &str,
    dedications: &[String],
) -> anyhow::Result<Vec<u8>> {
    daily::build(req, fonts_dir, date, dedications)
}

fn compile_pdf(markup: String, files: TypstFiles, fonts_dir: &Path) -> anyhow::Result<Vec<u8>> {
    let read_font = |name: &str| {
        let font_path = fonts_dir.join(name);
        std::fs::read(&font_path)
            .map_err(|e| anyhow::anyhow!("Failed to read font {}: {}", font_path.display(), e))
    };
    let fonts = [
        read_font("TaameyD-Regular.ttf")?,
        read_font("FrankRuhlLibre-Regular.ttf")?,
        read_font("FrankRuhlLibre-Bold.ttf")?,
        read_font("TaameyFrankCLM-Regular.ttf")?,
        read_font("TaameyFrankCLM-Bold.ttf")?,
        read_font("TaameyFrankCLM-Italic.ttf")?,
        read_font("TaameyFrankCLM-BoldItalic.ttf")?,
    ];

    let font_refs: Vec<&[u8]> = fonts.iter().map(Vec::as_slice).collect();
    let engine = TypstEngine::builder()
        .main_file(markup)
        .fonts(font_refs)
        .with_static_file_resolver(
            files
                .iter()
                .map(|(name, bytes)| (name.as_str(), bytes.as_slice())),
        )
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

    fn to_typst(html: &str) -> String {
        html_to_typst(html, &mut Vec::new())
    }

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
        let typst = to_typst(html);
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
        let typst = to_typst(html);
        assert!(typst.contains("שורה ראשונה \\\n"));
    }

    #[test]
    fn test_html_to_typst_entities() {
        let html = "a &amp; b &lt; c &gt; d";
        let typst = to_typst(html);
        assert!(typst.contains("\\<"), "< should be escaped");
        assert!(typst.contains("\\>"), "> should be escaped");
        assert!(typst.contains("& b"), "& decoded from &amp;");
    }

    #[test]
    fn test_html_to_typst_bold_italic() {
        let html = "<b>bold</b> and <i>italic</i> text";
        let typst = to_typst(html);
        assert!(typst.contains("#strong[bold]"));
        assert!(typst.contains("#emph[italic]"));
    }

    #[test]
    fn test_html_to_typst_extended_markup_and_numeric_entities() {
        let html = concat!(
            "<h1>Top</h1>",
            "<h3>Sub</h3>",
            "<h4>Minor</h4>",
            "<blockquote>Quote</blockquote>",
            "<ul><li>One</li><li>Two</li></ul>",
            "<p><u>under</u> &#35; &unknown;</p>"
        );
        let typst = to_typst(html);

        assert!(typst.contains("== Top"));
        assert!(typst.contains("==== Sub"));
        assert!(typst.contains("#text(weight: \"bold\")[Minor]"));
        assert!(typst.contains("#pad(right: 2em)[Quote]"));
        assert!(typst.contains("- One"));
        assert!(typst.contains("- Two"));
        assert!(typst.contains("#underline[under]"));
        assert!(typst.contains("\\#"));
        assert!(typst.contains("&unknown;"));
    }

    #[test]
    fn test_html_to_typst_closes_unbalanced_inline_marks() {
        let typst = to_typst("<p><strong>bold <em>italic <u>under");

        assert!(typst.contains("#strong[bold #emph[italic #underline[under];];];"));
    }

    #[test]
    fn test_html_to_typst_headings() {
        let html = "<h2>כותרת</h2><p>תוכן</p>";
        let typst = to_typst(html);
        assert!(typst.contains("=== כותרת"));
    }

    #[test]
    fn test_html_to_typst_nested_bold_in_p() {
        let html = "<p>regular <strong>bold text</strong> regular</p>";
        let typst = to_typst(html);
        assert!(typst.contains("#strong[bold text]"));
    }

    #[test]
    fn legacy_inline_styles_preserve_nested_typography() {
        let source = to_typst(
            "<p><span style='font-weight: bold'>כאשר <span>פנימי</span></span> רגיל <span style='font-style: italic; text-decoration: underline line-through'>דגש</span></p>",
        );
        assert!(source.contains("#text(weight: 700)[כאשר פנימי]; רגיל"));
        assert!(source.contains("#text(font: \"Taamey Frank CLM\", style: \"italic\")[#underline[#strike[דגש];];];"));
        assert!(
            !to_typst("<span style='background:url(x); font-weight:expression(x)'>בטוח</span>")
                .contains("#text(")
        );
        assert_eq!(
            to_typst("</span>סוף<span style='font-weight:400; font-style:normal'>רגיל"),
            "סוף#text(weight: 400, style: \"normal\")[רגיל];"
        );
    }

    #[test]
    fn daily_articles_keep_all_six_semantic_heading_levels() {
        for level in 1..=6 {
            let html = format!("<h{level}>כותרת</h{level}><p>תוכן</p>");
            let daily = daily_html_to_typst(&html, &mut Vec::new());
            assert!(daily.contains(&format!(
                "#heading(level: {level}, numbering: none)[כותרת];"
            )));
        }
        assert!(to_typst("<h4>כותרת</h4>").contains("#text(weight: \"bold\")[כותרת]"));
    }

    #[test]
    fn test_html_to_typst_adjacent_to_hebrew() {
        let html = "ו<i>טקסט נטוי</i> בתוכה";
        let typst = to_typst(html);
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
                pesukim: plain_pesukim(&["בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים".to_string()]),
                images: vec![],
                articles: vec![],
            }],
            include_cover: false,
            include_toc: false,
            cover_accent_hex: "333333".to_string(),
            cover_text: PdfCoverText::default(),
        };
        let (markup, _) = generate_typst_markup(&req);
        assert!(markup.contains("Taamey D"));
        assert!(markup.contains("rtl"));
        assert!(markup.contains("בראשית א - בריאת העולם"));
        assert!(markup.contains("בְּרֵאשִׁ֖ית")); // taamim preserved in pesukim
    }

    #[test]
    fn test_generate_typst_markup_includes_cover_and_toc_when_requested() {
        let req = PdfRequest {
            sefer_name: "בראשית".to_string(),
            perakim: vec![PdfPerekInput {
                perek_heb: "א".to_string(),
                header: "כותרת".to_string(),
                pesukim: plain_pesukim(&["פסוק".to_string()]),
                images: vec![],
                articles: vec![],
            }],
            include_cover: true,
            include_toc: true,
            cover_accent_hex: "#8B0000".to_string(),
            cover_text: PdfCoverText {
                branding: "תנ\"ך על הפרק".to_string(),
                title: "ספר בראשית".to_string(),
                subtitle: "מקראות גדולות".to_string(),
                edition: "עם מאמרים".to_string(),
            },
        };
        let (markup, _) = generate_typst_markup(&req);
        assert!(markup.contains("תוכן העניינים"));
        assert!(markup.contains("fill: rgb(\"8B0000\")"));
        let branding = markup.find("\"תנ\\\"ך על הפרק\"").expect("branding line");
        let title = markup.find("\"ספר בראשית\"").expect("title line");
        let subtitle = markup.find("\"מקראות גדולות\"").expect("subtitle line");
        let edition = markup.find("\"עם מאמרים\"").expect("edition line");
        assert!(branding < title && title < subtitle && subtitle < edition);
        assert!(markup.contains("בראשית א - כותרת"));
    }

    #[test]
    fn test_generate_typst_markup_handles_empty_headers_blank_pesukim_and_articles() {
        let req = PdfRequest {
            sefer_name: "Genesis".to_string(),
            perakim: vec![PdfPerekInput {
                perek_heb: "1".to_string(),
                header: String::new(),
                pesukim: plain_pesukim(&[
                    "First / escaped".to_string(),
                    "   ".to_string(),
                    "Third".to_string(),
                ]),
                images: vec![],
                articles: vec![(
                    "Article / Name".to_string(),
                    "Author".to_string(),
                    "<p>Body <strong>bold</strong></p>".to_string(),
                )],
            }],
            include_cover: true,
            include_toc: true,
            cover_accent_hex: "###".to_string(),
            cover_text: PdfCoverText::default(),
        };
        let (markup, _) = generate_typst_markup(&req);

        assert!(markup.contains("rgb(\"475569\")"));
        // No cover text: the sefer name is the title and optional lines are skipped.
        assert!(markup.contains("tracking: 0.05em, \"Genesis\")"));
        assert!(!markup.contains("tracking: 0.08em"));
        assert!(markup.contains("Genesis 1"));
        assert!(markup.contains(&format!("*{}* First \\/ escaped", to_hebrew_letter(1))));
        assert!(!markup.contains(&format!("*{}*    ", to_hebrew_letter(2))));
        assert!(markup.contains("[Article \\/ Name \\/ Author]"));
        assert!(markup.contains("#strong[bold]"));
    }

    #[test]
    fn test_typst_str() {
        assert_eq!(typst_str("תנ\"ך"), "\"תנ\\\"ך\"");
        assert_eq!(typst_str("a\\b\nc"), "\"a\\\\b\\nc\"");
    }

    #[test]
    fn test_accent_hex_clean() {
        assert_eq!(accent_hex_clean("#8B0000"), "8B0000");
        assert_eq!(accent_hex_clean("  abcZZ  "), "abc");
    }

    #[test]
    fn test_inline_closers_do_not_swallow_following_parentheses() {
        // Production article 3068 (בראשית ב): `</b>(בראשית א כז)` used to become
        // `#strong[...](...)`, which Typst parses as call arguments.
        let typst = to_typst("<b>אֹתָֽם׃<br></b>(בראשית א כז) <i>x</i>.y <u>z</u>[w]");
        assert!(typst.contains("];(בראשית א כז)"));
        assert!(typst.contains("#emph[x];.y"));
        assert!(typst.contains("#underline[z];\\[w\\]"));
    }

    #[test]
    fn test_article_data_uri_image_is_embedded() {
        let mut files = Vec::new();
        let typst = html_to_typst(
            "<p>לפני</p><img alt=x src=\"data:image/png;base64,iVBO Rw0K\"><img src='https://example.com/a.png'><img src=\"data:image/tiff;base64,AAAA\">",
            &mut files,
        );
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, "article-image-0.png");
        assert_eq!(files[0].1, vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a]);
        assert!(typst.contains("image(\"article-image-0.png\", width: 70%)"));
        assert!(typst.contains("#link(\"https://example.com/a.png\")[תמונה];"));
    }

    #[test]
    fn test_split_article_header() {
        let (h1, rest) = split_article_header(
            "<p>תקציר</p><H1 class=\"t\">ויברא <b>אלהים</b><br>את&nbsp;האדם</h1><p>גוף</p><h1>שנייה</h1>",
        );
        assert_eq!(h1.as_deref(), Some("ויברא אלהים את האדם"));
        assert_eq!(rest, "<p>תקציר</p><p>גוף</p><h1>שנייה</h1>");

        // Consecutive h1s are one multi-line header; a later h1 behind body
        // content stays a section heading.
        let (h1, rest) = split_article_header(
            "<h1>שורה א</h1><h1>שורה ב</h1> \n<h1>שורה ג</h1><p>גוף</p><h1>מאוחרת</h1>",
        );
        assert_eq!(h1.as_deref(), Some("שורה א שורה ב שורה ג"));
        assert_eq!(rest, "<p>גוף</p><h1>מאוחרת</h1>");

        assert_eq!(split_article_header("<h2>a</h2>").0, None);
        assert_eq!(split_article_header("<h1x>a</h1x>").0, None);
        assert_eq!(split_article_header("<h1>  </h1><p>b</p>").0, None);
        assert_eq!(split_article_header("<h1>open").0.as_deref(), Some("open"));
        assert_eq!(split_article_header("<h1").0, None);
    }

    #[test]
    fn test_article_header_uses_leading_h1_run_or_name() {
        let req = PdfRequest {
            sefer_name: "בראשית".to_string(),
            perakim: vec![PdfPerekInput {
                perek_heb: "א".to_string(),
                articles: vec![
                    (
                        "שם המאמר".to_string(),
                        "הרב".to_string(),
                        "<h1>כותרת <i>ראשונה</i></h1><p>גוף</p><h1>כותרת שנייה</h1>".to_string(),
                    ),
                    (
                        "שם בלבד".to_string(),
                        String::new(),
                        "<p>תקציר וגוף</p>".to_string(),
                    ),
                ],
                ..Default::default()
            }],
            include_cover: false,
            include_toc: false,
            cover_accent_hex: String::new(),
            cover_text: PdfCoverText::default(),
        };
        let (markup, _) = generate_typst_markup(&req);
        // Author follows the complete header after " / " in the same style.
        assert!(
            markup.contains("#text(size: 12pt, weight: \"bold\")[כותרת ראשונה \\/ הרב]"),
            "{markup}"
        );
        assert_eq!(markup.matches("כותרת ראשונה").count(), 1);
        // The h1 behind body content stays a genuine section heading.
        assert!(markup.contains("== כותרת שנייה"));
        assert!(!markup.contains("שם המאמר"));
        assert!(markup.contains("#text(size: 12pt, weight: \"bold\")[שם בלבד]"));
        // No separate smaller byline remains anywhere in the export.
        assert_eq!(markup.matches("#text(size: 9pt)[").count(), 0);
    }

    #[test]
    fn test_article_author_follows_complete_multiline_header() {
        // The issue #2409 fixture: a two-line h1 title with the author placed
        // between its lines in a smaller style.
        let req = PdfRequest {
            sefer_name: "בראשית".to_string(),
            perakim: vec![PdfPerekInput {
                perek_heb: "יב".to_string(),
                articles: vec![(
                    "מדוע התורה לא כתבה על צדקותו של אברהם אבינו ומה ניתן ללמוד על כך לדורות".to_string(),
                    "הרב איתן שנדורפי שליט\"א".to_string(),
                    "<h1>מדוע התורה לא כתבה על צדקותו של אברהם אבינו&nbsp;</h1><h1>ומה ניתן ללמוד על כך לדורות?</h1><p>בתחילת פרק י\"ב נאמר</p>"
                        .to_string(),
                )],
                ..Default::default()
            }],
            include_cover: false,
            include_toc: false,
            cover_accent_hex: String::new(),
            cover_text: PdfCoverText::default(),
        };
        let (markup, _) = generate_typst_markup(&req);
        assert!(
            markup.contains(
                "#text(size: 12pt, weight: \"bold\")[מדוע התורה לא כתבה על צדקותו של אברהם אבינו ומה ניתן ללמוד על כך לדורות? \\/ הרב איתן שנדורפי שליט\"א]"
            ),
            "{markup}"
        );
        // The second title line is consumed by the header, not re-rendered as
        // a body heading after the author.
        assert!(!markup.contains("== ומה ניתן ללמוד"));
        assert_eq!(markup.matches("#text(size: 9pt)[").count(), 0);
    }

    #[test]
    fn test_qri_ktiv_segments_match_reader_convention() {
        let segments = vec![
            PdfSegment {
                kind: SegmentKind::Word,
                text: "עַל־".to_string(),
            },
            PdfSegment {
                kind: SegmentKind::Ktiv,
                text: "ויצא".to_string(),
            },
            PdfSegment {
                kind: SegmentKind::Qri,
                text: "וַיֵּצֵ֖א".to_string(),
            },
            PdfSegment {
                kind: SegmentKind::Word,
                text: " ".to_string(),
            },
            PdfSegment {
                kind: SegmentKind::Word,
                text: "נֹחַ".to_string(),
            },
        ];
        assert_eq!(
            pasuk_markup(&segments),
            "עַל־ויצא (#text(size: 0.75em, fill: rgb(\"#637598\"))[קְרִי:]#h(0.25em);וַיֵּצֵ֖א) נֹחַ"
        );
    }

    #[test]
    fn test_unsupported_dashes_normalized_but_maqaf_kept() {
        assert_eq!(
            typst_escape("a\u{2010}b\u{2011}c\u{2012}d\u{2015}e"),
            "a-b-c-d-e"
        );
        assert_eq!(
            typst_escape("a\u{2013}b\u{2014}c\u{2212}d־ה"),
            "a\u{2013}b\u{2014}c\u{2212}d־ה"
        );
        assert!(to_typst("<p>א\u{2015}ב</p>").contains("א-ב"));
    }

    #[test]
    fn test_toc_links_and_page_numbers_resolve_labels() {
        let req = PdfRequest {
            sefer_name: "מלאכי".to_string(),
            perakim: vec![
                PdfPerekInput {
                    perek_heb: "א".to_string(),
                    ..Default::default()
                },
                PdfPerekInput {
                    perek_heb: "ב".to_string(),
                    ..Default::default()
                },
            ],
            include_cover: true,
            include_toc: true,
            cover_accent_hex: String::new(),
            cover_text: PdfCoverText::default(),
        };
        let (markup, _) = generate_typst_markup(&req);
        for label in ["<perek-1>", "<perek-2>"] {
            assert!(markup.contains(&format!("#metadata(none) {label}")));
            assert!(markup.contains(&format!("#link({label})[")));
            assert!(markup.contains(&format!("counter(page).at({label})")));
        }
        assert!(markup.contains("#set page(footer:"));
    }

    #[test]
    fn test_perek_images_become_typst_files() {
        let req = PdfRequest {
            sefer_name: "בראשית".to_string(),
            perakim: vec![PdfPerekInput {
                perek_heb: "ב".to_string(),
                images: vec![PdfImage {
                    bytes: vec![1, 2, 3],
                    ext: "jpg".to_string(),
                    caption: "ארבעת הנהרות".to_string(),
                }],
                ..Default::default()
            }],
            include_cover: false,
            include_toc: false,
            cover_accent_hex: String::new(),
            cover_text: PdfCoverText::default(),
        };
        let (markup, files) = generate_typst_markup(&req);
        assert!(markup.contains("image(\"perek-1-image-0.jpg\", width: 75%)"));
        assert!(markup.contains("[ארבעת הנהרות]"));
        assert_eq!(
            files,
            vec![("perek-1-image-0.jpg".to_string(), vec![1, 2, 3])]
        );
    }
}
