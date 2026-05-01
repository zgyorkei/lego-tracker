const fs = require('fs'); 
let code = fs.readFileSync('server.ts', 'utf8'); 
code = code.replace(/async function startServer\(\) \{[\s\S]*?\n\s*const app = express\(\);/, 'const app = express();');
code = code.replace(/\n\s*\/\/ Vite middleware[\s\S]*$/, '\n\nexport default app;\n'); 
fs.writeFileSync('api/index.ts', code);
