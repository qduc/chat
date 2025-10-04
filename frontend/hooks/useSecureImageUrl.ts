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
      } catch {
        setState({ src: rawUrl, originalUrl: rawUrl, loading: false, error: false });
        return;
      }

      let requiresAuth = false;
      let hasTokenParam = false;
      let imageId: string | null = null;

      try {
        const parsed = new URL(absoluteUrl);
        const baseOrigin = new URL(apiBase).origin;
        requiresAuth = parsed.origin === baseOrigin && parsed.pathname.startsWith('/v1/images/');
        hasTokenParam = parsed.searchParams.has('token');

        const pieces = parsed.pathname.split('/').filter(Boolean);
        imageId = pieces.length > 0 ? pieces[pieces.length - 1] : null;
      } catch {
        requiresAuth = false;
      }

      if (!requiresAuth) {
        setState({ src: absoluteUrl, originalUrl: absoluteUrl, loading: false, error: false });
        return;
      }

      if (hasTokenParam) {
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

      const setErrorState = () => {
        if (cancelled) return;
        revokeObjectUrl();
        setState({ src: '', originalUrl: absoluteUrl, loading: false, error: true });
      };

      const fetchImageBlob = async () => {
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
          setErrorState();
        }
      };

      const fetchSignedUrl = async () => {
        setState({ src: '', originalUrl: absoluteUrl, loading: true, error: false });

        try {
          if (!imageId) {
            throw new Error('invalid_image_id');
          }

          const token = getToken();
          if (!token || isTokenExpired(token)) {
            throw new Error('missing_token');
          }

          const signUrl = new URL(`/v1/images/${imageId}/sign`, apiBase).toString();
          const response = await fetch(signUrl, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error(`sign_http_${response.status}`);
          }

          const data = await response.json();
          const signedPath = typeof data?.url === 'string' ? data.url : null;
          if (!signedPath) {
            throw new Error('sign_missing_url');
          }

          const signedAbsoluteUrl = new URL(signedPath, apiBase).toString();
          if (cancelled) return;

          revokeObjectUrl();
          setState({ src: signedAbsoluteUrl, originalUrl: absoluteUrl, loading: false, error: false });
        } catch (error) {
          if (cancelled) return;
          console.warn('Failed to fetch signed image URL', error);
          await fetchImageBlob();
        }
      };

      fetchSignedUrl();

      return () => {
        cancelled = true;
        revokeObjectUrl();
      };
  }, [rawUrl]);

  return state;
}
