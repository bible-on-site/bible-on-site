use async_graphql::{Context, EmptySubscription, Object, Schema};
use sqlx::MySqlPool;

pub type AppSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub fn create_schema(pool: MySqlPool) -> AppSchema {
    Schema::build(QueryRoot, MutationRoot, EmptySubscription)
        .data(pool)
        .finish()
}

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn hello(&self, _ctx: &Context<'_>) -> String {
        "Hello, world!".to_string()
    }
}

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    async fn noop(&self, _ctx: &Context<'_>) -> bool {
        true
    }
}
