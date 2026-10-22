// Starts the desktop app in development.
//
// Terminals inside VS Code (and other Electron-based editors) export
// ELECTRON_RUN_AS_NODE=1, which makes the Electron binary behave like plain
// Node: no window, no app, just a silent exit. It is removed here so
// `npm start` works from any terminal.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [here, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
