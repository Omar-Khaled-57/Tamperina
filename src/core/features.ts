/**
 * Feature registry.
 * M1: reversible attendance/grading actions.
 * M2: bulk attendance entry via the scan form.
 */
import { t } from './i18n'

export interface Feature {
  id: string
  label: string
  description?: string
  defaultEnabled: boolean
}

export const registeredFeatures: Feature[] = [
  {
    id: 'undo-redo',
    label: t('core.feature.undoRedo.label'),
    description: t('core.feature.undoRedo.description'),
    defaultEnabled: true,
  },
  {
    id: 'bulk-attendance',
    label: t('core.feature.bulk.label'),
    description: t('core.feature.bulk.description'),
    defaultEnabled: true,
  },
]

export function registerFeature(feature: Feature): void {
  registeredFeatures.push(feature)
}
