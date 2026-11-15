//! Shared MongoDB connection configuration for the Sefaria crates.

pub fn mongo_host_port_from_env() -> (String, String) {
    mongo_host_port_from_vars(|key| std::env::var(key).ok())
}

pub fn mongo_host_port_from_vars(
    mut get_var: impl FnMut(&str) -> Option<String>,
) -> (String, String) {
    (
        get_var("MONGO_HOST").unwrap_or_else(|| "localhost".to_string()),
        get_var("MONGO_PORT").unwrap_or_else(|| "27017".to_string()),
    )
}

pub fn mongodb_uri(mongo_host: &str, mongo_port: &str) -> String {
    format!("mongodb://{}:{}", mongo_host, mongo_port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mongo_host_port_and_uri_use_defaults_and_overrides() {
        assert_eq!(
            mongo_host_port_from_vars(|_| None),
            ("localhost".to_string(), "27017".to_string())
        );
        assert_eq!(
            mongo_host_port_from_vars(|key| match key {
                "MONGO_HOST" => Some("mongo".to_string()),
                "MONGO_PORT" => Some("28017".to_string()),
                _ => None,
            }),
            ("mongo".to_string(), "28017".to_string())
        );
        assert_eq!(mongodb_uri("mongo", "28017"), "mongodb://mongo:28017");
    }
}
