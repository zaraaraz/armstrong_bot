import type { ReactNode } from 'react';

/**
 * Modules management. Placeholder until feature modules expose their public
 * enable/disable/config contracts (roadmap Phase 5). The nav links here so the
 * page exists rather than 404s.
 */
export default function ModulesPage(): ReactNode {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Modules</h2>
      <p style={{ color: '#6b7280' }}>
        Per-module enable/disable and configuration lands with the feature
        modules (Phase 5). This page will list each module with a toggle and a
        settings panel driven by the module’s public config contract.
      </p>
    </div>
  );
}
