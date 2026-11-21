import { describe, expect, it } from 'vitest'
import { parseBulkEntries } from '../src/core/bulkAttendance'
import { parseEvaluationEntries } from '../src/core/bulkEvaluation'

describe('parseBulkEntries', () => {
  it('separates codes, names, duplicates, and invalid tokens', () => {
    const parsed = parseBulkEntries('3766\n3766\nأحمد\nAB')
    expect(parsed.codes.map((row) => row.code)).toEqual(['3766'])
    expect(parsed.names.map((row) => row.query)).toEqual(['أحمد'])
    expect(parsed.duplicates).toEqual(['3766'])
    expect(parsed.invalid).toContain('AB')
  })

  it('normalizes Arabic-Indic digits into a usable code', () => {
    const parsed = parseBulkEntries('٣٧٦٦')
    expect(parsed.codes.map((row) => row.code)).toEqual(['3766'])
  })
})

describe('parseEvaluationEntries', () => {
  it('reads code, exam, and homework grade tokens', () => {
    const parsed = parseEvaluationEntries('3766, 9, امتياز')
    expect(parsed.invalid).toEqual([])
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].identifier).toBe('3766')
    expect(parsed.entries[0].values).toEqual({ exam: '9', homework: 'امتياز' })
  })

  it('marks two numeric values for a user decision', () => {
    const parsed = parseEvaluationEntries('3766, 9, 10')
    expect(parsed.entries[0].ambiguousNumbers).toBe(true)
    expect(parsed.entries[0].numberTokens).toEqual(['9', '10'])
  })

  it('rejects lines without a value', () => {
    const parsed = parseEvaluationEntries('3766')
    expect(parsed.entries).toEqual([])
    expect(parsed.invalid).toEqual(['3766'])
  })
})
