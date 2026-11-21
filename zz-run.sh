T1=src/renderer/src/components/bots/bot-smart-sort-sources.test.ts
T2=src/renderer/src/components/bots/use-bot-workspace-order.performance.test.tsx
H=src/renderer/src/components/bots/use-bot-workspace-order.ts
pnpm exec vitest run --config config/vitest.config.ts $T1 $T2 src/renderer/src/components/bots/BotSidebarEntry.test.tsx 2>&1 | grep -E 'Tests |FAIL|AssertionError|Error:|expected'
echo ---REVERTED---
git checkout 254f40df844 -- $H && pnpm exec vitest run --config config/vitest.config.ts $T2 2>&1 | grep -E 'Tests |AssertionError|expected'
git checkout HEAD -- . && git status --short
