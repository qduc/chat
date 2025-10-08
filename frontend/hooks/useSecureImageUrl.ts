import { useEffect, useMemo, useState } from 'react';
import { resolveApiBase } from '../lib';
import { getToken, isTokenExpired } from '../lib';

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
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(rawUrl, apiBase);
      absoluteUrl = parsedUrl.toString();
    } catch {
      setState({ src: rawUrl, originalUrl: rawUrl, loading: false, error: false });
      return;
    }

    const baseOrigin = new URL(apiBase).origin;
    const requiresAuth = parsedUrl.origin === baseOrigin &&
      (parsedUrl.pathname.startsWith('/v1/images/') || parsedUrl.pathname.startsWith('/api/v1/images/'));

    if (!requiresAuth) {
      setState({ src: absoluteUrl, originalUrl: absoluteUrl, loading: false, error: false });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const revokeObjectUrl = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const fetchImageBlob = async () => {
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

        revokeObjectUrl();
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, originalUrl: absoluteUrl, loading: false, error: false });
      } catch (error) {
        if (cancelled) return;
        console.warn('Failed to fetch protected image', error);
        revokeObjectUrl();
        setState({ src: '', originalUrl: absoluteUrl, loading: false, error: true });
      }
    };

    void fetchImageBlob();

    return () => {
      cancelled = true;
      revokeObjectUrl();
    };
  }, [rawUrl]);

  return state;
}
