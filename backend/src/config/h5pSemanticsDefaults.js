/**
 * Build and repair H5P content params from library semantics.json.
 */

function defaultTextValue(field) {
  if (field.default !== undefined && field.default !== '') return field.default;
  if (field.placeholder) {
    const ph = String(field.placeholder);
    if (field.widget === 'textarea' || (ph.includes('*') && ph.length > 20)) {
      return ph;
    }
  }
  return '';
}

function defaultListItem(field) {
  if (!field?.field) return null;
  if (field.field.type === 'group') {
    return semanticsToDefaultParams(field.field.fields);
  }
  const leaf = field.field;
  if (leaf.type === 'boolean') return leaf.default ?? false;
  if (leaf.type === 'number') return leaf.default ?? 0;
  if (leaf.type === 'text' || leaf.type === 'html') return defaultTextValue(leaf);
  return leaf.default ?? '';
}

function defaultListValue(field) {
  const min = Math.max(field.min ?? 0, field.defaultNum ?? 0);
  if (min < 1 || !field.field) return [];
  return Array.from({ length: min }, () => structuredClone(defaultListItem(field)));
}

function isEffectivelyEmptyParamValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.keys(value).every((k) => isEffectivelyEmptyParamValue(value[k]));
  }
  return false;
}

/**
 * Optional single-field groups (e.g. Flashcards `tip.tip`) with empty values break
 * @lumieducation/h5p-server SemanticsEnforcer (sanitize-html expects a string).
 */
export function stripEmptyNestedSingleFieldGroups(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) stripEmptyNestedSingleFieldGroups(item);
    return;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const childKeys = Object.keys(val);
      if (childKeys.length === 1 && childKeys[0] === key && isEffectivelyEmptyParamValue(val[key])) {
        delete node[key];
        continue;
      }
      stripEmptyNestedSingleFieldGroups(val);
    }
  }
}

/** Build default params object from library semantics (for new editor instances). */
export function semanticsToDefaultParams(semantics) {
  if (!Array.isArray(semantics)) return {};
  const params = {};
  for (const field of semantics) {
    if (!field?.name) continue;
    switch (field.type) {
      case 'group': {
        const groupParams = semanticsToDefaultParams(field.fields);
        if (!(field.optional && isEffectivelyEmptyParamValue(groupParams))) {
          params[field.name] = groupParams;
        }
        break;
      }
      case 'list':
        params[field.name] = defaultListValue(field);
        break;
      case 'boolean':
        params[field.name] = field.default ?? false;
        break;
      case 'number':
        params[field.name] = field.default ?? 0;
        break;
      case 'select':
        params[field.name] = field.default ?? field.options?.[0]?.value ?? '';
        break;
      case 'library':
        if (!field.optional && field.options?.length) {
          const opt = field.options[0];
          const lib = typeof opt === 'string' ? opt : opt?.name;
          params[field.name] = { library: lib, params: {}, metadata: {}, subContentId: null };
        }
        break;
      case 'text':
      case 'html':
        params[field.name] = defaultTextValue(field);
        break;
      case 'video':
      case 'audio':
        params[field.name] = [];
        break;
      case 'image':
        if (!field.optional) {
          params[field.name] = {};
        }
        break;
      case 'file':
        if (!field.optional) {
          params[field.name] = {};
        }
        break;
      default:
        params[field.name] = field.default ?? '';
    }
  }
  return params;
}

/** Ensure list fields meet semantics `min` / `defaultNum` (fixes empty accordions, memory games, etc.). */
export function enforceSemanticsMinimums(params, semantics) {
  if (!params || typeof params !== 'object' || !Array.isArray(semantics)) {
    return params ?? {};
  }
  const out = Array.isArray(params) ? [...params] : { ...params };

  for (const field of semantics) {
    if (!field?.name) continue;

    if (field.type === 'group' && Array.isArray(field.fields)) {
      const child = out[field.name];
      const childObj = child && typeof child === 'object' && !Array.isArray(child) ? { ...child } : {};
      out[field.name] = enforceSemanticsMinimums(childObj, field.fields);
      continue;
    }

    if (field.type === 'list' && field.field) {
      const min = Math.max(field.min ?? 0, field.defaultNum ?? 0);
      let arr = Array.isArray(out[field.name]) ? [...out[field.name]] : [];
      while (arr.length < min) {
        const item = defaultListItem(field);
        if (item != null) arr.push(structuredClone(item));
        else break;
      }
      out[field.name] = arr;
    }
  }

  return out;
}

const H5P_SERVED_MEDIA_PATH_RE = /\/(?:content\/\d+|temp-files)\/(.+)$/i;

/** Convert signed absolute H5P media URLs back to stored relative paths (images/foo.jpg). */
export function relativizeH5pMediaPath(pathOrUrl) {
  if (typeof pathOrUrl !== 'string' || !pathOrUrl) return pathOrUrl;
  const isTmp = pathOrUrl.endsWith('#tmp');
  const withoutHash = isTmp ? pathOrUrl.slice(0, -4) : pathOrUrl;
  const withoutQuery = withoutHash.split('?')[0];
  if (!/^https?:\/\//i.test(withoutQuery)) {
    return isTmp ? withoutQuery.replace(/^\//, '') + '#tmp' : withoutQuery.replace(/^\//, '');
  }
  const match = withoutQuery.match(H5P_SERVED_MEDIA_PATH_RE);
  if (!match?.[1]) return pathOrUrl;
  const rel = decodeURIComponent(match[1]).replace(/^\//, '');
  return isTmp || withoutQuery.includes('/temp-files/') ? `${rel}#tmp` : rel;
}

export function stripSignedH5pMediaPaths(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) stripSignedH5pMediaPaths(item);
    return;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === 'path' && typeof val === 'string') {
      node[key] = relativizeH5pMediaPath(val);
    } else if (val && typeof val === 'object') {
      stripSignedH5pMediaPaths(val);
    }
  }
}

export function coerceH5pMediaFields(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) coerceH5pMediaFields(item);
    return;
  }
  stripSignedH5pMediaPaths(node);
  for (const key of Object.keys(node)) {
    const val = node[key];
    if ((key === 'files' || key === 'file') && (val === '' || val === null)) {
      node[key] = [];
    } else if (key === 'poster' && (val === '' || val === null)) {
      delete node[key];
    } else if (isEmptyH5pUploadedMedia(val)) {
      // Empty `{}` image objects break the editor (shows Edit without upload).
      delete node[key];
    } else if (val && typeof val === 'object') {
      coerceH5pMediaFields(val);
    }
  }
}

/** H5P image/file param with no upload — must be absent, not `{}`. */
function isEmptyH5pUploadedMedia(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  if (val.path || val.mime) return false;
  const keys = Object.keys(val);
  if (keys.length === 0) return true;
  return keys.every((k) => k === 'copyright' || k === 'decorative');
}
