import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n.jsx'

/**
 * The converted points on a slippy map.
 *
 * Leaflet and its stylesheet are fetched on demand, like SheetJS and JSZip: the
 * map is one section of one tab, and a visitor converting a file to CSV never
 * has to pay for it.
 *
 * The basemaps are the set the sibling tools use - snap-wkt-generator and
 * dji-mission-planner - so a colleague moving between them finds the same
 * imagery under the same names. The default is dark here rather than light,
 * because this page is dark.
 *
 * The light and dark grounds are Esri's canvas maps rather than CARTO's - see
 * baseLayers for why. The last entry, "Sem fundo", is not imagery at all: it
 * draws the points over nothing and contacts no one.
 */

const STORAGE_KEY = 'geocoord:basemap'

// Okabe-Ito blue and vermillion, the same pair app.py uses: distinguishable
// under every common form of colour blindness, which a red/green pair is not.
// Exported so the legend, which now sits in the caption line beside the map's
// title rather than inside this component, draws the same two discs.
export const COLOR_OK = '#0072B2'
export const COLOR_SUSPECT = '#D55E00'
// A corrected position: the accent, drawn hollow so it reads as a proposal
// beside the filled point it would replace.
export const COLOR_FIXED = '#34d399'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_IMAGERY = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`
const ESRI_PLACES = `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`
const ESRI_ATTR = 'Tiles &copy; Esri'
// The canvas maps are two layers by design: a plain ground, and the place names
// as a separate transparent overlay. That is the point of them - the labels sit
// above whatever you draw, instead of underneath it.
const ESRI_CANVAS_ATTR =
  'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'

/**
 * name -> a function building the layer, so nothing is created until chosen.
 *
 * The light and dark grounds were CARTO's until CARTO began watermarking the
 * tiles it serves without an API key - "API KEY REQUIRED" written diagonally
 * across every one of them, on both styles. Esri's canvas maps are the same
 * idea from a host this page already uses for the imagery, they need no key,
 * and a key would be the worse answer anyway: this page is a static file on
 * GitHub Pages, so any key in it is a key published to everyone who opens it.
 */
function baseLayers(L) {
  const canvas = (shade) => () => L.layerGroup([
    L.tileLayer(`${ESRI}/Canvas/World_${shade}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      { maxZoom: 20, attribution: ESRI_CANVAS_ATTR }),
    L.tileLayer(`${ESRI}/Canvas/World_${shade}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      { maxZoom: 20, zIndex: 2 }),
  ])
  return {
    dark: canvas('Dark'),
    light: canvas('Light'),
    sat: () => L.tileLayer(ESRI_IMAGERY, { maxZoom: 19, attribution: ESRI_ATTR }),
    hybrid: () => L.layerGroup([
      L.tileLayer(ESRI_IMAGERY, { maxZoom: 19, attribution: ESRI_ATTR }),
      L.tileLayer(ESRI_PLACES, { maxZoom: 19, zIndex: 2 }),
    ]),
    osm: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
    // Contours and relief, which is what you want when the question is where a
    // sample sits on a slope rather than which road reaches it. Its own tiles
    // stop at zoom 17, so the layer says so rather than serving blanks.
    topo: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 17,
        attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | '
          + 'Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      }),
    // Nothing at all - and this one is not a curiosity. Every other ground
    // here is fetched from Esri or OpenStreetMap, and a tile request carries
    // the area being looked at even though it never carries the file. For work
    // whose whereabouts are not to be disclosed, this is the answer: the
    // points, the zoom and their positions relative to one another, with not a
    // single request leaving the machine. It replaces a button that used to
    // withhold the whole map for the same reason, which showed nothing at all.
    none: () => L.layerGroup([]),
  }
}

const BASE_LABELS = {
  dark: 'map.baseDark',
  light: 'map.baseLight',
  sat: 'map.baseSat',
  hybrid: 'map.baseHybrid',
  osm: 'map.baseOsm',
  topo: 'map.baseTopo',
  none: 'map.baseNone',
}

/**
 * The popup for one point, as DOM rather than HTML: the title and the values
 * come from the user's file, and a cell holding markup must show as text.
 */
function popupNode(details) {
  const root = document.createElement('div')
  root.className = 'pp'
  const add = (parent, tag, text, cls) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    el.textContent = text
    parent.appendChild(el)
    return el
  }
  add(root, 'h4', details.title)
  if (details.sub) add(root, 'div', details.sub, 'sub')
  const dl = document.createElement('dl')
  for (const [term, value] of details.rows) {
    add(dl, 'dt', term)
    add(dl, 'dd', value)
  }
  root.appendChild(dl)
  if (details.status) add(root, 'div', details.status.text, `st ${details.status.tone}`)
  return root
}

/**
 * points: [{ lat, lon, row, suspect, fixed, label }] - `label` names the point
 * on hover. `selected` is a row, and `selectedFrom` says who chose it: the map
 * itself does not move for its own click, the table and the lists fly to it.
 * `preview`, for the selected row, is where a proposed correction would put
 * it. `details(row)` builds the popup. `fitKey` changes when there is a new set
 * of points to frame - not when one is corrected or chosen, which would throw
 * away where the user was looking.
 */
export default function PointsMap({
  points, selected = null, selectedFrom = null, onSelect = null, preview = null,
  details = null, fitKey = null,
}) {
  const t = useT()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(null)
  const selRef = useRef(null)
  const fittedRef = useRef(null)
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
    // A scale bar, metric only: this is a map of field sites, and the question
    // it answers is how far one is from the next.
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map)

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
    // Above the zoom buttons in the same corner: Leaflet stacks a corner's
    // controls in the order they are added, later ones on top.
    L.control.layers(layers, null, { position: 'bottomright' }).addTo(map)

    map.on('baselayerchange', (e) => {
      const key = Object.keys(builders).find((k) => t(BASE_LABELS[k]) === e.name)
      try {
        if (key) localStorage.setItem(STORAGE_KEY, key)
      } catch {
        /* ignore */
      }
    })

    markersRef.current = L.layerGroup().addTo(map)
    selRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = null
      selRef.current = null
      fittedRef.current = null
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
      const marker = L.circleMarker([p.lat, p.lon], {
        radius: p.suspect ? 6 : 5,
        weight: 1.5,
        color: '#ffffff',
        fillColor: p.fixed ? COLOR_FIXED : p.suspect ? COLOR_SUSPECT : COLOR_OK,
        fillOpacity: 0.9,
      })
      // The name on hover, as text: it comes from the file.
      const tip = document.createElement('span')
      tip.textContent = p.label || t('file.rowN', { n: p.row + 1 })
      marker.bindTooltip(tip, { className: 'pt-label', direction: 'top', offset: [0, -6] })
      if (onSelect) marker.on('click', () => onSelect(p.row, 'map'))
      marker.addTo(group)
    }

    const key = fitKey ?? points.length
    if (points.length > 0 && fittedRef.current !== key) {
      fittedRef.current = key
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]))
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
    }
  }, [lib, points, t, onSelect, fitKey])

  // The chosen point: a ring around it, the popup, and - when a correction is
  // proposed for it - a dashed line to where the correction would put it.
  useEffect(() => {
    const L = lib
    const map = mapRef.current
    const layer = selRef.current
    if (!L || !map || !layer) return
    layer.clearLayers()
    map.closePopup()
    if (selected === null) return
    const p = points.find((q) => q.row === selected)
    const at = p ? [p.lat, p.lon] : preview?.to ?? null
    if (!at) return
    L.circleMarker(at, { radius: 13, weight: 2.5, color: '#f2f5f8', fill: false, interactive: false })
      .addTo(layer)
    const framed = [at]
    if (preview?.to && p) {
      L.polyline([at, preview.to], { color: COLOR_FIXED, weight: 2, dashArray: '5 6', interactive: false })
        .addTo(layer)
      L.circleMarker(preview.to, { radius: 7, weight: 2.5, color: COLOR_FIXED, fill: false, interactive: false })
        .addTo(layer)
      framed.push(preview.to)
    }
    if (details) {
      L.popup({ offset: [0, -8], autoPan: true, className: 'pt-popup' })
        .setLatLng(at).setContent(popupNode(details(selected))).openOn(map)
    }
    if (selectedFrom !== 'map') {
      if (framed.length > 1) map.fitBounds(L.latLngBounds(framed), { padding: [60, 60], maxZoom: 12 })
      else map.setView(at, Math.max(map.getZoom(), 11))
    }
  }, [lib, points, selected, selectedFrom, preview, details])

  if (failed) {
    return (
      <p className="px-3 py-2 text-sm text-ink-2">
        {t('map.failed')}
      </p>
    )
  }

  return (
    // The map and nothing else; the well it sits in, its caption and its
    // legend belong to the page around it.
    <>
      <div
        ref={containerRef}
        role="application"
        aria-label={t('map.label')}
        className="h-[340px] w-full bg-map-ground"
      />
      {!lib && (
        <p className="px-3 py-2 text-xs text-ink-3">{t('map.loading')}</p>
      )}
    </>
  )
}
