import { Link } from 'react-router-dom';
import { CloudUpload } from 'lucide-react';

/**
 * DashboardHeader — sticky top bar for the org-admin dashboard.
 *
 * Props:
 *   title        {string}   Page title shown on the left
 *   subtitle     {string}   Optional secondary line under the title (smaller, muted)
 *   actions      {ReactNode} Optional extra buttons/links on the right
 */
const DashboardHeader = ({
  title = 'Dashboard',
  subtitle,
  actions,
  className = '',
  actionsClassName = '',
}) => {
  const headerClass = ['ds-topnav', className].filter(Boolean).join(' ');
  const actionsClass = ['ds-topnav-right', actionsClassName].filter(Boolean).join(' ');

  return (
    <header className={headerClass}>
      <div className="ds-topnav-left">
        <div className="ds-topnav-title-block">
          <h1 className="ds-topnav-title">{title}</h1>
          {subtitle ? (
            <p className="ds-topnav-subtitle">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className={actionsClass}>
        {actions ?? (
          <>
            <Link to="/pdfs/upload" className="ds-navbar-btn ds-navbar-btn--ghost">
              <CloudUpload size={16} />
              Upload PDF
            </Link>
            <Link to="/conversions" className="ds-navbar-btn ds-navbar-btn--primary">
              <span className="ds-navbar-btn-plus">+</span>
              New conversion
            </Link>
          </>
        )}
      </div>
    </header>
  );
};

export default DashboardHeader;
