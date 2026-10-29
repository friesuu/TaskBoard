//! "Today" and "this week" as calendar dates where the user is (common/dates.ts in NestJS). Due dates are plain
//! dates with no time ("2026-10-29"), so the board compares them with these: overdue, due today, due this week.

use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use chrono_tz::Tz;

/// A user's time zone, ready for chrono. setTimeZone takes two kinds, as the browser's Intl does:
///   Named: a zone from the time zone database, e.g. "Asia/Kuala_Lumpur". It knows the zone's history and its
///     summer time, so its offset from UTC can change during the year (New York: -4 hours in summer, -5 in winter).
///   Offset: a fixed offset from UTC, e.g. "+05:30". The same all year.
#[allow(dead_code)] // today_in reads the zone inside each kind once you've written it: then remove this line
pub enum Zone {
    Named(Tz),
    Offset(FixedOffset),
}

impl Zone {
    /// The time zone a user saved. None (the browser hasn't sent one yet) is UTC, as in NestJS. One chrono can't
    /// read is UTC too, with a warning in the log (setTimeZone only saves ones it can read).
    pub fn of(time_zone: Option<&str>) -> Zone {
        let Some(name) = time_zone else {
            return Zone::Named(Tz::UTC);
        };
        if let Ok(tz) = Tz::from_str_insensitive(name) {
            return Zone::Named(tz);
        }
        match offset(name) {
            Some(offset) => Zone::Offset(offset),
            None => {
                tracing::warn!("Unknown time zone {name:?}: using UTC");
                Zone::Named(Tz::UTC)
            }
        }
    }
}

/// "+05:30", "+0530" or "+05" (the offsets validate::is_time_zone allows) as a FixedOffset
fn offset(text: &str) -> Option<FixedOffset> {
    let (sign, rest) = match text.split_at_checked(1)? {
        ("+", rest) => (1, rest),
        ("-", rest) => (-1, rest),
        _ => return None,
    };
    let digits = rest.replacen(':', "", 1);
    if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let (hours, minutes): (i32, i32) = match digits.len() {
        2 => (digits.parse().ok()?, 0),
        4 => (digits[..2].parse().ok()?, digits[2..].parse().ok()?),
        _ => return None,
    };
    FixedOffset::east_opt(sign * (hours * 3600 + minutes * 60))
}

// ===================================== YOUR PART (phase 4) =====================================
// Two function bodies. The tests at the bottom say what each must give back: `cargo test dates`.
// The steps are in ../README.md.

/// Today's date in `zone` at the moment `now`. At 20:00 UTC on 28 October 2026, it's already the 29th in
/// Kuala Lumpur (UTC+8), but still the 28th in London.
///
/// Hints:
/// - One `match zone { ... }` with an arm for each kind of Zone: `Zone::Named(tz) => ...` and
///   `Zone::Offset(offset) => ...`. `zone` is a reference (&Zone), so `tz` and `offset` are references too.
/// - `now.with_timezone(tz)` is the same moment as a time in that zone; `.date_naive()` is its date.
/// - The two arms make different types of time (one in a Tz, one in a FixedOffset), so `.date_naive()` goes
///   inside each arm: both arms then give a NaiveDate, which is what the match gives back.
#[allow(unused_variables)] // remove this line when you've written it
pub fn today_in(zone: &Zone, now: DateTime<Utc>) -> NaiveDate {
    todo!("phase 4, your part: today's date where the user is")
}

/// The Monday and the Sunday of the week `day` is in (weeks start on Monday)
///
/// Hints:
/// - `day.weekday().num_days_from_monday()` is 0 on a Monday ... 6 on a Sunday. `.weekday()` comes from the trait
///   chrono::Datelike: a method of a trait only works when the trait is in scope, so add `Datelike` to the `use
///   chrono::{...}` line at the top (try without it first, and read what the compiler says).
/// - `day - Days::new(n)` is n days earlier, `+` later (`Days` needs adding to the `use` line too). Days::new wants
///   a u64; num_days_from_monday gives a u32: `u64::from(number)` turns one into the other.
/// - Give back both dates as a tuple: `(monday, sunday)`.
#[allow(unused_variables)] // remove this line when you've written it
pub fn week_of(day: NaiveDate) -> (NaiveDate, NaiveDate) {
    todo!("phase 4, your part: this week's Monday and Sunday")
}
// ================================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn at(moment: &str) -> DateTime<Utc> {
        moment.parse().unwrap()
    }

    fn date(text: &str) -> NaiveDate {
        text.parse().unwrap()
    }

    fn today(time_zone: Option<&str>, moment: &str) -> NaiveDate {
        today_in(&Zone::of(time_zone), at(moment))
    }

    #[test]
    fn today_where_the_user_is() {
        assert_eq!(
            today(Some("Asia/Kuala_Lumpur"), "2026-10-28T20:00:00Z"),
            date("2026-10-29")
        );
        assert_eq!(today(Some("Europe/London"), "2026-10-28T20:00:00Z"), date("2026-10-28"));
        assert_eq!(
            today(Some("Pacific/Pago_Pago"), "2026-10-29T06:00:00Z"),
            date("2026-10-28")
        );
        assert_eq!(today(None, "2026-10-28T23:59:59Z"), date("2026-10-28")); // no time zone: UTC
    }

    #[test]
    fn today_with_an_offset() {
        assert_eq!(today(Some("+05:30"), "2026-10-28T18:29:00Z"), date("2026-10-28")); // 23:59 there
        assert_eq!(today(Some("+05:30"), "2026-10-28T18:30:00Z"), date("2026-10-29")); // midnight there
        assert_eq!(today(Some("-11:00"), "2026-10-29T06:00:00Z"), date("2026-10-28"));
    }

    #[test]
    fn today_knows_summer_time() {
        // New York leaves summer time (UTC-4) at 06:00 UTC on 1 November 2026, for winter time (UTC-5)
        assert_eq!(
            today(Some("America/New_York"), "2026-11-01T03:59:00Z"),
            date("2026-10-31")
        );
        assert_eq!(
            today(Some("America/New_York"), "2026-11-01T04:00:00Z"),
            date("2026-11-01")
        );
        assert_eq!(
            today(Some("America/New_York"), "2026-11-02T04:30:00Z"),
            date("2026-11-01")
        ); // winter: UTC-5
    }

    #[test]
    fn a_week_is_monday_to_sunday() {
        let week = (date("2026-10-26"), date("2026-11-01"));
        assert_eq!(week_of(date("2026-10-29")), week); // a Thursday
        assert_eq!(week_of(date("2026-10-26")), week); // the Monday itself
        assert_eq!(week_of(date("2026-11-01")), week); // the Sunday itself, in the next month
        assert_eq!(week_of(date("2026-01-01")), (date("2025-12-29"), date("2026-01-04"))); // across the new year
    }

    // Reading a saved time zone (not your part: these pass already)
    #[test]
    fn time_zones_as_saved() {
        assert!(matches!(
            Zone::of(Some("europe/london")),
            Zone::Named(Tz::Europe__London)
        ));
        assert!(matches!(Zone::of(None), Zone::Named(Tz::UTC)));
        assert!(matches!(Zone::of(Some("Mars/Olympus_Mons")), Zone::Named(Tz::UTC)));
        for (text, seconds) in [("+05:30", 19800), ("+0530", 19800), ("+05", 18000), ("-11:00", -39600)] {
            assert!(
                matches!(Zone::of(Some(text)), Zone::Offset(offset) if offset.local_minus_utc() == seconds),
                "{text}"
            );
        }
    }
}
