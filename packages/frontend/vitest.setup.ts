import "@testing-library/jest-dom"
import { vi } from "vitest"

// jsdom 的浮层测试只需要观察器生命周期；实际尺寸布局由浏览器验收覆盖。
if (typeof window !== "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom 没有布局引擎；默认桌面断点，手机测试显式指定 matches。
if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query === "(min-width: 768px)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})
