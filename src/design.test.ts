import { describe, expect, it } from "vitest"
import { designFromResponse, parseDesign } from "./design"

describe("design", () => {
  it("accepts only a or b", () => {
    expect(parseDesign("a")).toBe("a")
    expect(parseDesign("b")).toBe("b")
    expect(parseDesign("B")).toBeNull()
    expect(parseDesign("split")).toBeNull()
    expect(parseDesign(null)).toBeNull()
  })

  it("reads data.design from the Player API envelope", () => {
    expect(designFromResponse({ status: "OK", data: { design: "b" } })).toBe("b")
    expect(designFromResponse({ status: "OK", data: { design: "c" } })).toBeNull()
    expect(designFromResponse({ status: "OK" })).toBeNull()
    expect(designFromResponse("b")).toBeNull()
    expect(designFromResponse(null)).toBeNull()
  })
})
