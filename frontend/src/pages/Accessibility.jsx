import React from 'react';
import AccessibilityWizard from '../components/AccessibilityWizard';

const Accessibility = () => {
  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Accessibility</h1>
        <p className="dashboard-subtitle">
          Run accessibility checks on EPUB files using DAISY Ace.
        </p>
      </div>

      <AccessibilityWizard />
    </div>
  );
};

export default Accessibility;

