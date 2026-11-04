; Picked up by electron-builder for the NSIS installer (nsis.include in
; scripts/package.mjs).
;
; Start with Windows, straight into the tray, so the daily 4AM refresh runs
; without anyone opening the app. The Run value is the one Electron's
; app.setLoginItemSettings writes (electron.app.<productName>, with
; --hidden), so the tray's "Start with Windows" toggle sees and changes this
; same entry, and installs made by the old install.cmd already have it.
;
; Only a fresh install adds it: over an existing copy (an upgrade, or a copy
; installed by install.cmd) the user's choice in the tray is left alone.

; The install folder. A one-click per-user installer would name it after the
; package (Programs\lego-tracker-desktop); it belongs in Programs\Brick Tracker,
; where install.cmd put earlier copies, so the setup replaces those in place.
; initMultiUser takes a recorded InstallLocation as an earlier install, so one
; is recorded first when there is none. The uninstaller removes the key again.
!macro preInit
  ; The build runs .onInit once to write the uninstaller; leave the build
  ; machine's registry alone then.
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
    ${if} $0 == ""
      WriteRegExpandStr HKCU "Software\${APP_GUID}" InstallLocation "$LOCALAPPDATA\Programs\${PRODUCT_FILENAME}"
    ${endif}
  !endif
!macroend

; The uninstaller is compiled from this file too, and never uses the variable;
; NSIS treats that as an error.
!ifndef BUILD_UNINSTALLER
  Var brickTrackerWasInstalled
!endif

!macro customInit
  ; After initMultiUser, so $INSTDIR is the install folder; before any file is
  ; written, so the app's exe there means an earlier install.
  StrCpy $brickTrackerWasInstalled "0"
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    StrCpy $brickTrackerWasInstalled "1"
  ${endif}
!macroend

!macro customInstall
  ${if} $brickTrackerWasInstalled == "0"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${PRODUCT_NAME}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
  ${endif}
!macroend

; A newer installer runs the old uninstaller with --updated first; only a real
; uninstall (from Windows' list of apps) removes the entry. The data folder
; (%APPDATA%\Brick Tracker: setup, sign-in, scraper profile) is kept either way.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${PRODUCT_NAME}"
  ${endif}
!macroend
