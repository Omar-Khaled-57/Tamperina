import { examIdFromPath, examTargetAllowed, isExamPagePath } from './examGuards'

/**
 * Pure rules for local-vs-remote bulk mode. Kept outside ui.ts so the page
 * gating and the cross-tab input validation can be tested without a DOM.
 */

/** The four actions that share the preview → arm → run pipeline. */
export const BULK_RUN_KINDS = ['attendance', 'evaluation', 'exam-attendance', 'exam-evaluation'] as const

export type BulkRunKind = (typeof BULK_RUN_KINDS)[number]

export function isBulkRunKind(kind: string): kind is BulkRunKind {
  return (BULK_RUN_KINDS as readonly string[]).includes(kind)
}

/** Normalize a path for comparison (a trailing slash is insignificant). */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/$/, '')
}

/** Human-readable page hint. Exam actions run on whichever exam page is open. */
export function bulkLocalPath(kind: BulkRunKind): string {
  switch (kind) {
    case 'attendance': return '/attendance/scan'
    case 'evaluation': return '/evaluation'
    case 'exam-attendance':
    case 'exam-evaluation': return '/comprehensive-exams/<id>'
  }
}

/** Local mode requires being on the page that owns the bulk action. */
export function bulkKindMatchesPath(kind: string, pathname: string): boolean {
  if (!isBulkRunKind(kind)) return false
  if (kind === 'exam-attendance' || kind === 'exam-evaluation') return isExamPagePath(pathname)
  return normalizePath(pathname) === bulkLocalPath(kind)
}

/**
 * Match a bridge tab's advertised `path + search` against the page an action
 * needs. Ordinary actions use `lesson_id`; exam actions use the exam id in the
 * path. The id must be supplied explicitly so no arbitrary tab is chosen.
 */
export function remoteTargetMatches(targetPath: string, kind: BulkRunKind, targetId: string): boolean {
  let url: URL
  try {
    url = new URL(targetPath, 'https://tamperina.local')
  } catch {
    return false
  }
  if (!bulkKindMatchesPath(kind, url.pathname)) return false
  const id = targetId.trim()
  if (!id) return false
  if (kind === 'exam-attendance' || kind === 'exam-evaluation') {
    return examIdFromPath(url.pathname) === id
  }
  return url.searchParams.get('lesson_id') === id
}

/** Kinds a tab on this path may execute as a remote target. */
export function supportedBulkKinds(pathname: string): BulkRunKind[] {
  return BULK_RUN_KINDS.filter((kind) => bulkKindMatchesPath(kind, pathname))
}

/**
 * Source-side validation before a request is sent. The target tab still runs
 * the same preview/arm guards it uses for its own local actions.
 */
export function remoteInputAllowed(kind: string, text: string): boolean {
  if (!isBulkRunKind(kind) || !text.trim()) return false
  if (kind === 'exam-attendance' || kind === 'exam-evaluation') return examTargetAllowed(kind, text)
  return true
}
