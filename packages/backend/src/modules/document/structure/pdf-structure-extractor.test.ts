import { PDFStructureExtractor } from './pdf-structure-extractor'

describe('PDFStructureExtractor', () => {
  it('should keep page numbers from PDF outline items', () => {
    const extractor = new PDFStructureExtractor()
    const result = extractor.extract(1, [
      {
        title: '第一章',
        pageNumber: 3,
        items: [
          {
            title: '1.1 小节',
            pageNumber: 5,
          },
        ],
      },
    ], [])

    expect(result.detectionMethod).toBe('pdf_outline')
    expect(result.sections[0]?.startPage).toBe(3)
    expect(result.sections[1]?.startPage).toBe(5)
  })
})

