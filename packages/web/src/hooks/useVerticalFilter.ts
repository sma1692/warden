import { useEffect, useState } from 'react';
import type { VerticalScope } from '../components/ConsultationKnob';

/**
 * View-local vertical tab state that follows the global filter: picking a tab
 * filters just this view, and changing the global filter resets it.
 * (AgentStudioView intentionally uses an override-once variant instead.)
 */
export function useFollowedVertical(
  activeVertical: VerticalScope
): [VerticalScope, (v: VerticalScope) => void] {
  const [localVertical, setLocalVertical] = useState<VerticalScope>(activeVertical);
  useEffect(() => {
    setLocalVertical(activeVertical);
  }, [activeVertical]);
  return [localVertical, setLocalVertical];
}
