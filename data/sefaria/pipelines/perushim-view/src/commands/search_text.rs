//! Rust port of `app/BibleOnSite/Helpers/SearchText.cs` — the plain-text and
//! normalization rules the delivered search index must share with the app.
//! Keep in sync with `SearchText.NormalizationVersion`; bump together when the
//! semantics change so both sides produce the same tokens.

use unicode_categories::UnicodeCategories;
use unicode_normalization::UnicodeNormalization;

/// Version folded into every search fingerprint (`v4:{content-id}:n{NORM_VERSION}`).
/// The app's `SearchText.NormalizationVersion` must equal this value.
/// 2: every block-level tag — open or close — is a word break, and the shared
/// tag set grew to cover td/th/h4-h6/ul/ol/table/blockquote/section/article/
/// header/footer/hr (previously only br/p/div/li/tr/h1-h3 closed blocks broke).
pub const NORM_VERSION: u32 = 2;

/// Strips markup the same way `SearchText.PlainText` does: script/style blocks
/// vanish, structural tags turn into a word break, and the rest is removed.
/// The corpus only ever uses b/i/br/sup/small/big/strong/span/img plus the
/// entities lt, gt and amp, but numeric entities are decoded too.
pub fn plain_text(text: &str) -> String {
    let deentitized = |s: &str| deentitize(s);
    if !text.contains('<') {
        return deentitized(text);
    }

    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    // Remove `<!--…-->` comments and <script…>…</script>/<style…>…</style>
    // blocks entirely. Comments compete with script/style in document order:
    // a `<style>` opener inside a comment must not pair with a real closing
    // tag and erase the text between them.
    while let Some((start, end)) = find_comment_or_script(rest) {
        out.push_str(&rest[..start]);
        rest = &rest[end..];
    }
    out.push_str(rest);

    let mut result = String::with_capacity(out.len());
    let mut chars = out.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '<' {
            result.push(c);
            continue;
        }
        // '<' starts a tag only before a letter, '/', '!' or '?' — anything
        // else (including EOF) stays literal text, matching HtmlAgilityPack.
        match chars.peek() {
            Some(&t) if t.is_ascii_alphabetic() || matches!(t, '/' | '!' | '?') => {}
            _ => {
                result.push('<');
                continue;
            }
        }
        // Consume until '>'. Capture the tag name only while it runs, and keep
        // every consumed char so an unterminated tag can be re-emitted as text.
        let mut consumed = String::new();
        let mut tag = String::new();
        let mut first = true;
        let mut in_name = true;
        let mut terminated = false;
        for t in chars.by_ref() {
            if t == '>' {
                terminated = true;
                break;
            }
            consumed.push(t);
            if first {
                first = false;
                if t == '/' {
                    continue;
                }
            }
            if in_name {
                if t.is_ascii_alphabetic() || t.is_ascii_digit() {
                    tag.push(t.to_ascii_lowercase());
                } else {
                    in_name = false;
                }
            }
        }
        if !terminated {
            // Unterminated '<tag' at EOF: HtmlAgilityPack keeps it as text.
            result.push('<');
            result.push_str(&consumed);
            break;
        }
        // Block-level tags — the same set the app (`SearchText.cs`), the website
        // (`lib/search/normalize.ts`) and the article-search service
        // (`web/api/src/services/article_search/text.rs`) break words on. Open
        // and close tags break alike so `<div>…` and `…</td><td>…` split the
        // same way every port parses them.
        const BREAK: [&str; 22] = [
            "br",
            "p",
            "div",
            "li",
            "tr",
            "td",
            "th",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "ul",
            "ol",
            "table",
            "blockquote",
            "section",
            "article",
            "header",
            "footer",
            "hr",
        ];
        if BREAK.contains(&tag.as_str()) && !result.ends_with(' ') {
            // A block tag (open or close) emits the break the element stands for;
            // adjacent ones share a single break like the other ports.
            result.push(' ');
        }
        // All other tags drop entirely.
    }
    deentitized(&result).trim().to_string()
}

/// `SearchText.Normalize`: NFD, drop combining marks + quote chars, lowercase
/// letters/digits, collapse everything else to single spaces.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.nfd() {
        if c.is_mark_nonspacing() || c.is_mark_spacing_combining() {
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
        // Matches .NET Char.IsLetterOrDigit (Letters + DecimalDigitNumber).
        if c.is_letter() || c.is_number_decimal_digit() {
            out.extend(c.to_lowercase());
        } else if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim_end().to_string()
}

/// Locates the earliest `<!--` comment or `<script>`/`<style>` open tag and
/// returns the range to drop: a comment through its `-->` (or EOF), a
/// script/style block through its matching close (or its own open tag).
fn find_comment_or_script(text: &str) -> Option<(usize, usize)> {
    let comment = text.find("<!--").map(|start| {
        let end = text[start + 4..]
            .find("-->")
            .map(|p| start + 4 + p + 3)
            .unwrap_or(text.len());
        (start, end)
    });
    let script = find_script_or_style(text);
    match (comment, script) {
        (Some(c), Some(s)) => Some(if c.0 <= s.0 { c } else { s }),
        (only, None) | (None, only) => only,
    }
}

/// Locates the earliest `<script>`/`<style>` open tag and the index just past
/// its matching close tag (or past the open tag when none is found).
fn find_script_or_style(text: &str) -> Option<(usize, usize)> {
    let lower = text.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for name in ["script", "style"] {
        let open = format!("<{name}");
        let mut search = 0;
        while let Some(pos) = lower[search..].find(&open) {
            let start = search + pos;
            if best.is_some_and(|(b, _)| start >= b) {
                break;
            }
            let at = start + open.len();
            // Require a non-identifier char (or EOF) right after the tag name.
            if lower[at..]
                .chars()
                .next()
                .is_none_or(|c| !(c.is_ascii_alphanumeric()))
            {
                let close = format!("</{name}");
                let after = lower[at..]
                    .find(&close)
                    .map(|c| at + c + close.len() + 1)
                    .unwrap_or(at);
                best = Some((start, after.min(text.len())));
                break;
            }
            search = at;
        }
    }
    best
}

/// `HtmlEntity.DeEntitize` for the entities present in the corpus plus the
/// standard XML set and numeric references.
fn deentitize(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 1..];
        let Some(end) = after.find(';') else {
            out.push('&');
            rest = after;
            continue;
        };
        let entity = &after[..end];
        let decoded = match entity {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{00a0}'),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                u32::from_str_radix(&entity[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if entity.starts_with('#') => {
                entity[1..].parse::<u32>().ok().and_then(char::from_u32)
            }
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &after[end + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_strips_markup_and_entities() {
        assert_eq!(plain_text("no markup"), "no markup");
        assert_eq!(plain_text("<b>bold</b> and <i>it</i>"), "bold and it");
        assert_eq!(plain_text("a<br>b"), "a b");
        assert_eq!(plain_text("a<br/>b"), "a b");
        assert_eq!(plain_text("<p>para</p>next"), "para next");
        assert_eq!(
            plain_text("fish &lt; meat &amp; &gt; veg"),
            "fish < meat & > veg"
        );
        assert_eq!(
            plain_text("x<script>alert(1)</script>y"),
            "xy",
            "script content is removed"
        );
        // A '<' that cannot start a tag stays literal text (HtmlAgilityPack parity).
        assert_eq!(plain_text("a < b"), "a < b");
        assert_eq!(plain_text("dangling <"), "dangling <");
        assert_eq!(plain_text("unclosed <b text"), "unclosed <b text");
        // Attributes never leak into the tag name.
        assert_eq!(plain_text("<a href=\"x\">link</a>"), "link");
        // An earlier <style> block is removed even when a <script> follows.
        assert_eq!(plain_text("a<style>x{}</style>b<script>y</script>c"), "abc");
    }

    #[test]
    fn plain_text_removes_the_earliest_of_script_and_style() {
        // A <script> block before a <style> block: the style candidate loses
        // to the earlier script match and is left for the next pass.
        assert_eq!(plain_text("a<script>x</script>b<style>y{}</style>c"), "abc");
        // Neither block survives even when the other comes first repeatedly.
        assert_eq!(
            plain_text("a<style>x{}</style>b<script>y</script>c<style>z{}</style>d"),
            "abcd"
        );
    }

    #[test]
    fn plain_text_treats_script_prefixed_tags_as_regular_markup() {
        // `<scriptx` is not a script tag — the name must end at a
        // non-identifier char; scanning continues past it. Unlike a real
        // script block the inner text survives; the tags themselves drop.
        assert_eq!(plain_text("a<scriptx>y</scriptx>b"), "ayb");
        assert_eq!(plain_text("<styleable>x"), "x");
    }

    #[test]
    fn plain_text_keeps_literal_ampersands_and_decodes_remaining_entities() {
        // No ';' after '&' — the '&' stays literal and scanning continues.
        assert_eq!(plain_text("a & b"), "a & b");
        // Named entities beyond lt/gt/amp.
        assert_eq!(plain_text("&quot;q&quot;"), "\"q\"");
        assert_eq!(plain_text("&apos;a&apos;"), "'a'");
        assert_eq!(plain_text("x&nbsp;y"), "x\u{00a0}y");
        // Numeric entities, decimal and hex.
        assert_eq!(plain_text("&#65;&#x42;&#X43;"), "ABC");
        // Unknown entities and out-of-range code points stay literal.
        assert_eq!(plain_text("&bogus; &#xD800; &#;"), "&bogus; &#xD800; &#;");
        // Entities decode even inside markup-free text.
        assert_eq!(plain_text("fish &amp; chips"), "fish & chips");
    }

    #[test]
    fn normalize_matches_searchtext_semantics() {
        // Nikud (non-spacing marks) are stripped; gershayim/gersh removed.
        assert_eq!(normalize("בְּרֵאשִׁית"), "בראשית");
        assert_eq!(normalize("תנ\"ך"), "תנך");
        assert_eq!(normalize("שמואל א'"), "שמואל א");
        assert_eq!(normalize("Hello, World!"), "hello world");
        assert_eq!(normalize("  a  b  "), "a b");
        assert_eq!(normalize("word's end"), "words end");
        assert_eq!(normalize("a-ב c"), "a ב c");
    }

    // The same cases are asserted in search-normalize.test.ts (website),
    // SearchTextTests.cs (app) and article_search/text.rs (api): every open or
    // close block-level tag is a word break in all four ports, and each emits
    // the same plain text byte-for-byte (one space per boundary cluster).
    #[test]
    fn block_tags_break_words_like_the_other_ports() {
        for (html, expected) in [
            ("<td>foo</td><td>bar</td>", "foo bar"),
            ("<th>א</th><td>ב</td>", "א ב"),
            ("<h4>א</h4>ב", "א ב"),
            ("<ul><li>א</li><li>ב</li></ul>", "א ב"),
            ("<table><tr><td>א</td><td>ב</td></tr></table>", "א ב"),
            ("<blockquote>א</blockquote><section>ב</section>", "א ב"),
            ("<header>א</header><article>ב</article>", "א ב"),
            ("<footer>א</footer>ב", "א ב"),
            ("א<hr>ב", "א ב"),
            ("<div>א", "א"),
            ("<p>א</p><p>ב</p>", "א ב"),
            ("א<br>ב", "א ב"),
            // A boundary emits one space unless preceding text ends in one.
            // whitespace around tags stays literal in every port.
            ("א <br>ב", "א ב"),
            ("א  <br>ב", "א  ב"),
            ("א<br> ב", "א  ב"),
            ("א <br> <br>ב", "א  ב"),
            ("א<div></div>ב", "א ב"),
            // A comment emits nothing; markup inside it never reaches the scanner.
            ("א<!-- <style> -->ב", "אב"),
            // A commented-out opener must not pair with a real close tag.
            ("א<!-- <style> -->ב<style>x</style>ג", "אבג"),
            // Comment markers inside a skipped script/style body are inert —
            // the closing tag still ends the block.
            ("א<script><!--</script>ב", "אב"),
            ("א<style>x<!-- -->y</style>ב", "אב"),
            // A script block starting before a comment marker still wins —
            // whichever construct opens first is the one removed.
            ("א<script>x<!--y</script>ב", "אב"),
            // An unterminated comment swallows to end of input.
            ("א<!--x", "א"),
        ] {
            assert_eq!(plain_text(html), expected, "for {html}");
        }
    }
}
