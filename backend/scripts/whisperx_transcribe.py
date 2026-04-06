#!/usr/bin/env python3
"""
Whisper-X: Transcription + wav2vec2 phonemic alignment for Kitaboo-style human narration.
Outputs same JSON as whisper_transcribe_wordlevel.py: { "segments": [ { "start", "end", "text", "words": [ { "word", "start", "end" } ] } ] }
Handles accents and dramatic pauses; phonemic alignment reduces timestamp drift.

Requires: pip install whisperx (torch, faster-whisper, etc.)
Usage: python whisperx_transcribe.py <audio_path> [language]
"""

import json
import sys

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: whisperx_transcribe.py <audio_path> [language]"}), file=sys.stderr)
        sys.exit(1)
    audio_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "en"

    try:
        import whisperx
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        model = whisperx.load_model("base", device, compute_type=compute_type)
        audio = whisperx.load_audio(audio_path)
        result = model.transcribe(audio, batch_size=16)
        model_a, metadata = whisperx.load_align_model(language_code=language, device=device)
        result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)
        out_segments = []
        for seg in result.get("segments", []):
            words = [{"word": w.get("word", ""), "start": w.get("start", seg["start"]), "end": w.get("end", seg["end"])} for w in seg.get("words", [])]
            out_segments.append({
                "start": seg.get("start", 0),
                "end": seg.get("end", 0),
                "text": (seg.get("text") or "").strip(),
                "words": words
            })
        print(json.dumps({"segments": out_segments, "language": language}))
    except ImportError as e:
        print(json.dumps({"error": f"whisperx not installed: {e}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
