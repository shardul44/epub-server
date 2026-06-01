import express from 'express';
import fileUpload from 'express-fileupload';
import path from 'path';
import { authenticate, requireFeature } from '../middlewares/auth.js';
import { h5pController } from '../controllers/h5pController.js';
import {
  attachH5pUserMiddleware,
  getAjaxRouter,
  getLibraryAdminRouter,
  getContentTypeCacheRouter,
  getH5pEditor,
  getH5pPaths
} from '../services/h5p/h5pService.js';

const router = express.Router();

// Public static assets — browser <script>/<link> tags cannot send Authorization headers.
const { H5P_CORE, H5P_EDITOR_CLIENT, H5P_LIBRARIES } = getH5pPaths();
router.use(
  '/core',
  express.static(H5P_CORE, {
    maxAge: '7d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  })
);
router.use(
  '/editor',
  express.static(H5P_EDITOR_CLIENT, {
    maxAge: '7d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  })
);
router.use('/libraries', express.static(H5P_LIBRARIES, { maxAge: '7d' }));

function readH5pJwtCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)h5p_jwt=([^;]*)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

// <img> cannot send Authorization; use ?token= or h5p_jwt cookie for asset GETs.
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }

  const p = req.path || req.url || '';
  const isAsset = /^\/content(\/|$)/.test(p) || /^\/temp-files(\/|$)/.test(p);
  if (!isAsset) {
    return next();
  }

  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    req.headers.authorization = `Bearer ${req.query.token.trim()}`;
    return next();
  }

  const cookieToken = readH5pJwtCookie(req);
  if (cookieToken) {
    req.headers.authorization = `Bearer ${cookieToken}`;
  }
  next();
});

router.use(authenticate, requireFeature('interactive.content'));

// REST API (matches /api/h5p/* via frontend proxy)
router.get('/libraries', h5pController.getLibraries);
router.post('/libraries/install/:machineName', h5pController.installLibrary);
router.get('/content-types', h5pController.getContentTypes);
router.get('/setup-status', h5pController.getSetupStatus);

router.post('/content', h5pController.createContent);
router.get('/content/:id', h5pController.getContent);
router.put('/content/:id', h5pController.updateContent);
router.delete('/content/:id', h5pController.deleteContent);

router.get('/editor/:contentId/model', h5pController.getEditorModel);
router.get('/player/:contentId/model', h5pController.getPlayerModel);
router.get('/auth-getpath.js', h5pController.serveAuthGetPath);

// H5P ajax router registers routes at config paths (/ajax, /content, /libraries, …).
// Mount at / — NOT /ajax — or requests hit /h5p/ajax/ajax and library loading fails.
router.use(
  attachH5pUserMiddleware,
  async (req, res, next) => {
    try {
      const editor = await getH5pEditor();
      return fileUpload({
        limits: { fileSize: editor.config?.maxTotalSize || 500 * 1024 * 1024 },
        useTempFiles: true,
        tempFileDir: path.join(getH5pPaths().H5P_BASE, 'upload-temp')
      })(req, res, next);
    } catch (err) {
      next(err);
    }
  },
  async (req, res, next) => {
    try {
      const ajaxRouter = await getAjaxRouter();
      return ajaxRouter(req, res, next);
    } catch (err) {
      next(err);
    }
  }
);

router.use('/libraries-admin', attachH5pUserMiddleware, async (req, res, next) => {
  try {
    const libRouter = await getLibraryAdminRouter();
    return libRouter(req, res, next);
  } catch (err) {
    next(err);
  }
});

router.use('/content-type-cache', attachH5pUserMiddleware, async (req, res, next) => {
  try {
    const cacheRouter = await getContentTypeCacheRouter();
    return cacheRouter(req, res, next);
  } catch (err) {
    next(err);
  }
});

export default router;
