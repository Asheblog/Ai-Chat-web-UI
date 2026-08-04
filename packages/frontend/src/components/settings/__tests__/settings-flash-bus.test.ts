import { afterEach, describe, expect, test } from "vitest"
import { consumeFlash, isDialogOpen, requestFlash, setDialogOpen } from "../settings-flash-bus"

afterEach(() => {
  consumeFlash() // 无参 = 消费任意残留请求
  setDialogOpen(false)
})

describe("settings-flash-bus", () => {
  test("request 后无参 consume 返回该请求并清空", () => {
    requestFlash({ leafKey: "models", cardKey: "models:catalog" })
    expect(consumeFlash()).toEqual({ leafKey: "models", cardKey: "models:catalog" })
    expect(consumeFlash()).toBeNull()
  })

  test("无请求时 consume 返回 null", () => {
    expect(consumeFlash()).toBeNull()
  })

  test("多次 request 以最后一次为准", () => {
    requestFlash({ leafKey: "models", cardKey: "models:catalog" })
    requestFlash({ leafKey: "branding", cardKey: "branding:avatar" })
    expect(consumeFlash()).toEqual({ leafKey: "branding", cardKey: "branding:avatar" })
  })

  test("consume 带 leafKey/hostId 只消费精确匹配的请求，不匹配则保留", () => {
    requestFlash({ leafKey: "models", cardKey: "models:catalog", hostId: "dialog" })

    // 布局宿主（hostId undefined）消费不到 dialog 的请求
    expect(consumeFlash("models", undefined)).toBeNull()
    // dialog 宿主可以消费
    expect(consumeFlash("models", "dialog")).toEqual({
      leafKey: "models",
      cardKey: "models:catalog",
      hostId: "dialog",
    })
  })

  test("dialog 打开标记：setDialogOpen/isDialogOpen", () => {
    expect(isDialogOpen()).toBe(false)
    setDialogOpen(true)
    expect(isDialogOpen()).toBe(true)
    setDialogOpen(false)
    expect(isDialogOpen()).toBe(false)
  })
})
