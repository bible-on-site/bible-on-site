//! Daily-only branding and reading layout; book and reader exports use their own template.
use std::path::Path;

use anyhow::{Result, ensure};

use super::{
    PdfRequest, TypstFiles, compile_pdf, html_to_typst, pasuk_markup, split_article_header,
    strip_taamim, to_hebrew_letter, typst_escape, typst_string,
};

const LOGO: &[u8] = include_bytes!("../../assets/email/logo-header-bfaa157e34c2.jpg");
const ICONS: [(&str, &[u8]); 5] = [
    (
        "email",
        include_bytes!("../../assets/email/envelope-12f047cbf921.png"),
    ),
    (
        "phone",
        include_bytes!("../../assets/email/phone-fba2eb24d511.png"),
    ),
    (
        "whatsapp",
        include_bytes!("../../assets/email/whatsapp-97aa65ad2e4e.png"),
    ),
    (
        "telegram",
        include_bytes!("../../assets/email/telegram-4d1164ab375c.png"),
    ),
    (
        "globe",
        include_bytes!("../../assets/email/globe-62b826c2ce07.png"),
    ),
];

fn section(markup: &mut String, title: &str) {
    markup.push_str(&format!(
        "#block(width: 100%, fill: rgb(\"F5F1E6\"), inset: (x: 9pt, y: 5pt), radius: 3pt, above: 0.8em, below: 0.55em, sticky: true)[#text(font: \"Frank Ruhl Libre\", size: 12pt, weight: \"bold\", fill: rgb(\"28758A\"))[{}]]\n",
        typst_escape(title)
    ));
}

fn contact(icon: &str, url: &str, label: &str, ltr: bool) -> String {
    format!(
        "#box[#box(image(\"daily-{icon}.png\", width: 9pt, height: 9pt))#h(4pt)#link({url})[#text(dir: {direction})[{label}]]]",
        url = typst_string(url),
        label = typst_escape(label),
        direction = if ltr { "ltr" } else { "rtl" },
    )
}

fn markup(
    req: &PdfRequest,
    date: &str,
    dedications: &[String],
    perek_id: i32,
) -> (String, TypstFiles) {
    let perek = &req.perakim[0];
    let source = format!("{} {}", req.sefer_name, perek.perek_heb);
    let mut files = vec![("daily-logo.jpg".into(), LOGO.to_vec())];
    files.extend(
        ICONS
            .iter()
            .map(|(name, bytes)| (format!("daily-{name}.png"), bytes.to_vec())),
    );
    let mut out = String::from(
        r##"#set document(title: "תנ\"ך על הפרק", author: "תנ\"ך על הפרק")
#set page(paper: "a4", fill: rgb("F5F9FA"), margin: (top: 14mm, bottom: 18mm, left: 13mm, right: 13mm))
#set text(font: ("Taamey D", "Frank Ruhl Libre"), size: 11.5pt, fill: rgb("233D48"), dir: rtl, lang: "he")
#set par(justify: true, leading: 0.4em, spacing: 0.35em)
#set page(footer: context align(center, text(font: "Frank Ruhl Libre", size: 8pt, fill: rgb("637780"))[תנ\"ך על הפרק #h(6pt) · #h(6pt) #counter(page).display()]))
#block(width: 100%, fill: white, inset: 12pt, radius: 6pt, breakable: true)[
#align(center, image("daily-logo.jpg", width: 40mm))
#v(3pt)
"##,
    );
    out.push_str(&format!(
        "#align(center, text(font: \"Frank Ruhl Libre\", size: 19pt, weight: \"bold\", fill: rgb(\"173E52\"))[{}])\n#align(center, text(size: 10pt, fill: rgb(\"637780\"))[{}])\n",
        typst_escape(&source), typst_escape(date),
    ));
    if !perek.header.trim().is_empty() {
        out.push_str(&format!(
            "#v(3pt)\n#align(center, text(size: 10.5pt, fill: rgb(\"28758A\"))[{}])\n",
            typst_escape(&strip_taamim(&perek.header)),
        ));
    }
    out.push_str(
        "#v(4pt)\n#line(length: 100%, stroke: (paint: rgb(\"D8BD82\"), thickness: 1pt))\n",
    );
    if !dedications.is_empty() {
        out.push_str("#block(width: 100%, inset: (y: 5pt), below: 0.3em)[#text(size: 9.5pt, fill: rgb(\"637780\"))[הלימוד מוקדש\n");
        for dedication in dedications {
            out.push_str(&format!("#linebreak(){}\n", typst_escape(dedication)));
        }
        out.push_str("]]\n");
    }
    section(&mut out, "הפרק");
    // One flowing paragraph, like the email and archived bulletin. The verse
    // marker shares the baseline and stays attached to the verse's first word.
    for (index, segments) in perek.pesukim.iter().enumerate() {
        let verse = pasuk_markup(segments);
        if !verse.is_empty() {
            out.push_str(&format!(
                "#text(size: 9.5pt, weight: \"bold\", fill: rgb(\"28758A\"))[{}]~{} ",
                typst_escape(&to_hebrew_letter(index + 1)),
                verse,
            ));
        }
    }
    out.push_str("\n\n");
    if !perek.articles.is_empty() {
        section(&mut out, "מאמר על הפרק");
        for (title, author, html) in &perek.articles {
            let (heading, body) = split_article_header(html);
            let heading = heading.unwrap_or_else(|| title.trim().to_string());
            out.push_str(&format!(
                "#block(sticky: true, above: 0.4em, below: 0.45em)[#text(font: \"Frank Ruhl Libre\", size: 13pt, weight: \"bold\", fill: rgb(\"173E52\"))[{}]",
                typst_escape(&heading),
            ));
            if !author.trim().is_empty() {
                out.push_str(&format!(
                    "#linebreak()#text(size: 10pt, fill: rgb(\"637780\"))[{}]",
                    typst_escape(author.trim()),
                ));
            }
            out.push_str("]\n");
            let body = html_to_typst(&body, &mut files);
            if !body.trim().is_empty() {
                out.push_str("#{ set text(size: 11pt)\n[\n");
                out.push_str(body.trim());
                out.push_str("\n] }\n\n");
            }
        }
    }
    out.push_str(&format!(
        "#block(width: 100%, fill: rgb(\"F5F9FA\"), inset: 7pt, radius: 4pt, above: 0.5em, breakable: false)[\n#align(center, text(font: \"Frank Ruhl Libre\", size: 11pt, weight: \"bold\", fill: rgb(\"28758A\"))[#link(\"https://xn--febl3a.co.il/929/{perek_id}\")[להמשך לימוד על הפרק]])\n#v(4pt)\n#set text(size: 9pt)\n#align(center)[{} #h(9pt) {}]\n#v(2pt)\n#align(center)[{} #h(9pt) {} #h(9pt) {}]\n]\n]\n",
        contact("email", "mailto:tanah.site@gmail.com", "tanah.site@gmail.com", true),
        contact("phone", "tel:+37257078640", "+372-57078640", true),
        contact("whatsapp", "https://wa.me/37257078640", "ווטסאפ", false),
        contact("telegram", "https://t.me/BibleOnSite", "טלגרם", false),
        contact("globe", "https://xn--febl3a.co.il/", "לימוד יומי באתר", false),
    ));
    (out, files)
}

pub(super) fn build(
    req: &PdfRequest,
    fonts_dir: &Path,
    date: &str,
    dedications: &[String],
    perek_id: i32,
) -> Result<Vec<u8>> {
    ensure!(
        req.perakim.len() == 1 && perek_id > 0,
        "A daily bulletin must contain exactly one chapter"
    );
    let (markup, files) = markup(req, date, dedications, perek_id);
    compile_pdf(markup, files, fonts_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::{PdfCoverText, PdfPerekInput, plain_pesukim};

    fn request() -> PdfRequest {
        PdfRequest {
            sefer_name: "בראשית".into(),
            perakim: vec![PdfPerekInput {
                perek_heb: "א".into(),
                header: "בריאת העולם".into(),
                pesukim: plain_pesukim(&["בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים".into(), "וְעַל־פְּנֵ֥י הַמָּֽיִם".into()]),
                articles: vec![(
                    "שם חלופי".into(),
                    "שם המחבר".into(),
                    "<h1>כותרת מלאה</h1><p>גוף המאמר <strong>מודגש</strong></p>".into(),
                )],
                images: vec![],
            }],
            include_cover: false,
            include_toc: false,
            cover_accent_hex: "48A9C4".into(),
            cover_text: PdfCoverText::default(),
        }
    }

    #[test]
    fn branded_daily_layout_preserves_content_and_links() {
        let (source, files) = markup(&request(), "יח חשוון תשפז", &["לזכות המשפחה".into()], 1);
        assert!(source.contains("daily-logo.jpg"));
        assert!(
            source.contains("173E52") && source.contains("28758A") && source.contains("D8BD82")
        );
        assert!(source.contains("יח חשוון תשפז") && source.contains("בראשית א"));
        assert!(source.contains("מאמר על הפרק"));
        assert!(source.contains("הלימוד מוקדש") && source.contains("לזכות המשפחה"));
        assert_eq!(source.matches("כותרת מלאה").count(), 1);
        assert!(!source.contains("שם חלופי"));
        assert!(source.contains("שם המחבר") && source.contains("גוף המאמר"));
        assert!(source.contains("https://xn--febl3a.co.il/929/1"));
        for name in ["email", "phone", "whatsapp", "telegram", "globe"] {
            assert!(source.contains(&format!("daily-{name}.png")));
            assert!(
                files
                    .iter()
                    .any(|(file, bytes)| file == &format!("daily-{name}.png")
                        && bytes.starts_with(b"\x89PNG"))
            );
        }
        assert!(
            files
                .iter()
                .any(|(file, bytes)| file == "daily-logo.jpg" && bytes.starts_with(&[0xff, 0xd8]))
        );
        assert!(source.contains("בְּרֵאשִׁ֖ית") && source.contains("וְעַל־פְּנֵ֥י"));
        assert!(!source.contains("sup("));
        assert!(source.contains("]~בְּרֵאשִׁ֖ית"));
    }

    #[test]
    fn optional_sections_do_not_leave_empty_headings() {
        let mut req = request();
        req.perakim[0].header.clear();
        req.perakim[0].articles.clear();
        req.perakim[0].pesukim.push(vec![]);
        let (source, _) = markup(&req, "יח חשוון תשפז", &[], 1);
        assert!(!source.contains("מאמר על הפרק"));
        assert!(!source.contains("הלימוד מוקדש"));
        req.perakim[0].articles = vec![("כותרת חלופית".into(), " ".into(), "<p></p>".into())];
        let (source, _) = markup(&req, "יח חשוון תשפז", &[], 1);
        assert!(source.contains("כותרת חלופית"));
        assert!(!source.contains("#linebreak()#text(size: 10pt"));
    }

    #[test]
    fn compiles_with_bundled_branding_assets() {
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let bytes = build(&request(), &fonts, "יח חשוון תשפז", &[], 1).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn rejects_multi_chapter_and_invalid_daily_requests() {
        let fonts = Path::new("missing-fonts");
        let mut req = request();
        assert!(build(&req, fonts, "תאריך", &[], 0).is_err());
        req.perakim.clear();
        assert!(build(&req, fonts, "תאריך", &[], 1).is_err());
        req.perakim = vec![PdfPerekInput::default(), PdfPerekInput::default()];
        assert!(build(&req, fonts, "תאריך", &[], 1).is_err());
    }
}
