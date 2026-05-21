import { useSearchParams } from 'react-router-dom';
import { Sparkles, Radio } from 'lucide-react';
import AiConfig from '../AiConfig';
import TtsManagement from '../TtsManagement';
import '../AiConfig.css';
import '../TtsManagement.css';
import './PlatformSetting.css';

const TABS = [
  { id: 'config', label: 'Configuration settings', Icon: Sparkles },
  { id: 'tts', label: 'TTS Management', Icon: Radio },
];

/**
 * Platform admin Settings — AI configuration and TTS management in one page.
 */
export default function PlatformSetting() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'tts' ? 'tts' : 'config';

  function selectTab(tabId) {
    if (tabId === 'config') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: 'tts' }, { replace: true });
    }
  }

  return (
    <div className="pst-root">
      <div className="pst-inner">
        <header className="pst-head">
          <h1 className="pst-title">Settings</h1>
          <p className="pst-sub">Configure platform-wide parameters and defaults.</p>
        </header>

        <nav className="pst-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`pst-tab${isActive ? ' pst-tab--active' : ''}`}
                onClick={() => selectTab(id)}
              >
                <Icon size={16} aria-hidden />
                {label}
              </button>
            );
          })}
        </nav>

        <section
          className={`pst-panel${activeTab === 'tts' ? ' pst-tts-slot' : ''}`}
          aria-label={activeTab === 'tts' ? 'TTS configuration' : 'AI Configuration'}
          role="tabpanel"
        >
          {activeTab === 'config' ? <AiConfig embedded /> : <TtsManagement embedded />}
        </section>
      </div>
    </div>
  );
}
