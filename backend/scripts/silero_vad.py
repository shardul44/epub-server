#!/usr/bin/env python3
"""
Silero VAD: Voice Activity Detection for Kitaboo-style SMIL.
Outputs JSON to stdout: { "silence_periods": [ { "start", "end" } ], "speech_periods": [...] }
SMIL generator must not start a highlight inside a silence zone (no flicker during breath).

Requires: pip install torch torchaudio; audio 16kHz mono (or we resample).
Usage: python silero_vad.py <audio_path> [min_silence_duration_sec]
"""

import json
import sys

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: silero_vad.py <audio_path> [min_silence_duration_sec]"}), file=sys.stderr)
        sys.exit(1)
    audio_path = sys.argv[1]
    min_silence_dur = float(sys.argv[2]) if len(sys.argv) > 2 else 0.03  # 30ms minimum

    try:
        import torch
        model, utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
            trust_repo=True,
        )
        (get_speech_timestamps, save_audio, read_audio, _, _) = utils
    except Exception as e:
        print(json.dumps({"error": f"Silero VAD load failed: {e}"}), file=sys.stderr)
        sys.exit(1)

    try:
        wav = read_audio(audio_path, sampling_rate=16000)
        if wav is None:
            print(json.dumps({"error": "Could not read audio", "silence_periods": [], "speech_periods": []}))
            return
        duration_sec = len(wav) / 16000.0
        speech_timestamps = get_speech_timestamps(
            wav, model, sampling_rate=16000, threshold=0.5,
            min_speech_duration_ms=250, min_silence_duration_ms=int(min_silence_dur * 1000),
            return_seconds=True
        )
    except Exception as e:
        print(json.dumps({"error": f"VAD run failed: {e}", "silence_periods": [], "speech_periods": []}), file=sys.stderr)
        sys.exit(1)

    speech_periods = []
    if speech_timestamps:
        for t in speech_timestamps:
            speech_periods.append({"start": float(t["start"]), "end": float(t["end"])})

    # Silence = gaps between speech (and before first speech, after last speech)
    silence_periods = []
    if not speech_periods:
        silence_periods.append({"start": 0.0, "end": duration_sec})
    else:
        if speech_periods[0]["start"] > min_silence_dur:
            silence_periods.append({"start": 0.0, "end": speech_periods[0]["start"]})
        for i in range(len(speech_periods) - 1):
            gap_start = speech_periods[i]["end"]
            gap_end = speech_periods[i + 1]["start"]
            if gap_end - gap_start >= min_silence_dur:
                silence_periods.append({"start": gap_start, "end": gap_end})
        if duration_sec - speech_periods[-1]["end"] >= min_silence_dur:
            silence_periods.append({"start": speech_periods[-1]["end"], "end": duration_sec})

    out = {"silence_periods": silence_periods, "speech_periods": speech_periods, "duration_sec": duration_sec}
    print(json.dumps(out))

if __name__ == "__main__":
    main()
