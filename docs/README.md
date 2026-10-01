# Documentation

Sway development resumed on September 28, 2026 with a first-principles redesign.
Start with the [V1 plan](v1-plan.md): what the instrument is, the rules it is built by, and the milestones.
The [manual](manual.md) explains how Sway works, part by part, with the music and audio background it assumes.

## Current guides

| Document                      | Read it for                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| [V1 plan](v1-plan.md)         | The instrument's design, defaults, architecture, milestones, and progress. |
| [Development](development.md) | Source map, checks, runtime constraints, and local data locations.         |

## The paused prototype

These guides describe the Qwen and MRT2 prototype that V1 supersedes; its pages remain available for comparison.

| Document                                         | Read it for                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| [Project status at the pause](project-status.md) | Decisions, known issues, and checked state on September 27.                 |
| [First play](morning-test.md)                    | Starting the legacy ensemble page, performing, recording, and stopping.     |
| [Gesture ensemble](gesture-ensemble.md)          | The Qwen arrangement contract, timing, implementation, and measured limits. |
| [Cloud setup](cloud-setup.md)                    | Private Qwen configuration and bounded Colab use with release verification. |
| [Flow experiment](flow-mode.md)                  | Operating the retained passage and variation experiment.                    |
| [Legacy gesture map](gesture-map.md)             | The older single-action vocabulary used for comparisons and motion hints.   |

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
