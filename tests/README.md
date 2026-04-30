# Field CAD MVP contract tests

These Node built-in tests are the Lane 3 acceptance harness for the Cabione field consultation CAD/customization MVP.

Run from the repository root:

```sh
node --test tests/field-cad-mvp.contract.test.mjs
```

The tests intentionally encode the agreed implementation contract from `.omx/plans/test-spec-field-cad-mvp.md`:

- five selectable families (`하부장`, `상부장`, `슬라이징장`, `3도어장`, `플랩장`)
- draft template/constraint data remains `needs_review`
- 18 sample templates plus 18 CAD evidence manifests load
- CAD evidence includes direct DWG hash/signature/status and does not label filename/PDF/PNG inference as DWG-derived
- shared validation blocks invalid dimensions and impossible options
- drawing model output is deterministic after project JSON roundtrip
- export modules expose validity/precondition checks for PDF, project JSON, and capture exports

The harness uses only `node:test` and no third-party dependencies so Track A/Track B can run it before package tooling exists.
