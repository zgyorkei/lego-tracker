import fs from 'fs';

let serverCode = fs.readFileSync('server.ts', 'utf8');

// Replacements
serverCode = serverCode.replace(/const customKey = \(req\.query\.apiKey as string\) \|\| \(req\.headers\['x-gemini-api-key'\] as string \| undefined\);\n\s*if \(customKey \|\| process\.env\.GEMINI_API_KEY\) \{/g, 'if (process.env.GEMINI_API_KEY) {');

serverCode = serverCode.replace(/const customKey = \(req\.query\.apiKey as string\) \|\| \(req\.headers\['x-gemini-api-key'\] as string \| undefined\);\n/g, '');

serverCode = serverCode.replace(/const customKey = apiKey \|\| \(req\.headers\['x-gemini-api-key'\] as string \| undefined\);\n/g, '');

serverCode = serverCode.replace(/let customKey = apiKey \|\| \(req\.headers\['x-gemini-api-key'\] as string \| undefined\);\n/g, '');

serverCode = serverCode.replace(/const \{ setNumbers, apiKey \} = req\.body;/g, 'const { setNumbers } = req.body;');

serverCode = serverCode.replace(/const \{ setNumbers, sources, apiKey \} = req\.body;/g, 'const { setNumbers, sources } = req.body;');

serverCode = serverCode.replace(/const \{ sources, apiKey \} = req\.body;/g, 'const { sources } = req.body;');

serverCode = serverCode.replace(/getGenAI\(customKey\)/g, 'getGenAI()');

fs.writeFileSync('server.ts', serverCode);

console.log("Replaced custom keys in server.ts");
