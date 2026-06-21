use async_graphql::{InputObject, SimpleObject};

use entities::tanahpedia::entry_revision::Model;

/// A Tanahpedia entry revision proposed by an external AI client.
#[derive(SimpleObject, Debug, Clone)]
pub struct EntryRevision {
    pub id: String,
    /// `None` when the revision proposes a brand-new entry.
    pub entry_id: Option<String>,
    pub proposed_unique_name: Option<String>,
    pub proposed_title: Option<String>,
    /// Proposed entry body (HTML), as produced by the external AI.
    pub proposed_content: Option<String>,
    /// External AI client / model identifier (e.g. `"gpt-4o"`).
    pub source: String,
    /// AI rationale / notes for the human editor.
    pub notes: Option<String>,
    /// Lifecycle marker: `PENDING`, `APPROVED`, or `REJECTED`.
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<Model> for EntryRevision {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            entry_id: value.entry_id,
            proposed_unique_name: value.proposed_unique_name,
            proposed_title: value.proposed_title,
            proposed_content: value.proposed_content,
            source: value.source,
            notes: value.notes,
            status: value.status,
            created_at: value.created_at.to_string(),
            updated_at: value.updated_at.to_string(),
        }
    }
}

/// Input for `submitEntryRevision`. At least one of the `proposed_*` fields must
/// be present, and `source` must be non-empty. When `entry_id` is provided it
/// must reference an existing entry; omit it to propose a brand-new entry.
#[derive(InputObject, Debug, Clone, Default)]
pub struct SubmitEntryRevisionInput {
    pub entry_id: Option<String>,
    pub proposed_unique_name: Option<String>,
    pub proposed_title: Option<String>,
    pub proposed_content: Option<String>,
    pub source: String,
    pub notes: Option<String>,
}
