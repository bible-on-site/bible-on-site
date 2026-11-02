//! GET /health/ready — readiness for local and ECS.

use actix_web::HttpResponse;

pub async fn ready() -> HttpResponse {
    HttpResponse::Ok().body("ok")
}
