//! A finite typography whitelist shared by email sanitization and PDF output.
#[derive(Default, Debug, PartialEq)]
pub(crate) struct InlineStyle {
    pub weight: Option<u16>,
    pub italic: Option<bool>,
    pub underline: bool,
    pub strike: bool,
}

impl InlineStyle {
    pub fn parse(css: &str) -> Self {
        let mut style = Self::default();
        for declaration in css.split(';') {
            let Some((name, value)) = declaration.split_once(':') else {
                continue;
            };
            let value = value.trim().to_ascii_lowercase();
            match name.trim().to_ascii_lowercase().as_str() {
                "font-weight" => {
                    style.weight = match value.as_str() {
                        "bold" | "bolder" => Some(700),
                        "normal" => Some(400),
                        "lighter" => Some(300),
                        "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" => {
                            value.parse().ok()
                        }
                        _ => style.weight,
                    };
                }
                "font-style" => match value.as_str() {
                    "italic" | "oblique" => style.italic = Some(true),
                    "normal" => style.italic = Some(false),
                    _ => {}
                },
                "text-decoration" => {
                    let tokens: Vec<_> = value.split_whitespace().collect();
                    if !tokens.is_empty()
                        && tokens
                            .iter()
                            .all(|token| ["underline", "line-through", "none"].contains(token))
                    {
                        style.underline = tokens.contains(&"underline");
                        style.strike = tokens.contains(&"line-through");
                    }
                }
                _ => {}
            }
        }
        style
    }

    pub fn css(&self) -> Option<String> {
        let mut values = Vec::new();
        if let Some(weight) = self.weight {
            values.push(format!("font-weight: {weight}"));
        }
        if let Some(italic) = self.italic {
            values.push(format!(
                "font-style: {}",
                if italic { "italic" } else { "normal" }
            ));
        }
        let decoration = match (self.underline, self.strike) {
            (true, true) => Some("underline line-through"),
            (true, false) => Some("underline"),
            (false, true) => Some("line-through"),
            (false, false) => None,
        };
        if let Some(value) = decoration {
            values.push(format!("text-decoration: {value}"));
        }
        if values.is_empty() {
            None
        } else {
            Some(values.join("; "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_editor_typography_keeps_only_safe_declarations() {
        let style = InlineStyle::parse(
            "FONT-WEIGHT: bold; font-style: oblique; text-decoration: underline line-through; color: red; background: url(https://example.com)",
        );
        assert_eq!(
            style.css().as_deref(),
            Some("font-weight: 700; font-style: italic; text-decoration: underline line-through")
        );
        assert_eq!(
            InlineStyle::parse("font-weight: normal; font-style: normal")
                .css()
                .as_deref(),
            Some("font-weight: 400; font-style: normal")
        );
        assert_eq!(
            InlineStyle::parse("font-weight: lighter; text-decoration: none").weight,
            Some(300)
        );
        for weight in (100..=900).step_by(100) {
            assert_eq!(
                InlineStyle::parse(&format!("font-weight: {weight}")).weight,
                Some(weight)
            );
        }
    }

    #[test]
    fn executable_css_and_unknown_values_are_discarded() {
        for css in [
            "font-weight: expression(alert(1))",
            "font-style: url(x)",
            "text-decoration: underline url(x)",
            "font-weight: 700!important",
            "color:red",
            "broken",
            "text-decoration: ",
        ] {
            assert_eq!(InlineStyle::parse(css).css(), None, "{css}");
        }
        assert_eq!(
            InlineStyle::parse(
                "font-weight:bold; font-weight:invalid; font-style:italic; font-style:invalid"
            )
            .css()
            .as_deref(),
            Some("font-weight: 700; font-style: italic")
        );
        assert_eq!(
            InlineStyle::parse("text-decoration:underline")
                .css()
                .as_deref(),
            Some("text-decoration: underline")
        );
        assert_eq!(
            InlineStyle::parse("text-decoration:line-through")
                .css()
                .as_deref(),
            Some("text-decoration: line-through")
        );
    }
}
