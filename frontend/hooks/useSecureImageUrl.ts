import { useEffect, useMemo, useState } from 'react';
import { resolveApiBase } from '../lib/config/apiBase';
import { getToken, isTokenExpired } from '../lib/auth/tokens';

interface SecureImageState {
  src: string;
  originalUrl: string;
  loading: boolean;
  error: boolean;
}

const initialState: SecureImageState = {
  src: '',
  originalUrl: '',
  loading: false,
  error: false,
};

function isDataLike(url: string) {
  return url.startsWith('data:') || url.startsWith('blob:');
}

export function useSecureImageUrl(rawUrlInput: string | null | undefined): SecureImageState {
  const rawUrl = useMemo(() => rawUrlInput ?? '', [rawUrlInput]);
  const [state, setState] = useState<SecureImageState>(() => ({ ...initialState, src: rawUrl, originalUrl: rawUrl }));

  useEffect(() => {
    if (!rawUrl) {
      setState({ ...initialState, error: true });
      return;
    }

    if (isDataLike(rawUrl)) {
      setState({ src: rawUrl, originalUrl: rawUrl, loading: false, error: false });
      return;
    }

    if (typeof window === 'undefined') {
      setState({ src: rawUrl, originalUrl: rawUrl, loading: false, error: false });
      return;
    }

  const apiBase = resolveApiBase();
    let absoluteUrl: string;

    try {
      absoluteUrl = new URL(rawUrl, apiBase).toString();
    } catch (_error) {
      setState({ src: rawUrl, originalUrl: rawUrl, loading: false, error: false });
      return;
    }

    let requiresAuth = false;
    try {
      const parsed = new URL(absoluteUrl);
      const baseOrigin = new URL(apiBase).origin;
      requiresAuth = parsed.origin === baseOrigin && parsed.pathname.startsWith('/v1/images/');
    } catch (_error) {
      requiresAuth = false;
    }

    if (!requiresAuth) {
      setState({ src: absoluteUrl, originalUrl: absoluteUrl, loading: false, error: false });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const fetchImage = async () => {
      setState({ src: '', originalUrl: absoluteUrl, loading: true, error: false });

      try {
        const token = getToken();
        if (!token || isTokenExpired(token)) {
          throw new Error('missing_token');
        }

        const response = await fetch(absoluteUrl, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, originalUrl: absoluteUrl, loading: false, error: false });
      } catch (error) {
        if (cancelled) return;
        console.warn('Failed to fetch protected image', error);
        setState({ src: '', originalUrl: absoluteUrl, loading: false, error: true });
      }
    };

    fetchImage();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [rawUrl]);

  return state;
}
