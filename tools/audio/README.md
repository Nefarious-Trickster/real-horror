# VIGIL audio generators

Every sound in `public/assets/audio/` is rendered offline by these scripts. Nothing is sampled.

```bash
pip install numpy scipy soundfile piper-tts matplotlib
mkdir -p voices && cd voices
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx.json
cd ..
python3 build.py              # everything (~3 min)
python3 build.py amb_ vo_     # by id or prefix
python3 spec.py out.png id1 id2   # spectrogram sheet of the rendered WAVs in render/
```

`ffmpeg` with `libvorbis` and `rubberband` is required.

| file | contents |
|---|---|
| `lib.py` | DSP primitives: noise, filters, modal IRs, stick-slip pulse trains, synthetic reverb, limiter, loop tools |
| `sfx.py` | building blocks: rooms, impacts, creaks, breaths, crackle, hum |
| `foley.py` | footsteps, doors, phone, power, objects, thunder |
| `ambience.py` | the seamless loops (all periodic by construction: integer-cycle oscillators, FFT-periodic noise, circular reverb) and the music box |
| `creature.py` | player body sounds, the entity, stingers, the jumpscare |
| `voice.py` | the mother: Piper TTS + processing. The name "Eli" is spelled `Ee-lye` for the TTS. |
| `build.py` | renders, trims and normalises the sounds, checks the decoded peak (≤ −1 dBFS), writes `manifest.json` |
