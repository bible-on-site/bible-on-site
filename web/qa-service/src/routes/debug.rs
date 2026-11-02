//! GET /debug/stats — chunk counts by source type and parshan (dev only).

use actix_web::web::Data;
use serde::Serialize;
use std::collections::HashMap;

use crate::pipeline::ingest::Chunk;

#[derive(Serialize)]
struct Stats {
    total_chunks: usize,
    by_source_type: HashMap<String, usize>,
    by_author: HashMap<String, usize>,
    by_perush: HashMap<String, usize>,
    sample_perek_ids: Vec<i32>,
}

pub async fn stats(chunks: Data<Vec<Chunk>>) -> actix_web::HttpResponse {
    let mut by_source_type: HashMap<String, usize> = HashMap::new();
    let mut by_author: HashMap<String, usize> = HashMap::new();
    let mut by_perush: HashMap<String, usize> = HashMap::new();
    let mut perek_ids: Vec<i32> = Vec::new();

    for c in chunks.iter() {
        *by_source_type.entry(c.source_type.clone()).or_default() += 1;
        *by_author.entry(c.author.clone()).or_default() += 1;
        if let Some(ref pn) = c.perush_name {
            *by_perush.entry(pn.clone()).or_default() += 1;
        }
        if !perek_ids.contains(&c.perek_id) && perek_ids.len() < 20 {
            perek_ids.push(c.perek_id);
        }
    }
    perek_ids.sort();

    actix_web::HttpResponse::Ok().json(Stats {
        total_chunks: chunks.len(),
        by_source_type,
        by_author,
        by_perush,
        sample_perek_ids: perek_ids,
    })
}
