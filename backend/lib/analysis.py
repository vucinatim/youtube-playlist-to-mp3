import os
import time


def estimate_key_with_librosa(wav_path: str) -> str:
    """Basic key estimation using chroma features and Krumhansl-Schmuckler profiles."""
    import numpy as _np
    import librosa as _librosa

    # Use lower sample rate for speed
    y, sr = _librosa.load(wav_path, sr=11025, mono=True)
    if y.size == 0:
        return "unknown"
    # Use chroma_stft for speed
    chroma = _librosa.feature.chroma_stft(y=y, sr=sr)
    if chroma.size == 0:
        return "unknown"
    chroma_mean = chroma.mean(axis=1)
    # Krumhansl-Kessler key profiles (major/minor)
    major_profile = _np.array(
        [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
    )
    minor_profile = _np.array(
        [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
    )

    def best_key(profile: "_np.ndarray"):
        scores = []
        for i in range(12):
            rotated = _np.roll(profile, i)
            score = _np.corrcoef(chroma_mean, rotated)[0, 1]
            scores.append(score)
        best_index = int(_np.nanargmax(scores))
        best_score = float(scores[best_index])
        return best_index, best_score

    maj_index, maj_score = best_key(major_profile)
    min_index, min_score = best_key(minor_profile)

    pitch_classes = [
        "C",
        "C#",
        "D",
        "D#",
        "E",
        "F",
        "F#",
        "G",
        "G#",
        "A",
        "A#",
        "B",
    ]
    if _np.isnan(maj_score) and _np.isnan(min_score):
        return "unknown"
    if maj_score >= min_score:
        return f"{pitch_classes[maj_index]} major"
    else:
        return f"{pitch_classes[min_index]} minor"


def perform_full_analysis(mp3_path: str) -> dict:
    """
    Run analysis on a full MP3 file to find BPM and Key.
    This is slower than the snippet-based key detection but more accurate
    and provides more data.
    """
    import numpy as _np
    import librosa as _librosa

    analysis = {}
    print(f"[Analysis] Starting full analysis for: {os.path.basename(mp3_path)}")
    t_start = time.time()

    try:
        y, sr = _librosa.load(mp3_path, mono=True)

        # Segmentation
        # Turned off for now, its too inacurate
        # analysis["segments"] = analyze_segments(y, sr)

        # BPM detection
        tempo, beats = _librosa.beat.beat_track(y=y, sr=sr, units="time")
        if tempo:
            analysis["bpm"] = round(float(tempo), 1)

        # Energy detection (RMS)
        rms = _librosa.feature.rms(y=y)[0]
        if rms.size > 0:
            analysis["energy"] = round(float(_np.mean(rms) * 100), 1)

        # Danceability (more complex, using beat variance)
        if tempo and beats.size > 2:
            beat_intervals = _np.diff(beats)
            # High variance in beat intervals can indicate less steady rhythm
            # We map lower variance to higher danceability
            variance = _np.var(beat_intervals)
            # This is a heuristic mapping, not a scientific measure
            danceability = max(0, 100 - variance * 1000)
            analysis["danceability"] = round(danceability, 1)

        # Cue points from beats
        if beats.size > 0:
            analysis["cue_points"] = [
                {"time": round(float(b), 2), "label": "beat"} for b in beats
            ]
            # Attempt to find "downbeats" for more musical cue points
            try:
                # This is a simplified approach; more advanced methods exist
                chroma = _librosa.feature.chroma_cqt(y=y, sr=sr)
                # Find onsets (beginnings of notes)
                onset_env = _librosa.onset.onset_detect(y=y, sr=sr, units="time")
                # Find beats that are close to onsets - likely downbeats
                downbeats = []
                for beat_time in beats:
                    # Find the closest onset to this beat
                    closest_onset_idx = _np.argmin(_np.abs(onset_env - beat_time))
                    if (
                        _np.abs(onset_env[closest_onset_idx] - beat_time) < 0.05
                    ):  # 50ms tolerance
                        downbeats.append(beat_time)

                if downbeats:
                    analysis["cue_points"].append(
                        {"time": round(float(downbeats[0]), 2), "label": "first_beat"}
                    )
            except Exception as e:
                print(f"[Analysis] Downbeat detection failed: {e}")

        # Key detection (more accurate with full track)
        chroma = _librosa.feature.chroma_stft(y=y, sr=sr)
        if chroma.size > 0:
            # Same logic as _estimate_key_with_librosa, just on the full track
            chroma_mean = chroma.mean(axis=1)
            major_profile = _np.array(
                [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
            )
            minor_profile = _np.array(
                [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
            )

            def best_key(profile: "_np.ndarray"):
                scores = []
                for i in range(12):
                    rotated = _np.roll(profile, i)
                    score = _np.corrcoef(chroma_mean, rotated)[0, 1]
                    scores.append(score)
                best_index = int(_np.nanargmax(scores))
                return best_index, float(scores[best_index])

            maj_index, maj_score = best_key(major_profile)
            min_index, min_score = best_key(minor_profile)

            pitch_classes = [
                "C",
                "C#",
                "D",
                "D#",
                "E",
                "F",
                "F#",
                "G",
                "G#",
                "A",
                "A#",
                "B",
            ]
            if not _np.isnan(maj_score) or not _np.isnan(min_score):
                if maj_score >= min_score:
                    analysis["key"] = f"{pitch_classes[maj_index]} major"
                else:
                    analysis["key"] = f"{pitch_classes[min_index]} minor"

    except Exception as e:
        print(f"[Analysis] Error during analysis for {os.path.basename(mp3_path)}: {e}")

    t_end = time.time()
    print(f"[Analysis] Finished in {t_end - t_start:.2f}s. Results: {analysis}")
    return analysis


def analyze_segments(y, sr) -> list:
    import numpy as _np
    import librosa as _librosa
    import scipy.signal

    segments = []
    try:
        # Get duration for percentage calculations
        duration = _librosa.get_duration(y=y, sr=sr)
        if duration < 1:  # Need at least a second of audio
            return []

        # Get RMS energy to analyze dynamics
        rms = _librosa.feature.rms(y=y)[0]
        if rms.size == 0 or _np.max(rms) == _np.min(rms):
            return []
        rms_normalized = (rms - _np.min(rms)) / (_np.max(rms) - _np.min(rms))

        # --- Corrected Segmentation Logic ---
        # Create a novelty curve, smooth it, and find peaks for boundaries
        onset_env = _librosa.onset.onset_strength(y=y, sr=sr)
        # The kernel size for medfilt must be odd.
        onset_env_smooth = scipy.signal.medfilt(onset_env, kernel_size=5)
        boundaries_frames = _librosa.onset.onset_detect(
            onset_envelope=onset_env_smooth, sr=sr, units="frames"
        )
        novelty = _librosa.frames_to_time(boundaries_frames, sr=sr)

        # Find segment boundaries from novelty function peaks
        boundaries = _np.concatenate(([0], novelty, [duration]))
        boundaries = sorted(list(set(boundaries)))

        if len(boundaries) < 2:
            return []

        # Label segments heuristically
        for i in range(len(boundaries) - 1):
            start_time = boundaries[i]
            end_time = boundaries[i + 1]
            segment_duration = end_time - start_time

            if segment_duration < 3:  # Ignore very short segments
                continue

            # Get average energy for the segment
            start_frame = _librosa.time_to_frames(start_time, sr=sr)
            end_frame = _librosa.time_to_frames(end_time, sr=sr)
            segment_energy = _np.mean(rms_normalized[start_frame:end_frame])

            # --- Heuristic Labeling Logic ---
            label = "verse"  # Default label
            position_percent = (start_time / duration) * 100

            # Intro: first 15% of the song with low-mid energy
            if position_percent < 15 and segment_energy < 0.6:
                label = "intro"
            # Outro: last 15% of the song with low-mid energy
            elif position_percent > 85 and segment_energy < 0.6:
                label = "outro"
            # Drop/Chorus: high energy sections
            elif segment_energy > 0.7:
                label = "drop"
            # Buildup: mid-energy before a drop
            elif segment_energy > 0.4:
                # check if the next segment is a drop
                if i + 2 < len(boundaries):
                    next_start = boundaries[i + 1]
                    next_end = boundaries[i + 2]
                    next_start_frame = _librosa.time_to_frames(next_start, sr=sr)
                    next_end_frame = _librosa.time_to_frames(next_end, sr=sr)
                    if _np.mean(rms_normalized[next_start_frame:next_end_frame]) > 0.7:
                        label = "buildup"
            # Bridge: mid-song, lower energy section
            elif 40 < position_percent < 70 and segment_energy < 0.4:
                label = "bridge"

            segments.append(
                {
                    "start": round(start_time, 2),
                    "end": round(end_time, 2),
                    "label": label,
                    "energy": round(segment_energy, 2),
                }
            )

    except Exception as e:
        print(f"[Analysis] Error during segmentation: {e}")

    return segments
