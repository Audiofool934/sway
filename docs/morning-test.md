# First play

The prototype is installed at `~/Projects/sway` on this Mac.
It runs locally and does not need a Colab session.

## Start

```bash
cd ~/Projects/sway
uv run --locked sway serve
```

Leave Terminal open and open **http://127.0.0.1:8765** in Chrome.
Start with headphones at a comfortable volume.
If the page says another performance window is open, close that window and reload.

## Try a short performance

1. Choose **Gesture map only (recommended)** and press **Begin performance**.
2. Wait for the ensemble to start, then press **Enable camera** and allow camera access.
3. Keep your hands well lit and large enough in the preview to see individual fingers.
4. Tap your fingers clearly at a steady pace for about 10 seconds.
5. Change to a broad strumming gesture, then a slow flowing sweep, holding each for about 10 seconds.
6. Try a faster pulse, then remove your hands from view to hear the fade.
7. Press **Record**, perform for a minute, then **Finish take** and **Save your recording**.
8. Press **End performance**, turn the camera off, and stop the server with Ctrl-C when finished.

The gesture map reads a short window of hand trajectories and waits briefly before changing musical direction.
Hold each new gesture for around two seconds.
Raising your hands selects a higher note register; lowering them selects a lower one.
The [gesture map](gesture-map.md) describes the supported vocabulary and optional AI context.
Small finger movements and ambiguous gestures may be misread.
The displayed tempo is the controller's estimate or request; it is not a measurement of the generated recording's beat.

## Compare the two paths

End the performance, choose **Choose a musical action**, select **Air piano**, and begin again.
Your camera still controls pulse and movement energy in this mode.
This comparison keeps the chosen action fixed while retaining motion controls.
Turn off **Follow my pulse** to compare against a steady manual tempo.

Open **Session details** if playback breaks up.
Note the playback gap count and whether the music worker remains ready.

## Useful feedback

- Which gesture were you making, and which musical action appeared?
- Did finger taps create useful accents and a stable pulse?
- Did changes feel connected to your movement?
- Did the arrangement feel like a continuous piece?
- Were there audible gaps, or did the music fade unexpectedly?

A saved WAV and its JSON sidecar are kept in `~/Projects/sway/.cache/recordings/`.
The WAV contains generated audio before the browser volume control; camera frames are not saved.
