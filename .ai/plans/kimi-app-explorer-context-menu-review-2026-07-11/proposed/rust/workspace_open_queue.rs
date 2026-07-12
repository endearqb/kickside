use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

/// Frontend placement requested by the producer of a workspace session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceOpenDisposition {
    ReplaceActive,
    NewPane,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingWorkspaceOpen {
    pub request_id: String,
    pub work_dir: PathBuf,
    pub source: String,
    pub disposition: WorkspaceOpenDisposition,
    pub force_create_new: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnqueueResult {
    Queued,
    Duplicate,
}

/// FIFO queue used while the runtime API is not ready.
///
/// This replaces the current `Option<PendingWorkspaceBootstrap>` behavior,
/// which lets a later Explorer click overwrite an earlier startup request.
pub struct WorkspaceOpenQueue {
    entries: VecDeque<PendingWorkspaceOpen>,
    recently_seen: HashMap<String, Instant>,
    dedupe_ttl: Duration,
    max_pending: usize,
}

impl Default for WorkspaceOpenQueue {
    fn default() -> Self {
        Self::new(Duration::from_millis(1_500), 64)
    }
}

impl WorkspaceOpenQueue {
    pub fn new(dedupe_ttl: Duration, max_pending: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            recently_seen: HashMap::new(),
            dedupe_ttl,
            max_pending: max_pending.max(1),
        }
    }

    pub fn enqueue(&mut self, request: PendingWorkspaceOpen, now: Instant) -> EnqueueResult {
        self.prune(now);
        let key = request_key(&request);
        if self
            .recently_seen
            .get(&key)
            .is_some_and(|seen_at| now.duration_since(*seen_at) <= self.dedupe_ttl)
        {
            return EnqueueResult::Duplicate;
        }

        self.recently_seen.insert(key, now);
        if self.entries.len() >= self.max_pending {
            // Bounded memory, deterministic behavior. The oldest request is
            // removed only after it has had the longest time to be observed in
            // logs/UI. Production integration should emit an explicit error.
            self.entries.pop_front();
        }
        self.entries.push_back(request);
        EnqueueResult::Queued
    }

    pub fn pop_front(&mut self) -> Option<PendingWorkspaceOpen> {
        self.entries.pop_front()
    }

    pub fn drain(&mut self) -> impl Iterator<Item = PendingWorkspaceOpen> + '_ {
        self.entries.drain(..)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn prune(&mut self, now: Instant) {
        self.recently_seen
            .retain(|_, seen_at| now.duration_since(*seen_at) <= self.dedupe_ttl);
    }
}

fn request_key(request: &PendingWorkspaceOpen) -> String {
    format!(
        "{}|{}|{}",
        normalize_path_key(&request.work_dir),
        request.source.trim().to_ascii_lowercase(),
        if request.force_create_new { "new" } else { "reuse" }
    )
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str, path: &str) -> PendingWorkspaceOpen {
        PendingWorkspaceOpen {
            request_id: id.to_string(),
            work_dir: PathBuf::from(path),
            source: "open_dir_request".to_string(),
            disposition: WorkspaceOpenDisposition::NewPane,
            force_create_new: true,
        }
    }

    #[test]
    fn keeps_fifo_order_instead_of_overwriting_the_pending_request() {
        let now = Instant::now();
        let mut queue = WorkspaceOpenQueue::default();
        assert_eq!(queue.enqueue(request("1", r"C:\one"), now), EnqueueResult::Queued);
        assert_eq!(queue.enqueue(request("2", r"C:\two"), now), EnqueueResult::Queued);
        assert_eq!(queue.pop_front().unwrap().request_id, "1");
        assert_eq!(queue.pop_front().unwrap().request_id, "2");
    }

    #[test]
    fn dedupes_equivalent_windows_paths_inside_ttl() {
        let now = Instant::now();
        let mut queue = WorkspaceOpenQueue::default();
        assert_eq!(queue.enqueue(request("1", r"C:\Work\"), now), EnqueueResult::Queued);
        assert_eq!(
            queue.enqueue(request("2", "c:/work"), now + Duration::from_millis(100)),
            EnqueueResult::Duplicate
        );
    }
}
