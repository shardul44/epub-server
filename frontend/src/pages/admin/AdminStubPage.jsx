import { useLocation } from 'react-router-dom';
import '../Dashboard.css';

const META = {
  '/admin/settings': {
    title: 'Settings',
    subtitle: 'Global platform preferences and defaults.',
  },
  '/admin/billing': {
    title: 'Billing & quotas',
    subtitle: 'Plans, invoices, and usage limits.',
  },
  '/admin/system-logs': {
    title: 'System logs',
    subtitle: 'Server and application diagnostics for operators.',
  },
};

/**
 * Lightweight placeholder for platform-admin sections that are not built yet.
 * Copy is keyed by pathname so one lazy chunk serves multiple routes.
 */
export default function AdminStubPage() {
  const { pathname } = useLocation();
  const meta = META[pathname] ?? {
    title: 'Admin',
    subtitle: 'This area is under construction.',
  };

  return (
    <div className="ds-container">
      <div className="ds-page-header">
        <h1>{meta.title}</h1>
        <p>{meta.subtitle}</p>
      </div>
      <p style={{ color: '#64748b', fontSize: 15, marginTop: 8 }}>
        This page is coming soon. Use the sidebar to navigate to live tools (Dashboard, Activity,
        Organizations, Plans, Conversions).
      </p>
    </div>
  );
}
