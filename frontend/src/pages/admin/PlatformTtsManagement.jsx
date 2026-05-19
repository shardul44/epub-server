import TtsManagement from '../TtsManagement';
import '../TtsManagement.css';
import './PlatformSetting.css';

/**
 * Platform admin TTS Management — full-width shell matching other admin pages.
 */
export default function PlatformTtsManagement() {
  return (
    <div className="pst-root">
      <div className="pst-inner">
        <header className="pst-head">
          <h1 className="pst-title">TTS Management</h1>
          <p className="pst-sub">Configure text-to-speech providers, voices, and defaults for the platform.</p>
        </header>

        <section className="pst-ai-slot pst-tts-slot" aria-label="TTS configuration">
          <TtsManagement embedded />
        </section>
      </div>
    </div>
  );
}
