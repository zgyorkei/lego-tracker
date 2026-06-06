import express from 'express';
import dotenv from 'dotenv';
import { registerApiRoutes } from '../lib/server-api.js';

dotenv.config();

// Vercel serverless entry point. All route logic is shared with the local dev
// server (server.ts) via the registerApiRoutes helper to avoid drift.
const app = express();
registerApiRoutes(app);

export default app;
