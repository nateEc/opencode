import { expect, test } from "bun:test"
import type { SelectionBehavior } from "@opentui/core"
import type { ClipboardService } from "../../src/context/clipboard"
import { Selection, copy, copyOnSelectRelease } from "../../src/util/selection"

function renderer() {
  return {
    getSelection: () => ({
      getSelectedText: () => "beta",
      selectedRenderables: [],
      isStart: false,
      behavior: "cell" as const,
    }),
    clearSelection: () => {},
  }
}

function setup(text: string, isStart: boolean, behavior: SelectionBehavior = "cell") {
  const writes: string[] = []
  let clears = 0
  const clipboard: ClipboardService = {
    read: async () => undefined,
    write: async (value) => {
      writes.push(value)
    },
  }
  const renderer = {
    getSelection: () => ({ getSelectedText: () => text, selectedRenderables: [], isStart, behavior }),
    clearSelection: () => {
      clears++
    },
    currentFocusedRenderable: null,
  }
  const toast = { show: () => {}, error: () => {} }
  return { clipboard, renderer, toast, writes, clears: () => clears }
}

test("copy writes selected text without clearing the highlight", () => {
  let cleared = false
  const copied = copy(
    {
      getSelection: () => ({
        getSelectedText: () => "beta",
        selectedRenderables: [],
        isStart: false,
        behavior: "cell",
      }),
      clearSelection: () => {
        cleared = true
      },
    },
    { show: () => {}, error: () => {} },
    {
      async read() {
        return undefined
      },
      async write() {},
    },
  )
  expect(copied).toBe(true)
  expect(cleared).toBe(false)
})

test("copy-on-select ignores a later non-drag release", () => {
  const writes: string[] = []
  const clipboard = {
    async read() {
      return undefined
    },
    async write(value: string) {
      writes.push(value)
    },
  }
  const toast = { show: () => {}, error: () => {} }
  expect(copyOnSelectRelease({}, renderer(), toast, clipboard)).toBe(false)
  expect(copyOnSelectRelease({ isDragging: false }, renderer(), toast, clipboard)).toBe(false)
  expect(copyOnSelectRelease({ isDragging: true }, renderer(), toast, clipboard)).toBe(true)
  expect(writes).toEqual(["beta"])
})

test("copy-on-select preserves a click-only selection for subsequent clicks", () => {
  const value = setup("", true)
  expect(copyOnSelectRelease({ isDragging: true }, value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual([])
})

test.each(["word", "line"] as const)("copy-on-select copies a %s selection without pointer movement", (behavior) => {
  const value = setup("selected", true, behavior)
  expect(copyOnSelectRelease({ isDragging: true }, value.renderer, value.toast, value.clipboard)).toBeTrue()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual(["selected"])
})

test("ignores a click-only selection without copying or clearing", () => {
  const value = setup("x", true)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual([])
})

test("ignores an empty dragged selection without copying or clearing", () => {
  const value = setup("", false)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeFalse()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual([])
})

test("copies a non-empty dragged selection without clearing its highlight", async () => {
  const value = setup("selected", false)
  expect(Selection.copy(value.renderer, value.toast, value.clipboard)).toBeTrue()
  await Promise.resolve()
  expect(value.clears()).toBe(0)
  expect(value.writes).toEqual(["selected"])
})

test("optionally clears a selection only after its clipboard write succeeds", async () => {
  const pending = Promise.withResolvers<void>()
  let clears = 0
  const selection = {
    getSelectedText: () => "selected",
    selectedRenderables: [],
    isStart: false,
    behavior: "cell" as const,
  }
  const renderer = { getSelection: () => selection, clearSelection: () => clears++ }
  const clipboard = { read: async () => undefined, write: () => pending.promise }
  const toast = { show: () => {}, error: () => {} }

  expect(copyOnSelectRelease({ isDragging: true }, renderer, toast, clipboard, true)).toBeTrue()
  expect(clears).toBe(0)
  pending.resolve()
  await pending.promise
  await Promise.resolve()
  expect(clears).toBe(1)
})

test("does not clear a newer selection after an earlier clipboard write", async () => {
  const pending = Promise.withResolvers<void>()
  let clears = 0
  const first = { getSelectedText: () => "first", selectedRenderables: [], isStart: false, behavior: "cell" as const }
  const second = { ...first, getSelectedText: () => "second" }
  let selection = first
  const renderer = { getSelection: () => selection, clearSelection: () => clears++ }
  const clipboard = { read: async () => undefined, write: () => pending.promise }
  const toast = { show: () => {}, error: () => {} }

  copyOnSelectRelease({ isDragging: true }, renderer, toast, clipboard, true)
  selection = second
  pending.resolve()
  await pending.promise
  await Promise.resolve()
  expect(clears).toBe(0)
})

test("retains selection if the clipboard write fails", async () => {
  const pending = Promise.withResolvers<void>()
  let clears = 0
  let errors = 0
  const selection = {
    getSelectedText: () => "selected",
    selectedRenderables: [],
    isStart: false,
    behavior: "cell" as const,
  }
  const renderer = { getSelection: () => selection, clearSelection: () => clears++ }
  const clipboard = { read: async () => undefined, write: () => pending.promise }
  const toast = { show: () => {}, error: () => errors++ }

  copyOnSelectRelease({ isDragging: true }, renderer, toast, clipboard, true)
  pending.reject(new Error("clipboard unavailable"))
  await pending.promise.catch(() => {})
  await Promise.resolve()
  expect(clears).toBe(0)
  expect(errors).toBe(1)
})

test("does not clear a selection being extended while the clipboard write is pending", async () => {
  const pending = Promise.withResolvers<void>()
  let clears = 0
  const selection = {
    getSelectedText: () => "selected",
    selectedRenderables: [],
    isStart: false,
    isDragging: false,
    behavior: "cell" as const,
  }
  const renderer = { getSelection: () => selection, clearSelection: () => clears++ }
  const clipboard = { read: async () => undefined, write: () => pending.promise }
  const toast = { show: () => {}, error: () => {} }

  copyOnSelectRelease({ isDragging: true }, renderer, toast, clipboard, true)
  selection.isDragging = true
  pending.resolve()
  await pending.promise
  await Promise.resolve()
  expect(clears).toBe(0)
})
