# Documentation

Sway development is paused as of September 27, 2026.
Start with [project status and handoff](project-status.md).
Gesture ensemble remains the intended direction, with Qwen as the visual interpreter and musical director.

## Current guides

| Document                                        | Read it for                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| [Project status and handoff](project-status.md) | Decisions, known issues, checked state, and resume priorities.              |
| [First play](morning-test.md)                   | Starting the installed prototype, performing, recording, and stopping.      |
| [Gesture ensemble](gesture-ensemble.md)         | The Qwen arrangement contract, timing, implementation, and measured limits. |
| [Development](development.md)                   | Source map, checks, runtime constraints, and local data locations.          |
| [Cloud setup](cloud-setup.md)                   | Private Qwen configuration and bounded Colab use with release verification. |
| [Flow experiment](flow-mode.md)                 | Operating the retained passage and variation experiment.                    |
| [Legacy gesture map](gesture-map.md)            | The older single-action vocabulary used for comparisons and motion hints.   |

## Validation records

Each record describes a dated test of a particular revision.
Older timing and test counts are not current performance claims.
Raw recordings and screenshots referenced in these reports remain in ignored local folders.

| Record                                                                       | What it establishes                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [First prototype, September 26](prototype-validation.md)                     | Initial local implementation and engineering checks.                                               |
| [Qwen and Colab pilot, September 26](cloud-validation-2026-09-26.md)         | Cloud connectivity and MRT2 throughput on L4 and A100.                                             |
| [Live Colab music, September 27](cloud-live-validation-2026-09-27.md)        | Private streaming, network timing, recording, and playback gaps in the earlier single-action mode. |
| [DEMON feasibility, September 27](demon-colab-validation-2026-09-27.md)      | Source transformations, corrected streaming measurements, and GPU cleanup.                         |
| [Flow validation, September 27](flow-validation-2026-09-27.md)               | Saved-passage playback, cloud variations, and the subsequent hand-control fix.                     |
| [Ensemble validation, September 27](gesture-ensemble.md#validation-evidence) | Multi-part plans, timing logic, real Qwen integration, and the limits of the one-hand test.        |

## Historical designs and research

These documents preserve the reasoning behind experiments.
Their proposals and future-tense recommendations do not override the paused state or the decisions in the handoff.

| Document                                                                   | Historical scope                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [First prototype design](first-prototype-design.md)                        | Initial generative-theremin proposal before implementation.                                |
| [Model and product research, September 26](product-research-2026-09-26.md) | Provider and music-engine candidates at the pre-ensemble baseline.                         |
| [Flow proposal, September 27](product-direction-2026-09-27.md)             | The earlier Flow direction and DEMON source review, later superseded as the main priority. |
| [Evaluation plan](evaluation-plan.md)                                      | Proposed measurement methods and targets; adaptation is needed for ensemble evaluation.    |

Project-wide model attribution is in [third-party notices](../THIRD_PARTY_NOTICES.md).
