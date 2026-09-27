# Project status and handoff

Updated: September 27, 2026, Asia/Singapore.
Status: paused at Everett's request.
This is the starting point for returning to Sway; the [documentation index](README.md) links the implementation guides and dated evidence.

## Product direction

Sway is a generative instrument in which visual input inspires the music and the models are responsible for musical quality.
The performer should not need exact finger technique, a rigid movement vocabulary, or precise beat timing.
Different hands should be able to inspire simultaneous complementary parts while the music maintains its own coherent pulse.

Gesture ensemble is the chosen direction when work resumes.
Flow remains a separate, deferred experiment.
Qwen3.8-Max stays as the visual interpreter and musical director.
Jev was considered on September 27 and not adopted; no Jev integration or benchmark was performed.
The decision is to improve the interaction around Qwen before another interpreter change.

## State of the implementation

| Area              | Implemented                                                                                          | Practical limit                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Visual input      | Browser MediaPipe tracking, separate hand observations, three ordered camera images per Qwen request | Sparse images and coarse motion hints can confuse gestures.                             |
| Musical direction | Qwen chooses one to four parts, their roles, harmony, energy, and pace intent                        | Arrangement labels describe requests, not instruments detected in generated audio.      |
| Timing            | Shared audio-time clock, bar-aligned arrangement updates, gradual tempo changes                      | The displayed BPM is a conditioning clock, not a measured audible beat.                 |
| Music             | Local MRT2 Small and an optional private Colab MRT2 Base service                                     | The adapter renders a stereo mixture without independent instrument stems.              |
| Flow              | Saved passages, local expression, return to original, recording, and optional DEMON variations       | Musical continuity and motion correlation remain insufficient for the intended product. |
| Lifecycle         | Owned workers, bounded cloud runners, recording closure, and private credentials                     | Colab remains an experimental runtime, not an always-on service.                        |

The latest performer feedback was that the interaction felt strange and drumming could be mistaken for strumming.
The earlier ensemble revision preserved multiple parts in the plan but did not establish reliable audible separation or responsiveness.
Keep that distinction explicit when presenting the prototype.

## Unresolved work

1. **Drum-versus-strum ambiguity.**
   The aggregate gesture mapper treats a moving hand beside a separated quiet hand as an anchored guitar gesture.
   That branch precedes the vertical-strike branch, so drumming can receive a strumming label.
   Per-hand and aggregate hints can disagree, and the fixed confidence values are not calibrated.
   This is a code-supported failure path; the performer's particular misclassification was not reproduced from captured footage.
2. **Delayed musical response.**
   Qwen receives three 384-pixel-wide images about 500 ms apart.
   Sampled ensemble requests took 4.68-6.49 seconds, with prompt preparation, bar scheduling, and playback buffering adding other delays.
   There is no physical gesture-to-audio latency measurement.
3. **Indirect control of the sound.**
   All requested parts become one style prompt plus sparse harmonic cues.
   Independent piano, guitar, and percussion control and a stable audible pulse remain unproven.
4. **Playback reliability.**
   Moving text encoding off the audio thread removed one source of stalls, but browser playback gaps remained in the repeated test.
5. **Evidence coverage.**
   Synthetic two-hand tests and a real API test on prerecorded one-hand footage do not establish real two-hand recognition or listening quality.

These are resume priorities, not fixes completed during the pause cleanup.
The [ensemble guide](gesture-ensemble.md) contains the detailed implementation and measurements.

## Verification at pause

- 89 Python tests passed.
- 18 JavaScript tests passed.
- Ruff lint and formatting, web Prettier checks, and Git whitespace checks passed.
- The Python test run emitted one existing Starlette warning about its deprecated `httpx` TestClient integration.
- All 114 local documentation links passed file and heading checks.
- `sway doctor` found all required assets and the configured Beijing Qwen3.8-Max account without making an API call.

The cleanup did not run a new camera performance, listening study, billable Qwen call, or GPU generation job.
Earlier validation remains dated evidence with its original limitations.

## Runtime and retained data

The owned local Sway server and model workers are stopped.
No recording was active when the pause cleanup began.
Colab reported no active sessions, zero active assignments, and a usage rate of 0.00 compute units per hour at the pause check.
No background Sway work is scheduled as part of this handoff.

The checkout, model assets, generated passages, and recordings remain in place.
Credentials remain outside Git in `~/.config/sway/qwen.json` on the development Mac.
Recordings and evidence under `.cache/`, `outputs/`, and `work/` are intentionally untracked; see the [data map](development.md#data-and-evidence).
Git history preserves the implementation and reports, but a clone alone does not preserve those local artifacts.

## Return to the project

1. Read this note and the [ensemble guide](gesture-ensemble.md).
2. Run the [development checks](development.md#checks) and `uv run --locked sway doctor`.
3. Restart locally through the [first-play guide](morning-test.md); Qwen with local MRT2 does not need a Colab allocation.
4. Reproduce drum/strum confusion and simultaneous-hand performance while comparing motion hints, Qwen's arrangement, and recorded sound.
5. Change one part of the perception-to-audio path at a time and evaluate audible correlation, response time, tempo, and gaps.

The older [evaluation plan](evaluation-plan.md) supplies measurement methods, but its single-action assumptions need adapting to the ensemble contract.
Choose a cloud experiment only when the question and comparison are prepared.

## Saved implementation history

Existing commits were preserved without rewriting history.
The accumulated work was organized into these commits before the documentation handoff:

| Commit    | Scope                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| `b5eab8f` | Bounded MRT2 and DEMON Colab trials and lifecycle tests.                                        |
| `11afe4a` | Qwen ensemble direction, shared timing, remote music services, Flow backend, and backend tests. |
| `f9c8e48` | Ensemble controls, Flow interface, hand pickup, playback, and JavaScript tests.                 |

The following documentation commit records the paused state, operating guides, and historical experiment reports.
These commits were made locally; the pause cleanup does not publish or push the repository.
