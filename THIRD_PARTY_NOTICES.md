# Third-party software notices

SceneWire-owned code is licensed under the [MIT License](https://github.com/winhok/SceneWireJS/blob/main/LICENSE), copyright SceneWire contributors. Third-party packages, grammars, themes and user assets keep their own licenses. SceneWire's MIT license does not relicense them.

## Distribution scope

The v1.3 npm train contains transpiled SceneWire libraries and a CLI assembled from SceneWire source modules. Mediabunny, Shiki, TextMate grammars and other npm implementations remain external imports; they are not embedded in those twenty tarballs. The original dependencies are obtained by the package manager and retain their own license files. This notice is also included as `dist/THIRD_PARTY_NOTICES.md` in every SceneWire npm package.

The versions below describe the lockfile and installed dependency graph, not every version allowed by semver ranges. When resolving different versions or redistributing a combined bundle, inspect the actual selected code and its applicable notices again. Generated editor, website and composition browser bundles are separate distribution artifacts and may include additional third-party components.

## Mediabunny

SceneWire uses **Mediabunny 1.60.0**, by Vanilagy and contributors, licensed under **MPL-2.0**. It is used by `@scenewirejs/media` and `@scenewirejs/renderer-web` through npm imports. No Mediabunny source is copied or modified in SceneWire's package implementation.

- [MPL-2.0 license and responsibilities](https://www.mozilla.org/en-US/MPL/2.0/)
- [Versioned upstream source](https://github.com/Vanilagy/mediabunny/tree/359e4e4eee43bf968551e03ddc7280f9c69d655a)
- The original `mediabunny@1.60.0` npm package includes its `LICENSE` and `src/` source.

If you redistribute MPL-covered code, including compiled or bundled forms, preserve applicable notices and make the covered source available as required by MPL sections 3.1–3.4. Changes to covered files remain subject to MPL. Unrelated SceneWire files retain their own license. A dependency declaration alone is not evidence that a combined distribution has fulfilled these obligations.

## Shiki, TextMate grammars and themes

The `shiki`, `@shikijs/langs` and `@shikijs/themes` versions listed here are **4.4.3**. Shiki's MIT notice identifies Pine Wu and Anthony Fu; see the installed packages' `LICENSE` files and [Shiki source/license](https://github.com/shikijs/shiki/tree/v4.4.3).

`@scenewirejs/domain-developer` imports TypeScript, JavaScript, JSON, Python and Bash grammars and the GitHub Dark theme. These definitions originate from different upstream projects and keep their applicable rights; the Shiki wrapper's MIT field is not a substitute for checking each included grammar or theme.

- [Official grammar provenance and NOTICE](https://github.com/shikijs/textmate-grammars-themes/tree/main/packages/tm-grammars)
- [Official theme provenance and NOTICE](https://github.com/shikijs/textmate-grammars-themes/tree/main/packages/tm-themes)

SceneWire npm packages import these definitions externally. A downstream browser bundle can embed them. Before distributing such a bundle, retain the applicable upstream copyright/license text and NOTICE for the versions actually included. The upstream collection includes definitions with differing licenses; do not assume the entire collection is MIT or adopt unused definitions silently.

## Lightning CSS and other dependencies

The runtime Vite dependency graph includes **Lightning CSS 1.33.0** and a platform-specific native package under **MPL-2.0**. They remain external dependency packages. See the original package license and [exact upstream source](https://github.com/parcel-bundler/lightningcss/tree/1d680fa14e9a089c92dc0929f869d6757ae91c30). A combined redistribution must also account for the platform package actually shipped.

Other runtime dependency licenses include MIT, ISC, BSD-3-Clause and Apache-2.0. Their original notices remain with the dependencies. The table records the installed dependency closure on macOS ARM64, excluding SceneWire's own packages and uninstalled platform alternatives. Optional authoring peers such as React, PixiJS and Three.js likewise retain their own licenses when installed or bundled.

| Dependency                          | Version   | Declared license |
| ----------------------------------- | --------- | ---------------- |
| `@oxc-project/types`                | `0.151.0` | MIT              |
| `@rolldown/binding-darwin-arm64`    | `1.2.11`  | MIT              |
| `@rolldown/pluginutils`             | `1.0.1`   | MIT              |
| `@shikijs/core`                     | `4.4.3`   | MIT              |
| `@shikijs/engine-javascript`        | `4.4.3`   | MIT              |
| `@shikijs/engine-oniguruma`         | `4.4.3`   | MIT              |
| `@shikijs/langs`                    | `4.4.3`   | MIT              |
| `@shikijs/primitive`                | `4.4.3`   | MIT              |
| `@shikijs/themes`                   | `4.4.3`   | MIT              |
| `@shikijs/types`                    | `4.4.3`   | MIT              |
| `@shikijs/vscode-textmate`          | `10.0.2`  | MIT              |
| `@types/dom-mediacapture-transform` | `0.1.12`  | MIT              |
| `@types/dom-webcodecs`              | `0.1.13`  | MIT              |
| `@types/hast`                       | `3.0.5`   | MIT              |
| `@types/mdast`                      | `4.0.4`   | MIT              |
| `@types/node`                       | `26.6.4`  | MIT              |
| `@types/react`                      | `19.3.0`  | MIT              |
| `@types/unist`                      | `3.0.3`   | MIT              |
| `@ungap/structured-clone`           | `1.4.0`   | ISC              |
| `acorn`                             | `8.18.0`  | MIT              |
| `ccount`                            | `2.0.1`   | MIT              |
| `character-entities-html4`          | `2.1.0`   | MIT              |
| `character-entities-legacy`         | `3.0.0`   | MIT              |
| `comma-separated-tokens`            | `2.0.3`   | MIT              |
| `csstype`                           | `3.2.3`   | MIT              |
| `dequal`                            | `2.0.3`   | MIT              |
| `detect-libc`                       | `2.1.2`   | Apache-2.0       |
| `devlop`                            | `1.1.0`   | MIT              |
| `fdir`                              | `6.5.0`   | MIT              |
| `fsevents`                          | `2.3.3`   | MIT              |
| `hast-util-to-html`                 | `9.0.5`   | MIT              |
| `hast-util-whitespace`              | `3.0.0`   | MIT              |
| `html-void-elements`                | `3.0.0`   | MIT              |
| `lightningcss`                      | `1.33.0`  | MPL-2.0          |
| `lightningcss-darwin-arm64`         | `1.33.0`  | MPL-2.0          |
| `mdast-util-to-hast`                | `13.2.1`  | MIT              |
| `mediabunny`                        | `1.60.0`  | MPL-2.0          |
| `micromark-util-character`          | `2.1.1`   | MIT              |
| `micromark-util-encode`             | `2.0.1`   | MIT              |
| `micromark-util-sanitize-uri`       | `2.0.1`   | MIT              |
| `micromark-util-symbol`             | `2.0.1`   | MIT              |
| `micromark-util-types`              | `2.0.2`   | MIT              |
| `nanoid`                            | `3.3.19`  | MIT              |
| `oniguruma-parser`                  | `0.12.2`  | MIT              |
| `oniguruma-to-es`                   | `4.3.6`   | MIT              |
| `picocolors`                        | `1.1.1`   | ISC              |
| `picomatch`                         | `4.0.7`   | MIT              |
| `playwright`                        | `1.63.0`  | Apache-2.0       |
| `playwright-core`                   | `1.63.0`  | Apache-2.0       |
| `postcss`                           | `8.5.28`  | MIT              |
| `property-information`              | `7.2.0`   | MIT              |
| `regex`                             | `6.1.0`   | MIT              |
| `regex-recursion`                   | `6.0.2`   | MIT              |
| `regex-utilities`                   | `2.3.0`   | MIT              |
| `rolldown`                          | `1.2.11`  | MIT              |
| `semver`                            | `7.8.5`   | ISC              |
| `shiki`                             | `4.4.3`   | MIT              |
| `source-map-js`                     | `1.2.1`   | BSD-3-Clause     |
| `space-separated-tokens`            | `2.0.2`   | MIT              |
| `stringify-entities`                | `4.0.4`   | MIT              |
| `tinyglobby`                        | `0.2.17`  | MIT              |
| `trim-lines`                        | `3.0.1`   | MIT              |
| `undici-types`                      | `8.9.0`   | MIT              |
| `unist-util-is`                     | `6.0.1`   | MIT              |
| `unist-util-position`               | `5.0.0`   | MIT              |
| `unist-util-stringify-position`     | `4.0.0`   | MIT              |
| `unist-util-visit`                  | `5.1.0`   | MIT              |
| `unist-util-visit-parents`          | `6.0.2`   | MIT              |
| `vfile`                             | `6.0.3`   | MIT              |
| `vfile-message`                     | `4.0.3`   | MIT              |
| `vite`                              | `8.3.2`   | MIT              |
| `zod`                               | `4.6.5`   | MIT              |
| `zustand`                           | `5.0.15`  | MIT              |
| `zwitch`                            | `2.0.4`   | MIT              |
