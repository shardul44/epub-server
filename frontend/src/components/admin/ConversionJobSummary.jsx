import { formatConversionWhen } from '../../hooks/useMergedConversionJob';

function DetailRow({ label, value }) {
  const v = value == null || value === '' ? '—' : String(value);
  return (
    <div className="pcv-detail-row">
      <span className="pcv-detail-k">{label}</span>
      <span className="pcv-detail-v">{v}</span>
    </div>
  );
}

/**
 * Read-only summary grid shared by job detail page and summary modal.
 */
export default function ConversionJobSummary({ merged, source, fetchError }) {
  if (!merged) return null;

  const status = String(merged.status || '').toUpperCase();
  const jobType = merged.jobType || source || '—';

  return (
    <>
      {fetchError ? <div className="pcv-err">{fetchError}</div> : null}
      <div className="pcv-detail-dl">
        <DetailRow label="Status" value={status} />
        <DetailRow label="Job type" value={jobType} />
        <DetailRow label="PDF file" value={merged.pdfFilename || merged.originalFileName} />
        <DetailRow label="PDF document ID" value={merged.pdfDocumentId ?? merged.pdfId} />
        <DetailRow label="Pages" value={merged.totalPages} />
        <DetailRow label="Organization" value={merged.organizationName} />
        <DetailRow label="User email" value={merged.userEmail} />
        <DetailRow label="User name" value={merged.userName} />
        <DetailRow
          label="Progress"
          value={merged.progressPercentage != null ? `${merged.progressPercentage}%` : '—'}
        />
        <DetailRow label="Current step" value={merged.currentStep} />
        <DetailRow label="Created" value={formatConversionWhen(merged.createdAt)} />
        <DetailRow label="Updated" value={formatConversionWhen(merged.updatedAt)} />
        <DetailRow label="Completed" value={formatConversionWhen(merged.completedAt)} />
        <DetailRow label="Retry count" value={merged.retryCount} />
        <DetailRow label="EPUB path" value={merged.epubFilePath} />
        <DetailRow
          label="Requires review"
          value={merged.requiresReview != null ? String(merged.requiresReview) : '—'}
        />
      </div>
      {merged.errorMessage ? (
        <div className="pcv-detail-error-block">
          <h3 className="pcv-detail-error-title">Error message</h3>
          <pre className="pcv-detail-error-pre">{merged.errorMessage}</pre>
        </div>
      ) : null}
    </>
  );
}

export { DetailRow };
