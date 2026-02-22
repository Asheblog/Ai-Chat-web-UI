import { BUILTIN_SKILLS, buildBuiltinManifest } from '../builtin-skills'

describe('builtin skill manifests', () => {
  it('declares python-runner managed dependencies in manifest', () => {
    const pythonRunner = BUILTIN_SKILLS.find((item) => item.slug === 'python-runner')
    expect(pythonRunner).toBeTruthy()
    expect(pythonRunner?.pythonPackages.length).toBeGreaterThan(0)

    const manifest = buildBuiltinManifest(pythonRunner!)
    expect(Array.isArray(manifest.python_packages)).toBe(true)
    expect(manifest.python_packages).toEqual(pythonRunner?.pythonPackages)
    expect(manifest.python_packages).toContain('numpy')
    expect(manifest.python_packages).toContain('pandas')
  })
})
