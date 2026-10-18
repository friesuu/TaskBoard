import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Attachments from './Attachments';
import { getAttachments, uploadAttachment, deleteAttachment, attachmentDownloadUrl } from '../api';

vi.mock('../api');

const saved = [
  { id: 1, fileName: 'plan.pdf', mimeType: 'application/pdf', size: 14540, taskId: 5 },
];

function renderFiles(onSessionEnded = vi.fn(() => false)) {
  render(<Attachments taskId={5} onSessionEnded={onSessionEnded} />);
  return onSessionEnded;
}

describe('Attachments', () => {
  beforeEach(() => {
    vi.mocked(getAttachments).mockReset().mockResolvedValue(saved);
    vi.mocked(uploadAttachment).mockReset();
    vi.mocked(deleteAttachment).mockReset().mockResolvedValue(undefined);
    vi.mocked(attachmentDownloadUrl).mockReset().mockImplementation((id) => `http://api.test/api/attachments/${id}/download`);
  });

  it("lists the task's files with their type and size, as download links", async () => {
    renderFiles();

    const link = await screen.findByRole('link', { name: 'plan.pdf' });
    expect(link).toHaveAttribute('href', 'http://api.test/api/attachments/1/download');
    expect(screen.getByText('PDF · 14.2 KB')).toBeInTheDocument();
    expect(getAttachments).toHaveBeenCalledWith(5);
  });

  it('says so when there are no files yet', async () => {
    vi.mocked(getAttachments).mockResolvedValue([]);
    renderFiles();

    expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
  });

  it('uploads a chosen file and adds it to the list', async () => {
    vi.mocked(uploadAttachment).mockResolvedValue({ id: 2, fileName: 'photo.png', mimeType: 'image/png', size: 2048, taskId: 5 });
    renderFiles();
    await screen.findByText('plan.pdf');

    const photo = new File(['png bytes'], 'photo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Choose a file to attach'), photo);

    expect(uploadAttachment).toHaveBeenCalledWith(5, photo);
    expect(await screen.findByRole('link', { name: 'photo.png' })).toBeInTheDocument();
  });

  it("doesn't send a file type that isn't allowed, and says why", async () => {
    renderFiles();
    await screen.findByText('plan.pdf');

    // applyAccept: false lets the test pick a type the file picker wouldn't offer
    await userEvent.setup({ applyAccept: false }).upload(
      screen.getByLabelText('Choose a file to attach'),
      new File(['<svg/>'], 'drawing.svg', { type: 'image/svg+xml' }),
    );

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(screen.getByText(/can't be attached/)).toBeInTheDocument();
  });

  it("shows the server's message when the upload is refused", async () => {
    vi.mocked(uploadAttachment).mockRejectedValue(new Error("The file's contents don't match its .png extension"));
    renderFiles();
    await screen.findByText('plan.pdf');

    await userEvent.upload(screen.getByLabelText('Choose a file to attach'), new File(['x'], 'fake.png'));

    expect(await screen.findByText("The file's contents don't match its .png extension")).toBeInTheDocument();
  });

  it('deletes a file after you confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderFiles();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete "plan.pdf"' }));

    expect(deleteAttachment).toHaveBeenCalledWith(1);
    expect(screen.queryByText('plan.pdf')).not.toBeInTheDocument();
  });

  it('hands an expired login to App', async () => {
    const expired = Object.assign(new Error('Unauthorized'), { code: 'UNAUTHENTICATED' });
    vi.mocked(uploadAttachment).mockRejectedValue(expired);
    const onSessionEnded = renderFiles(vi.fn((err) => err.code === 'UNAUTHENTICATED'));
    await screen.findByText('plan.pdf');

    await userEvent.upload(screen.getByLabelText('Choose a file to attach'), new File(['x'], 'photo.png'));

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledWith(expired));
    expect(screen.queryByText('Unauthorized')).not.toBeInTheDocument();
  });
});
