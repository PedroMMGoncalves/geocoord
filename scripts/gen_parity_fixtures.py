"""Generate tests/fixtures/parity.json — the pytest <-> vitest contract.

Run deliberately, review the diff by eye, then commit:

    python scripts/gen_parity_fixtures.py

The inputs below are chosen by hand; the expected values are computed with the
Python implementation. Once committed the file is frozen: if Python's behaviour
changes on a pinned case, tests/test_parity.py fails, which is the point.

Regenerating is how a deliberate change is accepted, so the diff is the review.
Behaviour outside the pinned cases is not protected: widening it safely means
adding inputs here, not only re-running this script.

Only JSON-representable inputs go in here. Language-specific empty values
(float('nan') on the Python side, NaN/undefined on the JavaScript side) stay in
each side's own tests.
"""
import io
import json
import pathlib
import sys
import zipfile

import pandas as pd

# Run as a plain script (`python scripts/gen_parity_fixtures.py`), so the repo
# root — not on sys.path by default — must be added before `geocoord` is
# importable.
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from geocoord.converter import (
    axis_mismatch,
    detect_swaps,
    hemisphere_axis,
    format_dms,
    identify_region,
    in_range,
    parse_coordinate,
    point_in_mask,
    region_check,
    tidy_table,
)
from geocoord.reader import read_csv_text
from geocoord.geoexport import (
    sanitize_filename,
    to_geojson,
    csv_safe,
    to_kml,
    to_shapefile_zip,
    _safe_field_names,
)

OUT = ROOT / "tests" / "fixtures" / "parity.json"

PARSE_INPUTS = [
    ("decimal_positive", "38.708333"),
    ("decimal_negative", "-9.5"),
    ("decimal_comma", "38,5"),
    ("native_float", -9.139),
    ("native_int", 38),
    # Below 1e-4 Python renders a float in exponential form, and the digits of
    # the exponent were read as minutes: 1e-05 came back as 1.0833. Both sides
    # now take an already-numeric value as it stands.
    ("native_float_exponential_small", 1e-5),
    ("native_float_exponential_large", 1e16),
    ("dms_north", '38° 42\' 30" N'),
    ("dms_west_english", '9° 30\' 0" W'),
    ("dms_west_portuguese", '9° 30\' 0" O'),
    ("dms_east_portuguese", '7° 30\' 0" L'),
    ("dms_east_english", '7° 30\' 0" E'),
    ("dms_south", '15° 30\' 0" S'),
    ("direction_prefix", "W 9° 30'"),
    ("minus_without_direction", '-9° 30\' 0"'),
    ("dm_decimal_minutes", "38° 42.5'"),
    ("dm_negative", "-9° 8.34'"),
    ("no_spaces", '38°42\'30"N'),
    # The negative counterpart of no_spaces. It exists because no_spaces uses N,
    # which is positive whichever way a port reads it: a port matching the
    # hemisphere on whitespace rather than on adjacent letters passes no_spaces
    # and still gets this one wrong, returning +38.5.
    ("no_spaces_negative_hemisphere", '38°30\'0"O'),
    ("space_separated", "38 42 30 N"),
    ("degrees_only", "38°"),
    ("four_numbers_extra_ignored", '38° 42\' 30" 5 N'),
    # These five pin the hemisphere guard, which is the single most likely thing
    # for a port to get wrong. Each catches a different plausible mistake, and
    # each uses a NEGATIVE hemisphere letter (S, W, O) on purpose: a wrong guard
    # that matches a positive letter changes nothing observable, so a case built
    # on N or E cannot fail and pins nothing. "Sítio" pairs S with an accent, so
    # an ASCII-only lookaround matches it and flips the sign; a Unicode-aware one
    # leaves it alone.
    ("hemisphere_inside_word", "38 Oeste"),
    ("hemisphere_inside_accented_word", "38 Sítio"),
    ("hemisphere_glued_to_digits", "38.5W"),
    ("hemisphere_after_space", "38.5 W"),
    # The masculine ordinal is the degree sign a Portuguese keyboard reaches
    # for. It is a letter to Unicode, so left alone it shields the adjacent O
    # from the guard and the west hemisphere is lost.
    ("masculine_ordinal_as_degree_sign", "9ºO"),
    ("word_only_no_digits", "Norte"),
    ("empty", ""),
    ("whitespace", "   "),
    ("lone_minus", "-"),
    ("em_dash", "—"),
    ("text", "texto"),
    ("null", None),
    # Minutes and seconds run 0-59. Sixty of either is the next unit up, so
    # these are typos, not coordinates - and the arithmetic used to carry them
    # silently into a plausible in-region position up to 111 km out.
    ("dms_minutes_sixty", "41\u00b0 60' 00\""),
    ("dms_minutes_transposed", "38\u00b0 62' 30\""),
    ("dms_seconds_sixty", "38\u00b0 30' 60\""),
    ("dms_seconds_transposed", "38\u00b0 30' 90\""),
    ("dm_minutes_sixty", "41\u00b0 60'"),
    # ...but decimal minutes below sixty are ordinary, and must still work.
    ("dm_decimal_minutes_kept", "38\u00b0 30.5'"),
    ("dms_seconds_just_under_sixty", "38\u00b0 30' 59.999\""),
]

IN_RANGE_INPUTS = [
    ("lat_valid", 38.7, "lat"),
    ("lat_high", 95.0, "lat"),
    ("lat_boundary_low", -90.0, "lat"),
    ("lat_boundary_high", 90.0, "lat"),
    ("lat_null", None, "lat"),
    ("lon_valid", -9.1, "lon"),
    ("lon_high", 200.0, "lon"),
    ("lon_boundary_low", -180.0, "lon"),
    ("lon_boundary_high", 180.0, "lon"),
]

FORMAT_DMS_INPUTS = [
    ("lat_positive", 38.708333, "lat"),
    ("lon_negative", -9.136667, "lon"),
    ("zero_lat", 0.0, "lat"),
    ("half_degree_west", -0.5, "lon"),
    ("near_pole", 89.999, "lat"),
    ("one_north", 1.0, "lat"),
    ("one_south", -1.0, "lat"),
    ("one_east", 1.0, "lon"),
    ("one_west", -1.0, "lon"),
    ("rounding_rollover", 38.99999999, "lat"),
    # An exact tie at the fourth decimal of the seconds. Python's round() goes
    # to even and Math.round() goes up, so without a pinned tie the two sides
    # can print different coordinates with every test green.
    ("rounding_tie_to_even", 38.70703125, "lat"),
    ("rounding_tie_small", 1.736111111111111e-05, "lat"),
    ("null", None, "lat"),
    # Outside the axis there is no DMS form: writing 123 30' 0" N states a
    # latitude that does not exist, and the export then carries an assertion
    # nobody made.
    ("latitude_beyond_the_pole", 123.5, "lat"),
    ("longitude_beyond_the_meridian", 200.0, "lon"),
    ("latitude_at_the_pole_is_fine", 90.0, "lat"),
    ("longitude_at_the_antimeridian_is_fine", -180.0, "lon"),
]

# The messy export from the README, and from tests/test_converter.py.
MESSY_CSV = (
    ",,,\n"
    ",Amostras,Y,X\n"
    ',1,"33,6603","-15,9469"\n'
    ',2,"33,6664","-15,9364"\n'
)

PT = [36.8, 42.2, -9.6, -6.1]
MZ = [-27.0, -10.4, 30.1, 41.0]
REGIONS = {"Portugal mainland": [PT], "Moçambique": [MZ]}

DETECT_INPUTS = [
    {
        "id": "single_cluster_all_ok",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05],
        "kwargs": {},
    },
    {
        "id": "range_swap",
        "lats": [150.0],
        "lons": [20.0],
        "kwargs": {},
    },
    {
        "id": "out_of_range_and_missing",
        "lats": [200.0, None],
        "lons": [400.0, 1.0],
        "kwargs": {},
    },
    {
        "id": "below_min_cluster_no_cluster_step",
        "lats": [39.0, 39.1],
        "lons": [-8.0, -8.1],
        "kwargs": {},
    },
    {
        "id": "cluster_majority",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, 39.15, -8.0],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, -8.15, 39.0],
        "kwargs": {},
    },
    {
        "id": "two_legit_clusters_no_false_positive",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, -25.0, -25.1, -24.9],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, 32.0, 32.1, 31.9],
        "kwargs": {},
    },
    {
        "id": "reference_fixes_denser_wrong_cluster",
        "lats": [39.0, 39.1, 38.9, -7.5, -7.6, -7.4, -7.55, -7.45],
        "lons": [-8.0, -8.1, -7.9, 40.0, 40.1, 39.9, 40.05, 39.95],
        "kwargs": {"reference": [39.5, -8.0], "region_radius": 10.0},
    },
    {
        "id": "mask_flags_outside_but_swappable",
        "lats": [39.0, 39.1, -7.485822],
        "lons": [-8.0, -8.1, 40.692444],
        "kwargs": {"mask": [PT]},
    },
    # The hemisphere letter contradicts the column it sits in. That is not a
    # guess about a swap, it is proof of one, and it used to be discarded: the
    # value passed the range check and was re-exported with an S on it, so the
    # file asserted a hemisphere nobody had entered.
    {
        "id": "axis_proof_beats_a_clean_bill_of_health",
        "lats": [-9.136667, 39.0, 38.9],
        "lons": [38.708333, -8.0, -7.9],
        "kwargs": {"axis_mismatch": [True, False, False]},
    },
    {
        "id": "axis_proof_overrides_the_mask_verdict",
        "lats": [39.0, 38.9, -9.136667],
        "lons": [-8.0, -7.9, 38.708333],
        "kwargs": {"mask": [PT], "axis_mismatch": [False, False, True]},
    },
    {
        "id": "axis_proof_does_not_touch_a_row_that_never_parsed",
        "lats": [None, 39.0],
        "lons": [-8.0, -8.1],
        "kwargs": {"axis_mismatch": [True, False]},
    },
    {
        "id": "mask_multi_region_no_false_positive",
        "lats": [39.0, 38.9, -18.0],
        "lons": [-8.0, -7.9, 35.0],
        "kwargs": {"mask": [PT, MZ]},
    },
    # The blind spot the old auto rule had. Its return tolerance was 1.5 x the
    # radius of the dense *core*, and a country is far wider than its core, so
    # a row reversed away from the core - the north-east here - fell outside
    # the tolerance and was reported as fine. A sweep of true positions over
    # mainland Portugal put it at 38% of genuinely reversed rows missed. The
    # tolerance now reaches as far as the good data actually reaches.
    {
        "id": "reversed_away_from_the_core_is_caught",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, 41.5, -6.8],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, -6.5, 41.8],
        "kwargs": {},
    },
    # A compact survey gives the extent test nothing to work with: every good
    # point is in the core, so the tolerance stays at its floor. What catches
    # this row is the ratio - swapping it moves it about twenty times closer to
    # the data than it was.
    {
        "id": "reversed_in_a_compact_survey_is_caught_by_the_ratio",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, -6.8],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, 41.8],
        "kwargs": {},
    },
    # The widened tolerance must not start accusing real places. Maputo in a
    # Portuguese file is an outlier, but swapping it does not bring it home, so
    # it stays ok.
    {
        "id": "distant_real_place_is_not_accused",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, 41.5, -25.97],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, -6.5, 32.57],
        "kwargs": {},
    },
    # The ambiguity the docstring admits, pinned so it stays visible: a real
    # point in the Congo basin at (-6, 41) is arithmetically indistinguishable
    # from a Braganca row entered backwards, and is reported as a suspected
    # swap. That is why the application asks before changing anything.
    {
        "id": "mirror_of_the_data_is_reported_as_ambiguous",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, 41.5, -6.0],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, -6.5, 41.0],
        "kwargs": {},
    },
]

# N/S can only be a latitude and E/W/O/L only a longitude, so the letter names
# the column a value belongs in - the one piece of evidence about a swap that
# costs nothing to read, and was being thrown away.
HEMISPHERE_AXIS_INPUTS = [
    ("west_is_a_longitude", "9\u00b0 8' 12\" W"),
    ("oeste_abbreviated_is_a_longitude", "9\u00b0 8' 12\" O"),
    ("leste_abbreviated_is_a_longitude", "9.5 L"),
    ("north_is_a_latitude", "38\u00b0 42' 30\" N"),
    ("south_is_a_latitude", "38.5S"),
    ("no_letter_at_all", "38.5"),
    ("a_word_is_not_a_letter", "Norte"),
    ("oeste_written_out_is_not_a_letter", "Oeste"),
    ("a_number_has_no_letter", 38.5),
    ("empty", ""),
    ("none", None),
    ("ordinal_degree_sign_still_reads", "9\u00baO"),
]

# A cell a spreadsheet would run rather than show, and the numbers that must
# never be mistaken for one.
CSV_SAFE_INPUTS = [
    ("formula_equals", "=1+1"),
    ("formula_at", "@SUM(A1)"),
    ("formula_plus_hyperlink", "+HYPERLINK(\"http://x\")"),
    ("formula_command", "=cmd|' /C calc'!A0"),
    ("negative_coordinate_untouched", "-8.61"),
    ("negative_coordinate_decimal_comma_untouched", "-8,61"),
    ("positive_signed_number_untouched", "+38.5"),
    ("plain_number_untouched", "38.5"),
    ("leading_zero_code_untouched", "0071"),
    ("exponent_untouched", "-1e-05"),
    ("ordinary_text_untouched", "texto"),
    ("empty_untouched", ""),
]

REGION_CHECK_INPUTS = [
    {
        "id": "flags_outside_and_names_actual_region",
        "lats": [-15.94, 39.0],
        "lons": [33.66, -8.0],
        "labels": ["ok", "ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "outside_with_no_known_region",
        "lats": [33.66],
        "lons": [-15.94],
        "labels": ["ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "inside_region_not_flagged",
        "lats": [39.0],
        "lons": [-8.0],
        "labels": ["ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "auto_mode_flags_nothing",
        "lats": [-15.94],
        "lons": [33.66],
        "labels": ["ok"],
        "kwargs": {},
    },
    {
        "id": "ignores_non_ok_rows",
        "lats": [-15.94, 200.0],
        "lons": [33.66, 0.0],
        "labels": ["swap_cluster", "out_of_range"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "reference_mode",
        "lats": [-15.94, 39.5],
        "lons": [33.66, -8.0],
        "labels": ["ok", "ok"],
        "kwargs": {"reference": [39.5, -8.0], "region_radius": 5.0},
    },
]

IDENTIFY_INPUTS = [
    ("portugal", 39.0, -8.0),
    ("mozambique", -15.94, 33.66),
    ("atlantic_no_region", 33.66, -15.94),
]

POINT_IN_MASK_INPUTS = [
    ("inside_portugal", 39.0, -8.0, [PT]),
    ("outside_portugal", -15.94, 33.66, [PT]),
    ("on_boundary", 36.8, -9.6, [PT]),
]

# read_csv is the step the contract could not reach until the reader was pulled
# out of app.py: it turns text into the same neutral table tidy_table produces,
# which is exactly what the JavaScript side builds with PapaParse. Every cell is
# read as text on both sides, so the tables compare directly.
#
# Encoding recovery is not here. The input travels as a JSON string, already
# decoded, so utf-8-then-latin1 has nothing to bite on; each side tests its own.
READ_CSV_INPUTS = [
    # The real case this application exists for: a blank first line, a leading
    # empty index column, and decimal commas inside quoted fields.
    ("messy_export", MESSY_CSV, None, "."),
    ("comma_detected", "lat,lon\n39.0,-8.0\n", None, "."),
    ("semicolon_detected", "lat;lon\n39,0;-8,0\n", None, ","),
    ("tab_detected", "lat\tlon\n39.0\t-8.0\n", None, "."),
    ("pipe_detected", "lat|lon\n39.0|-8.0\n", None, "."),
    # Forced to a comma, a semicolon file is one column. Both sides must honour
    # an explicit separator over what they would have detected.
    ("explicit_separator_overrides", "lat;lon\n39.0;-8.0\n", ",", "."),
    ("separator_inside_quotes", 'nome,lat\n"Silva, Joao",39.0\n', ",", "."),
    # A comma and a semicolon both appear; the comma wins, and "b;c" is the
    # honest column name that follows.
    ("ambiguous_separators", "a,b;c\n1,2;3\n", None, "."),
    # No delimiter at all. pandas used to guess one out of the header and cut it
    # in half; the answer is one column named lat.
    ("single_column", "lat\n39.0\n38.9\n", None, "."),
    ("leading_zeros_kept", "codigo,lat\n007,38.7\n042,41.2\n", ",", "."),
    ("large_integer_kept", "id,lat\n9007199254740993,38.7\n", ",", "."),
    # "NA" is what the file says, not a missing value.
    ("na_is_text", "nome,lat\nNA,38.7\n", ",", "."),
    ("blank_rows_and_columns_dropped", "idx,lat,lon\n,39.0,-8.0\n,,\n,38.9,-7.9\n", ",", "."),
    ("ragged_rows", "a,b,c\n1,2\n3,4,5\n", ",", "."),
    ("only_a_header", "lat,lon\n", ",", "."),
    # pandas names an empty header cell "Unnamed: N" and disambiguates a
    # repeat with ".1". tidy_table keys off exactly those names when it
    # decides whether to promote the first row, so the JavaScript reader
    # has to produce them too.
    ("empty_header_cell_named", "a,,c\n1,2,3\n", ",", "."),
    ("duplicate_header_names", "a,a,b\n1,2,3\n", ",", "."),
    # A row longer than its header. Without index_col=False pandas turns
    # the extra field into the row index and shifts every label off its
    # data, returning ["2", "3"] where the file says 1, 2, 3.
    ("row_longer_than_header", "a,b\n1,2,3\n", ",", "."),
    # A header cell can literally read "Unnamed: 0" - that is what a file
    # exported by pandas and opened again looks like - and it collides with
    # the name generated for the empty cell beside it. Two columns then
    # share a label, df[name] returns a frame rather than a series, and
    # tidy_table raises. Found by a differential run, not by inspection.
    ("generated_name_collides_with_a_real_one", ",b,Unnamed: 0\n1,2,3\n", ",", "."),
    # A blank line is skipped rather than read as a row. csv.reader yields
    # nothing for one and PapaParse yields a single empty field, so without
    # this an empty first line would become the header on one side only.
    ("blank_lines_skipped", "\na,b\n\n1,2\n\n", ",", "."),
]


# tidy_table works on a neutral table shape so the fixture is language-agnostic:
# {"columns": [...], "rows": [[...], ...]}. The Python side converts to and from
# a DataFrame; the JavaScript side consumes the shape directly.
TIDY_INPUTS = [
    {
        "id": "messy_export_recovers_header",
        "table": {
            "columns": ["Unnamed: 0", "Unnamed: 1", "Unnamed: 2", "Unnamed: 3"],
            "rows": [
                [None, "Amostras", "Y", "X"],
                [None, "1", "33,6603", "-15,9469"],
                [None, "2", "33,6664", "-15,9364"],
            ],
        },
    },
    {
        "id": "drops_empty_column_and_rows",
        "table": {
            "columns": ["idx", "lat", "lon"],
            "rows": [
                [None, "39.0", "-8.0"],
                [None, None, None],
                [None, "38.9", "-7.9"],
            ],
        },
    },
    {
        "id": "leaves_clean_table_unchanged",
        "table": {
            "columns": ["lat", "lon"],
            "rows": [["39.0", "-8.0"], ["38.9", "-7.9"]],
        },
    },
    {
        "id": "promotes_header_only_when_all_placeholder",
        "table": {
            "columns": ["lat", "Unnamed: 1", "lon"],
            "rows": [["39.0", "x", "-8.0"]],
        },
    },
    {
        # A blank cell in the promoted header row must not name the column "nan",
        # and two of them must not collide; each gets a distinct positional name
        # and keeps its data.
        "id": "blank_promoted_header_gets_positional_name",
        "table": {
            "columns": ["Unnamed: 0", "Unnamed: 1", "Unnamed: 2", "Unnamed: 3"],
            "rows": [
                [None, "lat", None, "lon"],
                ["a", "39.0", "x", "-8.0"],
                ["b", "38.9", "y", "-7.9"],
            ],
        },
    },
    {
        "id": "blank_strings_count_as_empty",
        "table": {
            "columns": ["lat", "blank", "lon"],
            "rows": [["39.0", "   ", "-8.0"], ["38.9", "", "-7.9"]],
        },
    },
    {
        "id": "all_empty_returns_empty_shape",
        "table": {
            "columns": ["a", "b"],
            "rows": [[None, None], ["", "   "]],
        },
    },
]

# sanitize_filename: NFKD compatibility decomposition, not a transliteration
# lookup table, is what makes the last six of these come out right. It turns
# the "fi" ligature into plain "fi", "½" into "12" (the fraction slash itself
# has no ASCII form and is simply dropped), and the roman numeral "Ⅻ" into
# "XII" -- while "ß" and "œ" have no decomposition at all and vanish outright.
# A port that transliterates accents via a lookup table would pass the plain
# accents above and fail these.
SANITIZE_INPUTS = [
    ("plain_accents", "dados das áreas de ferro.csv", {}),
    ("simple_name", "sites.csv", {}),
    ("parentheses_and_spaces", "Coordenadas (Final).xlsx", {}),
    ("hyphen_kept", "relatório-2024.geojson", {}),
    ("full_path", "C:/tmp/São Tomé.csv", {}),
    ("accent_and_cedilla", "amostras_ção.shp", {}),
    ("ring_above", "Ångström", {}),
    ("eszett_vanishes", "Straße", {}),
    ("oe_ligature_vanishes", "œuvre", {}),
    ("d_with_stroke_vanishes", "Đà Nẵng", {}),
    ("fi_ligature_decomposes", "ﬁcheiro", {}),
    ("vulgar_fraction_decomposes", "½ ponto", {}),
    ("roman_numeral_decomposes", "Ⅻ", {}),
    ("cjk_has_no_ascii_form", "北京", {}),
    ("diaeresis_and_accent", "naïve café", {}),
    ("empty_string", "", {}),
    ("only_whitespace", "   ", {}),
    ("only_punctuation", "***", {}),
    ("extension_only", ".csv", {}),
    ("only_slashes", "///", {}),
    ("longer_than_max_length", "a" * 200, {}),
    ("custom_default", "***", {"default": "layer"}),
]

# _safe_field_names: uniqueness is checked case-insensitively (so
# "Latitude_DD" and "latitude_dd" collide), and on a collision the numeric
# suffix REPLACES the tail of the name rather than lengthening it past the
# 10-character DBF limit. A port that appends instead of truncating passes
# the first case below and fails the rest.
SAFE_FIELD_NAMES_INPUTS = [
    ("truncated_to_ten", ["a_very_long_attribute_name"]),
    ("collision_after_truncation", ["Latitude_DD", "Latitude_DD2", "Latitude_DD"]),
    ("punctuation_and_blank", ["campo com espaços", "campo-com-traços", ""]),
    ("case_insensitive_collision", ["Latitude_DD", "latitude_dd"]),
    ("suffix_replaces_tail_not_appends", ["x" * 15, "x" * 15, "x" * 15]),
]

# Feature sets shared by the to_geojson and to_kml sections below. Attribute
# values are kept to strings, ints and None throughout this file: Python
# distinguishes the int 1 from the float 1.0 and JSON preserves that
# distinction, but JavaScript has a single number type and cannot reproduce
# it, so a float attribute would be an unresolvable ambiguity between the two
# ports.
EXPORT_FEATURES = [
    (
        "two_points_text_and_int",
        [
            (-8.611, 41.1496, {"name": "Porto", "count": 3}),
            (-9.1393, 38.7223, {"name": "Lisboa", "count": 12}),
        ],
        "name",
    ),
    (
        "xml_special_characters",
        # escape() handles only &, < and > -- the double quote and apostrophe
        # must survive untouched.
        [(-8.0, 39.0, {"note": "A & B <C> \"quoted\" 'apostrophe'"})],
        None,
    ),
    (
        # 200 accented characters is 400 bytes of UTF-8 against a 254-byte
        # field. pyshp drops whole code points, landing on 252 bytes; a byte
        # slice would land on 254 and split the last character.
        "long_accented_attribute_truncated",
        [(-8.0, 39.0, {"note": "ã" * 200})],
        "note",
    ),
    (
        "accented_attribute_value",
        [(6.7273, 0.1864, {"country": "São Tomé e Príncipe"})],
        "country",
    ),
    (
        "none_and_long_attribute",
        [
            (-8.0, 39.0, {"note": None}),
            (-8.1, 39.1, {"note": "x" * 300}),
        ],
        None,
    ),
    (
        "single_point",
        [(-8.0, 39.0, {"name": "Only"})],
        "name",
    ),
    (
        # Python switches a float to exponential form once its decimal exponent
        # drops below -4; JavaScript only below -6. In the gap the same number
        # prints as "1e-05" on one side and "0.00001" on the other, and the KML
        # comparison is on the exact string.
        "exponential_coordinates",
        [
            (1e-5, -51.468987049, {"note": "gap"}),
            (-111.9941399921, 1e-5, {"note": "gap"}),
            (1e-7, -1e-7, {"note": "both exponential"}),
            (1e-4, -1e-4, {"note": "neither exponential"}),
        ],
        "note",
    ),
    (
        # A column named with digits. Python keeps it where the user put it;
        # JavaScript hoists an integer-like key of a plain object to the front,
        # and JSON.parse does it before the exporter is even called. The port
        # takes a Map to carry the order, and this case is what pins it.
        "integer_like_property_key",
        [(-8.0, 39.0, {"local": "Beja", "2024": "12", "nota": "x", "0": "zero"})],
        "local",
    ),
    (
        "empty_feature_list",
        [],
        None,
    ),
    # A double quote inside an XML attribute has to be escaped or the document
    # is not well-formed at all: <Data name="a"b"> made a KML no GIS would open,
    # and nothing said why.
    (
        "attribute_name_with_a_quote",
        [(-8.0, 39.0, {'a"b': "v", "c<d": "e&f"})],
        None,
    ),
]


# Separate, deliberately small cases for to_shapefile_zip: the DBF pads every
# field to 254 bytes regardless of content, so each case below is already a
# few kilobytes of hex once encoded. to_shapefile_zip([], []) (no features AND
# no fields) raises pyshp's ShapefileException("...must contain at least one
# field"), so an empty-features case is deliberately not included here --
# every case below carries at least one field.
SHAPEFILE_INPUTS = [
    (
        "two_points_two_fields",
        [
            (-8.611, 41.1496, {"name": "Porto", "count": 3}),
            (-9.1393, 38.7223, {"name": "Lisboa", "count": 12}),
        ],
        ["name", "count"],
        "coordinates",
    ),
    (
        "field_name_truncated",
        [(-8.0, 39.0, {"a_very_long_attribute_name": "value"})],
        ["a_very_long_attribute_name"],
        "coordinates",
    ),
    (
        "accented_base_name",
        [(-8.0, 39.0, {"name": "Only"})],
        ["name"],
        "São Tomé",
    ),
    (
        # The field name gets ten bytes and a null terminator, and pyshp drops
        # whole code points until the UTF-8 fits rather than slicing the bytes:
        # "aãããããã" is thirteen bytes and is written as "aãããã", nine bytes,
        # not as ten ending in half a character. pyshp 3.0 did slice, 3.1.6
        # fixed it, and requirements.txt floors the version because of it. A
        # port that slices bytes, or that fills all eleven, fails only here.
        "multibyte_field_name_drops_whole_characters",
        [(-8.0, 39.0, {"aãããããã": "value"})],
        ["aãããããã"],
        "coordinates",
    ),
]


def table_to_df(table):
    return pd.DataFrame(table["rows"], columns=table["columns"])


def df_to_table(df):
    # astype(object) first: .values would otherwise find a common dtype and
    # upcast an int column to float, writing 1.0 into the frozen contract where
    # the value is an integer. The NaN guard is belt-and-braces; .where already
    # yields None on the pandas versions we support.
    #
    # Deliberately not shared with the test: a common normaliser would hide its
    # own bugs from the contract it is supposed to police.
    return {
        "columns": [str(c) for c in df.columns],
        "rows": [
            [None if v is None or (isinstance(v, float) and v != v) else v for v in row]
            for row in df.astype(object).where(df.notna(), None).values.tolist()
        ],
    }


def _shapefile_components(features, field_names, base_name):
    """The four shapefile parts, hex-encoded, with the DBF write date zeroed.

    pyshp stamps bytes 1..3 of the DBF header with today's date and
    zipfile.writestr stamps every entry with the local time, so neither the
    .zip nor the raw .dbf is reproducible. The parts are compared instead,
    with the date masked.
    """
    data = to_shapefile_zip(features, field_names, base_name=base_name)
    out = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            ext = name.rsplit(".", 1)[-1]
            raw = bytearray(z.read(name))
            if ext == "dbf":
                raw[1:4] = b"\x00\x00\x00"
            out[ext] = bytes(raw).hex()
    return out


def build():
    data = {
        "_readme": (
            "Shared contract between pytest (tests/test_parity.py) and vitest "
            "(web/tests/converter.test.js). Generated by "
            "scripts/gen_parity_fixtures.py, then frozen. Do not hand-edit: "
            "change the inputs in the generator and regenerate. Only "
            "JSON-representable inputs live here; NaN and undefined are covered "
            "by each side's own tests."
        ),
        "parse_coordinate": [
            {"id": i, "input": v, "expected": parse_coordinate(v)}
            for i, v in PARSE_INPUTS
        ],
        "in_range": [
            {"id": i, "value": v, "axis": a, "expected": in_range(v, a)}
            for i, v, a in IN_RANGE_INPUTS
        ],
        "format_dms": [
            {"id": i, "value": v, "axis": a, "expected": format_dms(v, a)}
            for i, v, a in FORMAT_DMS_INPUTS
        ],
        "hemisphere_axis": [
            {"id": i, "input": v, "expected": hemisphere_axis(v)}
            for i, v in HEMISPHERE_AXIS_INPUTS
        ],
        "csv_safe": [
            {"id": i, "input": v, "expected": csv_safe(v)}
            for i, v in CSV_SAFE_INPUTS
        ],
        "point_in_mask": [
            {"id": i, "lat": la, "lon": lo, "mask": m,
             "expected": point_in_mask(la, lo, m)}
            for i, la, lo, m in POINT_IN_MASK_INPUTS
        ],
        "identify_region": [
            {"id": i, "lat": la, "lon": lo, "regions": REGIONS,
             "expected": identify_region(la, lo, REGIONS)}
            for i, la, lo in IDENTIFY_INPUTS
        ],
        "sanitize_filename": [
            {"id": i, "name": n, "kwargs": kw, "expected": sanitize_filename(n, **kw)}
            for i, n, kw in SANITIZE_INPUTS
        ],
        "safe_field_names": [
            {"id": i, "names": names, "expected": _safe_field_names(names)}
            for i, names in SAFE_FIELD_NAMES_INPUTS
        ],
        "to_geojson": [
            {
                "id": i,
                "features": feats,
                # The text, not the parsed object: parsing hoists an
                # integer-like key to the front on both sides, so a real
                # ordering divergence cancelled out inside the comparison.
                "expected": to_geojson(feats).decode("utf-8"),
                # The key order, so the JavaScript half can rebuild a Map. A
                # plain object cannot carry it - see integer_like_property_key.
                "prop_order": [list(props.keys()) for _, _, props in feats],
            }
            for i, feats, _name_key in EXPORT_FEATURES
        ],
        "to_kml": [
            {
                "id": i,
                "features": feats,
                "name_key": name_key,
                "expected": to_kml(feats, name_key=name_key).decode("utf-8"),
                # The key order, so the JavaScript half can rebuild a Map: a
                # plain object cannot carry it, see integer_like_property_key.
                "prop_order": [list(props.keys()) for _, _, props in feats],
            }
            for i, feats, name_key in EXPORT_FEATURES
        ],
        "to_shapefile_zip": [
            {
                "id": i,
                "features": feats,
                "field_names": field_names,
                "base_name": base_name,
                "expected": _shapefile_components(feats, field_names, base_name),
            }
            for i, feats, field_names, base_name in SHAPEFILE_INPUTS
        ],
        "detect_swaps": [],
        "region_check": [],
        "read_csv": [],
        "tidy_table": [],
    }

    for case in DETECT_INPUTS:
        labels, center = detect_swaps(case["lats"], case["lons"], **case["kwargs"])
        data["detect_swaps"].append({
            "id": case["id"],
            "lats": case["lats"],
            "lons": case["lons"],
            "kwargs": case["kwargs"],
            "expected": {
                "labels": labels,
                "center": None if center is None else [center[0], center[1]],
            },
        })

    for case in REGION_CHECK_INPUTS:
        out_idx, detected = region_check(
            case["lats"], case["lons"], case["labels"], REGIONS, **case["kwargs"]
        )
        data["region_check"].append({
            "id": case["id"],
            "lats": case["lats"],
            "lons": case["lons"],
            "labels": case["labels"],
            "regions": REGIONS,
            "kwargs": case["kwargs"],
            # detected is a dict keyed by region name or None; JSON cannot hold a
            # null key, so it travels as an ordered list of pairs.
            "expected": {
                "out_idx": out_idx,
                "detected": [[k, v] for k, v in detected.items()],
            },
        })

    for case_id, text, sep, decimal in READ_CSV_INPUTS:
        tidy = tidy_table(read_csv_text(text, sep=sep, decimal=decimal))
        data["read_csv"].append({
            "id": case_id,
            "text": text,
            "sep": sep,
            "decimal": decimal,
            "expected": df_to_table(tidy),
        })

    for case in TIDY_INPUTS:
        tidy = tidy_table(table_to_df(case["table"]))
        data["tidy_table"].append({
            "id": case["id"],
            "table": case["table"],
            "expected": df_to_table(tidy),
        })

    return data


if __name__ == "__main__":
    payload = json.dumps(build(), ensure_ascii=False, indent=2, allow_nan=False) + "\n"

    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != payload:
            print(
                f"{OUT} is out of date with the generator. Either it was edited "
                "by hand, or the inputs changed without regenerating. Run "
                "`python scripts/gen_parity_fixtures.py` and review the diff.",
                file=sys.stderr,
            )
            raise SystemExit(1)
        print(f"{OUT} is up to date")
        raise SystemExit(0)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(payload, encoding="utf-8")
    print(f"wrote {OUT}")
