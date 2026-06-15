"""Text normalization for the TTS engine (esp. Sarvam bulbul).

Pure stdlib (`re` only) so it's unit-testable WITHOUT the heavy TTS deps
(soundfile/numpy/torch) that narrate.py pulls in. narrate.py imports from here.

The engine mis-reads several things; we translate them to what it reads correctly:
  - number-unit hyphen ("60-day" → "sixty, D-A-Y", it SPELLS the word)
  - em/en dash pause, the "₹" glyph, digit-grouping commas ("comma" spoken)
  - ALL-CAPS labels spelled letter by letter ("PRO" → "P, R, O")
  - certain English UI words the Hindi voice mangles ("signup" → "sengup")
"""
import re

# Acronyms the engine SHOULD spell — keep these in capitals.
_KEEP_CAPS = {
    "OTP", "SMS", "ID", "QR", "OK", "URL", "API", "AI", "UI", "UX", "FAQ",
    "PDF", "CSV", "GST", "PAN", "KYC", "PIN", "SIM", "IT", "HR", "USB", "IP",
}


def _decaps_word(m: "re.Match[str]") -> str:
    word = m.group(0)
    return word if word in _KEEP_CAPS else word[:1] + word[1:].lower()


# English UI terms the Hindi (Sarvam) voice mispronounces, mapped to Devanagari
# phonetics so it says them correctly (e.g. "signup" came out "sengup"). Applied
# only for Hindi; the English voice reads these fine. Matched case-insensitively,
# whole-word, allowing an optional space ("signup" or "sign up"). Order longest
# first so "sign up" isn't half-consumed.
_HI_PRON_FIXES = [
    (re.compile(r"\bsign\s*up\b", re.IGNORECASE), "साइन अप"),
    (re.compile(r"\bsign\s*in\b", re.IGNORECASE), "साइन इन"),
    (re.compile(r"\bsign\s*out\b", re.IGNORECASE), "साइन आउट"),
    (re.compile(r"\blog\s*in\b", re.IGNORECASE), "लॉग इन"),
    (re.compile(r"\blog\s*out\b", re.IGNORECASE), "लॉग आउट"),
]


def tts_normalize(text: str, lang: str = "hi") -> str:
    """Make text the TTS engine reads CORRECTLY. Runs for ALL engines
    (belt-and-suspenders even when the script generator already avoids the
    trouble characters)."""
    rupee = "रुपये" if str(lang).startswith("hi") else "rupees"
    # ₹199 / ₹ 1,200 → "199 रुपये" (the engine mis-reads the ₹ glyph). Then any
    # leftover lone ₹ → the word.
    text = re.sub(r"₹\s*(\d[\d,]*)", lambda m: f"{m.group(1)} {rupee}", text)
    text = text.replace("₹", f" {rupee} ")
    # Digit-grouping commas ("1,50,000" → "150000") so "comma" isn't spoken.
    text = re.sub(r"(?<=\d),(?=\d)", "", text)
    # Em/en dash (with optional surrounding space) used as a phrase separator → comma pause.
    text = re.sub(r"\s*[—–]\s*", ", ", text)
    # ASCII hyphen used as a SPACED separator ("Phone is best - just type") → comma.
    text = re.sub(r"\s+-\s+", ", ", text)
    # Hyphen GLUING two alphanumerics ("60-day", "2-Month", "code-mixed", "Wi-Fi")
    # → a space, so the engine says both parts as words ("60 day", "2 Month").
    text = re.sub(r"(?<=[\w])-(?=[\w])", " ", text)
    # Slash between words ("WiFi/SMS") is read as "slash" — make it a space.
    text = re.sub(r"(?<=[^\s/])\s*/\s*(?=[^\s/])", " ", text)
    # ALL-CAPS labels (plan tiers MICRO / SMALL / STANDARD / PRO, headings) are
    # SPELLED out letter by letter by the engine ("PRO" → "P, R, O"). Title-case
    # them so they're said as WORDS — except genuine acronyms that SHOULD be
    # spelled (OTP, SMS, ID …), which stay untouched.
    text = re.sub(r"\b[A-Z][A-Z]+\b", _decaps_word, text)
    # Hindi voice: fix mispronounced English UI terms (signup → साइन अप, …).
    if str(lang).startswith("hi"):
        for pattern, repl in _HI_PRON_FIXES:
            text = pattern.sub(repl, text)
    return re.sub(r"\s{2,}", " ", text).strip()
