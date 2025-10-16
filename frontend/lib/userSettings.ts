import { httpClient } from './index';

export async function fetchSearchApiKey(name?: string): Promise<string | null> {
  const url = name
    ? `/v1/user-settings/search-api-key?name=${encodeURIComponent(name)}`
    : '/v1/user-settings/search-api-key';
  const res = await httpClient.get(url);
  return res.data?.key ?? null;
}

export async function saveSearchApiKey(key: string, name?: string): Promise<void> {
  const url = name
    ? `/v1/user-settings/search-api-key?name=${encodeURIComponent(name)}`
    : '/v1/user-settings/search-api-key';
  await httpClient.put(url, { key });
}

export async function deleteSearchApiKey(name?: string): Promise<void> {
  const url = name
    ? `/v1/user-settings/search-api-key?name=${encodeURIComponent(name)}`
    : '/v1/user-settings/search-api-key';
  await httpClient.delete(url);
}
