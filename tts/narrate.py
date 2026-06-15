#!/usr/bin/env python3
"""
Local narration generator for GlitchRecord tutorials.

Engine: AI4Bharat Indic-Parler-TTS (Apache-2.0 — commercial-safe), purpose-built
for Hindi + code-mixed Hinglish. The voice is chosen by a plain-text DESCRIPTION
(a "preset voice"), not a cloned sample.

Usage:
    python narrate.py --text-file script.txt --out narration.wav
    python narrate.py --text "Namaste, aaj hum dekhenge..." --out out.wav
    python narrate.py --check          # validate env/args without generating

Runs on Apple Silicon (MPS), CUDA, or CPU. First run downloads the model (~2GB).
"""
import argparse
import sys
import os

DEFAULT_MODEL = "ai4bharat/indic-parler-tts"
# A neutral, clear preset voice. Tweak the adjectives to change tone/gender.
DEFAULT_DESCRIPTION = (
    "A clear, friendly female voice speaks at a moderate, natural pace with good "
    "expression. The recording is clean studio quality with no background noise."
)


def load_env_file():
    """Load KEY=VALUE lines from a `.env` next to this script (e.g. SARVAM_API_KEY).
    Real env vars take precedence, so the editor can still override per-call."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(p):
        return
    try:
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception:
        pass


def pick_device() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


import re

# Text normalization (pure stdlib, unit-tested in test_textnorm.py).
from textnorm import tts_normalize


def numbers_to_words(text: str, lang: str = "en") -> str:
    """Convert standalone digit-numbers to spoken words BEFORE synthesis. XTTS's
    own Hindi number-expansion crashes; doing it here (and removing the digits)
    avoids that path entirely. Hinglish speakers usually say English numbers, so
    default to English words even for lang=hi."""
    try:
        from num2words import num2words
    except Exception:
        return text
    n2w_lang = "en" if lang != "hi_native" else "hi"

    def repl(m):
        try:
            return num2words(int(m.group(0)), lang=n2w_lang)
        except Exception:
            return m.group(0)

    return re.sub(r"\b\d{1,9}\b", repl, text)


def clean_script(text: str, lang: str = "en", convert_numbers: bool = True) -> str:
    """Strip things that shouldn't be SPOKEN: [SECTION] headers, markdown
    headings/rules/bullets, leftover markdown emphasis. Optionally convert
    numbers to words. Keep the prose."""
    lines = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        if re.fullmatch(r"\[.*\]", s):       # [INTRO], [CHAT PE JAANA]
            continue
        if re.fullmatch(r"[-=_*]{3,}", s):   # --- horizontal rules
            continue
        s = re.sub(r"^#{1,6}\s*", "", s)     # ### headings
        s = re.sub(r"^[-*+]\s+", "", s)      # bullet markers
        # Drop unspeakable strings (URLs, multi-segment paths, code in backticks).
        s = re.sub(r"https?://\S+", "", s)               # URLs
        s = re.sub(r"`[^`]*`", "", s)                     # `code` spans
        s = re.sub(r"\S*/\S+/\S+", "", s)                 # /org/foo/bar paths
        s = re.sub(r"\bgg_[A-Za-z0-9]+\b", "a token", s)  # gg_ tokens
        s = s.replace("**", "").replace("`", "")
        s = re.sub(r"\s{2,}", " ", s).strip()            # collapse gaps left behind
        if s:
            lines.append(s)
    joined = tts_normalize(" ".join(lines).strip(), lang)
    return numbers_to_words(joined, lang) if convert_numbers else joined


def read_text(args) -> str:
    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = args.text or ""
    # Sarvam reads digits + code-mix natively — keep numbers as-is. Local engines
    # need digits converted to words to avoid mispronunciation/crashes.
    convert = getattr(args, "engine", "") != "sarvam"
    return clean_script(raw, getattr(args, "lang", "en"), convert)


def generate_indic_parler(text, args, device):
    """AI4Bharat Indic-Parler-TTS — Apache-2.0, commercial-safe, Hinglish-native."""
    import torch
    import soundfile as sf
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    model_id = args.model or "ai4bharat/indic-parler-tts"
    print(f"[narrate] indic-parler {model_id} on {device}…", file=sys.stderr)
    model = ParlerTTSForConditionalGeneration.from_pretrained(model_id).to(device)
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    desc_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
    desc = desc_tokenizer(args.description, return_tensors="pt").to(device)
    prompt = tokenizer(text, return_tensors="pt").to(device)
    with torch.no_grad():
        audio = model.generate(
            input_ids=desc.input_ids, attention_mask=desc.attention_mask,
            prompt_input_ids=prompt.input_ids, prompt_attention_mask=prompt.attention_mask,
        )
    arr = audio.cpu().to(torch.float32).numpy().squeeze()
    out = os.path.abspath(args.out)
    sf.write(out, arr, model.config.sampling_rate)
    return out


def chunk_text(text, maxlen=220):
    """Split into sentence-ish chunks so we can synthesize incrementally and
    report real progress (chunk i/N)."""
    sents = re.split(r"(?<=[.!?।])\s+", text)
    chunks, cur = [], ""
    for s in sents:
        s = s.strip()
        if not s:
            continue
        if len(cur) + len(s) + 1 <= maxlen:
            cur = (cur + " " + s).strip()
        else:
            if cur:
                chunks.append(cur)
            cur = s
    if cur:
        chunks.append(cur)
    return chunks or [text]


def generate_sarvam(text, args, device):
    """Sarvam AI bulbul — cloud, native Hindi/Hinglish code-mix, commercial.
    Needs SARVAM_API_KEY env. Chunks under the 2500-char limit."""
    import base64
    import io
    import json
    import os
    import urllib.request
    import numpy as np
    import soundfile as sf

    key = os.environ.get("SARVAM_API_KEY")
    if not key:
        raise RuntimeError("SARVAM_API_KEY not set — paste your Sarvam key in the tester")

    tlc = {"hi": "hi-IN", "en": "en-IN"}.get(args.lang, args.lang if "-" in args.lang else "hi-IN")
    speaker = args.voice or "shubh"
    chunks = chunk_text(text, 2000)
    n = len(chunks)
    parts = []
    sr = None
    for i, ch in enumerate(chunks, 1):
        print(f"[narrate] chunk {i}/{n}", file=sys.stderr, flush=True)
        pace = max(0.3, min(3.0, float(getattr(args, "pace", 1.0) or 1.0)))
        body = json.dumps({
            "text": ch,
            "target_language_code": tlc,
            "model": "bulbul:v3",
            "speaker": speaker,
            "pace": pace,
            "output_audio_codec": "wav",
        }).encode()
        req = urllib.request.Request(
            "https://api.sarvam.ai/text-to-speech",
            data=body,
            headers={"api-subscription-key": key, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Sarvam API {e.code}: {e.read().decode()[:300]}")
        arr, sr = sf.read(io.BytesIO(base64.b64decode(data["audios"][0])), dtype="float32")
        if getattr(arr, "ndim", 1) > 1:
            arr = arr[:, 0]
        parts.append(arr)
        parts.append(np.zeros(int(sr * 0.15), dtype=np.float32))
    out = os.path.abspath(args.out)
    sf.write(out, np.concatenate(parts), sr or 24000)
    return out


def generate_supertonic(text, args, device):
    """Supertone Supertonic-3 — OpenRAIL-M (commercial OK), 31 langs incl Hindi,
    tiny 99M ONNX model (fast). Preset voices (M1, F1, …)."""
    from supertonic import TTS  # type: ignore
    print(f"[narrate] supertonic voice={args.voice} lang={args.lang}", file=sys.stderr, flush=True)
    tts = TTS(auto_download=True)
    style = tts.get_voice_style(voice_name=args.voice or "M1")
    chunks = chunk_text(text)
    n = len(chunks)
    import numpy as np
    import soundfile as sf
    parts = []
    sr = None
    for i, ch in enumerate(chunks, 1):
        print(f"[narrate] chunk {i}/{n}", file=sys.stderr, flush=True)
        wav, _dur = tts.synthesize(ch, voice_style=style, lang=args.lang)
        arr = np.asarray(wav, dtype=np.float32).squeeze()
        parts.append(arr)
        if sr is None:
            sr = getattr(tts, "sample_rate", 44100)
        parts.append(np.zeros(int((sr or 44100) * 0.2), dtype=np.float32))
    out = os.path.abspath(args.out)
    sf.write(out, np.concatenate(parts), sr or 44100)
    return out


def generate_xtts(text, args, device):
    """Coqui XTTS-v2 — better cloning, but CPML NON-COMMERCIAL. Opt-in only.
    Synthesizes chunk-by-chunk and prints `[narrate] chunk i/N` so the UI can
    show real progress instead of an open-ended timer."""
    import numpy as np
    import soundfile as sf
    from TTS.api import TTS

    print("[narrate] XTTS-v2 — NON-COMMERCIAL license (your responsibility)", file=sys.stderr)
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    sr = getattr(tts.synthesizer, "output_sample_rate", 24000)

    chunks = chunk_text(text)
    n = len(chunks)
    parts = []
    gap = np.zeros(int(sr * 0.25), dtype=np.float32)  # 250ms between chunks
    for i, ch in enumerate(chunks, 1):
        print(f"[narrate] chunk {i}/{n}", file=sys.stderr, flush=True)
        kwargs = {"text": ch, "language": args.lang}
        if args.speaker_wav:
            kwargs["speaker_wav"] = args.speaker_wav
        else:
            kwargs["speaker"] = args.speaker or "Ana Florence"
        wav = np.asarray(tts.tts(**kwargs), dtype=np.float32)
        parts.append(wav)
        parts.append(gap)

    out = os.path.abspath(args.out)
    sf.write(out, np.concatenate(parts), sr)
    return out


def main() -> int:
    load_env_file()  # pick up SARVAM_API_KEY etc. from tts/.env
    p = argparse.ArgumentParser(description="Generate narration audio from a script.")
    p.add_argument("--text", help="Script text to narrate")
    p.add_argument("--text-file", help="Path to a .txt file with the script")
    p.add_argument("--out", default="narration.wav", help="Output .wav path")
    p.add_argument("--engine", default="supertonic", choices=["sarvam", "supertonic", "indic-parler", "xtts"],
                   help="sarvam = cloud native Hinglish (needs key); supertonic = local commercial-safe (default); indic-parler = Apache (gated); xtts = non-commercial")
    p.add_argument("--voice", default="M1", help="[supertonic] preset voice name (M1, F1, …)")
    p.add_argument("--description", default=DEFAULT_DESCRIPTION, help="[indic-parler] preset voice description")
    p.add_argument("--model", default=None, help="[indic-parler] HF model id override")
    # en handles Roman Hinglish + numbers cleanly; "hi" crashes XTTS number-expansion.
    p.add_argument("--lang", default="en", help="[xtts] language code (en recommended for Roman Hinglish)")
    p.add_argument("--speaker", default=None, help="[xtts] built-in speaker name")
    p.add_argument("--speaker-wav", default=None, help="[xtts] path to a voice sample to clone")
    p.add_argument("--pace", type=float, default=1.0, help="[sarvam] speaking speed 0.3–3.0 (1.0 = normal, higher = faster/shorter)")
    p.add_argument("--device", default=None, help="cuda | mps | cpu (auto if omitted)")
    p.add_argument("--check", action="store_true", help="Validate setup without generating")
    args = p.parse_args()

    device = args.device or pick_device()

    if args.check:
        ok = True
        for mod in ("torch", "transformers", "soundfile"):
            try:
                __import__(mod)
                print(f"[ok] {mod}")
            except Exception as e:
                ok = False
                print(f"[MISSING] {mod}: {e}")
        for mod in ("parler_tts", "TTS"):
            try:
                __import__(mod)
                print(f"[ok] {mod}")
            except Exception as e:
                print(f"[optional-missing] {mod}: {e}")
        print(f"[device] {device}")
        return 0 if ok else 1

    text = read_text(args)
    if not text:
        print("error: no text (use --text or --text-file)", file=sys.stderr)
        return 2

    print(f"[narrate] engine={args.engine} on {device}…", file=sys.stderr)
    if args.engine == "sarvam":
        out = generate_sarvam(text, args, device)
    elif args.engine == "supertonic":
        out = generate_supertonic(text, args, device)
    elif args.engine == "xtts":
        out = generate_xtts(text, args, device)
    else:
        out = generate_indic_parler(text, args, device)

    # Print ONLY the final path on stdout so the caller can capture it.
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
