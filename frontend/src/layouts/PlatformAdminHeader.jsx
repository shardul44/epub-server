import { useState } from 'react';
import { Search, Bell, CircleHelp } from 'lucide-react';
import './PlatformAdminHeader.css';

/**
 * Sticky top bar for platform administrators — title, global search field,
 * and utility actions.
 */
export default function PlatformAdminHeader() {
  const [query, setQuery] = useState('');

  return (
    <header className="pah" role="banner">
      <div className="pah-left">
        <h1 className="pah-title">
          <span className="pah-title-strong">Platform</span>
          <span className="pah-title-accent"> Admin</span>
        </h1>
      </div>

      <div className="pah-right">
        <label className="pah-search" htmlFor="pah-global-search">
          <span className="pah-search-icon" aria-hidden>
            <Search size={18} strokeWidth={2} />
          </span>
          <input
            id="pah-global-search"
            className="pah-search-input"
            type="search"
            placeholder="Search users, orgs, plans…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <button type="button" className="pah-icon-btn" aria-label="Notifications" title="Notifications">
          <Bell size={20} strokeWidth={2} />
        </button>

        <button type="button" className="pah-icon-btn" aria-label="Help" title="Help">
          <CircleHelp size={20} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
