use async_graphql::{Error, ErrorExtensions};
use derive_more::Display;

#[derive(Debug, Display)]
pub enum ServiceError {
    #[display("{_0}")]
    InternalServerError(String),
    #[display("{_0}")]
    NotFound(String),
}

pub const INTERNAL_SERVER_ERROR: &str = "Internal Server Error";
pub const INTERNAL_SERVER_ERROR_STATUS_CODE: u16 = 500;
pub const NOT_FOUND: &str = "Not Found";
pub const NOT_FOUND_STATUS_CODE: u16 = 404;

impl ErrorExtensions for ServiceError {
    fn extend(&self) -> Error {
        Error::new(format!("{}", self)).extend_with(|_err, e| match self {
            ServiceError::InternalServerError(_) => {
                e.set("code", "INTERNAL_SERVER_ERROR");
                e.set("statusCode", INTERNAL_SERVER_ERROR_STATUS_CODE);
            }
            ServiceError::NotFound(_) => {
                e.set("code", "NOT_FOUND");
                e.set("statusCode", NOT_FOUND_STATUS_CODE);
            }
        })
    }
}

impl ServiceError {
    pub fn internal_server_error<T: std::fmt::Display + std::fmt::Debug>(
        message: &str,
        cause: Option<T>,
    ) -> Self {
        let error = Self::InternalServerError(message.to_string());

        if let Some(cause) = cause {
            tracing::error!(INTERNAL_SERVER_ERROR, %message, %cause);
        } else {
            tracing::error!(INTERNAL_SERVER_ERROR, %message);
        }

        error
    }

    pub fn not_found<T: std::fmt::Display + std::fmt::Debug>(
        message: &str,
        cause: Option<T>,
    ) -> Self {
        let error = Self::NotFound(message.to_string());

        if let Some(cause) = cause {
            tracing::error!(NOT_FOUND, %message, %cause);
        } else {
            tracing::error!(NOT_FOUND, %message);
        }

        error
    }
}
