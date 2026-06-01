import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
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
  config.contentFilesUrlPlayerOverride = `${base}/content/{{contentId}}`;
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

function extractJwtFromReq(req) {
  const header = req.headers?.authorization;
  return (
    (header?.startsWith('Bearer ') ? header.slice(7).trim() : null) ||
    (typeof req.query?.token === 'string' ? req.query.token.trim() : null) ||
    null
  );
}

/** Append JWT for H5P core AJAX (script tags cannot send Authorization headers). */
function enrichModelWithAuthToken(model, req) {
  const token = extractJwtFromReq(req);
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

  integration.authToken = token;
  integration.user = integration.user || {};
  integration.user.jwt = token;

  if (integration.ajaxPath) integration.ajaxPath = appendToken(integration.ajaxPath);
  if (integration.editor?.ajaxPath) integration.editor.ajaxPath = appendToken(integration.editor.ajaxPath);
  // Do NOT append token to editor.filesPath — H5P concatenates relative paths onto it via getPath.
  if (integration.ajax?.setFinished) integration.ajax.setFinished = appendToken(integration.ajax.setFinished);
  if (integration.ajax?.contentUserData) {
    integration.ajax.contentUserData = appendToken(integration.ajax.contentUserData);
  }

  return model;
}

function isAbsoluteHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

/** Turn relative H5P media paths into absolute URLs with ?token= for <img> and getPath. */
function signH5pRelativeMediaPath(relPath, contentId, publicBase, token) {
  if (!relPath || !token || isAbsoluteHttpUrl(relPath) || relPath.includes('token=')) {
    return relPath;
  }
  const isTmp = relPath.endsWith('#tmp');
  const pathPart = (isTmp ? relPath.slice(0, -4) : relPath).replace(/^\//, '');
  const base = publicBase.replace(/\/$/, '');
  const prefix = isTmp ? `${base}/temp-files` : `${base}/content/${contentId}`;
  const signed = `${prefix}/${pathPart}?token=${encodeURIComponent(token)}`;
  return isTmp ? `${signed}#tmp` : signed;
}

function signH5pMediaUrlsInParams(node, contentId, publicBase, token) {
  if (!node || !token) return;
  if (Array.isArray(node)) {
    for (const item of node) signH5pMediaUrlsInParams(item, contentId, publicBase, token);
    return;
  }
  if (typeof node !== 'object') return;

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === 'path' && typeof val === 'string' && val && !isAbsoluteHttpUrl(val)) {
      node[key] = signH5pRelativeMediaPath(val, contentId, publicBase, token);
    } else if (val && typeof val === 'object') {
      signH5pMediaUrlsInParams(val, contentId, publicBase, token);
    }
  }
}

function signH5pMediaUrlsInPlayerModel(model, contentId, req) {
  const token = extractJwtFromReq(req);
  if (!token || !model?.integration?.contents) return model;

  const cid = `cid-${contentId}`;
  const entry = model.integration.contents[cid];
  if (!entry?.jsonContent) return model;

  const publicBase = model.integration.url || resolvePublicH5pBaseUrl(req);
  try {
    const params = JSON.parse(entry.jsonContent);
    signH5pMediaUrlsInParams(params, contentId, publicBase, token);
    entry.jsonContent = JSON.stringify(params);
  } catch (e) {
    console.warn('[H5P] signH5pMediaUrlsInPlayerModel:', e.message);
  }
  return model;
}

/** H5P ships CKEditor in both /editor/ckeditor and H5P.CKEditor — loading both breaks the editor. */
function dedupeH5pCKEditorScripts(scripts) {
  if (!Array.isArray(scripts)) return scripts;
  const withoutEditorBundle = scripts.filter((s) => !/\/editor\/ckeditor\//i.test(String(s)));
  const ckeditorUrls = withoutEditorBundle.filter((s) => /ckeditor\.js/i.test(String(s)));
  if (ckeditorUrls.length <= 1) return withoutEditorBundle;
  const keep =
    ckeditorUrls.find((s) => /H5P\.CKEditor/i.test(String(s))) ||
    ckeditorUrls[0];
  return withoutEditorBundle.filter((s) => !/ckeditor\.js/i.test(String(s)) || s === keep);
}

function prepareH5pEditorAssets(integration) {
  const assets = integration?.editor?.assets;
  if (!assets) return;
  if (Array.isArray(assets.js)) assets.js = dedupeH5pCKEditorScripts(assets.js);
  if (Array.isArray(assets.scripts)) assets.scripts = dedupeH5pCKEditorScripts(assets.scripts);
}

export function buildAuthGetPathScript(token) {
  const safeToken = JSON.stringify(token);
  return `(function(){var TOKEN=${safeToken};window.__H5P_AUTH_TOKEN=TOKEN;if(window.H5PIntegration){window.H5PIntegration.authToken=TOKEN;}function patch(h5p){if(!h5p||typeof h5p.getPath!=="function"||h5p.__authGetPathPatched)return;var o=h5p.getPath.bind(h5p);h5p.getPath=function(p,c){var u=o(p,c);if(u&&typeof u==="string"&&u.indexOf("token=")===-1){var hi=u.indexOf("#"),base=hi===-1?u:u.substring(0,hi),hash=hi===-1?"":u.substring(hi);u=base+(base.indexOf("?")===-1?"?":"&")+"token="+encodeURIComponent(TOKEN)+hash;}return u;};h5p.__authGetPathPatched=1;}patch(window.H5P);var cur=window.H5P;try{Object.defineProperty(window,"H5P",{configurable:true,get:function(){return cur;},set:function(v){cur=v;patch(v);}});}catch(e){}var n=0;var t=setInterval(function(){patch(window.H5P);if(window.H5PIntegration&&!window.H5PIntegration.authToken){window.H5PIntegration.authToken=TOKEN;}if(++n>400)clearInterval(t);},50);})();`;
}

function injectH5pAuthPatchScript(model, req) {
  const token = extractJwtFromReq(req);
  if (!token || !Array.isArray(model.scripts)) return model;
  const publicBase = resolvePublicH5pBaseUrl(req).replace(/\/$/, '');
  const patchUrl = `${publicBase}/auth-getpath.js?token=${encodeURIComponent(token)}`;
  if (!model.scripts.some((s) => String(s).includes('auth-getpath.js'))) {
    model.scripts = [patchUrl, ...model.scripts];
  }
  return model;
}

function prepareH5pClientModel(model, req, contentId) {
  let out = enrichModelWithAuthToken(model, req);
  if (out.integration) prepareH5pEditorAssets(out.integration);
  // Player uses H5P.getPath + auth cookie/query token; do not bake signed URLs into jsonContent.
  if (Array.isArray(out.scripts)) {
    out.scripts = dedupeH5pCKEditorScripts(out.scripts);
    out = injectH5pAuthPatchScript(out, req);
  }
  return out;
}

/** Player embeds in the app: iframe mode avoids multi-instance div init bugs in h5p-webcomponents. */
function preparePlayerModelForEmbed(model, req, contentId) {
  const enriched = prepareH5pClientModel(model, req, contentId);
  if (Array.isArray(enriched.embedTypes) && enriched.embedTypes.includes('iframe')) {
    enriched.embedTypes = ['iframe'];
  }
  return enriched;
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

function h5pTempFileDiskPath(user, filePath) {
  return path.join(H5P_TEMP, String(user?.id ?? 'anonymous'), filePath);
}

async function h5pTempFileExists(editor, filePath, user) {
  try {
    if (await editor.temporaryFileManager.fileExists(filePath, user)) return true;
  } catch {
    /* fall through to disk */
  }
  try {
    await fs.access(h5pTempFileDiskPath(user, filePath));
    return true;
  } catch {
    return false;
  }
}

async function openH5pTempFileStream(editor, filePath, user) {
  if (await editor.temporaryFileManager.fileExists(filePath, user)) {
    return editor.temporaryFileManager.getFileStream(filePath, user);
  }
  const diskPath = h5pTempFileDiskPath(user, filePath);
  await fs.access(diskPath);
  return createReadStream(diskPath);
}

function collectH5pMediaPaths(node, paths = []) {
  if (!node || typeof node !== 'object') return paths;
  if (Array.isArray(node)) {
    for (const item of node) collectH5pMediaPaths(item, paths);
    return paths;
  }
  if (typeof node.path === 'string' && node.path && !/^https?:\/\//i.test(node.path)) {
    paths.push(node.path.replace(/#tmp$/, ''));
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') collectH5pMediaPaths(val, paths);
  }
  return paths;
}

async function h5pContentMediaExists(editor, contentId, filePath, user) {
  try {
    if (await editor.contentManager.contentFileExists(contentId, filePath, user)) return true;
  } catch {
    /* disk fallback */
  }
  try {
    await fs.access(path.join(H5P_CONTENT, String(contentId), filePath));
    return true;
  } catch {
    return false;
  }
}

async function getMissingH5pMediaWarnings(editor, contentId, params, user) {
  const relPaths = [...new Set(collectH5pMediaPaths(params))];
  const missing = [];
  for (const filePath of relPaths) {
    if (!(await h5pContentMediaExists(editor, contentId, filePath, user))) {
      missing.push(filePath);
    }
  }
  if (!missing.length) return [];
  return [
    {
      code: 'missing-media',
      message:
        'Some uploaded images or files did not save to storage. Open this activity in the editor and upload again.'
    }
  ];
}

/** Re-mark temp uploads with #tmp so ContentStorer copies them into content storage on save. */
async function prepareH5pParamsForStorage(editor, contentId, parameters, uberName, user) {
  if (!parameters || !uberName) return parameters;
  const libraryName = H5P.LibraryName.fromUberName(uberName, { useWhitespace: true });
  const refs = await editor.contentStorer.contentFileScanner.scanForFiles(parameters, libraryName);
  for (const ref of refs) {
    if (ref.temporary) continue;
    let inContent = false;
    if (contentId) {
      inContent = await h5pContentMediaExists(editor, contentId, ref.filePath, user);
    }
    if (!inContent && (await h5pTempFileExists(editor, ref.filePath, user))) {
      ref.context.params.path = `${ref.filePath}#tmp`;
    }
  }
  return parameters;
}

async function copyMissingH5pFilesToContent(editor, contentId, parameters, uberName, user) {
  if (!contentId || !parameters || !uberName) return;
  const libraryName = H5P.LibraryName.fromUberName(uberName, { useWhitespace: true });
  const refs = await editor.contentStorer.contentFileScanner.scanForFiles(parameters, libraryName);
  for (const ref of refs) {
    if (!ref.filePath) continue;
    if (await h5pContentMediaExists(editor, contentId, ref.filePath, user)) continue;
    if (!(await h5pTempFileExists(editor, ref.filePath, user))) continue;
    const stream = await openH5pTempFileStream(editor, ref.filePath, user);
    try {
      await editor.contentManager.addContentFile(contentId, ref.filePath, stream, user);
    } finally {
      if (stream?.close) stream.close();
    }
  }
}

async function saveH5pContentToStorage(editor, contentId, parameters, metadata, uberName, user) {
  await prepareH5pParamsForStorage(editor, contentId, parameters, uberName, user);
  const saved = await editor.saveOrUpdateContentReturnMetaData(
    contentId,
    parameters,
    metadata,
    uberName,
    user
  );
  const storageId = String(saved.id);
  await copyMissingH5pFilesToContent(editor, storageId, parameters, uberName, user);
  try {
    const fromStorage = await editor.contentManager.getContentParameters(storageId, user);
    if (fromStorage && typeof fromStorage === 'object') {
      saved.parameters = fromStorage;
    }
  } catch {
    saved.parameters = parameters;
  }
  return saved;
}

function normalizeContentParams(params, libraryName = null, { forSave = false } = {}) {
  if (params == null) return {};
  if (typeof params === 'object' && params.params != null && typeof params.params === 'object') {
    return normalizeContentParams(params.params, libraryName, { forSave });
  }
  if (libraryName) {
    return repairStoredContentParams(libraryName, params, null, { forSave });
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
  const h5pId = (await saveH5pContentToStorage(editor, undefined, defaultParams, meta, uberName, user)).id;

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

  return prepareH5pClientModel(model, req, contentId);
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
  const contentParams = normalizeContentParams(raw, lib.machineName, { forSave: true });
  const meta = {
    title: title || raw.metadata?.title || metadata.title || 'Untitled',
    defaultLanguage: metadata.defaultLanguage || raw.metadata?.defaultLanguage || 'en',
    embedTypes: ['div', 'iframe'],
    mainLibrary: lib.machineName,
    preloadedDependencies: [],
    ...(raw.metadata || {}),
    ...metadata
  };

  const saved = await saveH5pContentToStorage(editor, undefined, contentParams, meta, uberName, user);
  const h5pId = saved.id;
  const savedMeta = saved.metadata || meta;
  const persistedParams = saved.parameters ?? contentParams;

  const row = await H5pContentModel.create({
    organizationId: req.user?.organizationId ?? req.user?.organization_id,
    createdByUserId: req.user?.id,
    h5pContentId: String(h5pId),
    title: savedMeta.title || meta.title,
    libraryName: lib.machineName,
    mainLibraryVersion: `${lib.major}.${lib.minor}`,
    contentJson: persistedParams,
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
  const contentParams = normalizeContentParams(rawParams, lib.machineName, { forSave: true });
  const mergedMeta = {
    ...(row.metadata_json || {}),
    ...(rawParams?.metadata || {}),
    ...(metadata || {}),
    title: title ?? row.title,
    mainLibrary: lib.machineName
  };
  const saved = await saveH5pContentToStorage(
    editor,
    row.h5p_content_id,
    contentParams,
    mergedMeta,
    uberName,
    user
  );
  const persistedParams = saved.parameters ?? contentParams;

  const updated = await H5pContentModel.update(row.id, {
    h5pContentId: String(saved.id ?? row.h5p_content_id),
    title: mergedMeta.title,
    libraryName: lib.machineName,
    mainLibraryVersion: `${lib.major}.${lib.minor}`,
    contentJson: persistedParams,
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
      await saveH5pContentToStorage(editor, h5pId, fixed, meta, uberName, user);
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
  const contentParams = normalizeContentParams(params, lib.machineName, { forSave: true });

  const saved = await saveH5pContentToStorage(
    editor,
    row.h5p_content_id,
    contentParams,
    meta,
    uberName,
    user
  );
  const persistedParams = saved.parameters ?? contentParams;

  const updated = await H5pContentModel.update(row.id, {
    h5pContentId: String(saved.id ?? row.h5p_content_id),
    title: saved.metadata?.title ?? meta.title,
    libraryName: lib.machineName,
    mainLibraryVersion: `${lib.major}.${lib.minor}`,
    contentJson: persistedParams,
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
  if (!row) {
    const err = new Error('H5P content not found');
    err.statusCode = 404;
    throw err;
  }
  const h5pId = row.h5p_content_id ?? String(contentId);
  // H5PPlayer ctor is (libraryStorage, contentStorage, config).
  const player = new H5PPlayer(
    editor.libraryManager,
    editor.contentManager?.contentStorage,
    editor.config
  );
  player.setRenderer((model) => model);
  const contentParams = normalizeContentParams(row.content_json, row.library_name);
  const uberName =
    row.metadata_json?.libraryUberName ||
    `${row.library_name} ${row.main_library_version || '1.0'}`;
  await copyMissingH5pFilesToContent(editor, h5pId, contentParams, uberName, user);
  const warnings = [
    ...getContentPlaybackWarnings(row.library_name, contentParams),
    ...(await getMissingH5pMediaWarnings(editor, h5pId, contentParams, user))
  ];

  try {
    const model = preparePlayerModelForEmbed(await player.render(h5pId, user, language), req, h5pId);
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
    const recreated = await saveH5pContentToStorage(
      editor,
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
    const model = preparePlayerModelForEmbed(
      await player.render(String(recreated.id), user, language),
      req,
      String(recreated.id)
    );
    const repairedWarnings = getContentPlaybackWarnings(
      repaired.library_name,
      normalizeContentParams(repaired.content_json, repaired.library_name)
    );
    return { contentId: repaired.h5p_content_id, model, warnings: repairedWarnings };
  }
}

async function resolveContentRow(id) {
  const num = Number(id);
  const byStorage = await H5pContentModel.findByH5pContentId(id);
  if (byStorage) return byStorage;
  // Large ids are H5P storage ids; small ids are usually h5p_contents.id (DB PK).
  if (Number.isFinite(num) && num > 0 && num < 1_000_000) {
    const byPk = await H5pContentModel.findById(num);
    if (byPk) return byPk;
  }
  return null;
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
