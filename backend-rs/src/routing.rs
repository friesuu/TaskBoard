//! Who answers a GraphQL request: Rust, only when every top-level field of the operation has moved to Rust;
//! otherwise NestJS, which still has the whole API. Anything unusual goes to NestJS too: GraphQL that doesn't
//! parse (NestJS sends the proper error), introspection (__schema, __typename), a fragment at the top level,
//! or several operations without saying which one to run.

use async_graphql::parser::parse_query;
use async_graphql::parser::types::{DocumentOperations, OperationType, Selection};

/// The operations that have moved to Rust. Each phase adds its own here once its code is in and
/// scripts/e2e.sh passes with them.
pub struct Moved {
    pub queries: &'static [&'static str],
    pub mutations: &'static [&'static str],
}

pub const MOVED: Moved = Moved {
    queries: &[],
    mutations: &[],
};

/// `query`: the GraphQL text; `operation_name`: which of its operations to run (requests can send several)
pub fn rust_answers(query: &str, operation_name: Option<&str>, moved: &Moved) -> bool {
    let Ok(document) = parse_query(query) else {
        return false;
    };

    // The operation to run: the only one, or the one operation_name names
    let operation = match (&document.operations, operation_name) {
        (DocumentOperations::Single(operation), _) => operation,
        (DocumentOperations::Multiple(operations), Some(name)) => {
            match operations.iter().find(|(key, _)| key.as_str() == name) {
                Some((_, operation)) => operation,
                None => return false,
            }
        }
        (DocumentOperations::Multiple(_), None) => return false,
    };

    let names = match operation.node.ty {
        OperationType::Query => moved.queries,
        OperationType::Mutation => moved.mutations,
        OperationType::Subscription => return false,
    };

    // `all`: true only when it's true for every top-level field
    operation
        .node
        .selection_set
        .node
        .items
        .iter()
        .all(|item| match &item.node {
            Selection::Field(field) => names.contains(&field.node.name.node.as_str()),
            _ => false, // a fragment at the top level: NestJS
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    // The tests use their own list, so they don't change as operations move
    const SOME: Moved = Moved {
        queries: &["me", "boards"],
        mutations: &["logout"],
    };

    fn rust(query: &str, operation_name: Option<&str>) -> bool {
        rust_answers(query, operation_name, &SOME)
    }

    #[test]
    fn moved_operations_are_answered_in_rust() {
        assert!(rust("{ me { id } }", None));
        assert!(rust("query Me { me { email timeZone } }", Some("Me")));
        assert!(rust("{ me { id } boards { id } }", None)); // several fields, all moved
        assert!(rust("mutation { logout }", None));
        assert!(rust(
            "query A { tasks(boardId: 1) { id } } query B { me { id } }",
            Some("B")
        ));
    }

    #[test]
    fn everything_else_goes_to_nestjs() {
        assert!(!rust("{ me { id } tasks(boardId: 1) { id } }", None)); // one field hasn't moved
        assert!(!rust("mutation { me }", None)); // a moved query's name, but as a mutation
        assert!(!rust("{ __typename }", None));
        assert!(!rust("{ __schema { types { name } } }", None));
        assert!(!rust("{ ...Mine } fragment Mine on Query { me { id } }", None));
        assert!(!rust("query A { me { id } } query B { me { id } }", None)); // which one?
        assert!(!rust("query A { me { id } }", Some("Nope")));
        assert!(!rust("subscription { me { id } }", None));
        assert!(!rust("this is not graphql", None));
    }
}
