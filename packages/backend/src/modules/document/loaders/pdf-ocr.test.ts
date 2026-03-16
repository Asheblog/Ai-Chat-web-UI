import { splitOcrSidecarText } from './pdf-ocr'

describe('splitOcrSidecarText', () => {
  it('should split pages by form-feed and remove empty pages', () => {
    const pages = splitOcrSidecarText('第一页内容\f\n\f第二页内容\f  ')
    expect(pages).toEqual(['第一页内容', '第二页内容'])
  })
})

