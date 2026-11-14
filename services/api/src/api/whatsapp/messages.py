"""Short WhatsApp message templates (Romanian default, English on request)."""

from __future__ import annotations

from .models import FieldAnalysis, Lang, Strategy

# Twilio rejects WhatsApp bodies longer than 1600 characters.
MAX_BODY = 1600

_T: dict[str, dict[Lang, str]] = {
    "welcome": {
        "ro": (
            "Bună! Sunt Field Signal 🌱\n"
            "Vă ajut să alegeți rotația culturilor folosind 25 de ani de date NASA "
            "despre câmpul dvs.\n"
            "• Trimiteți locația câmpului (📎 → Locație)\n"
            "• Sau întrebați-mă orice: ce face aplicația, ce înseamnă un termen\n"
            "Scrieți „en” pentru engleză."
        ),
        "en": (
            "Hi! I'm Field Signal 🌱\n"
            "I help you choose crop rotations using 25 years of NASA data about your field.\n"
            "• Send your field's location (📎 → Location)\n"
            "• Or ask me anything: what the tool does, what a term means\n"
            'Type "ro" for Romanian.'
        ),
    },
    "need_pin_first": {
        "ro": "Trimiteți mai întâi locația câmpului (📎 → Locație), apoi pot explica o rotație.",
        "en": (
            "Please send your field's location first (📎 → Location), "
            "then I can explain a rotation."
        ),
    },
    "bad_number": {
        "ro": "Am {n} rotații. Scrieți „de ce 1”, „de ce 2” sau „de ce 3”.",
        "en": 'I have {n} rotations. Type "why 1", "why 2" or "why 3".',
    },
    "error": {
        "ro": (
            "Nu am putut calcula acum rezultatele pentru acest loc. "
            "Încercați din nou peste un minut."
        ),
        "en": "I couldn't compute results for this place right now. Please try again in a minute.",
    },
    "lang_set": {"ro": "Bine, continuăm în română.", "en": "OK, switching to English."},
    "main_risk": {"ro": "Risc principal", "en": "Main risk"},
    "rotations": {"ro": "Rotații (scor 0-100)", "en": "Rotations (score 0-100)"},
    "current": {"ro": "actuală", "en": "current"},
    "ask_why": {
        "ro": "Scrieți „de ce 2” pentru detalii sau întrebați-mă orice despre aceste rezultate.",
        "en": 'Type "why 2" for details, or ask me anything about these results.',
    },
    "llm_down": {
        "ro": (
            "Nu pot răspunde la întrebări chiar acum. Puteți trimite locația câmpului "
            "(📎 → Locație) sau scrie „de ce 2” după ce primiți rezultatele."
        ),
        "en": (
            "I can't answer questions right now. You can send your field's location "
            '(📎 → Location) or type "why 2" once you have results.'
        ),
    },
    "check_agro": {"ro": "⚠️ Verificați cu un agronom.", "en": "⚠️ Check with an agronomist."},
    "resolution": {
        "ro": "Datele satelitare au pixeli de câțiva km: descriu zona, nu parcela exactă.",
        "en": (
            "Satellite pixels are kilometres wide: this describes the area, not your exact parcel."
        ),
    },
    "full": {"ro": "Rezultate complete", "en": "Full results"},
    "demo": {"ro": "(date demo)", "en": "(demo data)"},
    "evidence": {"ro": "Dovezi", "en": "Evidence"},
    "benefits": {"ro": "Beneficii", "en": "Benefits"},
    "risks": {"ro": "Riscuri", "en": "Risks"},
    "gaps": {"ro": "Ce nu știm", "en": "What we don't know"},
    "confidence": {"ro": "Încredere", "en": "Confidence"},
    "conf_low": {"ro": "scăzută", "en": "low"},
    "conf_medium": {"ro": "medie", "en": "medium"},
    "conf_high": {"ro": "ridicată", "en": "high"},
}


def t(key: str, lang: Lang, **kw: object) -> str:
    return _T[key][lang].format(**kw)


def _score(s: Strategy) -> str:
    if s.score_low is not None and s.score_high is not None:
        return f"{s.score:.0f} ({s.score_low:.0f}-{s.score_high:.0f})"
    return f"{s.score:.0f}"


def _clip(text: str) -> str:
    if len(text) <= MAX_BODY:
        return text
    return text[: MAX_BODY - 1].rstrip() + "…"


def summary(a: FieldAnalysis, lang: Lang) -> str:
    head = f"📍 Field Signal · {a.place_label}"
    if a.is_demo:
        head += f" {t('demo', lang)}"
    lines = [head]
    if a.main_risk:
        lines.append(f"{t('main_risk', lang)}: {a.main_risk}")
    lines += ["", f"{t('rotations', lang)}:"]
    for s in a.strategies:
        tag = f" ({t('current', lang)})" if s.is_current else ""
        lines.append(f"{s.id}. {' → '.join(s.sequence)}{tag} — {_score(s)}")
        lines.append(f"   {s.why}")
    lines += ["", t("ask_why", lang), t("resolution", lang), t("check_agro", lang)]
    if a.results_url:
        lines.append(f"{t('full', lang)}: {a.results_url}")
    return _clip("\n".join(lines))


def explain(a: FieldAnalysis, s: Strategy, lang: Lang) -> str:
    lines = [f"{s.id}. {s.name}: {' → '.join(s.sequence)} — {_score(s)}", s.why]
    if s.evidence:
        lines += ["", f"{t('evidence', lang)}:"]
        for e in s.evidence[:4]:
            src = f", {e.source}" if e.source else ""
            per = f" ({e.period}{src})" if e.period else (f" ({e.source})" if e.source else "")
            lines.append(f"• {e.label}: {e.value}{per}")
    for key, items in (("benefits", s.benefits), ("risks", s.risks), ("gaps", s.gaps)):
        if items:
            lines += ["", f"{t(key, lang)}:"] + [f"• {x}" for x in items[:3]]
    lines += [
        "",
        f"{t('confidence', lang)}: {t('conf_' + s.confidence, lang)}",
        t("check_agro", lang),
    ]
    if a.results_url:
        lines.append(f"{t('full', lang)}: {a.results_url}")
    return _clip("\n".join(lines))
