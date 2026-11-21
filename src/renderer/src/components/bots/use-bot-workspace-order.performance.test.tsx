// @vitest-environment happy-dom
// Guards the bot list's Smart sort: each bot re-rank walked every workspace's tabs in the fleet.
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { useBotWorkspaceOrder } from './use-bot-workspace-order'

/** Tab reads one bot re-rank makes against a fleet of `workspaces`, after its Smart order went live. */
function tabReadsPerRerank(workspaces: number): number {
  let reads = 0
  const tabs: Record<string, { id: string; title: string }[]> = {}
  for (let i = 0; i < workspaces; i++) {
    tabs[`w${i}`] = [{ id: `t${i}`, title: 'shell' }]
  }
  const counted = new Proxy(tabs, {
    get(target, key, receiver) {
      reads++
      return Reflect.get(target, key, receiver)
    },
    ownKeys(target) {
      reads++
      return Reflect.ownKeys(target)
    }
  })
  // A live PTY ends the cold phase, so the next re-rank runs the live Smart sort.
  useAppStore.setState({ tabsByWorktree: counted, ptyIdsByTabId: { t0: ['pty-0'] } })
  const bot = Array.from({ length: 20 }, (_, i) =>
    makeWorktree({ id: `w${i}`, repoId: 'r', displayName: `w${i}` })
  )
  const hook = renderHook(() => useBotWorkspaceOrder(bot))
  reads = 0
  act(() => useAppStore.setState((s) => ({ settledSortEpoch: s.settledSortEpoch + 1 })))
  const result = reads
  hook.unmount()
  return result
}

it('reads no workspace tabs per bot re-rank, at any fleet size', () => {
  expect(tabReadsPerRerank(200)).toBe(0)
  expect(tabReadsPerRerank(2_000)).toBe(0)
})
