import { describe, expect, it } from 'vitest'
import {
  examEvalCodesAllowed,
  examIdFromPath,
  examPagePath,
  examTargetAllowed,
  isComprehensiveExamsPath,
  isExamBulkKind,
  isExamPagePath,
} from '../src/core/examGuards'

describe('exam path and kind guards', () => {
  it('derives any exam ID from the URL, tolerating a trailing slash', () => {
    expect(examIdFromPath('/comprehensive-exams/16')).toBe('16')
    expect(examIdFromPath('/comprehensive-exams/16/')).toBe('16')
    expect(examIdFromPath('/comprehensive-exams/9876')).toBe('9876')
    expect(examIdFromPath('/comprehensive-exams')).toBeNull()
    expect(examIdFromPath('/comprehensive-exams/16/grades')).toBeNull()
    expect(examIdFromPath('/attendance/scan')).toBeNull()
  })

  it('treats every comprehensive-exams detail page as an exam page', () => {
    expect(isExamPagePath('/comprehensive-exams/16')).toBe(true)
    expect(isExamPagePath('/comprehensive-exams/9876/')).toBe(true)
    expect(isExamPagePath('/comprehensive-exams/16/grades')).toBe(false)
    expect(isExamPagePath('/attendance/scan')).toBe(false)
    expect(examPagePath('9876')).toBe('/comprehensive-exams/9876')
  })

  it('recognizes every comprehensive-exams page for the hold notice', () => {
    expect(isComprehensiveExamsPath('/comprehensive-exams/16')).toBe(true)
    expect(isComprehensiveExamsPath('/comprehensive-exams/9876/grades')).toBe(true)
    expect(isComprehensiveExamsPath('/comprehensive-exams')).toBe(false)
    expect(isComprehensiveExamsPath('/attendance/scan')).toBe(false)
  })

  it('advertises only the two exam bulk kinds', () => {
    expect(isExamBulkKind('exam-attendance')).toBe(true)
    expect(isExamBulkKind('exam-evaluation')).toBe(true)
    expect(isExamBulkKind('attendance')).toBe(false)
    expect(isExamBulkKind('evaluation')).toBe(false)
    expect(isExamBulkKind('unknown')).toBe(false)
  })
})

describe('examTargetAllowed', () => {
  it('accepts student codes and names for exam attendance', () => {
    expect(examTargetAllowed('exam-attendance', '3766')).toBe(true)
    expect(examTargetAllowed('exam-attendance', ' 3766 \n')).toBe(true)
    expect(examTargetAllowed('exam-attendance', '1234')).toBe(true)
    expect(examTargetAllowed('exam-attendance', '3766\n1234')).toBe(true)
    expect(examTargetAllowed('exam-attendance', 'ABC-99')).toBe(true)
    expect(examTargetAllowed('exam-attendance', 'أحمد')).toBe(true)
    expect(examTargetAllowed('exam-attendance', '3766\nأحمد')).toBe(true)
    expect(examTargetAllowed('exam-attendance', '3766\nAB')).toBe(false)
    expect(examTargetAllowed('exam-attendance', '')).toBe(false)
  })

  it('accepts any student code, including several, for exam evaluation', () => {
    expect(examTargetAllowed('exam-evaluation', '3766, 9, امتياز')).toBe(true)
    expect(examTargetAllowed('exam-evaluation', '1234, 9, جيد')).toBe(true)
    expect(examTargetAllowed('exam-evaluation', '1234, 9')).toBe(true)
    expect(examTargetAllowed('exam-evaluation', '3766, 9\n1234, 8')).toBe(true)
    expect(examTargetAllowed('exam-evaluation', '3766')).toBe(false)
  })

  it('does not restrict unrelated bulk kinds', () => {
    expect(examTargetAllowed('attendance', '1234')).toBe(true)
    expect(examTargetAllowed('anything', '')).toBe(true)
  })
})

describe('examEvalCodesAllowed', () => {
  it('re-checks resolved codes so a rematch cannot silently drop every row', () => {
    expect(examEvalCodesAllowed(['1234'])).toBe(true)
    expect(examEvalCodesAllowed(['3766', '1234'])).toBe(true)
    expect(examEvalCodesAllowed([])).toBe(false)
    expect(examEvalCodesAllowed([''])).toBe(false)
    expect(examEvalCodesAllowed(['  '])).toBe(false)
  })
})
