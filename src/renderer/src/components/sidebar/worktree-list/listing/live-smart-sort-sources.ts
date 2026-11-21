import type { AppState } from '@/store/types'
import type { SmartSortSources } from '../../../../../../shared/sidebar-list/sorting/smart-sort'

/** Smart sort sources that read each workspace's attention from the incremental agent-status projection. */
export function liveSmartSortSources(state: AppState): SmartSortSources {
  return {
    ...state,
    attentionForWorktree: (worktree, now) =>
      state.agentStatusByPaneKey.projection.attention(worktree.id, worktree.lastActivityAt, now),
    hasFreshAttributedStatus: () => state.agentStatusByPaneKey.projection.hasFreshEvidence()
  }
}
