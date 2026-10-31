//! Real driver regression for UTC TIMESTAMP columns; MockDatabase skips SQLx decoding.
use async_graphql::{EmptyMutation, EmptySubscription, MergedObject, Schema};
use chrono::{DateTime, Duration, NaiveDateTime, Timelike, Utc};
use sea_orm::{
    EntityTrait, SqlxMySqlConnector,
    sqlx::{
        self, Executor,
        mysql::{MySqlConnectOptions, MySqlPoolOptions},
    },
};

use crate::{
    providers::Database,
    resolvers::{articles_resolver::ArticlesQuery, dedications_resolver::DedicationsQuery},
};
use entities::{
    article_covering_source, helek_dedication, masora_dedication, parasha_dedication,
    sefer_dedication, tanahpedia_entry_dedication,
};

#[derive(MergedObject, Default)]
struct TimestampQuery(ArticlesQuery, DedicationsQuery);

#[tokio::test]
#[ignore = "requires the explicitly named disposable MySQL fixture"]
async fn mysql_timestamp_columns_preserve_public_contract() {
    let url = std::env::var("ARTICLE_SEARCH_LOCK_TEST_DB_URL")
        .expect("isolated MySQL fixture URL is required");
    let options: MySqlConnectOptions = url.parse().expect("valid fixture URL");
    // Reuse the mandatory CI fixture, never the application database. Every
    // table below is session-local and vanishes when this single-session pool closes.
    assert_eq!(options.get_database(), Some("article_search_lock_test"));
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("isolated MySQL fixture");
    let timezone: String = sqlx::query_scalar("SELECT @@session.time_zone")
        .fetch_one(&pool)
        .await
        .expect("session time zone");
    // SQLx's default connection policy is UTC, including the production pool.
    assert_eq!(timezone, "+00:00");
    let db = Database::from_connection(SqlxMySqlConnector::from_sqlx_mysql_pool(pool.clone()));
    let expiry = (Utc::now() + Duration::days(30))
        .naive_utc()
        .with_nanosecond(0)
        .expect("whole-second expiry");
    let expiry_sql = expiry.format("%Y-%m-%d %H:%M:%S").to_string();
    let expiry_json = expiry.format("%Y-%m-%dT%H:%M:%SZ").to_string();

    for statement in [
        "CREATE TEMPORARY TABLE tanah_sefer (id INT, name TEXT, tanach_us_name TEXT NULL, perek_id_from INT, perek_id_to INT)",
        "INSERT INTO tanah_sefer VALUES (1, 'Fixture book', NULL, 1, 50)",
        "CREATE TEMPORARY TABLE tanah_helek (id INT, name TEXT, sefer_id_from INT, sefer_id_to INT)",
        "INSERT INTO tanah_helek VALUES (1, 'Fixture division', 1, 5)",
        "CREATE TEMPORARY TABLE tanah_dedication (id INT, subject TEXT, expires_at DATETIME NULL)",
        "CREATE TEMPORARY TABLE tanah_dedication_type (id INT, description TEXT)",
        "INSERT INTO tanah_dedication_type VALUES (1, 'Fixture purpose')",
        "CREATE TEMPORARY TABLE tanah_dedication_dedication_type (dedication_id INT, dedication_type_id INT)",
        "INSERT INTO tanah_dedication_dedication_type VALUES (1, 1), (2, 1)",
        "CREATE TEMPORARY TABLE tanah_perek_dedication (perek_id_low INT, perek_id_high INT, dedication_id INT, expires_at DATETIME NULL)",
        "CREATE TEMPORARY TABLE tanah_article_dedication (article_id INT, dedication_id INT, expires_at DATETIME NULL)",
        "CREATE TEMPORARY TABLE tanah_article (id INT, perek_id SMALLINT, author_id SMALLINT, abstract TEXT NULL, name TEXT, priority TINYINT, content TEXT NULL, coverage_verified BOOLEAN)",
        "INSERT INTO tanah_article VALUES (42, 1, 1, NULL, 'Fixture article', 1, NULL, TRUE)",
    ] {
        pool.execute(statement)
            .await
            .expect("session-local fixture table");
    }
    // Interpolated table/type identities are closed fixture literals; expiry
    // text is produced only by chrono formatting, never caller input.
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO tanah_dedication VALUES (1, 'Ongoing', NULL), (2, 'Expiring', '{expiry_sql}')"
    )))
    .execute(&pool)
    .await
    .expect("dedication fixture");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO tanah_perek_dedication VALUES (1, 1, 1, NULL), (1, 1, 2, '{expiry_sql}')"
    )))
    .execute(&pool)
    .await
    .expect("perek fixture");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO tanah_article_dedication VALUES (42, 1, NULL), (42, 2, '{expiry_sql}')"
    )))
    .execute(&pool)
    .await
    .expect("article dedication fixture");

    let schema = Schema::build(TimestampQuery::default(), EmptyMutation, EmptySubscription)
        .data(db.clone())
        .finish();
    // Production uses TIMESTAMP; older/generated fixtures can use DATETIME.
    // Both must retain exact UTC instants and the existing public null/string contract.
    for column_type in ["TIMESTAMP", "DATETIME"] {
        for (table, identity, value) in [
            ("tanah_sefer_dedication", "sefer_id INT", "1"),
            ("tanah_helek_dedication", "helek_id INT", "1"),
            ("tanah_parasha_dedication", "parasha_id INT", "1"),
            (
                "tanahpedia_entry_dedication",
                "entry_id VARCHAR(64)",
                "'fixture-entry'",
            ),
        ] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DROP TEMPORARY TABLE IF EXISTS {table}"
            )))
            .execute(&pool)
            .await
            .expect("reset local scope");
            sqlx::query(sqlx::AssertSqlSafe(format!("CREATE TEMPORARY TABLE {table} ({identity}, dedication_id INT, expires_at DATETIME NULL, created_at {column_type}(6) NOT NULL)"))).execute(&pool).await.expect("scope timestamp schema");
            sqlx::query(sqlx::AssertSqlSafe(format!("INSERT INTO {table} VALUES ({value}, 1, NULL, '2026-01-02 03:04:05.123456'), ({value}, 2, '{expiry_sql}', '2026-01-02 03:04:05.123456')"))).execute(&pool).await.expect("scope rows");
        }
        pool.execute("DROP TEMPORARY TABLE IF EXISTS tanah_masora_dedication")
            .await
            .expect("reset masora");
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE TEMPORARY TABLE tanah_masora_dedication (dedication_id INT, expires_at DATETIME NULL, created_at {column_type}(6) NOT NULL)"))).execute(&pool).await.expect("masora timestamp schema");
        sqlx::query(sqlx::AssertSqlSafe(format!("INSERT INTO tanah_masora_dedication VALUES (1, NULL, '2026-01-02 03:04:05.123456'), (2, '{expiry_sql}', '2026-01-02 03:04:05.123456')"))).execute(&pool).await.expect("masora rows");

        macro_rules! check_scopes {
            ($module:ident) => {{
                let rows = $module::Entity::find()
                    .all(db.get_connection())
                    .await
                    .expect(concat!(stringify!($module), " timestamp decoding"));
                assert_eq!(rows.len(), 2);
                for row in rows {
                    assert_eq!(
                        row.created_at.format("%Y-%m-%d %H:%M:%S%.6f").to_string(),
                        "2026-01-02 03:04:05.123456"
                    );
                    assert_eq!(
                        row.expires_at,
                        if row.dedication_id == 1 {
                            None
                        } else {
                            Some(expiry)
                        }
                    );
                }
            }};
        }
        check_scopes!(sefer_dedication);
        check_scopes!(helek_dedication);
        check_scopes!(parasha_dedication);
        check_scopes!(tanahpedia_entry_dedication);
        check_scopes!(masora_dedication);

        pool.execute("DROP TEMPORARY TABLE IF EXISTS tanah_article_covering_source")
            .await
            .expect("reset covering sources");
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE TEMPORARY TABLE tanah_article_covering_source (article_id INT, perek_id INT, pasuk SMALLINT, created_at {column_type}(6) NOT NULL)"))).execute(&pool).await.expect("covering source schema");
        pool.execute("INSERT INTO tanah_article_covering_source VALUES (42, 1, 2, '2026-01-02 03:04:05.123456')").await.expect("covering source row");
        let source = article_covering_source::Entity::find()
            .one(db.get_connection())
            .await
            .expect("covering source timestamp decoding")
            .expect("covering source");
        assert_eq!(
            source
                .created_at
                .format("%Y-%m-%d %H:%M:%S%.6f")
                .to_string(),
            "2026-01-02 03:04:05.123456"
        );

        // SQLx nullable decoding must also preserve NULL and a precise instant.
        pool.execute("DROP TEMPORARY TABLE IF EXISTS nullable_timestamp_probe")
            .await
            .expect("reset nullable probe");
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE TEMPORARY TABLE nullable_timestamp_probe (id INT, instant {column_type}(6) NULL)"))).execute(&pool).await.expect("nullable schema");
        pool.execute("INSERT INTO nullable_timestamp_probe VALUES (1, NULL), (2, '2026-01-02 03:04:05.123456')").await.expect("nullable rows");
        let instants: Vec<Option<DateTime<Utc>>> =
            sqlx::query_scalar("SELECT instant FROM nullable_timestamp_probe ORDER BY id")
                .fetch_all(&pool)
                .await
                .expect("nullable UTC datetime decoding");
        assert_eq!(instants[0], None);
        assert_eq!(
            instants[1].expect("non-null instant").naive_utc(),
            NaiveDateTime::parse_from_str("2026-01-02 03:04:05.123456", "%Y-%m-%d %H:%M:%S%.f")
                .expect("precise fixture instant")
        );

        let response = schema.execute(r#"
            {
              dedications(context: {perekIds: [1], parashaIds: [1], entryIds: ["fixture-entry"], articleIds: [42], masora: true}) {
                id subject purposes expiresAt scopes { kind expiresAt }
              }
              articleById(id: 42) { id coverageVerified coveringSources { perekId pasuk } }
            }
        "#).await;
        assert!(
            response.errors.is_empty(),
            "{column_type}: {:?}",
            response.errors
        );
        let json = response.data.into_json().expect("public JSON response");
        assert_eq!(json["articleById"], async_graphql::value!({"id": 42, "coverageVerified": true, "coveringSources": [{"perekId": 1, "pasuk": 2}]}).into_json().expect("expected article JSON"));
        let dedications = json["dedications"].as_array().expect("dedications");
        assert_eq!(dedications.len(), 2);
        for (position, dedication) in dedications.iter().enumerate() {
            assert_eq!(dedication["id"], (position + 1) as i32);
            assert_eq!(
                dedication["subject"],
                if position == 0 { "Ongoing" } else { "Expiring" }
            );
            assert_eq!(
                dedication["purposes"],
                async_graphql::value!(["Fixture purpose"])
                    .into_json()
                    .expect("expected purpose JSON")
            );
            let expected_expiry = if position == 0 {
                sea_orm::JsonValue::Null
            } else {
                sea_orm::JsonValue::String(expiry_json.clone())
            };
            assert_eq!(dedication["expiresAt"], expected_expiry);
            let scopes = dedication["scopes"].as_array().expect("scopes");
            assert_eq!(scopes.len(), 7);
            for scope in scopes {
                assert_eq!(scope["expiresAt"], expected_expiry);
            }
        }
    }
    pool.close().await;
}
