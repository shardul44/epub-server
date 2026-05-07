/**
 * MainContent — scrollable content area for org-admin pages.
 *
 * Wraps children in the `ds-container` div which provides
 * consistent padding and gap between sections.
 *
 * Props:
 *   children  {ReactNode}
 *   className {string}    Optional extra class names
 */
const MainContent = ({ children, className = '' }) => (
  <div className={`ds-container${className ? ` ${className}` : ''}`}>
    {children}
  </div>
);

export default MainContent;
