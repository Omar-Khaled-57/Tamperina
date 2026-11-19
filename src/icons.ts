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
import barcode from 'lucide-static/icons/barcode.svg?raw'
import search from 'lucide-static/icons/search.svg?raw'
import chevronUp from 'lucide-static/icons/chevron-up.svg?raw'
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw'
import userCheck from 'lucide-static/icons/user-check.svg?raw'
import graduationCap from 'lucide-static/icons/graduation-cap.svg?raw'
import keyboard from 'lucide-static/icons/keyboard.svg?raw'
import copy from 'lucide-static/icons/copy.svg?raw'
import download from 'lucide-static/icons/download.svg?raw'
import refreshCw from 'lucide-static/icons/refresh-cw.svg?raw'
import trash from 'lucide-static/icons/trash-2.svg?raw'

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
  barcode: barcode,
  search,
  chevronUp,
  chevronDown,
  userCheck,
  graduationCap,
  keyboard,
  copy,
  download,
  refresh: refreshCw,
  trash,
} as const
