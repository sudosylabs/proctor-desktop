# Bundled GitHub color themes

Theme assets are generated from [primer/github-vscode-theme](https://github.com/primer/github-vscode-theme)
and bundled as JSON, without loading the extension. The exact upstream revision,
build dependency versions, palette paths and output hashes are recorded in
[`github-source.json`](../../resources/themes/github-source.json). The upstream
[MIT notice](../../resources/themes/github/LICENSE) accompanies those resources.
All nine variants are retained, including the two explicitly legacy variants.
The product default is GitHub Dark Default.

The upstream generator is run only during reviewed source intake, using its
pinned color libraries. No dependency on its checkout or build libraries enters
the application. The registered `theme.resources` generator verifies the recorded SHA-256 digests and embeds the checked-in
JSON files into the runtime catalog for synchronous startup and offline loading.
TextMate token sections remain in the source assets for later editor admission;
this color engine applies workbench colors only.

The unmodified GitHub Dark Default hover (`button.hoverBackground` #2ea043,
white text) measures 3.37:1, below 4.5:1 for ordinary text. This is an explicit
upstream-palette accessibility exception, owned by the design-system review;
the contrast test pins it instead of claiming every upstream color is WCAG AA.
High-contrast variants remain available. A future palette adjustment requires
an explicit product color override rather than silently modifying source assets.
