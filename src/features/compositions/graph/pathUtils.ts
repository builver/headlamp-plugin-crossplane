// ── Deep path utilities ────────────────────────────────────────────────────────

/** Returns a nested value from obj at the given dot-separated path. */
export function getDeepPath(obj: any, dotPath: string): unknown {
  let cur = obj;
  for (const part of dotPath.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Sets a nested value on obj using a dot-separated path, creating objects or arrays as needed. */
export function setDeepPath(obj: any, dotPath: string, value: any): void {
  const parts = dotPath.split('.');
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
  const parts = dotPath.split('.');
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
