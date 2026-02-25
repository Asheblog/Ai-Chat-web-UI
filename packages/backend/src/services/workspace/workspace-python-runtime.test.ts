import { extractMissingModuleRequirements } from './workspace-python-runtime'

describe('workspace-python-runtime requirement extraction', () => {
  it('extracts safe missing modules', () => {
    const output = [
      "ModuleNotFoundError: No module named pandas",
      "ModuleNotFoundError: No module named docx",
    ].join('\n')

    expect(extractMissingModuleRequirements(output)).toEqual(
      expect.arrayContaining(['pandas', 'python-docx']),
    )
  })

  it('ignores unsafe requirement formats', () => {
    const output = [
      "No module named git+https://evil.example/repo.git",
      "No module named http://evil.example/pkg",
      "No module named /tmp/localpkg",
      "No module named ..\secret",
    ].join('\n')

    expect(extractMissingModuleRequirements(output)).toEqual([])
  })
})
