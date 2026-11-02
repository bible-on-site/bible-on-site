//! SURFACE: Format validated answers with citations and extracted spans.

use serde::Serialize;

use crate::pipeline::ingest::Chunk;
use crate::pipeline::validate::ValidatedAnswer;

#[derive(Debug, Serialize)]
pub struct AnswerSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub name: String,
    pub author: String,
    #[serde(rename = "perekId")]
    pub perek_id: i32,
    #[serde(rename = "articleId", skip_serializing_if = "Option::is_none")]
    pub article_id: Option<i32>,
    #[serde(rename = "perushSlug", skip_serializing_if = "Option::is_none")]
    pub perush_slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pasuk: Option<i16>,
    #[serde(rename = "noteIdx", skip_serializing_if = "Option::is_none")]
    pub note_idx: Option<i16>,
}

#[derive(Debug, Serialize)]
pub struct Answer {
    /// The extracted answer span (verbatim from source).
    pub text: String,
    /// Model confidence (0.0–1.0).
    pub confidence: f64,
    pub source: AnswerSource,
    /// Surrounding context for readability.
    pub context: String,
}

#[derive(Debug, Serialize)]
pub struct AskResponse {
    pub answers: Vec<Answer>,
    #[serde(rename = "noAnswer")]
    pub no_answer: bool,
}

fn source_from_chunk(c: &Chunk) -> AnswerSource {
    let name = c
        .article_name
        .clone()
        .or(c.perush_name.clone())
        .unwrap_or_default();
    AnswerSource {
        source_type: c.source_type.clone(),
        name,
        author: c.author.clone(),
        perek_id: c.perek_id,
        article_id: c.article_id,
        perush_slug: c.perush_name.clone(),
        pasuk: c.pasuk,
        note_idx: c.note_idx,
    }
}

pub fn surface(validated: &[ValidatedAnswer]) -> AskResponse {
    let answers: Vec<Answer> = validated
        .iter()
        .map(|v| {
            let a = &v.answer;
            Answer {
                text: a.span.text.clone(),
                confidence: v.combined_score,
                source: source_from_chunk(&a.chunk),
                context: a.chunk.text.clone(),
            }
        })
        .collect();

    let no_answer = answers.is_empty();
    AskResponse { answers, no_answer }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::qa_model::QaSpan;
    use crate::pipeline::reason::ReasonedAnswer;

    fn perush_chunk() -> Chunk {
        Chunk {
            source_type: "perush".into(),
            perek_id: 5,
            text: "context body".into(),
            author: "רש\"י".into(),
            perush_id: Some(23),
            perush_name: Some("rashi".into()),
            pasuk: Some(3),
            note_idx: Some(1),
            article_id: None,
            article_name: None,
        }
    }

    fn article_chunk() -> Chunk {
        Chunk {
            source_type: "article".into(),
            perek_id: 9,
            text: "article body".into(),
            author: "הרב כהן".into(),
            perush_id: None,
            perush_name: None,
            pasuk: None,
            note_idx: None,
            article_id: Some(77),
            article_name: Some("מאמר לדוגמא".into()),
        }
    }

    fn validated_of(chunk: Chunk, span_text: &str, score: f64) -> ValidatedAnswer {
        ValidatedAnswer {
            answer: ReasonedAnswer {
                chunk,
                span: QaSpan {
                    text: span_text.into(),
                    confidence: 0.9,
                },
                retrieval_score: 0.8,
            },
            combined_score: score,
        }
    }

    #[test]
    fn empty_input_marks_no_answer() {
        let res = surface(&[]);
        assert!(res.no_answer);
        assert!(res.answers.is_empty());
    }

    #[test]
    fn maps_span_text_confidence_and_context() {
        let res = surface(&[validated_of(perush_chunk(), "the span", 0.7)]);
        assert!(!res.no_answer);
        assert_eq!(res.answers.len(), 1);
        let a = &res.answers[0];
        assert_eq!(a.text, "the span");
        assert_eq!(a.confidence, 0.7);
        assert_eq!(a.context, "context body");
    }

    #[test]
    fn perush_source_carries_pasuk_and_note_idx() {
        let res = surface(&[validated_of(perush_chunk(), "s", 0.5)]);
        let src = &res.answers[0].source;
        assert_eq!(src.source_type, "perush");
        assert_eq!(src.name, "rashi");
        assert_eq!(src.author, "רש\"י");
        assert_eq!(src.pasuk, Some(3));
        assert_eq!(src.note_idx, Some(1));
        assert_eq!(src.perush_slug.as_deref(), Some("rashi"));
        assert_eq!(src.article_id, None);
    }

    #[test]
    fn article_source_prefers_article_name() {
        let res = surface(&[validated_of(article_chunk(), "s", 0.5)]);
        let src = &res.answers[0].source;
        assert_eq!(src.source_type, "article");
        assert_eq!(src.name, "מאמר לדוגמא");
        assert_eq!(src.article_id, Some(77));
        assert_eq!(src.perush_slug, None);
        assert_eq!(src.pasuk, None);
    }

    #[test]
    fn serializes_camel_case_field_names() {
        let res = surface(&[validated_of(perush_chunk(), "s", 0.5)]);
        let json = serde_json::to_value(&res).unwrap();
        let src = &json["answers"][0]["source"];
        assert!(src.get("perekId").is_some());
        assert!(src.get("perushSlug").is_some());
        assert!(src.get("noteIdx").is_some());
        assert_eq!(json["noAnswer"], false);
        // Optional fields are skipped when absent, not null.
        assert!(src.get("articleId").is_none());
    }
}
