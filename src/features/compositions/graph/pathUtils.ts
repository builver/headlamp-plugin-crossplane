// ── Deep path utilities ────────────────────────────────────────────────────────

// Path segments are dot-joined. Real object keys can contain `.` (e.g. label
// keys like `crossplane.io/composite`). To preserve the segment boundary,
// dots inside a key are escaped to U+001F (Unit Separator) when a path is
// constructed, and decoded when a segment is used to index an object or
// rendered to the user.
const PATH_KEY_DOT = '';

/** Escape a raw object key so it can be safely embedded as a single path segment. */
export function encodePathKey(key: string): string {
  return key.includes('.') ? key.replace(/\./g, PATH_KEY_DOT) : key;
}

/** Decode an escaped path segment back to its original key. */
export function decodePathKey(seg: string): string {
  return seg.includes(PATH_KEY_DOT) ? seg.replace(new RegExp(PATH_KEY_DOT, 'g'), '.') : seg;
}

/** Returns a nested value from obj at the given dot-separated path. */
export function getDeepPath(obj: any, dotPath: string): unknown {
  let cur = obj;
  for (const part of dotPath.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[decodePathKey(part)];
  }
  return cur;
}

/** Sets a nested value on obj using a dot-separated path, creating objects or arrays as needed. */
export function setDeepPath(obj: any, dotPath: string, value: any): void {
  const parts = dotPath.split('.').map(decodePathKey);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = nextIsIndex ? [] : {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Deletes a nested key on obj at the given dot-separated path.
 *  If the parent is an array and the key is a numeric index, splices the element out (no holes). */
export function deleteDeepPath(obj: any, dotPath: string): void {
  const parts = dotPath.split('.').map(decodePathKey);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') return;
    cur = cur[parts[i]];
  }
  const lastKey = parts[parts.length - 1];
  if (Array.isArray(cur) && /^\d+$/.test(lastKey)) {
    cur.splice(parseInt(lastKey), 1);
  } else {
    delete cur[lastKey];
  }
}
