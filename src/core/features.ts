/**
 * Feature registry.
 * M1: reversible attendance/grading actions.
 * M2: bulk attendance entry via the scan form.
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
    description: 'Ctrl+Z / Ctrl+Y لعمليات الحضور والتقييم (يدعم الإلغاء الجماعي)',
    defaultEnabled: true,
  },
  {
    id: 'bulk-attendance',
    label: 'الإجراءات الجماعية',
    description: 'حضور جماعي (أكواد/أسماء) مع تحليل وتسليح وتراجع دفعة واحدة، مع بنود جماعية أخرى',
    defaultEnabled: true,
  },
]

export function registerFeature(feature: Feature): void {
  registeredFeatures.push(feature)
}
