export interface DesktopMediaSelection {
  streamId: string
  desktopAudio: boolean
}

const DESKTOP_CAPTURE_SOURCES: `${chrome.desktopCapture.DesktopCaptureSourceType}`[] =
  ["tab", "window", "screen", "audio"]

export function chooseDesktopMediaStream(): Promise<DesktopMediaSelection> {
  return new Promise((resolve, reject) => {
    if (!chrome.desktopCapture?.chooseDesktopMedia) {
      reject(new Error("Desktop capture is unavailable"))
      return
    }

    chrome.desktopCapture.chooseDesktopMedia(
      DESKTOP_CAPTURE_SOURCES,
      (streamId, options) => {
        if (!streamId) {
          reject(new Error("Recording cancelled"))
          return
        }
        resolve({
          streamId,
          desktopAudio: !!options?.canRequestAudioTrack
        })
      }
    )
  })
}
