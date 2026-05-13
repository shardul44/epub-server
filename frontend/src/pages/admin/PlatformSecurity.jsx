import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Key, Plus } from 'lucide-react';
import { adminService } from '../../services/adminService';
import './PlatformSecurity.css';

const SECURITY_QUERY_KEY = ['admin', 'security', 'overview'];

function permClass(level) {
  if (level === 'Full') return 'psec-perm psec-perm--full';
  if (level === 'Read') return 'psec-perm psec-perm--read';
  return 'psec-perm psec-perm--none';
}

function roleBadge(row) {
  if (row.role === 'platform_admin') {
    return <span className="psec-role-badge psec-role-badge--platform">{row.roleLabel}</span>;
  }
  if (row.role === 'org_admin') {
    return <span className="psec-role-badge psec-role-badge--org">{row.roleLabel}</span>;
  }
  return <span className="psec-role-badge psec-role-badge--member">{row.roleLabel}</span>;
}

function statusClass(status) {
  if (status === 'active') return 'psec-status psec-status--active';
  if (status === 'expiring') return 'psec-status psec-status--expiring';
  if (status === 'expired') return 'psec-status psec-status--expired';
  return 'psec-status psec-status--revoked';
}

function statusLabel(status) {
  if (status === 'active') return 'Active';
  if (status === 'expiring') return 'Expiring';
  if (status === 'expired') return 'Expired';
  return 'Revoked';
}

export default function PlatformSecurity() {
  const queryClient = useQueryClient();
  const [pageError, setPageError] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEnv, setNewEnv] = useState('staging');
  const [revealSecret, setRevealSecret] = useState(null);

  const overviewQuery = useQuery({
    queryKey: SECURITY_QUERY_KEY,
    queryFn: () => adminService.getSecurityOverview(),
    staleTime: 30 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (body) => adminService.createPlatformApiKey(body),
    onSuccess: (data) => {
      setGenerateOpen(false);
      setNewName('');
      setNewEnv('staging');
      setRevealSecret(data);
      void queryClient.invalidateQueries({ queryKey: SECURITY_QUERY_KEY });
    },
    onError: (e) => {
      setPageError(e.response?.data?.error || e.message || 'Failed to create key');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id) => adminService.revokePlatformApiKey(id),
    onSuccess: () => {
      setPageError('');
      void queryClient.invalidateQueries({ queryKey: SECURITY_QUERY_KEY });
    },
    onError: (e) => {
      setPageError(e.response?.data?.error || e.message || 'Revoke failed');
    },
  });

  const renewMutation = useMutation({
    mutationFn: (id) => adminService.renewPlatformApiKey(id),
    onSuccess: () => {
      setPageError('');
      void queryClient.invalidateQueries({ queryKey: SECURITY_QUERY_KEY });
    },
    onError: (e) => {
      setPageError(e.response?.data?.error || e.message || 'Renew failed');
    },
  });

  const submitGenerate = (e) => {
    e.preventDefault();
    setPageError('');
    const name = newName.trim();
    if (!name) {
      setPageError('Enter a label for this key.');
      return;
    }
    createMutation.mutate({ name, environment: newEnv });
  };

  const copySecret = async () => {
    if (!revealSecret?.plainSecret) return;
    try {
      await navigator.clipboard.writeText(revealSecret.plainSecret);
    } catch {
      setPageError('Could not copy to clipboard.');
    }
  };

  if (overviewQuery.isLoading) {
    return (
      <div className="psec-root">
        <div className="psec-inner psec-loading">
          <div className="psec-spinner" aria-hidden />
          Loading security…
        </div>
      </div>
    );
  }

  if (overviewQuery.isError) {
    return (
      <div className="psec-root">
        <div className="psec-inner">
          <div className="psec-err">{overviewQuery.error?.message || 'Failed to load security overview.'}</div>
        </div>
      </div>
    );
  }

  const rolePermissions = overviewQuery.data?.rolePermissions ?? [];
  const apiKeys = overviewQuery.data?.apiKeys ?? [];

  return (
    <div className="psec-root">
      <div className="psec-inner">
        <header className="psec-head">
          <h1 className="psec-title">Security &amp; access</h1>
          <p className="psec-sub">Manage roles, permissions, API keys and access tokens.</p>
        </header>

        {pageError ? <div className="psec-err">{pageError}</div> : null}

        <div className="psec-grid">
          <section className="psec-card" aria-label="Role permissions">
            <header className="psec-card-header">
              <h2 className="psec-card-title">Role permissions</h2>
            </header>
            <div className="psec-card-body">
              <div className="psec-table-wrap">
                <table className="psec-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Orgs</th>
                      <th>Plans</th>
                      <th>Users</th>
                      <th>Billing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolePermissions.map((row) => (
                      <tr key={row.role}>
                        <td className="psec-role-cell">{roleBadge(row)}</td>
                        <td>
                          <span className={permClass(row.orgs)}>{row.orgs}</span>
                        </td>
                        <td>
                          <span className={permClass(row.plans)}>{row.plans}</span>
                        </td>
                        <td>
                          <span className={permClass(row.users)}>{row.users}</span>
                        </td>
                        <td>
                          <span className={permClass(row.billing)}>{row.billing}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="psec-card psec-card--keys" aria-label="API keys">
            <header className="psec-card-header">
              <h2 className="psec-card-title">API keys</h2>
            </header>
            <div className="psec-card-body psec-card-body--keys">
              {apiKeys.length === 0 ? (
                <p className="psec-empty-keys">No keys yet. Generate one for integrations (secret is shown only once).</p>
              ) : (
                <div className="psec-key-list">
                  {apiKeys.map((k) => (
                    <div key={k.id} className="psec-key-row">
                      <div className="psec-key-left">
                        <div
                          className={`psec-key-icon ${k.environment === 'production' ? 'psec-key-icon--prod' : 'psec-key-icon--stg'}`}
                          aria-hidden
                        >
                          <Key size={20} strokeWidth={2} />
                        </div>
                        <div className="psec-key-text">
                          <div className="psec-key-name">{k.name}</div>
                          <div className="psec-key-mask">{k.maskedKey}</div>
                        </div>
                      </div>
                      <div className="psec-key-right">
                        <div className="psec-key-right-top">
                          <span className={statusClass(k.status)}>{statusLabel(k.status)}</span>
                          {/* {k.expiresAt && k.status !== 'revoked' && (
                            <span className="psec-key-expires">Expires {k.expiresAt}</span>
                          )} */}
                        </div>
                        <div className="psec-key-actions">
                          {k.status !== 'revoked' && (
                            <button
                              type="button"
                              className="psec-btn psec-btn--revoke"
                              disabled={revokeMutation.isPending}
                              onClick={() => {
                                if (window.confirm(`Revoke key “${k.name}”? It cannot be used again.`)) {
                                  revokeMutation.mutate(k.id);
                                }
                              }}
                            >
                              Revoke
                            </button>
                          )}
                          {(k.status === 'expiring' || k.status === 'expired') && k.status !== 'revoked' && (
                            <button
                              type="button"
                              className="psec-btn psec-btn--renew"
                              disabled={renewMutation.isPending}
                              onClick={() => renewMutation.mutate(k.id)}
                            >
                              Renew
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="psec-btn psec-btn--primary psec-btn--generate"
                onClick={() => {
                  setPageError('');
                  setGenerateOpen(true);
                }}
              >
                <Plus size={18} strokeWidth={2.5} aria-hidden />
                Generate new key
              </button>
            </div>
          </section>
        </div>
      </div>

      {generateOpen && (
        <div
          className="psec-modal-overlay"
          role="presentation"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget && !createMutation.isPending) setGenerateOpen(false);
          }}
        >
          <div className="psec-modal" role="dialog" aria-labelledby="psec-gen-title" aria-modal="true">
            <h3 id="psec-gen-title">Generate API key</h3>
            <p className="psec-hint">The full secret is shown only once after creation.</p>
            <form onSubmit={submitGenerate}>
              <label className="psec-modal-label" htmlFor="psec-key-name">
                Label
              </label>
              <input
                id="psec-key-name"
                className="psec-modal-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Production integration"
              />
              <label className="psec-modal-label" htmlFor="psec-key-env">
                Environment
              </label>
              <select
                id="psec-key-env"
                className="psec-modal-select"
                value={newEnv}
                onChange={(e) => setNewEnv(e.target.value)}
              >
                <option value="staging">Staging (sk-stg-…)</option>
                <option value="production">Production (sk-prod-…)</option>
              </select>
              <div className="psec-modal-actions">
                <button type="button" className="psec-btn" onClick={() => setGenerateOpen(false)} disabled={createMutation.isPending}>
                  Cancel
                </button>
                <button type="submit" className="psec-btn" style={{ background: '#2563eb', color: '#fff', borderColor: '#2563eb' }} disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {revealSecret && (
        <div
          className="psec-modal-overlay"
          role="presentation"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) setRevealSecret(null);
          }}
        >
          <div className="psec-modal" role="dialog" aria-labelledby="psec-secret-title" aria-modal="true">
            <h3 id="psec-secret-title">Copy your new key</h3>
            <p className="psec-hint">Store it securely. It will not be shown again.</p>
            <div className="psec-secret-box">{revealSecret.plainSecret}</div>
            <div className="psec-modal-actions">
              <button type="button" className="psec-btn" onClick={copySecret}>
                Copy to clipboard
              </button>
              <button type="button" className="psec-btn" style={{ background: '#2563eb', color: '#fff', borderColor: '#2563eb' }} onClick={() => setRevealSecret(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
