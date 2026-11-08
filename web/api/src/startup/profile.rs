use std::env;

/// `PROFILE` values that explicitly opt in to non-production development
/// tooling (the GraphQL Playground and the `/api/shutdown` control route).
const DEV_TOOL_PROFILES: &[&str] = &["dev", "test"];

/// Runtime environment resolved once from the `PROFILE` variable. The same
/// value is shared between env-file selection and route registration so the
/// exposure policy cannot diverge.
///
/// Exposure fails closed: development tooling requires an explicit `dev` or
/// `test` profile, so a missing, blank or unrecognized `PROFILE` selects the
/// production posture.
#[derive(Clone, Debug)]
pub struct Profile {
    /// Normalized `PROFILE` value (empty when unset or blank).
    name: String,
    dev_tools: bool,
}

impl Profile {
    /// Reads `PROFILE` once. Callers pass the result along rather than
    /// re-reading the environment.
    pub fn resolve() -> Self {
        Self::from_name(env::var("PROFILE").ok().as_deref())
    }

    /// Only `dev`/`test` enable development tooling; every other value —
    /// including a missing, blank or unrecognized one — fails closed to the
    /// production posture.
    pub(crate) fn from_name(name: Option<&str>) -> Self {
        let name = name.unwrap_or_default().trim().to_owned();
        Self {
            dev_tools: DEV_TOOL_PROFILES.contains(&name.as_str()),
            name,
        }
    }

    /// Whether development-only tooling may be exposed in this environment.
    pub fn dev_tools_enabled(&self) -> bool {
        self.dev_tools
    }

    /// `.<name>.env` for a named profile, `.env` for production/default.
    fn env_file_name(&self) -> String {
        match self.name.as_str() {
            "" | "prod" => ".env".to_string(),
            name => format!(".{name}.env"),
        }
    }

    /// Loads the profile's env file when present; a missing file keeps the
    /// already-exported environment.
    pub fn load_env_file(&self) {
        let env_file = self.env_file_name();
        if let Err(e) = dotenvy::from_filename(&env_file) {
            tracing::warn!("Failed to load {} file: {}", env_file, e);
            tracing::warn!("Using default environment variables");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_tooling_requires_an_explicit_dev_or_test_profile() {
        for name in [Some("dev"), Some("test"), Some(" dev ")] {
            assert!(Profile::from_name(name).dev_tools_enabled(), "{name:?}");
        }
        for name in [
            None,
            Some(""),
            Some("   "),
            Some("prod"),
            Some("PROD"),
            Some("production"),
            Some("staging"),
            Some("dev2"),
        ] {
            assert!(!Profile::from_name(name).dev_tools_enabled(), "{name:?}");
        }
    }

    #[test]
    fn resolve_reads_the_process_profile_once() {
        // Read-only check: whatever PROFILE the test process runs under,
        // resolve() reflects exactly the same parsed value.
        let resolved = Profile::resolve();
        let expected = Profile::from_name(env::var("PROFILE").ok().as_deref());
        assert_eq!(resolved.dev_tools_enabled(), expected.dev_tools_enabled());
        assert_eq!(resolved.env_file_name(), expected.env_file_name());
    }

    #[test]
    fn load_env_file_warns_and_continues_when_the_file_is_missing() {
        // No `.staging.env` ships in the crate dir, so this exercises the
        // warn-and-continue path without mutating the process environment.
        Profile::from_name(Some("staging")).load_env_file();
    }

    #[test]
    fn env_file_names_follow_the_profile_with_production_fallback() {
        for (name, expected) in [
            (Some("prod"), ".env"),
            (None, ".env"),
            (Some(""), ".env"),
            (Some("dev"), ".dev.env"),
            (Some("test"), ".test.env"),
            (Some("staging"), ".staging.env"),
        ] {
            assert_eq!(
                Profile::from_name(name).env_file_name(),
                expected,
                "{name:?}"
            );
        }
    }
}
