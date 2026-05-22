import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { platform } from 'os';

// Import routes
import userRoutes from './src/routes/userRoutes.js';
import pdfRoutes from './src/routes/pdfRoutes.js';
import conversionRoutes from './src/routes/conversionRoutes.js';
import aiConfigRoutes from './src/routes/aiConfigRoutes.js';
import audioSyncRoutes from './src/routes/audioSyncRoutes.js';
import jobPagesRoutes from './src/routes/jobPagesRoutes.js';
import transcriptRoutes from './src/routes/transcriptRoutes.js';
import ttsConfigRoutes from './src/routes/ttsConfigRoutes.js';
import chapterRoutes from './src/routes/chapters.js';
import kitabooRoutes from './src/routes/kitabooRoutes.js';
import accessibilityRoutes from './src/routes/accessibilityRoutes.js';
import epubcheckRoutes from './src/routes/epubcheckRoutes.js';
import authRoutes from './src/routes/authRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import orgTeamRoutes from './src/routes/orgTeamRoutes.js';
import interactiveRoutes from './src/routes/interactiveRoutes.js';
import activityRoutes from './src/routes/activityRoutes.js';
import mediaRoutes from './src/routes/mediaRoutes.js';
import bootstrapRoutes from './src/routes/bootstrapRoutes.js';

// Import middleware
import { errorHandler } from './src/middlewares/errorHandler.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3667;

// Middleware
const allowedOrigins = new Set([
  'https://epub.kodeit.digital',
  'https://epub.legatolxp.online',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
]);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server/no-origin requests and configured browser origins.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'Expires'
  ],
  credentials: false
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Ensure static assets used by the frontend editor are CORS-accessible
const staticCorsMiddleware = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
};
// Add request logging
app.use((req, res, next) => {
  console.log(`[API Request] ${req.method} ${req.url}`);
  next();
});
// Increase body size limit to 50MB for large XHTML content
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use('/uploads', staticCorsMiddleware, express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));
app.use('/epub_output', staticCorsMiddleware, express.static(path.join(__dirname, 'epub_output')));
app.use('/html_intermediate', staticCorsMiddleware, express.static(path.join(__dirname, 'html_intermediate')));
app.use('/reports', staticCorsMiddleware, express.static(path.join(__dirname, 'reports')));

// Backward-compatible aliases used by some generated paths (/backend/...)
app.use('/backend/uploads', staticCorsMiddleware, express.static(path.join(__dirname, 'uploads')));
app.use('/backend/epub_output', staticCorsMiddleware, express.static(path.join(__dirname, 'epub_output')));
app.use('/backend/html_intermediate', staticCorsMiddleware, express.static(path.join(__dirname, 'html_intermediate')));
app.use('/backend/reports', staticCorsMiddleware, express.static(path.join(__dirname, 'reports')));

// Health check
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    const pool = (await import('./src/config/database.js')).default;
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();

    const { cacheStats } = await import('./src/services/cacheService.js');
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'connected',
      uptime: process.uptime(),
      cache: cacheStats(),
    });
  } catch (error) {
    console.error('[Health Check] Database connection failed:', error.message);
    res.status(503).json({ 
      status: 'SERVICE_UNAVAILABLE', 
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// API Routes
app.use('/users', userRoutes);
app.use('/pdfs', pdfRoutes);
app.use('/conversions', conversionRoutes);
app.use('/ai', aiConfigRoutes);
app.use('/audio-sync', audioSyncRoutes);
app.use('/jobs', jobPagesRoutes);
app.use('/transcripts', transcriptRoutes);
app.use('/tts', ttsConfigRoutes);
app.use('/chapters', chapterRoutes);
app.use('/kitaboo', kitabooRoutes);
app.use('/accessibility', accessibilityRoutes);
app.use('/epubcheck', epubcheckRoutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/org', orgTeamRoutes);
app.use('/interactive', interactiveRoutes);
app.use('/activities', activityRoutes);
app.use('/media', mediaRoutes);
app.use('/', bootstrapRoutes); // Mount at root for /app-bootstrap and /conversion-status/:id

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// On Windows, nodemon often doesn't free the port when restarting. Try to kill the process holding the port.
function tryKillProcessOnPort(port) {
  if (platform() !== 'win32') return false;
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const line = out.trim().split(/\r?\n/)[0];
    if (!line) return false;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (!pid || pid === '0') return false;
    const myPid = String(process.pid);
    if (pid === myPid) return false;
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
    console.warn(`Killed previous process (PID ${pid}) holding port ${port}.`);
    return true;
  } catch (_) {
    return false;
  }
}

// Start server (retry on EADDRINUSE; on Windows, kill previous process holding port)
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1500;

async function startServer(retryCount = 0) {
  try {
    const { ensurePlatformAdmin } = await import('./src/bootstrap/ensurePlatformAdmin.js');
    await ensurePlatformAdmin();
  } catch (e) {
    console.warn('[bootstrap] ensurePlatformAdmin failed:', e.message);
  }
  try {
    const { ensurePlatformSettings } = await import('./src/bootstrap/ensurePlatformSettings.js');
    await ensurePlatformSettings();
  } catch (e) {
    console.warn('[bootstrap] ensurePlatformSettings failed:', e.message);
  }
  try {
    const { ensurePlatformApiKeys } = await import('./src/bootstrap/ensurePlatformApiKeys.js');
    await ensurePlatformApiKeys();
  } catch (e) {
    console.warn('[bootstrap] ensurePlatformApiKeys failed:', e.message);
  }
  try {
    const { ensurePlanRequests } = await import('./src/bootstrap/ensurePlanRequests.js');
    await ensurePlanRequests();
  } catch (e) {
    console.warn('[bootstrap] ensurePlanRequests failed:', e.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Shutdown: close server and exit right away when you stop (Ctrl+C / nodemon stop)
    const shutdown = () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 300);
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && retryCount < MAX_RETRIES) {
      const killed = tryKillProcessOnPort(PORT);
      const delay = killed ? 800 : RETRY_DELAY_MS;
      console.warn(`Port ${PORT} in use. ${killed ? 'Previous process killed.' : ''} Retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`);
      setTimeout(() => void startServer(retryCount + 1), delay);
      return;
    }
    if (error.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} is already in use after ${MAX_RETRIES} retries.`);
      console.error(`Please either:`);
      console.error(`1. Stop the process using port ${PORT}`);
      console.error(`2. Change the PORT in .env file`);
      console.error(`\nTo find and kill the process:`);
      console.error(`  Windows: netstat -ano | findstr :${PORT}`);
      console.error(`  Then: taskkill /PID <PID> /F`);
      process.exit(1);
    }
    console.error('Server error:', error);
    process.exit(1);
  });
}

try {
  void startServer();
} catch (e) {
  console.error('Failed to start server:', e);
  process.exit(1);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in production, let the server continue
  if (process.env.NODE_ENV === 'production') {
    console.error('Server will continue running despite unhandled rejection');
  } else {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // In production, log and continue if possible
  if (process.env.NODE_ENV === 'production') {
    console.error('Server will attempt to continue running');
  } else {
    process.exit(1);
  }
});

export default app;

