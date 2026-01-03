//! Data models for Tanah view generation.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingTimeFrame {
    pub from: String,
    pub to: String,
}

/// Deserialize a number that might be f64 or i64 into i32
pub fn deserialize_number_as_i32<'de, D>(deserializer: D) -> Result<Option<i32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    let opt: Option<serde_json::Number> = Option::deserialize(deserializer)?;
    match opt {
        Some(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Some(i as i32))
            } else if let Some(f) = n.as_f64() {
                Ok(Some(f as i32))
            } else {
                Err(D::Error::custom("Invalid number"))
            }
        }
        None => Ok(None),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Segment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(rename = "type")]
    pub segment_type: String,
    #[serde(rename = "recordingTimeFrame", skip_serializing_if = "Option::is_none")]
    pub recording_time_frame: Option<RecordingTimeFrame>,
    // Source JSON fields for ktiv/qri relationships
    #[serde(
        rename = "ktivOffset",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "deserialize_number_as_i32"
    )]
    pub ktiv_offset: Option<i32>,
    #[serde(
        rename = "qriOffset",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "deserialize_number_as_i32"
    )]
    pub qri_offset: Option<i32>,
}

impl Segment {
    /// Get the offset to the paired segment (qri/ktiv relationship).
    /// For qri: returns ktiv_offset (points to ktiv).
    /// For ktiv: returns qri_offset (points to qri).
    pub fn qri_ktiv_offset(&self) -> Option<i32> {
        match self.segment_type.as_str() {
            "qri" => self.ktiv_offset,
            "ktiv" => self.qri_offset,
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Pasuk {
    pub segments: Vec<Segment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Perek {
    #[serde(rename = "perekId")]
    pub perek_id: i32,
    pub header: String,
    pub date: Vec<i64>,
    pub star_rise: Vec<String>,
    pub pesukim: Vec<Pasuk>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Additional {
    pub letter: String,
    pub name: String,
    #[serde(rename = "tanachUsName", skip_serializing_if = "Option::is_none")]
    pub tanach_us_name: Option<String>,
    pub helek: String,
    pub order: i32,
    #[serde(rename = "pesukimCount")]
    pub pesukim_count: i32,
    #[serde(rename = "perekFrom")]
    pub perek_from: i32,
    #[serde(rename = "perekTo")]
    pub perek_to: i32,
    pub perakim: Vec<Perek>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Sefer {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    #[serde(rename = "tanachUsName", skip_serializing_if = "Option::is_none")]
    pub tanach_us_name: Option<String>,
    pub helek: String,
    #[serde(rename = "pesukimCount")]
    pub pesukim_count: i32,
    #[serde(rename = "perekFrom")]
    pub perek_from: i32,
    #[serde(rename = "perekTo")]
    pub perek_to: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additionals: Option<Vec<Additional>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub perakim: Option<Vec<Perek>>,
}
