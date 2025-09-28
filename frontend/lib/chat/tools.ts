import { ToolSpec, ToolsResponse } from './types';
import { handleResponse } from './utils';
import { waitForAuthReady } from '../auth/ready';

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export class ToolsClient {
  constructor(private apiBase: string = defaultApiBase) {}

  async getToolSpecs(): Promise<ToolsResponse> {
    await waitForAuthReady();
    const response = await fetch(`${this.apiBase}/v1/tools`, {
      method: 'GET',
      credentials: 'include'
    });

    return handleResponse<ToolsResponse>(response);
  }
}

// Convenience function for backward compatibility
export async function getToolSpecs(apiBase = defaultApiBase): Promise<ToolsResponse> {
  const client = new ToolsClient(apiBase);
  return client.getToolSpecs();
}
