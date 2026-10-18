import { useEffect, useRef, useState } from 'react';
import { getAttachments, uploadAttachment, deleteAttachment, attachmentDownloadUrl } from '../api';
import { ACCEPT, fileKind, formatBytes, problemWithFile } from '../files';
import { DownloadIcon, FileIcon, PaperclipIcon } from './Icons';
import TrashIcon from './TrashIcon';

// The "Files" part of the task panel: attach, list, download and delete files.
// Like Checklist and Comments, it loads and saves its own data.
// onCountChange(count): after an upload or delete, so App can update the 📎 count on the card.
// compact: the smaller version that opens on a card (attach and download only; no heading, no delete).
function Attachments({ taskId, onSessionEnded, onCountChange = () => {}, compact = false })
{
    const [files, setFiles] = useState(null); // null = still loading
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        let isStale = false; // ignore an answer for a task that's no longer open
        getAttachments(taskId)
            .then((list) => { if (!isStale) setFiles(list); })
            .catch((err) => { if (!onSessionEnded(err)) setError(err.message); });
        return () => { isStale = true; };
    }, [taskId, onSessionEnded]);

    // A file was chosen in the browser's file picker
    const handleChosen = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // so picking the same file again still counts as a choice
        if (!file) return;

        const problem = problemWithFile(file); // quick check first: don't send 10 MB just to be told no
        if (problem)
        {
            setError(problem);
            return;
        }

        setError(null);
        setIsUploading(true);
        try
        {
            const uploaded = await uploadAttachment(taskId, file);
            setFiles((prev) => [...prev, uploaded]);
            onCountChange(files.length + 1);
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message);
        }
        finally
        {
            setIsUploading(false);
        }
    };

    const handleDelete = async (file) => {
        if (!window.confirm(`Delete "${file.fileName}"?`)) return;
        setError(null);
        try
        {
            await deleteAttachment(file.id);
            setFiles((prev) => prev.filter((f) => f.id !== file.id));
            onCountChange(files.length - 1);
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message);
        }
    };

    return(
        <section className={compact ? 'attachments-compact' : 'details-section'} aria-label="Files">
            <div className="details-section-header">
                {!compact && <h3 className="details-heading">Files</h3>}
                {!compact && files?.length > 0 && <span className="pill pill-count">{files.length}</span>}
                {/* A real button opens the hidden file picker (so it's styled like our buttons and works by keyboard) */}
                <button
                    className="btn btn-secondary details-edit"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || files === null}
                >
                    <PaperclipIcon size={16} />
                    {isUploading ? 'Uploading…' : 'Attach file'}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT}
                    onChange={handleChosen}
                    hidden
                    aria-label="Choose a file to attach"
                />
            </div>

            {error && <p className="error-message">{error}</p>}
            {files === null && !error && <p className="details-empty">Loading…</p>}
            {files?.length === 0 && (
                <p className="details-empty">
                    {compact
                        ? 'No files yet.'
                        : 'No files yet. Images, PDF, text, CSV, Word, Excel, PowerPoint or ZIP, up to 10 MB.'}
                </p>
            )}

            {files?.length > 0 && (
                <ul className={compact ? 'attachment-list' : 'list attachment-list'}>
                    {files.map((f) => (
                        <li key={f.id} className="attachment">
                            <span className="attachment-icon" aria-hidden="true"><FileIcon size={16} /></span>
                            <div className="attachment-info">
                                {/* A plain link: the server sends the file as a download */}
                                <a className="attachment-name" href={attachmentDownloadUrl(f.id)} download={f.fileName}>
                                    {f.fileName}
                                </a>
                                <span className="attachment-meta">{fileKind(f.fileName)} · {formatBytes(f.size)}</span>
                            </div>
                            <a
                                className="icon-btn"
                                href={attachmentDownloadUrl(f.id)}
                                download={f.fileName}
                                aria-label={`Download "${f.fileName}"`}
                            >
                                <DownloadIcon />
                            </a>
                            {!compact && (
                                <button
                                    className="icon-btn icon-btn-danger"
                                    onClick={() => handleDelete(f)}
                                    aria-label={`Delete "${f.fileName}"`}
                                >
                                    <TrashIcon />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export default Attachments;
