#!/usr/bin/env python3
"""
Whisper transcription with word-level timestamps for Kitaboo-style alignment.
Outputs JSON to stdout: { "segments": [ { "start", "end", "text", "words": [ { "word", "start", "end" } ] } ] }

Requires: pip install faster-whisper  (or openai-whisper; adjust model load below)
Usage: python whisper_transcribe_wordlevel.py <audio_path> [language]
"""

import json
import os
import sys

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: whisper_transcribe_wordlevel.py <audio_path> [language]"}), file=sys.stderr)
        sys.exit(1)
    audio_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "en"

    try:
        from faster_whisper import WhisperModel
        fast_align = os.environ.get("WHISPER_FAST_ALIGNMENT", "").lower() in ("1", "true", "yes")
        model_name = "base" if fast_align else os.environ.get("WHISPER_MODEL", "base")
        device = "cuda" if os.environ.get("WHISPER_USE_CUDA", "").lower() in ("1", "true", "yes") else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        beam_size = 1 if fast_align else int(os.environ.get("WHISPER_BEAM_SIZE", "1"))
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        segments, info = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            beam_size=beam_size,
            condition_on_previous_text=False,
            vad_filter=os.environ.get("WHISPER_VAD_FILTER", "0") in ("1", "true")
        )
        out_segments = []
        for seg in segments:
            words = []
            if seg.words:
                for w in seg.words:
                    words.append({"word": w.word, "start": w.start, "end": w.end})
            out_segments.append({
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip(),
                "words": words
            })
        print(f"Transcribed {len(out_segments)} segments. Total duration: {out_segments[-1]['end'] if out_segments else 0:.2f}s", file=sys.stderr)
        print(json.dumps({"segments": out_segments, "language": getattr(info, "language", language)}))
    except ImportError:
        try:
            import whisper
            model = whisper.load_model("base")
            result = model.transcribe(audio_path, language=language)
            out_segments = []
            for seg in result.get("segments", []):
                out_segments.append({
                    "start": seg.get("start", 0),
                    "end": seg.get("end", 0),
                    "text": seg.get("text", "").strip(),
                    "words": seg.get("words", [])
                })
            print(json.dumps({"segments": out_segments}))
        except Exception as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
