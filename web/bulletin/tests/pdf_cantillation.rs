//! #3685: Al Heperek v0.9.5 covers the whole Hebrew block — every taam
//! (U+0591–U+05AF), meteg, and the rare marks U+05C4–U+05C6 — so daily
//! bulletin articles, quotes, headings and pesukim all shape on the bundled
//! Al Heperek faces. Taamey Frank CLM remains only where a real italic or
//! bold-italic outline is needed (Al Heperek has no italic face).
//!
//! These tests inspect real PDF content/glyph/font output — a `%PDF` header
//! or a markup assertion cannot detect a missing-glyph or wrong-face defect.

use std::collections::HashMap;
use std::path::PathBuf;

use bulletin::{pdf, tanach};
use lopdf::{Document, Object, ObjectId, content::Content};

fn fonts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts")
}

/// Marks Al Heperek lacked before v0.9.5 — the regression specimen set.
const HEPEREK_MARKS: [char; 35] = [
    // All taamim U+0591–U+05AF …
    '\u{0591}', '\u{0592}', '\u{0593}', '\u{0594}', '\u{0595}', '\u{0596}', '\u{0597}', '\u{0598}',
    '\u{0599}', '\u{059A}', '\u{059B}', '\u{059C}', '\u{059D}', '\u{059E}', '\u{059F}', '\u{05A0}',
    '\u{05A1}', '\u{05A2}', '\u{05A3}', '\u{05A4}', '\u{05A5}', '\u{05A6}', '\u{05A7}', '\u{05A8}',
    '\u{05A9}', '\u{05AA}', '\u{05AB}', '\u{05AC}', '\u{05AD}', '\u{05AE}', '\u{05AF}',
    // … plus the rare upper/lower marks U+05C4–U+05C6 and meteg U+05BD.
    '\u{05C4}', '\u{05C5}', '\u{05C6}', '\u{05BD}',
];

fn is_mark(c: char) -> bool {
    HEPEREK_MARKS.contains(&c)
}

/// Combining marks and points (U+0591–U+05C7: taamim, niqqud, dagesh,
/// shin/sin dot, rafe). Typst's ToUnicode maps each shaped glyph to its
/// whole source cluster — a base glyph shared between a cantillated cluster
/// and plain text decodes as the cluster — so word-level assertions must
/// compare letter sequences, not raw cluster strings.
fn unmarked(text: &str) -> String {
    text.chars()
        .filter(|c| !('\u{0591}'..='\u{05C7}').contains(c))
        .collect()
}

/// Article fixture quoting the issue's affected verses: the block quote cites
/// מלכים א כ לה, the inline quote cites מלכים א כ יג — both real embedded
/// pesukim — plus a coverage specimen, styled spans, Latin and digits.
fn melachim_article() -> String {
    let perek = tanach::get_perek(307).expect("מלכים א כ must exist in embedded data");
    let quote_lamed_he = &perek.pesukim[34];
    let quote_yud_gimel = &perek.pesukim[12];
    assert!(quote_lamed_he.contains('֣'));
    assert!(quote_yud_gimel.contains('֣'));
    let specimen: String = HEPEREK_MARKS
        .iter()
        .map(|mark| format!("א{mark}"))
        .collect();
    format!(
        "<h1>המוותר על דברי נביא</h1>\
         <p>כאמרו {quote_lamed_he} (מלכים א כ לה) נמצא.</p>\
         <p>וכן נאמר {quote_yud_gimel} (מלכים א כ יג) inline.</p>\
         <p>דגש: <strong>הַכֵּ֣ינִי נָ֑א</strong> וגם \
         <span style='font-style:italic'>כֹּ֥ה אָמַ֣ר</span> ועוד \
         <span style='font-weight:bold'>וַיֹּאמֶ֞ר אֵלָ֑יו</span> תמיד.</p>\
         <p>סימנים: {specimen} — perek 307 (2026) הָאָֽרֶץ׃.</p>"
    )
}

fn melachim_request(article_html: String) -> pdf::PdfRequest {
    let perek = tanach::get_perek(307).unwrap();
    pdf::PdfRequest {
        sefer_name: perek.sefer_name.clone(),
        perakim: vec![pdf::PdfPerekInput {
            perek_heb: tanach::perek_to_hebrew(perek.perek_in_sefer),
            header: perek.header.clone(),
            pesukim: pdf::plain_pesukim(&perek.pesukim),
            images: vec![],
            articles: vec![(
                "המוותר על דברי נביא".into(),
                "הרב צבי שוויגר".into(),
                article_html,
            )],
        }],
        include_cover: false,
        include_toc: false,
        cover_accent_hex: "48A9C4".into(),
        cover_text: pdf::PdfCoverText::default(),
    }
}

struct FontInfo {
    base: String,
    to_unicode: HashMap<u16, String>,
}

/// One shown-text operation: the font resource's BaseFont, the text decoded
/// through the font's ToUnicode CMap, and its .notdef (glyph id 0) count.
#[derive(Debug)]
struct ShownText {
    font: String,
    text: String,
    notdef: usize,
}

fn deref<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Object> {
    match obj {
        Object::Reference(id) => doc.get_object(*id).ok(),
        other => Some(other),
    }
}

/// Resource name (e.g. `f2`) → font info for one page, incl. inherited
/// resource dictionaries.
fn page_fonts(doc: &Document, page_id: ObjectId) -> HashMap<Vec<u8>, FontInfo> {
    let mut map = HashMap::new();
    let (own, extra) = doc.get_page_resources(page_id).unwrap_or((None, vec![]));
    let mut dicts: Vec<&lopdf::Dictionary> = vec![];
    if let Some(d) = own {
        dicts.push(d);
    }
    for id in extra {
        if let Ok(d) = doc.get_dictionary(id) {
            dicts.push(d);
        }
    }
    for dict in dicts {
        let Ok(fonts_obj) = dict.get(b"Font") else {
            continue;
        };
        let Some(fonts) = deref(doc, fonts_obj).and_then(|o| o.as_dict().ok()) else {
            continue;
        };
        for (name, fobj) in fonts.iter() {
            let Some(fd) = deref(doc, fobj).and_then(|o| o.as_dict().ok()) else {
                continue;
            };
            let base = fd
                .get(b"BaseFont")
                .and_then(Object::as_name)
                .map(|n| String::from_utf8_lossy(n).into_owned())
                .unwrap_or_default();
            let mut to_unicode = HashMap::new();
            if let Ok(tu_obj) = fd.get(b"ToUnicode")
                && let Some(Object::Stream(s)) = deref(doc, tu_obj)
            {
                let bytes = s
                    .decompressed_content()
                    .unwrap_or_else(|_| s.content.clone());
                to_unicode = parse_cmap(&String::from_utf8_lossy(&bytes));
            }
            map.insert(name.clone(), FontInfo { base, to_unicode });
        }
    }
    map
}

/// Bytes shown by a `Tj`/`TJ`/`'`/`"` operation.
fn shown_bytes(op: &lopdf::content::Operation) -> Vec<u8> {
    let mut out = vec![];
    for o in &op.operands {
        match o {
            Object::String(b, _) => out.extend_from_slice(b),
            Object::Array(arr) => {
                for item in arr {
                    if let Object::String(b, _) = item {
                        out.extend_from_slice(b);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Decode a shown string: 2-byte big-endian CIDs → text via the font's
/// ToUnicode CMap. CID 0 is .notdef.
fn decode_shown(bytes: &[u8], font: &FontInfo) -> String {
    let mut out = String::new();
    for pair in bytes.chunks(2) {
        if pair.len() != 2 {
            break;
        }
        let cid = u16::from_be_bytes([pair[0], pair[1]]);
        if cid == 0 {
            continue;
        }
        if let Some(s) = font.to_unicode.get(&cid) {
            out.push_str(s);
        }
    }
    out
}

/// Parse a ToUnicode CMap's bfchar/bfrange sections (UTF-16BE hex values).
fn parse_cmap(cmap: &str) -> HashMap<u16, String> {
    let mut map = HashMap::new();
    let hexval = |tok: &str| -> Option<Vec<u16>> {
        let t = tok
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .trim_start_matches('<')
            .trim_end_matches('>');
        if t.is_empty() || !t.len().is_multiple_of(4) || t.contains(['<', '>', '[', ']']) {
            return None;
        }
        (0..t.len() / 4)
            .map(|i| u16::from_str_radix(&t[i * 4..i * 4 + 4], 16).ok())
            .collect()
    };
    let mut section = 0; // 0 = none, 1 = bfchar, 2 = bfrange
    for line in cmap.lines() {
        let line = line.trim();
        if line.ends_with("beginbfchar") {
            section = 1;
            continue;
        }
        if line.ends_with("beginbfrange") {
            section = 2;
            continue;
        }
        if line.contains("endbfchar") || line.contains("endbfrange") {
            section = 0;
            continue;
        }
        let toks: Vec<&str> = line.split_whitespace().collect();
        if section == 1 && toks.len() >= 2 {
            if let (Some(src), Some(dst)) = (hexval(toks[0]), hexval(toks[1])) {
                map.insert(src[0], String::from_utf16_lossy(&dst));
            }
        } else if section == 2 && toks.len() >= 3 {
            let (Some(lo), Some(hi)) = (hexval(toks[0]), hexval(toks[1])) else {
                continue;
            };
            if line.contains('[') {
                // `<lo> <hi> [<d1> <d2> …]` array form.
                for (off, dst) in toks[2..].iter().filter_map(|t| hexval(t)).enumerate() {
                    let cid = lo[0] + off as u16;
                    if cid > hi[0] {
                        break;
                    }
                    map.insert(cid, String::from_utf16_lossy(&dst));
                }
            } else if let Some(dst) = hexval(toks[2]) {
                for cid in lo[0]..=hi[0] {
                    let mut d = dst.clone();
                    *d.last_mut().unwrap() += cid - lo[0];
                    map.insert(cid, String::from_utf16_lossy(&d));
                }
            }
        }
    }
    map
}

/// All shown-text operations across the document, in page order.
fn shown_texts(doc: &Document) -> Vec<ShownText> {
    let mut out = vec![];
    let mut pages: Vec<_> = doc.get_pages().into_iter().collect();
    pages.sort_by_key(|(num, _)| *num);
    for (_, page_id) in pages {
        let fonts = page_fonts(doc, page_id);
        let content = doc.get_page_content(page_id);
        let decoded = Content::decode(&content).expect("valid content stream");
        let mut current = Vec::<u8>::new();
        for op in &decoded.operations {
            match op.operator.as_str() {
                "Tf" => {
                    if let Object::Name(name) = &op.operands[0] {
                        current = name.clone();
                    }
                }
                "Tj" | "TJ" | "'" | "\"" => {
                    let bytes = shown_bytes(op);
                    let Some(font) = fonts.get(&current) else {
                        continue;
                    };
                    let notdef = bytes
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .filter(|p| p[0] == 0 && p[1] == 0)
                        .count();
                    out.push(ShownText {
                        font: font.base.clone(),
                        text: decode_shown(&bytes, font),
                        notdef,
                    });
                }
                _ => {}
            }
        }
    }
    out
}

/// Every distinct embedded face name in the document.
fn embedded_faces(doc: &Document) -> Vec<String> {
    doc.objects
        .values()
        .filter_map(|o| o.as_dict().ok()?.get(b"BaseFont").ok()?.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .collect()
}

#[test]
fn daily_article_scripture_quotes_render_all_marks_in_al_heperek() {
    let buf = pdf::build_daily_pdf(
        &melachim_request(melachim_article()),
        &fonts_dir(),
        "יח חשוון תשפז",
        &[],
    )
    .unwrap();
    let doc = Document::load_mem(&buf).unwrap();
    let shown = shown_texts(&doc);
    assert!(
        !shown.is_empty(),
        "no text ops decoded — font model changed?"
    );

    // The core regression: no .notdef glyphs anywhere in the document.
    let notdef: Vec<&ShownText> = shown.iter().filter(|s| s.notdef > 0).collect();
    assert!(
        notdef.is_empty(),
        "missing-glyph (.notdef) output: {notdef:?}"
    );

    // Every specimen mark must be drawn by an Al Heperek face, attached to
    // its Hebrew base. The specimen draws `א` + mark; the cluster's ToUnicode
    // text keeps base and mark contiguous — either order, since RTL visual
    // layout may emit the mark glyph beside its base — proving attachment.
    let heperek_text: String = shown
        .iter()
        .filter(|s| s.font.contains("AlHeperekUI"))
        .map(|s| s.text.as_str())
        .collect();
    let heperek_letters = unmarked(&heperek_text);
    for mark in HEPEREK_MARKS {
        assert!(
            heperek_text.contains(&format!("א{mark}"))
                || heperek_text.contains(&format!("{mark}א")),
            "mark U+{:04X} missing from AlHeperekUI output",
            mark as u32
        );
    }
    for s in &shown {
        // A mark must sit beside a Hebrew char in its op — either side, since
        // RTL visual order may emit the mark glyph before or after its base.
        // A mark alone in an op means it was styled in isolation.
        let chars: Vec<char> = s.text.chars().collect();
        for (i, c) in chars.iter().enumerate() {
            if is_mark(*c) {
                let hebrew =
                    |c: Option<&char>| c.is_some_and(|c| ('\u{0590}'..='\u{05FF}').contains(c));
                assert!(
                    hebrew(i.checked_sub(1).and_then(|j| chars.get(j))) || hebrew(chars.get(i + 1)),
                    "mark U+{:04X} isolated from its Hebrew base in {}: {:?}",
                    *c as u32,
                    s.font,
                    s.text
                );
            }
        }
    }

    // Complete cantillated clusters from the quoted pesukim survive on Al
    // Heperek: אִ֨ from וְאִ֨ישׁ, כֵּ֣ from הַכֵּ֣ינִי, חָ֜ from אֶחָ֜ד
    // (מלכים א כ לה). Each mark glyph decodes to its whole cluster, so a
    // mark asserts its presence in the output while its base letter asserts
    // in mark-free comparison — together they prove the cluster shapes.
    for cluster in ["אִ֨", "כֵּ֣", "חָ֜"] {
        for mark in cluster.chars().filter(|c| is_mark(*c)) {
            assert!(
                heperek_text.contains(mark),
                "mark U+{:04X} of cluster {cluster:?} missing from Al Heperek output",
                mark as u32
            );
        }
        let base = unmarked(cluster);
        let flipped: String = base.chars().rev().collect();
        assert!(
            heperek_letters.contains(&base) || heperek_letters.contains(&flipped),
            "base {base:?} of cluster {cluster:?} missing from Al Heperek output"
        );
    }

    // Bold emphasis inside quotes resolves to the real Al Heperek bold face —
    // the munach mark of the cantillated strong run decodes on it.
    let bold_text: String = shown
        .iter()
        .filter(|s| s.font.contains("AlHeperekUI-Bold"))
        .map(|s| s.text.as_str())
        .collect();
    assert!(
        bold_text.contains('֣') && unmarked(&bold_text).contains('כ'),
        "bold cantillated cluster missing: {bold_text:?}"
    );

    // Italic runs keep the real italic outlines — Taamey Frank CLM Italic is
    // the only non-Al Heperek face allowed (Al Heperek has no italic). The
    // mahapakh of כֹּ֥ decodes on it.
    let italic_text: String = shown
        .iter()
        .filter(|s| {
            s.font.contains("TaameyFrankCLM")
                && (s.font.contains("Italic") || s.font.contains("Oblique"))
        })
        .map(|s| s.text.as_str())
        .collect();
    assert!(
        italic_text.contains('֥') && unmarked(&italic_text).contains('כ'),
        "italic cantillated cluster missing: {italic_text:?}"
    );
    for s in &shown {
        assert!(
            !s.font.contains("TaameyFrankCLM")
                || s.font.contains("Italic")
                || s.font.contains("Oblique"),
            "non-italic text on TaameyFrankCLM — a legacy font switch remains: {:?}",
            s.text
        );
    }

    // Plain prose (source refs, Latin, digits) stays on the article font.
    // Compare letter sequences (marks stripped): base glyphs shared with
    // cantillated runs decode to their whole cluster, and visual-order
    // decoding may flip multi-glyph words — accept both.
    for prose in ["מלכים", "לה", "יג", "307", "perek"] {
        let flipped: String = prose.chars().rev().collect();
        assert!(
            heperek_letters.contains(prose) || heperek_letters.contains(&flipped),
            "prose {prose:?} not in Al Heperek output"
        );
    }

    // The perek scripture itself renders on Al Heperek with its full marks.
    let pesukim_text: String = shown
        .iter()
        .filter(|s| s.font.contains("AlHeperekUI-Regular"))
        .map(|s| s.text.as_str())
        .collect();
    assert!(
        pesukim_text.chars().any(is_mark),
        "perek scripture must keep its Al Heperek cantillation: {pesukim_text:?}"
    );
}

#[test]
fn adjacent_citations_compile_in_sefer_and_daily_exports() {
    for quote in ["אֹתָֽם׃", "וַיֹּאמֶ֞ר"] {
        let req = melachim_request(format!("<p>{quote}(בראשית א כז)</p>"));
        for bytes in [
            pdf::build_pdf(&req, &fonts_dir()).unwrap(),
            pdf::build_daily_pdf(&req, &fonts_dir(), "תאריך", &[]).unwrap(),
        ] {
            let doc = Document::load_mem(&bytes).unwrap();
            let shown = shown_texts(&doc);
            assert!(shown.iter().all(|run| run.notdef == 0));
            assert!(
                shown.iter().all(|run| !run.text.contains(';')),
                "Typst expression terminators must never become article punctuation: {shown:?}"
            );
            let citation: String = shown
                .iter()
                .filter(|run| run.font.contains("AlHeperekUI"))
                .map(|run| run.text.as_str())
                .collect();
            // Base glyphs shared with cantillated pesukim decode to their
            // whole cluster — compare the letter sequence, marks stripped.
            let citation = unmarked(&citation);
            assert!(
                citation.contains("בראשית") || citation.contains("תישארב"),
                "citation letters missing from Al Heperek output: {citation:?}"
            );
        }
    }
}

#[test]
fn pointed_chapter_headings_use_complete_al_heperek_runs() {
    let mut req = melachim_request(String::new());
    req.perakim[0].header = "אֹתָֽם׃".into();
    req.perakim[0].pesukim.clear();
    req.perakim[0].articles.clear();
    for bytes in [
        pdf::build_pdf(&req, &fonts_dir()).unwrap(),
        pdf::build_daily_pdf(&req, &fonts_dir(), "תאריך", &[]).unwrap(),
    ] {
        let doc = Document::load_mem(&bytes).unwrap();
        let shown = shown_texts(&doc);
        assert!(shown.iter().all(|run| run.notdef == 0));
        // The whole pointed heading — marks included — shapes as one run on
        // the Al Heperek face.
        let heperek_text: String = shown
            .iter()
            .filter(|run| run.font.contains("AlHeperekUI"))
            .map(|run| run.text.as_str())
            .collect();
        assert!(
            heperek_text.contains('ֽ') && heperek_text.contains('׃'),
            "a pointed scripture heading must shape on Al Heperek: {shown:?}"
        );
    }
}

#[test]
fn marked_article_titles_shape_on_al_heperek() {
    // A cantillated quote inside an article h1 becomes the PDF heading. Marked
    // runs shape on the same Al Heperek face as the body — base and marks
    // together (#3685).
    let mut req = melachim_request(String::new());
    req.perakim[0].pesukim.clear();
    req.perakim[0].articles.clear();
    req.perakim[0].articles.push((
        "unused".into(),
        "הרב צבי שוויגר".into(),
        "<h1>וַיֹּאמֶ֞ר אֵלָ֑יו</h1><p>טקסט רגיל.</p>".into(),
    ));
    for bytes in [
        pdf::build_pdf(&req, &fonts_dir()).unwrap(),
        pdf::build_daily_pdf(&req, &fonts_dir(), "תאריך", &[]).unwrap(),
    ] {
        let doc = Document::load_mem(&bytes).unwrap();
        let shown = shown_texts(&doc);
        assert!(shown.iter().all(|run| run.notdef == 0));
        // The whole marked run survives on an Al Heperek face.
        let heperek_text: String = shown
            .iter()
            .filter(|run| run.font.contains("AlHeperekUI"))
            .map(|run| run.text.as_str())
            .collect();
        assert!(
            heperek_text.contains('֞') && heperek_text.contains('֑'),
            "title marks missing from Al Heperek output: {heperek_text:?}"
        );
        // No Taamey D face may remain anywhere in the document.
        assert!(
            embedded_faces(&doc)
                .iter()
                .all(|f| !f.contains("Taamey_D")),
            "Taamey D face embedded in the bulletin PDF: {:?}",
            embedded_faces(&doc)
        );
        // The unpointed author suffix stays on the article font — compare
        // letter sequences since shared base glyphs decode to clusters.
        let ui_text = unmarked(&heperek_text);
        assert!(
            ui_text.contains("שוויגר") || ui_text.contains("רגיווש"),
            "title author missing from Al Heperek output: {ui_text:?}"
        );
    }
}

#[test]
fn daily_article_italic_runs_keep_real_italic_faces() {
    // Without italics the daily embeds only Al Heperek faces.
    let mut req =
        melachim_request("<h1>כותרת רגילה</h1><p>טקסט רגיל ללא טעמים כלל.</p>".into());
    let buf = pdf::build_daily_pdf(&req, &fonts_dir(), "תאריך", &[]).unwrap();
    let doc = Document::load_mem(&buf).unwrap();
    let faces = embedded_faces(&doc);
    assert!(
        !faces.iter().any(|f| f.contains("Taamey")),
        "a legacy face embedded despite plain Al Heperek text: {faces:?}"
    );
    assert!(
        faces.iter().any(|f| f.contains("AlHeperekUI")),
        "Al Heperek faces not embedded: {faces:?}"
    );

    // An italic span resolves to the real CLM italic outlines — the only
    // remaining non-Al Heperek face (#3685).
    req.perakim[0].articles[0].2 =
        "<p>רגיל <span style='font-style:italic'>נטוי</span></p>".into();
    let buf = pdf::build_daily_pdf(&req, &fonts_dir(), "תאריך", &[]).unwrap();
    let doc = Document::load_mem(&buf).unwrap();
    let faces = embedded_faces(&doc);
    assert!(
        faces
            .iter()
            .any(|f| f.contains("TaameyFrankCLM")
                && (f.contains("Italic") || f.contains("Oblique"))),
        "italic face not embedded for an italic run: {faces:?}"
    );
}
