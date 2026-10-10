//! Environment configuration for the QA service.

pub fn db_url() -> String {
    std::env::var("DB_URL").unwrap_or_else(|_| {
        "mysql://root:test_123@127.0.0.1:3306/tanah-dev".to_string()
    })
}

pub fn bind_address() -> String {
    std::env::var("QA_BIND").unwrap_or_else(|_| "127.0.0.1:3004".to_string())
}
