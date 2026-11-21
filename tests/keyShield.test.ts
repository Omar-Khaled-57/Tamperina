import { beforeEach, describe, expect, it } from 'vitest'
import { installKeyShield, isEditableTarget, isGlobalShortcutKey } from '../src/ui/keyShield'

const HOST_ID = 'tamperina-root'

function mountShadowInput(): HTMLInputElement {
  document.body.innerHTML = `<div id="${HOST_ID}"></div>`
  const host = document.getElementById(HOST_ID)!
  const shadow = host.attachShadow({ mode: 'open' })
  const input = document.createElement('input')
  shadow.appendChild(input)
  input.focus()
  return input
}

describe('shadow key shield', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('recognizes editable fields and global shortcuts', () => {
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    const escape = new KeyboardEvent('keydown', { key: 'Escape' })
    expect(isGlobalShortcutKey(escape)).toBe(true)
    expect(isGlobalShortcutKey(new KeyboardEvent('keydown', { key: 'l' }))).toBe(false)
  })

  it('stops the platform scanner from cancelling printable keys in the modal', () => {
    const input = mountShadowInput()
    installKeyShield(HOST_ID)

    // Mimic the platform: a capture-phase handler that cancels keys unless its
    // target looks like a form field. Without the shield, the shadow event is
    // retargeted to the host <div> and the first keystroke is swallowed.
    document.addEventListener('keydown', (event) => {
      if (!isEditableTarget(event.target)) event.preventDefault()
    }, true)

    const event = new KeyboardEvent('keydown', {
      key: 'l', code: 'KeyL', bubbles: true, composed: true, cancelable: true,
    })
    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(event.target).toBe(input)
  })

  it('leaves keyboard events outside Tamperina alone', () => {
    document.body.innerHTML = '<input id="outside">'
    installKeyShield(HOST_ID)
    const input = document.getElementById('outside') as HTMLInputElement
    const event = new KeyboardEvent('keydown', {
      key: 'l', code: 'KeyL', bubbles: true, cancelable: true,
    })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(event.target).toBe(input)
  })
})
