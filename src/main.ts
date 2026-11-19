import { initUndoRedo } from './core/undoRedo'
import { mountShell } from './core/ui'

// Patch network observers before the platform can issue any requests.
initUndoRedo()

function start(): void {
  mountShell()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
