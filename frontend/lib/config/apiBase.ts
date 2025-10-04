const DEFAULT_RELATIVE_BASE = '/api';
const DEFAULT_BACKEND_ORIGIN = 'http://backend:3001';

function ensureLeadingSlash(path: string): string {
  if (!path) {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function stripTrailingSlash(url: string): string {
  if (!url) {
    return url;
  }
  return url.replace(/\/+$/, '');
}

function resolveAbsolute(basePath: string, origin: string): string {
  const normalizedOrigin = stripTrailingSlash(origin || DEFAULT_BACKEND_ORIGIN) || DEFAULT_BACKEND_ORIGIN;
  const normalizedPath = ensureLeadingSlash(basePath || DEFAULT_RELATIVE_BASE);
  try {
    const absolute = new URL(normalizedPath, `${normalizedOrigin}/`).toString();
    return stripTrailingSlash(absolute);
  } catch {
    const fallbackOrigin = normalizedOrigin.replace(/\/+$/, '');
    return stripTrailingSlash(`${fallbackOrigin}${normalizedPath === '/' ? '' : normalizedPath}`);
  }
}

export function resolveApiBase(): string {
  const envBase = (process.env.NEXT_PUBLIC_API_BASE ?? '').trim();
  const backendOrigin = (process.env.BACKEND_ORIGIN ?? process.env.INTERNAL_API_BASE ?? '').trim();

  if (typeof window !== 'undefined') {
    const browserOrigin = window.location.origin;
    if (!envBase) {
      return stripTrailingSlash(`${browserOrigin}${ensureLeadingSlash(DEFAULT_RELATIVE_BASE)}`);
    }

    if (/^https?:\/\//i.test(envBase)) {
      return stripTrailingSlash(envBase);
    }

    try {
      const absolute = new URL(ensureLeadingSlash(envBase), `${browserOrigin}/`).toString();
      return stripTrailingSlash(absolute);
    } catch {
      return stripTrailingSlash(`${browserOrigin}${ensureLeadingSlash(envBase)}`);
    }
  }

  if (envBase && /^https?:\/\//i.test(envBase)) {
    return stripTrailingSlash(envBase);
  }

  const origin = backendOrigin || DEFAULT_BACKEND_ORIGIN;
  const basePath = envBase || DEFAULT_RELATIVE_BASE;
  return resolveAbsolute(basePath, origin);
}

export function resolveBackendOrigin(): string {
  const backendOrigin = (process.env.BACKEND_ORIGIN ?? process.env.INTERNAL_API_BASE ?? '').trim();
  if (backendOrigin) {
    return stripTrailingSlash(backendOrigin);
  }
  if (typeof window !== 'undefined') {
    return stripTrailingSlash(window.location.origin);
  }
  return DEFAULT_BACKEND_ORIGIN;
}
