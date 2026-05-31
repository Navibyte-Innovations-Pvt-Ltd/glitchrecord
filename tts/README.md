# Local narration TTS

Generates voiceover audio from a script — fully local, free per render, runs on
Apple Silicon. Engine: **AI4Bharat Indic-Parler-TTS** (Apache-2.0, commercial-safe),
built for Hindi + code-mixed **Hinglish**.

## One-time setup (Mac)

```bash
cd apps/glitchrecord/tts
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
pip install git+https://github.com/huggingface/parler-tts.git
```

Verify:
```bash
source .venv/bin/activate
python narrate.py --check     # should print [ok] for torch/transformers/soundfile/parler_tts
```

## Generate narration

```bash
source .venv/bin/activate
python narrate.py --text-file script.txt --out narration.wav
```

First run downloads the model (~2GB) to the HF cache. After that it's offline.

## Voice

The voice is a **preset** controlled by `--description` (no cloning). Edit the
adjectives to change tone/gender, e.g.:

```bash
python narrate.py --text "..." --description "A calm male voice, slow and clear." --out out.wav
```

## Engines (BYO — bring your own model)

`narrate.py` supports two engines via `--engine`:

| Engine | License | Use |
|--------|---------|-----|
| `indic-parler` (default) | **Apache-2.0** | Commercial-safe. Hinglish-native. Use this for GlitchGrab's own videos. |
| `xtts` | **CPML — NON-COMMERCIAL** | Better voice cloning. You install it yourself; the non-commercial term is **your** responsibility. Fine for personal/non-commercial. |

```bash
# commercial-safe default
python narrate.py --text-file script.txt --out narration.wav

# opt-in XTTS (also: pip install coqui-tts) — clone your voice:
python narrate.py --engine xtts --speaker-wav my_voice.wav --lang hi --text-file script.txt --out out.wav
```

GlitchRecord only *invokes* whichever engine you installed — it doesn't ship a
model — so the model's license binds the user, not the product.

## Notes / honesty

- **Hinglish ~80%**: Roman Hinglish pronunciation needs occasional spelling
  tweaks. If a word reads wrong, respell it phonetically in the script.
- The GlitchRecord editor calls `narrate.py` via the `.venv` Python; set the
  venv path in the editor's Narration panel if it can't find it.
