import type { PlasmoCSConfig } from "plasmo"
import { normalizeConsoleEntry } from "../lib/console-errors"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_start"
}

const errors: any[] = []

// Capture unhandled errors
window.addEventListener("error", (event) => {
  const entry = normalizeConsoleEntry({
    level: "error" as const,
    message: event.message,
    source: event.filename,
    line: event.lineno,
    timestamp: Date.now()
  })
  if (entry) errors.push(entry)
})

// Capture unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  const entry = normalizeConsoleEntry({
    level: "error" as const,
    message: `Unhandled Promise Rejection: ${String(event.reason)}`,
    source: location.href,
    timestamp: Date.now()
  })
  if (entry) errors.push(entry)
})

// Flush errors to background periodically
setInterval(() => {
  if (errors.length > 0) {
    const batch = errors.splice(0, errors.length)
    chrome.runtime.sendMessage({ type: "PAGE_ERRORS", errors: batch }).catch(() => {})
  }
}, 2000)

// Handle messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PAGE_HTML") {
    sendResponse({
      html: document.documentElement.outerHTML,
      text: document.body.innerText
    })
  }
})

export {}
