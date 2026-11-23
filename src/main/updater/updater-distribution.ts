import { app } from 'electron'

export function supportsPackagedUpdates(): boolean {
  return app.isPackaged && !app.getVersion().includes('-trae.')
}
