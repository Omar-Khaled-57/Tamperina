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
    label: 'تسجيل الحضور الجماعي',
    description: 'إدخال قائمة أكواد في صفحة الحضور مع معاينة وتسليح وتراجع دفعة واحدة',
    defaultEnabled: true,
  },
]

export function registerFeature(feature: Feature): void {
  registeredFeatures.push(feature)
}
