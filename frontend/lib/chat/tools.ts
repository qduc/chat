import { ToolSpec, ToolsResponse } from './types';
import { httpClient } from '../http/client';
import { resolveApiBase } from '../config/apiBase';

const defaultApiBase = resolveApiBase();

export class ToolsClient {
  constructor(private apiBase: string = defaultApiBase) {}

  async getToolSpecs(): Promise<ToolsResponse> {
    const response = await httpClient.get<ToolsResponse>('/v1/tools');
    return response.data;
  }
}

// Convenience function for backward compatibility
export async function getToolSpecs(apiBase = defaultApiBase): Promise<ToolsResponse> {
  const client = new ToolsClient(apiBase);
  return client.getToolSpecs();
}
