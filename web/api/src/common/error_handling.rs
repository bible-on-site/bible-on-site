use derive_more::Display;

#[derive(Debug, Display)]
pub struct InternalCause(String);

impl InternalCause {
    pub fn new(cause: &str) -> Self {
        Self(cause.to_string())
    }
}

#[derive(Debug, Display)]
pub enum ServiceError {
    InternalServerError(String),
    BadRequest(String),
    Unauthorized(String),
    NotFound(String),
    Forbidden(String),
    Conflict(String),
}

pub const INTERNAL_SERVER_ERROR: &'static str = "Internal Server Error";
pub const INTERNAL_SERVER_ERROR_STATUS_CODE: u16 = 500;
pub const BAD_REQUEST: &'static str = "Bad Request";
pub const BAD_REQUEST_STATUS_CODE: u16 = 400;
pub const UNAUTHORIZED: &'static str = "Unauthorized";
pub const UNAUTHORIZED_STATUS_CODE: u16 = 401;
pub const NOT_FOUND: &'static str = "Not Found";
pub const NOT_FOUND_STATUS_CODE: u16 = 404;
pub const FORBIDDEN: &'static str = "Forbidden";
pub const FORBIDDEN_STATUS_CODE: u16 = 403;
pub const CONFLICT: &'static str = "Conflict";
pub const CONFLICT_STATUS_CODE: u16 = 409;
pub const SOMETHING_WENT_WRONG: &'static str = "Something went wrong";

impl ServiceError {
    pub fn to_str_name(&self) -> &'static str {
        match self {
            ServiceError::InternalServerError(_) => INTERNAL_SERVER_ERROR,
            ServiceError::BadRequest(_) => BAD_REQUEST,
            ServiceError::Unauthorized(_) => UNAUTHORIZED,
            ServiceError::NotFound(_) => NOT_FOUND,
            ServiceError::Forbidden(_) => FORBIDDEN,
            ServiceError::Conflict(_) => CONFLICT,
        }
    }

    pub fn get_status_code(&self) -> u16 {
        match self {
            ServiceError::InternalServerError(_) => INTERNAL_SERVER_ERROR_STATUS_CODE,
            ServiceError::BadRequest(_) => BAD_REQUEST_STATUS_CODE,
            ServiceError::Unauthorized(_) => UNAUTHORIZED_STATUS_CODE,
            ServiceError::NotFound(_) => NOT_FOUND_STATUS_CODE,
            ServiceError::Forbidden(_) => FORBIDDEN_STATUS_CODE,
            ServiceError::Conflict(_) => CONFLICT_STATUS_CODE,
        }
    }

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

    pub fn bad_request<T: std::fmt::Display + std::fmt::Debug>(
        message: &str,
        cause: Option<T>,
    ) -> Self {
        let error = Self::BadRequest(message.to_string());

        if let Some(cause) = cause {
            tracing::error!(BAD_REQUEST, %message, %cause);
        } else {
            tracing::error!(BAD_REQUEST, %message);
        }

        error
    }

    pub fn unauthorized<T: std::fmt::Display + std::fmt::Debug>(
        message: &str,
        cause: Option<T>,
    ) -> Self {
        let error = Self::Unauthorized(message.to_string());

        if let Some(cause) = cause {
            tracing::error!(UNAUTHORIZED, %message, %cause);
        } else {
            tracing::error!(UNAUTHORIZED, %message);
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

    pub fn forbidden<T: std::fmt::Display + std::fmt::Debug>(
        message: &str,
        cause: Option<T>,
    ) -> Self {
        let error = Self::Forbidden(message.to_string());

        if let Some(cause) = cause {
            tracing::error!(FORBIDDEN, %message, %cause);
        } else {
            tracing::error!(FORBIDDEN, %message);
        }

        error
    }

    pub fn conflict<T: std::fmt::Display + std::fmt::Debug>(
        message: &str,
        cause: Option<T>,
    ) -> Self {
        let error = Self::Conflict(message.to_string());

        if let Some(cause) = cause {
            tracing::error!(CONFLICT, %message, %cause);
        } else {
            tracing::error!(CONFLICT, %message);
        }

        error
    }
}
