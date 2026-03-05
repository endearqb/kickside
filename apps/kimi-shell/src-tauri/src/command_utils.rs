use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW_FLAG: u32 = 0x08000000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP_FLAG: u32 = 0x00000200;

pub fn configure_kimi_background_command(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW_FLAG | CREATE_NEW_PROCESS_GROUP_FLAG);
    }
}

pub fn configure_kimi_query_command(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }
}

pub fn configure_system_command(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }
}
