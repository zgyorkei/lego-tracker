import fs from 'fs';
const content = fs.readFileSync('server.ts', 'utf-8');
const fixed = content.replaceAll("['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']", "['gemini-3-flash-preview', 'gemini-3.1-pro-preview']");
fs.writeFileSync('server.ts', fixed);
