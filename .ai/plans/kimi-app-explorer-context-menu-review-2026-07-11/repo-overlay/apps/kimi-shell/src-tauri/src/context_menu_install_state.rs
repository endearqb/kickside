/// Desired state and observed registry health must be modeled separately.
///
/// Current kimi-app only exposes a single `enabled` boolean. Startup repair
/// consequently treats an intentional Disable action as damage and re-enables
/// the Explorer integration on the next launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextMenuRegistryHealth {
    Absent,
    Healthy,
    PartialOrStale,
    Unreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextMenuRepairAction {
    None,
    Install,
    Uninstall,
}

pub fn plan_context_menu_repair(
    desired_enabled: bool,
    health: ContextMenuRegistryHealth,
) -> ContextMenuRepairAction {
    match (desired_enabled, health) {
        (true, ContextMenuRegistryHealth::Healthy) => ContextMenuRepairAction::None,
        (true, _) => ContextMenuRepairAction::Install,
        (false, ContextMenuRegistryHealth::Absent) => ContextMenuRepairAction::None,
        (false, _) => ContextMenuRepairAction::Uninstall,
    }
}

/// Suggested fields for `ContextMenuStatus` while retaining the existing
/// `enabled` field for frontend compatibility.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextMenuStateView {
    pub desired_enabled: bool,
    pub installed: bool,
    pub healthy: bool,
    pub enabled: bool,
}

impl ContextMenuStateView {
    pub fn from_health(desired_enabled: bool, health: ContextMenuRegistryHealth) -> Self {
        let installed = !matches!(health, ContextMenuRegistryHealth::Absent);
        let healthy = matches!(health, ContextMenuRegistryHealth::Healthy)
            || (!desired_enabled && matches!(health, ContextMenuRegistryHealth::Absent));
        Self {
            desired_enabled,
            installed,
            healthy,
            enabled: desired_enabled
                && matches!(health, ContextMenuRegistryHealth::Healthy),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intentional_disable_is_not_repaired_back_to_enabled() {
        assert_eq!(
            plan_context_menu_repair(false, ContextMenuRegistryHealth::Absent),
            ContextMenuRepairAction::None
        );
    }

    #[test]
    fn stale_keys_are_removed_when_user_wants_the_feature_disabled() {
        assert_eq!(
            plan_context_menu_repair(false, ContextMenuRegistryHealth::PartialOrStale),
            ContextMenuRepairAction::Uninstall
        );
    }

    #[test]
    fn missing_keys_are_installed_only_when_desired() {
        assert_eq!(
            plan_context_menu_repair(true, ContextMenuRegistryHealth::Absent),
            ContextMenuRepairAction::Install
        );
    }
}
