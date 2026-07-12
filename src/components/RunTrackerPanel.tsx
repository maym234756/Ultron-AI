import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Download, MapPin, Play, Square, Trash2, X } from 'lucide-react'

type TrackPoint = {
  latitude: number
  longitude: number
  accuracy: number | null
  altitude: number | null
  speed: number | null
  heading: number | null
  timestamp: number
}

interface Props {
  onClose: () => void
}

const STORAGE_KEY = 'lumivex-run-track-v1'

function toRad(value: number): number {
  return value * Math.PI / 180
}

function distanceMeters(a: TrackPoint, b: TrackPoint): number {
  const radius = 6371000
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDistance(meters: number): string {
  if (meters >= 1609.344) return `${(meters / 1609.344).toFixed(2)} mi`
  return `${Math.round(meters)} m`
}

function buildGpx(points: TrackPoint[]): string {
  const track = points.map(point => [
    `      <trkpt lat="${point.latitude}" lon="${point.longitude}">`,
    point.altitude !== null ? `        <ele>${point.altitude}</ele>` : '',
    `        <time>${new Date(point.timestamp).toISOString()}</time>`,
    '      </trkpt>',
  ].filter(Boolean).join('\n')).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Lumivex AI" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
    '    <name>Lumivex AI Run</name>',
    '    <trkseg>',
    track,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].join('\n')
}

function loadSavedTrack(): TrackPoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TrackPoint[]
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function RunTrackerPanel({ onClose }: Props) {
  const [points, setPoints] = useState<TrackPoint[]>(loadSavedTrack)
  const [tracking, setTracking] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const watchIdRef = useRef<number | null>(null)

  const stats = useMemo(() => {
    const distance = points.reduce((sum, point, index) => index === 0 ? 0 : sum + distanceMeters(points[index - 1], point), 0)
    const first = points[0]
    const last = points[points.length - 1]
    const elapsed = startedAt ? now - startedAt : first && last ? last.timestamp - first.timestamp : 0
    const mph = elapsed > 0 ? (distance / 1609.344) / (elapsed / 3_600_000) : 0
    const pace = mph > 0 ? 60 / mph : 0
    return { distance, elapsed, mph, pace, last }
  }, [now, points, startedAt])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(points))
  }, [points])

  useEffect(() => {
    if (!tracking) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [tracking])

  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
  }, [])

  function startTracking() {
    setError('')
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not available in this browser.')
      return
    }

    const started = Date.now()
    setStartedAt(started)
    setNow(started)
    setTracking(true)
    watchIdRef.current = navigator.geolocation.watchPosition(
      position => {
        const coords = position.coords
        setPoints(current => [
          ...current,
          {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy ?? null,
            altitude: coords.altitude ?? null,
            speed: coords.speed ?? null,
            heading: coords.heading ?? null,
            timestamp: position.timestamp,
          },
        ])
      },
      err => {
        setError(err.message || 'Location permission was denied or unavailable.')
        stopTracking()
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    )
  }

  function stopTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setTracking(false)
    setStartedAt(null)
  }

  function clearTrack() {
    stopTracking()
    setPoints([])
    setError('')
    localStorage.removeItem(STORAGE_KEY)
  }

  function exportGpx() {
    if (points.length === 0) return
    const blob = new Blob([buildGpx(points)], { type: 'application/gpx+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `lumivex-run-${new Date().toISOString().slice(0, 10)}.gpx`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Activity size={16} />
            <span>Run Tracker</span>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="sidebar-action-btn" onClick={tracking ? stopTracking : startTracking}>
              {tracking ? <Square size={13} /> : <Play size={13} />}
              {tracking ? 'Stop' : 'Start'}
            </button>
            <button type="button" className="sidebar-action-btn" onClick={exportGpx} disabled={points.length === 0}>
              <Download size={13} /> Export
            </button>
            <button type="button" className="sidebar-action-btn" onClick={clearTrack} disabled={points.length === 0 && !tracking}>
              <Trash2 size={13} /> Clear
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="panel-body run-tracker-body">
          <div className={`run-tracker-hero ${tracking ? 'tracking' : ''}`}>
            <MapPin size={22} />
            <div>
              <strong>{tracking ? 'Tracking live with your browser permission' : 'Location stays local until you export it'}</strong>
              <span>Lumivex AI uses browser geolocation only after Start is pressed. Points are saved in this browser.</span>
            </div>
          </div>

          {error && <div className="notice">{error}</div>}

          <div className="run-metrics-grid">
            <div className="run-metric"><span>Distance</span><strong>{formatDistance(stats.distance)}</strong></div>
            <div className="run-metric"><span>Time</span><strong>{formatDuration(stats.elapsed)}</strong></div>
            <div className="run-metric"><span>Speed</span><strong>{stats.mph.toFixed(1)} mph</strong></div>
            <div className="run-metric"><span>Pace</span><strong>{stats.pace ? `${stats.pace.toFixed(1)} min/mi` : 'n/a'}</strong></div>
          </div>

          <section className="diagnostics-panel">
            <div className="diagnostics-header">
              <span className="settings-section-title">Live Position</span>
              <p>{points.length.toLocaleString()} point(s) captured</p>
            </div>
            {stats.last ? (
              <div className="diagnostics-columns">
                <div className="diagnostics-card"><strong>Latitude</strong><span>{stats.last.latitude.toFixed(6)}</span></div>
                <div className="diagnostics-card"><strong>Longitude</strong><span>{stats.last.longitude.toFixed(6)}</span></div>
                <div className="diagnostics-card"><strong>Accuracy</strong><span>{stats.last.accuracy ? `${Math.round(stats.last.accuracy)} m` : 'unknown'}</span></div>
                <div className="diagnostics-card"><strong>Updated</strong><span>{new Date(stats.last.timestamp).toLocaleTimeString()}</span></div>
              </div>
            ) : (
              <p className="panel-hint">Start tracking to capture GPS points from this device.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
