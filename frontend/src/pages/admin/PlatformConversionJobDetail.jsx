import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { conversionService } from '../../services/conversionService';
import { kitabooService } from '../../services/kitabooService';
import { isFixedLayout } from '../../hooks/useConversionActions';
import './PlatformConversions.css';

function jobIdOf(job) {
  return job?.id ?? job?.jobId;
}

function editorPath(job) {
  const id = jobIdOf(job);
  if (id == null || id === '') return '/conversions';
  return isFixedLayout(job) ? `/conversions/fxl-editor/${id}` : `/conversions/image-editor/${id}`;
}

function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function useMergedJob(jobIdStr) {
  const { allJobs, isLoading: listLoading } = useConversionsQuery({ enabled: true });
  const listJob = useMemo(() => {
    if (!jobIdStr) return null;
    return (Array.isArray(allJobs) ? allJobs : []).find(
      (j) => String(jobIdOf(j)) === String(jobIdStr),
    );
  }, [allJobs, jobIdStr]);

  const isFxlFromList = String(listJob?.jobType || '').toUpperCase() === 'FXL';

  const detailQuery = useQuery({
    queryKey: ['admin', 'conversion-job-detail', jobIdStr, isFxlFromList ? 'fxl' : 'reflow'],
    queryFn: async () => {
      const id = Number(jobIdStr);
      if (!Number.isFinite(id)) return { job: null, source: null };

      // FXL / Kitaboo jobs are not rows in conversion_jobs — avoid GET /conversions/:id (404 + noisy logs).
      if (isFxlFromList) {
        try {
          const fxl = await kitabooService.getJob(id);
          if (fxl) return { job: fxl, source: 'FXL' };
        } catch {
          /* 404 / no access */
        }
        return { job: null, source: null };
      }

      const reflow = await conversionService.getConversionJob(id);
      if (reflow) return { job: reflow, source: 'REFLOW' };
      try {
        const fxl = await kitabooService.getJob(id);
        if (fxl) return { job: fxl, source: 'FXL' };
      } catch {
        /* 404 / no access */
      }
      return { job: null, source: null };
    },
    enabled: Boolean(jobIdStr) && !listLoading,
    staleTime: 30 * 1000,
  });

  const merged = useMemo(() => {
    const d = detailQuery.data?.job;
    if (!listJob && !d) return null;
    return { ...(listJob || {}), ...(d || {}) };
  }, [listJob, detailQuery.data]);

  return { merged, listJob, detailQuery, source: detailQuery.data?.source, listLoading };
}

function DetailRow({ label, value }) {
  const v = value == null || value === '' ? '—' : String(value);
  return (
    <div className="pcv-detail-row">
      <span className="pcv-detail-k">{label}</span>
      <span className="pcv-detail-v">{v}</span>
    </div>
  );
}

export default function PlatformConversionJobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { merged, listJob, detailQuery, source, listLoading } = useMergedJob(jobId);

  const err = detailQuery.error?.message;
  const waitingList = listLoading && !listJob;
  const waitingDetail = !listJob && detailQuery.isPending;

  const openEditor = () => {
    if (!merged) return;
    const path = editorPath(merged);
    window.open(path, '_blank', 'noopener,noreferrer');
  };

  if (waitingList || waitingDetail) {
    return (
      <div className="pcv-root">
        <div className="pcv-inner pcv-loading">
          <div className="pcv-spinner" aria-hidden />
          Loading job…
        </div>
      </div>
    );
  }

  if (!merged && !listLoading && !detailQuery.isPending) {
    if (err) {
      return (
        <div className="pcv-root">
          <div className="pcv-inner">
            <div className="pcv-detail-back">
              <Link to="/admin/conversions" className="pcv-detail-back-link">
                <ArrowLeft size={18} aria-hidden />
                Back to conversions
              </Link>
            </div>
            <div className="pcv-err">{err}</div>
          </div>
        </div>
      );
    }
    return (
      <div className="pcv-root">
        <div className="pcv-inner">
          <div className="pcv-detail-back">
            <Link to="/admin/conversions" className="pcv-detail-back-link">
              <ArrowLeft size={18} aria-hidden />
              Back to conversions
            </Link>
          </div>
          <div className="pcv-err">Job not found or you do not have access.</div>
        </div>
      </div>
    );
  }

  const id = jobIdOf(merged);
  const status = String(merged.status || '').toUpperCase();
  const jobType = merged.jobType || source || '—';

  return (
    <div className="pcv-root">
      <div className="pcv-inner">
        <div className="pcv-detail-back">
          <button type="button" className="pcv-detail-back-link" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} aria-hidden />
            Back
          </button>
          <Link to="/admin/conversions" className="pcv-detail-back-link pcv-detail-back-link--muted">
            All conversions
          </Link>
        </div>

        <header className="pcv-detail-head">
          <div>
            <h1 className="pcv-title">Job #{id}</h1>
            <p className="pcv-sub">Platform conversion record — read-only details.</p>
          </div>
          <button type="button" className="pcv-btn-export" onClick={openEditor}>
            <ExternalLink size={16} aria-hidden />
            Open in editor
          </button>
        </header>

        {err ? <div className="pcv-err">{err}</div> : null}

        <section className="pcv-detail-panel" aria-label="Job details">
          <h2 className="pcv-detail-panel-title">Summary</h2>
          <div className="pcv-detail-dl">
            <DetailRow label="Status" value={status} />
            <DetailRow label="Job type" value={jobType} />
            <DetailRow label="PDF file" value={merged.pdfFilename || merged.originalFileName} />
            <DetailRow label="PDF document ID" value={merged.pdfDocumentId ?? merged.pdfId} />
            <DetailRow label="Pages" value={merged.totalPages} />
            <DetailRow label="Organization" value={merged.organizationName} />
            <DetailRow label="User email" value={merged.userEmail} />
            <DetailRow label="User name" value={merged.userName} />
            <DetailRow label="Progress" value={merged.progressPercentage != null ? `${merged.progressPercentage}%` : '—'} />
            <DetailRow label="Current step" value={merged.currentStep} />
            <DetailRow label="Created" value={formatWhen(merged.createdAt)} />
            <DetailRow label="Updated" value={formatWhen(merged.updatedAt)} />
            <DetailRow label="Completed" value={formatWhen(merged.completedAt)} />
            <DetailRow label="Retry count" value={merged.retryCount} />
            <DetailRow label="EPUB path" value={merged.epubFilePath} />
            <DetailRow label="Requires review" value={merged.requiresReview != null ? String(merged.requiresReview) : '—'} />
          </div>
          {merged.errorMessage ? (
            <div className="pcv-detail-error-block">
              <h3 className="pcv-detail-error-title">Error message</h3>
              <pre className="pcv-detail-error-pre">{merged.errorMessage}</pre>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
