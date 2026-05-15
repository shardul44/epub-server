import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileText,
  Play,
  Sparkles,
  Trash2,
  Download,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { queryKeys } from '../lib/queryKeys';
import { usePdfDetailQuery } from '../hooks/queries/usePdfDetailQuery';
import usePdfs from '../hooks/usePdfs';
import ConfirmModal from '../components/Loadingmodal';
import { formatFileSize } from '../components/PdfCard';
import { mediaUrl } from '../utils/mediaUrl';
import { pdfService } from '../services/pdfService';
import './PdfList.css';

export default function PdfDetail() {
  const { pdfId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { deleteMutation } = usePdfs({ autoFetch: false });

  const { data: pdf, isLoading, error, isError } = usePdfDetailQuery(pdfId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const previewSrc = useMemo(
    () => (pdf?.id ? mediaUrl(`/api/pdfs/${pdf.id}/view`) : ''),
    [pdf?.id],
  );

  const isFixed = pdf?.layoutType === 'FIXED_LAYOUT';
  const status = error?.response?.status;
  const forbidden = status === 403;
  const notFound = status === 404;

  const handleConvert = () => {
    if (pdf?.id) navigate(`/chapter-plan/${pdf.id}`);
  };

  const handleHifi = () => {
    if (pdf?.id) navigate('/pdfs', { state: { openHifiForPdfId: pdf.id } });
  };

  const handleDownload = async () => {
    if (!pdf?.id) return;
    setDownloadBusy(true);
    try {
      await pdfService.downloadPdf(pdf.id);
    } catch (e) {
      console.error('[PdfDetail] download failed', e);
    } finally {
      setDownloadBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!pdf?.id) return;
    deleteMutation.mutate(pdf.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        queryClient.removeQueries({ queryKey: queryKeys.pdfs.detail(pdf.id) });
        navigate('/pdfs', { replace: true });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="pld-page">
        <div className="pld-detail-loading">
          <Loader2 size={28} className="pld-detail-spinner" aria-hidden />
          <span>Loading PDF…</span>
        </div>
      </div>
    );
  }

  if (isError || !pdf) {
    return (
      <div className="pld-page">
        <div className="pld-detail-error">
          <AlertTriangle size={32} aria-hidden />
          <h2>{forbidden ? 'Access denied' : notFound ? 'PDF not found' : 'Could not load PDF'}</h2>
          <p>
            {forbidden
              ? 'You can only open PDFs that you uploaded.'
              : notFound
                ? 'This document may have been deleted.'
                : error?.message || 'Please try again.'}
          </p>
          <Link to="/pdfs" className="pld-upload-btn">
            <ArrowLeft size={16} /> Back to PDF Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pld-page">
      <div className="pld-navbar">
        <Link to="/pdfs" className="pld-detail-back">
          <ArrowLeft size={16} />
          PDF Library
        </Link>
      </div>

      <div className="pld-header pld-detail-header">
        <div className="pld-header-left">
          <h1 className="pld-title">{pdf.originalFileName || 'Unnamed PDF'}</h1>
          <p className="pld-subtitle">
            ID #{pdf.id}
            {' · '}
            {pdf.totalPages || 0} pages
            {' · '}
            {formatFileSize(pdf.fileSize)}
            {' · '}
            <span className={`pld-badge ${isFixed ? 'pld-badge-fxl' : 'pld-badge-reflow'}`}>
              {isFixed ? 'FXL' : 'REFLOW'}
            </span>
          </p>
        </div>
        <div className="pld-detail-actions">
          {!isFixed ? (
            <button type="button" className="pld-upload-btn" onClick={handleConvert}>
              <Play size={16} /> Convert
            </button>
          ) : (
            <button type="button" className="pld-upload-btn" onClick={handleHifi}>
              <Sparkles size={16} /> Hi-Fi FXL
            </button>
          )}
          <button
            type="button"
            className="pld-detail-btn pld-detail-btn--ghost"
            onClick={handleDownload}
            disabled={downloadBusy}
          >
            <Download size={16} />
            {downloadBusy ? 'Downloading…' : 'Download'}
          </button>
          <button
            type="button"
            className="pld-detail-btn pld-detail-btn--danger"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </div>

      <div className="pld-detail-viewer">
        <div className="pld-preview-header pld-detail-viewer-bar">
          <FileText size={16} aria-hidden />
          <span>Document preview</span>
        </div>
        <iframe
          className="pld-detail-iframe"
          src={previewSrc}
          title={`Preview: ${pdf.originalFileName}`}
        />
      </div>

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Confirm Deletion"
        subtitle="This action cannot be undone."
        message="Are you sure you want to delete this PDF? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
