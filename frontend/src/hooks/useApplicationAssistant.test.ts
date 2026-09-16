import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applicationsApi } from '../api/endpoints';
import { downloadApplicationDocument } from './useApplicationAssistant';

vi.mock('../api/endpoints', () => ({
  applicationsApi: { downloadDocument: vi.fn() },
}));

const mockDownload = vi.mocked(applicationsApi.downloadDocument);

describe('downloadApplicationDocument', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads an OK blob through a temp anchor using the Content-Disposition filename', async () => {
    mockDownload.mockResolvedValue({
      status: 200,
      data: new Blob(['pdf-bytes']),
      headers: { 'content-disposition': 'attachment; filename="cv_wilson.pdf"' },
    } as never);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    await downloadApplicationDocument('app-1', 'cv', 'fallback.pdf');

    expect(mockDownload).toHaveBeenCalledWith('app-1', 'cv');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The helper removes the anchor from the DOM before returning, so capture it via the append spy.
    const added = appendSpy.mock.calls[0][0];
    expect(added).toBeInstanceOf(HTMLAnchorElement);
    const link = added as HTMLAnchorElement;
    expect(link.href).toBe('blob:mock-url');
    expect(link.download).toBe('cv_wilson.pdf');
    expect(removeSpy).toHaveBeenCalledWith(link);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('falls back to the passed name when no Content-Disposition is present', async () => {
    mockDownload.mockResolvedValue({ status: 200, data: new Blob(['pdf']), headers: {} } as never);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await downloadApplicationDocument('app-2', 'cover_letter', 'my-letter.pdf');

    const link = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(link.download).toBe('my-letter.pdf');
  });

  it('throws a friendly error when the response is not an OK blob', async () => {
    mockDownload.mockResolvedValue({ status: 404, data: new Blob(['x']), headers: {} } as never);

    await expect(downloadApplicationDocument('app-3', 'cv')).rejects.toThrow(
      'The document is not available to download right now.'
    );
  });
});