import React from 'react';
import EpubConformanceCheck from '../components/EpubConformanceCheck';

const EpubCheckerPage = () => {
  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>EPUB Checker</h1>
        <p className="dashboard-subtitle">
          Conformance validation using W3C EPUBCheck.
        </p>
      </div>

      <EpubConformanceCheck />
    </div>
  );
};

export default EpubCheckerPage;
