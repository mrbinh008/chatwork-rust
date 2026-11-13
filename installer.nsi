; THK Desktop - NSIS Installer Script
; Run with: makensis installer.nsi

!include "MUI2.nsh"
!include "FileFunc.nsh"

; ── App info ──────────────────────────────────────────────────────────────────
!ifndef APP_VERSION
!define APP_VERSION "2.26.8"
!endif

Name "THK-Chat"
OutFile "THK-ChatSetup.exe"
InstallDir "$LOCALAPPDATA\THK-Chat"
InstallDirRegKey HKCU "Software\THK\Desktop" "InstallPath"
RequestExecutionLevel user

; ── UI ───────────────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON "assets\thk.ico"
!define MUI_UNICON "assets\thk.ico"
!define MUI_WELCOMEPAGE_TITLE "THK-Chat Installer"
!define MUI_FINISHPAGE_RUN "$INSTDIR\THK-Chat.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch THK-Chat"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Japanese"

; ── Install ───────────────────────────────────────────────────────────────────
Section "Main" SecMain
  SetOutPath "$INSTDIR"
  
  ; Copy files
  File "/oname=THK-Chat.exe" "target\release\chatwork.exe"
  File "target\release\WebView2Loader.dll"
  File /r "assets"
  
  ; Registry entries
  WriteRegStr HKCU "Software\THK\Desktop" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\THK\Desktop" "Version" "${APP_VERSION}"
  
  ; AppUserModelId for Windows Toast Notifications
  WriteRegStr HKCU "Software\Classes\AppUserModelId\THK" "DisplayName" "THK-Chat"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\THK" "IconUri" "$INSTDIR\assets\thk.ico"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\THK" "IconBackgroundColor" "0"
  WriteRegDWORD HKCU "Software\Classes\AppUserModelId\THK" "ShowInSettings" 1
  
  ; Replace shortcuts from the previous display name during upgrade.
  Delete "$DESKTOP\THK.lnk"
  Delete "$SMPROGRAMS\THK\THK.lnk"
  RMDir "$SMPROGRAMS\THK"

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\THK-Chat"
  CreateShortcut "$SMPROGRAMS\THK-Chat\THK-Chat.lnk" "$INSTDIR\THK-Chat.exe" "" "$INSTDIR\assets\thk.ico" 0
  
  ; Desktop shortcut
  CreateShortcut "$DESKTOP\THK-Chat.lnk" "$INSTDIR\THK-Chat.exe" "" "$INSTDIR\assets\thk.ico" 0
  
  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\THK" \
    "DisplayName" "THK-Chat"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\THK" \
    "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\THK" \
    "DisplayIcon" "$INSTDIR\assets\thk.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\THK" \
    "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\THK" \
    "Publisher" "THK Team"
SectionEnd

; ── Uninstall ─────────────────────────────────────────────────────────────────
Section "Uninstall"
  Delete "$INSTDIR\THK-Chat.exe"
  Delete "$INSTDIR\THK.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\assets"
  
  Delete "$SMPROGRAMS\THK-Chat\THK-Chat.lnk"
  RMDir "$SMPROGRAMS\THK-Chat"
  Delete "$DESKTOP\THK-Chat.lnk"
  
  DeleteRegKey HKCU "Software\THK\Desktop"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\THK"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\THK"
  
  RMDir "$INSTDIR"
SectionEnd
