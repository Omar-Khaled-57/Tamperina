import { describe, expect, it } from 'vitest'
import {
  bulkKindMatchesPath,
  bulkLocalPath,
  isBulkRunKind,
  remoteInputAllowed,
  remoteTargetMatches,
  supportedBulkKinds,
} from '../src/core/pageGuards'

describe('bulk run kinds', () => {
  it('recognizes only the four preview/arm/run actions', () => {
    expect(isBulkRunKind('attendance')).toBe(true)
    expect(isBulkRunKind('evaluation')).toBe(true)
    expect(isBulkRunKind('exam-attendance')).toBe(true)
    expect(isBulkRunKind('exam-evaluation')).toBe(true)
    expect(isBulkRunKind('export')).toBe(false)
    expect(isBulkRunKind('remote')).toBe(false)
    expect(isBulkRunKind('')).toBe(false)
  })

  it('maps each kind to the page that owns it', () => {
    expect(bulkLocalPath('attendance')).toBe('/attendance/scan')
    expect(bulkLocalPath('evaluation')).toBe('/evaluation')
    expect(bulkLocalPath('exam-attendance')).toBe('/comprehensive-exams/<id>')
    expect(bulkLocalPath('exam-evaluation')).toBe('/comprehensive-exams/<id>')
  })

  it('gates local actions by page and tolerates a trailing slash', () => {
    expect(bulkKindMatchesPath('attendance', '/attendance/scan')).toBe(true)
    expect(bulkKindMatchesPath('attendance', '/attendance/scan/')).toBe(true)
    expect(bulkKindMatchesPath('attendance', '/evaluation')).toBe(false)
    expect(bulkKindMatchesPath('exam-evaluation', '/comprehensive-exams/16')).toBe(true)
    expect(bulkKindMatchesPath('exam-attendance', '/comprehensive-exams/9876/')).toBe(true)
    expect(bulkKindMatchesPath('exam-evaluation', '/comprehensive-exams/16/grades')).toBe(false)
    expect(bulkKindMatchesPath('export', '/attendance/scan')).toBe(false)
  })

  it('advertises the kinds a target tab can execute on its path', () => {
    expect(supportedBulkKinds('/attendance/scan')).toEqual(['attendance'])
    expect(supportedBulkKinds('/evaluation')).toEqual(['evaluation'])
    expect(supportedBulkKinds('/comprehensive-exams/16')).toEqual(['exam-attendance', 'exam-evaluation'])
    expect(supportedBulkKinds('/comprehensive-exams/9876/')).toEqual(['exam-attendance', 'exam-evaluation'])
    expect(supportedBulkKinds('/comprehensive-exams/16/grades')).toEqual([])
  })

  it('picks ordinary targets by lesson ID and exam targets by exam ID in the path', () => {
    expect(remoteTargetMatches('/evaluation?lesson_id=293', 'evaluation', '293')).toBe(true)
    expect(remoteTargetMatches('/evaluation?lesson_id=293', 'evaluation', '294')).toBe(false)
    expect(remoteTargetMatches('/evaluation', 'evaluation', '293')).toBe(false)
    expect(remoteTargetMatches('/evaluation?lesson_id=293', 'evaluation', '')).toBe(false)
    expect(remoteTargetMatches('/evaluation?lesson_id=293&tab=1', 'evaluation', '293')).toBe(true)
    expect(remoteTargetMatches('/attendance/scan?lesson_id=293', 'attendance', '293')).toBe(true)
    expect(remoteTargetMatches('/attendance/scan?lesson_id=293', 'evaluation', '293')).toBe(false)
    expect(remoteTargetMatches('/comprehensive-exams/16', 'exam-evaluation', '16')).toBe(true)
    expect(remoteTargetMatches('/comprehensive-exams/9876/', 'exam-attendance', '9876')).toBe(true)
    expect(remoteTargetMatches('/comprehensive-exams/9876', 'exam-evaluation', '16')).toBe(false)
    expect(remoteTargetMatches('/comprehensive-exams/9876', 'exam-evaluation', '')).toBe(false)
    expect(remoteTargetMatches('::::', 'evaluation', '293')).toBe(false)
  })
})

describe('remoteInputAllowed', () => {
  it('requires non-empty input for an ordinary bulk action', () => {
    expect(remoteInputAllowed('attendance', '3766')).toBe(true)
    expect(remoteInputAllowed('evaluation', '3766, 9')).toBe(true)
    expect(remoteInputAllowed('attendance', '   ')).toBe(false)
  })

  it('accepts any student for exam actions', () => {
    expect(remoteInputAllowed('exam-attendance', '3766')).toBe(true)
    expect(remoteInputAllowed('exam-attendance', '1234')).toBe(true)
    expect(remoteInputAllowed('exam-attendance', '3766\n1234')).toBe(true)
    expect(remoteInputAllowed('exam-evaluation', '3766, 9')).toBe(true)
    expect(remoteInputAllowed('exam-evaluation', '1234, 9')).toBe(true)
    expect(remoteInputAllowed('exam-evaluation', 'أحمد')).toBe(false)
  })

  it('rejects unknown kinds', () => {
    expect(remoteInputAllowed('remote', '3766')).toBe(false)
    expect(remoteInputAllowed('', '3766')).toBe(false)
  })
})
