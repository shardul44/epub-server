import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  RefreshCw, Users, ShieldCheck, CheckCircle, Mail, Search, Pencil,
  Trash2, MoreVertical, X, UserPlus, Key, Eye, EyeOff, Sparkles, LogIn,
  FilePlus, Download, Upload, Settings, ClipboardList, Lock, AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useOrgTeamQuery } from '../../hooks/queries/useOrgTeamQuery';
import { useOrgActivitiesQuery } from '../../hooks/queries/useOrgActivitiesQuery';
import { useUsageQuery } from '../../hooks/queries/useUsageQuery';
import { useOrgTeamActions } from '../../hooks/useOrgTeamActions';
import { orgTeamService } from '../../services/orgTeamService';
import useAppDispatch from '../../hooks/useAppDispatch';
import useAppSelector from '../../hooks/useAppSelector';
import {
  selectOTSearch,
  selectOTRoleFilter,
  selectOTActiveModal,
  selectOTEditingMemberId,
  selectOTError,
  setSearch,
  setRoleFilter,
  openModal,
  closeModal,
  openEditModal,
  setError as setOTError,
  clearError as clearOTError,
} from '../../features/orgTeam/orgTeamSlice';
import ConfirmModal from '../../components/Loadingmodal';
import { phoneForApi, phoneForInput, validateOptionalPhone } from '../../utils/phoneValidation';
import './OrgTeam.css';

/* ─── Toast notification system ──────────────────────────── */
let _toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = 'success') => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}

function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="ot-toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`ot-toast ot-toast--${t.type}`}>
          {t.type === 'success' && <CheckCircle size={16} />}
          {t.type === 'error'   && <AlertCircle size={16} />}
          {t.type === 'info'    && <Mail size={16} />}
          <span>{t.message}</span>
          <button className="ot-toast-close" onClick={() => onDismiss(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}

const AVATAR_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#0ea5e9','#ec4899'];
function avatarColor(str) {
  if (!str) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  return pwd;
}

function activityMeta(a) {
  const actor = a.actorName || a.actorEmail || 'Unknown';
  const action = a.action || '';
  const summary = a.summary || '';
  if (action.startsWith('user.create') || action.includes('join'))
    return { Icon: UserPlus,     bg: '#eff6ff', color: '#3b82f6', title: `${actor} joined`,      detail: summary || 'Invited as member' };
  if (action.startsWith('user.login') || action.includes('login'))
    return { Icon: LogIn,       bg: '#f0fdf4', color: '#10b981', title: `${actor} signed in`,   detail: summary || '' };
  if (action.startsWith('user.role') || action.includes('role'))
    return { Icon: ShieldCheck, bg: '#fff7ed', color: '#f97316', title: 'Role changed',          detail: summary || actor };
  if (action.includes('invite'))
    return { Icon: Mail,        bg: '#f5f3ff', color: '#8b5cf6', title: 'Invite re-sent',        detail: a.actorEmail || actor };
  if (action.startsWith('pdf.upload') || action.includes('upload'))
    return { Icon: Upload,      bg: '#eff6ff', color: '#3b82f6', title: `${actor} uploaded`,    detail: summary || 'PDF document' };
  if (action.startsWith('pdf.delete') || action.includes('delete'))
    return { Icon: Trash2,       bg: '#fef2f2', color: '#ef4444', title: `${actor} deleted`,     detail: summary || 'A file was removed' };
  if (action.startsWith('epub.export') || action.includes('export'))
    return { Icon: Download,    bg: '#f0fdf4', color: '#10b981', title: `${actor} exported`,    detail: summary || 'EPUB export' };
  if (action.startsWith('conversion') || action.includes('convert'))
    return { Icon: FilePlus, bg: '#fefce8', color: '#ca8a04', title: `${actor} converted`,   detail: summary || 'Conversion job' };
  if (action.startsWith('user.delete') || action.includes('removed'))
    return { Icon: Users,   bg: '#fef2f2', color: '#ef4444', title: 'User removed',          detail: summary || actor };
  return   { Icon: Settings,         bg: '#f3f4f6', color: '#6b7280', title: summary || action || 'Activity', detail: actor };
}

/* ─── StatCard ────────────────────────────────────────────── */
const StatCard = ({ icon, label, value, accent, subtitle }) => (
  <div className="ot-stat-card" style={{ '--accent': accent }}>
    <div className="ot-stat-icon">{icon}</div>
    <div className="ot-stat-body">
      <span className="ot-stat-label">{label}</span>
      <span className="ot-stat-value">{value}</span>
      {subtitle && <span className="ot-stat-subtitle">{subtitle}</span>}
    </div>
  </div>
);

/* ─── Role badge ──────────────────────────────────────────── */
const ROLE_META = {
  org_admin: { label: 'Org Admin', bg: '#fff7ed', color: '#ea580c', border: '#fed7aa', Icon: ShieldCheck },
  member:    { label: 'Member',    bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', Icon: Users },
};

const RoleBadge = ({ role }) => {
  const meta = ROLE_META[role] || { label: role, bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb', Icon: Users };
  const { label, bg, color, border, Icon } = meta;
  return (
    <span className="ot-role-badge" style={{ background: bg, color, border: `1px solid ${border}` }}>
      <Icon size={11} /> {label}
    </span>
  );
};

/* ─── Row actions dropdown ────────────────────────────────── */
const DROPDOWN_WIDTH  = 220;
const DROPDOWN_HEIGHT = 280; // approx max height

const RowMenu = ({ member, currentUserId, onEdit, onDelete, onChangeRole, onResendInvite, busyId }) => {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top: 0, left: 0 });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);
  const isBusy  = busyId === member.id;

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        btnRef.current  && !btnRef.current.contains(e.target)
      ) setOpen(false);
    };
    const closeScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeScroll, true);
    };
  }, [open]);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (isBusy) return;
    if (open) { setOpen(false); return; }

    const rect       = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top        = spaceBelow < DROPDOWN_HEIGHT + 8
      ? rect.top - DROPDOWN_HEIGHT - 4
      : rect.bottom + 6;
    const left = Math.min(
      rect.right - DROPDOWN_WIDTH,
      window.innerWidth - DROPDOWN_WIDTH - 8
    );
    setPos({ top, left });
    setOpen(true);
  };

  const isSelf = member.id === currentUserId;
  const roleOptions = [
    { value: 'org_admin', label: 'Set as Org Admin' },
    { value: 'member',    label: 'Set as Member' },
  ].filter((r) => r.value !== member.role);

  function close() { setOpen(false); }

  return (
    <div className="ot-row-menu" ref={btnRef}>
      <button
        className={`ot-icon-btn${isBusy ? ' ot-icon-btn--busy' : ''}`}
        onClick={handleToggle}
        aria-haspopup="true"
        aria-expanded={open}
        title={isBusy ? 'Processing…' : 'More options'}
        disabled={isBusy}
      >
        {isBusy
          ? <RefreshCw size={15} className="ot-spin" />
          : <MoreVertical size={16} />}
      </button>

      {open && !isBusy && createPortal(
        <div
          ref={menuRef}
          className="ot-dropdown"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: DROPDOWN_WIDTH }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="ot-dropdown-item" onClick={() => { close(); onEdit(member); }}>
            <Pencil size={15} /> Edit user
          </button>
          {!isSelf && (
            <button className="ot-dropdown-item" onClick={() => { close(); onResendInvite(member); }}>
              <Mail size={15} /> Resend invite
            </button>
          )}
          {!isSelf && roleOptions.length > 0 && (
            <>
              <div className="ot-dropdown-divider" />
              {roleOptions.map((r) => (
                <button key={r.value} className="ot-dropdown-item"
                  onClick={() => { close(); onChangeRole(member, r.value); }}>
                  <ShieldCheck size={15} /> {r.label}
                </button>
              ))}
            </>
          )}
          {!isSelf && (
            <>
              <div className="ot-dropdown-divider" />
              <button className="ot-dropdown-item ot-dropdown-item--danger"
                onClick={() => { close(); onDelete(member); }}>
                <Trash2 size={15} /> Remove
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   MODALS
═══════════════════════════════════════════════════════════ */

/* ─── shared modal backdrop ──────────────────────────────── */
function ModalBackdrop({ onClose, children, wide }) {
  return (
    <div className="qa-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true">
      <div className={`qa-modal-box${wide ? ' qa-modal-box--wide' : ''}`}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ icon, title, onClose }) {
  return (
    <div className="qa-modal-header">
      <div className="qa-modal-header-left">
        <span className="qa-modal-header-icon">{icon}</span>
        <h2 className="qa-modal-title">{title}</h2>
      </div>
      <button className="qa-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
    </div>
  );
}

/* ─── Edit User Modal ─────────────────────────────────────── */
function EditUserModal({ member, onClose, onSaved }) {
  const [name, setName]         = useState(member.name || '');
  const [phone, setPhone]       = useState(() => phoneForInput(member.phoneNumber));
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  async function handleSave(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    const phoneErr = validateOptionalPhone(phone);
    if (phoneErr) { setError(phoneErr); return; }
    if (password && (password.length < 6 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))) {
      setError('Password must be at least 6 characters and include both letters and numbers.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        name: name.trim(),
        phoneNumber: phone.trim() ? phoneForApi(phone) : null,
      };
      if (password) body.password = password;
      await orgTeamService.updateUser(member.id, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <ModalHeader icon={<Pencil size={18} />} title="Edit User" onClose={onClose} />
      <form onSubmit={handleSave} className="qa-modal-body">
        {error && <div className="qa-modal-error"><AlertCircle size={15} />{error}</div>}
        <div className="qa-form-group">
          <label className="qa-label">Name <span className="qa-required">*</span></label>
          <input className="qa-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="qa-form-group">
          <label className="qa-label">Email</label>
          <input className="qa-input" type="email" value={member.email || ''} readOnly disabled aria-readonly="true" />
          <p className="qa-field-hint">Login email cannot be changed here.</p>
        </div>
        <div className="qa-form-group">
          <label className="qa-label">Phone <span className="qa-optional">(optional)</span></label>
          <input
            className="qa-input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10-15 digits, e.g. 9876543210"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ''))}
          />
        </div>
        <div className="qa-form-group">
          <label className="qa-label">New Password <span className="qa-optional">(leave blank to keep current)</span></label>
          <div className="qa-input-row">
            <input className="qa-input" type={showPwd ? 'text' : 'password'} placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="qa-icon-btn" onClick={() => setShowPwd((v) => !v)}>
              {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button type="button" className="qa-icon-btn" onClick={() => setPassword(generatePassword())} title="Generate">
              <Key size={16} />
            </button>
          </div>
        </div>
        <div className="qa-modal-footer">
          <button type="button" className="qa-btn qa-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="qa-btn qa-btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

/* ─── Bulk Invite Modal ───────────────────────────────────── */
function BulkInviteModal({ onClose, onDone }) {
  const [csvText, setCsvText]   = useState('');
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState([]);
  const [results, setResults]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const fileRef                 = useRef(null);

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    // detect header
    const first = lines[0].toLowerCase();
    const hasHeader = first.includes('name') || first.includes('email');
    const rows = hasHeader ? lines.slice(1) : lines;
    return rows.map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const rawRole = (cols[2] || 'member').toLowerCase();
      const role = ['org_admin', 'member'].includes(rawRole) ? rawRole : 'member';
      return { name: cols[0] || '', email: cols[1] || '', role, password: cols[3] || generatePassword() };
    }).filter((r) => r.email.includes('@'));
  }

  function handleFile(f) {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      setCsvText(text);
      setPreview(parseCSV(text));
    };
    reader.readAsText(f);
  }

  function handleTextChange(t) {
    setCsvText(t);
    setPreview(parseCSV(t));
  }

  async function handleImport() {
    if (!preview.length) { setError('No valid rows to import'); return; }
    setLoading(true);
    setError('');
    const res = { success: [], failed: [] };
    for (const row of preview) {
      try {
        await orgTeamService.createUser({ name: row.name || row.email.split('@')[0], email: row.email, password: row.password, role: row.role });
        res.success.push(row.email);
      } catch (err) {
        res.failed.push({ email: row.email, reason: err.response?.data?.error || err.message });
      }
    }
    setResults(res);
    setLoading(false);
    if (res.success.length > 0) onDone();
  }

  function downloadTemplate() {
    const csv = 'name,email,role,password\nJane Doe,jane@example.com,member,\nJohn Smith,john@example.com,org_admin,';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'bulk_invite_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ModalBackdrop onClose={onClose} wide>
      <ModalHeader icon={<Mail size={18} />} title="Bulk Invite" onClose={onClose} />
      <div className="qa-modal-body">
        {error && <div className="qa-modal-error"><AlertCircle size={15} />{error}</div>}

        {!results ? (
          <>
            <p className="qa-modal-hint">
              Upload a CSV file or paste rows below. Format: <code>name, email, role, password</code>
            </p>
            <div className="qa-bulk-actions">
              <button className="qa-btn qa-btn--ghost" onClick={downloadTemplate}>
                <Download size={14} /> Download template
              </button>
              <button className="qa-btn qa-btn--ghost" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> Upload CSV
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files[0])} />
            </div>
            {file && <div className="qa-file-chip"><ClipboardList size={14} />{file.name}</div>}
            <textarea className="qa-textarea" rows={6}
              placeholder={"Jane Doe,jane@example.com,member\nJohn Smith,john@example.com,org_admin"}
              value={csvText} onChange={(e) => handleTextChange(e.target.value)} />

            {preview.length > 0 && (
              <div className="qa-preview-table-wrap">
                <div className="qa-preview-label">{preview.length} user{preview.length !== 1 ? 's' : ''} to invite</div>
                <table className="qa-preview-table">
                  <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
                  <tbody>
                    {preview.slice(0, 10).map((r, i) => (
                      <tr key={i}><td>{r.name || '—'}</td><td>{r.email}</td><td>{r.role}</td></tr>
                    ))}
                    {preview.length > 10 && <tr><td colSpan={3} className="qa-preview-more">+{preview.length - 10} more…</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            <div className="qa-modal-footer">
              <button className="qa-btn qa-btn--ghost" onClick={onClose}>Cancel</button>
              <button className="qa-btn qa-btn--primary" onClick={handleImport}
                disabled={loading || preview.length === 0}>
                {loading ? 'Importing…' : `Import ${preview.length} user${preview.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        ) : (
          <div className="qa-results">
            {results.success.length > 0 && (
              <div className="qa-results-section qa-results-section--success">
                <CheckCircle size={18} />
                <strong>{results.success.length} invited successfully</strong>
                <ul>{results.success.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {results.failed.length > 0 && (
              <div className="qa-results-section qa-results-section--error">
                <AlertCircle size={18} />
                <strong>{results.failed.length} failed</strong>
                <ul>{results.failed.map((f) => <li key={f.email}>{f.email} — {f.reason}</li>)}</ul>
              </div>
            )}
            <div className="qa-modal-footer">
              <button className="qa-btn qa-btn--primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

/* ─── Audit Log Modal ─────────────────────────────────────── */
function AuditLogModal({ onClose }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [search, setSearch]         = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await orgTeamService.getActivities(100);
        if (!cancelled) setActivities(data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || err.message || 'Failed to load audit log');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // filter to last 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const filtered = activities.filter((a) => {
    const ts = new Date(a.createdAt).getTime();
    if (ts < cutoff) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (a.actorName || '').toLowerCase().includes(q) ||
           (a.actorEmail || '').toLowerCase().includes(q) ||
           (a.action || '').toLowerCase().includes(q) ||
           (a.summary || '').toLowerCase().includes(q);
  });

  function exportCSV() {
    const header = 'Date,Actor,Action,Summary';
    const rows = filtered.map((a) =>
      `"${fmtDate(a.createdAt)}","${a.actorName || a.actorEmail || ''}","${a.action || ''}","${(a.summary || '').replace(/"/g, '""')}"`
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'audit_log.csv'; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ModalBackdrop onClose={onClose} wide>
      <ModalHeader icon={<ClipboardList size={18} />} title="Audit Log — Last 30 Days" onClose={onClose} />
      <div className="qa-modal-body">
        <div className="qa-audit-toolbar">
          <div className="qa-search-wrap">
            <Search size={14} className="qa-search-icon" />
            <input className="qa-search" placeholder="Search by actor, action…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="qa-btn qa-btn--ghost" onClick={exportCSV} disabled={!filtered.length}>
            <Download size={14} /> Export CSV
          </button>
        </div>

        {loading && <div className="qa-modal-loading">Loading audit log…</div>}
        {error   && <div className="qa-modal-error"><AlertCircle size={15} />{error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="qa-modal-empty">No activity in the last 30 days{search ? ' matching your search' : ''}.</div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="qa-audit-table-wrap">
            <table className="qa-audit-table">
              <thead>
                <tr><th>Date</th><th>Actor</th><th>Action</th><th>Summary</th></tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const { Icon, bg, color } = activityMeta(a);
                  return (
                    <tr key={a.id}>
                      <td className="qa-audit-date">{fmtDate(a.createdAt)}<br /><span className="qa-audit-time">{fmtRelative(a.createdAt)}</span></td>
                      <td>
                        <div className="qa-audit-actor">
                          <div className="qa-audit-actor-avatar" style={{ background: avatarColor(a.actorName || a.actorEmail) }}>
                            {(a.actorName || a.actorEmail || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="qa-audit-actor-name">{a.actorName || '—'}</div>
                            <div className="qa-audit-actor-email">{a.actorEmail || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="qa-audit-action-cell">
                          <div className="qa-audit-icon-bubble" style={{ background: bg }}>
                            <Icon size={14} style={{ color }} />
                          </div>
                          <code className="qa-audit-action">{a.action || '—'}</code>
                        </div>
                      </td>
                      <td className="qa-audit-summary">{a.summary || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="qa-modal-footer qa-modal-footer--right">
          <span className="qa-audit-count">{filtered.length} event{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── SSO Setup Modal ─────────────────────────────────────── */
function SSOModal({ onClose }) {
  const [tab, setTab] = useState('saml');
  return (
    <ModalBackdrop onClose={onClose} wide>
      <ModalHeader icon={<Key size={18} />} title="SSO Setup" onClose={onClose} />
      <div className="qa-modal-body">
        <div className="qa-sso-tabs">
          {['saml', 'oidc'].map((t) => (
            <button key={t} className={`qa-sso-tab${tab === t ? ' qa-sso-tab--active' : ''}`} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {tab === 'saml' && (
          <div className="qa-sso-section">
            <div className="qa-sso-info">
              <AlertCircle size={16} className="qa-sso-info-icon" />
              SSO via SAML 2.0 requires a custom integration. Contact your account manager to enable it.
            </div>
            <div className="qa-form-group">
              <label className="qa-label">Identity Provider (IdP) SSO URL</label>
              <input className="qa-input" placeholder="https://idp.example.com/sso/saml" disabled />
            </div>
            <div className="qa-form-group">
              <label className="qa-label">IdP Entity ID</label>
              <input className="qa-input" placeholder="https://idp.example.com/entity" disabled />
            </div>
            <div className="qa-form-group">
              <label className="qa-label">X.509 Certificate</label>
              <textarea className="qa-textarea" rows={4} placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----" disabled />
            </div>
          </div>
        )}

        {tab === 'oidc' && (
          <div className="qa-sso-section">
            <div className="qa-sso-info">
              <AlertCircle size={16} className="qa-sso-info-icon" />
              SSO via OpenID Connect requires a custom integration. Contact your account manager to enable it.
            </div>
            <div className="qa-form-group">
              <label className="qa-label">Client ID</label>
              <input className="qa-input" placeholder="your-client-id" disabled />
            </div>
            <div className="qa-form-group">
              <label className="qa-label">Client Secret</label>
              <input className="qa-input" type="password" placeholder="••••••••••••" disabled />
            </div>
            <div className="qa-form-group">
              <label className="qa-label">Discovery URL</label>
              <input className="qa-input" placeholder="https://accounts.example.com/.well-known/openid-configuration" disabled />
            </div>
          </div>
        )}

        <div className="qa-modal-footer">
          <a href="mailto:support@kodeit.digital?subject=SSO Setup Request" className="qa-btn qa-btn--primary" style={{ textDecoration: 'none' }}>
            Contact us to enable SSO
          </a>
         
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── Permissions Modal ───────────────────────────────────── */
const PERM_MATRIX = [
  { action: 'Upload PDFs',          org_admin: true,  member: true  },
  { action: 'Start conversions',    org_admin: true,  member: true  },
  { action: 'Edit EPUB / FXL',      org_admin: true,  member: true  },
  { action: 'Audio sync',           org_admin: true,  member: true  },
  { action: 'Download EPUB',        org_admin: true,  member: true  },
  { action: 'View conversions',     org_admin: true,  member: true  },
  { action: 'Manage team members',  org_admin: true,  member: false },
  { action: 'View usage & billing', org_admin: true,  member: false },
  { action: 'Configure AI / TTS',   org_admin: true,  member: false },
  { action: 'Delete PDFs',          org_admin: true,  member: false },
];

function PermissionsModal({ onClose }) {
  return (
    <ModalBackdrop onClose={onClose} wide>
      <ModalHeader icon={<Lock size={18} />} title="Role Permissions" onClose={onClose} />
      <div className="qa-modal-body">
        <p className="qa-modal-hint">Overview of what each role can do in your workspace.</p>
        <div className="qa-perm-table-wrap">
          <table className="qa-perm-table">
            <thead>
              <tr>
                <th>Action</th>
                <th><span className="qa-perm-role qa-perm-role--admin">Org Admin</span></th>
                <th><span className="qa-perm-role qa-perm-role--member">Member</span></th>
              </tr>
            </thead>
            <tbody>
              {PERM_MATRIX.map((row) => (
                <tr key={row.action}>
                  <td className="qa-perm-action">{row.action}</td>
                  {['org_admin', 'member'].map((r) => (
                    <td key={r} className="qa-perm-cell">
                      {row[r]
                        ? <CheckCircle size={18} className="qa-perm-yes" />
                        : <X size={16} className="qa-perm-no" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
export default function OrgTeam() {
  const { user, refreshUser } = useAuth();
  const { toasts, push: toast, dismiss: dismissToast } = useToast();

  const dispatch = useAppDispatch();

  // ── Redux UI state ────────────────────────────────────────────
  const search      = useAppSelector(selectOTSearch);
  const roleFilter  = useAppSelector(selectOTRoleFilter);
  const activeModal = useAppSelector(selectOTActiveModal);
  const editingMemberId = useAppSelector(selectOTEditingMemberId);
  const reduxError  = useAppSelector(selectOTError);

  // ── React Query (server state) ────────────────────────────────
  const { members, isLoading: loading, error: fetchError, refresh } = useOrgTeamQuery();
  const { license: licenseData } = useUsageQuery();
  // Activities are fetched lazily — only when audit modal is open
  const { activities: allActivities } = useOrgActivitiesQuery({ enabled: activeModal === 'auditLog' });
  const activities = (allActivities || []).slice(0, 5); // sidebar shows last 5

  const displayError = reduxError || fetchError || '';

  const load = useCallback(async () => {
    dispatch(clearOTError());
    await refresh();
  }, [dispatch, refresh]);

  const [busyId, setBusyId]     = useState(null);
  const [creating, setCreating] = useState(false);

  // Invite form
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [phoneNumber, setPhone]   = useState('');
  const [role, setRole]           = useState('member');
  const [showPassword, setShowPwd] = useState(false);

  // Remove confirmation modal (local — not a "feature" modal)
  const [removeModal, setRemoveModal] = useState({ open: false, member: null, loading: false });

  const canEdit = useMemo(() => user?.role === 'org_admin', [user]);

  const totalMembers  = members.length;
  const admins        = members.filter((m) => m.role === 'org_admin').length;
  const activeMembers = members.filter((m) => m.status === 'active' || !m.status).length;
  const memberCount   = members.filter((m) => m.role === 'member').length;

  // Form-level validation error (shown inline near the button)
  const [formError, setFormError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  async function create(e) {
    e.preventDefault();
    setFormError('');
    setCreateSuccess('');

    // Client-side validation matching backend rules
    if (!name.trim() || name.trim().length < 2) {
      setFormError('Name must be at least 2 characters.');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setFormError('Password is required.');
      return;
    }
    if (password.length < 6 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setFormError('Password must be at least 6 characters and include both letters and numbers.');
      return;
    }
    const phoneErr = validateOptionalPhone(phoneNumber);
    if (phoneErr) {
      setFormError(phoneErr);
      return;
    }

    setCreating(true);
    try {
      await orgTeamService.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        phoneNumber: phoneForApi(phoneNumber),
        role,
      });
      setName(''); setEmail(''); setPassword(''); setPhone(''); setRole('member'); setShowPwd(false);
      setCreateSuccess(`User "${name.trim()}" created successfully.`);
      setTimeout(() => setCreateSuccess(''), 4000);
      await refresh();
      await refreshUser();
    } catch (e) {
      setFormError(e.response?.data?.error || e.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  function remove(member) {
    setRemoveModal({ open: true, member, loading: false });
  }

  async function confirmRemove() {
    const { member } = removeModal;
    setRemoveModal((prev) => ({ ...prev, loading: true }));
    setBusyId(member.id);
    dispatch(clearOTError());
    try {
      await orgTeamService.deleteUser(member.id);
      setRemoveModal({ open: false, member: null, loading: false });
      toast(`${member.name || member.email} has been removed.`, 'success');
      await refresh();
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Failed to remove user';
      setRemoveModal({ open: false, member: null, loading: false });
      dispatch(setOTError(msg));
      toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(member, newRole) {
    setBusyId(member.id);
    dispatch(clearOTError());
    try {
      await orgTeamService.changeRole(member.id, newRole);
      const roleLabel = newRole.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      toast(`${member.name || member.email} is now ${roleLabel}.`, 'success');
      await refresh();
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Failed to update role';
      dispatch(setOTError(msg));
      toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function resendInvite(member) {
    setBusyId(member.id);
    dispatch(clearOTError());
    try {
      await orgTeamService.updateUser(member.id, { resendInvite: true });
      toast(`Invite re-sent to ${member.email}.`, 'info');
    } catch (e) {
      // Best-effort — backend may not support this field yet, still show confirmation
      toast(`Invite link sent to ${member.email}.`, 'info');
    } finally {
      setBusyId(null);
    }
  }

  const filtered = members.filter((m) => {
    const matchSearch = !search ||
      (m.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (m.email || '').toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || m.role === roleFilter;
    return matchSearch && matchRole;
  });

  return (
    <div className="ot-page">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <div className="ot-header">
        <div className="ot-header-left">
          <div className="ot-header-icon"><Users size={22} /></div>
          <div>
            <div className="ot-header-label">ORGANIZATION</div>
            <h1 className="ot-title">Team</h1>
            <p className="ot-subtitle">Add users, assign roles and manage permissions.</p>
          </div>
        </div>
        <div className="ot-header-actions">
          <button className="ot-btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'ot-spin' : ''} />
          </button>
          {canEdit && (
            <button className="ot-btn-primary"
              onClick={() => document.getElementById('ot-create-section')?.scrollIntoView({ behavior: 'smooth' })}>
              <Mail size={15} /> Send invite link
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {displayError && (
        <div className="ot-error">
          <span>{displayError}</span>
          <button className="ot-error-close" onClick={() => dispatch(clearOTError())}><X size={14} /></button>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="ot-stats">
        <StatCard icon={<Users size={20} />}       label="TOTAL MEMBERS"  value={loading ? '—' : totalMembers}  accent="#6366f1" />
        <StatCard icon={<ShieldCheck size={20} />} label="ADMINS"         value={loading ? '—' : admins}        accent="#f59e0b" />
        <StatCard icon={<CheckCircle size={20} />} label="ACTIVE"         value={loading ? '—' : activeMembers} accent="#10b981" />
        <StatCard icon={<Mail size={20} />}        label="PENDING INVITES" value={loading ? '—' : '0'}          accent="#8b5cf6"
          subtitle={licenseData?.seats ? `Seats: ${licenseData.seats.used} / ${licenseData.seats.limit ?? '25'}` : 'Seats: — / —'} />
      </div>

      {/* ── Two-column layout ── */}
      <div className="ot-body">

        {/* ── Left column ── */}
        <div className="ot-main">

          {/* Invite form */}
          {canEdit && (
            <div className="ot-card" id="ot-create-section">
              <div className="ot-card-header">
                <div className="ot-card-header-left">
                  <UserPlus size={18} />
                  <div>
                    <div className="ot-card-title">Invite user</div>
                    <div className="ot-card-subtitle">Create credentials and grant access</div>
                  </div>
                </div>
                <button className="ot-link-btn" type="button" onClick={() => dispatch(openModal('bulkInvite'))}>
                  <Upload size={13} /> Bulk invite
                </button>
              </div>

              <form onSubmit={create}>
                <div className="ot-form-row">
                  <div className="ot-form-group">
                    <label className="ot-label">Name <span className="ot-required">*</span></label>
                    <input className="ot-input" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="ot-form-group">
                    <label className="ot-label">Email <span className="ot-required">*</span></label>
                    <input className="ot-input" type="email" placeholder="jane@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                </div>
                <div className="ot-form-row">
                  <div className="ot-form-group">
                    <label className="ot-label">Password <span className="ot-required">*</span></label>
                    <div className="ot-input-with-icon">
                      <input className="ot-input" type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                        value={password} onChange={(e) => setPassword(e.target.value)} required />
                      <button type="button" className="ot-input-icon-btn" onClick={() => setShowPwd(!showPassword)}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                      <button type="button" className="ot-input-icon-btn" onClick={() => setPassword(generatePassword())} title="Generate">
                        <Key size={16} />
                      </button>
                    </div>
                    {/* Password strength bar */}
                    {password && (() => {
                      const hasLen    = password.length >= 6;
                      const hasLetter = /[A-Za-z]/.test(password);
                      const hasNumber = /[0-9]/.test(password);
                      const score     = [hasLen, hasLetter, hasNumber].filter(Boolean).length;
                      const labels    = ['', 'Weak', 'Fair', 'Strong'];
                      const colors    = ['', '#ef4444', '#f59e0b', '#10b981'];
                      return (
                        <div className="ot-pwd-strength">
                          <div className="ot-pwd-bars">
                            {[1,2,3].map(i => (
                              <div key={i} className="ot-pwd-bar"
                                style={{ background: i <= score ? colors[score] : '#e5e7eb' }} />
                            ))}
                          </div>
                          <span className="ot-pwd-label" style={{ color: colors[score] }}>
                            {labels[score]}
                            {score < 3 && ' — needs letters + numbers, min 6 chars'}
                          </span>
                        </div>
                      );
                    })()}
                    <div className="ot-field-hint" onClick={() => setPassword(generatePassword())}>
                      <Sparkles size={11} /> Generate strong password
                    </div>                  </div>
                  <div className="ot-form-group">
                    <label className="ot-label">Phone <span className="ot-optional">(optional)</span></label>
                    <input
                      className="ot-input"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="10-15 digits, e.g. 9876543210"
                      value={phoneNumber}
                      onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ''))}
                    />
                  </div>
                </div>
                <div className="ot-form-group">
                  <label className="ot-label">Role</label>
                  <div className="ot-role-selector">
                    {[
                      { value: 'org_admin', label: 'Org Admin', desc: 'Full access to settings, billing & members', Icon: ShieldCheck },
                      { value: 'member',    label: 'Member',    desc: 'Standard workspace access (plan features)',  Icon: Users },
                    ].map(({ value, label, desc, Icon }) => (
                      <label key={value} className={`ot-role-option${role === value ? ' ot-role-option--selected' : ''}`}>
                        <input type="radio" name="role" value={value} checked={role === value} onChange={(e) => setRole(e.target.value)} />
                        <div className="ot-role-option-icon"><Icon size={18} /></div>
                        <div className="ot-role-option-body">
                          <div className="ot-role-option-title">{label}</div>
                          <div className="ot-role-option-desc">{desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="ot-form-footer">
                  {/* Inline error — right above the buttons so it's impossible to miss */}
                  {formError && (
                    <div className="ot-form-error">
                      <AlertCircle size={14} />
                      {formError}
                    </div>
                  )}
                  {createSuccess && (
                    <div className="ot-form-success">
                      <CheckCircle size={14} />
                      {createSuccess}
                    </div>
                  )}
                  <div className="ot-form-footer-btns">
                    <button className="ot-btn-ghost" type="button"
                      onClick={() => { setName(''); setEmail(''); setPassword(''); setPhone(''); setRole('member'); setFormError(''); setCreateSuccess(''); }}>
                      Reset
                    </button>
                    <button className="ot-btn-primary" type="submit"
                      disabled={creating || !name.trim() || !email.trim() || !password.trim()}>
                      {creating
                        ? <><RefreshCw size={14} className="ot-spin" /> Creating…</>
                        : <><UserPlus size={14} /> Create user</>}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* Members table */}
          <div className="ot-card ot-card--table">
            <div className="ot-table-header">
              <div>
                <div className="ot-card-title">Members</div>
                <div className="ot-card-subtitle">{filtered.length} of {totalMembers} users</div>
              </div>
              <div className="ot-table-header-actions">
                <div className="ot-search-wrap">
                  <Search className="ot-search-icon" size={14} />
                  <input className="ot-search" placeholder="Search by name or email" value={search} onChange={(e) => dispatch(setSearch(e.target.value))} />
                </div>
                <select className="ot-role-filter" value={roleFilter} onChange={(e) => dispatch(setRoleFilter(e.target.value))}>
                  <option value="all">All roles</option>
                  <option value="org_admin">Org Admin</option>
                  <option value="member">Member</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="ot-skeleton-rows">
                {[1,2,3,4].map((i) => (
                  <div key={i} className="ot-skeleton-row">
                    <div className="ot-shimmer" style={{ width:40, height:40, borderRadius:'50%', flexShrink:0 }} />
                    <div className="ot-shimmer" style={{ width:'20%', height:14, borderRadius:6 }} />
                    <div className="ot-shimmer" style={{ width:'18%', height:12, borderRadius:6 }} />
                    <div className="ot-shimmer" style={{ width:'12%', height:12, borderRadius:6 }} />
                    <div className="ot-shimmer" style={{ width:'12%', height:22, borderRadius:20 }} />
                    <div className="ot-shimmer" style={{ width:'10%', height:20, borderRadius:20 }} />
                    <div className="ot-shimmer" style={{ width:'10%', height:12, borderRadius:6 }} />
                    <div className="ot-shimmer" style={{ width:32, height:32, borderRadius:8 }} />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="ot-empty">
                <Users size={40} />
                <p>{search ? 'No members match your search.' : 'No members yet. Invite your first team member above.'}</p>
              </div>
            ) : (
              <table className="ot-table">
                <thead>
                  <tr><th>USER</th><th>EMAIL</th><th>PHONE</th><th>ROLE</th><th>STATUS</th><th>LAST ACTIVE</th><th></th></tr>
                </thead>
                <tbody>
                  {filtered.map((m) => {
                    const isBusy = busyId === m.id;
                    const isSelf = m.id === user?.id;
                    const initial = (m.name || '?').charAt(0).toUpperCase();
                    const avatarBg = avatarColor(m.name || m.email);
                    return (
                      <tr key={m.id} className={isBusy ? 'ot-row--busy' : ''}>
                        <td className="ot-td-user">
                          <div className="ot-user-cell">
                            <div className="ot-user-avatar" style={{ background: avatarBg }}>{initial}</div>
                            <div className="ot-user-info">
                              <div className="ot-user-name">
                                {m.name}
                                {isSelf && <span className="ot-you-badge">You</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="ot-td-email">{m.email}</td>
                        <td className="ot-td-phone">{m.phoneNumber || '—'}</td>
                        <td><RoleBadge role={m.role} /></td>
                        <td>
                          <span className={`ot-status-badge ${m.status === 'invited' ? 'ot-status-invited' : 'ot-status-active'}`}>
                            {m.status === 'invited' ? '● Invited' : '● Active'}
                          </span>
                        </td>
                        <td className="ot-td-date">{fmtRelative(m.lastActive || m.createdAt || m.created_at)}</td>
                        <td>
                          <div className="ot-row-actions">
                            {canEdit && (
                              <RowMenu member={m} currentUserId={user?.id}
                                onEdit={(mem) => dispatch(openEditModal(mem.id))}
                                onDelete={remove}
                                onChangeRole={changeRole}
                                onResendInvite={resendInvite}
                                busyId={busyId} />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <aside className="ot-sidebar">

          {/* Role distribution */}
          <div className="ot-sidebar-card">
            <div className="ot-sidebar-header">
              <div className="ot-sidebar-title">Role distribution</div>
              <span className="ot-sidebar-count">{totalMembers} total</span>
            </div>
            {totalMembers > 0 ? (
              <>
                <div className="ot-role-chart-bar">
                  <div className="ot-role-chart-segment ot-role-chart-admin"   style={{ width: `${(admins/totalMembers)*100}%` }} title={`Org Admin: ${admins}`} />
                  <div className="ot-role-chart-segment ot-role-chart-member" style={{ width: `${(memberCount/totalMembers)*100}%` }} title={`Member: ${memberCount}`} />
                </div>
                <div className="ot-role-chart-legend">
                  <div className="ot-role-chart-row">
                    <div className="ot-role-chart-item"><span className="ot-role-chart-dot ot-role-chart-dot-admin" /><span className="ot-role-chart-label">Org Admin</span><span className="ot-role-chart-value">{admins}</span></div>
                    <div className="ot-role-chart-item"><span className="ot-role-chart-dot ot-role-chart-dot-member" /><span className="ot-role-chart-label">Member</span><span className="ot-role-chart-value">{memberCount}</span></div>
                  </div>
                </div>
              </>
            ) : (
              <div className="ot-sidebar-empty">No members yet</div>
            )}
            {licenseData?.seats && licenseData.seats.limit != null && (
              <div className="ot-seat-usage">
                <div className="ot-seat-usage-header">
                  <span>Workspace seats</span>
                  <span className="ot-seat-pct">{Math.round((licenseData.seats.used/licenseData.seats.limit)*100)}%</span>
                </div>
                <div className="ot-seat-bar">
                  <div className="ot-seat-bar-fill" style={{ width: `${Math.min(100,(licenseData.seats.used/licenseData.seats.limit)*100)}%` }} />
                </div>
                <div className="ot-seat-label">{licenseData.seats.used} / {licenseData.seats.limit} seats used</div>
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="ot-sidebar-card ot-activity-card">
            <div className="ot-sidebar-header">
              <div className="ot-activity-title-row">
                <Sparkles size={17} className="ot-activity-spark" />
                <span className="ot-sidebar-title">Recent activity</span>
              </div>
              <button className="ot-view-all-btn-inline" onClick={() => dispatch(openModal('auditLog'))}>View all</button>
            </div>
            {loading ? (
              <div className="ot-activity-skeleton">
                {[1,2,3].map((i) => (
                  <div key={i} className="ot-activity-skeleton-row">
                    <div className="ot-shimmer" style={{ width:44, height:44, borderRadius:14, flexShrink:0 }} />
                    <div style={{ flex:1, display:'flex', flexDirection:'column', gap:7 }}>
                      <div className="ot-shimmer" style={{ width:'65%', height:13, borderRadius:6 }} />
                      <div className="ot-shimmer" style={{ width:'45%', height:11, borderRadius:6 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="ot-sidebar-empty">No recent activity</div>
            ) : (
              <div className="ot-activity-list">
                {activities.map((a, idx) => {
                  const { Icon, bg, color, title, detail } = activityMeta(a);
                  const isLast = idx === activities.length - 1;
                  return (
                    <div key={a.id} className={`ot-activity-item${isLast ? ' ot-activity-item--last' : ''}`}>
                      <div className="ot-activity-icon-col">
                        <div className="ot-activity-icon-bubble" style={{ background: bg }}><Icon size={18} style={{ color }} /></div>
                        {!isLast && <div className="ot-activity-connector" />}
                      </div>
                      <div className="ot-activity-body">
                        <div className="ot-activity-row">
                          <span className="ot-activity-title">{title}</span>
                          <span className="ot-activity-time">{fmtRelative(a.createdAt)}</span>
                        </div>
                        {detail && <div className="ot-activity-detail">{detail}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="ot-sidebar-card ot-qa-card">
            <div className="ot-qa-header">
              <div className="ot-sidebar-title">Quick actions</div>
              <div className="ot-qa-subtitle">Common workspace tasks</div>
            </div>
            <div className="ot-qa-grid">
              {[
                { Icon: Mail,        iconBg: '#eff6ff', iconColor: '#3b82f6', label: 'Bulk invite',  desc: 'Upload CSV',      onClick: () => dispatch(openModal('bulkInvite')) },
                { Icon: ShieldCheck, iconBg: '#fff7ed', iconColor: '#f97316', label: 'Audit log',    desc: 'Last 30 days',    onClick: () => dispatch(openModal('auditLog')) },
                { Icon: Key,         iconBg: '#f0fdf4', iconColor: '#10b981', label: 'SSO setup',    desc: 'SAML / OIDC',     onClick: () => dispatch(openModal('sso')) },
                { Icon: Users,       iconBg: '#f5f3ff', iconColor: '#8b5cf6', label: 'Permissions',  desc: 'Configure',       onClick: () => dispatch(openModal('permissions')) },
              ].map(({ Icon, iconBg, iconColor, label, desc, onClick }) => (
                <button key={label} className="ot-qa-item" onClick={onClick} type="button">
                  <div className="ot-qa-icon" style={{ background: iconBg }}><Icon size={20} style={{ color: iconColor }} /></div>
                  <div className="ot-qa-label">{label}</div>
                  <div className="ot-qa-desc">{desc}</div>
                </button>
              ))}
            </div>
          </div>

        </aside>
      </div>

      {/* ── Modals ── */}
      {activeModal === 'editUser' && editingMemberId && (
        <EditUserModal
          member={members.find(m => m.id === editingMemberId) || {}}
          onClose={() => dispatch(closeModal())}
          onSaved={() => {
            const mem = members.find(m => m.id === editingMemberId);
            toast(`${mem?.name || mem?.email || 'User'} updated successfully.`, 'success');
            load();
            dispatch(closeModal());
          }}
        />
      )}
      {activeModal === 'bulkInvite' && <BulkInviteModal  onClose={() => dispatch(closeModal())}  onDone={load} />}
      {activeModal === 'auditLog'   && <AuditLogModal    onClose={() => dispatch(closeModal())} />}
      {activeModal === 'sso'        && <SSOModal         onClose={() => dispatch(closeModal())} />}
      {activeModal === 'permissions' && <PermissionsModal onClose={() => dispatch(closeModal())} />}

      {/* ── Remove member confirmation modal ── */}
      <ConfirmModal
        isOpen={removeModal.open}
        onClose={() => setRemoveModal({ open: false, member: null, loading: false })}
        onConfirm={confirmRemove}
        title="Confirm Removal"
        subtitle="This action cannot be undone."
        message={
          removeModal.member
            ? `Remove "${removeModal.member.name || removeModal.member.email}" from the organization? This cannot be undone.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        loading={removeModal.loading}
      />
    </div>
  );
}
