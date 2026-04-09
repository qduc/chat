import { formatUpstreamError } from '../lib/chatUtils';
import { APIError } from '../lib/streaming';

describe('formatUpstreamError', () => {
  test('falls back to nested upstream body error message', () => {
    const error = new APIError(502, 'HTTP 502: Upstream provider returned an error response.', {
      error: 'upstream_error',
      upstream: {
        status: 400,
        body: {
          error: {
            message: 'Thinking level is not supported for this model.',
          },
        },
      },
    });

    expect(formatUpstreamError(error)).toBe(
      'Upstream provider error (status 400): Thinking level is not supported for this model.'
    );
  });
});
