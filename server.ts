import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes/api';
import 'dotenv/config';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json());

  // Request logger
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      const start = Date.now();
      res.on('finish', () => {
        console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`);
      });
    }
    next();
  });

  // Mount API routes FIRST
  // app.use('/api', apiRouter);

    // Allow the Vercel frontend to call the Render API
  const allowedOrigin = process.env.FRONTEND_URL;

  app.use('/api', (req, res, next) => {
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,DELETE,OPTIONS'
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  // Mount API routes FIRST
  app.use('/api', apiRouter);

  // Vite middleware for development vs static build for production
  if (process.env.NODE_ENV !== 'production') {
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
    console.log(`[Server] Product Price Tracker active on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
