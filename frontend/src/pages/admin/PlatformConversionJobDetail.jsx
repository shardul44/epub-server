import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useMergedConversionJob, jobIdOf } from '../../hooks/useMergedConversionJob';
import ConversionJobSummary from '../../components/admin/ConversionJobSummary';
import './PlatformConversions.css';

export default function PlatformConversionJobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { merged, listJob, detailQuery, source, listLoading } = useMergedConversionJob(jobId);

  const err = detailQuery.error?.message;
  const waitingList = listLoading && !listJob;
  const waitingDetail = !listJob && detailQuery.isPending;

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
    return (
      <div className="pcv-root">
        <div className="pcv-inner">
          <div className="pcv-detail-back">
            <Link to="/admin/conversions" className="pcv-detail-back-link">
              <ArrowLeft size={18} aria-hidden />
              Back to conversions
            </Link>
          </div>
          <div className="pcv-err">{err || 'Job not found or you do not have access.'}</div>
        </div>
      </div>
    );
  }

  const id = jobIdOf(merged);

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
        </header>

        <section className="pcv-detail-panel" aria-label="Job details">
          <h2 className="pcv-detail-panel-title">Summary</h2>
          <ConversionJobSummary merged={merged} source={source} fetchError={err} />
        </section>
      </div>
    </div>
  );
}
