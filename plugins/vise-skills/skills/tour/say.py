"""Synthesize speech with Kokoro (local TTS).

Usage:
  say.py "text" [voice] [out.wav] [speed]

Defaults: voice=af_heart, out=<cache>/<hash>.wav, speed=1.2
Prints the output path; the caller plays it
(macOS: afplay; Windows: PowerShell Media.SoundPlayer).

Audio is cached under <this dir>/cache/ keyed by text+voice+speed, so replaying
a beat — or re-walking a whole tour — costs nothing. A cache hit skips the model
load too, which is most of the latency.
"""
import sys, time, os, hashlib, shutil

root = os.path.dirname(os.path.abspath(__file__))

text = sys.argv[1]
voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
out = sys.argv[3] if len(sys.argv) > 3 else None
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.2

cache_dir = os.path.join(root, "cache")
os.makedirs(cache_dir, exist_ok=True)
key = hashlib.sha1(f"{text}|{voice}|{speed}".encode("utf-8")).hexdigest()
cached = os.path.join(cache_dir, f"{key}.wav")

if os.path.exists(cached):
    if out and os.path.abspath(out) != os.path.abspath(cached):
        shutil.copyfile(cached, out)
    print(f"voice={voice} speed={speed} cached -> {out or cached}")
    sys.exit(0)

# Imported after the cache check: loading the model is ~1s we skip on a hit.
import soundfile as sf
from kokoro_onnx import Kokoro

kokoro = Kokoro(os.path.join(root, "kokoro-v1.0.onnx"), os.path.join(root, "voices-v1.0.bin"))

t0 = time.time()
samples, sample_rate = kokoro.create(
    text, voice=voice, speed=speed, lang="en-us" if voice.startswith("a") else "en-gb"
)
sf.write(cached, samples, sample_rate)
if out and os.path.abspath(out) != os.path.abspath(cached):
    shutil.copyfile(cached, out)
print(
    f"voice={voice} speed={speed} synth={time.time()-t0:.2f}s "
    f"audio={len(samples)/sample_rate:.1f}s -> {out or cached}"
)
