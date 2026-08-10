use std::fs;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;

use anyhow::Context;

use crate::types::SkillProjectionMethod;

const SESSION_SKILLS_DIR_SEGMENT: &str = ".agents";
const SESSION_SKILLS_SUBDIR_SEGMENT: &str = "skills";

pub fn session_skills_dir(work_dir: &Path) -> PathBuf {
    work_dir
        .join(SESSION_SKILLS_DIR_SEGMENT)
        .join(SESSION_SKILLS_SUBDIR_SEGMENT)
}

pub fn materialize_skill(
    source_dir: &Path,
    target_dir: &Path,
) -> anyhow::Result<SkillProjectionMethod> {
    if !source_dir.is_dir() {
        return Err(anyhow::anyhow!(
            "skill source is not a directory: {}",
            source_dir.display()
        ));
    }
    if target_dir.exists() {
        return Err(anyhow::anyhow!(
            "skill projection target already exists: {}",
            target_dir.display()
        ));
    }
    let Some(parent) = target_dir.parent() else {
        return Err(anyhow::anyhow!(
            "skill projection target missing parent: {}",
            target_dir.display()
        ));
    };
    fs::create_dir_all(parent).with_context(|| {
        format!(
            "failed to create skill projection parent dir: {}",
            parent.display()
        )
    })?;

    #[cfg(windows)]
    {
        match std::os::windows::fs::symlink_dir(source_dir, target_dir) {
            Ok(_) => return Ok(SkillProjectionMethod::Symlink),
            Err(_) => {
                if try_create_windows_junction(source_dir, target_dir).is_ok() {
                    return Ok(SkillProjectionMethod::Junction);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        if std::os::unix::fs::symlink(source_dir, target_dir).is_ok() {
            return Ok(SkillProjectionMethod::Symlink);
        }
    }

    copy_directory_recursive(source_dir, target_dir)?;
    Ok(SkillProjectionMethod::Copy)
}

pub fn copy_skill_directory(source_dir: &Path, target_dir: &Path) -> anyhow::Result<()> {
    if !source_dir.is_dir() {
        return Err(anyhow::anyhow!(
            "skill source is not a directory: {}",
            source_dir.display()
        ));
    }
    if target_dir.exists() {
        return Err(anyhow::anyhow!(
            "skill target already exists: {}",
            target_dir.display()
        ));
    }
    let Some(parent) = target_dir.parent() else {
        return Err(anyhow::anyhow!(
            "skill target missing parent: {}",
            target_dir.display()
        ));
    };
    fs::create_dir_all(parent).with_context(|| {
        format!(
            "failed to create copied skill parent dir: {}",
            parent.display()
        )
    })?;
    copy_directory_recursive(source_dir, target_dir)
}

pub fn remove_projection_target(target_dir: &Path) -> anyhow::Result<()> {
    if !target_dir.exists() {
        return Ok(());
    }
    match fs::remove_dir(target_dir) {
        Ok(_) => Ok(()),
        Err(_) => fs::remove_dir_all(target_dir).with_context(|| {
            format!(
                "failed to remove skill projection target: {}",
                target_dir.display()
            )
        }),
    }
}

#[cfg(windows)]
fn try_create_windows_junction(source_dir: &Path, target_dir: &Path) -> anyhow::Result<()> {
    let status = Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            &target_dir.to_string_lossy(),
            &source_dir.to_string_lossy(),
        ])
        .status()
        .with_context(|| format!("failed to invoke mklink /J for {}", target_dir.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "mklink /J failed for target {}",
            target_dir.display()
        ))
    }
}

fn copy_directory_recursive(source_dir: &Path, target_dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(target_dir).with_context(|| {
        format!(
            "failed to create copied skill target directory: {}",
            target_dir.display()
        )
    })?;
    for entry in fs::read_dir(source_dir)
        .with_context(|| format!("failed to read source skill dir: {}", source_dir.display()))?
    {
        let entry = entry.with_context(|| {
            format!(
                "failed to read source skill entry: {}",
                source_dir.display()
            )
        })?;
        let source_path = entry.path();
        let target_path = target_dir.join(entry.file_name());
        let metadata = entry.metadata().with_context(|| {
            format!(
                "failed to read source skill metadata: {}",
                source_path.display()
            )
        })?;
        if metadata.is_dir() {
            copy_directory_recursive(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path).with_context(|| {
                format!(
                    "failed to copy skill file from {} to {}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}
