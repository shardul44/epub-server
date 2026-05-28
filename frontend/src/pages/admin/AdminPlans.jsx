import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { adminService } from '../../services/adminService';
import './AdminPlans.css';

const FEATURE_TAXONOMY = [
  { id: 'reflowable_pdf_to_epub', label: 'Reflowable Pdf to EPub', keys: ['reflowable.pdf_to_epub', 'conversion.basic'] },
  { id: 'reflowable_audio_sync', label: 'Reflowable Audio Sync', keys: ['reflowable.audio_sync', 'sync_studio'] },
  { id: 'hifi_fxl_pdf_to_epub', label: 'Hi-fi FXL Pdf to EPub', keys: ['hifi_fxl.pdf_to_epub', 'kitaboo.import'] },
  { id: 'hifi_fxl_audio_sync', label: 'Hi-fi FXL Audio Sync', keys: ['hifi_fxl.audio_sync'] },
  { id: 'reflowable_epub_audio_sync', label: 'Reflowable EPUB to Audio Sync', keys: ['reflowable_epub.audio_sync'] },
  { id: 'hifi_fxl_epub_audio_sync', label: 'Hi-fi FXL EPUB to Audio Sync', keys: ['hifi_fxl_epub.audio_sync'] },
  { id: 'accessibility', label: 'Accessibility', keys: ['accessibility', 'accessibility_tools'] },
  { id: 'epub_checker', label: 'Epub Checker', keys: ['epub_checker', 'epub_tools'] },
  { id: 'interactive_books', label: 'Interactive Books', keys: ['interactive_books', 'interactive.content'] },
];

const FEATURE_BY_KEY = FEATURE_TAXONOMY.reduce((acc, item) => {
  item.keys.forEach((k) => {
    acc.set(k, item);
  });
  return acc;
}, new Map());

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

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [featureCounts, setFeatureCounts] = useState({});
  const [error, setError] = useState('');
  const [initialLoad, setInitialLoad] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [togglingKey, setTogglingKey] = useState(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [detail, setDetail] = useState(null);

  const firstBoot = useRef(true);

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
    setTogglingKey(featureKey);
    setError('');
    try {
      await adminService.setPlanFeature(selectedPlanId, featureKey, {});
      await openPlan(selectedPlanId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setTogglingKey(null);
    }
  };

  const removeFeature = async (featureKey) => {
    if (!selectedPlanId) return;
    setTogglingKey(featureKey);
    setError('');
    try {
      await adminService.removePlanFeature(selectedPlanId, featureKey);
      await openPlan(selectedPlanId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setTogglingKey(null);
    }
  };

  const descriptionByKey = useMemo(() => {
    const map = new Map();
    catalog.forEach((c) => {
      if (c?.featureKey) map.set(c.featureKey, c.description ?? '');
    });
    return map;
  }, [catalog]);

  const onPlanByBucket = new Map();
  (detail?.features || []).forEach((f) => {
    const bucket = toFeatureBucket(f.featureKey);
    if (!bucket) return;
    if (!onPlanByBucket.has(bucket.id)) onPlanByBucket.set(bucket.id, f);
  });
  const onPlanSorted = [...onPlanByBucket.values()].sort((a, b) =>
    featureLabel(a.featureKey, descriptionByKey).localeCompare(
      featureLabel(b.featureKey, descriptionByKey),
    ),
  );
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
  const keysOnPlan = new Set(onPlanSorted.map((f) => toFeatureBucket(f.featureKey)?.id).filter(Boolean));
  const availableFromCatalog = catalogSorted.filter((c) => {
    const bucketId = toFeatureBucket(c.featureKey)?.id;
    return !bucketId || !keysOnPlan.has(bucketId);
  });

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
          <h1 className="apl-title">Plans & Features</h1>
          <p className="apl-sub">Define plans and attach capability keys from the catalog.</p>
        </header>

        {error && <div className="apl-alert">{error}</div>}

        <div className="apl-layout">
          <div className="apl-col apl-col--left">
            <section className="apl-card" aria-labelledby="apl-new-title">
              <h2 id="apl-new-title" className="apl-card-title">
                New Plan
              </h2>
              <form onSubmit={createPlan}>
                <div className="apl-field">
                  <label className="apl-label" htmlFor="apl-plan-name">
                    Plan name
                  </label>
                  <input
                    id="apl-plan-name"
                    className="apl-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Enterprise"
                    required
                    autoComplete="off"
                  />
                </div>
                <div className="apl-field">
                  <label className="apl-label" htmlFor="apl-plan-desc">
                    Description
                  </label>
                  <input
                    id="apl-plan-desc"
                    className="apl-input"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description"
                    autoComplete="off"
                  />
                </div>
                <button type="submit" className="apl-btn-create" disabled={submitting}>
                  + Create Plan
                </button>
              </form>
            </section>

            <section className="apl-card" aria-labelledby="apl-list-title">
              <h2 id="apl-list-title" className="apl-card-title">
                All Plans
              </h2>
              <div className="apl-plan-list" role="list">
                {plans.map((p) => {
                  const cnt = featureCounts[p.id] ?? 0;
                  const isSel = p.id === selectedPlanId;
                  const { text, className } = planBadgeMeta(cnt, catalogLen, isSel);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="listitem"
                      className={`apl-plan-item${isSel ? ' apl-plan-item--selected' : ''}`}
                      onClick={() => void openPlan(p.id)}
                    >
                      <span className="apl-plan-name">{p.name}</span>
                      <span className={className}>{text}</span>
                    </button>
                  );
                })}
              </div>
              {!plans.length && <p className="apl-empty">No plans yet. Create one above.</p>}
            </section>
          </div>

          <div className="apl-col apl-col--right">
            <section className="apl-card apl-card--features" aria-labelledby="apl-features-title">
              {selectedPlanId && selectedPlan ? (
                <>
                  <div className="apl-features-head">
                    <h2 id="apl-features-title" className="apl-features-title">
                      Features — {selectedPlan.name}
                    </h2>
                    <p className="apl-features-hint">Click a feature to toggle it.</p>
                  </div>

                  <div className="apl-block">
                    <span className="apl-section-label">Currently on this plan</span>
                    <div className="apl-tag-grid">
                      {onPlanSorted.map((f) => (
                        <button
                          key={f.featureKey}
                          type="button"
                          className="apl-tag apl-tag--on"
                          disabled={togglingKey === f.featureKey}
                          onClick={() => void removeFeature(f.featureKey)}
                          title={`${f.featureKey} — Remove from plan`}
                        >
                          <Check className="apl-tag-icon" size={14} strokeWidth={2.5} aria-hidden />
                          {featureLabel(f.featureKey, descriptionByKey)}
                        </button>
                      ))}
                    </div>
                    {!onPlanSorted.length && (
                      <p className="apl-empty">No features yet — add from the catalog below.</p>
                    )}
                  </div>

                  <div className="apl-block">
                    <span className="apl-section-label">Add from catalog</span>
                    <div className="apl-tag-grid">
                      {availableFromCatalog.map((c) => (
                        <button
                          key={c.featureKey}
                          type="button"
                          className="apl-tag apl-tag--off"
                          disabled={togglingKey === c.featureKey}
                          onClick={() => void addFeatureToPlan(c.featureKey)}
                          title={`${c.featureKey} — Add to plan`}
                        >
                          <Plus className="apl-tag-icon" size={14} strokeWidth={2.5} aria-hidden />
                          {featureLabel(c.featureKey, descriptionByKey)}
                        </button>
                      ))}
                    </div>
                    {!availableFromCatalog.length && catalogLen > 0 && (
                      <p className="apl-empty">All catalog features are on this plan.</p>
                    )}
                    {!catalogLen && (
                      <p className="apl-empty">No keys in the feature catalog yet.</p>
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
      </div>
    </div>
  );
}
