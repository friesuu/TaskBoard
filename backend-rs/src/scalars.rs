//! GraphQL scalars that Rust has to write the way NestJS does. For now one: DateTime, e.g. when a board was made.
//!
//! NestJS sends a JavaScript Date: "2026-10-29T02:34:40.123Z", always three digits after the second (the
//! database keeps microseconds; JavaScript cuts the rest off, it doesn't round) and Z for UTC. async-graphql's
//! own DateTime would send "2026-10-29T02:34:40.123456+00:00" instead, so this one is written out here.

use async_graphql::{InputValueError, InputValueResult, Scalar, ScalarType, Value};
use chrono::{SecondsFormat, Utc};

/// A moment in time. A struct around chrono's DateTime (a "newtype") so it can have its own GraphQL format.
/// `sqlx(transparent)`: a timestamptz column is read as the chrono value inside.
#[derive(Clone, Copy, sqlx::Type)]
#[sqlx(transparent)]
pub struct DateTime(pub chrono::DateTime<Utc>);

// #[Scalar]: the GraphQL scalar DateTime, made from these two functions
#[Scalar(name = "DateTime")]
impl ScalarType for DateTime {
    /// A DateTime sent to the API, e.g. "2026-10-29T02:34:40.123Z" (no moved operation takes one yet)
    fn parse(value: Value) -> InputValueResult<Self> {
        let Value::String(text) = &value else {
            return Err(InputValueError::expected_type(value));
        };
        chrono::DateTime::parse_from_rfc3339(text)
            .map(|time| DateTime(time.with_timezone(&Utc)))
            .map_err(InputValueError::custom)
    }

    /// A DateTime in an answer: milliseconds (cut off, as JavaScript does) and Z
    fn to_value(&self) -> Value {
        Value::String(self.0.to_rfc3339_opts(SecondsFormat::Millis, true))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sent(text: &str) -> Value {
        DateTime(text.parse().unwrap()).to_value()
    }

    #[test]
    fn written_like_a_javascript_date() {
        assert_eq!(
            sent("2026-10-29T02:34:40.123999Z"),
            Value::from("2026-10-29T02:34:40.123Z")
        );
        assert_eq!(sent("2026-10-29T02:34:40Z"), Value::from("2026-10-29T02:34:40.000Z"));
        assert_eq!(
            sent("2026-10-29T10:34:40.5+08:00"),
            Value::from("2026-10-29T02:34:40.500Z")
        );
    }
}
