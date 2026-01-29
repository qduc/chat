/**
 * Providers API module
 */

import { httpClient } from '../http';
import { waitForAuthReady, onTokensCleared } from '../storage';
import type { Provider } from '../types';

let cachedDefaultProvider: string | null = null;

// Clear cache when tokens are cleared (logout)
onTokensCleared(() => {
  cachedDefaultProvider = null;
});

export const providers = {
  async getDefaultProviderId(): Promise<string> {
    if (cachedDefaultProvider) {
      return cachedDefaultProvider;
    }

    try {
      await waitForAuthReady();
      const response = await httpClient.get<{ providers: Provider[] }>('/v1/providers');

      const providerList: Provider[] = Array.isArray(response.data.providers)
        ? response.data.providers
        : [];
      const enabledProviders = providerList.filter((p) => p.enabled === 1);

      if (enabledProviders.length === 0) {
        throw new Error('No enabled providers found');
      }

      enabledProviders.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );

      cachedDefaultProvider = enabledProviders[0].id;
      return cachedDefaultProvider;
    } catch (error) {
      console.error('Failed to get default provider:', error);
      throw new Error('Unable to determine default provider');
    }
  },

  clearCache() {
    cachedDefaultProvider = null;
  },
};
