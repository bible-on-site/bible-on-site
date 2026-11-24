//! MySQL connection for PDF requests that include articles.
//!
//! RDS connections verify the certificate and endpoint in DB_URL. Normal RDS
//! server-certificate renewals keep the embedded rds-ca-rsa2048-g1 root.
//! Changing the trust root requires a coordinated Bulletin package rollout
//! because the Lambda ZIP contains only the executable and fonts. A local
//! deployment can supply its own trust root through the `ssl-ca` URL option.

use std::env;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow, ensure};
use sea_orm::{
    ConnectOptions, DatabaseConnection,
    sqlx::mysql::{MySqlConnectOptions, MySqlSslMode},
};
use url::Url;

// Native TLS loads a single root from this file. Use the active RDS
// rds-ca-rsa2048-g1 root from the il-central-1 AWS trust-store bundle.
const RDS_CA: &[u8] = include_bytes!("rds-il-central-1-rsa2048-g1.pem");

fn explicit_ca_override(url: &Url) -> bool {
    url.query_pairs()
        .filter(|(key, _)| matches!(key.as_ref(), "ssl-ca" | "sslca"))
        .last()
        .is_some_and(|(_, value)| !value.is_empty())
}

fn configure_mysql_tls(mut options: MySqlConnectOptions, explicit_ca: bool) -> MySqlConnectOptions {
    let host = options
        .get_host()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.ends_with(".rds.amazonaws.com") {
        options = options
            .ssl_mode(MySqlSslMode::VerifyIdentity)
            .tls_sni_servername(&host);
        if !explicit_ca && host.ends_with(".il-central-1.rds.amazonaws.com") {
            options = options.ssl_ca_from_pem(RDS_CA.to_vec());
        }
    }
    options
}

#[derive(Debug, Clone)]
pub struct Database {
    connection: Arc<DatabaseConnection>,
}

impl Database {
    pub async fn new() -> Result<Self> {
        let database_url = env::var("DB_URL").context("DB_URL is required for article PDFs")?;
        Self::connect(&database_url).await
    }

    async fn connect(database_url: &str) -> Result<Self> {
        ensure!(
            database_url.starts_with("mysql://"),
            "DB_URL must use mysql://"
        );
        let url = Url::parse(database_url).map_err(|_| anyhow!("Invalid DB_URL"))?;
        let explicit_ca = explicit_ca_override(&url);
        let mut options = ConnectOptions::new(database_url);
        options.map_sqlx_mysql_opts(move |mysql| configure_mysql_tls(mysql, explicit_ca));
        let connection = sea_orm::Database::connect(options)
            .await
            .context("Could not connect to MySQL")?;
        Ok(Self {
            connection: Arc::new(connection),
        })
    }

    #[allow(dead_code)]
    pub fn from_connection(connection: DatabaseConnection) -> Self {
        Self {
            connection: Arc::new(connection),
        }
    }

    pub fn get_connection(&self) -> &DatabaseConnection {
        &self.connection
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::sqlx::{self, ConnectOptions as _};

    const FIXTURE_RDS_HOST: &str = "bulletin-fixture.test.il-central-1.rds.amazonaws.com";

    fn mysql_options(database_url: &str) -> MySqlConnectOptions {
        configure_mysql_tls(
            database_url.parse().unwrap(),
            explicit_ca_override(&Url::parse(database_url).unwrap()),
        )
    }

    #[test]
    fn verifies_rds_hostname_even_if_url_disables_tls() {
        let options = mysql_options(
            "mysql://reader:p%40ss@tanah-mysql.test.il-central-1.rds.amazonaws.com/tanah?ssl-mode=DISABLED",
        );
        assert!(matches!(
            options.get_ssl_mode(),
            MySqlSslMode::VerifyIdentity
        ));
        assert_eq!(options.get_username(), "reader");
        assert_eq!(options.get_database(), Some("tanah"));
        assert_eq!(
            options.get_host(),
            "tanah-mysql.test.il-central-1.rds.amazonaws.com"
        );
        assert!(
            options
                .to_url_lossy()
                .query_pairs()
                .any(|(key, value)| key == "ssl-ca" && value.as_bytes() == RDS_CA)
        );
    }

    #[test]
    fn preserves_local_database_tls_configuration() {
        let default = mysql_options("mysql://root@localhost/tanah-dev");
        assert!(matches!(default.get_ssl_mode(), MySqlSslMode::Preferred));
        let disabled = mysql_options("mysql://root@127.0.0.1/tanah-dev?ssl-mode=DISABLED");
        assert!(matches!(disabled.get_ssl_mode(), MySqlSslMode::Disabled));
    }

    #[test]
    fn preserves_an_explicit_rds_root_certificate_file() {
        let options = mysql_options(
            "mysql://reader@db.test.il-central-1.rds.amazonaws.com/tanah?ssl-ca=%2Fvar%2Ftask%2Frds.pem",
        );
        let url = options.to_url_lossy();
        assert!(
            url.query_pairs()
                .any(|(key, value)| key == "ssl-ca" && value == "file: /var/task/rds.pem")
        );
        assert!(matches!(
            options.get_ssl_mode(),
            MySqlSslMode::VerifyIdentity
        ));
    }

    #[tokio::test]
    async fn reports_connection_errors_without_echoing_credentials() {
        for url in [
            "mysql://user:sensitive@[bad/tanah",
            "postgres://user:sensitive@localhost/tanah",
            "mysql:user:sensitive@localhost/tanah",
            "mysql://user:sensitive@localhost/tanah?ssl-mode=bad",
        ] {
            let error = Database::connect(url).await.unwrap_err().to_string();
            assert!(!error.contains("sensitive"));
            assert!(error.contains("DB_URL") || error.contains("MySQL"));
        }
    }

    #[tokio::test]
    #[ignore = "requires a loopback MySQL 9.7 TLS fixture with BULLETIN_MYSQL_TLS_TEST_DB_URL and the fixture RDS DNS SAN"]
    async fn verifies_identity_end_to_end_on_mysql_97() {
        let fixture_url = env::var("BULLETIN_MYSQL_TLS_TEST_DB_URL").expect("isolated fixture URL");
        let options: MySqlConnectOptions = fixture_url.parse().unwrap();
        assert!(matches!(options.get_host(), "localhost" | "127.0.0.1"));
        assert_eq!(options.get_database(), Some("bulletin_mysql_tls_test"));
        let mut url = Url::parse(&fixture_url).unwrap();
        assert!(explicit_ca_override(&url), "fixture needs its own CA file");
        url.query_pairs_mut()
            .append_pair("ssl-mode", "DISABLED")
            .append_pair("tls-sni-servername", "ignored.invalid");
        let database = connect_rds_fixture(&url, FIXTURE_RDS_HOST).await.unwrap();
        let pool = database.get_mysql_connection_pool();
        let version: String = sqlx::query_scalar("SELECT VERSION()")
            .fetch_one(pool)
            .await
            .unwrap();
        assert!(version.starts_with("9.7."), "{version}");
        let cipher: String = sqlx::query_scalar(
            "SELECT VARIABLE_VALUE FROM performance_schema.session_status WHERE VARIABLE_NAME = 'Ssl_cipher'",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(!cipher.is_empty(), "expected a verified TLS connection");

        assert!(
            connect_rds_fixture(&url, "wrong.test.il-central-1.rds.amazonaws.com")
                .await
                .is_err(),
            "the hostname from the RDS policy must match the certificate"
        );
    }

    async fn connect_rds_fixture(
        url: &Url,
        logical_host: &'static str,
    ) -> Result<DatabaseConnection, sea_orm::DbErr> {
        let mut options = ConnectOptions::new(url.as_str());
        let explicit_ca = explicit_ca_override(url);
        options.map_sqlx_mysql_opts(move |mysql| {
            // Apply the production policy to the same logical hostname used
            // by TLS. Route only TCP to the disposable local fixture.
            let loopback = mysql.get_host().to_owned();
            configure_mysql_tls(mysql.host(logical_host), explicit_ca).host(&loopback)
        });
        sea_orm::Database::connect(options).await
    }
}
