//! Regression coverage against the real Sefaria dump used by data CI.
#![cfg(feature = "integration")]

use std::collections::HashSet;

use bson::{Document, doc};
use mongodb::Client;
use perushim_view::{aggregation, data::extract};

#[tokio::test]
async fn tanchuma_survives_the_complete_mongo_pipeline_and_keeps_paragraphs() {
    let host = std::env::var("MONGO_HOST").unwrap_or_else(|_| "localhost".into());
    let port = std::env::var("MONGO_PORT").unwrap_or_else(|_| "27017".into());
    let name = std::env::var("DUMP_NAME").unwrap_or_else(|_| "sefaria-dump-5784-sivan-4".into());
    let client = Client::with_uri_str(format!("mongodb://{host}:{port}"))
        .await
        .unwrap();
    let mut pipeline = aggregation::build_pipeline();
    pipeline.insert(0, doc! {"$match": {"title": "Midrash Tanchuma"}});
    let mut cursor = client
        .database(&name)
        .collection::<Document>("index")
        .aggregate(pipeline)
        .await
        .unwrap();
    let mut docs = Vec::new();
    while cursor.advance().await.unwrap() {
        docs.push(cursor.deserialize_current().unwrap());
    }
    assert_eq!(
        docs.len(),
        1,
        "Tanchuma must not be filtered out as a non-Tanakh category"
    );
    assert_eq!(docs[0].get_str("name").unwrap(), "מדרש תנחומא");
    let extracted = extract::extract(&docs).unwrap();
    assert_eq!(extracted.perushim.len(), 1);
    assert!(
        extracted.notes.len() >= 2100,
        "Paragraphs and multi-target passages must survive extraction"
    );
    let keys: HashSet<_> = extracted
        .notes
        .iter()
        .map(|n| (n.perush_id, n.perek_id, n.pasuk, n.note_idx))
        .collect();
    assert_eq!(keys.len(), extracted.notes.len());
    // Bereshit 11 changes from Cain (Genesis4) to Noah (Genesis5).
    assert!(
        extracted
            .notes
            .iter()
            .any(|n| n.perek_id == 5 && n.pasuk == 29)
    );
    // Supporting quotations must not move Tanchuma away from its Torah context.
    assert!(
        extracted
            .notes
            .iter()
            .all(|note| (1..=187).contains(&note.perek_id))
    );

    // Vayikra 8 keeps the opening 1:1-2 passage at its first verse and the
    // separate bird-offering passage at 1:14. Jonah remains supporting material.
    let vayikra = docs[0].get_array("versions").unwrap()[0]
        .as_document()
        .unwrap()
        .get_array("Vayikra")
        .unwrap();
    let source = vayikra[7]
        .as_str()
        .unwrap_or_else(|| vayikra[7].as_array().unwrap()[0].as_str().unwrap());
    let subjects: HashSet<_> = extracted
        .notes
        .iter()
        .filter(|note| note.note_content == source.trim())
        .map(|note| (note.perek_id, note.pasuk))
        .collect();
    assert_eq!(subjects, HashSet::from([(91, 1), (91, 14)]));
}
