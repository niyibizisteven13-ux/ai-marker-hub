// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AttachmentCards } from '../../src/ui/AttachmentCards';
import { SourceList } from '../../src/ui/SourceList';
import { AiResponseView } from '../../src/ui/AiResponseView';
import type { AttachmentRef } from '../../src/ui/types';

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 3600_000).toISOString();
const docx: AttachmentRef = { id: 'd1', name: 'Report.docx', mime: 'x', size: 34188, kind: 'document', url: '/api/files/d1?exp=1&sig=a', expiresAt: future };
const chart: AttachmentRef = { id: 'c1', name: 'Scores.svg', mime: 'image/svg+xml', size: 8500, kind: 'chart', url: '/api/files/c1?exp=1&sig=b', previewUrl: '/api/files/p1?exp=1&sig=c', expiresAt: future };
const old: AttachmentRef = { ...docx, id: 'd2', name: 'Old.pdf', kind: 'pdf', expiresAt: past };

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('AttachmentCards', () => {
  it('shows download cards for files and image tiles for visuals', () => {
    render(<AttachmentCards attachments={[docx, chart]} />);
    expect(screen.getAllByRole('link', { name: /download/i }).length).toBe(2);
    expect(screen.getByText('Report.docx')).toBeTruthy();
    expect(screen.getByText(/Word document · 33\.4 KB/)).toBeTruthy();
    const dl = document.querySelector('a[download="Report.docx"]') as HTMLAnchorElement;
    expect(dl.getAttribute('href')).toBe('/api/files/d1?exp=1&sig=a');
    const img = screen.getByAltText('Scores.svg') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('/api/files/p1');
    expect(document.querySelector('svg script')).toBeNull();
  });

  it('marks expired files and removes the download link', () => {
    render(<AttachmentCards attachments={[old]} />);
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(document.querySelector('a[download="Old.pdf"]')).toBeNull();
  });

  it('opens a lightbox and closes it with Escape', () => {
    render(<AttachmentCards attachments={[chart]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Scores.svg' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<AttachmentCards attachments={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('SourceList', () => {
  it('lists sources and only links http(s) URLs', () => {
    render(<SourceList sources={[
      { title: 'Sample census', publisher: 'Sample Agency', year: 2022, page: 12, url: 'https://example.com/r' },
      { title: 'Bad link', url: 'javascript:alert(1)' },
    ]} />);
    expect(screen.getByText(/Sources \(2\)/)).toBeTruthy();
    expect(screen.getByText('Sample census, Sample Agency, 2022, p. 12').closest('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Bad link').closest('a')).toBeNull();
  });
});

describe('AiResponseView', () => {
  beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); });

  it('shows history messages instantly (animate=false) with actions, attachments and sources', () => {
    render(<AiResponseView content="Full answer" messageId="m1" animate={false} attachments={[docx]} sources={[{ title: 'T' }]} />);
    expect(screen.getByText('Full answer')).toBeTruthy();
    expect(screen.getByLabelText('Copy response')).toBeTruthy();
    expect(screen.getByTestId('attachments')).toBeTruthy();
    expect(screen.getByTestId('sources')).toBeTruthy();
  });

  it('types out new answers, then reveals attachments and actions', () => {
    vi.useFakeTimers();
    const long = 'word '.repeat(400);
    render(<AiResponseView content={long} messageId="m2" attachments={[docx]} />);
    expect(screen.queryByTestId('attachments')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByTestId('attachments')).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId('attachments')).toBeTruthy();
  });

  it('continues typing from where it was when the content grows (live streaming)', () => {
    vi.useFakeTimers();
    const { rerender } = render(<AiResponseView content="Hello wor" messageId="m3" />);
    act(() => { vi.advanceTimersByTime(500); });
    rerender(<AiResponseView content="Hello world, how are you?" messageId="m3" />);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Hello world, how are you?')).toBeTruthy();
  });

  it('copies the response and calls back', async () => {
    const onCopy = vi.fn();
    render(<AiResponseView content="Copy me" messageId="m4" animate={false} onCopy={onCopy} />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Copy response')); });
    expect((navigator.clipboard.writeText as any)).toHaveBeenCalledWith('Copy me');
    expect(onCopy).toHaveBeenCalledWith('m4', 'Copy me');
  });

  it('toggles feedback and reports it', () => {
    const onFeedback = vi.fn();
    render(<AiResponseView content="x" messageId="m5" animate={false} onFeedback={onFeedback} />);
    fireEvent.click(screen.getByLabelText('Good response'));
    expect(onFeedback).toHaveBeenCalledWith('m5', 'positive');
  });
});
