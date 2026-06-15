"""Unit tests for TTS text normalization. Pure stdlib — run with either:
    python3 test_textnorm.py        (self-running, no pytest needed)
    python3 -m pytest test_textnorm.py
"""
from textnorm import tts_normalize


def test_signup_mispronunciation_fixed_in_hindi():
    # REPRO: Sarvam read "signup" as "sengup". Render it as Devanagari so the
    # Hindi voice says it correctly.
    assert "साइन अप" in tts_normalize("Go to the signup page", "hi")
    assert "signup" not in tts_normalize("Go to the signup page", "hi").lower()
    # "page" reads fine in English and is left alone.
    assert "page" in tts_normalize("Go to the signup page", "hi")


def test_signup_variants_and_case():
    for src in ["sign up", "Sign Up", "SIGN UP", "signup", "Signup"]:
        out = tts_normalize(f"open the {src} screen", "hi")
        assert "साइन अप" in out, f"{src!r} -> {out!r}"


def test_login_family():
    assert "साइन इन" in tts_normalize("click sign in", "hi")
    assert "साइन आउट" in tts_normalize("then sign out", "hi")
    assert "लॉग इन" in tts_normalize("please log in", "hi")
    assert "लॉग आउट" in tts_normalize("now logout", "hi")


def test_pron_fix_is_hindi_only():
    # English voice reads "sign up" fine — don't transliterate it there.
    out = tts_normalize("Go to the signup page", "en")
    assert "साइन अप" not in out
    assert "signup" in out.lower()


def test_existing_normalizations_still_work():
    # Currency, digit commas, dashes, ALL-CAPS — regression guard for the refactor.
    assert "रुपये" in tts_normalize("₹199 per month", "hi")
    assert "₹" not in tts_normalize("₹199 per month", "hi")
    assert "," not in tts_normalize("about 1,50,000 users", "hi").replace(", ", "X")
    assert "—" not in tts_normalize("Phone — best option", "hi")
    # "60-day" must NOT become a glued word the engine spells.
    assert "60 day" in tts_normalize("a 60-day trial", "hi")
    # ALL-CAPS plan tier said as a word, real acronym kept.
    out = tts_normalize("the PRO plan needs an OTP", "hi")
    assert "Pro" in out and "OTP" in out


def _run():
    import traceback
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
        except Exception:
            failed += 1
            print(f"  FAIL {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return failed


if __name__ == "__main__":
    raise SystemExit(1 if _run() else 0)
