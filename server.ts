import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { registerApiRoutes } from './lib/server-api.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // All /api routes (and the JSON body parser) live in the shared module so the
  // dev server and the Vercel serverless entry point (api/index.ts) stay in sync.
  registerApiRoutes(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
