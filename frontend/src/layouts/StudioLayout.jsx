/**
 * StudioLayout — full-screen layout for the Audio Sync, FXL, image-editor,
 * and zoning studio pages.
 *
 * These pages own their own internal sidebars and chrome; the wrapper just
 * provides a 100vh flex container and renders <Outlet />.
 */
import { Outlet } from 'react-router-dom';
import './StudioLayout.css';

export default function StudioLayout() {
  return (
    <div className="studio-layout">
      <main className="studio-layout__main">
        <Outlet />
      </main>
    </div>
  );
}
