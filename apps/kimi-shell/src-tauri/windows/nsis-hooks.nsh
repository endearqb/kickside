; KickSide keeps com.kimi.shell and its application data, but the public product
; name changed from Kimi Sidekick. Tauri's stock NSIS migration page keys off
; PRODUCTNAME, so it cannot discover the legacy uninstall registry entries.
;
; This preinstall hook removes only exact historical product identities. The old
; uninstaller runs in passive mode without the delete-app-data checkbox, which
; preserves settings while removing the duplicate binary and shortcuts.

!macro NSIS_HOOK_PREINSTALL
  StrCpy $R9 0

  kickside_legacy_scan:
    StrCpy $R0 ""
    StrCpy $R3 ""
    StrCpy $R4 ""
    StrCpy $R5 ""

    ; Historical per-user NSIS identities.
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kimi Sidekick" "UninstallString"
    ${If} $R0 != ""
      StrCpy $R3 "HKCU"
      StrCpy $R4 "Kimi Sidekick"
      StrCpy $R5 "nsis"
      Goto kickside_legacy_found
    ${EndIf}
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\kimi小助手" "UninstallString"
    ${If} $R0 != ""
      StrCpy $R3 "HKCU"
      StrCpy $R4 "kimi小助手"
      StrCpy $R5 "nsis"
      Goto kickside_legacy_found
    ${EndIf}
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kimi Desktop Shell" "UninstallString"
    ${If} $R0 != ""
      StrCpy $R3 "HKCU"
      StrCpy $R4 "Kimi Desktop Shell"
      StrCpy $R5 "nsis"
      Goto kickside_legacy_found
    ${EndIf}

    ; Historical per-machine NSIS identities.
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kimi Sidekick" "UninstallString"
    ${If} $R0 != ""
      StrCpy $R3 "HKLM"
      StrCpy $R4 "Kimi Sidekick"
      StrCpy $R5 "nsis"
      Goto kickside_legacy_found
    ${EndIf}
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\kimi小助手" "UninstallString"
    ${If} $R0 != ""
      StrCpy $R3 "HKLM"
      StrCpy $R4 "kimi小助手"
      StrCpy $R5 "nsis"
      Goto kickside_legacy_found
    ${EndIf}
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kimi Desktop Shell" "UninstallString"
    ${If} $R0 != ""
      StrCpy $R3 "HKLM"
      StrCpy $R4 "Kimi Desktop Shell"
      StrCpy $R5 "nsis"
      Goto kickside_legacy_found
    ${EndIf}

    ; Historical MSI identities use GUID keys. Match the exact old display names
    ; and require WindowsInstaller=1 before invoking msiexec.
    StrCpy $R6 0
  kickside_legacy_msi_hklm_loop:
    EnumRegKey $R4 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R6
    StrCmp $R4 "" kickside_legacy_msi_hkcu_begin
    IntOp $R6 $R6 + 1
    ReadRegDWORD $R7 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "WindowsInstaller"
    ${If} $R7 = 1
      ReadRegStr $R8 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "DisplayName"
      ${If} $R8 == "Kimi Sidekick"
      ${OrIf} $R8 == "kimi sidekick"
      ${OrIf} $R8 == "kimi小助手"
      ${OrIf} $R8 == "Kimi Desktop Shell"
        StrCpy $R3 "HKLM"
        StrCpy $R5 "msi"
        Goto kickside_legacy_found
      ${EndIf}
    ${EndIf}
    Goto kickside_legacy_msi_hklm_loop

  kickside_legacy_msi_hkcu_begin:
    StrCpy $R6 0
  kickside_legacy_msi_hkcu_loop:
    EnumRegKey $R4 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R6
    StrCmp $R4 "" kickside_legacy_done
    IntOp $R6 $R6 + 1
    ReadRegDWORD $R7 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "WindowsInstaller"
    ${If} $R7 = 1
      ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "DisplayName"
      ${If} $R8 == "Kimi Sidekick"
      ${OrIf} $R8 == "kimi sidekick"
      ${OrIf} $R8 == "kimi小助手"
      ${OrIf} $R8 == "Kimi Desktop Shell"
        StrCpy $R3 "HKCU"
        StrCpy $R5 "msi"
        Goto kickside_legacy_found
      ${EndIf}
    ${EndIf}
    Goto kickside_legacy_msi_hkcu_loop

  kickside_legacy_found:
    ${If} $R9 = 0
    ${AndIf} $PassiveMode != 1
      IfSilent kickside_legacy_confirmed
      MessageBox MB_ICONEXCLAMATION|MB_OKCANCEL "检测到旧版 Kimi Sidekick。安装 KickSide 前需要先卸载旧版；设置和应用数据会保留。点击“确定”自动卸载，或点击“取消”退出安装。$\r$\n$\r$\nLegacy Kimi Sidekick was found. KickSide must remove it first; settings and app data will be kept. Select OK to continue or Cancel to exit." IDOK kickside_legacy_confirmed IDCANCEL kickside_legacy_cancelled
    ${EndIf}

  kickside_legacy_confirmed:
    StrCpy $R9 1
    DetailPrint "Removing legacy $R4 installation before installing KickSide"
    ${If} $R5 == "msi"
      ExecWait '"$SYSDIR\msiexec.exe" /x "$R4" /passive /norestart' $R2
    ${Else}
      ExecWait '$R0 /P' $R2
    ${EndIf}
    ${If} $R2 != 0
      Goto kickside_legacy_failed
    ${EndIf}

    ; Fail closed if the legacy uninstaller returned success without removing
    ; its registration. This also prevents an accidental rescan loop.
    ${If} $R5 == "msi"
      ${If} $R3 == "HKLM"
        ReadRegStr $R1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "DisplayName"
      ${Else}
        ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "DisplayName"
      ${EndIf}
    ${ElseIf} $R3 == "HKLM"
      ReadRegStr $R1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "UninstallString"
    ${Else}
      ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "UninstallString"
    ${EndIf}
    ${If} $R1 != ""
      Goto kickside_legacy_failed
    ${EndIf}
    Goto kickside_legacy_scan

  kickside_legacy_cancelled:
    Abort "KickSide installation cancelled because legacy Kimi Sidekick is still installed."

  kickside_legacy_failed:
    MessageBox MB_ICONSTOP|MB_OK "无法卸载旧版 Kimi Sidekick（退出码 $R2）。请从 Windows“已安装的应用”中手动卸载后重试；设置和应用数据无需删除。$\r$\n$\r$\nUnable to remove legacy Kimi Sidekick (exit code $R2). Uninstall it from Windows Installed apps, then run KickSide setup again. Keep the settings and app data."
    Abort "Legacy Kimi Sidekick removal failed."

  kickside_legacy_done:
!macroend
