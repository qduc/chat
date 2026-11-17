/**
 * Memory (Journal) section of the chat details panel.
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemorySection } from '../components/details/MemorySection';
import { httpClient, HttpError } from '../lib/http';
import { fetchJournalPage } from '../lib/journal';

jest.mock('../lib/http', () => {
  const actual = jest.requireActual('../lib/http');
  return {
    ...actual,
    httpClient: { get: jest.fn(), delete: jest.fn() },
  };
});

const mockGet = httpClient.get as jest.Mock;
const mockDelete = httpClient.delete as jest.Mock;

const page = (entries: Array<{ id: number; content: string }>, hasMore = false, pageNo = 1) => ({
  data: {
    entries: entries.map((e) => ({
      ...e,
      model_name: 'claude-sonnet',
      created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    })),
    page: pageNo,
    page_size: 20,
    has_more: hasMore,
  },
});

const notFound = () => new HttpError(404, 'HTTP 404: Not Found', {} as Response);

describe('fetchJournalPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requests the page and normalizes the response', async () => {
    mockGet.mockResolvedValueOnce(page([{ id: 1, content: 'Prefers TypeScript' }], true));
    const result = await fetchJournalPage(1);
    expect(mockGet).toHaveBeenCalledWith('/v1/journal?page=1&page_size=20');
    expect(result?.entries).toHaveLength(1);
    expect(result?.has_more).toBe(true);
  });

  it('returns null on 404 so the feature can hide', async () => {
    mockGet.mockRejectedValueOnce(notFound());
    await expect(fetchJournalPage(1)).resolves.toBeNull();
  });

  it('rethrows other errors', async () => {
    mockGet.mockRejectedValueOnce(new HttpError(500, 'boom', {} as Response));
    await expect(fetchJournalPage(1)).rejects.toThrow('boom');
  });
});

describe('MemorySection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not fetch until the section is opened', async () => {
    mockGet.mockResolvedValue(page([{ id: 1, content: 'Prefers TypeScript' }]));
    const { rerender } = render(<MemorySection open={false} onToggle={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Memory/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(mockGet).not.toHaveBeenCalled();

    rerender(<MemorySection open onToggle={jest.fn()} />);

    expect(await screen.findByText('Prefers TypeScript')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet · 3 days ago')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('hides itself when the journal endpoint returns 404', async () => {
    mockGet.mockRejectedValueOnce(notFound());
    const { container } = render(<MemorySection open onToggle={jest.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows a quiet inline message on other errors', async () => {
    mockGet.mockRejectedValueOnce(new HttpError(500, 'boom', {} as Response));
    render(<MemorySection open onToggle={jest.fn()} />);
    expect(await screen.findByText(/couldn.t be loaded right now/)).toBeInTheDocument();
  });

  it('loads more pages when has_more is set', async () => {
    mockGet
      .mockResolvedValueOnce(page([{ id: 1, content: 'First' }], true))
      .mockResolvedValueOnce(page([{ id: 2, content: 'Second' }], false, 2));
    render(<MemorySection open onToggle={jest.fn()} />);
    await screen.findByText('First');
    expect(screen.getByRole('button', { name: /Memory/ })).toHaveTextContent('1+');

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(mockGet).toHaveBeenLastCalledWith('/v1/journal?page=2&page_size=20');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('deletes an entry after confirming in a dialog', async () => {
    mockGet.mockResolvedValueOnce(page([{ id: 7, content: 'Likes short answers' }]));
    mockDelete.mockResolvedValueOnce({ data: null, status: 204 });
    render(<MemorySection open onToggle={jest.fn()} />);
    await screen.findByText('Likes short answers');

    await userEvent.click(screen.getByRole('button', { name: 'Delete memory' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete memory?' });
    expect(mockDelete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledWith('/v1/journal/7');
    await waitFor(() => expect(screen.queryByText('Likes short answers')).not.toBeInTheDocument());
  });
});
