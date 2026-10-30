//! What the API shows of labels: label.entity.ts and label-color.enum.ts in NestJS

use async_graphql::{Enum, SimpleObject};

/// The label palette (label-color.enum.ts). No red on purpose: red means "overdue" everywhere in the app.
/// (Your part in phase 3.)
///
/// The derive line makes it two things at once:
///   Enum: the GraphQL enum LabelColor. Each variant's name becomes its value in capitals: Gray -> GRAY.
///   sqlx::Type: the database's labels_color_enum. rename_all = "lowercase" saves Gray as 'gray'.
/// (Enum needs Clone, Copy, PartialEq and Eq too: a colour can be copied and compared like a number.)
#[derive(Enum, sqlx::Type, Clone, Copy, PartialEq, Eq)]
#[sqlx(type_name = "labels_color_enum", rename_all = "lowercase")]
pub enum LabelColor {
    Gray,
    Blue,
    Purple,
    Teal,
    Green,
    Yellow,
    Orange,
    Pink,
}

impl LabelColor {
    /// The colour's name in the database, and in what the chat assistant reads: "gray", "teal"...
    pub fn as_str(self) -> &'static str {
        match self {
            LabelColor::Gray => "gray",
            LabelColor::Blue => "blue",
            LabelColor::Purple => "purple",
            LabelColor::Teal => "teal",
            LabelColor::Green => "green",
            LabelColor::Yellow => "yellow",
            LabelColor::Orange => "orange",
            LabelColor::Pink => "pink",
        }
    }
}

/// A label, as the API shows it (type Label in ../backend/src/schema.gql)
#[derive(SimpleObject, sqlx::FromRow, Clone)]
pub struct Label {
    pub id: i32,
    pub name: String,
    pub color: LabelColor,
    pub board_id: i32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::resolver_utils::EnumType;

    #[test]
    fn the_palette_in_order() {
        // The order is the API's (enum LabelColor in ../backend/src/schema.gql)
        let names: Vec<&str> = LabelColor::items().iter().map(|item| item.name).collect();
        assert_eq!(
            names,
            ["GRAY", "BLUE", "PURPLE", "TEAL", "GREEN", "YELLOW", "ORANGE", "PINK"]
        );
    }
}
