// electron-winstaller builds Squirrel installers and vendors 7-Zip 16.04,
// which the build machine's security check rejects. Brick Tracker only
// builds the NSIS target, so this stub replaces it (package.json overrides)
// and the old 7-Zip never reaches node_modules.
throw new Error(
  'Squirrel.Windows is not supported in this build: electron-winstaller is stubbed out. Use the nsis target.'
);
