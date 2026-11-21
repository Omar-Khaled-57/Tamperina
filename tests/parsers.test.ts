import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseBulkEntries,
  resolveNameEntry,
  searchStudents,
  type NameRow,
} from '../src/core/bulkAttendance'
import { parseEvaluationEntries } from '../src/core/bulkEvaluation'

const rosterStudent = {
  id: '88',
  name: 'سارة',
  student_profile: { student_code: '3766' },
}

function mockStudentResponse(resolveQuery: (query: string) => unknown[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    return {
      ok: true,
      json: async () => resolveQuery(url.searchParams.get('q') ?? ''),
    } as Response
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

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

describe('student ID resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="scanForm" data-students-url="/api/students" data-lesson-id="77">
        <input name="student" />
      </form>
    `
  })

  it('falls back to the lesson roster when the platform name search misses an ID', async () => {
    const fetchMock = mockStudentResponse((query) => query === '3766' ? [] : [rosterStudent])

    const result = await searchStudents('3766', '77')

    expect(result).toEqual([{ id: '88', name: 'سارة', code: '3766' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const queries = fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('q'))
    expect(queries).toEqual(['3766', ''])
  })

  it('resolves an ID row to the same identity fields as a name row', async () => {
    mockStudentResponse((query) => query === '3766' ? [] : [rosterStudent])
    const base: NameRow = {
      kind: 'name',
      key: 'base',
      raw: '',
      query: '',
      status: 'loading',
      candidates: [],
    }

    const byId = await resolveNameEntry({ ...base, key: 'code-1', raw: '3766', query: '3766' }, '77')
    const byName = await resolveNameEntry({ ...base, key: 'name-1', raw: 'سارة', query: 'سارة' }, '77')

    expect(byId.status).toBe('resolved')
    expect(byId.code).toBe('3766')
    expect(byId.studentName).toBe('سارة')
    expect(byId.candidates).toEqual(byName.candidates)
    expect(byId.message).toBe(byName.message)
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
