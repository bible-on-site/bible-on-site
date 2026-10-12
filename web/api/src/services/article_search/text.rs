//! Hebrew-aware text processing for the article search index.
//!
//! Mirrors the app's `SearchText` normalization (Helpers/SearchText.cs) so the
//! remote index and the local FTS index tokenize identically, and additionally
//! folds Hebrew final-letter forms (ם→מ, ן→נ, ף→פ, ץ→צ, ך→כ) because they are
//! positional variants of the same letter.

use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

/// Tags whose content is never article text — dropped together with contents.
const SKIP_CONTENT_TAGS: [&str; 2] = ["script", "style"];

/// Tags that separate phrases — rendered as a space so adjacent words in
/// different blocks do not merge into a single token.
const BLOCK_TAGS: [&str; 17] = [
    "br", "p", "div", "li", "tr", "td", "th", "table", "ul", "ol", "h1", "h2", "h3", "h4", "h5",
    "h6", "hr",
];

/// Strips HTML markup, dropping script/style bodies and decoding the entities
/// that appear in authored article content. Block-level tags become spaces so
/// words keep their phrase boundaries, matching the app's PlainText behavior.
pub fn strip_html(html: &str) -> String {
    if !html.contains('<') && !html.contains('&') {
        return html.to_string();
    }
    let mut out = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();
    let mut skipping: Option<String> = None;
    while let Some(c) = chars.next() {
        if skipping.is_some() && c != '<' {
            continue;
        }
        match c {
            '<' => {
                let mut tag = String::new();
                let mut closed = false;
                for inner in chars.by_ref() {
                    if inner == '>' {
                        closed = true;
                        break;
                    }
                    tag.push(inner);
                }
                if !closed {
                    break;
                }
                let is_close = tag.trim_start().starts_with('/');
                let name = tag
                    .trim_start_matches('/')
                    .split(|ch: char| ch.is_whitespace() || ch == '/')
                    .next()
                    .unwrap_or_default()
                    .to_lowercase();
                if let Some(open) = skipping.as_ref() {
                    if is_close && name == *open {
                        skipping = None;
                    }
                    continue;
                }
                let self_closing = tag.trim_end().ends_with('/');
                if !is_close && !self_closing && SKIP_CONTENT_TAGS.contains(&name.as_str()) {
                    skipping = Some(name);
                    continue;
                }
                if BLOCK_TAGS.contains(&name.as_str()) && !out.is_empty() && !out.ends_with(' ') {
                    out.push(' ');
                }
            }
            '&' => {
                let mut entity = String::new();
                let mut terminated = false;
                for inner in chars.by_ref() {
                    if inner == ';' {
                        terminated = true;
                        break;
                    }
                    if entity.len() > 10 || !(inner.is_ascii_alphanumeric() || inner == '#') {
                        break;
                    }
                    entity.push(inner);
                }
                if terminated {
                    if let Some(decoded) = decode_entity(&entity) {
                        out.push(decoded);
                        continue;
                    }
                    out.push('&');
                    out.push_str(&entity);
                    out.push(';');
                } else {
                    out.push('&');
                    out.push_str(&entity);
                }
            }
            _ => out.push(c),
        }
    }
    out.trim().to_string()
}

/// Decodes the HTML entities that appear in article content: the named XML
/// entities plus `&nbsp;`, and numeric (decimal/hex) character references.
fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32)
        }
        _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
        _ => None,
    }
}

/// Folds a Hebrew final letter (sofit) into its regular form; returns the
/// character unchanged for every other input.
fn fold_final_form(c: char) -> char {
    match c {
        'ך' => 'כ',
        'ם' => 'מ',
        'ן' => 'נ',
        'ף' => 'פ',
        'ץ' => 'צ',
        _ => c,
    }
}

/// Normalizes text for indexing and querying: NFD decomposition, removal of
/// combining marks (niqqud/teamim), removal of gershayim/geresh and quote
/// characters, Hebrew final-letter folding, lowercasing, and whitespace
/// collapsing.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars().flat_map(char::nfd) {
        if is_combining_mark(c) {
            continue;
        }
        if matches!(
            c,
            '\'' | '"'
                | '\u{05f3}'
                | '\u{05f4}'
                | '\u{2018}'
                | '\u{2019}'
                | '\u{201c}'
                | '\u{201d}'
        ) {
            continue;
        }
        let c = fold_final_form(c);
        if c.is_alphanumeric() {
            for lower in c.to_lowercase() {
                if lower.is_alphanumeric() {
                    out.push(lower);
                }
            }
        } else if !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim().to_string()
}

/// Splits text into normalized tokens.
pub fn tokenize(text: &str) -> Vec<String> {
    normalize(text)
        .split(' ')
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect()
}

/// Counts term frequencies over a token stream.
pub fn term_frequencies(tokens: &[String]) -> std::collections::HashMap<String, u32> {
    let mut counts = std::collections::HashMap::with_capacity(tokens.len());
    for token in tokens {
        *counts.entry(token.clone()).or_insert(0) += 1;
    }
    counts
}

/// True for characters that can appear inside a search "word" — letters,
/// digits, combining marks (niqqud/teamim), and intra-word gershayim.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || is_combining_mark(c) || matches!(c, '\'' | '"' | '\u{05f3}' | '\u{05f4}')
}

/// Builds a bounded excerpt centered on the window covering the most matching
/// words. Matching compares each *normalized* word against the normalized query
/// terms (exact or the term as a prefix of the word), while the returned slice
/// preserves the original spelling and vowel marks. Falls back to the document
/// head when no query term occurs. The input should already be markup-free
/// (see [`strip_html`]).
pub fn excerpt(plain: &str, terms: &[String], max_chars: usize) -> String {
    let trimmed = plain.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut positions: Vec<usize> = Vec::new();
    if !terms.is_empty() {
        let mut word_start: Option<usize> = None;
        for (i, c) in trimmed.char_indices() {
            if is_word_char(c) {
                if word_start.is_none() {
                    word_start = Some(i);
                }
            } else if let Some(start) = word_start.take() {
                let word = normalize(&trimmed[start..i]);
                if !word.is_empty()
                    && terms
                        .iter()
                        .any(|term| !term.is_empty() && word.starts_with(term.as_str()))
                {
                    positions.push(start);
                }
            }
        }
        if let Some(start) = word_start {
            let word = normalize(&trimmed[start..]);
            if terms
                .iter()
                .any(|term| !term.is_empty() && word.starts_with(term.as_str()))
            {
                positions.push(start);
            }
        }
    }
    positions.sort_unstable();
    positions.dedup();
    // Byte budget: Hebrew chars take 2 bytes, ASCII 1 — cap char count after.
    let budget = max_chars.saturating_mul(2);
    let window = budget.saturating_sub(40).max(80);
    let best = positions
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let covered = positions[i..]
                .iter()
                .take_while(|q| **q < p + window)
                .count();
            (covered, *p)
        })
        .max_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    let center = best.map(|(_, p)| p).unwrap_or(0);
    let mut start = center.saturating_sub(40);
    while start > 0 && !trimmed.is_char_boundary(start) {
        start -= 1;
    }
    while start > 0
        && trimmed[..start]
            .chars()
            .next_back()
            .is_some_and(is_word_char)
    {
        start -= trimmed[..start]
            .chars()
            .next_back()
            .map_or(1, |c| c.len_utf8());
    }
    let mut end = (start + budget).min(trimmed.len());
    while end < trimmed.len() && !trimmed.is_char_boundary(end) {
        end += 1;
    }
    while end < trimmed.len() && trimmed[end..].chars().next().is_some_and(is_word_char) {
        end += trimmed[end..].chars().next().map_or(1, |c| c.len_utf8());
    }
    let mut body: String = trimmed[start..end].trim().to_string();
    // Hard-cap the visible character budget on a word boundary.
    if body.chars().count() > max_chars {
        let mut cut = body
            .char_indices()
            .nth(max_chars)
            .map_or(body.len(), |(i, _)| i);
        while cut > 0 && body[..cut].chars().next_back().is_some_and(is_word_char) {
            cut -= body[..cut].chars().next_back().map_or(1, |c| c.len_utf8());
        }
        body = body[..cut].trim_end().to_string();
    }
    let mut result = String::new();
    if start > 0 {
        result.push('…');
    }
    result.push_str(&body);
    if start + body.len() < trimmed.len() {
        result.push('…');
    }
    result
}

/// Bounded Levenshtein distance used for spelling-variant expansion. Returns
/// `limit + 1` early once the limit is provably exceeded.
pub fn distance(left: &str, right: &str, limit: usize) -> usize {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    if left.len().abs_diff(right.len()) > limit {
        return limit + 1;
    }
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0usize; right.len() + 1];
    for (i, lc) in left.iter().enumerate() {
        current[0] = i + 1;
        let mut row_min = current[0];
        for (j, rc) in right.iter().enumerate() {
            current[j + 1] = (current[j] + 1)
                .min(previous[j + 1] + 1)
                .min(previous[j] + usize::from(lc != rc));
            row_min = row_min.min(current[j + 1]);
        }
        if row_min > limit {
            return limit + 1;
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

/// Maximum tolerated edit distance by term length, matching the app policy.
pub fn max_edits(term: &str) -> usize {
    let len = term.chars().count();
    if len < 4 {
        0
    } else if len < 8 {
        1
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_html_removes_tags_and_decodes_entities() {
        assert_eq!(
            strip_html("<p>שלום <b>עולם</b>&amp; בע&quot;ה</p>"),
            "שלום עולם& בע\"ה"
        );
        assert_eq!(strip_html("plain text"), "plain text");
        assert_eq!(strip_html("<script>evil()</script><p>keep</p>"), "keep");
        assert_eq!(strip_html("<style>.a{color:red}</style><div>x</div>"), "x");
        assert_eq!(strip_html("<p>one</p><p>two</p>"), "one two");
        assert_eq!(strip_html("a&nbsp;b"), "a b");
        assert_eq!(strip_html("&unknown; x"), "&unknown; x");
        assert_eq!(strip_html("5 &#1513;"), "5 ש");
        assert_eq!(strip_html("5 &#x5E9;"), "5 ש");
        // Case-sensitive: unknown-case entities pass through untouched.
        assert_eq!(strip_html("&AMP;"), "&AMP;");
        // Self-closing script does not swallow the rest of the document.
        assert_eq!(strip_html("<script src=\"x\"/>tail"), "tail");
    }

    #[test]
    fn strip_html_truncated_tag_is_safe() {
        assert_eq!(strip_html("abc <p"), "abc");
        assert_eq!(strip_html("<img src=\"x\">tail"), "tail");
    }

    #[test]
    fn normalize_strips_niqqud_teamim_quotes_and_folds_finals() {
        // בְּרֵאשִׁית with niqqud/teamim → בראשית
        assert_eq!(normalize("בְּרֵאשִׁ֖ית"), "בראשית");
        assert_eq!(normalize("תנ\"ך"), "תנכ");
        assert_eq!(normalize("רמב\"ם"), "רמבמ");
        // Final forms fold to the base letter.
        assert_eq!(normalize("עם"), "עמ");
        assert_eq!(normalize("לך"), "לכ");
        assert_eq!(normalize("אבן"), "אבנ");
        assert_eq!(normalize("סוף"), "סופ");
        assert_eq!(normalize("ארץ"), "ארצ");
        assert_eq!(normalize("Hello"), "hello");
        assert_eq!(normalize("  מלים   רבות  "), "מלימ רבות");
        // Maqaf is punctuation: splits into separate tokens.
        assert_eq!(normalize("שמואל־א"), "שמואל א");
    }

    #[test]
    fn tokenize_splits_normalized_text() {
        assert_eq!(tokenize("שלום, עולם!"), vec!["שלומ", "עולמ"]);
        assert_eq!(tokenize(""), Vec::<String>::new());
    }

    #[test]
    fn term_frequencies_counts_tokens() {
        let counts = term_frequencies(&["אמת".to_string(), "אמת".to_string(), "שלומ".to_string()]);
        assert_eq!(counts.get("אמת"), Some(&2));
        assert_eq!(counts.get("שלומ"), Some(&1));
    }

    #[test]
    fn excerpt_prefers_window_covering_query_terms() {
        let plain = format!(
            "{} פרשת בראשית מדברת על בריאת העולם {}",
            "אב ".repeat(200),
            "גד ".repeat(200)
        );
        let excerpt = excerpt(&plain, &["בריאת".to_string(), "העולם".to_string()], 120);
        assert!(excerpt.contains("בריאת"), "{excerpt}");
        assert!(excerpt.chars().count() <= 140);
        assert!(excerpt.starts_with('…'));
        assert!(excerpt.ends_with('…'));
    }

    #[test]
    fn excerpt_returns_whole_short_text_and_empty() {
        assert_eq!(excerpt("קצר", &["x".to_string()], 120), "קצר");
        assert_eq!(excerpt("", &["x".to_string()], 120), "");
    }

    #[test]
    fn excerpt_falls_back_to_head_without_matches() {
        let plain = "אבגדה ".repeat(100);
        let excerpt = excerpt(&plain, &["נעדר".to_string()], 60);
        assert!(excerpt.starts_with("אבגדה"), "{excerpt}");
        assert!(excerpt.ends_with('…'));
    }

    #[test]
    fn distance_is_bounded() {
        assert_eq!(distance("שלומ", "שלום", 1), 1);
        assert_eq!(distance("שלומ", "שלימ", 1), 1);
        assert_eq!(distance("שלומ", "שלום עולמ", 1), 2); // over limit
        assert_eq!(distance("אב", "אב", 0), 0);
        assert_eq!(distance("", "abc", 2), 3); // over limit
    }

    #[test]
    fn max_edits_scales_with_length() {
        assert_eq!(max_edits("אבג"), 0);
        assert_eq!(max_edits("אבגדה"), 1);
        assert_eq!(max_edits("אבגדהוזחטי"), 2);
    }
}
