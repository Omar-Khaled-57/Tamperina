/**
 * Feature registry. M0 kept this empty while the shell was being tuned.
 * M1 adds the first real toggle: reversible attendance actions.
 */
export interface Feature {
  id: string
  label: string
  description?: string
  defaultEnabled: boolean
}

export const registeredFeatures: Feature[] = [
  {
    id: 'undo-redo',
    label: 'التراجع وإعادة التنفيذ',
    description: 'Ctrl+Z / Ctrl+Y لعمليات الحضور والتقييم',
    defaultEnabled: true,
  },
]

export function registerFeature(feature: Feature): void {
  registeredFeatures.push(feature)
}
