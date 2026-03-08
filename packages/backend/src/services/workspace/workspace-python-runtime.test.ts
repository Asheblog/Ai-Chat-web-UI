import {
  extractMissingModuleRequirements,
  normalizeDeclaredArtifactPaths,
  selectDeclaredArtifactsFromChangedPaths,
} from './workspace-python-runtime'

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

describe('workspace-python-runtime artifact declarations', () => {
  it('normalizes declared artifact paths across linux/windows style inputs', () => {
    expect(
      normalizeDeclaredArtifactPaths([
        'report.xlsx',
        '/workspace/artifacts/result.csv',
        'workspace/artifacts\\nested\\out.txt',
        './artifacts/summary.md',
        'artifacts/../secret.txt',
        '../outside.txt',
        '',
      ]),
    ).toEqual([
      'artifacts/report.xlsx',
      'artifacts/result.csv',
      'artifacts/nested/out.txt',
      'artifacts/summary.md',
    ])
  })

  it('only publishes files that are both changed and declared', () => {
    const changed = [
      'artifacts/report.xlsx',
      'artifacts/tmp.log',
      'artifacts/nested/summary.md',
    ]

    expect(
      selectDeclaredArtifactsFromChangedPaths(changed, [
        'report.xlsx',
        'artifacts/nested/summary.md',
      ]),
    ).toEqual([
      'artifacts/nested/summary.md',
      'artifacts/report.xlsx',
    ])
  })

  it('publishes nothing when downloadable_files is omitted', () => {
    const changed = ['artifacts/report.xlsx']
    expect(selectDeclaredArtifactsFromChangedPaths(changed, undefined)).toEqual([])
  })
})
