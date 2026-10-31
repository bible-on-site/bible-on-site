use async_graphql::{InputObject, SimpleObject};

use super::tanahpedia_entries::{TanahpediaEntryStub, TanahpediaSynonymTarget};

/// A target an authorized client attaches to a Tanahpedia public address name
/// (alias / disambiguation member). `label` is the distinguishing text shown on
/// the disambiguation page; it is required on every target while the name is
/// shared by more than one entry.
#[derive(InputObject, Debug, Clone)]
pub struct TanahpediaAliasTargetInput {
    pub entry_id: String,
    pub label: Option<String>,
}

/// Input of `saveTanahpediaAlias`: replaces the whole target set of `name`
/// atomically — one target makes it a plain alias (redirect), several make it a
/// disambiguation page. `expectedTargets` is the snapshot the edit was based on
/// (an empty list for a name that was free then): because the save replaces the
/// complete shared set, a name that drifted under it is rejected as a conflict
/// instead of silently overwriting another writer's edit.
#[derive(InputObject, Debug, Clone, Default)]
pub struct SaveTanahpediaAliasInput {
    pub name: String,
    pub targets: Vec<TanahpediaAliasTargetInput>,
    pub expected_targets: Vec<TanahpediaAliasTargetInput>,
}

/// Live status of a candidate address name — the API counterpart of the admin
/// editor's `checkPediaName`, so an authorized client can evaluate a name
/// before writing it.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaNameStatus {
    /// `free` | `invalid` | `reserved` | `self-main` | `canonical` | `alias`.
    pub kind: String,
    /// The normalized stored form the status was computed for.
    pub name: String,
    /// Why the name is unusable (`kind` = `invalid`).
    pub reason: Option<String>,
    /// Category label whose route the name collides with (`kind` = `reserved`).
    pub category_label: Option<String>,
    /// The entry owning this canonical `unique_name` (`kind` = `canonical`).
    pub entry: Option<TanahpediaEntryStub>,
    /// The name's current alias targets (kinds `self-main`, `canonical`,
    /// `alias`).
    pub alias_targets: Vec<TanahpediaSynonymTarget>,
}

/// One address name an entry is a target of, with full management context —
/// the API counterpart of the admin editor's `getEntryAliases` view.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaEntryAlias {
    pub name: String,
    /// `alias` (one target) | `disambiguation` (shared name).
    pub kind: String,
    pub targets: Vec<TanahpediaSynonymTarget>,
    /// Set when another entry's canonical `unique_name` shadows this name (the
    /// name is unreachable publicly until that entry is renamed).
    pub shadowed_by_canonical: Option<TanahpediaEntryStub>,
    /// True when the name equals this entry's own `unique_name`.
    pub is_self_main: bool,
    /// Category label when the name collides with a reserved category route.
    pub reserved_category: Option<String>,
}

/// Result of `saveTanahpediaAlias`.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaAliasSaveResult {
    /// The normalized stored form of the saved name.
    pub name: String,
    /// `alias` | `disambiguation` — the resulting public behavior of the name.
    pub kind: String,
    /// Number of targets the name now leads to.
    pub target_count: i32,
    /// Post-commit website invalidation outcome: `APPLIED` | `FAILED` |
    /// `SKIPPED` (endpoint not configured on this instance). The write itself
    /// is already committed when this reports `FAILED` — retry by re-saving.
    pub revalidation: String,
}

/// Result of `removeTanahpediaEntryFromAlias` / `deleteTanahpediaAlias`.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaAliasRemovalResult {
    /// The normalized stored form of the affected name.
    pub name: String,
    /// `removeTanahpediaEntryFromAlias`: targets still bound to the name.
    /// `deleteTanahpediaAlias`: targets the delete removed.
    pub target_count: i32,
    /// Post-commit website invalidation outcome — same contract as
    /// `TanahpediaAliasSaveResult.revalidation`.
    pub revalidation: String,
}
