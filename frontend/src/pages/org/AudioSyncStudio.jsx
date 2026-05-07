import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useConversions } from '../../hooks/useConversions';
import { mediaUrl } from '../../utils/mediaUrl';
import WorkflowStepper from '../../components/WorkflowStepper';
import {
  ArrowLeft,
  Check,
  Play,
  Pause,
  FileText,
  X,
  Music,
  RefreshCw,
  Plus,
} from 'lucide-react';
import './AudioSyncStudio.css';

/* ─── Mock narration tracks ───────────────────────────────────── */
const mockTracks = (jobId) => [
  { id: `${jobId}-t1`, chapter: 'Chapter 1 — Intro',            voice: 'Aurora', duration: '04:12', status: 'SYNCED' },
  { id: `${jobId}-t2`, chapter: 'Chapter 1 — The path begins',  voice: 'Aurora', duration: '07:48', status: 'SYNCED' },
  { id: `${jobId}-t3`, chapter: 'Chapter 2 — Across the river', voice: '—',      duration: '09:21', status: 'UNSYNCED' },
  { id: `${jobId}-t4`, chapter: 'Chapter 3 — Quiet morning',    voice: '—',      duration: '06:02', status: 'UNSYNCED' },
];

/* ─── Waveform visualization (mock SVG bars) ──────────────────── */
// Bars are stable per-track — computed once, not on every render
const buildBars = () => Array.from({ length: 80 }, () => 20 + Math.random() * 60);

const Waveform = memo(({ synced, playing, bars }) => (
  <svg className="ass-waveform" viewBox="0 0 400 80" preserveAspectRatio="none">
    {bars.map((h, i) => (
      <rect
        key={i}
        x={i * 5}
        y={(80 - h) / 2}
        width="3"
        height={h}
        fill={synced ? (playing ? '#2563eb' : '#60a5fa') : '#d1d5db'}
        opacity={synced ? 0.9 : 0.4}
      />
    ))}
  </svg>
));
Waveform.displayName = 'Waveform';

/* ─── Track row ───────────────────────────────────────────────── */
const TrackRow = memo(({ track, isPlaying, onPlay, onPause, isActive, onClick }) => {
  const synced = track.status === 'SYNCED';
  return (
    <div
      className={`ass-track ${isActive ? 'ass-track--active' : ''} ${synced ? 'ass-track--synced' : 'ass-track--unsynced'}`}
      onClick={onClick}
    >
      <div className="ass-track-left">
        <button
          className="ass-track-play-btn"
          onClick={(e) => { e.stopPropagation(); isPlaying ? onPause() : onPlay(track); }}
          disabled={!synced}
          title={synced ? 'Play' : 'Not synced yet'}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className="ass-track-info">
          <div className="ass-track-title">{track.chapter}</div>
          <div className="ass-track-meta">
            <span>Voice: {track.voice}</span>
            <span>·</span>
            <span>Duration {track.duration}</span>
          </div>
        </div>
      </div>
      <span className={`ass-track-badge ${synced ? 'ass-badge-synced' : 'ass-badge-unsynced'}`}>
        {synced ? '✓ SYNCED' : 'UNSYNCED'}
      </span>
    </div>
  );
});
TrackRow.displayName = 'TrackRow';

/* ─── Job selector ────────────────────────────────────────────── */
const JobSelector = memo(({ jobs, onSelect, loading }) => (
  <div className="ass-selector-root">
    <div className="ass-selector-header">
      <h2 className="ass-selector-title">Audio Sync Studio</h2>
      <p className="ass-selector-sub">Select a completed conversion job to add narration and sync audio</p>
    </div>
    {loading ? (
      <div className="ass-selector-loading"><div className="ass-spinner" /> Loading jobs…</div>
    ) : jobs.length === 0 ? (
      <div className="ass-selector-empty">
        <FileText size={40} />
        <p>No completed jobs available. Complete a conversion first.</p>
      </div>
    ) : (
      <div className="ass-selector-grid">
        {jobs.map(job => {
          const jobId = job.id ?? job.jobId;
          return (
            <button key={jobId} className="ass-job-card" onClick={() => onSelect(job)}>
              <div className="ass-job-card-thumb">
                {/* Lazy-load thumbnails — only load when in viewport */}
                <img
                  src={mediaUrl(`/api/pdfs/${job.pdfDocumentId ?? job.pdfId}/thumbnail`)}
                  alt="PDF"
                  loading="lazy"
                  onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                />
                <div className="ass-job-card-fallback"><FileText size={32} /></div>
              </div>
              <div className="ass-job-card-body">
                <div className="ass-job-card-id">Job #{jobId}</div>
                <div className="ass-job-card-name">{job.pdfFilename || `PDF ${job.pdfDocumentId ?? job.pdfId}`}</div>
                <div className="ass-job-card-meta">
                  <span className="ass-type-pill">Reflow</span>
                  <span className="ass-status-pill">✓ Completed</span>
                </div>
              </div>
              <span className="ass-job-card-open">Open Audio Sync →</span>
            </button>
          );
        })}
      </div>
    )}
  </div>
));
JobSelector.displayName = 'JobSelector';

/* ─── Main component ──────────────────────────────────────────── */
const AudioSyncStudio = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params   = useParams();

  const [selectedJob, setSelectedJob]   = useState(null);
  const [tracks, setTracks]             = useState([]);
  // Stable waveform bars per track — computed once when tracks load
  const [trackBars, setTrackBars]       = useState({});
  const [activeTrack, setActiveTrack]   = useState(null);
  const [playingTrack, setPlayingTrack] = useState(null);
  const [voiceProfile, setVoiceProfile] = useState('Aurora - Female - Warm');
  const [readingSpeed, setReadingSpeed] = useState(1.0);
  const [pitch, setPitch]               = useState(1.0);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [saved, setSaved]               = useState(false);
  const [autoSyncing, setAutoSyncing]   = useState(false);

  // ── Single API call via shared hook — no duplicate fetching ──
  const { jobs: allJobs, loading: jobsLoading, error: jobsError } = useConversions();

  // Propagate fetch error into local error state
  useEffect(() => {
    if (jobsError) setError(jobsError);
  }, [jobsError]);

  // Auto-select from URL state or params once jobs are loaded
  useEffect(() => {
    if (jobsLoading || selectedJob) return;
    const stateJobId = location.state?.jobId ?? params?.jobId;
    if (stateJobId) {
      const found = allJobs.find(j => String(j.id ?? j.jobId) === String(stateJobId));
      if (found) setSelectedJob(found);
    }
  }, [jobsLoading, allJobs, location.state, params?.jobId, selectedJob]);

  // Load tracks when job selected
  useEffect(() => {
    if (!selectedJob) return;
    const jobId = selectedJob.id ?? selectedJob.jobId;
    const newTracks = mockTracks(jobId);
    setTracks(newTracks);
    // Build stable waveform bars once per track
    const bars = {};
    newTracks.forEach(t => { bars[t.id] = buildBars(); });
    setTrackBars(bars);
    setActiveTrack(null);
    setPlayingTrack(null);
  }, [selectedJob]);

  /* ── Stable callbacks — prevent child re-renders ── */
  const handlePlay = useCallback((track) => {
    setPlayingTrack(track.id);
    setActiveTrack(track.id);
  }, []);

  const handlePause = useCallback(() => {
    setPlayingTrack(null);
  }, []);

  const handleSelectJob = useCallback((job) => {
    setSelectedJob(job);
  }, []);

  const handleStepClick = useCallback((step) => {
    navigate(step.path);
  }, [navigate]);

  /* ── Save ── */
  const handleSave = useCallback(async () => {
    if (!selectedJob) return;
    setSaving(true);
    try {
      await new Promise(r => setTimeout(r, 600));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }, [selectedJob]);

  const handleSaveAndContinue = useCallback(async () => {
    await handleSave();
    navigate('/conversions/download', { state: { jobId: selectedJob?.id ?? selectedJob?.jobId } });
  }, [handleSave, navigate, selectedJob]);

  /* ── Auto-sync ── */
  const handleRunAutoSync = useCallback(async () => {
    setAutoSyncing(true);
    try {
      await new Promise(r => setTimeout(r, 1500));
      setTracks(prev => prev.map(t => ({ ...t, status: 'SYNCED', voice: voiceProfile.split(' - ')[0] })));
    } finally {
      setAutoSyncing(false);
    }
  }, [voiceProfile]);

  /* ── Preview voice ── */
  const handlePreview = useCallback(() => {
    alert(`Preview: ${voiceProfile} at ${readingSpeed}x speed, pitch ${pitch}`);
  }, [voiceProfile, readingSpeed, pitch]);

  /* ── If no job selected yet, show selector ── */
  if (!selectedJob) {
    return (
      <div className="ass-root">
        <div className="ass-topbar">
          <button className="ass-back-btn" onClick={() => navigate('/conversions/fxl-editor')}>
            <ArrowLeft size={15} /> Back
          </button>
          <h1 className="ass-topbar-title">Audio Sync Studio</h1>
        </div>
        <WorkflowStepper activeStep={2} jobId={null} onStepClick={handleStepClick} variant="ass" />
        <JobSelector jobs={allJobs} onSelect={handleSelectJob} loading={jobsLoading} />
      </div>
    );
  }

  const jobId = selectedJob.id ?? selectedJob.jobId;
  const syncedCount = tracks.filter(t => t.status === 'SYNCED').length;

  return (
    <div className="ass-root ass-root--studio">

      {/* ── Top bar ── */}
      <div className="ass-topbar">
        <div className="ass-topbar-left">
          <button className="ass-back-btn" onClick={() => navigate('/conversions/fxl-editor')}>
            <ArrowLeft size={15} /> Editor
          </button>
          <h1 className="ass-topbar-title">Audio Sync Studio</h1>
          <span className="ass-job-chip">Job #{jobId}</span>
        </div>
        <div className="ass-topbar-right">
          {saved && <span className="ass-saved-toast">✓ Saved</span>}
          <button className="ass-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? <><div className="ass-btn-spinner" /> Saving…</> : <><Check size={15} /> Save &amp; continue</>}
          </button>
        </div>
      </div>

      {/* ── Stepper ── */}
      <WorkflowStepper activeStep={2} jobId={jobId} onStepClick={handleStepClick} variant="ass" />

      {error && (
        <div className="ass-error-bar">
          {error}
          <button onClick={() => setError('')}><X size={13} /></button>
        </div>
      )}

      {/* ── Studio layout ── */}
      <div className="ass-studio">

        {/* LEFT: narration tracks list */}
        <aside className="ass-tracks-panel">
          <div className="ass-tracks-header">
            <span className="ass-tracks-title">Narration tracks</span>
            <span className="ass-tracks-count">{syncedCount} of {tracks.length} synced</span>
            <span className="ass-tracks-total">Total: 27:23</span>
          </div>
          <button className="ass-add-track-btn">
            <Plus size={14} /> Add track
          </button>
          <div className="ass-tracks-list">
            {tracks.map(track => (
              <TrackRow
                key={track.id}
                track={track}
                isPlaying={playingTrack === track.id}
                onPlay={handlePlay}
                onPause={handlePause}
                isActive={activeTrack === track.id}
                onClick={() => setActiveTrack(track.id)}
              />
            ))}
          </div>
        </aside>

        {/* CENTER: waveforms */}
        <main className="ass-waveforms-area">
          <div className="ass-waveforms-scroll">
            {tracks.map(track => (
              <div key={track.id} className="ass-waveform-row">
                <Waveform
                  synced={track.status === 'SYNCED'}
                  playing={playingTrack === track.id}
                  bars={trackBars[track.id] ?? []}
                />
              </div>
            ))}
          </div>
        </main>

        {/* RIGHT: voice & TTS settings */}
        <aside className="ass-settings-panel">
          <div className="ass-settings-section">
            <div className="ass-settings-label">VOICE & TTS</div>

            <div className="ass-field">
              <label className="ass-field-label">VOICE PROFILE</label>
              <select
                className="ass-select"
                value={voiceProfile}
                onChange={e => setVoiceProfile(e.target.value)}
              >
                <option>Aurora - Female - Warm</option>
                <option>Marcus - Male - Deep</option>
                <option>Luna - Female - Soft</option>
                <option>Atlas - Male - Strong</option>
              </select>
            </div>

            <div className="ass-field">
              <label className="ass-field-label">READING SPEED</label>
              <div className="ass-slider-row">
                <span className="ass-slider-val">0.7x</span>
                <input
                  type="range"
                  className="ass-slider"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={readingSpeed}
                  onChange={e => setReadingSpeed(parseFloat(e.target.value))}
                />
                <span className="ass-slider-val">1.0x</span>
                <span className="ass-slider-val">1.5x</span>
              </div>
            </div>

            <div className="ass-field">
              <label className="ass-field-label">PITCH</label>
              <div className="ass-slider-row">
                <span className="ass-slider-val">Low</span>
                <input
                  type="range"
                  className="ass-slider"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={pitch}
                  onChange={e => setPitch(parseFloat(e.target.value))}
                />
                <span className="ass-slider-val">High</span>
              </div>
            </div>

            <button className="ass-preview-btn" onClick={handlePreview}>
              <Play size={14} /> Play sample
            </button>
          </div>

          <div className="ass-settings-section">
            <div className="ass-settings-label">
              <RefreshCw size={14} /> Auto-sync
            </div>
            <p className="ass-settings-desc">
              Auto-align narration to the EPUB text using AI. Recommended for chapters.
            </p>
            <button
              className="ass-auto-sync-btn"
              onClick={handleRunAutoSync}
              disabled={autoSyncing}
            >
              {autoSyncing ? <><div className="ass-btn-spinner" /> Running…</> : <><RefreshCw size={14} /> Run auto-sync</>}
            </button>
          </div>

          <button
            className="ass-continue-btn"
            onClick={handleSaveAndContinue}
            disabled={saving}
          >
            Continue to Download
          </button>
        </aside>

      </div>
    </div>
  );
};

export default AudioSyncStudio;
