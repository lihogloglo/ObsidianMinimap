# Note Minimap

Personal fork of [YairSegel/ObsidianMinimap](https://github.com/YairSegel/ObsidianMinimap).

This Obsidian plugin adds a VS Code-style minimap to Markdown panes, with a synced viewport slider and click/drag navigation.

![Screenshot of Note Minimap in Obsidian.](screenshot.png)

## What changed

- Replaced iframe/helper-leaf rendering with a direct canvas minimap.
- One minimap per Markdown pane, with no hidden helper tabs.
- Renders from Markdown source text, so long notes are not limited by Obsidian's visible editor viewport.
- Syncs with native scrolling using `scrollTop`, `scrollHeight`, and `clientHeight`.
- Supports click, drag, touch, cancel, and focus-loss cleanup through Pointer Events.

## Install

Copy this folder into your vault:

```text
.obsidian/plugins/minimap
```

Make sure it contains:

- `main.js`
- `manifest.json`
- `styles.css`

Then enable **Note Minimap** in Obsidian's Community Plugins settings.

## Settings

Enable by default, line scale, width, max column, render characters, minimap opacity, slider opacity, and top offset.

## License

MIT, following the original project license.
