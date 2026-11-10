//! Per-request GraphQL work budgets — Phase 0 (option A) of the API-defense
//! design in `docs/api/access-keys-abuse-controls.md` (#3066).
//!
//! Every knob is env-configurable so tightening or rollback is an env change
//! plus a task restart, never a rebuild: schema limits are baked into the
//! schema at `build_schema` time and the body cap is registered as
//! `PayloadConfig` app data when the app factory runs. An explicit `0`
//! disables that control entirely — the documented emergency escape hatch.

use std::{env, time::Duration};

/// ~4x the deepest legitimate traffic: a full-schema introspection query
/// nests ~12 levels (`__schema -> types -> fields -> type -> ofType` x7 ->
/// leaf) and the app's heaviest operation (`TanahpediaPersonFamily`) is ~4.
/// Introspection stays enabled by decision (the schema is public source), so
/// the floor is ~13 — anything tighter breaks standard GraphQL tooling.
const DEFAULT_MAX_DEPTH: usize = 20;

/// ~5x the heaviest first-party operation (~60 fields on
/// `TanahpediaPersonFamily`) and above a full introspection dump (~180
/// fields). Bounds alias amplification at ~4x `starter` per request
/// (~25 fields per `starter` alias) instead of unbounded multiplication.
const DEFAULT_MAX_COMPLEXITY: usize = 300;

/// Real GraphQL bodies are a few KB of JSON and the schema exposes no
/// `Upload` fields, so a quarter-MiB cap is generous headroom, not a ceiling
/// legitimate clients approach. Mirrors actix-web's own `PayloadConfig`
/// default so behavior stays unsurprising if the env knob is removed.
const DEFAULT_MAX_BODY_BYTES: usize = 256 * 1024;

/// Far above the app's own 5-second read timeout; bounds a runaway resolver
/// (DB stall, pathological plan) without cutting any legitimate read.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

const MAX_DEPTH_ENV: &str = "GRAPHQL_MAX_DEPTH";
const MAX_COMPLEXITY_ENV: &str = "GRAPHQL_MAX_COMPLEXITY";
const MAX_BODY_BYTES_ENV: &str = "GRAPHQL_MAX_BODY_BYTES";
const TIMEOUT_MS_ENV: &str = "GRAPHQL_TIMEOUT_MS";

/// Resolved once per app-factory build and shared by the schema builder, the
/// `PayloadConfig` body cap and the request handler's execution timeout.
#[derive(Clone, Debug)]
pub struct GraphqlBudgets {
    /// Schema nesting-depth limit; `None` = unlimited (env `0`).
    pub max_depth: Option<usize>,
    /// Schema field-complexity limit; `None` = unlimited (env `0`).
    pub max_complexity: Option<usize>,
    /// Raw body cap in bytes; `0` = no cap (maps to `usize::MAX` in
    /// [`Self::payload_limit`], so `PayloadConfig` never trips).
    pub max_body_bytes: usize,
    /// Per-request execution budget; `None` = unbounded (env `0`).
    pub execution_timeout: Option<Duration>,
}

impl Default for GraphqlBudgets {
    /// Production defaults — what `resolve()` returns with no env overrides.
    fn default() -> Self {
        Self {
            max_depth: Some(DEFAULT_MAX_DEPTH),
            max_complexity: Some(DEFAULT_MAX_COMPLEXITY),
            max_body_bytes: DEFAULT_MAX_BODY_BYTES,
            execution_timeout: Some(DEFAULT_TIMEOUT),
        }
    }
}

impl GraphqlBudgets {
    /// Reads the process environment once.
    pub fn resolve() -> Self {
        Self::from_env(|name| env::var(name).ok())
    }

    /// `PayloadConfig` limit: an env-disabled (`0`) cap means no ceiling.
    pub fn payload_limit(&self) -> usize {
        if self.max_body_bytes == 0 {
            usize::MAX
        } else {
            self.max_body_bytes
        }
    }

    /// Parses each knob from `get(name)`; injectable so tests do not touch
    /// process env. Missing/unparseable values fall back to the defaults so
    /// a typo can never silently disarm a control.
    fn from_env(get: impl Fn(&str) -> Option<String>) -> Self {
        let default = Self::default();
        Self {
            max_depth: opt_usize(get(MAX_DEPTH_ENV), default.max_depth.unwrap_or(0)),
            max_complexity: opt_usize(get(MAX_COMPLEXITY_ENV), default.max_complexity.unwrap_or(0)),
            max_body_bytes: parse_usize(get(MAX_BODY_BYTES_ENV), default.max_body_bytes),
            execution_timeout: opt_usize(
                get(TIMEOUT_MS_ENV),
                default
                    .execution_timeout
                    .map(|d| d.as_millis() as usize)
                    .unwrap_or(0),
            )
            .map(|ms| Duration::from_millis(ms as u64)),
        }
    }
}

/// `0` disables (`None`); otherwise the parsed/default value.
fn opt_usize(raw: Option<String>, default: usize) -> Option<usize> {
    match parse_usize(raw, default) {
        0 => None,
        value => Some(value),
    }
}

fn parse_usize(raw: Option<String>, default: usize) -> usize {
    raw.and_then(|value| value.trim().parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn resolve_with(vars: &[(&str, &str)]) -> GraphqlBudgets {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        GraphqlBudgets::from_env(move |name| vars.get(name).cloned())
    }

    #[test]
    fn defaults_apply_without_any_env() {
        let budgets = resolve_with(&[]);
        assert_eq!(budgets.max_depth, Some(DEFAULT_MAX_DEPTH));
        assert_eq!(budgets.max_complexity, Some(DEFAULT_MAX_COMPLEXITY));
        assert_eq!(budgets.max_body_bytes, DEFAULT_MAX_BODY_BYTES);
        assert_eq!(budgets.execution_timeout, Some(DEFAULT_TIMEOUT));
        assert!(GraphqlBudgets::default().max_depth.is_some());
    }

    #[test]
    fn explicit_zero_disables_each_control() {
        let budgets = resolve_with(&[
            ("GRAPHQL_MAX_DEPTH", "0"),
            ("GRAPHQL_MAX_COMPLEXITY", "0"),
            ("GRAPHQL_MAX_BODY_BYTES", "0"),
            ("GRAPHQL_TIMEOUT_MS", "0"),
        ]);
        assert_eq!(budgets.max_depth, None);
        assert_eq!(budgets.max_complexity, None);
        assert_eq!(budgets.payload_limit(), usize::MAX);
        assert_eq!(budgets.execution_timeout, None);
    }

    #[test]
    fn configured_values_override_defaults() {
        let budgets = resolve_with(&[
            ("GRAPHQL_MAX_DEPTH", " 8 "),
            ("GRAPHQL_MAX_COMPLEXITY", "150"),
            ("GRAPHQL_MAX_BODY_BYTES", "4096"),
            ("GRAPHQL_TIMEOUT_MS", "2500"),
        ]);
        assert_eq!(budgets.max_depth, Some(8));
        assert_eq!(budgets.max_complexity, Some(150));
        assert_eq!(budgets.payload_limit(), 4096);
        assert_eq!(budgets.execution_timeout, Some(Duration::from_millis(2500)));
    }

    #[test]
    fn unparseable_values_fall_back_to_defaults() {
        let budgets = resolve_with(&[
            ("GRAPHQL_MAX_DEPTH", "deep"),
            ("GRAPHQL_MAX_COMPLEXITY", "-5"),
            ("GRAPHQL_MAX_BODY_BYTES", ""),
            ("GRAPHQL_TIMEOUT_MS", "1.5"),
        ]);
        assert_eq!(budgets.max_depth, Some(DEFAULT_MAX_DEPTH));
        assert_eq!(budgets.max_complexity, Some(DEFAULT_MAX_COMPLEXITY));
        assert_eq!(budgets.max_body_bytes, DEFAULT_MAX_BODY_BYTES);
        assert_eq!(budgets.execution_timeout, Some(DEFAULT_TIMEOUT));
    }
}
