import React, { useMemo, useState } from 'react';
import {
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Puzzle,
  Presentation,
  Video,
  Gamepad2,
  CreditCard,
  List,
  Clock,
  GitBranch,
} from 'lucide-react';
import { H5P_CONTENT_CATEGORIES } from '../../../config/h5pContentTypes';
import { NATIVE_CONTENT_CATEGORY } from '../../../config/nativeContentBlocks';
import './InteractiveContentSidebar.css';

const ALL_CATEGORIES = [NATIVE_CONTENT_CATEGORY, ...H5P_CONTENT_CATEGORIES];

const ICON_MAP = {
  FileText,
  Quiz: HelpCircle,
  OndemandVideo: Video,
  Slideshow: Presentation,
  Image: ImageIcon,
  Collections: ImageIcon,
  SportsEsports: Gamepad2,
  GridOn: Gamepad2,
  TouchApp: Gamepad2,
  Style: CreditCard,
  ViewAgenda: List,
  Timeline: Clock,
  AccountTree: GitBranch,
};

function TypeIcon({ name }) {
  const Icon = ICON_MAP[name] || Puzzle;
  return (
    <span className="h5p-sidebar__type-icon" aria-hidden>
      <Icon size={18} strokeWidth={2} />
    </span>
  );
}

export default function InteractiveContentSidebar({ onSelectType, activeCategory = 'all' }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(activeCategory);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_CATEGORIES.map((cat) => ({
      ...cat,
      types: cat.types.filter((t) => {
        if (categoryFilter !== 'all' && cat.id !== categoryFilter) return false;
        if (!q) return true;
        return (
          t.label.toLowerCase().includes(q) ||
          (t.machineName && t.machineName.toLowerCase().includes(q)) ||
          (t.hint && t.hint.toLowerCase().includes(q)) ||
          cat.label.toLowerCase().includes(q) ||
          (t.nativeType && t.nativeType.toLowerCase().includes(q))
        );
      }),
    })).filter((cat) => cat.types.length > 0);
  }, [search, categoryFilter]);

  return (
    <aside className="h5p-sidebar" aria-label="Add activity">
      <div className="h5p-sidebar__header">
        <h2 className="h5p-sidebar__title">Add activity</h2>
        <p className="h5p-sidebar__subtitle">
          Choose a text block or H5P content type. New items appear as blocks on the current chapter.
        </p>

        <input
          type="search"
          className="h5p-sidebar__search"
          placeholder="Search content types…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search H5P content types"
        />

        <div className="h5p-sidebar__filters" role="tablist" aria-label="Filter by category">
          <button
            type="button"
            role="tab"
            aria-selected={categoryFilter === 'all'}
            className={`h5p-sidebar__chip${categoryFilter === 'all' ? ' is-active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            All
          </button>
          {ALL_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={categoryFilter === c.id}
              className={`h5p-sidebar__chip${categoryFilter === c.id ? ' is-active' : ''}`}
              onClick={() => setCategoryFilter(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h5p-sidebar__list" role="region" aria-label="H5P content type list">
        {filtered.length === 0 ? (
          <p className="h5p-sidebar__type-hint" style={{ textAlign: 'center', padding: '16px 0' }}>
            No content types match your search.
          </p>
        ) : (
          filtered.map((cat) => (
            <div key={cat.id} className="h5p-sidebar__category">
              <span className="h5p-sidebar__category-label">{cat.label}</span>
              {cat.types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="h5p-sidebar__type-btn"
                  onClick={() => onSelectType({ ...t, categoryId: cat.id, categoryLabel: cat.label })}
                >
                  <TypeIcon name={t.icon} />
                  <span className="h5p-sidebar__type-body">
                    <span className="h5p-sidebar__type-label">{t.label}</span>
                    {t.machineName ? (
                      <span className="h5p-sidebar__type-machine">{t.machineName}</span>
                    ) : t.nativeType ? (
                      <span className="h5p-sidebar__type-machine h5p-sidebar__type-machine--native">
                        Text content
                      </span>
                    ) : null}
                    {t.hint ? <span className="h5p-sidebar__type-hint">{t.hint}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
