//! validator.js's isISO8601(text, { strict: true }), which class-validator's @IsDateString({ strict: true }) asks
//! about a due date. Two steps, as in validator.js:
//!   1. The ISO 8601 pattern: a year; then maybe a month and day, a week ("2026-W44-4") or a day of the year
//!      ("2026-302"); then maybe a time and a time zone.
//!   2. strict: that date must exist (no 30 February, no day 366 in a year that isn't a leap year).
//!
//! The pattern, as validator.js writes it:
//!
//! ```text
//! ^([\+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-3])(-?[1-7])?|
//! (00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24:?00)([\.,]\d+(?!:))?)?
//! (\17[0-5]\d([\.,]\d+)?)?([zZ]|([\+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$
//! ```
//!
//! Rust's regex crate can't run it: `(?!...)` looks ahead, and `\3` and `\17` mean "the same text as group 3
//! (17) matched": the separator after the year ("-" or nothing) is used again before the day, and the one
//! between hour and minute (":" or nothing) again before the seconds. So it's written out as code below. A
//! pattern can match a text in more than one way, so each function gives back every place its part can end;
//! the text matches when one of the ways reaches its end.

use std::sync::LazyLock;

use chrono::NaiveDate;
use regex::Regex;

use crate::validate::is_js_space;

pub fn is_valid(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    matches_pattern(&chars) && is_real_date(text)
}

fn matches_pattern(s: &[char]) -> bool {
    let Some(after_year) = year(s) else {
        return false;
    };
    if after_year == s.len() {
        return true; // a year alone: "2026"
    }
    // (-?): the separator after the year, with a dash or without
    [true, false].into_iter().any(|dash| {
        (!dash || s.get(after_year) == Some(&'-'))
            && date(s, after_year + usize::from(dash), dash)
                .into_iter()
                .any(|end| end == s.len() || time(s, end).contains(&s.len()))
    })
}

/// [+-]?\d{4}(?!\d{2}\b): four digits, not followed by exactly two more ("202610" would be ambiguous)
fn year(s: &[char]) -> Option<usize> {
    let start = usize::from(matches!(s.first(), Some('+' | '-')));
    number(s, start, 4)?;
    let end = start + 4;
    let two_more = number(s, end, 2).is_some() && s.get(end + 2).is_none_or(|&c| !is_word(c));
    (!two_more).then_some(end)
}

/// After the year: a month (01-12) and maybe a day (01-31, after the same separator as after the year), a week
/// (W00-W53, maybe a weekday 1-7), or a day of the year (001-366, except 360, which validator.js's pattern skips)
fn date(s: &[char], at: usize, dash: bool) -> Vec<usize> {
    let mut ends = Vec::new();
    if number(s, at, 2).is_some_and(|month| (1..=12).contains(&month)) {
        ends.push(at + 2);
        let day = at + 2 + usize::from(dash);
        if (!dash || s.get(at + 2) == Some(&'-')) && number(s, day, 2).is_some_and(|day| (1..=31).contains(&day)) {
            ends.push(day + 2);
        }
    }
    if s.get(at) == Some(&'W') && number(s, at + 1, 2).is_some_and(|week| week <= 53) {
        let week_end = at + 3;
        let weekday = |i: usize| s.get(i).is_some_and(|c| ('1'..='7').contains(c));
        ends.push(week_end);
        if weekday(week_end) {
            ends.push(week_end + 1);
        }
        if s.get(week_end) == Some(&'-') && weekday(week_end + 1) {
            ends.push(week_end + 2);
        }
    }
    if number(s, at, 3).is_some_and(|day| (1..=366).contains(&day) && day != 360) {
        ends.push(at + 3);
    }
    ends
}

/// "T" or a space, then maybe an hour (and minute, and fraction), maybe seconds, maybe a time zone
fn time(s: &[char], at: usize) -> Vec<usize> {
    if !s.get(at).is_some_and(|&c| c == 'T' || is_js_space(c)) {
        return Vec::new();
    }
    let at = at + 1;
    // Where the hour part can end, with the separator it had between hour and minute (\17). None: no minute,
    // or no hour part at all; \17 then matches nothing.
    let mut after_hour = vec![(at, None)];
    for (end, colon) in hour(s, at) {
        after_hour.push((end, colon));
        // ([\.,]\d+(?!:)): a fraction not followed by ":"
        let fractions = fraction(s, end).into_iter().filter(|&f| s.get(f) != Some(&':'));
        after_hour.extend(fractions.map(|f| (f, colon)));
    }

    let mut ends = Vec::new();
    for (end, colon) in after_hour {
        // (\17[0-5]\d([\.,]\d+)?)?: seconds, after the same separator as between hour and minute
        let mut after_seconds = vec![end];
        let seconds = end + usize::from(colon == Some(true));
        if (colon != Some(true) || s.get(end) == Some(&':')) && number(s, seconds, 2).is_some_and(|n| n <= 59) {
            after_seconds.push(seconds + 2);
            after_seconds.extend(fraction(s, seconds + 2));
        }
        for end in after_seconds {
            ends.push(end);
            ends.extend(zone(s, end));
        }
    }
    ends
}

/// ([01]\d|2[0-3])((:?)[0-5]\d)? or 24:?00. Each end comes with the separator between hour and minute:
/// Some(true) ":", Some(false) none, None when there's no minute (24:00 counts as no minute: \17 isn't in it)
fn hour(s: &[char], at: usize) -> Vec<(usize, Option<bool>)> {
    let mut ends = Vec::new();
    let minute = |i: usize| number(s, i, 2).is_some_and(|minute| minute <= 59);
    if number(s, at, 2).is_some_and(|hour| hour <= 23) {
        ends.push((at + 2, None));
        if minute(at + 2) {
            ends.push((at + 4, Some(false)));
        }
        if s.get(at + 2) == Some(&':') && minute(at + 3) {
            ends.push((at + 5, Some(true)));
        }
    }
    if number(s, at, 2) == Some(24) {
        if number(s, at + 2, 2) == Some(0) {
            ends.push((at + 4, None));
        }
        if s.get(at + 2) == Some(&':') && number(s, at + 3, 2) == Some(0) {
            ends.push((at + 5, None));
        }
    }
    ends
}

/// [\.,]\d+: every place a fraction can end (one digit, two digits...)
fn fraction(s: &[char], at: usize) -> Vec<usize> {
    if !matches!(s.get(at), Some('.' | ',')) {
        return Vec::new();
    }
    (at + 1..)
        .take_while(|&i| s.get(i).is_some_and(|c| c.is_ascii_digit()))
        .map(|i| i + 1)
        .collect()
}

/// [zZ], or [+-] and an hour (00-23), maybe ":", maybe minutes (00-59)
fn zone(s: &[char], at: usize) -> Vec<usize> {
    match s.get(at) {
        Some('z' | 'Z') => vec![at + 1],
        Some('+' | '-') if number(s, at + 1, 2).is_some_and(|hour| hour <= 23) => {
            let mut ends = vec![at + 3];
            let colon = s.get(at + 3) == Some(&':');
            if colon {
                ends.push(at + 4);
            }
            let minutes = at + 3 + usize::from(colon);
            if number(s, minutes, 2).is_some_and(|minutes| minutes <= 59) {
                ends.push(minutes + 2);
            }
            ends
        }
        _ => Vec::new(),
    }
}

/// `len` ASCII digits at `at`, as a number (JavaScript's \d is only 0-9: "２" isn't a digit to it)
fn number(s: &[char], at: usize, len: usize) -> Option<u32> {
    s.get(at..at + len)?
        .iter()
        .try_fold(0, |n, c| c.to_digit(10).map(|digit| n * 10 + digit))
}

/// What \b counts as part of a word: letters, digits and _
fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// strict: validator.js's isValidDate. A day of the year must exist in that year, and a month with a day
/// ("2026-02-30", "20260230") must be a real date.
///
/// JavaScript checks the date by making a Date of it, and before the year 1000 that goes wrong: validator.js
/// writes the year without its leading zeros ("999-12-31"), which JavaScript reads in the server's own time zone,
/// not in UTC. East of UTC (Kuala Lumpur) that's the day before, so validator.js refuses it; before the year 100
/// it's read as 19xx or 20xx and refused everywhere. Rust refuses all of them.
fn is_real_date(text: &str) -> bool {
    static DAY_OF_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9]{4})-?([0-9]{3})([ T]\.*|$)").unwrap());
    static DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([0-9]{4})-?([0-9]{0,2})-?([0-9]*)").unwrap());

    if let Some(found) = DAY_OF_YEAR.captures(text) {
        let (year, day) = (to_number(&found[1]), to_number(&found[2]));
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        return day <= if leap { 366 } else { 365 };
    }
    let Some(found) = DATE.captures(text) else {
        return false; // can't happen: the pattern has already found four digits
    };
    let (year, month, day) = (to_number(&found[1]), to_number(&found[2]), to_number(&found[3]));
    if month == 0 || day == 0 {
        return true; // a year, a year and month, or a week: nothing more to check
    }
    year >= 1000 && NaiveDate::from_ymd_opt(year as i32, month as u32, day as u32).is_some()
}

/// JavaScript's Number() of a few digits: "" is 0
fn to_number(digits: &str) -> u64 {
    digits.parse().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // (text, what validator.js's isISO8601(text, { strict: true }) said)
    const VALIDATOR_JS: &[(&str, bool)] = &[
        ("2026-10-29", true),
        ("2026-02-29", false),
        ("2028-02-29", true),
        ("1900-02-29", false),
        ("2000-02-29", true),
        ("2026-02-30", false),
        ("2026-13-01", false),
        ("2026-00-10", false),
        ("2026-10-00", false),
        ("2026-10-32", false),
        ("2026-04-31", false),
        ("2026-10", true),
        ("2026", true),
        ("202610", false),
        ("20261029", true),
        ("2026-1029", false),
        ("202610-29", false),
        ("2026-1-5", false),
        ("+2026-10-29", true),
        ("-2026-10-29", true),
        ("0000-01-01", false),
        ("0999-12-31", false),
        ("1000-01-01", true),
        ("9999-12-31", true),
        ("2026-W44", true),
        ("2026W44", true),
        ("2026-W44-4", true),
        ("2026W444", true),
        ("2026-W54", false),
        ("2026-W00", true),
        ("2026-W44-8", false),
        ("2026-001", true),
        ("2026-302", true),
        ("2026-360", false),
        ("2026-359", true),
        ("2026-361", true),
        ("2026-365", true),
        ("2026-366", false),
        ("2028-366", true),
        ("2026302", true),
        ("2026-10-29T10:00:00Z", true),
        ("2026-10-29T10:00", true),
        ("2026-10-29T10", true),
        ("2026-10-29T1000", true),
        ("2026-10-29T10:0000", false),
        ("2026-10-2910:00", false),
        ("2026-10-29T24:00", true),
        ("2026-10-29T2400", true),
        ("2026-10-29T24:01", false),
        ("2026-10-29T23:59:60", false),
        ("2026-10-29T10:00:00.123", true),
        ("2026-10-29T10:00:00,5Z", true),
        ("2026-10-29T10:00.5", true),
        ("2026-10-29T10.5:00", false),
        ("2026-10-29T10:00+08:00", true),
        ("2026-10-29T10:00+0800", true),
        ("2026-10-29T10:00+08", true),
        ("2026-10-29T10:00+08:", true),
        ("2026-10-29T10:00-24:00", false),
        ("2026-10-29T10:00z", true),
        ("2026-10-29 10:00", true),
        ("2026-10-29\n", true),
        ("2026-10-29 ", true),
        ("2026-10-29T", true),
        ("2026-10-29T30", true),
        ("2026-10-29TZ", true),
        ("2026-10-29T+08", true),
        ("2026-10-29\u{a0}10:00", true),
        ("2026-10-29\u{3000}10:00", true),
        (" 2026-10-29", false),
        ("", false),
        ("hello", false),
        ("29/10/2026", false),
        ("２０２６-10-29", false),
        ("2026-10-29T10:00:00ZZ", false),
        ("2026_10", false),
        ("2026a", false),
        ("2026-W44-4T10:00", true),
        ("2026-302T10:00Z", true),
        ("2026-02-29T10:00", false),
        ("2026-10-29T10:00:00.1:2", false),
    ];

    #[test]
    fn like_validator_js() {
        for &(text, expected) in VALIDATOR_JS {
            assert_eq!(is_valid(text), expected, "{text:?}");
        }
    }
}
