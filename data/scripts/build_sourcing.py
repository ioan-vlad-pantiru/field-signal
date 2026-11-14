"""Build the feed buyer's view of Alba (SourcingRegion, mock=false) from real data.

    gh release download data-latest -p field-signal-data.tar.gz -O - | tar -xz -C data
    uv run --all-packages python data/scripts/build_sourcing.py path/to/parcele.zip

Writes services/api/src/api/data/sourcing_alba.json (validated against the contract).

Inputs
- data/cache/features/{commune,county}.parquet: per zone x crop x season weather, soil-water and
  NDVI features (NASA POWER, MODIS), and INS county yield anomalies (vs linear trend).
- data/cache/power/*.parquet: NASA POWER daily per sample point, for the quality windows.
- data/cache/zones/{zones,points}.parquet: the 40 Alba communes (SIRUTA), centroids, points.
- data/cache/ins/county_yields.parquet: INS AGR110A county yields 1990-2025.
- APIA LPIS 2025 zip (sirsup_cod = commune SIRUTA per parcel) joined by gid to
  services/api/parcels/apia_parcels_alba.sqlite (EUCROPMAP 2022 majority crop per parcel).
- data/crops.toml: crop windows and thresholds.

Supply risk rule (the SAME rule for communes and for the county-level validation)
For a zone x crop and a season, each indicator is ranked against that zone x crop's own other
seasons 2001-2025 (the season itself left out): the share of other seasons that were better,
ties counted half. Indicators, worse direction in brackets:
  water_deficit_mm (higher), gwetroot_critical (lower), ndvi_peak_anomaly (lower, when present),
  hot_days_flowering (higher; maize and sunflower only).
score = 100 x mean of those ranks. level: high >= 67, low < 33, medium in between.
Validation: county Alba, each crop and season with an INS yield; a "poor" year is an INS yield
more than 10 % below trend. hit = (high and poor) or (low/medium and not poor).

Quality windows (NASA POWER daily, mean over the commune's sample points, then counted):
- aflatoxin_window (maize): days with Tmax > 33 °C in maize flowering (crops.toml). high if
  >= 7 days and window rain below its 2001-2024 mean (Bailly et al. 2018 rule in crops.toml);
  medium if >= 7 days, or >= 3 days and at least 1.5x the normal; else low.
- fusarium_window (wheat): days with RH >= 85 % or rain >= 1 mm, 7 days before to 10 after
  anthesis. harvest_rain (every crop): days with rain >= 1 mm
  in the crop's harvest window. For these: high if the 2025 count is at or above the 80th
  percentile of 2001-2024, medium at or above the 60th, else low.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pyogrio

from api.contracts import (
    AdoptionScenario,
    AvailabilityRisk,
    CropOutlook,
    DataSource,
    EnvironmentalImpact,
    LatLon,
    Localized,
    QualityFlag,
    QualityRisk,
    Range,
    Reason,
    SourcingRecommendation,
    SourcingRegion,
    Validation,
    ValidationYear,
    Zone,
)
from farm_data import CACHE, power
from farm_data.crops import load_crops
from farm_data.features import POWER_RANGE

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "services" / "api" / "src" / "api" / "data" / "sourcing_alba.json"
PARCELS_DB = REPO_ROOT / "services" / "api" / "parcels" / "apia_parcels_alba.sqlite"
L = Localized

SEASON = 2025
FIRST = 2001
# Soybean is left out: the buyer imports GM soy (GM soy may not be grown in the EU).
CROPS = ["maize", "wheat", "barley", "sunflower"]
REFERENCE = ["maize", "wheat", "barley"]
MODEL_VERSION = "rule-percentile-0.1"
HIGH, LOW = 67.0, 33.0
POOR_PCT = -10.0
ARABLE = ("TA", "TAn")
# EUCROPMAP class names -> contract crop
MAP_CROP = {
    "maize": "maize",
    "common_wheat": "wheat",
    "durum_wheat": "wheat",
    "barley": "barley",
    "sunflower": "sunflower",
}
LEGUMES = ("soybean", "dry_pulses")
SUMMER_HEAT = ("maize", "sunflower")
CROP_NAME = {
    "maize": ("porumb", "maize"),
    "wheat": ("grâu", "wheat"),
    "sunflower": ("floarea-soarelui", "sunflower"),
    "barley": ("orz", "barley"),
}
LEVEL_RO = {"low": "scăzut", "medium": "mediu", "high": "ridicat"}


# --------------------------------------------------------------------------- risk rule

# indicator -> (worse direction, unit, ro label, en label)
INDICATORS: dict[str, tuple[int, str, str, str]] = {
    "water_deficit_mm": (+1, "mm", "Deficit de apă în sezon", "Season water deficit"),
    "gwetroot_critical": (
        -1,
        "0-1",
        "Umiditatea solului la rădăcină în perioada critică",
        "Root-zone soil wetness in the critical weeks",
    ),
    "ndvi_peak_anomaly": (
        -1,
        "z",
        "Verdeața maximă a culturilor (satelit) față de normal",
        "Peak crop greenness (satellite) vs normal",
    ),
    "hot_days_flowering": (
        +1,
        "days",
        "Zile fierbinți la înflorire",
        "Hot days at flowering",
    ),
}


def indicators_for(crop: str) -> list[str]:
    names = ["water_deficit_mm", "gwetroot_critical", "ndvi_peak_anomaly"]
    return names + (["hot_days_flowering"] if crop in SUMMER_HEAT else [])


def badness(value: float, others: np.ndarray, direction: int) -> float:
    """Share of the other seasons that were better than `value` (ties count half)."""
    others = others[~np.isnan(others)]
    if len(others) == 0 or np.isnan(value):
        return np.nan
    better = (others < value) if direction > 0 else (others > value)
    return float((better.sum() + 0.5 * (others == value).sum()) / len(others))


def score_season(hist: pd.DataFrame, crop: str, season: int) -> tuple[float, list[dict]]:
    """Risk score 0-100 for one zone x crop season and the per-indicator details."""
    row = hist[hist["season"] == season].iloc[0]
    rest = hist[(hist["season"] != season) & (hist["season"] >= FIRST)]
    parts = []
    for name in indicators_for(crop):
        direction = INDICATORS[name][0]
        v = row[name]
        if pd.isna(v):
            continue
        others = rest[name].astype(float).to_numpy()
        b = badness(float(v), others, direction)
        if np.isnan(b):
            continue
        parts.append(
            {"name": name, "value": float(v), "normal": float(np.nanmedian(others)), "rank": b}
        )
    score = 100 * float(np.mean([p["rank"] for p in parts])) if parts else 50.0
    return round(score, 1), parts


def level(score: float) -> str:
    return "high" if score >= HIGH else "low" if score < LOW else "medium"


def fmt(v: float, unit: str) -> str:
    if unit == "days":
        return f"{v:.0f}"
    if unit == "mm":
        return f"{v:.0f} mm"
    if unit == "0-1":
        return f"{v:.2f}"
    return f"{v:+.1f}"


def drivers(parts: list[dict]) -> list[Reason]:
    out = []
    for p in sorted(parts, key=lambda p: -p["rank"]):
        _, unit, ro, en = INDICATORS[p["name"]]
        obs, norm = fmt(p["value"], unit), fmt(p["normal"], unit)
        if p["rank"] >= 0.67:
            tag_ro, tag_en = "mai rău decât de obicei", "worse than usual"
        elif p["rank"] < 0.33:
            tag_ro, tag_en = "mai bine decât de obicei", "better than usual"
        else:
            tag_ro, tag_en = "aproape de normal", "close to normal"
        if p["name"] == "ndvi_peak_anomaly":
            text_ro = f"{ro}: {obs} abateri standard ({tag_ro})"
            text_en = f"{en}: {obs} standard deviations ({tag_en})"
        else:
            u_ro = " zile" if unit == "days" else ""
            u_en = " days" if unit == "days" else ""
            text_ro = f"{ro}: {obs}{u_ro} în {SEASON}, normal {norm}{u_ro} ({tag_ro})"
            text_en = f"{en}: {obs}{u_en} in {SEASON}, normal {norm}{u_en} ({tag_en})"
        out.append(
            Reason(
                code=p["name"],
                label=L(ro=text_ro, en=text_en),
                value=round(p["value"], 3),
                unit=unit,
            )
        )
    return out


# --------------------------------------------------------------------------- validation


Fit = tuple[float, float, float, float]  # intercept, slope, residual p20, residual p80


def validate(county: pd.DataFrame) -> tuple[Validation, dict[str, Fit]]:
    """Run the rule on county Alba for every season and compare with INS yield anomalies.
    Also fit yield anomaly ~ score per crop (used for expected_yield_anomaly_pct)."""
    years: list[ValidationYear] = []
    fits: dict[str, Fit] = {}
    for crop in CROPS:
        hist = county[county["crop"] == crop].sort_values("season")
        xs, ys = [], []
        for season in range(FIRST, SEASON + 1):
            obs = hist[hist["season"] == season]
            if obs.empty or pd.isna(obs["yield_anomaly_pct"].iloc[0]):
                continue
            score, _ = score_season(hist, crop, season)
            lv = level(score)
            anomaly = float(obs["yield_anomaly_pct"].iloc[0])
            poor = anomaly < POOR_PCT
            hit = (lv == "high" and poor) or (lv != "high" and not poor)
            years.append(
                ValidationYear(
                    season=season, crop=crop, risk_level=lv, yield_anomaly_pct=anomaly, hit=hit
                )
            )
            xs.append(score)
            ys.append(anomaly)
        x, y = np.array(xs), np.array(ys)
        b, a = np.polyfit(x, y, 1)
        r = float(np.corrcoef(x, y)[0, 1])
        resid = y - (a + b * x)
        if b < 0 and r <= -0.3:
            fits[crop] = (a, b, float(np.percentile(resid, 20)), float(np.percentile(resid, 80)))
        print(
            f"  {crop}: n={len(x)} r={r:+.2f} slope={b:+.2f} %/pt"
            f"  fit={'yes' if crop in fits else 'no'}"
        )
    hits = sum(y.hit for y in years)
    method = L(
        ro=(
            "Aceeași regulă ca pentru comune, aplicată județului Alba pentru fiecare an "
            f"{FIRST}-{SEASON}: fiecare indicator (deficit de apă, umiditatea solului, verdeața "
            "din satelit, zile fierbinți la înflorire) e comparat cu ceilalți ani; scorul e media "
            "rangurilor. Risc ridicat = scor de cel puțin 67. Un an e „slab” când producția medie "
            "INS a județului e cu peste 10% sub tendința pe termen lung. Potrivire = risc ridicat "
            "într-un an slab sau risc scăzut/mediu într-un an normal. Publicăm și ratările."
        ),
        en=(
            f"The same rule as for the communes, applied to Alba county for every season "
            f"{FIRST}-{SEASON}: each indicator (water deficit, soil wetness, satellite greenness, "
            "hot days at flowering) is ranked against the other seasons; the score is the mean "
            "rank. High risk = score 67 or more. A season is 'poor' when the INS county yield is "
            "more than 10% below its long-term trend. Hit = high risk in a poor season, or "
            "low/medium risk in a normal one. Misses are published too."
        ),
    )
    return Validation(method=method, hits=hits, misses=len(years) - hits, years=years), fits


# --------------------------------------------------------------------------- weather windows


def daily_by_zone(zone_ids: list[str]) -> dict[str, pd.DataFrame]:
    pts = pd.read_parquet(CACHE / "zones" / "points.parquet")
    out = {}
    for zid, g in pts[pts["zone_id"].isin(zone_ids)].groupby("zone_id"):
        frames = [power.fetch(r.lat, r.lon, *POWER_RANGE) for r in g.itertuples()]
        out[str(zid)] = pd.concat(frames).groupby(level=0).mean()
    return out


def _md(season: int, mmdd: str) -> date:
    m, d = map(int, mmdd.split("-"))
    return date(season, m, d)


def window_counts(w: pd.DataFrame, win: tuple[date, date], rule) -> pd.Series:
    """Per season FIRST..SEASON: count of days in the window matching `rule`."""
    out = {}
    for s in range(FIRST, SEASON + 1):
        a, b = win[0].replace(year=s), win[1].replace(year=s)
        d = w.loc[pd.Timestamp(a) : pd.Timestamp(b)]
        out[s] = int(rule(d).sum())
    return pd.Series(out)


def window_sum(w: pd.DataFrame, win: tuple[date, date], col: str) -> pd.Series:
    out = {}
    for s in range(FIRST, SEASON + 1):
        a, b = win[0].replace(year=s), win[1].replace(year=s)
        out[s] = float(w.loc[pd.Timestamp(a) : pd.Timestamp(b), col].sum())
    return pd.Series(out)


def pct_level(counts: pd.Series) -> str:
    obs, past = counts[SEASON], counts.drop(SEASON)
    if obs >= np.percentile(past, 80):
        return "high"
    if obs >= np.percentile(past, 60):
        return "medium"
    return "low"


def date_text(win: tuple[date, date]) -> tuple[str, str]:
    ro_m = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"]
    en_m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    a, b = win
    return (
        f"{a.day} {ro_m[a.month - 1]}-{b.day} {ro_m[b.month - 1]}",
        f"{a.day} {en_m[a.month - 1]}-{b.day} {en_m[b.month - 1]}",
    )


def quality_flags(kb, crop: str, w: pd.DataFrame) -> list[QualityFlag]:
    c = kb.crops[crop]
    flags = []

    def flag(code, label, lv, counts, win, what):
        d_ro, d_en = date_text(win)
        flags.append(
            QualityFlag(
                code=code,
                label=label,
                level=lv,
                days_observed=int(counts[SEASON]),
                days_normal=round(float(counts.drop(SEASON).mean()), 1),
                window=L(ro=f"{what[0]}, ~{d_ro}", en=f"{what[1]}, ~{d_en}"),
            )
        )

    if crop == "maize":
        flo = c.window("flowering", SEASON)
        hot = window_counts(w, flo, lambda d: d["T2M_MAX"] > 33.0)
        rain = window_sum(w, flo, "PRECTOTCORR")
        obs, normal = hot[SEASON], hot.drop(SEASON).mean()
        dry = rain[SEASON] < rain.drop(SEASON).mean()
        if obs >= 7 and dry:
            lv = "high"
        elif obs >= 7 or (obs >= 3 and obs >= 1.5 * normal):
            lv = "medium"
        else:
            lv = "low"
        flag(
            "aflatoxin_window",
            L(
                ro="Căldură și secetă la înflorire (risc de aflatoxine)",
                en="Heat and drought at flowering (aflatoxin risk)",
            ),
            lv,
            hot,
            flo,
            ("înflorirea porumbului, zile cu peste 33 °C", "maize flowering, days above 33 °C"),
        )
    if crop == "wheat":
        flo = c.window("flowering", SEASON)
        win = (flo[0] - timedelta(days=7), flo[0] + timedelta(days=10))
        wet = window_counts(w, win, lambda d: (d["RH2M"] >= 85.0) | (d["PRECTOTCORR"] >= 1.0))
        flag(
            "fusarium_window",
            L(
                ro="Vreme umedă la înflorire (risc de fuzarioză)",
                en="Wet weather at flowering (fusarium risk)",
            ),
            pct_level(wet),
            wet,
            win,
            (
                "înflorirea grâului, zile umede sau cu ploaie",
                "wheat flowering, humid or rainy days",
            ),
        )
    har = c.window("harvest", SEASON)
    wet = window_counts(w, har, lambda d: d["PRECTOTCORR"] >= 1.0)
    name_ro, name_en = CROP_NAME[crop]
    flag(
        "harvest_rain",
        L(
            ro="Ploaie la recoltare (boabe umede, mucegai)",
            en="Rain at harvest (wet grain, mould)",
        ),
        pct_level(wet),
        wet,
        har,
        (f"recoltarea ({name_ro}), zile cu ploaie", f"{name_en} harvest, rainy days"),
    )
    return flags


# --------------------------------------------------------------------------- APIA x crop map


def apia_areas(zip_path: Path, zone_ids: set[str]) -> tuple[pd.DataFrame, pd.Series]:
    """(ha per commune x crop, arable ha per commune), plus legume ha in column 'legume'."""
    src = f"/vsizip/{zip_path.resolve()}"
    df = pyogrio.read_dataframe(
        src,
        where="jud = 'AB'",
        columns=["gid", "sirsup_cod", "cat_use", "area", "jud"],
        read_geometry=False,
    )
    df = df[df["cat_use"].isin(ARABLE)].copy()
    df["zone_id"] = df["sirsup_cod"].astype(str)
    df = df[df["zone_id"].isin(zone_ids)]
    conn = sqlite3.connect(PARCELS_DB)
    crop22 = {}
    for pid, info in conn.execute("SELECT id, info FROM parcels WHERE info IS NOT NULL"):
        hist = json.loads(info).get("crop_history") or []
        c = next((h["crop"] for h in hist if h["year"] == 2022), None)
        if c:
            crop22[pid] = c
    df["map_crop"] = df["gid"].map(crop22)
    print(
        f"  APIA arable parcels in the 40 communes: {len(df):,} "
        f"({df['area'].sum():,.0f} ha), {df['map_crop'].notna().mean():.0%} with a 2022 crop"
    )
    df["crop"] = df["map_crop"].map(MAP_CROP)
    area = df.dropna(subset=["crop"]).groupby(["zone_id", "crop"])["area"].sum()
    arable = df.groupby("zone_id")["area"].sum()
    legume = df[df["map_crop"].isin(LEGUMES)].groupby("zone_id")["area"].sum()
    return area.unstack(fill_value=0.0), pd.concat(
        {"arable": arable, "legume": legume}, axis=1
    ).fillna(0.0)


# --------------------------------------------------------------------------- build


def build(zip_path: Path) -> tuple[SourcingRegion, pd.DataFrame]:
    kb = load_crops()
    zones = pd.read_parquet(CACHE / "zones" / "zones.parquet")
    zones = zones[zones["zone_type"] == "commune"].reset_index(drop=True)
    feats = pd.read_parquet(CACHE / "features" / "commune.parquet")
    county = pd.read_parquet(CACHE / "features" / "county.parquet")
    county = county[county["zone_id"] == "county:AB"]
    ids = set(zones["zone_id"])

    print("validation (county Alba vs INS):")
    validation, fits = validate(county)
    print("APIA x EUCROPMAP areas:")
    area, land = apia_areas(zip_path, ids)
    print("NASA POWER daily windows ...")
    daily = daily_by_zone(sorted(ids))

    out_zones = []
    table = []
    for z in zones.itertuples():
        arable = float(land["arable"].get(z.zone_id, 0.0))
        legume_pct = round(100 * land["legume"].get(z.zone_id, 0.0) / arable, 1) if arable else None
        outlooks = []
        for crop in CROPS:
            hist = feats[(feats["zone_id"] == z.zone_id) & (feats["crop"] == crop)]
            hist = hist.sort_values("season")
            score, parts = score_season(hist, crop, SEASON)
            lv = level(score)
            fit = fits.get(crop)
            expected = None
            if fit:
                a, b, lo, hi = fit
                mid = a + b * score
                expected = Range(low=round(mid + lo), mid=round(mid), high=round(mid + hi))
            flags = quality_flags(kb, crop, daily[z.zone_id])
            order = {"low": 0, "medium": 1, "high": 2}
            q_level = max((f.level for f in flags), key=order.__getitem__)
            row = hist[hist["season"] == SEASON].iloc[0]
            deficit = float(row["water_deficit_mm"])
            deficit_rank = next((p["rank"] for p in parts if p["name"] == "water_deficit_mm"), 0.5)
            points = int(deficit_rank >= 0.67) + int(legume_pct is not None and legume_pct < 2)
            impact_level = ["low", "medium", "high"][points]
            ha = round(float(area.loc[z.zone_id, crop]), 1) if z.zone_id in area.index else 0.0
            ndvi_ok = not pd.isna(row["ndvi_peak_anomaly"])
            confidence = "medium" if ndvi_ok and ha >= 20 else "low"
            outlooks.append(
                CropOutlook(
                    crop=crop,
                    area_ha=ha,
                    availability=AvailabilityRisk(
                        level=lv,
                        score=score,
                        expected_yield_anomaly_pct=expected,
                        drivers=drivers(parts),
                    ),
                    quality=QualityRisk(level=q_level, flags=flags),
                    impact=EnvironmentalImpact(
                        level=impact_level,
                        water_deficit_mm=round(deficit, 1),
                        legume_share_pct=legume_pct,
                        winter_cover_days=None,
                        emissions_kg_co2e_per_t=None,
                        notes=[
                            L(
                                ro=(
                                    "Nivelul crește cu un pas dacă deficitul de apă e printre "
                                    "cele mai mari din istoric (treimea de sus) și cu încă unul "
                                    "dacă leguminoasele (soia, mazăre, fasole) ocupă sub 2% din "
                                    "teren arabil."
                                ),
                                en=(
                                    "One step up when the water deficit is in the top third of "
                                    "the record, and one more when legumes (soy, peas, beans) "
                                    "cover under 2% of the arable land."
                                ),
                            )
                        ],
                    ),
                    confidence=confidence,
                    model_version=MODEL_VERSION,
                )
            )
            table.append(
                {
                    "zone_id": z.zone_id,
                    "name": z.name,
                    "crop": crop,
                    "score": score,
                    "level": lv,
                    "ha": ha,
                    "arable": arable,
                    "deficit_rank": deficit_rank,
                    "quality": q_level,
                    "flags": {f.code: f.level for f in flags},
                }
            )
        out_zones.append(
            Zone(
                id=z.zone_id,
                name=z.name,
                county="Alba",
                centroid=LatLon(lat=round(z.lat, 5), lon=round(z.lon, 5)),
                crops=outlooks,
            )
        )
    t = pd.DataFrame(table)
    return SourcingRegion(
        mock=False,
        region_name="Alba",
        season=SEASON,
        reference_crops=REFERENCE,
        zones=out_zones,
        recommendation=recommendation(t, county),
        caveats=CAVEATS,
        sources=SOURCES,
        validation=validation,
    ), t


# --------------------------------------------------------------------------- texts


def names(rows: pd.DataFrame) -> str:
    return ", ".join(rows["name"])


def wheat_action(safe: pd.DataFrame, test: pd.DataFrame, rainy_share: float) -> Localized:
    if len(test):
        rain_ro = (
            " și recoltarea din iulie a fost mai ploioasă decât de obicei"
            if rainy_share >= 0.5
            else ""
        )
        rain_en = " and the July harvest was rainier than usual" if rainy_share >= 0.5 else ""
        return L(
            ro=(
                f"Grâu: cumpărați întâi din {names(safe)} (cel mai mic risc față de istoricul "
                f"lor). Înflorirea a fost umedă{rain_ro}: testați loturile din {names(test)} "
                "pentru DON (toxina de fuzarioză) și umiditate."
            ),
            en=(
                f"Wheat: buy first from {names(safe)} (lowest risk against their own record). "
                f"Flowering was humid{rain_en}: test lots from {names(test)} for DON "
                "(fusarium toxin) and moisture."
            ),
        )
    return L(
        ro=f"Grâu: cumpărați întâi din {names(safe)} (cel mai mic risc față de istoricul lor).",
        en=f"Wheat: buy first from {names(safe)} (lowest risk against their own record).",
    )


def recommendation(t: pd.DataFrame, county: pd.DataFrame) -> SourcingRecommendation:
    maize = t[(t["crop"] == "maize") & (t["ha"] >= 100)]
    # Ties (communes on the same NASA POWER cell) go to the commune with more maize.
    safe = maize.sort_values(["score", "ha"], ascending=[True, False]).head(3)
    risky = maize.sort_values(["score", "ha"], ascending=[False, False]).head(3)
    lo, hi = maize["score"].min(), maize["score"].max()
    afla = risky[risky["flags"].map(lambda f: f.get("aflatoxin_window") != "low")]
    wet_harvest = maize["flags"].map(lambda f: f.get("harvest_rain") != "low").mean()
    wheat = t[(t["crop"] == "wheat") & (t["ha"] >= 50)]
    w_safe = wheat.sort_values(["score", "ha"], ascending=[True, False]).head(3)
    w_wet = wheat[wheat["flags"].map(lambda f: f.get("fusarium_window") != "low")]
    w_test = w_wet.sort_values("ha", ascending=False).head(3)
    w_rain = wheat["flags"].map(lambda f: f.get("harvest_rain") == "high").mean()
    ins = county[(county["crop"] == "maize") & (county["season"] == SEASON)]
    ins_pct = float(ins["yield_anomaly_pct"].iloc[0])
    if len(afla):
        check = L(
            ro=(
                f"Testați loturile de porumb din {names(afla)} pentru aflatoxine la recepție: "
                "acolo au fost multe zile peste 33 °C la înflorire."
            ),
            en=(
                f"Test maize lots from {names(afla)} for aflatoxin at intake: they had many "
                "days above 33 °C at flowering."
            ),
        )
    else:
        harvest_ro = (
            "toamna a fost mai ploioasă decât de obicei la recoltare, deci "
            if wet_harvest >= 0.5
            else ""
        )
        harvest_en = "autumn was rainier than usual at harvest, so " if wet_harvest >= 0.5 else ""
        check = L(
            ro=(
                "Semnalul de aflatoxine e scăzut în acest an (zile fierbinți la înflorire "
                f"aproape de normal); {harvest_ro}verificați umiditatea și mucegaiul la loturile "
                f"de porumb din {names(risky)}."
            ),
            en=(
                "The aflatoxin signal is low this season (hot days at flowering close to "
                f"normal); {harvest_en}check moisture and mould on maize lots from "
                f"{names(risky)}."
            ),
        )
    actions = [
        L(
            ro=(
                f"Asigurați volumele de porumb din timp: producția județului a fost cu "
                f"{abs(ins_pct):.0f}% sub tendință. Începeți cu {names(safe)}, unde sezonul a "
                "arătat cel mai puțin rău față de istoricul lor."
            ),
            en=(
                f"Secure maize volumes early: the county yield was {abs(ins_pct):.0f}% below "
                f"trend. Start with {names(safe)}, where the season looked least bad against "
                "their own record."
            ),
        ),
        check,
        wheat_action(w_safe, w_test, w_rain),
    ]
    first = safe["name"].iloc[0]
    return SourcingRecommendation(
        title=L(
            ro=f"Porumb {SEASON}: ofertă mică în tot județul; cel mai puțin afectat, {first}",
            en=f"Maize {SEASON}: tight supply across the county; least affected, {first}",
        ),
        text=L(
            ro=(
                f"Producția medie de porumb din județul Alba în {SEASON} a fost cu "
                f"{abs(ins_pct):.0f}% sub tendință (INS): sezonul a fost secetos peste tot. "
                f"Diferențele dintre comune sunt mici (scor de risc {lo:.0f}-{hi:.0f} din 100). "
                f"Cel mai puțin afectate par {names(safe)}; cel mai afectate, {names(risky)}. "
                "Fiecare comună e comparată cu propriul ei istoric 2001-2025 "
                "(vreme și umiditatea solului din NASA POWER)."
            ),
            en=(
                f"Alba's county maize yield in {SEASON} was {abs(ins_pct):.0f}% below trend "
                "(INS): the season was dry everywhere. Differences between communes are small "
                f"(risk score {lo:.0f}-{hi:.0f} of 100). Least affected look {names(safe)}; "
                f"most affected, {names(risky)}. Each commune is compared with its own "
                "2001-2025 record (NASA POWER weather and soil wetness)."
            ),
        ),
        actions=actions,
        confidence="medium",
        assumptions=[
            L(
                ro=(
                    "Doar comunele cu cel puțin 100 ha de porumb "
                    "(APIA 2025 x harta culturilor 2022)."
                ),
                en="Only communes with at least 100 ha of maize (APIA 2025 x 2022 crop map).",
            ),
            L(
                ro=(
                    "Vremea vine din celule NASA POWER de ~50 km, deci mai multe comune au "
                    "aceleași valori; la egalitate, comuna cu mai mult porumb e trecută prima."
                ),
                en=(
                    "Weather comes from ~50 km NASA POWER cells, so several communes share the "
                    "same values; ties go to the commune with more maize."
                ),
            ),
            L(
                ro=(
                    f"Imaginile din satelit (MODIS) lipsesc pentru vara {SEASON}, deci scorul "
                    "porumbului și al florii-soarelui se bazează doar pe vreme și umiditatea "
                    "solului."
                ),
                en=(
                    f"Satellite images (MODIS) are missing for summer {SEASON}, so the maize "
                    "and sunflower scores rest on weather and soil wetness only."
                ),
            ),
            L(
                ro="Pragurile pentru aflatoxine și fuzarioză vin din studii, nevalidate local.",
                en="Aflatoxin and fusarium thresholds come from studies, not validated locally.",
            ),
        ],
    )


def scenario() -> AdoptionScenario:
    """Placeholder: the contract still requires a scenario; not used for this buyer."""
    zero = Range(low=0, mid=0, high=0)
    return AdoptionScenario(
        crop="barley",
        adoption_pct=0,
        added_area_ha=zero,
        added_production_t=zero,
        added_protein_t=zero,
        assumptions=[L(ro="Nefolosit.", en="Not used.")],
    )


CAVEATS = [
    L(
        ro=(
            "Riscul compară fiecare comună cu propriul ei istoric 2001-2025; nu este o prognoză "
            "de producție. Vremea vine din NASA POWER (celule de ~50 km), deci comunele vecine "
            "pot primi aceleași valori."
        ),
        en=(
            "Risk compares each commune with its own 2001-2025 record; it is not a yield "
            "forecast. Weather comes from NASA POWER (~50 km cells), so neighbouring communes "
            "can share the same values."
        ),
    ),
    L(
        ro=(
            "Suprafețele pe cultură sunt parcelele declarate la APIA în 2025 combinate cu harta "
            "culturilor EUCROPMAP 2022 (precizie ~70-80%), nu culturile declarate în 2025."
        ),
        en=(
            "Crop areas are parcels declared to APIA in 2025 combined with the EUCROPMAP 2022 "
            "crop map (~70-80% accurate), not the crops declared for 2025."
        ),
    ),
    L(
        ro=(
            f"Imaginile MODIS lipsesc pentru vara {SEASON} (nicio compoziție între iulie și "
            "noiembrie), iar umiditatea solului SMAP nu este încă inclusă; încrederea e mai mică "
            "pentru culturile de vară."
        ),
        en=(
            f"MODIS images are missing for summer {SEASON} (no composite from July to "
            "November), and SMAP soil moisture is not included yet; confidence is lower for "
            "summer crops."
        ),
    ),
    L(
        ro=(
            "Validarea se face la nivel de județ (INS nu publică producții pe comune). Pragurile "
            "pentru calitate sunt preluate din studii și nu au fost verificate de un agronom."
        ),
        en=(
            "Validation is at county level (INS publishes no commune yields). The quality "
            "thresholds are borrowed from studies and have not been checked by an agronomist."
        ),
    ),
]

SOURCES = [
    DataSource(
        dataset="NASA POWER",
        product="T2M_MAX, PRECTOTCORR, RH2M, GWETROOT, ET0 (daily, AG community)",
        resolution="0.5° x 0.625°",
        period="2001-2025",
        is_nasa=True,
        url="https://power.larc.nasa.gov/",
    ),
    DataSource(
        dataset="MODIS MOD13Q1 / MYD13Q1 v061",
        product="NDVI 16-day composites (Planetary Computer modis-13Q1-061)",
        resolution="250 m (read at ~460 m)",
        period=f"2001-{SEASON} (summer {SEASON} missing)",
        is_nasa=True,
        url="https://lpdaac.usgs.gov/products/mod13q1v061/",
    ),
    DataSource(
        dataset="SMAP L4",
        product="Root-zone soil moisture (SPL4SMGP) — pending, not used in this build",
        resolution="9 km",
        period="not yet included",
        is_nasa=True,
        url="https://nsidc.org/data/spl4smgp",
    ),
    DataSource(
        dataset="APIA LPIS 2025 x JRC EUCROPMAP 2022",
        product="parcels declared to APIA 2025 x EUCROPMAP 2022 crop map (majority class)",
        resolution="parcel / 10 m",
        period="2025 parcels, 2022 crop map",
        is_nasa=False,
        url="https://data.gov.ro/dataset/parcele_agricole_agionline_apia",
    ),
    DataSource(
        dataset="INS TEMPO AGR110A / AGR108A",
        product="county crop yield and area, Alba",
        resolution="county",
        period="1990-2025",
        is_nasa=False,
        url="http://statistici.insse.ro:8077/tempo-online/",
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("zip", type=Path, help="the APIA LPIS 2025 zip from data.gov.ro")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    region, t = build(args.zip)
    text = region.model_dump_json(indent=None)
    SourcingRegion.model_validate_json(text)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text + "\n", encoding="utf-8")

    m = t[(t["crop"] == "maize") & (t["ha"] >= 100)][["name", "score", "ha"]]
    safe = m.sort_values(["score", "ha"], ascending=[True, False]).head(3)
    risky = m.sort_values(["score", "ha"], ascending=[False, False]).head(3)
    print("\nmaize, safest:", safe.to_dict("records"))
    print("maize, riskiest:", risky.to_dict("records"))
    print(
        "levels by crop:",
        t.groupby("crop")["level"].value_counts().unstack(fill_value=0).to_dict("index"),
    )
    v = region.validation
    assert v
    print(f"validation: {v.hits} hits, {v.misses} misses")
    for crop in CROPS:
        ys = [y for y in v.years if y.crop == crop]
        print(
            f"  {crop}: {sum(y.hit for y in ys)}/{len(ys)}  misses: "
            f"{[(y.season, y.risk_level, y.yield_anomaly_pct) for y in ys if not y.hit]}"
        )
    print(f"wrote {args.out.relative_to(REPO_ROOT)} ({args.out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
