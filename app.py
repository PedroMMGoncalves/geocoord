import io
import json
import math

import pandas as pd
import streamlit as st

from converter import in_range, parse_coordinate

APP_NAME = "GeoCoord"
ACCENT = "#1f7a4d"  # accent colour — replace with an official LNEG colour if desired

st.set_page_config(
    page_title=f"{APP_NAME} — DMS to Decimal Degrees",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# Appearance (works under both `streamlit run` and the stlite packaging)
# ---------------------------------------------------------------------------
_CSS = """
<style>
#MainMenu, footer {visibility: hidden;}
[data-testid="stToolbar"] {display: none;}
[data-testid="stDecoration"] {display: none;}
.stButton>button[kind="primary"] {
    background-color: __ACCENT__;
    border-color: __ACCENT__;
}
.gc-title {
    border-left: 5px solid __ACCENT__;
    padding-left: 0.7rem;
    margin-bottom: 0.1rem;
}
</style>
""".replace("__ACCENT__", ACCENT)
st.markdown(_CSS, unsafe_allow_html=True)

st.markdown(f"<h1 class='gc-title'>{APP_NAME}</h1>", unsafe_allow_html=True)
st.caption("DMS to Decimal Degrees coordinate converter — WGS84 / EPSG:4326")


# ---------------------------------------------------------------------------
# Helper logic
# ---------------------------------------------------------------------------
def load_file(uploaded_file) -> pd.DataFrame:
    name = uploaded_file.name.lower()

    if name.endswith(".csv"):
        for enc in ("utf-8", "latin1"):
            try:
                uploaded_file.seek(0)
                return pd.read_csv(uploaded_file, encoding=enc)
            except UnicodeDecodeError:
                continue
        uploaded_file.seek(0)
        return pd.read_csv(uploaded_file, encoding="latin1")

    if name.endswith(".xlsx"):
        uploaded_file.seek(0)
        return pd.read_excel(uploaded_file, engine="openpyxl")

    if name.endswith(".xls"):
        uploaded_file.seek(0)
        return pd.read_excel(uploaded_file, engine="xlrd")

    raise ValueError("Unsupported format. Use CSV, XLSX or XLS.")


def _round(value, decimals):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return value
    return round(value, decimals)


def convert_dataframe(df, lat_col, lon_col, decimals) -> pd.DataFrame:
    """Add DD, X/Y, WKT columns and a per-row validation status."""
    result = df.copy()

    result["Latitude_DD"] = [
        _round(parse_coordinate(v), decimals) for v in result[lat_col]
    ]
    result["Longitude_DD"] = [
        _round(parse_coordinate(v), decimals) for v in result[lon_col]
    ]

    # GIS-ready columns.
    result["X_DD"] = result["Longitude_DD"]
    result["Y_DD"] = result["Latitude_DD"]

    lat_ok = result["Latitude_DD"].apply(lambda v: in_range(v, "lat"))
    lon_ok = result["Longitude_DD"].apply(lambda v: in_range(v, "lon"))
    ok = lat_ok & lon_ok

    def status(o, lat_v, lon_v, lat_valid, lon_valid):
        if o:
            return "OK"
        if pd.isna(lat_v) and pd.isna(lon_v):
            return "Failed: could not parse"
        if not lat_valid or not lon_valid:
            return "Out of valid range"
        return "Partial failure"

    result["status"] = [
        status(o, lv, nv, lvalid, nvalid)
        for o, lv, nv, lvalid, nvalid in zip(
            ok, result["Latitude_DD"], result["Longitude_DD"], lat_ok, lon_ok
        )
    ]
    result["WKT"] = [
        f"POINT ({x} {y})" if o else None
        for o, x, y in zip(ok, result["X_DD"], result["Y_DD"])
    ]
    return result


def to_excel_bytes(df) -> bytes:
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="converted")
    output.seek(0)
    return output.getvalue()


def _json_safe(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (str, bool, int)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    item = getattr(v, "item", None)
    return item() if callable(item) else str(v)


def to_geojson_bytes(df, ok_mask) -> bytes:
    """GeoJSON (WGS84 / EPSG:4326) of valid pairs only, with no external deps."""
    features = []
    skip = {"X_DD", "Y_DD", "WKT"}
    for _, row in df.loc[ok_mask].iterrows():
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(row["X_DD"]), float(row["Y_DD"])],
            },
            "properties": {
                str(k): _json_safe(v) for k, v in row.items() if k not in skip
            },
        })
    fc = {"type": "FeatureCollection", "features": features}
    return json.dumps(fc, ensure_ascii=False, allow_nan=False).encode("utf-8")


def guess_column(cols, candidates, fallback_index):
    lower_map = {c.lower(): c for c in cols}
    for c in candidates:
        if c.lower() in lower_map:
            return cols.index(lower_map[c.lower()])
    return min(fallback_index, len(cols) - 1)


LAT_CANDIDATES = [
    "latitude", "lat", "coordenadas x", "latitude x", "coord_lat", "lat_dms", "lat_gms"
]
LON_CANDIDATES = [
    "longitude", "lon", "long", "coordenadas y", "longitude y", "coord_lon",
    "lon_dms", "lon_gms"
]


def render_results(result, lat_col, lon_col):
    ok_mask = result["status"] == "OK"
    n_ok = int(ok_mask.sum())

    if n_ok:
        st.success(f"Conversion complete: {n_ok} of {len(result)} valid pairs.")
    else:
        st.warning("Conversion complete, but no valid pairs were obtained.")

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total rows", len(result))
    m2.metric("Latitudes parsed", int(result["Latitude_DD"].notna().sum()))
    m3.metric("Longitudes parsed", int(result["Longitude_DD"].notna().sum()))
    m4.metric("Valid pairs", n_ok)

    st.subheader("Result")
    st.dataframe(result.head(50), use_container_width=True)

    issues = result[~ok_mask]
    if not issues.empty:
        with st.expander(f"{len(issues)} row(s) with issues — review at source"):
            st.dataframe(
                issues[[lat_col, lon_col, "Latitude_DD", "Longitude_DD", "status"]],
                use_container_width=True,
            )

    points = (
        result.loc[ok_mask, ["Y_DD", "X_DD"]]
        .rename(columns={"Y_DD": "lat", "X_DD": "lon"})
        .dropna()
    )
    if not points.empty:
        st.subheader("Map (valid pairs)")
        st.caption("The basemap needs an internet connection; points are shown even offline.")
        st.map(points, use_container_width=True)

    st.subheader("Download")
    d1, d2, d3 = st.columns(3)
    d1.download_button(
        "Excel (.xlsx)",
        data=to_excel_bytes(result),
        file_name="converted_coordinates.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
    )
    d2.download_button(
        "CSV",
        data=result.to_csv(index=False).encode("utf-8-sig"),
        file_name="converted_coordinates.csv",
        mime="text/csv",
        use_container_width=True,
    )
    d3.download_button(
        "GeoJSON",
        data=to_geojson_bytes(result, ok_mask),
        file_name="converted_coordinates.geojson",
        mime="application/geo+json",
        use_container_width=True,
        disabled=(n_ok == 0),
        help="Import directly in QGIS/ArcGIS (EPSG:4326).",
    )


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
with st.sidebar:
    st.markdown(f"### {APP_NAME}")
    st.caption("DMS to decimal degrees coordinate converter (WGS84 / EPSG:4326).")
    decimals = st.slider("Decimal places in the result", 2, 10, 6)
    st.divider()
    st.markdown("**Using the output in GIS**")
    st.caption(
        "X = Longitude (X_DD), Y = Latitude (Y_DD). "
        "Continental Portugal: latitude ~37-42, longitude ~-9 to -6 (West). "
        "Western longitudes must carry 'O'/'W' or a negative sign."
    )


# ---------------------------------------------------------------------------
# Main content
# ---------------------------------------------------------------------------
tab_file, tab_quick = st.tabs(["File conversion", "Quick conversion"])

with tab_file:
    uploaded_file = st.file_uploader(
        "Choose a file",
        type=["xlsx", "xls", "csv"],
        help="Supports Excel (.xlsx/.xls) and CSV",
    )

    if uploaded_file is None:
        st.session_state.pop("result", None)
        st.info("Load a file to begin.")
    else:
        # New file -> clear stale results.
        if st.session_state.get("file_name") != uploaded_file.name:
            st.session_state.file_name = uploaded_file.name
            st.session_state.pop("result", None)

        try:
            df = load_file(uploaded_file)
        except Exception as e:
            st.error(f"Could not read the file: {e}")
            st.stop()

        if df.empty:
            st.warning("The file contains no rows to process.")
            st.stop()

        with st.expander("File preview", expanded=False):
            st.dataframe(df.head(20), use_container_width=True)

        cols = list(df.columns)
        default_lat = guess_column(cols, LAT_CANDIDATES, 0)
        default_lon = guess_column(cols, LON_CANDIDATES, 1 if len(cols) > 1 else 0)

        c1, c2 = st.columns(2)
        lat_col = c1.selectbox("Latitude column (DMS)", cols, index=default_lat)
        lon_col = c2.selectbox("Longitude column (DMS)", cols, index=default_lon)

        # Live conversion preview — catches the wrong column choice immediately.
        st.caption("Conversion preview (first rows):")
        preview = df[[lat_col, lon_col]].head(5).copy()
        preview["-> Latitude_DD"] = [parse_coordinate(v) for v in preview[lat_col]]
        preview["-> Longitude_DD"] = [parse_coordinate(v) for v in preview[lon_col]]
        st.dataframe(preview, use_container_width=True)

        if st.button("Convert coordinates", type="primary"):
            with st.spinner("Converting..."):
                st.session_state.result = convert_dataframe(
                    df, lat_col, lon_col, decimals
                )
                st.session_state.res_cols = (lat_col, lon_col)

        # Render from state -> results and downloads do not disappear.
        if st.session_state.get("result") is not None:
            r_lat, r_lon = st.session_state.get("res_cols", (lat_col, lon_col))
            render_results(st.session_state.result, r_lat, r_lon)


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

        if (
            lat_dd is not None and lon_dd is not None
            and in_range(lat_dd, "lat") and in_range(lon_dd, "lon")
        ):
            st.code(f"POINT ({lon_dd} {lat_dd})", language="text")
            st.map(
                pd.DataFrame({"lat": [lat_dd], "lon": [lon_dd]}),
                use_container_width=True,
            )
