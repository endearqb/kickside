use std::net::TcpListener;

use anyhow::bail;
use rand::Rng;

pub const PORT_MIN: u16 = 55_000;
pub const PORT_MAX: u16 = 59_999;
pub const PORT_SCAN_COUNT: u16 = 1;
const OVERRIDE_BASE_PORT_ENV: &str = "KIMI_SHELL_BASE_PORT";

pub fn choose_start_port() -> anyhow::Result<u16> {
    if let Some(port) = read_override_start_port() {
        if is_port_available(port) {
            return Ok(port);
        }
    }

    let upper = PORT_MAX - (PORT_SCAN_COUNT - 1);
    for _ in 0..16 {
        let port = rand::thread_rng().gen_range(PORT_MIN..=upper);
        if is_port_available(port) {
            return Ok(port);
        }
    }
    bail!("no free port in {PORT_MIN}..={PORT_MAX}")
}

fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn read_override_start_port() -> Option<u16> {
    let raw = std::env::var(OVERRIDE_BASE_PORT_ENV).ok()?;
    let port = raw.parse::<u16>().ok()?;
    if !(PORT_MIN..=PORT_MAX - (PORT_SCAN_COUNT - 1)).contains(&port) {
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
            let port = choose_start_port().expect("start port");
            assert!(port >= PORT_MIN);
            assert!(port <= PORT_MAX - (PORT_SCAN_COUNT - 1));
        }
    }

    #[test]
    fn env_override_is_used_when_valid() {
        let _guard = env_lock()
            .lock()
            .expect("port_manager env lock should not be poisoned");
        std::env::set_var(OVERRIDE_BASE_PORT_ENV, "57639");
        let port = choose_start_port().expect("start port");
        std::env::remove_var(OVERRIDE_BASE_PORT_ENV);
        assert_eq!(port, 57639);
    }

    #[test]
    fn invalid_env_override_falls_back_to_range() {
        let _guard = env_lock()
            .lock()
            .expect("port_manager env lock should not be poisoned");
        std::env::set_var(OVERRIDE_BASE_PORT_ENV, "99999");
        let port = choose_start_port().expect("start port");
        std::env::remove_var(OVERRIDE_BASE_PORT_ENV);
        assert!(port >= PORT_MIN);
        assert!(port <= PORT_MAX - (PORT_SCAN_COUNT - 1));
    }

    #[test]
    fn occupied_env_override_falls_back_to_free_port() {
        let _guard = env_lock()
            .lock()
            .expect("port_manager env lock should not be poisoned");
        let listener = (PORT_MIN..=PORT_MAX)
            .find_map(|port| {
                TcpListener::bind(("127.0.0.1", port))
                    .ok()
                    .map(|listener| (port, listener))
            })
            .expect("listener in app port range");
        let port = listener.0;
        std::env::set_var(OVERRIDE_BASE_PORT_ENV, port.to_string());
        let chosen = choose_start_port().expect("start port");
        std::env::remove_var(OVERRIDE_BASE_PORT_ENV);
        assert_ne!(chosen, port);
    }
}
