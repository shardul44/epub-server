import {
  listLibraries,
  listContentTypes,
  createContent,
  updateContent,
  getContent,
  deleteContent,
  getEditorModel,
  getPlayerModel,
  getH5pPaths,
  installLibrary
} from '../services/h5p/h5pService.js';
import {
  successResponse,
  errorResponse,
  badRequestResponse,
  notFoundResponse,
  forbiddenResponse
} from '../utils/responseHandler.js';

function h5pErrorMessage(err) {
  if (err?.message) return err.message;
  if (typeof err === 'string') return err;
  return 'H5P operation failed';
}

function handleError(res, err) {
  const code = err.statusCode || err.httpStatusCode || 500;
  const msg = h5pErrorMessage(err);
  if (code === 400) return badRequestResponse(res, msg);
  if (code === 404) return notFoundResponse(res, msg);
  if (code === 403) return forbiddenResponse(res, msg);
  console.error('[H5P]', err);
  return errorResponse(res, msg, code >= 500 ? code : 500);
}

export const h5pController = {
  async getLibraries(req, res) {
    try {
      const libraries = await listLibraries();
      return successResponse(res, { libraries });
    } catch (err) {
      return handleError(res, err);
    }
  },

  async installLibrary(req, res) {
    try {
      const machineName = decodeURIComponent(req.params.machineName || '');
      const result = await installLibrary(req, machineName);
      return successResponse(res, result, 201);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async getContentTypes(req, res) {
    try {
      const data = await listContentTypes();
      return successResponse(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async createContent(req, res) {
    try {
      const { title, library, params, metadata } = req.body || {};
      if (!library && !req.body?.libraryName) {
        return badRequestResponse(res, 'library or libraryName is required');
      }
      const payload = {
        title,
        library: library || req.body.libraryName,
        params,
        metadata
      };
      const content = await createContent(req, payload);
      return successResponse(res, content, 201);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async updateContent(req, res) {
    try {
      const content = await updateContent(req, req.params.id, req.body || {});
      return successResponse(res, content);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async getContent(req, res) {
    try {
      const content = await getContent(req, req.params.id);
      return successResponse(res, content);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async deleteContent(req, res) {
    try {
      const result = await deleteContent(req, req.params.id);
      return successResponse(res, result);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async getEditorModel(req, res) {
    try {
      const { machineName, language } = req.query;
      const contentId = req.params.contentId || 'new';
      const model = await getEditorModel(req, contentId, { machineName, language });
      return successResponse(res, model);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async getPlayerModel(req, res) {
    try {
      const { language } = req.query;
      const model = await getPlayerModel(req, req.params.contentId, { language });
      return successResponse(res, model);
    } catch (err) {
      return handleError(res, err);
    }
  },

  async getSetupStatus(req, res) {
    try {
      const paths = getH5pPaths();
      const fs = await import('fs/promises');
      const checks = {};
      for (const [key, p] of Object.entries(paths)) {
        try {
          const st = await fs.stat(p);
          checks[key] = { path: p, exists: true, isDirectory: st.isDirectory() };
        } catch {
          checks[key] = { path: p, exists: false };
        }
      }
      return successResponse(res, { paths: checks, coreRequired: true });
    } catch (err) {
      return handleError(res, err);
    }
  }
};
