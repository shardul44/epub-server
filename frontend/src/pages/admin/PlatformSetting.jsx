import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService } from '../../services/adminService';
import './PlatformSetting.css';

export default function PlatformSetting() {
  const queryClient = useQueryClient();
  const [bannerErr, setBannerErr] = useState('');
  const [bannerOk, setBannerOk] = useState('');

  const [platformName, setPlatformName] = useState('');
  const [defaultPlanId, setDefaultPlanId] = useState('');
  const [maxUploadMb, setMaxUploadMb] = useState('100');
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState('60');

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpFromEmail, setSmtpFromEmail] = useState('');
  const [smtpAdminAlertEmail, setSmtpAdminAlertEmail] = useState('');

  const settingsQuery = useQuery({
    queryKey: ['admin', 'platform-settings'],
    queryFn: () => adminService.getPlatformSettings(),
    staleTime: 30 * 1000,
  });

  const data = settingsQuery.data;

  useEffect(() => {
    if (!data) return;
    setPlatformName(data.platformName ?? '');
    setDefaultPlanId(data.defaultPlanId != null ? String(data.defaultPlanId) : '');
    setMaxUploadMb(String(data.maxUploadMb ?? 100));
    setSessionTimeoutMinutes(String(data.sessionTimeoutMinutes ?? 60));
    setSmtpHost(data.smtpHost ?? '');
    setSmtpPort(String(data.smtpPort ?? 587));
    setSmtpFromEmail(data.smtpFromEmail ?? '');
    setSmtpAdminAlertEmail(data.smtpAdminAlertEmail ?? '');
  }, [data]);

  const generalMutation = useMutation({
    mutationFn: (body) => adminService.updatePlatformSettingsGeneral(body),
    onSuccess: (payload) => {
      queryClient.setQueryData(['admin', 'platform-settings'], payload);
      setBannerErr('');
      setBannerOk('General settings saved.');
      window.setTimeout(() => setBannerOk(''), 4000);
    },
    onError: (e) => {
      setBannerOk('');
      setBannerErr(e.response?.data?.error || e.message || 'Save failed');
    },
  });

  const emailMutation = useMutation({
    mutationFn: (body) => adminService.updatePlatformSettingsEmail(body),
    onSuccess: (payload) => {
      queryClient.setQueryData(['admin', 'platform-settings'], payload);
      setBannerErr('');
      setBannerOk('Email settings saved.');
      window.setTimeout(() => setBannerOk(''), 4000);
    },
    onError: (e) => {
      setBannerOk('');
      setBannerErr(e.response?.data?.error || e.message || 'Save failed');
    },
  });

  const plans = Array.isArray(data?.plans) ? data.plans : [];

  const saveGeneral = (e) => {
    e.preventDefault();
    setBannerErr('');
    setBannerOk('');
    generalMutation.mutate({
      platformName: platformName.trim(),
      defaultPlanId: defaultPlanId === '' ? null : parseInt(defaultPlanId, 10),
      maxUploadMb: parseInt(maxUploadMb, 10),
      sessionTimeoutMinutes: parseInt(sessionTimeoutMinutes, 10),
    });
  };

  const saveEmail = (e) => {
    e.preventDefault();
    setBannerErr('');
    setBannerOk('');
    emailMutation.mutate({
      smtpHost: smtpHost.trim(),
      smtpPort: parseInt(smtpPort, 10) || 587,
      smtpFromEmail: smtpFromEmail.trim(),
      smtpAdminAlertEmail: smtpAdminAlertEmail.trim(),
    });
  };

  if (settingsQuery.isLoading) {
    return (
      <div className="pst-root">
        <div className="pst-inner pst-loading">
          <div className="pst-spinner" aria-hidden />
          Loading settings…
        </div>
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <div className="pst-root">
        <div className="pst-inner">
          <div className="pst-err">{settingsQuery.error?.message || 'Failed to load settings.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pst-root">
      <div className="pst-inner">
        <header className="pst-head">
          <h1 className="pst-title">Settings</h1>
          <p className="pst-sub">Configure platform-wide parameters and defaults.</p>
        </header>

        {bannerErr ? <div className="pst-err">{bannerErr}</div> : null}
        {bannerOk ? <div className="pst-ok">{bannerOk}</div> : null}

        <div className="pst-grid">
          <form className="pst-card" onSubmit={saveGeneral}>
            <h2 className="pst-card-title">General settings</h2>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-platform-name">
                Platform name
              </label>
              <input
                id="pst-platform-name"
                className="pst-input"
                value={platformName}
                onChange={(e) => setPlatformName(e.target.value)}
                autoComplete="organization"
              />
            </div>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-default-plan">
                Default plan for new orgs
              </label>
              <select
                id="pst-default-plan"
                className="pst-select"
                value={defaultPlanId}
                onChange={(e) => setDefaultPlanId(e.target.value)}
              >
                <option value="">None</option>
                {plans.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-max-upload">
                Max upload file size (MB)
              </label>
              <input
                id="pst-max-upload"
                className="pst-input"
                type="number"
                min={1}
                max={2048}
                value={maxUploadMb}
                onChange={(e) => setMaxUploadMb(e.target.value)}
              />
            </div>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-session">
                Session timeout (minutes)
              </label>
              <input
                id="pst-session"
                className="pst-input"
                type="number"
                min={5}
                max={43200}
                value={sessionTimeoutMinutes}
                onChange={(e) => setSessionTimeoutMinutes(e.target.value)}
              />
            </div>

            <div className="pst-actions">
              <button type="submit" className="pst-btn" disabled={generalMutation.isPending}>
                {generalMutation.isPending ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>

          <form className="pst-card" onSubmit={saveEmail}>
            <h2 className="pst-card-title">Email &amp; notifications</h2>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-smtp-host">
                SMTP host
              </label>
              <input
                id="pst-smtp-host"
                className="pst-input"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
              />
            </div>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-smtp-port">
                SMTP port
              </label>
              <input
                id="pst-smtp-port"
                className="pst-input"
                type="number"
                min={1}
                max={65535}
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-from-email">
                From email
              </label>
              <input
                id="pst-from-email"
                className="pst-input"
                type="email"
                value={smtpFromEmail}
                onChange={(e) => setSmtpFromEmail(e.target.value)}
                placeholder="no-reply@example.com"
                autoComplete="off"
              />
            </div>

            <div className="pst-field">
              <label className="pst-label" htmlFor="pst-admin-alert">
                Admin alert email
              </label>
              <input
                id="pst-admin-alert"
                className="pst-input"
                type="email"
                value={smtpAdminAlertEmail}
                onChange={(e) => setSmtpAdminAlertEmail(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="off"
              />
            </div>

            <div className="pst-actions">
              <button type="submit" className="pst-btn" disabled={emailMutation.isPending}>
                {emailMutation.isPending ? 'Saving…' : 'Save email config'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
