import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
}

const DISMISS_KEY = 'ultron-pwa-install-dismissed'

type DeviceKind = 'iphone' | 'ipad' | 'android' | 'other'

function detectDevice(): DeviceKind {
  const ua = navigator.userAgent
  // iPadOS 12 and earlier includes "iPad" in the UA string.
  // iPadOS 13+ reports as "Macintosh" but has maxTouchPoints > 1.
  if (/ipad/i.test(ua)) return 'ipad'
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ipad'
  if (/iphone|ipod/i.test(ua)) return 'iphone'
  if (/android/i.test(ua)) return 'android'
  return 'other'
}

function isRunningStandalone(): boolean {
  return (
    ('standalone' in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [device, setDevice] = useState<DeviceKind>('other')

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return
    if (isRunningStandalone()) return

    const kind = detectDevice()
    setDevice(kind)

    if (kind === 'iphone' || kind === 'ipad') {
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

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setShowBanner(false)
  }

  const isIOS = device === 'iphone' || device === 'ipad'
  const isIPad = device === 'ipad'

  const shareIconHint = isIPad
    ? 'Tap the Share icon (□↑) in the toolbar, then "Add to Home Screen"'
    : 'Tap the Share button (□↑) at the bottom, then "Add to Home Screen"'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        borderTop: '1px solid rgba(99,102,241,0.35)',
        padding: '14px 20px',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isIPad ? '📱 Install Ultron on your iPad' : isIOS ? '📱 Install Ultron on your iPhone' : '📱 Install Ultron'}
        </div>
        {isIOS ? (
          <div style={{ fontSize: 12, color: '#b0b8d4', marginTop: 4, lineHeight: 1.4 }}>
            {shareIconHint}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#b0b8d4', marginTop: 4 }}>
            Add to your home screen for the full app experience
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {!isIOS && (
          <button
            onClick={() => void handleInstall()}
            style={{
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '9px 18px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
              whiteSpace: 'nowrap',
            }}
          >
            Install
          </button>
        )}
        {isIOS && (
          <div
            style={{
              background: 'rgba(99,102,241,0.18)',
              border: '1px solid rgba(99,102,241,0.5)',
              borderRadius: 10,
              padding: '9px 14px',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'default',
              userSelect: 'none',
            }}
            aria-hidden="true"
          >
            □↑
          </div>
        )}
        <button
          onClick={handleDismiss}
          style={{
            background: 'transparent',
            color: '#9ca3af',
            border: '1px solid #374151',
            borderRadius: 10,
            padding: '9px 14px',
            cursor: 'pointer',
            fontSize: 13,
            whiteSpace: 'nowrap',
          }}
        >
          Later
        </button>
      </div>
    </div>
  )
}
