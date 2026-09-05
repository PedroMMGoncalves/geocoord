import io
import os

import pandas as pd
import streamlit as st

from geocoord.converter import (
    detect_swaps,
    format_dms,
    in_range,
    parse_coordinate,
    region_check,
    tidy_table,
)
from geocoord.geoexport import sanitize_filename, to_geojson, to_kml, to_shapefile_zip
from geocoord.reader import read_csv_bytes, read_excel_bytes, workbook_sheets

APP_NAME = "GeoCoord"
ACCENT = "#1f7a4d"  # accent colour — replace with an official LNEG colour if desired
ACCENT_DARK = "#175e3a"  # deeper shade for button hover/active states
ACCENT_SOFT = "rgba(31, 122, 77, 0.30)"  # translucent accent for focus rings

# Okabe-Ito colour-blind-safe pair for the map.
COLOR_OK = [0, 114, 178]      # blue
COLOR_SWAP = [213, 94, 0]     # vermillion

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
LOGO = os.path.join(ASSETS, "logo.png")

st.set_page_config(
    page_title=f"{APP_NAME} — DMS to Decimal Degrees",
    layout="wide",
    initial_sidebar_state="expanded",
)

_CSS = """
<style>
#MainMenu, footer {visibility: hidden;}
[data-testid="stToolbar"] {display: none;}
[data-testid="stDecoration"] {display: none;}

/* Buttons: clearer affordance, stronger hierarchy, visible hover/focus. */
.stButton > button, .stDownloadButton > button {
    font-weight: 600;
    border-radius: 8px;
    padding: 0.55rem 1.1rem;
    min-height: 2.7rem;
    transition: background-color .15s ease, color .15s ease,
                border-color .15s ease, box-shadow .15s ease, transform .05s ease;
}
.stButton > button:active, .stDownloadButton > button:active {transform: translateY(1px);}
.stButton > button:focus-visible, .stDownloadButton > button:focus-visible {
    outline: 3px solid __ACCENT_SOFT__;
    outline-offset: 2px;
}

/* Primary actions (Convert, Apply swap): solid accent, prominent. */
.stButton > button[kind="primary"] {
    background-color: __ACCENT__;
    border: 1px solid __ACCENT__;
    color: #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}
.stButton > button[kind="primary"]:hover {
    background-color: __ACCENT_DARK__;
    border-color: __ACCENT_DARK__;
    color: #fff;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.22);
}

/* Secondary + download buttons: accent outline that fills on hover. */
.stButton > button[kind="secondary"], .stDownloadButton > button {
    background-color: #fff;
    border: 2px solid __ACCENT__;
    color: __ACCENT__;
}
.stButton > button[kind="secondary"]:hover, .stDownloadButton > button:hover {
    background-color: __ACCENT__;
    border-color: __ACCENT__;
    color: #fff;
}
.stDownloadButton > button:disabled,
.stDownloadButton > button:disabled:hover {
    background-color: #fff;
    border-color: #cfcfcf;
    color: #b3b3b3;
}

.gc-title {border-left: 5px solid __ACCENT__; padding-left: 0.7rem; margin-bottom: 0.1rem;}
.gc-step {color: __ACCENT__; font-weight: 700; font-size: 1.05rem; margin: 0.6rem 0 0.2rem;}
</style>
""".replace("__ACCENT_DARK__", ACCENT_DARK).replace("__ACCENT_SOFT__", ACCENT_SOFT).replace("__ACCENT__", ACCENT)
st.markdown(_CSS, unsafe_allow_html=True)
st.markdown(f"<h1 class='gc-title'>{APP_NAME}</h1>", unsafe_allow_html=True)
st.caption("DMS to Decimal Degrees coordinate converter — WGS84 / EPSG:4326")

STATUS_TEXT = {
    "ok": "OK",
    "swap_range": "Possible swap (out of range as-is)",
    "swap_cluster": "Possible swap (outlier)",
    "out_of_range": "Out of valid range",
    "missing": "Failed: could not parse",
}

# Expected-region masks for swap detection. Each entry is a list of bounding
# boxes (lat_min, lat_max, lon_min, lon_max). Portugal mainland is the default.
REGION_MASKS = {
    "Portugal mainland": [(36.8, 42.2, -9.6, -6.1)],
    "Azores": [(36.9, 39.8, -31.3, -24.9)],
    # The Selvagens, the southernmost Portuguese territory, belong to the
    # Autonomous Region of Madeira but sit far south of the
    # Madeira/Porto Santo/Desertas box, so they need one of their own.
    "Madeira": [(32.3, 33.2, -17.3, -16.2), (30.0, 30.25, -16.1, -15.7)],
    "Angola": [(-18.1, -4.3, 11.6, 24.2)],
    "Cabo Verde": [(14.7, 17.3, -25.5, -22.6)],
    "Guiné-Bissau": [(10.8, 12.8, -16.9, -13.5)],
    "Moçambique": [(-27.0, -10.4, 30.1, 41.0)],
    "São Tomé e Príncipe": [(-0.1, 1.8, 6.4, 7.6)],
}


def _step(label):
    st.markdown(f"<div class='gc-step'>{label}</div>", unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
def read_csv(uploaded, sep, decimal):
    uploaded.seek(0)
    return read_csv_bytes(uploaded.read(), sep=sep, decimal=decimal)


def _round(value, decimals):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return value
    return round(value, decimals)


# ---------------------------------------------------------------------------
# Conversion pipeline (parsing + derived columns; swap detection runs at render)
# ---------------------------------------------------------------------------
DERIVED = ["X_DD", "Y_DD", "status", "WKT", "Latitude_GMS", "Longitude_GMS"]


def add_derived(result, add_dms):
    result = result.drop(columns=[c for c in DERIVED if c in result.columns])
    lat = result["Latitude_DD"].tolist()
    lon = result["Longitude_DD"].tolist()

    result["X_DD"] = result["Longitude_DD"]
    result["Y_DD"] = result["Latitude_DD"]
    result["WKT"] = [
        f"POINT ({x} {y})" if (in_range(y, "lat") and in_range(x, "lon")) else None
        for x, y in zip(result["X_DD"], result["Y_DD"])
    ]
    if add_dms:
        result["Latitude_GMS"] = [format_dms(v, "lat") for v in lat]
        result["Longitude_GMS"] = [format_dms(v, "lon") for v in lon]
    return result


def build_result(df, lat_col, lon_col, decimals, add_dms):
    result = df.copy().reset_index(drop=True)
    result["Latitude_DD"] = [_round(parse_coordinate(v), decimals) for v in result[lat_col]]
    result["Longitude_DD"] = [_round(parse_coordinate(v), decimals) for v in result[lon_col]]
    return add_derived(result, add_dms)


def apply_swaps(result, idxs, add_dms):
    r = result.copy()
    la_pos = r.columns.get_loc("Latitude_DD")
    lo_pos = r.columns.get_loc("Longitude_DD")
    for i in idxs:
        la, lo = r.iat[i, la_pos], r.iat[i, lo_pos]
        r.iat[i, la_pos], r.iat[i, lo_pos] = lo, la
    return add_derived(r, add_dms)


def to_excel_bytes(df):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="converted")
    output.seek(0)
    return output.getvalue()


def features_in_range(result):
    field_names = [c for c in result.columns if c not in ("X_DD", "Y_DD", "WKT")]
    features = []
    for _, row in result.iterrows():
        lat, lon = row["Latitude_DD"], row["Longitude_DD"]
        if in_range(lat, "lat") and in_range(lon, "lon"):
            features.append((lon, lat, {c: row[c] for c in field_names}))
    return features, field_names


# Cached exports: keyed by dataframe content, so toggling format checkboxes does
# not rebuild the others, and only a real data/region change recomputes them.
@st.cache_data(show_spinner=False)
def export_csv(df):
    return df.to_csv(index=False).encode("utf-8-sig")


@st.cache_data(show_spinner=False)
def export_excel(df):
    return to_excel_bytes(df)


@st.cache_data(show_spinner=False)
def export_geojson(df):
    features, _ = features_in_range(df)
    return to_geojson(features)


@st.cache_data(show_spinner=False)
def export_kml(df, name_key):
    features, _ = features_in_range(df)
    return to_kml(features, name_key=name_key)


@st.cache_data(show_spinner=False)
def export_shapefile(df, base):
    features, fields = features_in_range(df)
    return to_shapefile_zip(features, fields, base_name=base)


def guess_column(cols, candidates, fallback_index):
    lower_map = {c.lower(): c for c in cols}
    for c in candidates:
        if c.lower() in lower_map:
            return cols.index(lower_map[c.lower()])
    return min(fallback_index, len(cols) - 1)


LAT_CANDIDATES = ["latitude", "lat", "coordenadas x", "latitude x", "coord_lat",
                  "lat_dms", "lat_gms", "y", "y_dd", "lat_y"]
LON_CANDIDATES = ["longitude", "lon", "long", "coordenadas y", "longitude y", "coord_lon",
                  "lon_dms", "lon_gms", "x", "x_dd", "lon_x"]


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------
def render_map(result, labels):
    rows = []
    la_pos = result.columns.get_loc("Latitude_DD")
    lo_pos = result.columns.get_loc("Longitude_DD")
    for i, lab in enumerate(labels):
        lat = result.iat[i, la_pos]
        lon = result.iat[i, lo_pos]
        if in_range(lat, "lat") and in_range(lon, "lon"):
            plat, plon = lat, lon
        elif in_range(lon, "lat") and in_range(lat, "lon"):
            plat, plon = lon, lat  # swap_range: show the swapped (likely) position
        else:
            continue
        rows.append({
            "plat": float(plat), "plon": float(plon),
            "status": STATUS_TEXT[lab],
            "color": COLOR_OK if lab == "ok" else COLOR_SWAP,
            "row": i,
        })
    if not rows:
        st.info("No valid points to map.")
        return
    map_df = pd.DataFrame(rows)
    st.markdown(
        f"<span style='color:rgb({COLOR_OK[0]},{COLOR_OK[1]},{COLOR_OK[2]})'>&#9679;</span> OK "
        f"&nbsp;&nbsp; <span style='color:rgb({COLOR_SWAP[0]},{COLOR_SWAP[1]},{COLOR_SWAP[2]})'>"
        f"&#9679;</span> Possible swap",
        unsafe_allow_html=True,
    )
    st.caption("Basemap needs an internet connection; points are shown offline.")
    try:
        import pydeck as pdk
        view = pdk.data_utils.compute_view(map_df[["plon", "plat"]].values)
        view.min_zoom = 1
        layer = pdk.Layer(
            "ScatterplotLayer", data=map_df, get_position="[plon, plat]",
            get_fill_color="color", get_radius=30000,
            radius_min_pixels=4, radius_max_pixels=12, pickable=True,
        )
        tooltip = {"text": "row {row}\n{status}\nlat {plat}, lon {plon}"}
        st.pydeck_chart(pdk.Deck(layers=[layer], initial_view_state=view, tooltip=tooltip))
    except Exception:
        st.map(map_df.rename(columns={"plat": "lat", "plon": "lon"})[["lat", "lon"]])


def render_summary(result, labels, lat_col, lon_col):
    lat = pd.to_numeric(result["Latitude_DD"], errors="coerce")
    lon = pd.to_numeric(result["Longitude_DD"], errors="coerce")
    ok = lat.between(-90, 90) & lon.between(-180, 180)
    if ok.sum():
        la, lo = lat[ok], lon[ok]
        s1, s2 = st.columns(2)
        s1.write(
            f"**Bounding box**\n\n"
            f"- lat: {la.min():.6f} to {la.max():.6f}\n"
            f"- lon: {lo.min():.6f} to {lo.max():.6f}"
        )
        s2.write(f"**Centroid**\n\n- lat: {la.mean():.6f}\n- lon: {lo.mean():.6f}")
    else:
        st.info("No valid points.")

    bad_idx = [i for i, s in enumerate(labels) if s in ("out_of_range", "missing")]
    if bad_idx:
        st.markdown(f"**{len(bad_idx)} invalid row(s)**")
        bad = result.iloc[bad_idx]
        st.dataframe(
            bad[[c for c in (lat_col, lon_col, "Latitude_DD", "Longitude_DD", "status")
                 if c in bad.columns]],
            use_container_width=True)


def render_downloads(result, name_key, base):
    _step("5. Download")
    st.caption("Tabular formats include all rows; spatial formats include valid points only.")
    st.caption(f"Files are named after the input file: `{base}.csv`, `{base}.geojson`, …")
    c = st.columns(5)
    want = {
        "CSV": c[0].checkbox("CSV", value=True),
        "Excel": c[1].checkbox("Excel", value=True),
        "GeoJSON": c[2].checkbox("GeoJSON", value=True),
        "KML": c[3].checkbox("KML", value=False),
        "Shapefile": c[4].checkbox("Shapefile", value=False),
    }
    has_points = bool(features_in_range(result)[0])
    d = st.columns(5)
    if want["CSV"]:
        d[0].download_button("Download CSV", export_csv(result),
                             f"{base}.csv", "text/csv", use_container_width=True)
    if want["Excel"]:
        d[1].download_button("Download Excel", export_excel(result), f"{base}.xlsx",
                             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             use_container_width=True)
    if want["GeoJSON"]:
        d[2].download_button("Download GeoJSON", export_geojson(result),
                             f"{base}.geojson", "application/geo+json",
                             disabled=not has_points, use_container_width=True)
    if want["KML"]:
        d[3].download_button("Download KML", export_kml(result, name_key),
                             f"{base}.kml", "application/vnd.google-earth.kml+xml",
                             disabled=not has_points, use_container_width=True)
    if want["Shapefile"]:
        d[4].download_button("Download Shapefile (.zip)", export_shapefile(result, base),
                             f"{base}.zip", "application/zip",
                             disabled=not has_points, use_container_width=True)


def _select_region(name):
    """Button callback: point the region selector at a detected region."""
    st.session_state.region_choice = name


def swap_detection_controls():
    """Region selector. Returns (mask, reference, region_radius, is_auto, label)."""
    st.caption("Pick the region your data belongs to. 'Auto' guesses the largest "
               "cluster and can pick the wrong side when about half the data is swapped.")
    options = list(REGION_MASKS) + ["Custom centre", "Auto (largest cluster)"]
    region = st.selectbox("Expected data region", options, index=0, key="region_choice")
    if region in REGION_MASKS:
        return REGION_MASKS[region], None, 10.0, False, region
    if region == "Custom centre":
        cc1, cc2 = st.columns(2)
        rlat = cc1.number_input("Reference latitude", -90.0, 90.0, 39.5)
        rlon = cc2.number_input("Reference longitude", -180.0, 180.0, -8.0)
        radius = st.slider("Region radius (degrees)", 1.0, 45.0, 10.0)
        return None, (rlat, rlon), radius, False, "the custom centre"
    return None, None, 10.0, True, region


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
with st.sidebar:
    if os.path.exists(LOGO):
        st.image(LOGO, use_container_width=True)
    st.markdown(f"### {APP_NAME}")
    st.caption("DMS to decimal degrees coordinate converter (WGS84 / EPSG:4326).")
    decimals = st.slider("Decimal places in the result", 2, 10, 6)
    add_dms = st.checkbox("Add DMS columns (DD -> DMS)", value=False)
    st.divider()
    st.markdown("**Using the output in GIS**")
    st.caption(
        "X = Longitude (X_DD), Y = Latitude (Y_DD). Reproject to your national "
        "system inside QGIS/ArcGIS for full control over the datum transform."
    )


# ---------------------------------------------------------------------------
# Main content
# ---------------------------------------------------------------------------
tab_file, tab_quick = st.tabs(["File conversion", "Quick conversion"])

with tab_file:
    _step("1. Load a file")
    uploaded = st.file_uploader("Choose a file", type=["xlsx", "xls", "csv"],
                                help="Supports Excel (.xlsx/.xls) and CSV",
                                label_visibility="collapsed")

    if uploaded is None:
        st.session_state.pop("result", None)
        st.info("Load a CSV or Excel file to begin.")
    else:
        if st.session_state.get("file_name") != uploaded.name:
            st.session_state.file_name = uploaded.name
            st.session_state.pop("result", None)

        name = uploaded.name.lower()
        try:
            if name.endswith(".csv"):
                with st.expander("Read options (CSV)"):
                    sep_label = st.selectbox(
                        "Separator", ["auto", ", (comma)", "; (semicolon)", "tab", "| (pipe)"])
                    dec_label = st.selectbox("Decimal", [". (dot)", ", (comma)"])
                sep = {"auto": None, ", (comma)": ",", "; (semicolon)": ";",
                       "tab": "\t", "| (pipe)": "|"}[sep_label]
                decimal = "." if dec_label.startswith(".") else ","
                df = read_csv(uploaded, sep, decimal)
            else:
                uploaded.seek(0)
                data = uploaded.read()
                sheets = workbook_sheets(data, name)
                sheet = sheets[0]
                if len(sheets) > 1:
                    sheet = st.selectbox("Sheet", sheets)
                df = read_excel_bytes(data, name, sheet)
        except Exception as e:
            st.error(f"Could not read the file: {e}")
            st.stop()

        df = tidy_table(df)
        if df.empty:
            st.warning("The file contains no rows to process.")
            st.stop()

        df = df.reset_index(drop=True)
        with st.expander("File preview", expanded=False):
            st.dataframe(df.head(20), use_container_width=True)

        _step("2. Choose the coordinate columns")
        cols = list(df.columns)
        c1, c2 = st.columns(2)
        lat_col = c1.selectbox("Latitude column (DMS)", cols,
                               index=guess_column(cols, LAT_CANDIDATES, 0))
        lon_col = c2.selectbox("Longitude column (DMS)", cols,
                               index=guess_column(cols, LON_CANDIDATES, 1 if len(cols) > 1 else 0))

        st.caption("Conversion preview (first rows):")
        preview = df[[lat_col, lon_col]].head(5).copy()
        preview["-> Latitude_DD"] = [parse_coordinate(v) for v in preview[lat_col]]
        preview["-> Longitude_DD"] = [parse_coordinate(v) for v in preview[lon_col]]
        st.dataframe(preview, use_container_width=True)

        _step("3. Convert")
        if st.button("Convert coordinates", type="primary"):
            with st.spinner("Converting..."):
                st.session_state.result = build_result(df, lat_col, lon_col, decimals, add_dms)
                st.session_state.name_key = cols[0] if cols else None

        if st.session_state.get("result") is not None:
            result = st.session_state.result

            _step("4. Review and fix swapped coordinates")
            mask, reference, region_radius, is_auto, region_label = swap_detection_controls()
            lat_list = result["Latitude_DD"].tolist()
            lon_list = result["Longitude_DD"].tolist()
            labels, center = detect_swaps(lat_list, lon_list, reference=reference,
                                          region_radius=region_radius, mask=mask)
            result["status"] = [STATUS_TEXT[s] for s in labels]

            n_ok = sum(1 for s in labels if s == "ok")
            n_swap = sum(1 for s in labels if s in ("swap_range", "swap_cluster"))
            n_bad = sum(1 for s in labels if s in ("out_of_range", "missing"))

            # Region awareness: valid points that landed outside the declared region.
            out_idx, detected = region_check(lat_list, lon_list, labels, REGION_MASKS,
                                              mask=mask, reference=reference,
                                              region_radius=region_radius)
            n_out = len(out_idx)
            region_declared = mask is not None or reference is not None

            if region_declared:
                m = st.columns(5)
                m[0].metric("Total rows", len(result))
                m[1].metric("In region", n_ok - n_out)
                m[2].metric("Outside region", n_out)
                m[3].metric("Possible swaps", n_swap)
                m[4].metric("Invalid", n_bad)
            else:
                m1, m2, m3, m4 = st.columns(4)
                m1.metric("Total rows", len(result))
                m2.metric("OK", n_ok)
                m3.metric("Possible swaps", n_swap)
                m4.metric("Invalid", n_bad)

            if region_declared and n_out:
                known = {k: v for k, v in detected.items() if k is not None}
                frac = n_out / n_ok if n_ok else 1.0
                if known:
                    best = max(known, key=known.get)
                    msg = (f"**{n_out}** valid point(s) fall **outside {region_label}** — "
                           f"{known[best]} of them inside **{best}**. If that is expected, "
                           "switch the region; otherwise check the Latitude/Longitude "
                           "columns (a possible X/Y swap).")
                else:
                    best = None
                    msg = (f"**{n_out}** valid point(s) fall **outside {region_label}** and "
                           "match no known region — check the Latitude/Longitude columns "
                           "(a possible X/Y swap or sign error).")
                (st.warning if frac >= 0.5 else st.info)(msg)
                if best is not None:
                    st.button(f"Switch region to {best}", key="switch_region",
                              on_click=_select_region, args=(best,))

            if n_swap:
                cluster_idx = [i for i, s in enumerate(labels) if s == "swap_cluster"]
                range_idx = [i for i, s in enumerate(labels) if s == "swap_range"]
                ok_idx = [i for i, s in enumerate(labels) if s == "ok"]
                with st.expander(f"Review {n_swap} possible swapped coordinate(s)", expanded=True):
                    if cluster_idx and center is not None:
                        st.caption(f"Expected location ≈ lat {center[0]:.3f}, lon {center[1]:.3f}. "
                                   "Outliers that fall back near it when X/Y are swapped are flagged.")
                    elif cluster_idx and mask is not None:
                        st.caption("Points outside the expected region whose swapped "
                                   "coordinates fall inside are flagged.")
                    susp = result.iloc[range_idx + cluster_idx]
                    st.dataframe(
                        susp[[c for c in (lat_col, lon_col, "Latitude_DD", "Longitude_DD", "status")
                              if c in susp.columns]],
                        use_container_width=True)
                    invert = False
                    if is_auto and cluster_idx and ok_idx:
                        invert = st.checkbox(
                            "Invert cluster suggestion (the main cluster is the swapped side)",
                            value=False)
                    target = range_idx + (ok_idx if invert else cluster_idx)
                    if st.button(f"Apply swap to {len(target)} row(s)", type="primary"):
                        st.session_state.result = apply_swaps(result, target, add_dms)
                        st.rerun()

            t_table, t_map, t_summary, t_download = st.tabs(
                ["Table", "Map", "Summary", "Download"])
            with t_table:
                st.dataframe(result, use_container_width=True, height=460)
            with t_map:
                render_map(result, labels)
            with t_summary:
                render_summary(result, labels, lat_col, lon_col)
            with t_download:
                base = sanitize_filename(st.session_state.get("file_name", "converted"))
                render_downloads(result, st.session_state.get("name_key"), base)


with tab_quick:
    st.write("Convert a single coordinate, without loading a file.")
    q1, q2 = st.columns(2)
    lat_in = q1.text_input("Latitude (DMS or decimal)", placeholder='e.g. 38° 42\' 30" N')
    lon_in = q2.text_input("Longitude (DMS or decimal)", placeholder='e.g. 9° 8\' 12" W')

    if st.button("Convert", type="primary", key="btn_quick"):
        lat_dd = parse_coordinate(lat_in)
        lon_dd = parse_coordinate(lon_in)
        r1, r2 = st.columns(2)
        with r1:
            if lat_dd is None:
                st.error("Could not parse the latitude.")
            else:
                st.metric("Latitude (DD) = Y_DD", f"{lat_dd:.{decimals}f}")
                if not in_range(lat_dd, "lat"):
                    st.warning("Latitude out of the -90 to 90 range.")
        with r2:
            if lon_dd is None:
                st.error("Could not parse the longitude.")
            else:
                st.metric("Longitude (DD) = X_DD", f"{lon_dd:.{decimals}f}")
                if not in_range(lon_dd, "lon"):
                    st.warning("Longitude out of the -180 to 180 range.")
        if (lat_dd is not None and lon_dd is not None
                and in_range(lat_dd, "lat") and in_range(lon_dd, "lon")):
            st.code(f"POINT ({lon_dd} {lat_dd})", language="text")
            st.caption(f"DMS: {format_dms(lat_dd, 'lat')}, {format_dms(lon_dd, 'lon')}")
            st.map(pd.DataFrame({"lat": [lat_dd], "lon": [lon_dd]}))
