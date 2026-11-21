import { initEvaluationTools } from './core/evaluation'
import { initUndoRedo } from './core/undoRedo'
import { mountShell } from './core/ui'

// Patch network observers before the platform can issue any requests. Each
// subsystem is isolated so a failure in one cannot take down the whole script.
function safeInit(label: string, init: () => void): void {
  try {
    init()
  } catch (error) {
    console.error(`[Tamperina] ${label} failed to initialize`, error)
  }
}

safeInit('undo/redo', initUndoRedo)
safeInit('evaluation tools', initEvaluationTools)

function start(): void {
  safeInit('shell', mountShell)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
