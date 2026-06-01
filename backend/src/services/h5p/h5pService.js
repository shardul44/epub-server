import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createRequire } from 'module';
import { v4 as uuidv4 } from 'uuid';
import {
  H5P_CONTENT_CATEGORIES,
  CURATED_MACHINE_NAMES,
  findContentTypeByMachineName
} from '../../config/h5pContentTypes.js';
import {
  buildInitialContentParams,
  repairStoredContentParams,
  contentParamsNeedRepair,
  getContentPlaybackWarnings
} from '../../config/h5pContentTypeDefaults.js';
import { H5pContentModel } from '../../models/H5pContent.js';
import { H5pAssetModel } from '../../models/H5pAsset.js';

const require = createRequire(import.meta.url);
const H5P = require('@lumieducation/h5p-server');
const {
  h5pAjaxExpressRouter,
  libraryAdministrationExpressRouter,
  contentTypeCacheExpressRouter
} = require('@lumieducation/h5p-express');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../../..');

const H5P_BASE = process.env.H5P_BASE_PATH || path.join(backendRoot, 'h5p');
const H5P_LIBRARIES = path.join(H5P_BASE, 'libraries');
const H5P_CONTENT = path.join(H5P_BASE, 'content');
const H5P_TEMP = path.join(H5P_BASE, 'temporary-storage');
const H5P_CONFIG = path.join(H5P_BASE, 'config.json');
const H5P_CORE = path.join(H5P_BASE, 'core');
const H5P_EDITOR_CLIENT = path.join(H5P_BASE, 'editor');

let initPromise = null;
let h5pEditor = null;

function h5pUserFromReq(req) {
  const u = req.user || {};
  return {
    id: String(u.id ?? u.userId ?? 'anonymous'),
    name: u.name || u.email || `user-${u.id}`,
    email: u.email || '',
    type: 'local'
  };
}

async function ensureDirs() {
  for (const dir of [H5P_BASE, H5P_LIBRARIES, H5P_CONTENT, H5P_TEMP, H5P_CORE, H5P_EDITOR_CLIENT]) {
    await fs.mkdir(dir, { recursive: true });
  }
  try {
    await fs.access(H5P_CONFIG);
  } catch {
    const publicBase = getDefaultPublicH5pBaseUrl();
    const defaultConfig = {
      baseUrl: publicBase,
      downloadUrl: '/download',
      librariesUrl: '/libraries',
      contentFilesUrl: '/content',
      contentFilesUrlUserContent: '/content',
      contentUserDataUrl: '/contentUserData',
      paramsUrl: '/params',
      ajaxUrl: '/ajax',
      temporaryFilesUrl: '/temp-files',
      playUrl: '/play',
      editUrl: '/edit',
      coreUrl: '/core',
      editorLibraryUrl: '/editor',
      maxTotalSize: 524288000,
      maxFileSize: 104857600
    };
    await fs.writeFile(H5P_CONFIG, JSON.stringify(defaultConfig, null, 2), 'utf8');
  }
}

function getDefaultPublicH5pBaseUrl() {
  if (process.env.H5P_PUBLIC_URL) {
    return process.env.H5P_PUBLIC_URL.replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://epub.kodeit.digital/api/h5p';
  }
  return 'http://localhost:3000/api/h5p';
}

function resolvePublicH5pBaseUrl(req) {
  const origin = req?.headers?.origin;
  if (origin && process.env.NODE_ENV !== 'production') {
    return `${origin.replace(/\/$/, '')}/api/h5p`;
  }
  return getDefaultPublicH5pBaseUrl();
}

function applyPublicH5pConfig(config, publicBase) {
  const base = publicBase.replace(/\/$/, '');
  config.baseUrl = base;
  config.librariesUrl = '/libraries';
  config.contentFilesUrl = '/content';
  config.contentFilesUrlUserContent = '/content';
  config.contentUserDataUrl = '/contentUserData';
  config.paramsUrl = '/params';
  config.ajaxUrl = '/ajax';
  config.temporaryFilesUrl = '/temp-files';
  config.playUrl = '/play';
  config.editUrl = '/edit';
  config.coreUrl = '/core';
  config.editorLibraryUrl = '/editor';
  config.downloadUrl = '/download';
}

async function initEditor() {
  await ensureDirs();
  const configStorage = new H5P.fsImplementations.JsonStorage(H5P_CONFIG);
  const config = await new H5P.H5PConfig(configStorage).load();

  applyPublicH5pConfig(config, getDefaultPublicH5pBaseUrl());
  await config.save();

  h5pEditor = H5P.fs(config, H5P_LIBRARIES, H5P_TEMP, H5P_CONTENT);

  h5pEditor.setRenderer((model) => model);

  // Refresh hub content types periodically
  try {
    await h5pEditor.contentTypeCache.updateIfNecessary();
  } catch (e) {
    console.warn('[H5P] contentTypeCache.updateIfNecessary:', e.message);
  }

  return h5pEditor;
}

export async function getH5pEditor() {
  if (h5pEditor) return h5pEditor;
  if (!initPromise) {
    initPromise = initEditor().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export function getH5pPaths() {
  return { H5P_CORE, H5P_EDITOR_CLIENT, H5P_LIBRARIES, H5P_BASE };
}

/** Append JWT for H5P core AJAX (script tags cannot send Authorization headers). */
function enrichModelWithAuthToken(model, req) {
  const header = req.headers?.authorization;
  const token =
    (header?.startsWith('Bearer ') ? header.slice(7).trim() : null) ||
    (typeof req.query?.token === 'string' ? req.query.token.trim() : null);
  if (!token) return model;

  const appendToken = (url) => {
    if (!url || typeof url !== 'string' || url.includes('token=')) return url;
    // H5P editor appends action after "...?action=", so token must be before action.
    if (url.includes('?action=')) {
      const encoded = encodeURIComponent(token);
      return url.replace('?action=', `?token=${encoded}&action=`);
    }
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  };

  const { integration } = model;
  if (!integration) return model;

  if (integration.ajaxPath) integration.ajaxPath = appendToken(integration.ajaxPath);
  if (integration.editor?.ajaxPath) integration.editor.ajaxPath = appendToken(integration.editor.ajaxPath);
  if (integration.editor?.filesPath) integration.editor.filesPath = appendToken(integration.editor.filesPath);
  if (integration.ajax?.setFinished) integration.ajax.setFinished = appendToken(integration.ajax.setFinished);
  if (integration.ajax?.contentUserData) {
    integration.ajax.contentUserData = appendToken(integration.ajax.contentUserData);
  }

  return model;
}

/** Maps JWT user to H5P IUser shape without losing auth fields on req.authUser */
export function attachH5pUserMiddleware(req, _res, next) {
  const auth = req.user || {};
  req.authUser = auth;
  req.user = h5pUserFromReq({ user: auth });
  next();
}

export async function getAjaxRouter() {
  const editor = await getH5pEditor();
  return h5pAjaxExpressRouter(editor, H5P_CORE, H5P_EDITOR_CLIENT);
}

export async function getLibraryAdminRouter() {
  const editor = await getH5pEditor();
  return libraryAdministrationExpressRouter(editor);
}

export async function getContentTypeCacheRouter() {
  const editor = await getH5pEditor();
  return contentTypeCacheExpressRouter(editor.contentTypeCache, editor.config);
}

export async function listLibraries() {
  const editor = await getH5pEditor();
  const libMap = await editor.libraryManager.listInstalledLibraries();
  return flattenInstalledLibraries(libMap);
}

export async function listContentTypes() {
  const editor = await getH5pEditor();
  let hubTypes = [];
  try {
    hubTypes = await editor.contentTypeCache.get();
  } catch {
    hubTypes = [];
  }

  const installedMap = await editor.libraryManager.listInstalledLibraries();
  const installedNames = new Set(Object.keys(installedMap));

  const curated = H5P_CONTENT_CATEGORIES.map((cat) => ({
    ...cat,
    types: cat.types.map((t) => ({
      ...t,
      installed: [...installedNames].some((n) => n.startsWith(t.machineName)),
      hubAvailable: hubTypes.some((h) => h.id === t.machineName || h.machineName === t.machineName)
    }))
  }));

  return {
    categories: curated,
    hubTypes: hubTypes.filter((h) => CURATED_MACHINE_NAMES.has(h.machineName || h.id)),
    installedCount: installedNames.size
  };
}

/** listInstalledLibraries() returns { [machineName]: IInstalledLibrary[] } in H5P v10+. */
function flattenInstalledLibraries(libMap) {
  if (Array.isArray(libMap)) return libMap;
  if (!libMap || typeof libMap !== 'object') return [];
  return Object.values(libMap).flat();
}

function parseLibraryUberName(uberName) {
  const parts = String(uberName || '').split(' ');
  return {
    machineName: parts[0] || 'H5P.MultiChoice',
    major: parts[1] ? parts[1].split('.')[0] : '1',
    minor: parts[1] ? parts[1].split('.')[1] || '0' : '0'
  };
}

/** H5P v10+ expects "H5P.MultiChoice 1.16" (space-separated, not hyphen ubername). */
function formatLibraryUberName(lib) {
  if (typeof lib === 'string' && lib.trim()) return lib.trim();
  if (lib?.machineName) {
    return `${lib.machineName} ${lib.major ?? 1}.${lib.minor ?? 0}`;
  }
  return 'H5P.MultiChoice 1.0';
}

function latestLibraryUberName(libMap, machineName) {
  const matches = libMap[machineName] || [];
  if (matches.length === 0) return null;
  const m = matches[matches.length - 1];
  return `${m.machineName} ${m.majorVersion}.${m.minorVersion}`;
}

/** Legacy / UI names → installed H5P Hub machine names. */
const H5P_LIBRARY_MACHINE_ALIASES = {
  'H5P.FillInTheBlanks': 'H5P.Blanks'
};

function resolveLibraryMachineName(machineName) {
  return H5P_LIBRARY_MACHINE_ALIASES[machineName] || machineName;
}

/**
 * Resolve installed library version or install from H5P Hub.
 * Throws a 400 with a clear message if the library cannot be used.
 */
export async function ensureLibraryInstalled(editor, machineName, user) {
  const resolvedName = resolveLibraryMachineName(machineName);
  let libMap = await editor.libraryManager.listInstalledLibraries(resolvedName);
  let uberName = latestLibraryUberName(libMap, resolvedName);
  if (uberName) return uberName;

  try {
    await editor.contentTypeCache.updateIfNecessary();
    await editor.installLibraryFromHub(resolvedName, user);
  } catch (hubErr) {
    const err = new Error(
      `H5P library "${resolvedName}" is not installed. ` +
        `The server tried to download it from the H5P Hub but failed: ${hubErr.message}. ` +
        `Ensure outbound HTTPS is allowed and H5P core files exist under backend/h5p/.`
    );
    err.statusCode = 400;
    err.code = 'H5P_LIBRARY_NOT_INSTALLED';
    throw err;
  }

  libMap = await editor.libraryManager.listInstalledLibraries(resolvedName);
  uberName = latestLibraryUberName(libMap, resolvedName);
  if (!uberName) {
    const err = new Error(
      `H5P library "${resolvedName}" is still not available after Hub install. ` +
        `Run POST /h5p/libraries/install/${machineName} or upload the .h5p package manually.`
    );
    err.statusCode = 400;
    err.code = 'H5P_LIBRARY_NOT_INSTALLED';
    throw err;
  }
  return uberName;
}

async function resolveInstalledLibraryUberName(editor, machineName, user) {
  return ensureLibraryInstalled(editor, machineName, user);
}

function normalizeContentParams(params, libraryName = null) {
  if (params == null) return {};
  if (typeof params === 'object' && params.params != null && typeof params.params === 'object') {
    return normalizeContentParams(params.params, libraryName);
  }
  if (libraryName) {
    return repairStoredContentParams(libraryName, params);
  }
  const out = { ...params };
  if (Array.isArray(out.questions)) {
    out.questions = out.questions.map((q) => {
      if (typeof q === 'object' && q !== null && q.question != null) return q.question;
      return q;
    });
  }
  return repairStoredContentParams(null, out);
}

/**
 * Create a draft H5P content object for a specific library so the editor opens
 * directly on that type (not the empty hub picker).
 */
async function createDraftForContentType(editor, machineName, language, user, req) {
  const type = findContentTypeByMachineName(machineName);
  const uberName = await ensureLibraryInstalled(editor, machineName, user);
  const lib = parseLibraryUberName(uberName);
  const libraryName = H5P.LibraryName.fromUberName(uberName, { useWhitespace: true });
  const semantics = await editor.libraryManager.getSemantics(libraryName);
  const defaultParams = buildInitialContentParams(lib.machineName, semantics);

  const meta = {
    title: type?.label || 'New content',
    embedTypes: ['div', 'iframe'],
    mainLibrary: lib.machineName,
    defaultLanguage: language,
    license: 'U'
  };

  // Must be `undefined` (not `null`) — H5P treats null as an existing content id.
  const h5pId = await editor.saveOrUpdateContent(undefined, defaultParams, meta, uberName, user);

  const row = await H5pContentModel.create({
    organizationId: req.user?.organizationId ?? req.user?.organization_id,
    createdByUserId: req.user?.id,
    h5pContentId: String(h5pId),
    title: meta.title,
    libraryName: lib.machineName,
    contentJson: defaultParams,
    metadataJson: { libraryUberName: uberName, draft: true }
  });

  const publicBase = resolvePublicH5pBaseUrl(req);
  applyPublicH5pConfig(editor.config, publicBase);
  await editor.config.save();

  const model = await buildEditorModelForClient(editor, h5pId, language, user, req);
  return { contentId: String(h5pId), dbId: row.id, model, machineName: lib.machineName };
}

/** Build model expected by @lumieducation/h5p-webcomponents h5p-editor (existing content). */
async function buildEditorModelForClient(editor, contentId, language, user, req) {
  const renderModel = await editor.render(contentId, language, user);
  const model = {
    integration: renderModel.integration,
    scripts: renderModel.scripts,
    styles: renderModel.styles,
    urlGenerator: renderModel.urlGenerator
  };

  const content = await editor.getContent(contentId, user);
  const lib = parseLibraryUberName(content.library);
  model.library = content.library;
  model.metadata = content.params?.metadata ?? content.h5p;
  model.params = normalizeContentParams(content.params?.params ?? {}, lib.machineName);

  return enrichModelWithAuthToken(model, req);
}

export async function installLibrary(req, machineName) {
  const editor = await getH5pEditor();
  const user = h5pUserFromReq(req);
  if (!machineName || !String(machineName).startsWith('H5P.')) {
    const err = new Error('Invalid H5P machine name');
    err.statusCode = 400;
    throw err;
  }
  await editor.contentTypeCache.updateIfNecessary();
  const installed = await editor.installLibraryFromHub(machineName, user);
  const uberName = await ensureLibraryInstalled(editor, machineName, user);
  return { machineName, uberName, installed };
}

export async function createContent(req, body) {
  const editor = await getH5pEditor();
  const user = h5pUserFromReq(req);

  const { title, library, params, metadata = {} } = body;
  if (!library) {
    const err = new Error('library is required (e.g. H5P.MultiChoice 1.16)');
    err.statusCode = 400;
    throw err;
  }

  const lib = parseLibraryUberName(library);
  let uberName = formatLibraryUberName(library || lib);
  if (!library.includes(' ') && lib.machineName) {
    uberName = await ensureLibraryInstalled(editor, lib.machineName, user);
  }
  const raw = params ?? {};
  const contentParams = normalizeContentParams(raw, lib.machineName);
  const meta = {
    title: title || raw.metadata?.title || metadata.title || 'Untitled',
    defaultLanguage: metadata.defaultLanguage || raw.metadata?.defaultLanguage || 'en',
    embedTypes: ['div', 'iframe'],
    mainLibrary: lib.machineName,
    preloadedDependencies: [],
    ...(raw.metadata || {}),
    ...metadata
  };

  const saved = await editor.saveOrUpdateContentReturnMetaData(
    undefined,
    contentParams,
    meta,
    uberName,
    user
  );
  const h5pId = saved.id;
  const savedMeta = saved.metadata || meta;

  const row = await H5pContentModel.create({
    organizationId: req.user?.organizationId ?? req.user?.organization_id,
    createdByUserId: req.user?.id,
    h5pContentId: String(h5pId),
    title: savedMeta.title || meta.title,
    libraryName: lib.machineName,
    mainLibraryVersion: `${lib.major}.${lib.minor}`,
    contentJson: contentParams,
    metadataJson: { ...savedMeta, libraryUberName: uberName }
  });

  return formatContentResponse(row, editor);
}

export async function updateContent(req, id, body) {
  const row = await resolveContentRow(id);
  if (!row) {
    const err = new Error('H5P content not found');
    err.statusCode = 404;
    throw err;
  }
  assertContentAccess(req, row);

  const editor = await getH5pEditor();
  const user = h5pUserFromReq(req);
  const { title, library, params, metadata } = body;

  const lib = library
    ? parseLibraryUberName(library)
    : parseLibraryUberName(row.metadata_json?.libraryUberName || `${row.library_name} ${row.main_library_version || '1.0'}`);

  const uberName = formatLibraryUberName(
    library || row.metadata_json?.libraryUberName || `${row.library_name} ${row.main_library_version || '1.0'}`
  );

  const rawParams = params !== undefined ? params : row.content_json;
  const contentParams = normalizeContentParams(rawParams, lib.machineName);
  const mergedMeta = {
    ...(row.metadata_json || {}),
    ...(rawParams?.metadata || {}),
    ...(metadata || {}),
    title: title ?? row.title,
    mainLibrary: lib.machineName
  };
  const saved = await editor.saveOrUpdateContentReturnMetaData(
    row.h5p_content_id,
    contentParams,
    mergedMeta,
    uberName,
    user
  );

  const updated = await H5pContentModel.update(row.id, {
    h5pContentId: String(saved.id ?? row.h5p_content_id),
    title: mergedMeta.title,
    libraryName: lib.machineName,
    mainLibraryVersion: `${lib.major}.${lib.minor}`,
    contentJson: contentParams,
    metadataJson: { ...mergedMeta, libraryUberName: uberName }
  });

  return formatContentResponse(updated, editor);
}

export async function getContent(req, id) {
  const row = await resolveContentRow(id);
  if (!row) {
    const err = new Error('H5P content not found');
    err.statusCode = 404;
    throw err;
  }
  assertContentAccess(req, row);
  const editor = await getH5pEditor();
  return formatContentResponse(row, editor);
}

export async function deleteContent(req, id) {
  const row = await resolveContentRow(id);
  if (!row) {
    const err = new Error('H5P content not found');
    err.statusCode = 404;
    throw err;
  }
  assertContentAccess(req, row);

  const editor = await getH5pEditor();
  const user = h5pUserFromReq(req);
  try {
    await editor.deleteContent(row.h5p_content_id, user);
  } catch (e) {
    console.warn('[H5P] deleteContent filesystem:', e.message);
  }
  await H5pAssetModel.deleteByContentId(row.id);
  await H5pContentModel.delete(row.id);
  return { deleted: true, id: row.id };
}

export async function getEditorModel(req, contentId, { machineName, language = 'en' } = {}) {
  const editor = await getH5pEditor();
  const user = h5pUserFromReq(req);

  const publicBase = resolvePublicH5pBaseUrl(req);
  applyPublicH5pConfig(editor.config, publicBase);
  await editor.config.save();

  if (!contentId || contentId === 'new') {
    const libName = machineName || 'H5P.MultiChoice';
    return createDraftForContentType(editor, libName, language, user, req);
  }

  const row = await resolveContentRow(contentId);
  const h5pId = row?.h5p_content_id ?? String(contentId);
  if (row?.content_json && row.library_name) {
    const uberName = formatLibraryUberName(
      row.metadata_json?.libraryUberName || `${row.library_name} ${row.main_library_version || '1.14'}`
    );
    const libraryName = H5P.LibraryName.fromUberName(uberName, { useWhitespace: true });
    const semantics = await editor.libraryManager.getSemantics(libraryName);
    const fixed = repairStoredContentParams(
      row.library_name,
      row.content_json,
      semantics
    );
    if (contentParamsNeedRepair(row.library_name, row.content_json, fixed)) {
      const meta = { ...(row.metadata_json || {}), title: row.title, mainLibrary: row.library_name };
      await editor.saveOrUpdateContent(h5pId, fixed, meta, uberName, user);
      await H5pContentModel.update(row.id, { contentJson: fixed });
    }
  }
  const model = await buildEditorModelForClient(editor, h5pId, language, user, req);
  return { contentId: String(h5pId), dbId: row?.id ?? null, model };
}

/** Save from H5P web component (library + params from editor.getContent). */
export async function saveEditorContent(req, id, { library, params, metadata }) {
  const row = await resolveContentRow(id);
  if (!row) {
    const err = new Error('H5P content not found');
    err.statusCode = 404;
    throw err;
  }
  assertContentAccess(req, row);

  const editor = await getH5pEditor();
  const user = h5pUserFromReq(req);
  const uberName = formatLibraryUberName(library || row.metadata_json?.libraryUberName);
  const lib = parseLibraryUberName(uberName);
  const meta = {
    ...(row.metadata_json || {}),
    ...(metadata || {}),
    title: metadata?.title ?? row.title,
    mainLibrary: lib.machineName
  };
  const contentParams = normalizeContentParams(params, lib.machineName);

  const saved = await editor.saveOrUpdateContentReturnMetaData(
    row.h5p_content_id,
    contentParams,
    meta,
    uberName,
    user
  );

  const updated = await H5pContentModel.update(row.id, {
    h5pContentId: String(saved.id ?? row.h5p_content_id),
    title: saved.metadata?.title ?? meta.title,
    libraryName: lib.machineName,
    mainLibraryVersion: `${lib.major}.${lib.minor}`,
    contentJson: contentParams,
    metadataJson: { ...meta, libraryUberName: uberName, draft: false }
  });

  return formatContentResponse(updated, editor);
}

export async function getPlayerModel(req, contentId, { language = 'en' } = {}) {
  const H5PPlayer = H5P.H5PPlayer;
  const editor = await getH5pEditor();
  const user = h5pUserFromReq(req);
  applyPublicH5pConfig(editor.config, resolvePublicH5pBaseUrl(req));
  await editor.config.save();
  const row = await resolveContentRow(contentId);
  const h5pId = row?.h5p_content_id ?? String(contentId);
  // H5PPlayer ctor is (libraryStorage, contentStorage, config).
  const player = new H5PPlayer(
    editor.libraryManager,
    editor.contentManager?.contentStorage,
    editor.config
  );
  player.setRenderer((model) => model);
  const contentParams = normalizeContentParams(row?.content_json, row?.library_name);
  const warnings = getContentPlaybackWarnings(row?.library_name, contentParams);

  try {
    const model = await player.render(h5pId, user, language);
    return { contentId: h5pId, model, warnings };
  } catch (err) {
    // Some legacy rows can point to stale h5p_content_id values; rebuild once from DB JSON.
    if (!row || !String(err?.message || '').includes('content-missing')) throw err;
    const fallbackUberName = formatLibraryUberName(
      row.metadata_json?.libraryUberName || `${row.library_name} ${row.main_library_version || '1.0'}`
    );
    const fallbackMeta = {
      ...(row.metadata_json || {}),
      title: row.title,
      mainLibrary: row.library_name,
      embedTypes: ['div', 'iframe'],
      defaultLanguage: language || 'en'
    };
    const recreated = await editor.saveOrUpdateContentReturnMetaData(
      undefined,
      normalizeContentParams(row.content_json, row.library_name),
      fallbackMeta,
      fallbackUberName,
      user
    );
    const repaired = await H5pContentModel.update(row.id, {
      h5pContentId: String(recreated.id),
      metadataJson: { ...fallbackMeta, libraryUberName: fallbackUberName }
    });
    const model = await player.render(String(recreated.id), user, language);
    const repairedWarnings = getContentPlaybackWarnings(
      repaired.library_name,
      normalizeContentParams(repaired.content_json, repaired.library_name)
    );
    return { contentId: repaired.h5p_content_id, model, warnings: repairedWarnings };
  }
}

async function resolveContentRow(id) {
  const num = Number(id);
  if (Number.isFinite(num) && num > 0) {
    const byPk = await H5pContentModel.findById(num);
    if (byPk) return byPk;
  }
  return await H5pContentModel.findByH5pContentId(id);
}

function assertContentAccess(req, row) {
  const auth = req.authUser || req.user;
  const orgId = auth?.organizationId ?? auth?.organization_id;
  const role = auth?.role;
  if (role === 'platform_admin') return;
  if (row.organization_id != null && orgId != null && Number(row.organization_id) !== Number(orgId)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
  const userId = auth?.id;
  if (row.created_by_user_id != null && userId != null && Number(row.created_by_user_id) !== Number(userId)) {
    if (role !== 'org_admin') {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
  }
}

async function formatContentResponse(row, editor) {
  const assets = await H5pAssetModel.findByContentId(row.id);
  let playUrl = null;
  try {
    playUrl = `${editor.config.baseUrl}/play/${row.h5p_content_id}`;
  } catch {
    playUrl = null;
  }
  return {
    id: row.id,
    h5pContentId: row.h5p_content_id,
    title: row.title,
    libraryName: row.library_name,
    mainLibraryVersion: row.main_library_version,
    contentJson: row.content_json,
    metadataJson: row.metadata_json,
    organizationId: row.organization_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assets,
    playUrl,
    editUrl: `${editor.config.baseUrl}/edit/${row.h5p_content_id}`
  };
}

/** Maintenance: call from cron every 5 minutes */
export async function runH5pMaintenance() {
  try {
    const editor = await getH5pEditor();
    await editor.temporaryFileManager.cleanUp();
    await editor.contentTypeCache.updateIfNecessary();
  } catch (e) {
    console.warn('[H5P] maintenance:', e.message);
  }
}

// Start maintenance interval in production
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => void runH5pMaintenance(), 5 * 60 * 1000);
}

export { H5P_CONTENT_CATEGORIES, uuidv4 };
