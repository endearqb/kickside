#[cfg(target_os = "windows")]
pub fn notify_shell_association_changed() {
    use windows::Win32::UI::Shell::{
        SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
    };

    // Microsoft recommends notifying the Shell after association/verb changes.
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn notify_shell_association_changed() {}
