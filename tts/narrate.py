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


def read_text(args) -> str:
    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    return (args.text or "").strip()


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


def generate_xtts(text, args, device):
    """Coqui XTTS-v2 — better cloning, but CPML NON-COMMERCIAL. Opt-in only."""
    from TTS.api import TTS
    print("[narrate] XTTS-v2 — NON-COMMERCIAL license (your responsibility)", file=sys.stderr)
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    out = os.path.abspath(args.out)
    kwargs = {"text": text, "language": args.lang, "file_path": out}
    if args.speaker_wav:
        kwargs["speaker_wav"] = args.speaker_wav  # clone from a sample
    else:
        kwargs["speaker"] = args.speaker or "Ana Florence"  # built-in preset
    tts.tts_to_file(**kwargs)
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="Generate narration audio from a script.")
    p.add_argument("--text", help="Script text to narrate")
    p.add_argument("--text-file", help="Path to a .txt file with the script")
    p.add_argument("--out", default="narration.wav", help="Output .wav path")
    p.add_argument("--engine", default="indic-parler", choices=["indic-parler", "xtts"],
                   help="indic-parler = Apache/commercial-safe (default); xtts = non-commercial")
    p.add_argument("--description", default=DEFAULT_DESCRIPTION, help="[indic-parler] preset voice description")
    p.add_argument("--model", default=None, help="[indic-parler] HF model id override")
    p.add_argument("--lang", default="hi", help="[xtts] language code (hi/en/…)")
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
    if args.engine == "xtts":
        out = generate_xtts(text, args, device)
    else:
        out = generate_indic_parler(text, args, device)

    # Print ONLY the final path on stdout so the caller can capture it.
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
