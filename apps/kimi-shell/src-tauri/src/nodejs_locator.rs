use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodejsToolchain {
    pub node_path: PathBuf,
    pub npm_path: Option<PathBuf>,
}

pub(crate) fn candidates() -> Vec<NodejsToolchain> {
    let path_node = which::which(node_binary_name()).ok();
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from);

    candidates_from(
        path_node,
        home.as_deref(),
        env::var_os("NVM_BIN").map(PathBuf::from),
        env::var_os("VOLTA_HOME").map(PathBuf::from),
        platform_node_paths(),
    )
}

fn candidates_from(
    path_node: Option<PathBuf>,
    home: Option<&Path>,
    nvm_bin: Option<PathBuf>,
    volta_home: Option<PathBuf>,
    platform_paths: Vec<PathBuf>,
) -> Vec<NodejsToolchain> {
    let mut node_paths = Vec::new();
    let mut seen = HashSet::new();
    push_existing(&mut node_paths, &mut seen, path_node);
    push_existing(
        &mut node_paths,
        &mut seen,
        nvm_bin.map(|path| path.join(node_binary_name())),
    );
    push_existing(
        &mut node_paths,
        &mut seen,
        volta_home.map(|path| path.join("bin").join(node_binary_name())),
    );

    if let Some(home) = home {
        for path in home_node_paths(home) {
            push_existing(&mut node_paths, &mut seen, Some(path));
        }
    }
    for path in platform_paths {
        push_existing(&mut node_paths, &mut seen, Some(path));
    }

    node_paths
        .into_iter()
        .map(|node_path| {
            // npm is only safe to treat as part of this toolchain when it is
            // colocated with the selected Node runtime. Pairing an unrelated
            // PATH npm with every discovered Node can cross Volta/NVM/portable
            // installations and execute one toolchain's npm with another Node.
            let npm_path = sibling_npm(&node_path);
            NodejsToolchain {
                node_path,
                npm_path,
            }
        })
        .collect()
}

fn push_existing(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: Option<PathBuf>) {
    let Some(path) = path.filter(|candidate| candidate.is_file()) else {
        return;
    };
    if seen.insert(path.clone()) {
        paths.push(path);
    }
}

fn sibling_npm(node_path: &Path) -> Option<PathBuf> {
    let directory = node_path.parent()?;
    let names: &[&str] = if cfg!(windows) {
        &["npm.cmd", "npm.exe"]
    } else {
        &["npm"]
    };
    names
        .iter()
        .map(|name| directory.join(name))
        .find(|path| path.is_file())
}

fn home_node_paths(home: &Path) -> Vec<PathBuf> {
    let mut paths = vec![
        home.join(".volta").join("bin").join(node_binary_name()),
        home.join(".asdf").join("shims").join(node_binary_name()),
        home.join(".nodenv").join("shims").join(node_binary_name()),
        home.join(".local")
            .join("share")
            .join("mise")
            .join("shims")
            .join(node_binary_name()),
        home.join(".local")
            .join("share")
            .join("fnm")
            .join("aliases")
            .join("default")
            .join("bin")
            .join(node_binary_name()),
        home.join("Library")
            .join("Application Support")
            .join("fnm")
            .join("aliases")
            .join("default")
            .join("bin")
            .join(node_binary_name()),
    ];
    paths.extend(nvm_node_paths(home));
    paths
}

fn nvm_node_paths(home: &Path) -> Vec<PathBuf> {
    let versions_root = home.join(".nvm").join("versions").join("node");
    let Ok(entries) = fs::read_dir(versions_root) else {
        return Vec::new();
    };
    let mut versions = entries
        .flatten()
        .filter_map(|entry| {
            let version = parse_version_dir(&entry.file_name().to_string_lossy())?;
            Some((version, entry.path().join("bin").join(node_binary_name())))
        })
        .collect::<Vec<_>>();
    versions.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    versions.into_iter().map(|(_, path)| path).collect()
}

fn parse_version_dir(value: &str) -> Option<(u32, u32, u32)> {
    let mut parts = value.trim_start_matches('v').split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ))
}

#[cfg(windows)]
fn node_binary_name() -> &'static str {
    "node.exe"
}

#[cfg(not(windows))]
fn node_binary_name() -> &'static str {
    "node"
}

#[cfg(all(test, windows))]
fn npm_binary_name() -> &'static str {
    "npm.cmd"
}

#[cfg(all(test, not(windows)))]
fn npm_binary_name() -> &'static str {
    "npm"
}

#[cfg(windows)]
fn platform_node_paths() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"]
        .into_iter()
        .filter_map(|name| env::var_os(name).map(PathBuf::from))
        .map(|root| root.join("nodejs").join(node_binary_name()))
        .collect()
}

#[cfg(target_os = "macos")]
fn platform_node_paths() -> Vec<PathBuf> {
    ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn platform_node_paths() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "kimi-nodejs-locator-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    #[test]
    fn discovers_newest_nvm_runtime_without_shell_path() {
        let root = temp_root("nvm");
        for version in ["v20.18.0", "v24.19.0", "v22.19.0"] {
            let bin = root.join(".nvm/versions/node").join(version).join("bin");
            fs::create_dir_all(&bin).expect("create nvm bin");
            fs::write(bin.join(node_binary_name()), "node").expect("write node");
            fs::write(bin.join(npm_binary_name()), "npm").expect("write npm");
        }

        let found = candidates_from(None, Some(&root), None, None, Vec::new());
        let expected_bin = root.join(".nvm/versions/node/v24.19.0/bin");

        assert_eq!(
            found.first().map(|runtime| runtime.node_path.as_path()),
            Some(expected_bin.join(node_binary_name()).as_path())
        );
        assert_eq!(
            found
                .first()
                .and_then(|runtime| runtime.npm_path.as_deref()),
            Some(expected_bin.join(npm_binary_name()).as_path())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn prefers_path_runtime_before_version_manager_fallbacks() {
        let root = temp_root("path-first");
        let path_bin = root.join("path-bin");
        let nvm_bin = root.join("nvm-bin");
        fs::create_dir_all(&path_bin).expect("create path bin");
        fs::create_dir_all(&nvm_bin).expect("create nvm bin");
        fs::write(path_bin.join(node_binary_name()), "node").expect("write path node");
        fs::write(path_bin.join(npm_binary_name()), "npm").expect("write path npm");
        fs::write(nvm_bin.join(node_binary_name()), "node").expect("write nvm node");

        let found = candidates_from(
            Some(path_bin.join(node_binary_name())),
            Some(&root),
            Some(nvm_bin),
            None,
            Vec::new(),
        );

        assert_eq!(
            found.first().map(|runtime| runtime.node_path.as_path()),
            Some(path_bin.join(node_binary_name()).as_path())
        );
        assert_eq!(
            found
                .first()
                .and_then(|runtime| runtime.npm_path.as_deref()),
            Some(path_bin.join(npm_binary_name()).as_path())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn prefers_windows_npm_cmd_over_extensionless_posix_shim() {
        let root = temp_root("windows-npm-cmd");
        fs::create_dir_all(&root).expect("create node bin");
        let node = root.join("node.exe");
        fs::write(&node, "node").expect("write node");
        fs::write(root.join("npm"), "posix shim").expect("write posix npm shim");
        fs::write(root.join("npm.cmd"), "windows shim").expect("write npm.cmd");

        assert_eq!(sibling_npm(&node), Some(root.join("npm.cmd")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn never_pairs_a_node_with_an_unrelated_path_npm() {
        let root = temp_root("no-cross-toolchain-npm");
        let node_bin = root.join("portable-node");
        let npm_bin = root.join("other-toolchain");
        fs::create_dir_all(&node_bin).expect("create node bin");
        fs::create_dir_all(&npm_bin).expect("create npm bin");
        fs::write(node_bin.join(node_binary_name()), "node").expect("write node");
        fs::write(npm_bin.join(npm_binary_name()), "npm").expect("write npm");

        let found = candidates_from(
            Some(node_bin.join(node_binary_name())),
            Some(&root),
            None,
            None,
            Vec::new(),
        );

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].npm_path, None);
        let _ = fs::remove_dir_all(root);
    }
}
