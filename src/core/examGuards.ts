import { parseBulkEntries } from './bulkAttendance'
import { parseEvaluationEntries } from './bulkEvaluation'

/**
 * Pure rules for comprehensive-exam pages. The exam id and student codes come
 * from the current URL and the user's input; no exam or student is privileged.
 */

export const COMPREHENSIVE_EXAMS_PREFIX = '/comprehensive-exams/'

/** The id of the exam whose own page is open, if any. */
export function examIdFromPath(pathname: string): string | null {
  const match = pathname.replace(/\/$/, '').match(/^\/comprehensive-exams\/(\d+)$/)
  return match?.[1] ?? null
}

/** Any comprehensive-exams page can host the in-page WhatsApp hold notice. */
export function isComprehensiveExamsPath(pathname: string): boolean {
  return pathname.startsWith(COMPREHENSIVE_EXAMS_PREFIX)
}

/** A tab can run exam actions only from an exam's own page. */
export function isExamPagePath(pathname: string): boolean {
  return examIdFromPath(pathname) !== null
}

export function examPagePath(examId: string): string {
  return `${COMPREHENSIVE_EXAMS_PREFIX}${examId.trim()}`
}

export function isExamBulkKind(kind: string): boolean {
  return kind === 'exam-attendance' || kind === 'exam-evaluation'
}

/** Validate the shape of exam input without restricting which students it names. */
export function examTargetAllowed(kind: string, text: string): boolean {
  if (kind === 'exam-attendance') {
    const parsed = parseBulkEntries(text)
    return parsed.codes.length > 0 && parsed.names.length === 0 && parsed.invalid.length === 0
  }
  if (kind === 'exam-evaluation') {
    const parsed = parseEvaluationEntries(text)
    return parsed.entries.length > 0 && parsed.invalid.length === 0
  }
  return true
}

/** Re-check resolved rows too, so a rematch cannot silently drop everything. */
export function examEvalCodesAllowed(codes: string[]): boolean {
  return codes.length > 0 && codes.every((code) => !!code.trim())
}
