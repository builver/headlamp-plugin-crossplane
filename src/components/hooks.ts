import { useLocation } from 'react-router-dom';

/**
 * Extracts the last path segment from the current route URL.
 * Used by detail pages to get the resource name from the URL.
 */
export function useNameFromRoute(): string {
  const location = useLocation();
  return location.pathname.split('/').filter(Boolean).pop() ?? '';
}
