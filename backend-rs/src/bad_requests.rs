//! Requests that are wrong before anything runs, answered the way Apollo (NestJS's GraphQL server) answers
//! them: HTTP 400, only "errors" (no "data"), and one of two codes:
//!   BAD_USER_INPUT: a variable is wrong: missing, null where it can't be, or a value that doesn't fit its type
//!     (the colour "RED" in $input). The error points at the variable: `$input` in `mutation ($input: ...)`.
//!   GRAPHQL_VALIDATION_FAILED: the query itself is wrong: an unknown field, or "RED" written into the query.
//! The messages are async-graphql's, except for missing and null variables, which are written here in Apollo's
//! words. The app never sends any of these: they're what a broken client gets.

use std::collections::HashMap;

use async_graphql::parser::parse_query;
use async_graphql::parser::types::{OperationDefinition, Selection, SelectionSet};
use async_graphql::{Name, Pos, Positioned, Request, ServerError, Value};
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::routing;

/// Apollo checks the variables before anything else, even the login: a required one (`$input: X!`) that's
/// missing or null stops the request here. async-graphql would only notice once a resolver reads it.
pub fn missing_variables(request: &Request) -> Option<Response> {
    let document = parse_query(&request.query).ok()?;
    let operation = routing::operation(&document, request.operation_name.as_deref())?;

    let errors: Vec<ServerError> = operation
        .node
        .variable_definitions
        .iter()
        .filter_map(|definition| {
            let variable = &definition.node;
            if variable.var_type.node.nullable || variable.default_value.is_some() {
                return None; // it may be left out
            }
            let (name, ty) = (&variable.name.node, &variable.var_type.node);
            let message = match request.variables.get(name) {
                None => format!(r#"Variable "${name}" of required type "{ty}" was not provided."#),
                Some(Value::Null) => format!(r#"Variable "${name}" of non-null type "{ty}" must not be null."#),
                Some(_) => return None,
            };
            Some(error(message, definition.pos, "BAD_USER_INPUT"))
        })
        .collect();
    (!errors.is_empty()).then(|| answer(errors))
}

/// A request async-graphql refused while checking it, before anything ran. An error about an argument whose
/// value is a variable is about that variable: it gets BAD_USER_INPUT and points at the variable instead.
pub fn refused(errors: Vec<ServerError>, query: &str, operation_name: Option<&str>) -> Response {
    let document = parse_query(query).ok();
    let operation = document
        .as_ref()
        .and_then(|document| routing::operation(document, operation_name));
    let variable_at = operation.map(variables_by_argument).unwrap_or_default();

    let errors = errors
        .into_iter()
        .map(|mut refused| {
            let variable = refused.locations.first().and_then(|at| variable_at.get(at)).copied();
            let code = match variable {
                Some(at) => {
                    refused.locations = vec![at];
                    "BAD_USER_INPUT"
                }
                None => "GRAPHQL_VALIDATION_FAILED",
            };
            refused
                .extensions
                .get_or_insert_with(Default::default)
                .set("code", code);
            refused
        })
        .collect();
    answer(errors)
}

/// For each argument whose value uses a variable: where the argument is -> where that variable is defined.
/// `createLabel(boardId: $boardId, input: $input)` gives two: `boardId` -> `$boardId: Int!`, `input` -> `$input: ...`
fn variables_by_argument(operation: &Positioned<OperationDefinition>) -> HashMap<Pos, Pos> {
    let defined: HashMap<&Name, Pos> = operation
        .node
        .variable_definitions
        .iter()
        .map(|definition| (&definition.node.name.node, definition.pos))
        .collect();
    let mut found = HashMap::new();
    look_in(&operation.node.selection_set.node, &defined, &mut found);
    found
}

/// Every argument in these fields and the fields inside them (a function that calls itself: the query is a tree)
fn look_in(selection_set: &SelectionSet, defined: &HashMap<&Name, Pos>, found: &mut HashMap<Pos, Pos>) {
    for selection in &selection_set.items {
        match &selection.node {
            Selection::Field(field) => {
                for (argument, value) in &field.node.arguments {
                    // into_const_with hands each variable in the value to the closure; the first one is enough
                    let mut variable = None;
                    let _ = value.node.clone().into_const_with(|name| {
                        variable = Some(name);
                        Err(())
                    });
                    if let Some(&at) = variable.as_ref().and_then(|name| defined.get(name)) {
                        found.insert(argument.pos, at);
                    }
                }
                look_in(&field.node.selection_set.node, defined, found);
            }
            Selection::InlineFragment(fragment) => look_in(&fragment.node.selection_set.node, defined, found),
            // A named fragment (`...Fields`): its arguments aren't looked at; that error stays GRAPHQL_VALIDATION_FAILED
            Selection::FragmentSpread(_) => {}
        }
    }
}

fn error(message: String, at: Pos, code: &str) -> ServerError {
    let mut error = ServerError::new(message, Some(at));
    error.extensions.get_or_insert_with(Default::default).set("code", code);
    error
}

/// HTTP 400 with only the errors (Apollo sends no "data" when nothing ran)
fn answer(errors: Vec<ServerError>) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "errors": errors }))).into_response()
}
