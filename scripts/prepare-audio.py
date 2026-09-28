#!/usr/bin/env python3
"""Optional asset tool: Python 3 + FFmpeg; py7zr only for the beast archive.
Downloads the CC0 sources listed in audio-sources.json and writes game OGGs.
The game itself needs no conversion tool or build step.
"""
import array
import concurrent.futures
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = os.environ.get('FLAG_FFMPEG', 'ffmpeg')
CONFIG = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    "import {AUDIO} from './shared/config.js';process.stdout.write(JSON.stringify(AUDIO));"], cwd=ROOT))
MANIFEST = json.loads((ROOT / 'scripts/audio-sources.json').read_text())
# FLAG_AUDIO_ONLY=monkey- converts only the files whose path contains it.
MANIFEST = [e for e in MANIFEST if os.environ.get('FLAG_AUDIO_ONLY', '') in e['file']]
CACHE = Path(os.environ.get('FLAG_AUDIO_CACHE', '/tmp/flag-audio-originals'))
CACHE.mkdir(parents=True, exist_ok=True)

def original(entry):
    filename = entry['sourceUrl'].rsplit('/', 1)[-1]
    archive = CACHE / filename
    if not archive.exists():
        with urllib.request.urlopen(entry['sourceUrl'], timeout=60) as response:
            archive.write_bytes(response.read())
    if 'member' not in entry:
        return archive
    destination = CACHE / (filename + '.unpacked')
    target = destination / entry['member']
    if not target.exists():
        destination.mkdir(exist_ok=True)
        if filename.endswith('.zip'):
            with zipfile.ZipFile(archive) as source:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read(entry['member']))
        else:
            import py7zr
            with py7zr.SevenZipFile(archive) as source:
                source.extract(path=destination, targets=[entry['member']])
    return target

def convert(entry):
    output = ROOT / entry['file']
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [FFMPEG, '-v', 'error', '-i', str(original(entry))]
    if 'start' in entry:
        command += ['-ss', str(entry['start'])]
    if 'duration' in entry:
        command += ['-t', str(entry['duration'])]
    filters = entry.get('filters', []) + [
        f"loudnorm=I={CONFIG['loudness'][entry['category']]}:TP={CONFIG['truePeak']}:LRA={CONFIG['loudnessRange']}"]
    command += ['-af', ','.join(filters), '-ar', str(CONFIG['sampleRate']), '-ac', '1' if entry['category'] == 'effects' else '2', '-f', 'f32le', '-']
    samples = array.array('f', subprocess.check_output(command))
    channels = 1 if entry['category'] == 'effects' else 2
    if entry.get('loop'):
        # Overlap the tail into the head, then rotate to the end of the overlap.
        # Both joins now meet adjacent original samples; no silence or click.
        overlap = min(int(CONFIG['loopCrossfade'] * CONFIG['sampleRate']), len(samples) // channels // 4)
        count = overlap * channels
        seam = array.array('f')
        for frame in range(overlap):
            weight = frame / max(1, overlap - 1)
            for channel in range(channels):
                i = frame * channels + channel
                seam.append(samples[-count+i] * (1-weight) + samples[i] * weight)
        samples = samples[count:-count] + seam
    # Very short effects cannot be integrated by loudnorm. Normalize their RMS
    # and bound sample peaks after every operation; leave headroom for Vorbis.
    peak = max(map(abs, samples), default=0)
    scale = 1.0
    if entry['category'] == 'effects' and samples:
        rms = math.sqrt(sum(value * value for value in samples) / len(samples))
        if rms:
            scale = 10 ** (CONFIG['loudness']['effects'] / 20) / rms
    if peak:
        ceiling = 10 ** ((CONFIG['truePeak'] - CONFIG['codecPeakHeadroom']) / 20)
        scale = min(scale, ceiling / peak)
    samples = array.array('f', (value * scale for value in samples))
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(CONFIG['sampleRate']), '-ac', str(channels),
        '-i', '-', '-c:a', 'libvorbis', '-q:a', str(CONFIG['quality']), str(output)], input=samples.tobytes(), check=True)
    return str(output.relative_to(ROOT))

if __name__ == '__main__':
    failures = []
    # Download archives once before workers reuse their members.
    for url in dict.fromkeys(entry['sourceUrl'] for entry in MANIFEST):
        entry = next(e for e in MANIFEST if e['sourceUrl'] == url)
        try:
            original(entry)
        except Exception as error:
            failures.append((url, str(error)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        tasks = [(entry, executor.submit(convert, entry)) for entry in MANIFEST]
        for entry, task in tasks:
            try:
                print(converted := task.result())
            except Exception as error:
                failures.append((entry['file'], str(error)))
    if failures:
        print('Manual downloads needed:', json.dumps(failures, indent=2))
        raise SystemExit(1)
