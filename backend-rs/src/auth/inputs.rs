//! What logging in, registering and the password and time zone settings take, and their input rules (the DTOs
//! in ../backend/src/auth). Each input's `checked` does what NestJS's ValidationPipe does. The names in
//! #[graphql(name)] are the GraphQL types' names in NestJS's schema; the fields become camelCase
//! (current_password -> currentPassword), like the DTOs' fields.

use async_graphql::InputObject;

use crate::validate;

#[derive(InputObject)]
#[graphql(name = "RegisterInput")]
pub struct RegisterInput {
    pub email: String,
    pub password: String,
}

impl RegisterInput {
    /// The email trimmed and in lowercase, then the rules
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.email = normalized_email(&self.email);
        validate::check([
            validate::email("email", &self.email),
            // @MinLength(8) @MaxLength(128): checked bottom up, as NestJS does
            validate::at_most("password", &self.password, 128),
            validate::at_least("password", &self.password, 8),
        ])?;
        Ok(self)
    }
}

#[derive(InputObject)]
#[graphql(name = "LoginInput")]
pub struct LoginInput {
    pub email: String,
    pub password: String,
}

impl LoginInput {
    /// The email trimmed and in lowercase, then the rules
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.email = normalized_email(&self.email);
        validate::check([
            validate::email("email", &self.email),
            // @IsString @IsNotEmpty @MaxLength(128), bottom up
            validate::at_most("password", &self.password, 128),
            validate::not_empty("password", &self.password),
        ])?;
        Ok(self)
    }
}

#[derive(InputObject)]
#[graphql(name = "ChangePasswordInput")]
pub struct ChangePasswordInput {
    pub current_password: String,
    pub new_password: String,
}

impl ChangePasswordInput {
    pub fn checked(self) -> async_graphql::Result<Self> {
        validate::check([
            // currentPassword: @IsString @IsNotEmpty @MaxLength(128), bottom up
            validate::at_most("currentPassword", &self.current_password, 128),
            validate::not_empty("currentPassword", &self.current_password),
            // newPassword: @MinLength(8) @MaxLength(128), bottom up
            validate::at_most("newPassword", &self.new_password, 128),
            validate::at_least("newPassword", &self.new_password, 8),
        ])?;
        Ok(self)
    }
}

#[derive(InputObject)]
#[graphql(name = "TimeZoneInput")]
pub struct TimeZoneInput {
    pub time_zone: String,
}

impl TimeZoneInput {
    pub fn checked(self) -> async_graphql::Result<Self> {
        validate::check([validate::time_zone("timeZone", &self.time_zone)])?;
        Ok(self)
    }
}

/// Emails are saved trimmed and in lowercase, and looked up that way (the @Transform in register.dto.ts)
fn normalized_email(email: &str) -> String {
    validate::js_trim(email).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emails_are_trimmed_and_lowercase() {
        assert_eq!(normalized_email("  Capture-A@Test.COM "), "capture-a@test.com");
    }
}
