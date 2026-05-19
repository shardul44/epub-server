import { useEffect, useState } from 'react';
import { aiConfigService } from '../services/aiConfigService';
import {
  Zap,
  Settings,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Cpu,
  KeyRound,
  MessageSquare,
  Wifi,
} from 'lucide-react';
import './AiConfig.css';

/* ── helpers ─────────────────────────────────────────────────── */
const isMasked = (key) => key && (key.includes('****') || key.length < 20);

const fmtDate = (d) => {
  if (!d) return null;
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

/* ── sub-components ──────────────────────────────────────────── */
const StatusBadge = ({ enabled }) => (
  <span className={`aic-badge ${enabled ? 'aic-badge--on' : 'aic-badge--off'}`}>
    <span className="aic-badge-dot" />
    {enabled ? 'Active' : 'Inactive'}
  </span>
);

const Alert = ({ type, children, onDismiss }) => (
  <div className={`aic-alert aic-alert--${type}`} role="alert">
    <span className="aic-alert-icon">
      {type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
    </span>
    <span className="aic-alert-msg">{children}</span>
    {onDismiss && (
      <button className="aic-alert-close" onClick={onDismiss} aria-label="Dismiss">×</button>
    )}
  </div>
);

const Skeleton = ({ w = '100%', h = 16, radius = 6 }) => (
  <div className="aic-skel" style={{ width: w, height: h, borderRadius: radius }} />
);

/* ── AiConfig page ───────────────────────────────────────────── */
const AiConfig = ({ embedded = false }) => {
  const [config, setConfig] = useState({
    id: null,
    apiKey: '',
    modelName: 'gemini-2.5-flash',
    isActive: true,
    description: '',
    updatedAt: null,
  });
  const [originalApiKey, setOriginalApiKey] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [aiStatus, setAiStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testDetails, setTestDetails] = useState(null);

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    setError('');
    try {
      const settled = await Promise.allSettled([
        aiConfigService.getCurrentConfig(),
        aiConfigService.getAvailableModels(),
        aiConfigService.getStatus(),
      ]);

      const [cfgRes, modelsRes, statusRes] = settled;
      const errs = [];

      if (cfgRes.status === 'fulfilled') {
        const currentConfig = cfgRes.value;
        if (currentConfig) {
          const masked = isMasked(currentConfig.apiKey);
          setConfig({
            id:          currentConfig.id ?? null,
            apiKey:      masked ? '' : (currentConfig.apiKey ?? ''),
            modelName:   currentConfig.modelName ?? 'gemini-2.5-flash',
            isActive:    currentConfig.isActive !== undefined ? currentConfig.isActive : true,
            description: currentConfig.description ?? '',
            updatedAt:   currentConfig.updatedAt ?? null,
          });
          setOriginalApiKey(masked ? currentConfig.apiKey : '');
        }
      } else {
        const e = cfgRes.reason;
        errs.push(e?.response?.data?.error || e?.message || 'Could not load saved configuration.');
      }

      if (modelsRes.status === 'fulfilled') {
        setAvailableModels(Array.isArray(modelsRes.value) ? modelsRes.value : []);
      } else {
        errs.push(
          modelsRes.reason?.response?.data?.error ||
            modelsRes.reason?.message ||
            'Could not load model list.'
        );
        setAvailableModels([]);
      }

      if (statusRes.status === 'fulfilled') {
        setAiStatus(statusRes.value ?? {});
      } else {
        errs.push(
          statusRes.reason?.response?.data?.error ||
            statusRes.reason?.message ||
            'Could not load AI status.'
        );
        setAiStatus({});
      }

      if (errs.length) setError(errs.filter(Boolean).join(' '));
    } catch (err) {
      console.error('[AiConfig] load error:', err);
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Failed to load configuration. Please refresh and try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    setTestDetails(null);

    try {
      const payload = {
        id:          config.id,
        modelName:   config.modelName,
        isActive:    config.isActive,
        description: config.description,
      };

      // Only send apiKey if the user typed a new one
      const newKey = config.apiKey?.trim();
      if (newKey && !isMasked(newKey) && newKey !== originalApiKey) {
        payload.apiKey = newKey;
      }

      await aiConfigService.saveConfig(payload);
      setSuccess('Configuration saved successfully.');
      await loadConfig();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setError('');
    setSuccess('');
    setTestDetails(null);

    const keyToTest = config.apiKey?.trim();
    if (!keyToTest && !originalApiKey) {
      setError('Enter an API key before testing the connection.');
      return;
    }
    if (keyToTest && isMasked(keyToTest)) {
      setError('Enter a valid (unmasked) API key to test.');
      return;
    }
    if (!keyToTest && originalApiKey) {
      setError('Enter a new API key to test (the saved key is masked for security).');
      return;
    }

    setTesting(true);
    try {
      const result = await aiConfigService.testConnection(keyToTest, config.modelName);
      setSuccess(result?.summary || 'Connection test successful!');
      if (result?.details) setTestDetails(result.details);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  };

  /* ── render ── */
  return (
    <div className={`aic-root${embedded ? ' aic-root--embedded' : ''}`}>

      {/* ── Page header (hidden when embedded in platform admin Settings) ── */}
      {!embedded && (
      <header className="aic-page-header">
        <div className="aic-page-header-left">
          <span className="aic-page-icon">
            <Zap size={20} />
          </span>
          <div>
            <h1 className="aic-page-title">AI Configuration</h1>
            <p className="aic-page-sub">Manage your Gemini API key, model selection, and connection settings</p>
          </div>
        </div>
        <button
          className="aic-refresh-btn"
          onClick={loadConfig}
          disabled={loading}
          aria-label="Reload configuration"
          title="Reload"
        >
          <RefreshCw size={16} className={loading ? 'aic-spin' : ''} />
        </button>
      </header>
      )}

      {embedded && (
        <div className="aic-embedded-toolbar">
          <button
            type="button"
            className="aic-refresh-btn"
            onClick={loadConfig}
            disabled={loading}
            aria-label="Reload configuration"
            title="Reload"
          >
            <RefreshCw size={16} className={loading ? 'aic-spin' : ''} />
          </button>
        </div>
      )}

      {/* ── Alerts ── */}
      {error   && <Alert type="error"   onDismiss={() => setError('')}>{error}</Alert>}
      {success && <Alert type="success" onDismiss={() => setSuccess('')}>{success}</Alert>}

      {/* ── Status bar ── */}
      <div className="aic-status-bar">
        <div className="aic-status-item">
          <Wifi size={15} className="aic-status-icon" />
          <span className="aic-status-label">Status</span>
          {loading ? <Skeleton w={60} h={22} radius={20} /> : <StatusBadge enabled={aiStatus.enabled} />}
        </div>
        {aiStatus.model && (
          <div className="aic-status-item">
            <Cpu size={15} className="aic-status-icon" />
            <span className="aic-status-label">Active model</span>
            <span className="aic-status-value">{aiStatus.model}</span>
          </div>
        )}
        {config.updatedAt && (
          <div className="aic-status-item aic-status-item--right">
            <span className="aic-status-label">Last saved</span>
            <span className="aic-status-value">{fmtDate(config.updatedAt)}</span>
          </div>
        )}
      </div>

      {/* ── Test result details ── */}
      {testDetails && (
        <div className="aic-test-result">
          <div className="aic-test-result-header">
            <CheckCircle size={16} />
            Connection verified
          </div>
          <div className="aic-test-result-grid">
            <div className="aic-test-cell">
              <span className="aic-test-cell-label">Status</span>
              <span className="aic-test-cell-value aic-test-cell-value--green">
                {testDetails.status === 'connected' ? '✓ Connected' : testDetails.status}
              </span>
            </div>
            <div className="aic-test-cell">
              <span className="aic-test-cell-label">Model</span>
              <span className="aic-test-cell-value">{testDetails.model}</span>
            </div>
            <div className="aic-test-cell">
              <span className="aic-test-cell-label">API key</span>
              <span className="aic-test-cell-value aic-mono">{testDetails.apiKey}</span>
            </div>
            <div className="aic-test-cell">
              <span className="aic-test-cell-label">Response time</span>
              <span className="aic-test-cell-value aic-test-cell-value--green">{testDetails.responseTime}</span>
            </div>
            <div className="aic-test-cell">
              <span className="aic-test-cell-label">Response received</span>
              <span className="aic-test-cell-value aic-test-cell-value--green">✓ {testDetails.responseReceived}</span>
            </div>
            <div className="aic-test-cell">
              <span className="aic-test-cell-label">Tested at</span>
              <span className="aic-test-cell-value">{fmtDate(testDetails.timestamp)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Main form card ── */}
      <div className="aic-card">
        <div className="aic-card-header">
          <Settings size={16} />
          <span>Configuration settings</span>
        </div>

        {loading ? (
          <div className="aic-form-skeleton">
            <Skeleton w="30%" h={13} />
            <Skeleton w="100%" h={42} />
            <Skeleton w="30%" h={13} />
            <Skeleton w="100%" h={42} />
            <Skeleton w="30%" h={13} />
            <Skeleton w="100%" h={80} />
          </div>
        ) : (
          <form onSubmit={handleSave} noValidate>

            {/* API Key */}
            <div className="aic-field">
              <label className="aic-label" htmlFor="aic-api-key">
                <KeyRound size={13} />
                API Key
                {!originalApiKey && <span className="aic-required">*</span>}
              </label>

              {originalApiKey && (
                <div className="aic-saved-notice">
                  <CheckCircle size={13} />
                  API key is saved — enter a new one only to replace it
                  <span className="aic-saved-masked">{originalApiKey}</span>
                </div>
              )}

              <div className="aic-input-wrap">
                <input
                  id="aic-api-key"
                  className="aic-input"
                  type={showKey ? 'text' : 'password'}
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder={
                    originalApiKey
                      ? 'Enter new key to replace, or leave blank to keep current'
                      : 'Enter your Gemini API key'
                  }
                  required={!originalApiKey}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="aic-input-toggle"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="aic-hint">
                Get your key at{' '}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                  aistudio.google.com
                </a>
              </p>
            </div>

            {/* Model */}
            <div className="aic-field">
              <label className="aic-label" htmlFor="aic-model">
                <Cpu size={13} />
                Model
                <span className="aic-required">*</span>
              </label>
              <select
                id="aic-model"
                className="aic-select"
                value={config.modelName}
                onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                required
              >
                {availableModels.length === 0 ? (
                  <option value={config.modelName}>{config.modelName}</option>
                ) : (
                  availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))
                )}
              </select>
            </div>

            {/* Description */}
            <div className="aic-field">
              <label className="aic-label" htmlFor="aic-desc">
                <MessageSquare size={13} />
                Description
                <span className="aic-optional">(optional)</span>
              </label>
              <textarea
                id="aic-desc"
                className="aic-textarea"
                rows={3}
                value={config.description}
                onChange={(e) => setConfig({ ...config, description: e.target.value })}
                placeholder="Add a note about this configuration…"
              />
            </div>

            {/* Active toggle */}
            <div className="aic-field aic-field--inline">
              <label className="aic-toggle-label" htmlFor="aic-active">
                <div className={`aic-toggle ${config.isActive ? 'aic-toggle--on' : ''}`}>
                  <input
                    id="aic-active"
                    type="checkbox"
                    className="aic-toggle-input"
                    checked={config.isActive}
                    onChange={(e) => setConfig({ ...config, isActive: e.target.checked })}
                  />
                  <span className="aic-toggle-thumb" />
                </div>
                <span className="aic-toggle-text">
                  {config.isActive ? 'Configuration active' : 'Configuration inactive'}
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="aic-actions">
              <button
                type="submit"
                className="aic-btn aic-btn--primary"
                disabled={saving}
              >
                {saving ? (
                  <><RefreshCw size={14} className="aic-spin" /> Saving…</>
                ) : (
                  <><Settings size={14} /> Save configuration</>
                )}
              </button>
              <button
                type="button"
                className="aic-btn aic-btn--secondary"
                onClick={handleTest}
                disabled={testing || saving}
              >
                {testing ? (
                  <><RefreshCw size={14} className="aic-spin" /> Testing…</>
                ) : (
                  <><Zap size={14} /> Test connection</>
                )}
              </button>
            </div>

          </form>
        )}
      </div>
    </div>
  );
};

export default AiConfig;
