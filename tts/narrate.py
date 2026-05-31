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


def clean_script(text: str, lang: str = "en") -> str:
    """Strip things that shouldn't be SPOKEN: [SECTION] headers, markdown
    headings/rules/bullets, leftover markdown emphasis. Convert numbers to words.
    Keep the prose."""
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
        s = s.replace("**", "").replace("`", "")
        lines.append(s)
    joined = " ".join(lines).strip()
    return numbers_to_words(joined, lang)


def read_text(args) -> str:
    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = args.text or ""
    return clean_script(raw, getattr(args, "lang", "en"))


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
    p = argparse.ArgumentParser(description="Generate narration audio from a script.")
    p.add_argument("--text", help="Script text to narrate")
    p.add_argument("--text-file", help="Path to a .txt file with the script")
    p.add_argument("--out", default="narration.wav", help="Output .wav path")
    p.add_argument("--engine", default="supertonic", choices=["supertonic", "indic-parler", "xtts"],
                   help="supertonic = OpenRAIL-M commercial-safe, fast, Hindi (default); indic-parler = Apache (gated); xtts = non-commercial")
    p.add_argument("--voice", default="M1", help="[supertonic] preset voice name (M1, F1, …)")
    p.add_argument("--description", default=DEFAULT_DESCRIPTION, help="[indic-parler] preset voice description")
    p.add_argument("--model", default=None, help="[indic-parler] HF model id override")
    # en handles Roman Hinglish + numbers cleanly; "hi" crashes XTTS number-expansion.
    p.add_argument("--lang", default="en", help="[xtts] language code (en recommended for Roman Hinglish)")
    p.add_argument("--speaker", default=None, help="[xtts] built-in speaker name")
    p.add_argument("--speaker-wav", default=None, help="[xtts] path to a voice sample to clone")
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

    print(f"[narrate] engine={args.engine} on {device} (first run downloads the model)…", file=sys.stderr)
    if args.engine == "supertonic":
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
