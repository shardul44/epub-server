import React, { useEffect, useState } from 'react';
import { adminService } from '../../services/adminService';
import '../Login.css';

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [detail, setDetail] = useState(null);

  const loadPlans = async () => {
    setError('');
    try {
      const pls = await adminService.getPlans();
      setPlans(pls);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const loadCatalog = async () => {
    try {
      const f = await adminService.getFeatures();
      setCatalog(f);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  useEffect(() => {
    void loadPlans();
    void loadCatalog();
  }, []);

  const openPlan = async (id) => {
    setError('');
    setSelectedPlanId(id);
    try {
      const d = await adminService.getPlan(id);
      setDetail(d);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const createPlan = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await adminService.createPlan({ name, description });
      setName('');
      setDescription('');
      await loadPlans();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const addFeatureToPlan = async (featureKey) => {
    if (!selectedPlanId) return;
    try {
      await adminService.setPlanFeature(selectedPlanId, featureKey, {});
      await openPlan(selectedPlanId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const removeFeature = async (featureKey) => {
    if (!selectedPlanId) return;
    try {
      await adminService.removePlanFeature(selectedPlanId, featureKey);
      await openPlan(selectedPlanId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const keysOnPlan = new Set((detail?.features || []).map((f) => f.featureKey));

  return (
    <div className="container" style={{ maxWidth: 960, padding: '24px' }}>
      <h1 style={{ marginBottom: 8 }}>Plans & features</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Define plans and attach capability keys from the catalog.</p>
      {error && <div className="auth-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <form onSubmit={createPlan} style={{ padding: 16, border: '1px solid #e0e0e0', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>New plan</h3>
            <div className="form-group">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary">
              Create plan
            </button>
          </form>
          <h3>Plans</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {plans.map((p) => (
              <li key={p.id} style={{ marginBottom: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => openPlan(p.id)}>
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ padding: 16, border: '1px solid #e0e0e0', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>{selectedPlanId ? `Plan #${selectedPlanId}` : 'Select a plan'}</h3>
          {detail?.plan && <p style={{ color: '#555' }}>{detail.plan.description || '—'}</p>}
          <h4>Features on this plan</h4>
          <ul>
            {(detail?.features || []).map((f) => (
              <li key={f.featureKey}>
                {f.featureKey}{' '}
                <button type="button" className="btn btn-secondary" onClick={() => removeFeature(f.featureKey)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <h4>Add from catalog</h4>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {catalog
              .filter((c) => !keysOnPlan.has(c.featureKey))
              .map((c) => (
                <li key={c.featureKey} style={{ marginBottom: 6 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => addFeatureToPlan(c.featureKey)}>
                    + {c.featureKey}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
