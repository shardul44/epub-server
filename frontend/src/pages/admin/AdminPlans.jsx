import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  ArrowUpDown,
  BookOpen,
  Building2,
  Check,
  FileCheck,
  FileText,
  Grid3x3,
  LayoutList,
  Lock,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Waves,
} from 'lucide-react';
import ConfirmModal from '../../components/Loadingmodal';
import { adminService } from '../../services/adminService';
import './AdminPlans.css';

const FEATURE_TAXONOMY = [
  { id: 'reflowable_pdf_to_epub', label: 'Reflowable Pdf to EPub', category: 'Reflowable', keys: ['reflowable.pdf_to_epub', 'conversion.basic'] },
  { id: 'reflowable_audio_sync', label: 'Reflowable Audio Sync', category: 'Reflowable', keys: ['reflowable.audio_sync', 'sync_studio'] },
  { id: 'hifi_fxl_pdf_to_epub', label: 'Hi-fi FXL Pdf to EPub', category: 'Hi-fi FXL', keys: ['hifi_fxl.pdf_to_epub', 'kitaboo.import'] },
  { id: 'hifi_fxl_audio_sync', label: 'Hi-fi FXL Audio Sync', category: 'Hi-fi FXL', keys: ['hifi_fxl.audio_sync'] },
  { id: 'reflowable_epub_audio_sync', label: 'Reflowable EPUB to Audio Sync', category: 'Reflowable', keys: ['reflowable_epub.audio_sync'] },
  { id: 'hifi_fxl_epub_audio_sync', label: 'Hi-fi FXL EPUB to Audio Sync', category: 'Hi-fi FXL', keys: ['hifi_fxl_epub.audio_sync'] },
  { id: 'accessibility', label: 'Accessibility', category: 'Tools', keys: ['accessibility', 'accessibility_tools'] },
  { id: 'epub_checker', label: 'Epub Checker', category: 'Tools', keys: ['epub_checker', 'epub_tools'] },
  { id: 'interactive_books', label: 'Interactive Books', category: 'Tools', keys: ['interactive_books', 'interactive.content'] },
];

const FEATURE_BY_KEY = FEATURE_TAXONOMY.reduce((acc, item) => {
  item.keys.forEach((k) => {
    acc.set(k, item);
  });
  return acc;
}, new Map());

const FEATURE_BY_ID = new Map(FEATURE_TAXONOMY.map((item) => [item.id, item]));

/** Group plan rows by taxonomy bucket (one chip per capability, multiple DB keys possible). */
function collectPlanFeaturesByBucket(planFeatures) {
  const byBucket = new Map();
  (planFeatures || []).forEach((f) => {
    const bucket = toFeatureBucket(f.featureKey);
    if (!bucket) return;
    if (!byBucket.has(bucket.id)) {
      byBucket.set(bucket.id, { bucket, features: [] });
    }
    byBucket.get(bucket.id).features.push(f);
  });
  return [...byBucket.values()];
}

const FEATURE_ICONS = {
  accessibility: Accessibility,
  epub_checker: FileCheck,
  interactive_books: BookOpen,
  reflowable_pdf_to_epub: FileText,
  reflowable_audio_sync: Waves,
  reflowable_epub_audio_sync: Waves,
  hifi_fxl_pdf_to_epub: Sparkles,
  hifi_fxl_audio_sync: Waves,
  hifi_fxl_epub_audio_sync: Waves,
};

function toFeatureBucket(featureKey) {
  return FEATURE_BY_KEY.get(featureKey) || null;
}

function featureLabel(featureKey, descriptionByKey) {
  const bucket = toFeatureBucket(featureKey);
  if (bucket) return bucket.label;
  const desc = descriptionByKey.get(featureKey);
  if (desc != null && String(desc).trim() !== '') return String(desc).trim();
  return featureKey;
}

function featureCategory(featureKey) {
  return toFeatureBucket(featureKey)?.category || 'Other';
}

function FeatureIcon({ featureKey, size = 16 }) {
  const bucket = toFeatureBucket(featureKey);
  const Icon = (bucket && FEATURE_ICONS[bucket.id]) || FileText;
  return <Icon size={size} strokeWidth={2} aria-hidden />;
}

function planBadgeMeta(count, catalogLen, isSelected) {
  const n = Number(count) || 0;
  const c = Number(catalogLen) || 0;
  if (c > 0 && n >= c) {
    return { text: 'All', className: 'apl-plan-badge apl-plan-badge--all' };
  }
  const text = `${n} feature${n === 1 ? '' : 's'}`;
  if (c >= 3 && n > 0 && n <= 2) {
    return { text, className: 'apl-plan-badge apl-plan-badge--warn' };
  }
  if (isSelected) {
    return { text, className: 'apl-plan-badge apl-plan-badge--selected' };
  }
  return { text, className: 'apl-plan-badge apl-plan-badge--muted' };
}

function planListIcon(count, catalogLen, isSelected, planName) {
  const n = Number(count) || 0;
  const c = Number(catalogLen) || 0;
  const name = (planName || '').toLowerCase();
  if (name.includes('full') || (c > 0 && n >= c)) return Lock;
  if (isSelected) return Star;
  if (n === 0) return Settings;
  return Star;
}

function PlansHeaderArt() {
  return (
    <svg className="apl-head-art" viewBox="0 0 120 100" fill="none" aria-hidden>
      <rect x="28" y="12" width="64" height="76" rx="10" fill="#EFF6FF" stroke="#BFDBFE" strokeWidth="2" />
      <path d="M40 32h40M40 44h32M40 56h36M40 68h24" stroke="#93C5FD" strokeWidth="3" strokeLinecap="round" />
      <circle cx="88" cy="24" r="10" fill="#DBEAFE" stroke="#60A5FA" strokeWidth="2" />
      <path d="M84 24l3 3 6-7" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M14 70l6-14 6 8 8-18 8 24"
        stroke="#60A5FA"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      <circle cx="18" cy="28" r="4" fill="#FCD34D" />
      <circle cx="102" cy="72" r="5" fill="#BFDBFE" />
    </svg>
  );
}

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [featureCounts, setFeatureCounts] = useState({});
  const [error, setError] = useState('');
  const [initialLoad, setInitialLoad] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [togglingBucketId, setTogglingBucketId] = useState(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [featureSearch, setFeatureSearch] = useState('');
  const [featureCategoryFilter, setFeatureCategoryFilter] = useState('all');
  const [featureSort, setFeatureSort] = useState('az');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingPlanId, setDeletingPlanId] = useState(null);

  const firstBoot = useRef(true);
  const createFormRef = useRef(null);
  const nameInputRef = useRef(null);

  const fetchCountsForPlans = useCallback(async (planList) => {
    if (!planList.length) {
      setFeatureCounts({});
      return;
    }
    const results = await Promise.all(
      planList.map(async (p) => {
        try {
          const d = await adminService.getPlan(p.id);
          return [p.id, (d?.features || []).length];
        } catch {
          return [p.id, 0];
        }
      }),
    );
    setFeatureCounts(Object.fromEntries(results));
  }, []);

  const loadCatalog = useCallback(async () => {
    const f = await adminService.getFeatures();
    setCatalog(Array.isArray(f) ? f : []);
  }, []);

  const openPlan = useCallback(async (id) => {
    setError('');
    setSelectedPlanId(id);
    try {
      const d = await adminService.getPlan(id);
      setDetail(d);
      setFeatureCounts((prev) => ({
        ...prev,
        [id]: (d?.features || []).length,
      }));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setDetail(null);
    }
  }, []);

  const loadPlans = useCallback(async () => {
    setError('');
    const pls = await adminService.getPlans();
    const list = Array.isArray(pls) ? pls : [];
    setPlans(list);
    await fetchCountsForPlans(list);
    return list;
  }, [fetchCountsForPlans]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      try {
        await loadPlans();
        if (!cancelled) await loadCatalog();
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message);
      } finally {
        if (!cancelled && firstBoot.current) {
          firstBoot.current = false;
          setInitialLoad(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPlans, loadCatalog]);

  useEffect(() => {
    if (initialLoad) return;
    if (selectedPlanId != null && !plans.some((p) => p.id === selectedPlanId)) {
      setSelectedPlanId(null);
      setDetail(null);
    }
    if (!selectedPlanId && plans.length) {
      void openPlan(plans[0].id);
    }
  }, [initialLoad, plans, selectedPlanId, openPlan]);

  const createPlan = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await adminService.createPlan({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName('');
      setDescription('');
      const list = await loadPlans();
      if (list.length) {
        const newest = list[list.length - 1];
        await openPlan(newest.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const addFeatureToPlan = async (featureKey) => {
    if (!selectedPlanId) return;
    const bucket = toFeatureBucket(featureKey);
    setTogglingBucketId(bucket?.id ?? featureKey);
    setError('');
    try {
      await adminService.setPlanFeature(selectedPlanId, featureKey, {});
      await openPlan(selectedPlanId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setTogglingBucketId(null);
    }
  };

  /** Remove every catalog alias for this capability bucket (fixes multi-click when plan has duplicate keys). */
  const removeFeatureBucket = async (bucketId) => {
    if (!selectedPlanId) return;
    const bucket = FEATURE_BY_ID.get(bucketId);
    if (!bucket) return;

    const keysOnPlan = (detail?.features || [])
      .map((f) => f.featureKey)
      .filter((key) => bucket.keys.includes(key));
    if (!keysOnPlan.length) return;

    setTogglingBucketId(bucketId);
    setError('');
    try {
      await Promise.all(
        keysOnPlan.map((key) => adminService.removePlanFeature(selectedPlanId, key)),
      );
      await openPlan(selectedPlanId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setTogglingBucketId(null);
    }
  };

  const focusCreatePlan = () => {
    createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    nameInputRef.current?.focus();
  };

  const requestDeletePlan = (plan) => {
    setError('');
    setDeleteTarget(plan);
  };

  const confirmDeletePlan = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setError('');
    setDeletingPlanId(id);
    try {
      await adminService.deletePlan(id);
      setDeleteTarget(null);
      if (selectedPlanId === id) {
        setSelectedPlanId(null);
        setDetail(null);
      }
      const list = await loadPlans();
      if (list.length) {
        await openPlan(list[0].id);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setDeleteTarget(null);
    } finally {
      setDeletingPlanId(null);
    }
  };

  const descriptionByKey = useMemo(() => {
    const map = new Map();
    catalog.forEach((c) => {
      if (c?.featureKey) map.set(c.featureKey, c.description ?? '');
    });
    return map;
  }, [catalog]);

  const onPlanBuckets = useMemo(() => {
    return collectPlanFeaturesByBucket(detail?.features).sort((a, b) =>
      featureLabel(a.features[0].featureKey, descriptionByKey).localeCompare(
        featureLabel(b.features[0].featureKey, descriptionByKey),
      ),
    );
  }, [detail?.features, descriptionByKey]);
  const catalogByBucket = new Map();
  catalog.forEach((c) => {
    const bucket = toFeatureBucket(c.featureKey);
    if (!bucket) return;
    if (!catalogByBucket.has(bucket.id)) catalogByBucket.set(bucket.id, c);
  });
  const catalogSorted = [...catalogByBucket.values()].sort((a, b) =>
    featureLabel(a.featureKey, descriptionByKey).localeCompare(
      featureLabel(b.featureKey, descriptionByKey),
    ),
  );
  const keysOnPlan = new Set(onPlanBuckets.map((g) => g.bucket.id));
  const availableFromCatalog = catalogSorted.filter((c) => {
    const bucketId = toFeatureBucket(c.featureKey)?.id;
    return !bucketId || !keysOnPlan.has(bucketId);
  });

  const catalogCategories = useMemo(() => {
    const set = new Set();
    catalogSorted.forEach((c) => set.add(featureCategory(c.featureKey)));
    return ['all', ...[...set].sort()];
  }, [catalogSorted]);

  const filteredCatalog = useMemo(() => {
    let list = [...availableFromCatalog];
    const q = featureSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const label = featureLabel(c.featureKey, descriptionByKey).toLowerCase();
        const key = (c.featureKey || '').toLowerCase();
        return label.includes(q) || key.includes(q);
      });
    }
    if (featureCategoryFilter !== 'all') {
      list = list.filter((c) => featureCategory(c.featureKey) === featureCategoryFilter);
    }
    list.sort((a, b) => {
      const la = featureLabel(a.featureKey, descriptionByKey);
      const lb = featureLabel(b.featureKey, descriptionByKey);
      return featureSort === 'za' ? lb.localeCompare(la) : la.localeCompare(lb);
    });
    return list;
  }, [availableFromCatalog, featureSearch, featureCategoryFilter, featureSort, descriptionByKey]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const catalogLen = catalog.length;

  if (initialLoad) {
    return (
      <div className="apl-root">
        <div className="apl-inner apl-loading">
          <div className="apl-spinner" aria-hidden />
          Loading plans…
        </div>
      </div>
    );
  }

  return (
    <div className="apl-root">
      <div className="apl-inner">
        <header className="apl-head">
          <div className="apl-head-text">
            <h1 className="apl-title">Plans & Features</h1>
            <p className="apl-sub">Define plans and attach capability keys from the catalog.</p>
          </div>
          <PlansHeaderArt />
        </header>

        {error && <div className="apl-alert">{error}</div>}

        <div className="apl-layout">
          <div className="apl-col apl-col--left">
            <section className="apl-card" aria-labelledby="apl-new-title" ref={createFormRef}>
              <div className="apl-card-head">
                <h2 id="apl-new-title" className="apl-card-title">
                  Create New Plan
                </h2>
                <span className="apl-card-icon apl-card-icon--accent" aria-hidden>
                  <Plus size={16} strokeWidth={2.5} />
                </span>
              </div>
              <form onSubmit={createPlan}>
                <div className="apl-field">
                  <label className="apl-label" htmlFor="apl-plan-name">
                    Plan name
                  </label>
                  <div className="apl-input-wrap">
                    <input
                      id="apl-plan-name"
                      ref={nameInputRef}
                      className="apl-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Enterprise"
                      required
                      autoComplete="off"
                    />
                    <Building2 className="apl-input-icon" size={18} aria-hidden />
                  </div>
                </div>
                <div className="apl-field">
                  <label className="apl-label" htmlFor="apl-plan-desc">
                    Description
                  </label>
                  <div className="apl-input-wrap apl-input-wrap--textarea">
                    <textarea
                      id="apl-plan-desc"
                      className="apl-input apl-textarea"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Short description"
                      rows={3}
                    />
                    <LayoutList className="apl-input-icon apl-input-icon--textarea" size={18} aria-hidden />
                  </div>
                </div>
                <button type="submit" className="apl-btn-create" disabled={submitting}>
                  <Plus size={18} strokeWidth={2.5} aria-hidden />
                  Create Plan
                </button>
              </form>
            </section>

            <section className="apl-card" aria-labelledby="apl-list-title">
              <div className="apl-card-head">
                <span className="apl-card-icon apl-card-icon--muted" aria-hidden>
                  <Menu size={16} strokeWidth={2} />
                </span>
                <h2 id="apl-list-title" className="apl-card-title apl-card-title--inline">
                  All Plans
                </h2>
              </div>
              <div className="apl-plan-list" role="list">
                {plans.map((p) => {
                  const cnt = featureCounts[p.id] ?? 0;
                  const isSel = p.id === selectedPlanId;
                  const { text, className } = planBadgeMeta(cnt, catalogLen, isSel);
                  const PlanIcon = planListIcon(cnt, catalogLen, isSel, p.name);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="listitem"
                      className={`apl-plan-item${isSel ? ' apl-plan-item--selected' : ''}`}
                      onClick={() => void openPlan(p.id)}
                    >
                      <span className={`apl-plan-icon${isSel ? ' apl-plan-icon--selected' : ''}`}>
                        <PlanIcon size={18} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="apl-plan-name">{p.name}</span>
                      <span className={className}>{text}</span>
                    </button>
                  );
                })}
              </div>
              {!plans.length && <p className="apl-empty apl-empty--list">No plans yet. Create one above.</p>}
              <button type="button" className="apl-btn-outline" onClick={focusCreatePlan}>
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                Add Plan
              </button>
            </section>
          </div>

          <div className="apl-col apl-col--right">
            <section className="apl-card apl-card--features" aria-labelledby="apl-features-title">
              {selectedPlanId && selectedPlan ? (
                <>
                  <div className="apl-features-top">
                    <div className="apl-features-intro">
                      <span className="apl-features-avatar" aria-hidden>
                        <Star size={22} strokeWidth={2} />
                      </span>
                      <div className="apl-features-head">
                        <h2 id="apl-features-title" className="apl-features-title">
                          Features — {selectedPlan.name}
                        </h2>
                        <p className="apl-features-hint">Click a feature to toggle it.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="apl-btn-delete-plan"
                      disabled={deletingPlanId === selectedPlan.id}
                      onClick={() => requestDeletePlan(selectedPlan)}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden />
                      Delete plan
                    </button>
                  </div>

                  <div className="apl-block">
                    <span className="apl-section-label">Currently on this plan</span>
                    <div className="apl-tag-grid">
                      {onPlanBuckets.map(({ bucket, features }) => {
                        const rep = features[0];
                        const aliasHint =
                          features.length > 1
                            ? ` (${features.map((x) => x.featureKey).join(', ')})`
                            : '';
                        return (
                          <button
                            key={bucket.id}
                            type="button"
                            className="apl-tag apl-tag--on"
                            disabled={togglingBucketId === bucket.id}
                            onClick={() => void removeFeatureBucket(bucket.id)}
                            title={`${bucket.label}${aliasHint} — Remove from plan`}
                          >
                            <span className="apl-tag-leading">
                              <FeatureIcon featureKey={rep.featureKey} />
                            </span>
                            <span className="apl-tag-label">
                              {featureLabel(rep.featureKey, descriptionByKey)}
                            </span>
                            <span className="apl-tag-check" aria-hidden>
                              <Check size={12} strokeWidth={3} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {!onPlanBuckets.length && (
                      <p className="apl-empty">No features yet — add from the catalog below.</p>
                    )}
                  </div>

                  <div className="apl-block">
                    <span className="apl-section-label">Add from catalog</span>
                    <div className="apl-catalog-toolbar">
                      <div className="apl-search-wrap">
                        <Search className="apl-search-icon" size={18} aria-hidden />
                        <input
                          type="search"
                          className="apl-search"
                          placeholder="Search features..."
                          value={featureSearch}
                          onChange={(e) => setFeatureSearch(e.target.value)}
                          aria-label="Search features"
                        />
                      </div>
                      <div className="apl-catalog-filters">
                        <label className="apl-filter-btn">
                          <Grid3x3 size={15} aria-hidden />
                          <select
                            className="apl-filter-select"
                            value={featureCategoryFilter}
                            onChange={(e) => setFeatureCategoryFilter(e.target.value)}
                            aria-label="Filter by category"
                          >
                            {catalogCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat === 'all' ? 'All Categories' : cat}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="apl-filter-btn">
                          <ArrowUpDown size={15} aria-hidden />
                          <select
                            className="apl-filter-select"
                            value={featureSort}
                            onChange={(e) => setFeatureSort(e.target.value)}
                            aria-label="Sort features"
                          >
                            <option value="az">Sort: A-Z</option>
                            <option value="za">Sort: Z-A</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    {filteredCatalog.length > 0 ? (
                      <div className="apl-tag-grid apl-tag-grid--catalog">
                        {filteredCatalog.map((c) => (
                          <button
                            key={c.featureKey}
                            type="button"
                            className="apl-tag apl-tag--off"
                            disabled={
                              togglingBucketId === (toFeatureBucket(c.featureKey)?.id ?? c.featureKey)
                            }
                            onClick={() => void addFeatureToPlan(c.featureKey)}
                            title={`${c.featureKey} — Add to plan`}
                          >
                            <span className="apl-tag-leading">
                              <FeatureIcon featureKey={c.featureKey} />
                            </span>
                            <span className="apl-tag-label">{featureLabel(c.featureKey, descriptionByKey)}</span>
                            <span className="apl-tag-add" aria-hidden>
                              <Plus size={12} strokeWidth={3} />
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : availableFromCatalog.length === 0 && catalogLen > 0 ? (
                      <div className="apl-all-set">
                        <div className="apl-all-set-box" aria-hidden>
                          <Plus size={32} strokeWidth={1.5} />
                        </div>
                        <div className="apl-all-set-text">
                          <p className="apl-all-set-title">
                            All set! <span className="apl-confetti" aria-hidden>🎉</span>
                          </p>
                          <p className="apl-all-set-sub">All catalog features are already added to this plan.</p>
                        </div>
                      </div>
                    ) : (
                      <p className="apl-empty">
                        {catalogLen ? 'No features match your search.' : 'No keys in the feature catalog yet.'}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="apl-placeholder" id="apl-features-title">
                  Select a plan from the list, or create a new plan.
                </div>
              )}
            </section>
          </div>
        </div>

        <ConfirmModal
          isOpen={Boolean(deleteTarget)}
          onClose={() => !deletingPlanId && setDeleteTarget(null)}
          onConfirm={confirmDeletePlan}
          title="Delete plan"
          subtitle="This action cannot be undone."
          message={
            deleteTarget
              ? `Permanently delete "${deleteTarget.name}"? All features assigned to this plan will be removed.`
              : ''
          }
          confirmLabel="Delete plan"
          variant="danger"
          loading={Boolean(deletingPlanId)}
        />
      </div>
    </div>
  );
}
