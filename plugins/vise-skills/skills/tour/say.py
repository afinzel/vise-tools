"""Synthesize speech with Kokoro (local TTS).

Usage:
  say.py "text" [voice] [out.wav] [speed]

Defaults: voice=af_heart, out=<this dir>/out.wav, speed=1.2
Prints the output path; the caller plays it (PowerShell Media.SoundPlayer).
"""
import sys, time, os
import soundfile as sf
from kokoro_onnx import Kokoro

root = os.path.dirname(os.path.abspath(__file__))
kokoro = Kokoro(os.path.join(root, "kokoro-v1.0.onnx"), os.path.join(root, "voices-v1.0.bin"))

text = sys.argv[1]
voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(root, "out.wav")
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.2

t0 = time.time()
samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us" if voice.startswith("a") else "en-gb")
sf.write(out, samples, sample_rate)
print(f"voice={voice} speed={speed} synth={time.time()-t0:.2f}s audio={len(samples)/sample_rate:.1f}s -> {out}")
