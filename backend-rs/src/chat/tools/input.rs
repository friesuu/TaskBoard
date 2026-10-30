//! Reading a tool's input. Claude sends it as JSON, which may break the tool's rules (a title of 101 characters,
//! a status that doesn't exist...). NestJS checks it with Zod (betaZodTool), and a broken rule goes back to Claude
//! as Zod's list of "issues", in Zod's words: this does the same, for the rules the tools use, so Claude reads
//! exactly the same text from either backend. Each reader gives back the value when it keeps the rules, and writes
//! down an issue when it doesn't; `done` then says whether there were any.
//!
//!   let mut input = Input::new(raw)?;
//!   let id = input.int("id");
//!   let title = input.optional_text("title", TITLE);
//!   input.done()?;   // Err(Zod's issues as text) if anything was broken

use std::sync::LazyLock;

use async_graphql::MaybeUndefined;
use regex::Regex;
use serde_json::{Map, Value, json};

use crate::validate::js_trim;

/// The largest whole number JavaScript counts exactly (Number.MAX_SAFE_INTEGER): Zod refuses bigger ones
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// A text's rules, Zod's z.string() with .trim(), .min(), .max(), and the due date's .regex()
#[derive(Clone, Copy)]
pub struct Text {
    pub trim: bool,
    pub min: Option<usize>,
    pub max: Option<usize>,
    pub date: bool, // YYYY-MM-DD, or "Use YYYY-MM-DD"
}

/// A tool's input, and the broken rules found so far
pub struct Input<'a> {
    fields: &'a Map<String, Value>,
    issues: Vec<Value>,
}

impl<'a> Input<'a> {
    /// The input, which must be an object ({"id": 7, ...})
    pub fn new(input: &'a Value) -> Result<Input<'a>, String> {
        match input.as_object() {
            Some(fields) => Ok(Input {
                fields,
                issues: Vec::new(),
            }),
            None => Err(as_text(&[invalid_type("object", Some(input), &[])])),
        }
    }

    /// Ok when every rule was kept; otherwise Zod's issues, as Zod writes them (JSON, indented by 2)
    pub fn done(self) -> Result<(), String> {
        if self.issues.is_empty() {
            Ok(())
        } else {
            Err(as_text(&self.issues))
        }
    }

    /// A text that must be there
    pub fn text(&mut self, key: &str, rules: Text) -> Option<String> {
        let path = [json!(key)];
        let fields = self.fields;
        match fields.get(key) {
            Some(value) => self.read_text(value, rules, &path),
            None => self.broken(invalid_type("string", None, &path)),
        }
    }

    /// A text that can be left out (.optional())
    pub fn optional_text(&mut self, key: &str, rules: Text) -> Option<String> {
        let fields = self.fields;
        let value = fields.get(key)?;
        self.read_text(value, rules, &[json!(key)])
    }

    /// A text that can be left out or null (.nullable().optional()): null means "remove it"
    pub fn nullable_text(&mut self, key: &str, rules: Text) -> MaybeUndefined<String> {
        let fields = self.fields;
        match fields.get(key) {
            None => MaybeUndefined::Undefined,
            Some(Value::Null) => MaybeUndefined::Null,
            Some(value) => match self.read_text(value, rules, &[json!(key)]) {
                Some(text) => MaybeUndefined::Value(text),
                None => MaybeUndefined::Undefined, // broken: `done` will say so
            },
        }
    }

    /// A whole number that must be there (z.number().int())
    pub fn int(&mut self, key: &str) -> Option<i64> {
        let path = [json!(key)];
        let fields = self.fields;
        match fields.get(key) {
            Some(value) => self.read_int(value, None, &path),
            None => self.broken(invalid_type("number", None, &path)),
        }
    }

    /// A whole number that can be left out, with a smallest value
    pub fn optional_int(&mut self, key: &str, min: i64) -> Option<i64> {
        let fields = self.fields;
        let value = fields.get(key)?;
        self.read_int(value, Some(min), &[json!(key)])
    }

    /// true or false, or left out
    pub fn optional_bool(&mut self, key: &str) -> Option<bool> {
        let fields = self.fields;
        match fields.get(key)? {
            Value::Bool(value) => Some(*value),
            other => self.broken(invalid_type("boolean", Some(other), &[json!(key)])),
        }
    }

    /// One of a fixed list of words (z.enum), that must be there
    pub fn one_of(&mut self, key: &str, values: &[&str]) -> Option<String> {
        let fields = self.fields;
        // A missing one is "not one of them" too, in Zod's words
        self.read_one_of(fields.get(key).unwrap_or(&Value::Null), values, key)
    }

    /// One of a fixed list of words, or left out
    pub fn optional_one_of(&mut self, key: &str, values: &[&str]) -> Option<String> {
        let fields = self.fields;
        let value = fields.get(key)?;
        self.read_one_of(value, values, key)
    }

    /// A list of texts, each with `rules`, at least `min` and at most `max` of them
    pub fn texts(&mut self, key: &str, rules: Text, min: usize, max: usize) -> Option<Vec<String>> {
        let path = [json!(key)];
        let fields = self.fields;
        let Some(value) = fields.get(key) else {
            return self.broken(invalid_type("array", None, &path));
        };
        let items = self.read_list(value, min, max, &path)?;
        // Every item read first, so each broken one is written down (collecting straight into an Option would stop
        // at the first); then None if any was broken
        let read: Vec<Option<String>> = items
            .iter()
            .enumerate()
            .map(|(index, item)| self.read_text(item, rules, &[json!(key), json!(index)]))
            .collect();
        read.into_iter().collect()
    }

    /// A list of texts that can be left out
    pub fn optional_texts(&mut self, key: &str, rules: Text, max: usize) -> Option<Vec<String>> {
        self.fields.get(key)?;
        self.texts(key, rules, 0, max)
    }

    /// A list of whole numbers, at least `min` and at most `max` of them
    pub fn ints(&mut self, key: &str, min: usize, max: usize) -> Option<Vec<i64>> {
        let path = [json!(key)];
        let fields = self.fields;
        let Some(value) = fields.get(key) else {
            return self.broken(invalid_type("array", None, &path));
        };
        let items = self.read_list(value, min, max, &path)?;
        let read: Vec<Option<i64>> = items
            .iter()
            .enumerate()
            .map(|(index, item)| self.read_int(item, None, &[json!(key), json!(index)]))
            .collect();
        read.into_iter().collect()
    }

    // ----- One value, at `path` -----

    fn read_text(&mut self, value: &Value, rules: Text, path: &[Value]) -> Option<String> {
        let Value::String(text) = value else {
            return self.broken(invalid_type("string", Some(value), path));
        };
        let text = if rules.trim { js_trim(text) } else { text.as_str() };
        // Zod counts characters (an emoji is one), not JavaScript's UTF-16 units
        let length = text.chars().count();
        if let Some(min) = rules.min
            && length < min
        {
            return self.broken(too_small("string", min, path, &format!("to have >={min} characters")));
        }
        if let Some(max) = rules.max
            && length > max
        {
            return self.broken(too_big("string", max, path, &format!("to have <={max} characters")));
        }
        if rules.date && !is_date(text) {
            return self.broken(json!({
                "origin": "string", "code": "invalid_format", "format": "regex", "pattern": r"/^\d{4}-\d{2}-\d{2}$/",
                "path": path, "message": "Use YYYY-MM-DD"
            }));
        }
        Some(text.to_string())
    }

    fn read_int(&mut self, value: &Value, min: Option<i64>, path: &[Value]) -> Option<i64> {
        let Some(number) = value.as_f64() else {
            return self.broken(invalid_type("number", Some(value), path));
        };
        if number.fract() != 0.0 {
            return self.broken(json!({
                "expected": "int", "format": "safeint", "code": "invalid_type", "path": path,
                "message": "Invalid input: expected int, received number"
            }));
        }
        if number.abs() > MAX_SAFE_INTEGER {
            let (code, bound, limit, sign) = if number > 0.0 {
                ("too_big", "maximum", MAX_SAFE_INTEGER as i64, "<=")
            } else {
                ("too_small", "minimum", -(MAX_SAFE_INTEGER as i64), ">=")
            };
            let message = format!(
                "{} expected int to be {sign}{limit}",
                if number > 0.0 { "Too big:" } else { "Too small:" }
            );
            return self.broken(json!({
                "code": code, bound: limit, "note": "Integers must be within the safe integer range.",
                "origin": "int", "inclusive": true, "path": path, "message": message
            }));
        }
        let number = number as i64;
        if let Some(min) = min
            && number < min
        {
            return self.broken(too_small("number", min, path, &format!("to be >={min}")));
        }
        Some(number)
    }

    fn read_one_of(&mut self, value: &Value, values: &[&str], key: &str) -> Option<String> {
        match value.as_str() {
            Some(word) if values.contains(&word) => Some(word.to_string()),
            _ => {
                let quoted: Vec<String> = values.iter().map(|value| format!("\"{value}\"")).collect();
                self.broken(json!({
                    "code": "invalid_value", "values": values, "path": [key],
                    "message": format!("Invalid option: expected one of {}", quoted.join("|"))
                }))
            }
        }
    }

    /// A list's own rules first: when its length is wrong, Zod says only that, not what's wrong with its items
    fn read_list<'v>(&mut self, value: &'v Value, min: usize, max: usize, path: &[Value]) -> Option<&'v Vec<Value>> {
        let Value::Array(items) = value else {
            return self.broken(invalid_type("array", Some(value), path));
        };
        if items.len() < min {
            return self.broken(too_small("array", min, path, &format!("to have >={min} items")));
        }
        if items.len() > max {
            return self.broken(too_big("array", max, path, &format!("to have <={max} items")));
        }
        Some(items)
    }

    /// Writes down a broken rule. Gives back None, for the reader to give back.
    fn broken<T>(&mut self, issue: Value) -> Option<T> {
        self.issues.push(issue);
        None
    }
}

/// YYYY-MM-DD ([0-9]: the regex crate's \d also takes other scripts' digits, JavaScript's doesn't)
fn is_date(text: &str) -> bool {
    static DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$").unwrap());
    DATE.is_match(text)
}

/// "Invalid input: expected string, received number". `value` None: it wasn't there at all.
fn invalid_type(expected: &str, value: Option<&Value>, path: &[Value]) -> Value {
    let received = match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    };
    json!({
        "expected": expected, "code": "invalid_type", "path": path,
        "message": format!("Invalid input: expected {expected}, received {received}")
    })
}

fn too_small(origin: &str, minimum: impl Into<Value>, path: &[Value], rule: &str) -> Value {
    json!({
        "origin": origin, "code": "too_small", "minimum": minimum.into(), "inclusive": true, "path": path,
        "message": format!("Too small: expected {origin} {rule}")
    })
}

fn too_big(origin: &str, maximum: impl Into<Value>, path: &[Value], rule: &str) -> Value {
    json!({
        "origin": origin, "code": "too_big", "maximum": maximum.into(), "inclusive": true, "path": path,
        "message": format!("Too big: expected {origin} {rule}")
    })
}

/// The issues as Zod's error message: JSON.stringify(issues, null, 2)
fn as_text(issues: &[Value]) -> String {
    serde_json::to_string_pretty(issues).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TITLE: Text = Text {
        trim: true,
        min: Some(1),
        max: Some(100),
        date: false,
    };
    const DATE: Text = Text {
        trim: false,
        min: None,
        max: None,
        date: true,
    };

    /// Zod's issues, from their text back to a list (easier to compare)
    fn issues(text: String) -> Value {
        serde_json::from_str(&text).unwrap()
    }

    /// The create_task tool's rules, read from `input`: Ok, or the issues as a list
    fn create_task(input: Value) -> Result<(), Value> {
        let mut reader = Input::new(&input).map_err(issues)?;
        reader.text("title", TITLE);
        reader.optional_text(
            "description",
            Text {
                trim: false,
                min: None,
                max: Some(10000),
                date: false,
            },
        );
        reader.optional_text("dueDate", DATE);
        reader.optional_one_of("status", &["todo", "in_progress", "done"]);
        reader.done().map_err(issues)
    }

    // Each expected list is what Zod (in ../backend) gave for the same input
    #[test]
    fn issues_like_zod() {
        assert_eq!(create_task(json!({ "title": "  Buy milk  " })), Ok(()));
        assert_eq!(
            create_task(json!({ "title": " ", "dueDate": "2026-1-1", "status": "doing", "description": 5 })),
            Err(json!([
                { "origin": "string", "code": "too_small", "minimum": 1, "inclusive": true, "path": ["title"],
                  "message": "Too small: expected string to have >=1 characters" },
                { "expected": "string", "code": "invalid_type", "path": ["description"],
                  "message": "Invalid input: expected string, received number" },
                { "origin": "string", "code": "invalid_format", "format": "regex", "pattern": "/^\\d{4}-\\d{2}-\\d{2}$/",
                  "path": ["dueDate"], "message": "Use YYYY-MM-DD" },
                { "code": "invalid_value", "values": ["todo", "in_progress", "done"], "path": ["status"],
                  "message": "Invalid option: expected one of \"todo\"|\"in_progress\"|\"done\"" }
            ]))
        );
        assert_eq!(
            create_task(json!({})),
            Err(
                json!([{ "expected": "string", "code": "invalid_type", "path": ["title"],
                "message": "Invalid input: expected string, received undefined" }])
            )
        );
        assert_eq!(
            create_task(Value::Null),
            Err(json!([{ "expected": "object", "code": "invalid_type", "path": [],
                "message": "Invalid input: expected object, received null" }]))
        );
        // Characters, not UTF-16 units: two emoji are 2
        let value = json!({ "t": " 😀😀 " });
        let mut reader = Input::new(&value).unwrap();
        assert_eq!(
            reader.text(
                "t",
                Text {
                    trim: true,
                    min: Some(1),
                    max: Some(3),
                    date: false
                }
            ),
            Some("😀😀".to_string())
        );
    }

    #[test]
    fn numbers_and_lists_like_zod() {
        let value = json!({ "ids": [1.5, "a"], "p": -1.5, "big": 1_152_921_504_606_846_976u64, "b": "yes" });
        let mut reader = Input::new(&value).unwrap();
        reader.ints("ids", 1, 5);
        reader.optional_int("p", 0);
        reader.int("big");
        reader.optional_bool("b");
        let issues: Value = serde_json::from_str(&reader.done().unwrap_err()).unwrap();
        assert_eq!(
            issues,
            json!([
                { "expected": "int", "format": "safeint", "code": "invalid_type", "path": ["ids", 0],
                  "message": "Invalid input: expected int, received number" },
                { "expected": "number", "code": "invalid_type", "path": ["ids", 1],
                  "message": "Invalid input: expected number, received string" },
                { "expected": "int", "format": "safeint", "code": "invalid_type", "path": ["p"],
                  "message": "Invalid input: expected int, received number" },
                { "code": "too_big", "maximum": 9_007_199_254_740_991i64, "note": "Integers must be within the safe integer range.",
                  "origin": "int", "inclusive": true, "path": ["big"], "message": "Too big: expected int to be <=9007199254740991" },
                { "expected": "boolean", "code": "invalid_type", "path": ["b"],
                  "message": "Invalid input: expected boolean, received string" }
            ])
        );
        // A list that's too long: only that, not its broken items
        let value = json!({ "ids": ["a", 1, 2, 3, 4, 5], "p": -1 });
        let mut reader = Input::new(&value).unwrap();
        reader.ints("ids", 1, 5);
        reader.optional_int("p", 0);
        let issues: Value = serde_json::from_str(&reader.done().unwrap_err()).unwrap();
        assert_eq!(
            issues,
            json!([
                { "origin": "array", "code": "too_big", "maximum": 5, "inclusive": true, "path": ["ids"],
                  "message": "Too big: expected array to have <=5 items" },
                { "origin": "number", "code": "too_small", "minimum": 0, "inclusive": true, "path": ["p"],
                  "message": "Too small: expected number to be >=0" }
            ])
        );
    }

    #[test]
    fn written_like_json_stringify() {
        // JSON.stringify(issues, null, 2), as NestJS sent it to Claude (target/phase8/nestjs.json)
        let value = json!({ "ids": [] });
        let mut reader = Input::new(&value).unwrap();
        reader.ints("ids", 1, 5);
        assert_eq!(
            reader.done().unwrap_err(),
            "[\n  {\n    \"origin\": \"array\",\n    \"code\": \"too_small\",\n    \"minimum\": 1,\n    \"inclusive\": true,\n    \"path\": [\n      \"ids\"\n    ],\n    \"message\": \"Too small: expected array to have >=1 items\"\n  }\n]"
        );
    }
}
