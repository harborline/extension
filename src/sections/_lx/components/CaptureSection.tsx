export function CaptureSection() {
  const captureScreenshot = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" })
    const link = document.createElement("a")
    link.href = dataUrl
    link.download = `screenshot-${Date.now()}.png`
    link.click()
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Page Capture</h2>
      <p className="text-xs text-fg/40 mb-6">Capture the currently active tab</p>

      <div className="grid grid-cols-1 gap-4">
        <button
          onClick={captureScreenshot}
          className="p-6 rounded-lg bg-card border border-border hover:border-chart-1/40 transition-colors text-center group">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-fg/40 group-hover:text-chart-1 transition-colors">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="text-sm font-medium">Screenshot</span>
          <p className="text-[10px] text-fg/30 mt-1">Visible area as PNG</p>
        </button>
      </div>
    </div>
  )
}
