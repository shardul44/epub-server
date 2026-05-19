import AiConfig from '../AiConfig';
import '../AiConfig.css';
import './PlatformSetting.css';

/**
 * Platform admin Settings — AI Configuration only (no general / email forms).
 */
export default function PlatformSetting() {
  return (
    <div className="pst-root">
      <div className="pst-inner">
        <header className="pst-head">
          <h1 className="pst-title">Settings</h1>
          <p className="pst-sub">Configure platform-wide parameters and defaults.</p>
        </header>

        <section className="pst-ai-slot" aria-label="AI Configuration">
          <AiConfig embedded />
        </section>
      </div>
    </div>
  );
}
