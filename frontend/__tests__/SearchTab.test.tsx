import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchTab from '../components/settings/SearchTab';
import { httpClient } from '../lib';

jest.mock('../lib', () => ({ httpClient: { get: jest.fn(), put: jest.fn() } }));
jest.mock('../components/ui/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));

test('saves a SearXNG URL without a key and refreshes tool availability', async () => {
  (httpClient.get as jest.Mock).mockResolvedValue({ data: {} });
  (httpClient.put as jest.Mock).mockResolvedValue({});
  const onChanged = jest.fn();
  window.addEventListener('tool-settings-changed', onChanged);
  render(<SearchTab isVisible isOpen />);
  await waitFor(() => expect(httpClient.get).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /SearXNG/ }));
  fireEvent.change(screen.getByPlaceholderText('https://searx.example/search'), {
    target: { value: 'https://search.example' },
  });
  expect(screen.getByRole('button', { name: /^SearXNG Not configured$/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() =>
    expect(httpClient.put).toHaveBeenCalledWith('/v1/user-settings', {
      searxng_base_url: 'https://search.example',
      searxng_api_key: null,
    })
  );
  expect(onChanged).toHaveBeenCalled();
  expect(screen.queryByText('Please enter a valid API key to save')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^SearXNG Configured$/ })).toHaveTextContent(
    'Configured'
  );
  window.removeEventListener('tool-settings-changed', onChanged);
});
