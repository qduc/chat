/**
 * Tools API module
 */

import { httpClient } from '../http';
import type { ToolsResponse } from '../types';

export const tools = {
  async getToolSpecs(): Promise<ToolsResponse> {
    const response = await httpClient.get<ToolsResponse>('/v1/tools');
    return response.data;
  },
};
