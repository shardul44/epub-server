import React from 'react';
import { Info } from 'lucide-react';

export default function ReaderCompatibilityBanner({ compact = false }) {
  if (compact) {
    return (
      <p className="iee-compat" role="note">
        <strong>Reader note:</strong> H5P works in this platform&apos;s web reader. Exported EPUBs show a static
        fallback in Kindle, Apple Books, and other readers without JavaScript.
      </p>
    );
  }

  return (
    <div className="iee-compat" role="note">
      <Info size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <div>
        <strong>Reader compatibility</strong> — H5P activities work best in this platform&apos;s web reader. Kindle,
        Apple Books, and readers that disable JavaScript show a static fallback in exported EPUBs.
      </div>
    </div>
  );
}
