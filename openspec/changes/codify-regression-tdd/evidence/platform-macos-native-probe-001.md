# PLATFORM-MACOS-NATIVE-PROBE-001

- Red command: `node --test test/regression-macos-native-probe.test.mjs`
- Parent state: the initial transport forwarded an unchecked PID, returned raw native data, and did not stop after a rejected result.
- Expected Red: exact assertions reported `Missing expected rejection`, missing `status`, and `0 !== 1` for stop cleanup. All five failures were behavioral contract failures; the test and fixture parsed correctly.
- Green command: `node --test test/regression-macos-native-probe.test.mjs`
- Green result: 7 passed, 0 failed, 0 skipped.
- Boundary: the macOS probe and App fixture were both type-checked by the installed Swift compiler without launching or touching the production App.
- Permission semantics: missing Accessibility or Screen Recording yields explicit `unverified`; it never counts as pass and never prompts for permission.
