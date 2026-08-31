"""Generate game SFX (WAV) + Hebrew voice lines (MP3 via edge-tts)."""
from __future__ import annotations

import asyncio
import math
import struct
import wave
from pathlib import Path

import edge_tts
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "assets" / "sfx"
OUT.mkdir(parents=True, exist_ok=True)
SR = 22050


def save_wav(name: str, samples: np.ndarray, sr: int = SR):
    samples = np.clip(samples, -1, 1)
    pcm = (samples * 32767).astype(np.int16)
    path = OUT / name
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    print("wav", path.name, len(pcm) / sr, "s")


def env(n, attack=0.01, release=0.05):
    a = np.ones(n, dtype=np.float64)
    if n < 4:
        return a
    aa = min(n // 3, max(1, int(attack * SR)))
    rr = min(n // 3, max(1, int(release * SR)))
    if aa + rr >= n:
        aa = max(1, n // 4)
        rr = max(1, n // 4)
    a[:aa] = np.linspace(0, 1, aa)
    a[-rr:] = np.linspace(1, 0, rr)
    return a


def tone(freq, dur, vol=0.4, wave="sin"):
    n = int(dur * SR)
    t = np.arange(n) / SR
    if wave == "square":
        s = np.sign(np.sin(2 * math.pi * freq * t))
    elif wave == "saw":
        s = 2 * (t * freq % 1) - 1
    else:
        s = np.sin(2 * math.pi * freq * t)
    return s * vol * env(n, 0.005, min(0.08, dur * 0.3))


def noise(dur, vol=0.3):
    n = int(dur * SR)
    s = np.random.uniform(-1, 1, n) * vol
    return s * env(n, 0.002, 0.05)


def taser_buzz():
    # zzzzz electric buzz with crackle
    dur = 0.55
    n = int(dur * SR)
    t = np.arange(n) / SR
    base = np.sin(2 * math.pi * 80 * t) * 0.25
    buzz = np.sin(2 * math.pi * 1400 * t) * 0.2
    buzz *= (0.5 + 0.5 * np.sin(2 * math.pi * 40 * t))
    crack = np.random.uniform(-1, 1, n) * 0.15
    # AM sparkle
    spark = np.sin(2 * math.pi * 3200 * t) * (np.random.rand(n) > 0.92) * 0.35
    s = (base + buzz + crack + spark) * env(n, 0.01, 0.12)
    save_wav("taser_buzz.wav", s)


def reload_click():
    parts = [
        noise(0.04, 0.35),
        tone(420, 0.06, 0.25, "square"),
        tone(280, 0.08, 0.2, "sin"),
        noise(0.05, 0.2),
        tone(520, 0.05, 0.22, "square"),
    ]
    save_wav("reload.wav", np.concatenate(parts))


def health_pickup():
    freqs = [523, 659, 784, 1046]
    parts = [tone(f, 0.09, 0.28) for f in freqs]
    save_wav("health_pickup.wav", np.concatenate(parts))


def ammo_pickup():
    freqs = [880, 1175, 880, 1320]
    parts = [tone(f, 0.07, 0.3, "square") for f in freqs]
    save_wav("ammo_pickup.wav", np.concatenate(parts) * 0.9)


def hurt_sounds():
    # short comic ouches — pitch-bent noise + squeak
    specs = [
        ("hurt_1.wav", 380, 0.22),
        ("hurt_2.wav", 290, 0.25),
        ("hurt_3.wav", 460, 0.18),
        ("hurt_4.wav", 340, 0.28),
        ("hurt_5.wav", 510, 0.2),
        ("hurt_6.wav", 250, 0.24),
    ]
    for name, f0, dur in specs:
        n = int(dur * SR)
        t = np.arange(n) / SR
        slide = f0 * (1.4 - 0.7 * t / dur)
        s = np.sin(2 * math.pi * slide * t) * 0.35
        s += np.sin(2 * math.pi * slide * 1.5 * t) * 0.12
        s += np.random.uniform(-1, 1, n) * 0.08
        save_wav(name, s * env(n, 0.005, 0.08))


VOICES = {
    # Hebrew neural voices on Edge
    "cop": "he-IL-AvriNeural",
    "guy": "he-IL-AvriNeural",
    "fun": "he-IL-HilaNeural",
}

LINES = [
    ("arrest.mp3", "אתה במעצר!", "cop", "+10%"),
    ("surrender.mp3", "תכנע מיד!", "cop", "+15%"),
    ("where_run.mp3", "לאן אתה בורח?", "cop", "+5%"),
    ("sausage.mp3", "בוא לפה יא נקניק!", "fun", "+20%"),
    ("freeze.mp3", "עמוד במקום!", "cop", "+10%"),
    ("hands_up.mp3", "ידיים למעלה!", "cop", "+8%"),
    ("gotcha.mp3", "תפסתי אותך!", "fun", "+12%"),
    ("zap_1.mp3", "אווווו חשמל!!!", "fun", "+25%"),
    ("zap_2.mp3", "אייייי נשזפתי!", "guy", "+30%"),
    ("zap_3.mp3", "אמאאאא מיינטש!", "fun", "+20%"),
    ("zap_4.mp3", "דיי זה כואב!", "guy", "+15%"),
    ("zap_5.mp3", "בזזזזזזז יש!", "fun", "+25%"),
    ("hit_aiy.mp3", "איי!", "guy", "+20%"),
    ("hit_oy.mp3", "אוי!", "fun", "+15%"),
    ("hit_pagaat.mp3", "פגעת בי!", "guy", "+10%"),
    ("hit_ouch.mp3", "אווץ׳!", "fun", "+20%"),
    ("hit_aahh.mp3", "אאאהה!", "guy", "+25%"),
    ("hit_lama.mp3", "למה ירית?!?", "fun", "+15%"),
]


async def gen_voices():
    for fname, text, who, rate in LINES:
        voice = VOICES[who]
        path = OUT / fname
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        await communicate.save(str(path))
        print("mp3", fname)


def main():
    taser_buzz()
    reload_click()
    health_pickup()
    ammo_pickup()
    hurt_sounds()
    asyncio.run(gen_voices())
    print("Done →", OUT)


if __name__ == "__main__":
    main()
