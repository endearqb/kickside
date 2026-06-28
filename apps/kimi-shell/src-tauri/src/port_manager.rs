use std::{
    thread,
    time::{Duration, Instant},
};

use rand::Rng;

pub const PORT_MIN: u16 = 55_000;
pub const PORT_MAX: u16 = 59_999;
pub const PORT_SCAN_COUNT: u16 = 10;
pub const HEALTH_CHECK_INTERVAL_MS: u64 = 200;
pub const HEALTH_REQUEST_TIMEOUT_MS: u64 = 500;
pub const STARTUP_TIMEOUT_SECS: u64 = 20;
const OVERRIDE_BASE_PORT_ENV: &str = "KIMI_SHELL_BASE_PORT";
const HEALTH_PATHS: [&str; 3] = ["/api/v1/healthz", "/healthz", "/openapi.json"];

pub fn choose_start_port() -> u16 {
    if let Some(port) = read_override_start_port() {
        return port;
    }

    let upper = PORT_MAX - PORT_SCAN_COUNT;
    rand::thread_rng().gen_range(PORT_MIN..=upper)
}

pub fn wait_for_ready_port(base_port: u16) -> Option<u16> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(HEALTH_REQUEST_TIMEOUT_MS))
        .build()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(STARTUP_TIMEOUT_SECS);
    while Instant::now() < deadline {
        for offset in 0..PORT_SCAN_COUNT {
            let port = base_port + offset;
            if is_healthy(&client, port) {
                return Some(port);
            }
        }
        thread::sleep(Duration::from_millis(HEALTH_CHECK_INTERVAL_MS));
    }

    None
}

fn is_healthy(client: &reqwest::blocking::Client, port: u16) -> bool {
    HEALTH_PATHS.iter().any(|path| {
        let url = format!("http://127.0.0.1:{port}{path}");
        client
            .get(url)
            .send()
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    })
}

fn read_override_start_port() -> Option<u16> {
    let raw = std::env::var(OVERRIDE_BASE_PORT_ENV).ok()?;
    let port = raw.parse::<u16>().ok()?;
    if port < PORT_MIN || port > PORT_MAX - PORT_SCAN_COUNT {
        return None;
    }
    Some(port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn start_port_stays_in_expected_range() {
        let _guard = env_lock()
            .lock()
            .expect("port_manager env lock should not be poisoned");
        std::env::remove_var(OVERRIDE_BASE_PORT_ENV);
        for _ in 0..1_000 {
            let port = choose_start_port();
            assert!(port >= PORT_MIN);
            assert!(port <= PORT_MAX - PORT_SCAN_COUNT);
        }
    }

    #[test]
    fn env_override_is_used_when_valid() {
        let _guard = env_lock()
            .lock()
            .expect("port_manager env lock should not be poisoned");
        std::env::set_var(OVERRIDE_BASE_PORT_ENV, "57639");
        let port = choose_start_port();
        std::env::remove_var(OVERRIDE_BASE_PORT_ENV);
        assert_eq!(port, 57639);
    }

    #[test]
    fn invalid_env_override_falls_back_to_range() {
        let _guard = env_lock()
            .lock()
            .expect("port_manager env lock should not be poisoned");
        std::env::set_var(OVERRIDE_BASE_PORT_ENV, "99999");
        let port = choose_start_port();
        std::env::remove_var(OVERRIDE_BASE_PORT_ENV);
        assert!(port >= PORT_MIN);
        assert!(port <= PORT_MAX - PORT_SCAN_COUNT);
    }
}
