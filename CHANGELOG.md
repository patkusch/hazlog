# Changelog

All notable changes to this project are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- A test that `run` stops cleanly when the local model server is down.

## [0.1.0] - 2026-09-03

First version. It finds contradictions across documents that could harm a patient, for the DCB0160 hospital IT safety standard.

- The risk matrix is checked against the DCB0160 Implementation Guidance v4.2.
- Live runs on gemma3 4B and 12B are archived and can be picked in the UI.
- A severity floor: an explicit Unknown severity left live on a clinical panel is never scored below Major.
