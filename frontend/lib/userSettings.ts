import { httpClient } from './index';

export async function fetchSearchApiKey(): Promise<string | null> {
  const res = await httpClient.get('/v1/user-settings/search-api-key');
  return res.data?.key ?? null;
}

export async function saveSearchApiKey(key: string): Promise<void> {
  await httpClient.put('/v1/user-settings/search-api-key', { key });
}

export async function deleteSearchApiKey(): Promise<void> {
  await httpClient.delete('/v1/user-settings/search-api-key');
}
