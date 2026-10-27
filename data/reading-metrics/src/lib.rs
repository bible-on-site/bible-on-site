//! Shared reading-metrics counting contract (#2607) — the Rust port of
//! `web/shared/reading-metrics`, used by the packaged-sqlite pipelines so the
//! app packs carry the exact metric rows MySQL holds. `count_text_words`,
//! `html_to_readable_segments`/`html_to_plain_text` and `pasuk_counted_text`
//! are byte-for-byte ports of the TypeScript implementations; the counting
//! policy is versioned (`READING_METRICS_CALC_VERSION`) and must only change
//! together with the TS original.

use sha2::{Digest, Sha256};
use unicode_categories::UnicodeCategories;
use unicode_normalization::UnicodeNormalization;

/// Baseline Hebrew silent-reading rate — a rounded product choice informed
/// by Brysbaert's 2019 meta-analysis (224 wpm for Hebrew). An estimate, not
/// study time, recitation length or measured reader performance.
pub const READING_WORDS_PER_MINUTE: i64 = 220;

/// Counting-policy version persisted on every metric row. Bump only together
/// with the TS contract (`web/shared/reading-metrics/policy.ts`).
///
/// v1: script/style removal, entity decode, NFD mark strip (niqqud/taamim
/// never become words), quote/geresh/gershayim strip, maqaf and intra-word
/// hyphen join words, everything else separates.
pub const READING_METRICS_CALC_VERSION: i64 = 1;

/// `ceil(word_count * 60 / words_per_minute)`. A verified-empty body honestly
/// estimates 0 — callers distinguish it from a missing metric and never
/// fabricate a one-minute floor onto empty content.
pub fn estimate_reading_seconds(word_count: i64) -> i64 {
    if word_count <= 0 {
        return 0;
    }
    word_count
        .saturating_mul(60)
        .saturating_add(READING_WORDS_PER_MINUTE - 1)
        / READING_WORDS_PER_MINUTE
}

/// sha256 hex of the readable counted text — the stored `source_hash`.
pub fn metric_source_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_quote_like(c: char) -> bool {
    matches!(
        c,
        '\'' | '"' | '\u{05f3}' | '\u{05f4}' | '\u{2018}' | '\u{2019}' | '\u{201c}' | '\u{201d}'
    )
}

fn is_joiner(c: char) -> bool {
    matches!(c, '-' | '\u{05be}')
}

fn is_combining_mark(c: char) -> bool {
    // TS \p{M}: Mn + Mc + Me.
    c.is_mark_nonspacing() || c.is_mark_spacing_combining() || c.is_mark_enclosing()
}

fn is_word_char(c: char) -> bool {
    // TS [\p{L}\p{N}]: all letters + all numbers (Nd, Nl, No).
    c.is_letter() || c.is_number()
}

/// Normalize text to its counted token stream: letter/digit runs that may
/// carry intra-word joiners; separators collapse to single spaces.
pub fn normalize_for_count(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.nfd() {
        if is_combining_mark(c) || is_quote_like(c) {
            continue;
        }
        if is_word_char(c) || is_joiner(c) {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim_end().to_string()
}

/// Word count of plain (markup-free) text under calc_version 1.
pub fn count_text_words(text: &str) -> i64 {
    let normalized = normalize_for_count(text);
    if normalized.is_empty() {
        return 0;
    }
    normalized
        .split(' ')
        .map(|token| token.trim_matches(is_joiner))
        .filter(|token| !token.is_empty())
        .count() as i64
}

// ---------------------------------------------------------------------------
// HTML → readable text (port of web/shared/reading-metrics/text.ts)
// ---------------------------------------------------------------------------

/// Block-level elements whose close tag ends a readable block.
fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "address"
            | "article"
            | "aside"
            | "blockquote"
            | "dd"
            | "details"
            | "dialog"
            | "div"
            | "dl"
            | "dt"
            | "fieldset"
            | "figcaption"
            | "figure"
            | "footer"
            | "form"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "hr"
            | "li"
            | "main"
            | "nav"
            | "ol"
            | "p"
            | "pre"
            | "section"
            | "summary"
            | "table"
            | "tbody"
            | "td"
            | "tfoot"
            | "th"
            | "thead"
            | "tr"
            | "ul"
    )
}

/// Void tags that break text on their own (no close tag needed).
fn is_void_break_tag(name: &str) -> bool {
    matches!(name, "br" | "hr")
}

fn is_tag_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric()
}

fn named_entity(body: &str) -> Option<&'static str> {
    match body {
        "lt" => Some("<"),
        "gt" => Some(">"),
        "amp" => Some("&"),
        "quot" => Some("\""),
        "apos" => Some("'"),
        "nbsp" => Some("\u{a0}"),
        _ => None,
    }
}

/// Decode the entities that appear in stored content: the standard XML set,
/// `nbsp`, and numeric (decimal/hex) references. Unknown or out-of-range
/// entities stay literal.
pub fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'&' {
            // Non-ASCII spans are copied verbatim — '&' is ASCII so scanning
            // byte-wise is safe.
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] != b'&' {
                j += 1;
            }
            out.push_str(&text[i..j]);
            i = j;
            continue;
        }
        // Try to match `&<body>;` where body is #xHEX | #digits | [a-zA-Z]+.
        let body_start = i + 1;
        let mut k = body_start;
        // TS regex: #x[0-9a-fA-F]+ | #\d+ | [a-zA-Z]+ — only lowercase "#x".
        let is_hex = bytes.get(body_start) == Some(&b'#')
            && bytes.get(body_start + 1).is_some_and(|c| *c == b'x');
        if is_hex {
            k = body_start + 2;
            while k < bytes.len() && bytes[k].is_ascii_hexdigit() {
                k += 1;
            }
        } else if bytes.get(body_start) == Some(&b'#') {
            k = body_start + 1;
            while k < bytes.len() && bytes[k].is_ascii_digit() {
                k += 1;
            }
        } else {
            while k < bytes.len() && bytes[k].is_ascii_alphabetic() {
                k += 1;
            }
        }
        let body_len = k
            - body_start
            - if is_hex {
                2
            } else if bytes.get(body_start) == Some(&b'#') {
                1
            } else {
                0
            };
        let matched = body_len > 0 && bytes.get(k) == Some(&b';');
        if !matched {
            out.push('&');
            i += 1;
            continue;
        }
        let entity = &text[i..=k];
        let body = &text[body_start
            + if is_hex {
                2
            } else if bytes.get(body_start) == Some(&b'#') {
                1
            } else {
                0
            }..k];
        if is_hex || bytes.get(body_start) == Some(&b'#') {
            let radix = if is_hex { 16 } else { 10 };
            match u32::from_str_radix(body, radix)
                .ok()
                .filter(|cp| *cp <= 0x10ffff)
            {
                Some(cp) => match char::from_u32(cp) {
                    Some(ch) => out.push(ch),
                    None => out.push_str(entity),
                },
                None => out.push_str(entity),
            }
        } else {
            match named_entity(body) {
                Some(decoded) => out.push_str(decoded),
                None => out.push_str(entity),
            }
        }
        i = k + 1;
    }
    out
}

/// Locate the earliest `<script>`/`<style>` open tag. Returns
/// `(start, after_end)` — the index just past the matching close tag, or just
/// past the open tag when the close is missing.
fn find_script_or_style(text: &str) -> Option<(usize, usize)> {
    let lower = text.to_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for name in ["script", "style"] {
        let open = format!("<{name}");
        let mut search = 0usize;
        while let Some(offset) = lower[search..].find(&open) {
            let pos = search + offset;
            if best.is_some_and(|(best_pos, _)| pos >= best_pos) {
                break;
            }
            let at = pos + open.len();
            // The tag name must end at a non-identifier char or EOF, so
            // `<scriptx` never aliases a real script block.
            let next = lower.as_bytes().get(at).map(|b| *b as char);
            match next {
                // Tag open dangling at EOF — treat everything past it as the
                // block (no close tag to find).
                None => {
                    best = Some((pos, at.min(text.len())));
                    break;
                }
                Some(c) if !is_tag_name_char(c) => {
                    let close = format!("</{name}");
                    let after = lower[at..]
                        .find(&close)
                        .map(|o| at + o + close.len() + 1)
                        .unwrap_or(at);
                    best = Some((pos, after.min(text.len())));
                    break;
                }
                _ => {
                    search = at;
                }
            }
        }
    }
    best
}

/// Remove every `<script>…</script>` and `<style>…</style>` block.
pub fn strip_scripts_and_styles(text: &str) -> String {
    if !text.contains('<') {
        return text.to_string();
    }
    let mut rest = text;
    let mut out = String::new();
    while let Some((start, end)) = find_script_or_style(rest) {
        out.push_str(&rest[..start]);
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

struct TagMatch {
    /// Index just past the tag's `>`.
    end: usize,
    /// Lowercased tag name ("" when the construct carried none).
    name: String,
    closing: bool,
    terminated: bool,
}

/// Parse a tag starting at `text[start] === '<'`. Returns None when the '<'
/// is literal text (not followed by a letter, '/', '!' or '?'). An
/// unterminated tag consumes to EOF (`terminated: false`).
fn parse_tag_at(text: &str, start: usize) -> Option<TagMatch> {
    let bytes = text.as_bytes();
    let next = *bytes.get(start + 1)?;
    if !(next.is_ascii_alphabetic() || next == b'/' || next == b'!' || next == b'?') {
        return None;
    }
    let mut i = start + 1;
    let mut closing = false;
    if bytes[i] == b'/' {
        closing = true;
        i += 1;
    }
    let mut name = String::new();
    while i < bytes.len() && is_tag_name_char(bytes[i] as char) {
        name.push((bytes[i] as char).to_ascii_lowercase());
        i += 1;
    }
    let mut terminated = false;
    while i < bytes.len() {
        if bytes[i] == b'>' {
            terminated = true;
            i += 1;
            break;
        }
        i += 1;
    }
    Some(TagMatch {
        end: i,
        name,
        closing,
        terminated,
    })
}

/// Split authored/stored HTML into readable-text segments: one per readable
/// block, in document order. Entities decode inside each segment, scripts and
/// styles never reach a segment, and every block-boundary tag ends the
/// current segment.
pub fn html_to_readable_segments(html: &str) -> Vec<String> {
    let cleaned = strip_scripts_and_styles(html);
    let mut segments: Vec<String> = Vec::new();
    let mut current = String::new();
    let bytes = cleaned.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'<' {
            // Copy one UTF-8 char (bytes[i] is not '<', an ASCII byte, so the
            // next char boundary is safe to walk by char).
            let ch_len = cleaned[i..].chars().next().unwrap().len_utf8();
            current.push_str(&cleaned[i..i + ch_len]);
            i += ch_len;
            continue;
        }
        match parse_tag_at(&cleaned, i) {
            None => {
                current.push('<');
                i += 1;
            }
            Some(tag) => {
                if !tag.terminated {
                    // '<tag' dangling at EOF stays literal text.
                    current.push_str(&cleaned[i..]);
                    break;
                }
                if ((tag.closing && is_block_tag(&tag.name)) || is_void_break_tag(&tag.name))
                    && !current.is_empty()
                {
                    segments.push(std::mem::take(&mut current));
                }
                i = tag.end;
            }
        }
    }
    if !current.is_empty() {
        segments.push(current);
    }
    segments.iter().map(|s| decode_entities(s)).collect()
}

/// Flat readable text of an HTML fragment — the segments joined by spaces.
pub fn html_to_plain_text(html: &str) -> String {
    html_to_readable_segments(html).join(" ")
}

/// Whole-content words plus per-readable-block counts over authored HTML —
/// the `*_metric` + `*_metric_block` pair. Word-free blocks are dropped so
/// only units that consume reading time are stored; block_idx is the ordinal
/// of the surviving block.
pub fn count_html_blocks(html: &str) -> (i64, Vec<i64>) {
    if html.is_empty() {
        return (0, Vec::new());
    }
    let blocks: Vec<i64> = html_to_readable_segments(html)
        .iter()
        .map(|segment| count_text_words(segment))
        .filter(|count| *count > 0)
        .collect();
    (blocks.iter().sum(), blocks)
}

// ---------------------------------------------------------------------------
// Canonical-scripture counting (port of web/shared/reading-metrics/perek.ts)
// ---------------------------------------------------------------------------

/// The minimal tanah-view pasuk segment shape the counting contract needs.
pub struct CorpusSegment<'a> {
    pub segment_type: &'a str,
    pub value: Option<&'a str>,
    /// Set on ktiv that differs from its qri pair (0 = orphan ktiv).
    pub qri_offset: Option<i32>,
}

/// The counted (qri) word stream of one pasuk: readable segments joined in
/// order, ktiv variants with a qri pair and section marks skipped, and a
/// trailing maqaf gluing the next word without a separator.
pub fn pasuk_counted_text<'a>(segments: impl Iterator<Item = CorpusSegment<'a>>) -> String {
    let mut words: Vec<String> = Vec::new();
    let mut glue = false;
    for segment in segments {
        if segment.segment_type == "ptuha" || segment.segment_type == "stuma" {
            continue;
        }
        if segment.segment_type == "ktiv" && segment.qri_offset.is_some_and(|o| o != 0) {
            continue;
        }
        let value = segment.value.unwrap_or("");
        if glue && !words.is_empty() {
            words.last_mut().unwrap().push_str(value);
        } else {
            words.push(value.to_string());
        }
        glue = value.ends_with('\u{05be}');
    }
    words.join(" ").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cases below mirror web/admin/tests/unit/server/reading-metrics-count.test.ts
    // — the port is only faithful while both suites assert the same outputs.

    #[test]
    fn estimate_reading_seconds_uses_ceil_and_zero_floor() {
        assert_eq!(estimate_reading_seconds(220), 60);
        assert_eq!(estimate_reading_seconds(221), 61);
        assert_eq!(estimate_reading_seconds(1), 1);
        assert_eq!(estimate_reading_seconds(440), 120);
        assert_eq!(estimate_reading_seconds(0), 0);
        assert_eq!(estimate_reading_seconds(-5), 0);
        assert_eq!(READING_WORDS_PER_MINUTE, 220);
        assert_eq!(READING_METRICS_CALC_VERSION, 1);
    }

    #[test]
    fn normalize_strips_niqqud_and_taamim_without_splitting() {
        assert_eq!(normalize_for_count("בְּרֵאשִׁ֖ית"), "בראשית");
        assert_eq!(normalize_for_count("בָּרָ֣א אֱלֹהִ֑ים"), "ברא אלהים");
    }

    #[test]
    fn normalize_drops_quotes_so_abbreviations_stay_whole() {
        assert_eq!(normalize_for_count("תנ\"ך"), "תנך");
        assert_eq!(normalize_for_count("שליט\"א"), "שליטא");
        assert_eq!(normalize_for_count("שמואל א'"), "שמואל א");
    }

    #[test]
    fn normalize_treats_maqaf_and_hyphen_as_joiners() {
        assert_eq!(normalize_for_count("בית־לחם"), "בית־לחם");
        assert_eq!(normalize_for_count("well-known"), "well-known");
    }

    #[test]
    fn normalize_collapses_punctuation_and_whitespace() {
        assert_eq!(normalize_for_count("  שלום,   עולם! "), "שלום עולם");
        assert_eq!(normalize_for_count("א:ב"), "א ב");
        assert_eq!(normalize_for_count("א\u{a0}ב"), "א ב");
    }

    #[test]
    fn count_text_words_matches_the_ts_cases() {
        assert_eq!(count_text_words("בראשית ברא אלהים"), 3);
        assert_eq!(count_text_words("בית־לחם"), 1);
        assert_eq!(count_text_words("וכל־הארץ"), 1);
        assert_eq!(count_text_words("א - ב"), 2);
        assert_eq!(count_text_words("א -ב"), 2);
        assert_eq!(count_text_words("-"), 0);
        assert_eq!(count_text_words("־"), 0);
        assert_eq!(count_text_words("hello world"), 2);
        assert_eq!(count_text_words("שנת 2024"), 2);
        assert_eq!(count_text_words("word's end"), 2);
        assert_eq!(count_text_words(""), 0);
        assert_eq!(count_text_words("   "), 0);
        assert_eq!(count_text_words("…"), 0);
    }

    #[test]
    fn html_to_plain_text_strips_markup_and_decodes_entities() {
        assert_eq!(
            html_to_plain_text("<b>bold</b> and <i>it</i>"),
            "bold and it"
        );
        assert_eq!(
            html_to_plain_text("fish &lt; meat &amp; &gt; veg"),
            "fish < meat & > veg"
        );
        assert_eq!(html_to_plain_text("a&nbsp;b"), "a\u{a0}b");
        assert_eq!(count_text_words(&html_to_plain_text("a&nbsp;b")), 2);
        assert_eq!(html_to_plain_text("&#65;&#x42;"), "AB");
    }

    #[test]
    fn html_to_plain_text_removes_script_and_style_bodies() {
        assert_eq!(html_to_plain_text("x<script>alert(1)</script>y"), "xy");
        assert_eq!(html_to_plain_text("a<style>x{}</style>b"), "ab");
        assert_eq!(html_to_plain_text("a<scriptx>y</scriptx>b"), "ayb");
    }

    #[test]
    fn html_to_plain_text_keeps_literal_angle_brackets() {
        assert_eq!(html_to_plain_text("a < b"), "a < b");
        assert_eq!(html_to_plain_text("dangling <"), "dangling <");
        assert_eq!(html_to_plain_text("unclosed <b text"), "unclosed <b text");
    }

    #[test]
    fn html_to_plain_text_treats_block_boundaries_as_separators() {
        assert_eq!(html_to_plain_text("<p>one</p><p>two</p>"), "one two");
        assert_eq!(html_to_plain_text("a<br>b"), "a b");
        assert_eq!(html_to_plain_text("<div>x</div>tail"), "x tail");
    }

    #[test]
    fn readable_segments_split_at_block_closes_and_void_breaks() {
        assert_eq!(
            html_to_readable_segments("<p>א</p><p>ב</p>"),
            vec!["א", "ב"]
        );
        assert_eq!(html_to_readable_segments("a<br>b"), vec!["a", "b"]);
        assert_eq!(
            html_to_readable_segments("<ul><li>x</li><li>y</li></ul>"),
            vec!["x", "y"]
        );
        assert_eq!(
            html_to_readable_segments("<p>a <b>bold</b> c</p>"),
            vec!["a bold c"]
        );
    }

    #[test]
    fn decode_entities_handles_named_numeric_and_bogus() {
        assert_eq!(decode_entities("&quot;q&quot;"), "\"q\"");
        assert_eq!(decode_entities("&#39; &#x27;"), "' '");
        assert_eq!(decode_entities("&bogus;"), "&bogus;");
        assert_eq!(decode_entities("&#x110000;"), "&#x110000;");
        assert_eq!(
            decode_entities("no &amp entity here"),
            "no &amp entity here"
        );
    }

    #[test]
    fn strip_scripts_and_styles_is_noop_without_markup() {
        assert_eq!(strip_scripts_and_styles("plain text"), "plain text");
    }

    #[test]
    fn count_html_blocks_counts_in_order_and_drops_word_free_blocks() {
        assert_eq!(count_html_blocks(""), (0, vec![]));
        assert_eq!(count_html_blocks("<p></p>"), (0, vec![]));
        let html = "<p>אחת שתים</p><p>שלוש</p><ul><li>ארבע חמש</li></ul>";
        assert_eq!(count_html_blocks(html), (5, vec![2, 1, 2]));
        assert_eq!(
            count_html_blocks("<p>אחת</p><p></p><p>שתים</p>").1,
            vec![1, 1]
        );
    }

    fn seg<'a>(segment_type: &'a str, value: &'a str) -> CorpusSegment<'a> {
        CorpusSegment {
            segment_type,
            value: Some(value),
            qri_offset: None,
        }
    }

    #[test]
    fn pasuk_counted_text_counts_qri_and_skips_section_marks() {
        let segments = vec![
            seg("qri", "בְּרֵאשִׁ֖ית"),
            seg("qri", "בָּרָ֣א"),
            CorpusSegment {
                segment_type: "stuma",
                value: None,
                qri_offset: None,
            },
            seg("qri", "אֱלֹהִ֑ים"),
        ];
        assert_eq!(
            count_text_words(&pasuk_counted_text(segments.into_iter())),
            3
        );
    }

    #[test]
    fn pasuk_counted_text_skips_paired_ktiv_keeps_orphan() {
        let paired = vec![
            CorpusSegment {
                segment_type: "ktiv",
                value: Some("abc"),
                qri_offset: Some(1),
            },
            seg("qri", "def"),
        ];
        assert_eq!(pasuk_counted_text(paired.into_iter()), "def");
        let orphan = vec![CorpusSegment {
            segment_type: "ktiv",
            value: Some("abc"),
            qri_offset: Some(0),
        }];
        assert_eq!(pasuk_counted_text(orphan.into_iter()), "abc");
    }

    #[test]
    fn pasuk_counted_text_glues_maqaf_final_segment() {
        let segments = vec![seg("qri", "בית־"), seg("qri", "לחם")];
        assert_eq!(pasuk_counted_text(segments.into_iter()), "בית־לחם");
        let segments = vec![seg("qri", "בית־"), seg("qri", "לחם")];
        assert_eq!(
            count_text_words(&pasuk_counted_text(segments.into_iter())),
            1
        );
    }

    #[test]
    fn pasuk_counted_text_handles_value_free_segments() {
        let segments = vec![
            CorpusSegment {
                segment_type: "ptuha",
                value: None,
                qri_offset: None,
            },
            seg("qri", "א"),
        ];
        assert_eq!(pasuk_counted_text(segments.into_iter()), "א");
    }
}
