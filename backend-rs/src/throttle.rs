//! Rate limits, like NestJS's ThrottlerGuard: each operation (login, register, changePassword, deleteAccount)
//! counts each person's tries separately; at most `limit` in a minute. The next one is refused, and the person
//! stays refused until that minute is over, even with the right password. Then they start again from zero.
//! "Each person" is their address for login and register, and their account once logged in.
//!
//! DISABLE_RATE_LIMIT=true switches every limit off (the e2e tests log in many times).

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::http::HeaderMap;

use crate::errors::too_many_attempts;

const WINDOW: Duration = Duration::from_secs(60);

/// Every person's recent tries, per operation. A Mutex: requests are answered at the same time on several
/// threads, and only one at a time may change the list. (std's Mutex is fine here: it's held only for a
/// moment, never across an `.await`.)
#[derive(Default)]
pub struct RateLimits {
    tries: Mutex<HashMap<(String, String), Tries>>,
}

#[derive(Default)]
struct Tries {
    at: VecDeque<Instant>, // when each try in the last minute was made, oldest first
    refused_until: Option<Instant>,
}

impl RateLimits {
    /// One more try at `operation` by `who`: Ok, or the "Too many attempts" error
    pub fn check(&self, operation: &str, who: &str, limit: usize) -> async_graphql::Result<()> {
        if std::env::var("DISABLE_RATE_LIMIT").as_deref() == Ok("true") {
            return Ok(());
        }
        if self.allow(operation, who, limit, Instant::now()) {
            Ok(())
        } else {
            Err(too_many_attempts())
        }
    }

    /// The rule itself, with the time passed in so the tests don't have to wait a minute
    fn allow(&self, operation: &str, who: &str, limit: usize, now: Instant) -> bool {
        let mut all = self.tries.lock().expect("no thread panics while holding this lock");
        if all.len() > 10_000 {
            // Forget people with no try in the last minute, so the list can't grow forever
            all.retain(|_, tries| {
                tries.refused_until.is_some_and(|until| until > now)
                    || tries.at.back().is_some_and(|last| now - *last < WINDOW)
            });
        }

        let tries = all.entry((operation.to_string(), who.to_string())).or_default();
        match tries.refused_until {
            Some(until) if now < until => return false,
            Some(_) => *tries = Tries::default(), // the minute is over: start again
            None => {}
        }
        while tries.at.front().is_some_and(|first| now - *first >= WINDOW) {
            tries.at.pop_front(); // older than a minute: doesn't count any more
        }
        tries.at.push_back(now);
        if tries.at.len() > limit {
            tries.refused_until = Some(now + WINDOW);
            return false;
        }
        true
    }
}

/// Who sent a request, for the limits that count by address. Like NestJS ('trust proxy' = loopback): the address
/// the request came from, unless that's this computer (e.g. a web server in front, or a test). Then the last
/// address in X-Forwarded-For, and so on back, while each one is this computer too.
pub fn client_address(sender: IpAddr, headers: &HeaderMap) -> IpAddr {
    let forwarded: Vec<IpAddr> = headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map_while(|address| address.trim().parse().ok()) // stops at anything that isn't an address
        .collect();

    let mut client = sender.to_canonical();
    for address in forwarded.iter().rev() {
        if !client.is_loopback() {
            break;
        }
        client = address.to_canonical();
    }
    client
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn five_a_minute_then_refused_for_the_rest_of_it() {
        let limits = RateLimits::default();
        let start = Instant::now();
        let at = |seconds: u64| start + Duration::from_secs(seconds);

        for second in 0..5 {
            assert!(
                limits.allow("login", "203.0.113.1", 5, at(second)),
                "try {}",
                second + 1
            );
        }
        assert!(!limits.allow("login", "203.0.113.1", 5, at(5)), "the 6th is refused");
        assert!(limits.allow("login", "203.0.113.2", 5, at(5)), "someone else isn't");
        assert!(
            limits.allow("register", "203.0.113.1", 5, at(5)),
            "another operation isn't"
        );
        assert!(
            !limits.allow("login", "203.0.113.1", 5, at(64)),
            "still refused before the minute is over"
        );
        assert!(
            limits.allow("login", "203.0.113.1", 5, at(66)),
            "a minute after the refusal: allowed again"
        );
    }

    #[test]
    fn tries_older_than_a_minute_stop_counting() {
        let limits = RateLimits::default();
        let start = Instant::now();
        for second in 0..5 {
            assert!(limits.allow("login", "a", 5, start + Duration::from_secs(second)));
        }
        // At 60 seconds the try made at 0 no longer counts, so this is the 5th in the last minute: allowed.
        // Another one at the same moment would be the 6th.
        assert!(limits.allow("login", "a", 5, start + Duration::from_secs(60)));
        assert!(!limits.allow("login", "a", 5, start + Duration::from_secs(60)));
    }

    fn headers(forwarded: &[&str]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for value in forwarded {
            map.append("x-forwarded-for", value.parse().unwrap());
        }
        map
    }

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn who_sent_it() {
        // From another computer: its own address, whatever the header says
        assert_eq!(
            client_address(ip("203.0.113.9"), &headers(&["198.51.100.1"])),
            ip("203.0.113.9")
        );
        // From this computer: the header says who it's passing on
        assert_eq!(
            client_address(ip("127.0.0.1"), &headers(&["198.51.100.1"])),
            ip("198.51.100.1")
        );
        // Read from the end: a made-up first entry doesn't count when the one before us is real
        assert_eq!(
            client_address(ip("::1"), &headers(&["198.51.100.1, 203.0.113.9"])),
            ip("203.0.113.9")
        );
        // Through two programs on this computer
        assert_eq!(
            client_address(ip("127.0.0.1"), &headers(&["198.51.100.1", "127.0.0.1"])),
            ip("198.51.100.1")
        );
        // No header, and IPv4 written the IPv6 way
        assert_eq!(client_address(ip("::ffff:127.0.0.1"), &headers(&[])), ip("127.0.0.1"));
    }
}
