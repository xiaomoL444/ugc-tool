# Browser primitive fitting engine

Source: https://github.com/1475505/Miliastra-toolbox-primitive-shape/tree/46f30bb318c82aa4d4ece7bd790dc68e483fb360 (MIT). The nested primitive library retains its MIT LICENSE. No proprietary application code is included here.

Local changes:

- Transparent input uses premultiplied RGBA, as required by Go image.RGBA.
- Workers seed candidate shapes in the foreground using a distance field. Every candidate and mutation must pass alpha-mask coverage and full geometric bounds checks. At most 1% of raster weight may lie on fully transparent pixels, allowing a small antialiasing fringe.
- Distributed apply validates candidates again and only commits improvements. The actual output count may therefore be lower than the requested budget.
- Export retains optimized alpha, and the preview uses the actual shapes without a source-image clip mask.

Build with Go >= 1.25.4: `node scripts/build-primitive-wasm.cjs` from the project root. Set GO_BINARY if Go is not on PATH. The build publishes both WASM and the matching wasm_exec.js; changing the engine requires updating the cache version in the worker and primitiveFitter.ts. Run `go test ./primitive` from third_party/primitive for mask constraint tests.

The transparent-pixel and native WASM regression tests are in scripts/test-client-ui-primitive-alpha.cjs.
