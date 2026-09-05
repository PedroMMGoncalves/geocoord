import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n.jsx'

/**
 * The converted points on a slippy map.
 *
 * Leaflet and its stylesheet are fetched on demand, like SheetJS and JSZip: the
 * map is one section of one tab, and a visitor converting a file to CSV never
 * has to pay for it.
 *
 * The basemaps are the same set as the sibling tools - snap-wkt-generator and
 * dji-mission-planner - so a colleague moving between them finds the same
 * imagery under the same names. The default is dark here rather than light,
 * because this page is dark.
 */

const STORAGE_KEY = 'geocoord:basemap'

// Okabe-Ito blue and vermillion, the same pair app.py uses: distinguishable
// under every common form of colour blindness, which a red/green pair is not.
const COLOR_OK = '#0072B2'
const COLOR_SUSPECT = '#D55E00'

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_PLACES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTR = 'Tiles &copy; Esri'
const CARTO_ATTR = '&copy; OpenStreetMap contributors, &copy; CARTO'

/** name -> a function building the layer, so nothing is created until chosen. */
function baseLayers(L) {
  return {
    dark: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 20, attribution: CARTO_ATTR }),
    light: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 20, attribution: CARTO_ATTR }),
    sat: () => L.tileLayer(ESRI_IMAGERY, { maxZoom: 19, attribution: ESRI_ATTR }),
    hybrid: () => L.layerGroup([
      L.tileLayer(ESRI_IMAGERY, { maxZoom: 19, attribution: ESRI_ATTR }),
      L.tileLayer(ESRI_PLACES, { maxZoom: 19, zIndex: 2 }),
    ]),
    osm: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  }
}

const BASE_LABELS = {
  dark: 'map.baseDark',
  light: 'map.baseLight',
  sat: 'map.baseSat',
  hybrid: 'map.baseHybrid',
  osm: 'map.baseOsm',
}

export default function PointsMap({ points }) {
  const t = useT()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(null)
  const [lib, setLib] = useState(null)
  const [failed, setFailed] = useState(false)

  // Leaflet arrives as its own chunk, stylesheet included.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await import('leaflet/dist/leaflet.css')
        const mod = await import('leaflet')
        if (!cancelled) setLib(mod.default ?? mod)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Create the map once the library is here.
  useEffect(() => {
    if (!lib || !containerRef.current || mapRef.current) return undefined
    const L = lib

    const map = L.map(containerRef.current, { zoomControl: false })
      .setView([39.5, -8.0], 6)
    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const builders = baseLayers(L)
    let saved
    try {
      saved = localStorage.getItem(STORAGE_KEY)
    } catch {
      saved = null // private browsing: the choice simply does not persist
    }
    const active = builders[saved] ? saved : 'dark'

    const layers = {}
    for (const key of Object.keys(builders)) layers[t(BASE_LABELS[key])] = builders[key]()
    layers[t(BASE_LABELS[active])].addTo(map)
    L.control.layers(layers, null, { position: 'bottomleft' }).addTo(map)

    map.on('baselayerchange', (e) => {
      const key = Object.keys(builders).find((k) => t(BASE_LABELS[k]) === e.name)
      try {
        if (key) localStorage.setItem(STORAGE_KEY, key)
      } catch {
        /* ignore */
      }
    })

    markersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = null
    }
    // t is stable for a given language; re-running on a language change would
    // tear the map down mid-pan for nothing but relabelled layers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib])

  // Redraw the points whenever they change.
  useEffect(() => {
    const L = lib
    const map = mapRef.current
    const group = markersRef.current
    if (!L || !map || !group) return

    group.clearLayers()
    for (const p of points) {
      L.circleMarker([p.lat, p.lon], {
        radius: 5,
        weight: 1.5,
        color: '#ffffff',
        fillColor: p.suspect ? COLOR_SUSPECT : COLOR_OK,
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<strong>${t('file.rowN', { n: p.row + 1 })}</strong><br>`
          + `${p.lat}, ${p.lon}<br>`
          + `<em>${t(`file.status.${p.label}`)}</em>`,
        )
        .addTo(group)
    }

    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]))
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
    }
  }, [lib, points, t])

  if (failed) {
    return (
      <p className="rounded border border-edge px-3 py-2 text-sm text-slate-400">
        {t('map.failed')}
      </p>
    )
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="inline-block h-3 w-3 rounded-full border border-white/70"
                style={{ background: COLOR_OK }} />
          {t('map.legendOk')}
        </span>
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="inline-block h-3 w-3 rounded-full border border-white/70"
                style={{ background: COLOR_SUSPECT }} />
          {t('map.legendSuspect')}
        </span>
      </div>
      <div
        ref={containerRef}
        role="application"
        aria-label={t('map.label')}
        className="h-[420px] w-full rounded border border-edge bg-panel"
      />
      {!lib && (
        <p className="mt-2 text-xs text-slate-500">{t('map.loading')}</p>
      )}
    </div>
  )
}
