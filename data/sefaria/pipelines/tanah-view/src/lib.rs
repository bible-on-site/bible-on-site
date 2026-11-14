//! tanah-view library for generating Tanah view data from MongoDB Sefaria data.

#![recursion_limit = "2048"]

pub mod aggregation;
pub mod commands;
pub mod data;
pub mod masora_sedarim;
pub mod models;
pub mod reading_units;
pub mod stages;

pub mod recitation;
