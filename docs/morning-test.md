# First play

Development is paused; these instructions are for returning to the saved prototype.
Read [project status](project-status.md) before restarting experiments.
The prototype is installed at `~/Projects/sway` on this Mac.
Music runs locally and does not need a Colab session; Qwen interpretation requires its configured cloud connection.

## Start

```bash
cd ~/Projects/sway
uv run --locked sway serve
```

Leave Terminal open and open **http://127.0.0.1:8765/ensemble.html** in Chrome.
Start with headphones at a comfortable volume.
If the page says another performance window is open, close that window and reload.

## Try a short performance

1. Choose **Qwen conductor / ensemble** and press **Begin performance**.
2. Wait for the ensemble to start, then press **Enable camera** and allow camera access.
3. Keep your hands well lit and large enough in the preview to see individual fingers.
4. Try finger taps in one hand with strumming or percussion in the other for about 10 seconds.
5. Look at **Qwen's arrangement** and listen for the parts together.
6. Suggest a faster or slower pace, then rest your hands and let the arrangement continue.
7. Press **Record**, perform for a minute, then **Finish take** and **Save your recording**.
8. Press **End performance**, turn the camera off, and stop the server with Ctrl-C when finished.

Qwen interprets the whole scene and chooses the musical result, using both hands as independent sources of inspiration.
Give a new idea several seconds to reach the music.
The [ensemble guide](gesture-ensemble.md) describes the arrangement and tempo behavior.
Small finger movements and ambiguous gestures may be misread.
The displayed tempo is the controller's estimate or request; it is not a measurement of the generated recording's beat.

## Compare the two paths

End the performance, choose **Choose a musical action**, select **Air piano**, and begin again.
Your camera still controls pulse and movement energy in this mode.
This comparison keeps the chosen action fixed while retaining motion controls.
Turn off **Allow tempo suggestions** to hold the requested tempo.

Open **Session details** if playback breaks up.
Note the playback gap count and whether the music worker remains ready.

## Useful feedback

- Which ideas did the two hands suggest, and which parts did Qwen arrange?
- Could you hear the requested instruments together, with a stable pulse?
- Did changes feel connected to your movement?
- Did the arrangement feel like a continuous piece?
- Were there audible gaps, or did the music fade unexpectedly?

A saved WAV and its JSON sidecar are kept in `~/Projects/sway/.cache/recordings/`.
The WAV contains generated audio before the browser volume control; camera frames are not saved.
