import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isInStandalone = ('standalone' in window.navigator) && (window.navigator as Navigator & { standalone?: boolean }).standalone

    if (ios && !isInStandalone) {
      setIsIOS(true)
      const timer = window.setTimeout(() => setShowBanner(true), 3000)
      return () => window.clearTimeout(timer)
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
      setShowBanner(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  }, [])

  if (!showBanner) return null

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    setDeferredPrompt(null)
    setShowBanner(false)
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#1a1a2e',
        borderTop: '1px solid #333',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 9999,
        fontFamily: 'system-ui, sans-serif',
        color: '#fff',
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>📱 Install Ultron on your phone</div>
        {isIOS ? (
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
            Tap the Share button ↑ then "Add to Home Screen"
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
            Add to your home screen for the full app experience
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {!isIOS && (
          <button
            onClick={() => void handleInstall()}
            style={{
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Install
          </button>
        )}
        <button
          onClick={() => setShowBanner(false)}
          style={{
            background: 'transparent',
            color: '#aaa',
            border: '1px solid #444',
            borderRadius: 8,
            padding: '8px 12px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Later
        </button>
      </div>
    </div>
  )
}
