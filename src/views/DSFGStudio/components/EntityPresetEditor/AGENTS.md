# Preset configuration requirements

- Every current and future preset category must show immutable system entries at the top and editable custom entries below.
- Keep default fields (`newItem`) and built-in entries (`presets`) in `systemPresetConfig.ts`; do not scatter defaults through UI code.
- Use `useWorkspacePresets` for loading, isolation and persistence. Its `defaults` factory is required for every category. UI edits `presets` (custom entries); consumers use `availablePresets` (system first, then custom).
- Only custom entries are saved. An empty custom list still exposes system entries. Preserve legacy edited system snapshots as custom entries; never overwrite corrupt files.
- Add defaults for new fields when decoding old data without overwriting existing valid values.
- Do not add edit/delete controls or restore-default actions for system entries. Include every category's save queue in the editor leave guard.
- Do not invent animation configuration IDs. See README.md for the extension workflow.
