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

/** Build default params object from library semantics (for new editor instances). */
export function semanticsToDefaultParams(semantics) {
  if (!Array.isArray(semantics)) return {};
  const params = {};
  for (const field of semantics) {
    if (!field?.name) continue;
    switch (field.type) {
      case 'group':
        params[field.name] = semanticsToDefaultParams(field.fields);
        break;
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
          params[field.name] = { library: lib, params: {}, metadata: null, subContentId: null };
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

export function coerceH5pMediaFields(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) coerceH5pMediaFields(item);
    return;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if ((key === 'files' || key === 'file') && (val === '' || val === null)) {
      node[key] = [];
    } else if (key === 'poster' && (val === '' || val === null)) {
      delete node[key];
    } else if (val && typeof val === 'object') {
      coerceH5pMediaFields(val);
    }
  }
}
