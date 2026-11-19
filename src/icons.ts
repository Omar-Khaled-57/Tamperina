import flipHorizontal from 'lucide-static/icons/flip-horizontal.svg?raw'
import pause from 'lucide-static/icons/pause.svg?raw'
import play from 'lucide-static/icons/play.svg?raw'
import lock from 'lucide-static/icons/lock.svg?raw'
import lockOpen from 'lucide-static/icons/lock-open.svg?raw'
import pointerOff from 'lucide-static/icons/mouse-pointer-2-off.svg?raw'
import minus from 'lucide-static/icons/minus.svg?raw'
import plus from 'lucide-static/icons/plus.svg?raw'
import sliders from 'lucide-static/icons/sliders-horizontal.svg?raw'
import listChecks from 'lucide-static/icons/list-checks.svg?raw'
import undo from 'lucide-static/icons/undo-2.svg?raw'
import redo from 'lucide-static/icons/redo-2.svg?raw'
import history from 'lucide-static/icons/history.svg?raw'
import shieldAlert from 'lucide-static/icons/shield-alert.svg?raw'
import x from 'lucide-static/icons/x.svg?raw'
import building2 from 'lucide-static/icons/building-2.svg?raw'
import school from 'lucide-static/icons/school.svg?raw'
import wallet from 'lucide-static/icons/wallet.svg?raw'

export const icons = {
  flip: flipHorizontal,
  pause,
  play,
  lock,
  lockOpen,
  clickThrough: pointerOff,
  pin: pointerOff,
  shrink: minus,
  grow: plus,
  toggles: sliders,
  bulk: listChecks,
  undo,
  redo,
  history,
  shieldAlert,
  close: x,
  center: building2,
  school,
  payment: wallet,
} as const
