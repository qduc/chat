import { useEffect, useState } from 'react';
import { fetchModelInfo, type ModelInfo } from '../lib/modelInfo';

/** Model metadata for the given model, or null while loading / when unavailable. */
export function useModelInfo(modelId: string, providerId: string | null): ModelInfo | null {
  const key = modelId ? `${providerId ?? ''}::${modelId}` : '';
  const [state, setState] = useState<{ key: string; info: ModelInfo | null }>({
    key: '',
    info: null,
  });

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    void fetchModelInfo(modelId, providerId).then((info) => {
      if (!cancelled) setState({ key, info });
    });
    return () => {
      cancelled = true;
    };
  }, [key, modelId, providerId]);

  return state.key === key ? state.info : null;
}
