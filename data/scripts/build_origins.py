"""Build the "imported soy" view: is any origin heading for a short soybean crop?

    uv run --package farm-data python data/scripts/build_origins.py [--end 2026-11-10]

Origins a Romanian feed buyer imports soy from: Argentina's core belt, southern Brazil (Paraná,
Rio Grande do Sul), Brazil's centre-west (Mato Grosso, Goiás, Mato Grosso do Sul) and Ukraine.

The rule is the same as the Alba buyer view, with nothing fitted to yields:
- NASA POWER daily weather at a few points per region, weighted by their share of the crop.
- Over the weeks that decide the crop (flowering to pod fill) three indicators: rain minus
  reference crop water use (mm), mean root-zone soil wetness, days at or above 33 °C.
- Each indicator is ranked against the same weeks of every other season 2001-2025; the score is
  the mean share of seasons that were better (0 best, 100 worst). >= 67 is high, < 33 low.
- A reading "as of" a date uses the window only up to that date, for every season alike.

Checked against official yields vs their 2001-2025 linear trend (a poor season is >= 10% below):
USDA PSD national yields (Argentina, Ukraine) and IBGE PAM state yields (Brazil, table 1612).
Writes services/api/src/api/data/origins.json (contract: ImportOrigins).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from api.contracts import (
    Confidence,
    Crop,
    DataSource,
    ImportOrigin,
    ImportOrigins,
    Localized,
    OfficialEstimate,
    OriginCheckpoint,
    OriginPoint,
    OriginReading,
    OriginReplay,
    OriginSeason,
    OriginStage,
    OriginTrack,
    Reason,
)
from farm_data import CACHE, power

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "services" / "api" / "src" / "api" / "data" / "origins.json"
# The web app bundles the same build, shown when the API cannot be reached.
WEB_COPY = REPO_ROOT / "apps" / "web" / "src" / "mocks" / "import_origins.json"
L = Localized

FIRST, LAST_HISTORY = 2001, 2025
HIGH, LOW = 67.0, 33.0
POOR_PCT = -10.0
HOT_C = 33.0
NRT_DAYS = 60
PSD_URL = "https://apps.fas.usda.gov/psdonline/downloads/psd_oilseeds_csv.zip"
SIDRA_URL = (
    "https://apisidra.ibge.gov.br/values/t/1612/n3/{states}/v/214,216/p/2001-2025/c81/2713/f/a"
)
LEVEL = {"low": ("scăzut", "low"), "medium": ("mediu", "medium"), "high": ("ridicat", "high")}
OUTCOME = {
    "caught": (" (semnalat corect)", " (flagged, rightly)"),
    "missed": (" (ratat de noi)", " (we missed it)"),
    "false_alarm": (" (alarmă falsă)", " (a false alarm)"),
    "normal": ("", ""),
    "none": (" (fără cifră oficială încă)", " (no official figure yet)"),
}
MONTHS_RO = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"]
MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# (worse direction, unit, ro, en)
INDICATORS = {
    "water_balance": (
        -1,
        "mm",
        "Ploaie minus apa folosită de cultură",
        "Rain minus crop water use",
    ),
    "soil_wetness": (-1, "", "Umiditatea solului la rădăcini", "Root-zone soil wetness"),
    "hot_days": (+1, "days", f"Zile cu peste {HOT_C:.0f} °C", f"Days above {HOT_C:.0f} °C"),
}


@dataclass(frozen=True)
class Origin:
    id: str
    country: str
    name: Localized
    provinces: Localized
    role: Localized
    southern: bool  # season spans the new year; keyed by planting year
    window: tuple[str, str]  # MM-DD, MM-DD
    checkpoints: tuple[str, ...]  # MM-DD, the last one is the window end
    harvest: Localized
    harvest_md: tuple[str, str]  # MM-DD, MM-DD
    window_text: Localized
    points: tuple[tuple[str, float, float, float], ...]
    truth: str  # "psd:<country>" or "ibge:<state ids>"
    truth_text: Localized


ORIGINS = [
    Origin(
        id="ar-core",
        country="AR",
        name=L(ro="Argentina, zona de bază a soiei", en="Argentina, core soy belt"),
        provinces=L(
            ro="Buenos Aires, Córdoba, Santa Fe, Entre Ríos, Santiago del Estero",
            en="Buenos Aires, Córdoba, Santa Fe, Entre Ríos, Santiago del Estero",
        ),
        role=L(ro="", en=""),  # filled from USDA trade numbers
        southern=True,
        window=("12-15", "03-15"),
        checkpoints=("01-15", "02-01", "02-15", "03-01", "03-15"),
        harvest=L(ro="aprilie-mai", en="April-May"),
        harvest_md=("04-01", "05-31"),
        window_text=L(
            ro="15 dec - 15 mar: înflorire și umplerea boabelor",
            en="15 Dec - 15 Mar: flowering and pod fill",
        ),
        points=(
            ("Rosario", -33.0, -60.7, 3),
            ("Pergamino", -33.9, -60.6, 3),
            ("Marcos Juárez", -32.7, -62.1, 3),
            ("Villa María", -32.4, -63.2, 2),
            ("Río Cuarto", -33.1, -64.3, 2),
            ("9 de Julio", -35.4, -60.9, 2),
            ("Paraná", -31.7, -60.5, 1),
            ("Tres Arroyos", -38.4, -60.3, 1),
            ("Santiago del Estero", -27.8, -64.3, 1),
        ),
        truth="psd:Argentina",
        truth_text=L(
            ro="randamentul național al soiei, USDA PSD", en="national soybean yield, USDA PSD"
        ),
    ),
    Origin(
        id="br-south",
        country="BR",
        name=L(ro="Brazilia de Sud", en="Southern Brazil"),
        provinces=L(ro="Paraná, Rio Grande do Sul", en="Paraná, Rio Grande do Sul"),
        role=L(ro="", en=""),
        southern=True,
        window=("12-15", "03-15"),
        checkpoints=("01-15", "02-01", "02-15", "03-01", "03-15"),
        harvest=L(ro="martie-mai", en="March-May"),
        harvest_md=("03-01", "05-31"),
        window_text=L(
            ro="15 dec - 15 mar: înflorire și umplerea boabelor",
            en="15 Dec - 15 Mar: flowering and pod fill",
        ),
        points=(
            ("Cascavel", -24.9, -53.5, 2),
            ("Toledo", -24.7, -53.7, 1),
            ("Campo Mourão", -24.0, -52.4, 1),
            ("Londrina", -23.3, -51.2, 1),
            ("Ponta Grossa", -25.1, -50.2, 1),
            ("Cruz Alta", -28.6, -53.6, 2),
            ("Passo Fundo", -28.3, -52.4, 1),
            ("Ijuí", -28.4, -53.9, 1),
            ("Santa Rosa", -27.9, -54.5, 1),
        ),
        truth="ibge:41,43",
        truth_text=L(
            ro="randamentul soiei în Paraná și Rio Grande do Sul, IBGE PAM",
            en="soybean yield of Paraná and Rio Grande do Sul, IBGE PAM",
        ),
    ),
    Origin(
        id="br-centre",
        country="BR",
        name=L(ro="Brazilia Centru-Vest", en="Brazil Centre-West"),
        provinces=L(
            ro="Mato Grosso, Goiás, Mato Grosso do Sul", en="Mato Grosso, Goiás, Mato Grosso do Sul"
        ),
        role=L(ro="", en=""),
        southern=True,
        window=("11-15", "02-15"),
        checkpoints=("12-15", "01-01", "01-15", "02-01", "02-15"),
        harvest=L(ro="ianuarie-aprilie", en="January-April"),
        harvest_md=("01-15", "04-30"),
        window_text=L(
            ro="15 nov - 15 feb: înflorire și umplerea boabelor",
            en="15 Nov - 15 Feb: flowering and pod fill",
        ),
        points=(
            ("Sorriso", -12.5, -55.7, 2),
            ("Campo Novo do Parecis", -13.7, -57.9, 1),
            ("Querência", -12.6, -52.2, 1),
            ("Primavera do Leste", -15.5, -54.3, 1),
            ("Rondonópolis", -16.5, -54.6, 1),
            ("Rio Verde", -17.8, -50.9, 1),
            ("Jataí", -17.9, -51.7, 1),
            ("Cristalina", -16.8, -47.6, 1),
            ("Maracaju", -21.6, -55.2, 1),
            ("Dourados", -22.2, -54.8, 1),
        ),
        truth="ibge:50,51,52",
        truth_text=L(
            ro="randamentul soiei în Mato Grosso, Goiás și Mato Grosso do Sul, IBGE PAM",
            en="soybean yield of Mato Grosso, Goiás and Mato Grosso do Sul, IBGE PAM",
        ),
    ),
    Origin(
        id="ua",
        country="UA",
        name=L(ro="Ucraina", en="Ukraine"),
        provinces=L(
            ro="Hmelnîțkîi, Vinnîțea, Poltava, Kiev, Jîtomîr, Cerkasî, Cernihiv, Sumî",
            en="Khmelnytskyi, Vinnytsia, Poltava, Kyiv, Zhytomyr, Cherkasy, Chernihiv, Sumy",
        ),
        role=L(ro="", en=""),
        southern=False,
        window=("07-01", "08-31"),
        checkpoints=("07-15", "08-01", "08-15", "08-31"),
        harvest=L(ro="septembrie-octombrie", en="September-October"),
        harvest_md=("09-01", "10-31"),
        window_text=L(
            ro="1 iul - 31 aug: înflorire și umplerea boabelor",
            en="1 Jul - 31 Aug: flowering and pod fill",
        ),
        points=(
            ("Khmelnytskyi", 49.4, 27.0, 2),
            ("Vinnytsia", 49.2, 28.5, 2),
            ("Poltava", 49.6, 34.5, 2),
            ("Kyiv", 50.1, 30.8, 1.5),
            ("Zhytomyr", 50.3, 28.7, 1.5),
            ("Cherkasy", 49.4, 32.1, 1.5),
            ("Chernihiv", 51.5, 31.3, 1),
            ("Sumy", 50.9, 34.8, 1),
        ),
        truth="psd:Ukraine",
        truth_text=L(
            ro="randamentul național al soiei, USDA PSD", en="national soybean yield, USDA PSD"
        ),
    ),
]

# USDA WASDE estimates of Argentina's 2022/23 soybean crop as the drought unfolded.
WASDE_AR_2022 = [
    ("2023-02-08", 41.0),
    ("2023-03-08", 33.0),
    ("2023-04-11", 27.0),
]


# --------------------------------------------------------------------------- inputs


def psd_rows() -> list[dict[str, str]]:
    path = CACHE / "psd" / "psd_oilseeds.csv"
    if not path.exists():
        print("USDA PSD oilseeds ...")
        r = requests.get(PSD_URL, timeout=300)
        r.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            path.write_bytes(z.read("psd_oilseeds.csv"))
    keep = {"Argentina", "Brazil", "Ukraine"}
    with path.open(encoding="utf-8") as f:
        return [
            r
            for r in csv.DictReader(f)
            if r["Country_Name"] in keep
            and r["Commodity_Description"] in ("Oilseed, Soybean", "Meal, Soybean")
        ]


def psd_series(rows, country: str, commodity: str, attribute: str) -> dict[int, float]:
    return {
        int(r["Market_Year"]): float(r["Value"])
        for r in rows
        if r["Country_Name"] == country
        and r["Commodity_Description"] == commodity
        and r["Attribute_Description"] == attribute
    }


def ibge_yield(states: str) -> dict[int, float]:
    """Combined yield (t/ha) of the given states, keyed by planting year (harvest year - 1)."""
    path = CACHE / "ibge" / f"soy_{states.replace(',', '_')}.json"
    if not path.exists():
        print(f"IBGE SIDRA {states} ...")
        r = requests.get(SIDRA_URL.format(states=states), timeout=120)
        r.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(r.text, encoding="utf-8")
    prod: dict[int, float] = {}
    area: dict[int, float] = {}
    for row in json.loads(path.read_text(encoding="utf-8"))[1:]:
        if not row["V"].replace(".", "").isdigit():
            continue
        year = int(row["D3N"]) - 1
        target = prod if row["D2C"] == "214" else area
        target[year] = target.get(year, 0.0) + float(row["V"])
    return {y: prod[y] / area[y] for y in prod if area.get(y)}


def truth_for(o: Origin, psd) -> dict[int, float]:
    kind, key = o.truth.split(":")
    if kind == "psd":
        return psd_series(psd, key, "Oilseed, Soybean", "Yield")
    return ibge_yield(key)


def anomalies(series: dict[int, float]) -> dict[int, float]:
    """Yield vs its FIRST..LAST_HISTORY linear trend, %, for every year with a value."""
    hist = {y: v for y, v in series.items() if FIRST <= y <= LAST_HISTORY}
    a, b = np.polyfit(list(hist), list(hist.values()), 1)
    return {y: round(100 * (v / (a * y + b) - 1), 1) for y, v in series.items() if y >= FIRST}


# --------------------------------------------------------------------------- weather


def span(o: Origin, season: int, end_md: str) -> tuple[date, date]:
    """Window of `season` (planting year) from its start to `end_md`."""
    s_m, s_d = map(int, o.window[0].split("-"))
    e_m, e_d = map(int, end_md.split("-"))
    start = date(season, s_m, s_d)
    end = date(season + (1 if o.southern and e_m < 7 else 0), e_m, e_d)
    return start, end


def indicators(frames: list[pd.DataFrame], weights: np.ndarray, a: date, b: date) -> dict:
    vals = []
    for df in frames:
        s = df.loc[pd.Timestamp(a) : pd.Timestamp(b)]
        vals.append(
            [
                float((s["PRECTOTCORR"] - s["ET0"]).sum()),
                float(s["GWETROOT"].mean()),
                float((s["T2M_MAX"] >= HOT_C).sum()),
            ]
        )
    v = np.nansum(np.array(vals) * weights[:, None], axis=0)
    return dict(zip(INDICATORS, v.tolist(), strict=True))


def score(row: dict, others: list[dict], names=tuple(INDICATORS)) -> tuple[float, list[dict]]:
    parts = []
    for name in names:
        direction = INDICATORS[name][0]
        o = np.array([x[name] for x in others])
        better = (o > row[name]) if direction < 0 else (o < row[name])
        ties = (o == row[name]).sum()
        parts.append(
            {
                "name": name,
                "value": row[name],
                "normal": float(np.median(o)),
                "rank": float((better.sum() + 0.5 * ties) / len(o)),
            }
        )
    return round(100 * float(np.mean([p["rank"] for p in parts])), 1), parts


def level(s: float) -> str:
    return "high" if s >= HIGH else "low" if s < LOW else "medium"


def drivers(parts: list[dict]) -> list[Reason]:
    out = []
    for p in sorted(parts, key=lambda p: -p["rank"]):
        _, unit, ro, en = INDICATORS[p["name"]]
        worse = round(100 * p["rank"])
        if p["name"] == "soil_wetness":
            v, n = f"{p['value']:.2f}", f"{p['normal']:.2f}"
        else:
            v, n = f"{p['value']:.0f}", f"{p['normal']:.0f}"
        u = {"mm": " mm", "days": "", "": ""}[unit]
        out.append(
            Reason(
                code=p["name"],
                label=L(
                    ro=f"{ro}: {v}{u} (normal {n}{u}); mai rău decât {worse}% din sezoane",
                    en=f"{en}: {v}{u} (normal {n}{u}); worse than {worse}% of seasons",
                ),
                value=round(p["value"], 3),
                unit=unit or None,
            )
        )
    return out


def season_label(o: Origin, season: int) -> str:
    return f"{season}/{(season + 1) % 100:02d}" if o.southern else str(season)


def day_text(d: date) -> tuple[str, str]:
    return f"{d.day} {MONTHS_RO[d.month - 1]}", f"{d.day} {MONTHS_EN[d.month - 1]}"


# --------------------------------------------------------------------------- build


@dataclass
class Built:
    origin: ImportOrigin
    final_by_season: dict[int, float]


def build_origin(o: Origin, psd, end: date) -> Built:
    pts = o.points
    with ThreadPoolExecutor(5) as ex:
        frames = list(ex.map(lambda p: power.fetch(p[1], p[2], date(2000, 1, 1), end), pts))
    frames = [f.dropna(subset=["PRECTOTCORR", "T2M_MAX", "GWETROOT"]) for f in frames]
    last_day = min(f.index.max().date() for f in frames)
    w = np.array([p[3] for p in pts], float)
    w = w / w.sum()

    current = (end.year - 1) if o.southern and end.month < 7 else end.year
    if not o.southern and end < date(end.year, *map(int, o.window[0].split("-"))):
        current = end.year - 1
    seasons = list(range(FIRST, current + 1))
    cur_start, cur_end = span(o, current, o.window[1])
    stage = (
        OriginStage.BEFORE
        if last_day < cur_start
        else OriginStage.DONE
        if last_day >= cur_end
        else OriginStage.IN_WINDOW
    )
    complete = seasons if stage == OriginStage.DONE else seasons[:-1]

    def table(end_md: str) -> dict[int, dict]:
        return {s: indicators(frames, w, *span(o, s, end_md)) for s in complete}

    tables = {md: table(md) for md in o.checkpoints}
    final_md = o.checkpoints[-1]
    truth = anomalies(truth_for(o, psd))

    def scored(s: int, md: str) -> tuple[float, list[dict]]:
        t = tables[md]
        history = [t[y] for y in t if y != s and FIRST <= y <= LAST_HISTORY]
        return score(t[s], history)

    out_seasons: list[OriginSeason] = []
    finals: dict[int, float] = {}
    for s in complete:
        sc, _ = scored(s, final_md)
        finals[s] = sc
        anom = truth.get(s)
        flag, poor = sc >= HIGH, anom is not None and anom <= POOR_PCT
        outcome = None
        if anom is not None:
            outcome = (
                "caught"
                if flag and poor
                else "missed"
                if poor
                else "false_alarm"
                if flag
                else "normal"
            )
        cps = []
        for md in o.checkpoints:
            cs, _ = scored(s, md)
            cps.append(
                OriginCheckpoint(as_of=span(o, s, md)[1].isoformat(), score=cs, level=level(cs))
            )
        out_seasons.append(
            OriginSeason(
                season=season_label(o, s),
                harvest_year=s + 1 if o.southern else s,
                score=sc,
                level=level(sc),
                yield_anomaly_pct=anom,
                outcome=outcome,
                checkpoints=cps,
            )
        )

    # Track record over seasons with an official yield (the current one only if final-ish).
    judged = [x for x in out_seasons if x.outcome is not None]
    an = np.array([x.yield_anomaly_pct for x in judged], float)
    corr_at = {}
    for i, md in enumerate(o.checkpoints):
        sc = np.array([x.checkpoints[i].score for x in judged])
        corr_at[md] = float(np.corrcoef(sc, an)[0, 1])
    r_final = corr_at[final_md]
    track = OriginTrack(
        truth=o.truth_text,
        seasons=len(judged),
        bad_seasons=sum(x.outcome in ("caught", "missed") for x in judged),
        caught=sum(x.outcome == "caught" for x in judged),
        false_alarms=sum(x.outcome == "false_alarm" for x in judged),
        correlation=round(r_final, 2),
        lead=lead_text(o, corr_at),
    )

    reading = None
    if stage != OriginStage.BEFORE:
        a = cur_start
        b = min(last_day, cur_end)
        md = f"{b.month:02d}-{b.day:02d}"
        hist_rows = [indicators(frames, w, *span(o, y, md)) for y in seasons[:-1] if y >= FIRST]
        row = indicators(frames, w, a, b)
        # NASA POWER fills its newest ~2 months from a near-real-time source whose soil wetness
        # runs well below the long record (a step in Oct 2026 in South America), so a window
        # touching those weeks is provisional and leaves soil wetness out.
        provisional = b > last_day - timedelta(days=NRT_DAYS)
        names = [n for n in INDICATORS if not (provisional and n == "soil_wetness")]
        sc, parts = score(row, hist_rows, names)
        reading = OriginReading(
            as_of=b.isoformat(),
            score=sc,
            level=level(sc),
            drivers=drivers(parts),
            provisional=provisional,
        )

    origin = ImportOrigin(
        id=o.id,
        country=o.country,
        name=o.name,
        provinces=o.provinces,
        crop=Crop.SOYBEAN,
        role=role(o, psd),
        confidence=confidence(r_final),
        window=o.window_text,
        harvest=o.harvest,
        window_start=o.window[0],
        window_end=o.window[1],
        harvest_start=o.harvest_md[0],
        harvest_end=o.harvest_md[1],
        next_reading=next(
            (
                d.isoformat()
                for d in (span(o, current, md)[1] for md in o.checkpoints)
                if d > last_day
            ),
            None,
        ),
        points=[OriginPoint(name=n, lat=la, lon=lo, weight=wt) for n, la, lo, wt in pts],
        stage=stage,
        current_season=season_label(o, current),
        current=reading,
        note=note(o, stage, current, reading, truth, out_seasons),
        track=track,
        seasons=out_seasons,
    )
    print(
        f"{o.id:10s} stage={stage} last_day={last_day} r={r_final:+.2f} "
        f"caught {track.caught}/{track.bad_seasons}, false alarms {track.false_alarms}; "
        f"r by checkpoint { ({k: round(v, 2) for k, v in corr_at.items()}) }"
    )
    return Built(origin, finals)


def confidence(r: float) -> Confidence:
    return Confidence.HIGH if r <= -0.6 else Confidence.MEDIUM if r <= -0.35 else Confidence.LOW


def lead_text(o: Origin, corr_at: dict[str, float]) -> Localized:
    final_md = o.checkpoints[-1]
    r_final = corr_at[final_md]
    if r_final > -0.35:
        return L(
            ro="Vremea explică puțin din recolta de aici. Citiți scorul ca pe o notă, nu ca pe "
            "un semnal.",
            en="Weather explains little of the harvest here. Read the score as a note, not a "
            "signal.",
        )
    useful = next(md for md in o.checkpoints if corr_at[md] <= 0.85 * r_final)
    ro_d, en_d = day_text(date(2001, *map(int, useful.split("-"))))
    return L(
        ro=f"Citirea e de încredere din {ro_d}, înainte de recoltare ({o.harvest.ro}) și de "
        "cifrele oficiale.",
        en=f"The reading can be trusted from {en_d}, before the harvest ({o.harvest.en}) and "
        "the official figures.",
    )


def role(o: Origin, psd) -> Localized:
    def last_full(series: dict[int, float]) -> tuple[int, float]:
        y = max(k for k in series if k <= LAST_HISTORY - 1)
        return y, series[y]

    if o.country == "AR":
        meal = psd_series(psd, "Argentina", "Meal, Soybean", "Exports")
        y, v = last_full(meal)
        drop = 100 * (meal[2022] / meal[2021] - 1)
        return L(
            ro=f"Cel mai mare exportator de șrot de soia: {v / 1000:.1f} mil. t în "
            f"{y}/{(y + 1) % 100:02d} (USDA). După seceta din 2022/23 exportul de șrot a "
            f"scăzut cu {-drop:.0f}%.",
            en=f"The biggest soybean meal exporter: {v / 1000:.1f} Mt in {y}/{(y + 1) % 100:02d} "
            f"(USDA). After the 2022/23 drought its meal exports fell {-drop:.0f}%.",
        )
    if o.country == "BR":
        beans = psd_series(psd, "Brazil", "Oilseed, Soybean", "Exports")
        meal = psd_series(psd, "Brazil", "Meal, Soybean", "Exports")
        y, v = last_full(beans)
        part = (
            (
                "Sudul are secetele: 2004/05, 2011/12, 2021/22.",
                "The south is where droughts hit: 2004/05, 2011/12, 2021/22.",
            )
            if o.id == "br-south"
            else (
                "Aici ploile de vară sunt de obicei sigure.",
                "Summer rains are usually reliable here.",
            )
        )
        return L(
            ro=f"Brazilia exportă cea mai multă soia: {v / 1000:.0f} mil. t boabe și "
            f"{meal[y] / 1000:.0f} mil. t șrot în {y}/{(y + 1) % 100:02d} (USDA). {part[0]}",
            en=f"Brazil exports the most soy: {v / 1000:.0f} Mt of beans and "
            f"{meal[y] / 1000:.0f} Mt of meal in {y}/{(y + 1) % 100:02d} (USDA). {part[1]}",
        )
    beans = psd_series(psd, "Ukraine", "Oilseed, Soybean", "Exports")
    meal = psd_series(psd, "Ukraine", "Meal, Soybean", "Exports")
    y, v = last_full(beans)
    return L(
        ro=f"Cea mai apropiată origine, pe Dunăre și Marea Neagră: {v / 1000:.1f} mil. t boabe și "
        f"{meal[y] / 1000:.1f} mil. t șrot exportate în {y}/{(y + 1) % 100:02d} (USDA).",
        en=f"The closest origin, by the Danube and the Black Sea: {v / 1000:.1f} Mt of beans and "
        f"{meal[y] / 1000:.1f} Mt of meal exported in {y}/{(y + 1) % 100:02d} (USDA).",
    )


def note(o, stage, current, reading, truth, o_seasons) -> Localized:
    label = season_label(o, current)
    if stage == OriginStage.BEFORE:
        start, _ = span(o, current, o.window[1])
        ro_s, en_s = day_text(start)
        prev = next((x for x in o_seasons if x.season == season_label(o, current - 1)), None)
        last_ro = last_en = ""
        if prev is not None:
            lv_ro, lv_en = LEVEL[prev.level]
            outcome_ro, outcome_en = OUTCOME[prev.outcome or "none"]
            anom = (
                ("", "")
                if prev.yield_anomaly_pct is None
                else (
                    f", randament cu {abs(prev.yield_anomaly_pct):.0f}% "
                    f"{'sub' if prev.yield_anomaly_pct < 0 else 'peste'} normal",
                    f", yield {abs(prev.yield_anomaly_pct):.0f}% "
                    f"{'below' if prev.yield_anomaly_pct < 0 else 'above'} normal",
                )
            )
            last_ro = f" Sezonul trecut ({prev.season}): risc {lv_ro}{anom[0]}{outcome_ro}."
            last_en = f" Last season ({prev.season}): {lv_en} risk{anom[1]}{outcome_en}."
        return L(
            ro=f"Săptămânile decisive încep pe {ro_s}.{last_ro}",
            en=f"The deciding weeks begin on {en_s}.{last_en}",
        )
    assert reading is not None
    lv_ro, lv_en = LEVEL[reading.level]
    if stage == OriginStage.DONE:
        anom = truth.get(current)
        usda = ""
        usda_ro = ""
        if anom is not None:
            side = "below" if anom < 0 else "above"
            usda = f" USDA now puts the yield {abs(anom):.0f}% {side} normal."
            usda_ro = (
                f" USDA estimează acum randamentul cu {abs(anom):.0f}% "
                f"{'sub' if anom < 0 else 'peste'} normal."
            )
        return L(
            ro=f"Vara care a decis recolta a fost printre cele mai grele din 2001.{usda_ro}"
            if reading.level == "high"
            else f"Sezonul {label} s-a încheiat cu risc {lv_ro}.{usda_ro}",
            en=f"The summer that decided the crop was among the hardest since 2001.{usda}"
            if reading.level == "high"
            else f"The {label} season ended at {lv_en} risk.{usda}",
        )
    ro_l, en_l = day_text(date.fromisoformat(reading.as_of))
    return L(
        ro=f"Sezonul {label}, până la {ro_l}: risc {lv_ro} ({reading.score:.0f}/100).",
        en=f"The {label} season to {en_l}: {lv_en} risk ({reading.score:.0f}/100).",
    )


def replay(ar: ImportOrigin, psd) -> OriginReplay:
    s = next(x for x in ar.seasons if x.season == "2022/23")
    final = psd_series(psd, "Argentina", "Oilseed, Soybean", "Production")[2022] / 1000
    first_high = next((c for c in s.checkpoints if c.level == "high"), None)
    when_ro, when_en = day_text(date.fromisoformat(first_high.as_of)) if first_high else ("-", "-")
    return OriginReplay(
        origin_id=ar.id,
        season="2022/23",
        title=L(
            ro="Seceta din Argentina, 2022/23, cum ar fi arătat-o această pagină",
            en="Argentina's 2022/23 drought, as this page would have shown it",
        ),
        text=L(
            ro=f"Scorul ar fi fost ridicat din {when_ro} 2023. În februarie USDA estima încă "
            f"{WASDE_AR_2022[0][1]:.0f} mil. t; recolta finală a fost {final:.0f} mil. t. "
            "Tăierile oficiale au venit în martie și aprilie.",
            en=f"The score would have been high from {when_en} 2023. In February USDA still "
            f"expected {WASDE_AR_2022[0][1]:.0f} Mt; the final crop was {final:.0f} Mt. The "
            "official cuts came in March and April.",
        ),
        unit="Mt",
        ours=s.checkpoints,
        official=[
            OfficialEstimate(
                date=d, value=v, label=L(ro=f"USDA WASDE, {d[:7]}", en=f"USDA WASDE, {d[:7]}")
            )
            for d, v in WASDE_AR_2022
        ]
        + [
            OfficialEstimate(
                value=final, label=L(ro="Recolta finală (USDA)", en="Final crop (USDA)")
            )
        ],
    )


def advice(
    origins: list[ImportOrigin], as_of: date, psd
) -> tuple[Localized, Localized, list[Localized]]:
    by = {o.id: o for o in origins}
    live = [o for o in origins if o.current and o.stage != OriginStage.DONE]
    alarms = [o for o in live if o.current and o.current.level == "high" and o.confidence != "low"]
    ro_d, en_d = day_text(as_of)
    if alarms:
        names_ro = ", ".join(o.name.ro for o in alarms)
        names_en = ", ".join(o.name.en for o in alarms)
        headline = L(
            ro=f"{names_ro}: sezon slab pe drum", en=f"{names_en}: heading for a short crop"
        )
        text = L(
            ro=f"La {ro_d} vremea din săptămânile decisive e printre cele mai rele din 2001. "
            "În trecut, asta a însemnat recolte mai mici cu luni înainte de cifrele oficiale.",
            en=f"As of {en_d} the weather in the deciding weeks is among the worst since 2001. In "
            "past seasons this meant a smaller crop months before the official figures said so.",
        )
    else:
        short = [
            o
            for o in origins
            if o.stage == OriginStage.DONE and o.current and o.current.level == "high"
        ]
        waiting_ro = (
            f"La {ro_d} nicio recoltă în curs nu e în alertă. Recoltele din America de Sud se "
            "decid între decembrie și martie; urmăriți pagina de la jumătatea lui ianuarie."
        )
        waiting_en = (
            f"As of {en_d} no crop still growing is on alert. South American crops are decided "
            "between December and March; watch this page from mid-January."
        )
        if short:
            o = short[0]
            headline = L(
                ro=f"{o.name.ro}: recolta {o.current_season} a ieșit slabă",
                en=f"{o.name.en}: the {o.current_season} crop came in short",
            )
        else:
            headline = L(
                ro="Nicio origine nu e în alertă acum", en="No origin is on alert right now"
            )
        text = L(ro=waiting_ro, en=waiting_en)
    actions = []
    ua = by.get("ua")
    if ua and ua.current:
        lv_ro, lv_en = LEVEL[ua.current.level]
        y = int(ua.current_season)
        exp = psd_series(psd, "Ukraine", "Oilseed, Soybean", "Exports")
        change = 100 * (exp[y] / exp[y - 1] - 1) if y in exp and y - 1 in exp else None
        if ua.current.level == "high" and change is not None:
            actions.append(
                L(
                    ro=f"Ucraina {y}: risc {lv_ro} în vara care a decis recolta; USDA vede acum "
                    f"exporturi de soia {change:+.0f}% față de anul trecut. Rezervați devreme "
                    "loturile ucrainene sau planificați mai mult din America de Sud pentru iarnă.",
                    en=f"Ukraine {y}: {lv_en} risk over the summer that decided the crop; USDA now "
                    f"sees soybean exports {change:+.0f}% on last year. Book Ukrainian lots early, "
                    "or plan more from South America for the winter.",
                )
            )
        else:
            actions.append(
                L(
                    ro=f"Ucraina {y}: risc {lv_ro} în vara care a decis recolta.",
                    en=f"Ukraine {y}: {lv_en} risk over the summer that decided the crop.",
                )
            )
    actions.append(
        L(
            ro="Argentina și sudul Braziliei: dacă una dintre ele e roșie la jumătatea lui "
            "februarie, asigurați acoperirea din cealaltă (sau din Brazilia Centru-Vest) înainte "
            "de tăierile oficiale. În 2023 USDA a tăiat Argentina abia în martie.",
            en="Argentina and southern Brazil: if either is red by mid-February, line up cover "
            "from the other (or from Brazil's centre-west) before the official cuts. In 2023 USDA "
            "cut Argentina only in March.",
        )
    )
    actions.append(
        L(
            ro="Brazilia Centru-Vest: vremea decide rar recolta acolo, deci scorul ei contează "
            "puțin. Rămâne originea de rezervă cea mai sigură.",
            en="Brazil Centre-West: weather rarely decides the crop there, so its score counts "
            "for little. It stays the steadiest fallback origin.",
        )
    )
    return headline, text, actions


METHOD = L(
    ro="Pentru fiecare origine luăm vremea NASA POWER în câteva puncte din zonele cu soia, "
    "ponderate după cât produc. În săptămânile care decid recolta (înflorire și umplerea "
    "boabelor) comparăm cu aceleași săptămâni din fiecare sezon 2001-2025: ploaia minus apa "
    "folosită de cultură, umiditatea solului și zilele de peste 33 °C. Scorul spune cât de rău "
    "stă sezonul față de istoric (0 cel mai bine, 100 cel mai rău); de la 67 e ridicat. Nimic nu "
    "e ajustat pe recolte; le folosim doar pentru verificare.",
    en="For each origin we take NASA POWER weather at a few points in its soy areas, weighted by "
    "how much each produces. Over the weeks that decide the crop (flowering and pod fill) we "
    "compare with the same weeks of every season 2001-2025: rain minus crop water use, soil "
    "wetness and days above 33 °C. The score says how bad the season is against that history "
    "(0 best, 100 worst); 67 and above is high. Nothing is fitted to yields; we use them only to "
    "check.",
)

LIMITS = [
    L(
        ro="Nu prezicem prețul. Am verificat: după sezoanele pe care le-am fi semnalat în "
        "Argentina, prețul șrotului (Banca Mondială, lunar) nu s-a mișcat la fel de fiecare dată. "
        "Prețul urmează și recolta din SUA și cererea.",
        en="We do not forecast prices. We checked: after the seasons we would have flagged in "
        "Argentina, the soybean meal price (World Bank, monthly) did not move the same way each "
        "time. Prices also follow the US crop and demand.",
    ),
    L(
        ro="Nu vedem războiul, porturile, taxele la export sau grevele, care pot opri o origine "
        "cu o recoltă bună.",
        en="We cannot see war, ports, export taxes or strikes, which can stop an origin with a "
        "good crop.",
    ),
    L(
        ro="Nu vedem conținutul de proteină sau statutul GMO al unui lot; acestea rămân la analiză "
        "și la contract.",
        en="We cannot see a lot's protein content or GM status; those stay with the lab test and "
        "the contract.",
    ),
    L(
        ro="Vremea vine din celule NASA POWER de ~50 km, în câteva puncte pe regiune, nu din "
        "fiecare câmp. Un sezon bun la nivel de regiune poate ascunde zone slabe.",
        en="Weather comes from ~50 km NASA POWER cells at a few points per region, not from every "
        "field. A good season for a region can hide poor patches.",
    ),
]


def sources(end: date) -> list[DataSource]:
    return [
        DataSource(
            dataset="NASA POWER",
            product="PRECTOTCORR, T2M_MAX, GWETROOT, ET0 (daily, AG community)",
            resolution="0.5° x 0.625°",
            period=f"2000-{end.isoformat()}",
            is_nasa=True,
            url="https://power.larc.nasa.gov/",
        ),
        DataSource(
            dataset="USDA FAS PSD",
            product="soybean and soybean meal: yield, production, exports",
            resolution="country",
            period="2001-2026",
            is_nasa=False,
            url="https://apps.fas.usda.gov/psdonline/",
        ),
        DataSource(
            dataset="IBGE PAM (SIDRA table 1612)",
            product="soybean production and harvested area by state",
            resolution="state",
            period="2001-2024 harvests",
            is_nasa=False,
            url="https://sidra.ibge.gov.br/tabela/1612",
        ),
        DataSource(
            dataset="USDA WASDE",
            product="Argentina soybean production estimates, Feb-Apr 2023",
            resolution="country",
            period="2023",
            is_nasa=False,
            url="https://www.usda.gov/oce/commodity/wasde",
        ),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--end", type=date.fromisoformat, default=date(2026, 11, 10))
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    psd = psd_rows()
    built = [build_origin(o, psd, args.end) for o in ORIGINS]
    origins = [b.origin for b in built]
    as_of = max([date.fromisoformat(o.current.as_of) for o in origins if o.current] or [args.end])
    headline, text, actions = advice(origins, args.end, psd)
    result = ImportOrigins(
        as_of=args.end.isoformat(),
        crop=Crop.SOYBEAN,
        headline=headline,
        advice=text,
        actions=actions,
        origins=origins,
        replay=replay(origins[0], psd),
        method=METHOD,
        limits=LIMITS,
        sources=sources(args.end),
    )
    _ = as_of
    out = result.model_dump_json()
    ImportOrigins.model_validate_json(out)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(out + "\n", encoding="utf-8")
    if args.out == OUT:
        WEB_COPY.write_text(out + "\n", encoding="utf-8")
    for o in origins:
        print(f"  {o.id}: {o.note.en}")
        print(
            "    "
            + ", ".join(
                f"{s.season}:{s.score:.0f}/{s.yield_anomaly_pct}/{s.outcome}"
                for s in o.seasons[-6:]
            )
        )
    print("replay:", result.replay.text.en if result.replay else None)
    print(f"wrote {args.out.relative_to(REPO_ROOT)} ({args.out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
