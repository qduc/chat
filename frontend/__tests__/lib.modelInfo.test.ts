/**
 * Model metadata lookup used by the Usage context meter.
 */
import { httpClient, HttpError } from '../lib/http';
import { clearModelInfoCache, fetchModelInfo } from '../lib/modelInfo';

jest.mock('../lib/http', () => {
  const actual = jest.requireActual('../lib/http');
  return { ...actual, httpClient: { get: jest.fn() } };
});

const mockGet = httpClient.get as jest.Mock;

const info = {
  model: 'claude-sonnet',
  context_window: 200000,
  max_output_tokens: 64000,
  pricing: null,
};

describe('fetchModelInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearModelInfoCache();
  });

  it('requests by model and provider and caches per model', async () => {
    mockGet.mockResolvedValue({ data: info });
    await expect(fetchModelInfo('claude-sonnet', 'anthropic')).resolves.toEqual(info);
    await expect(fetchModelInfo('claude-sonnet', 'anthropic')).resolves.toEqual(info);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/v1/models/info?model=claude-sonnet&provider=anthropic');
  });

  it('resolves null on 404 and remembers it', async () => {
    mockGet.mockRejectedValue(new HttpError(404, 'HTTP 404', {} as Response));
    await expect(fetchModelInfo('m', 'p')).resolves.toBeNull();
    await expect(fetchModelInfo('m', 'p')).resolves.toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('retries after other errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: info });
    await expect(fetchModelInfo('m', 'p')).resolves.toBeNull();
    await expect(fetchModelInfo('m', 'p')).resolves.toEqual(info);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
