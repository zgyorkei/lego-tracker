# Brick Tracker logo: Glim the Ghost

The app's icon is Glim the Ghost (an original figure made for Brick Tracker) on a dark
purple app tile, the user's pick of 28 Nov 2026 (variant 4, "App icon tile", one shade
darker than on the pick page). The same image is the Chrome app's icons (`public/icons/`)
and the desktop app's (`desktop/icons/`, wrapped into the Windows `.ico` by `desktop/build.mjs`).

## Files

| File               | What it is                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `minifigs.py`      | Glim: his colours, face and torso prints (pure Python and numpy, no Blender)                        |
| `render_bust.py`   | The Blender 4.5 script: LDraw parts, toon shading with outlines, a 1024 px RGBA bust                |
| `pngio.py`         | A small PNG reader and writer, and the premultiplied resampling both scripts use                    |
| `make_icons.py`    | Bakes the render into every icon size (the tile, the highlight, the inset lines) with numpy         |
| `glim_darker.py`   | Builds `glim-darker.html`: the pick page's Glim next to the darker one (full size, 192, 48 px)     |
| `renders/before/`  | The pick page's Glim (kept as the "before" image)                                                   |
| `renders/T/`       | The render the icons are baked from (`ghost.png`, and 192 and 48 px previews of it)                 |

## Making the icons again

Blender here is the portable one at
`%LOCALAPPDATA%\BrickBudgetArt\blender\blender-4.5.15-windows-x64` (with the ImportLDraw add-on
and the LDraw parts library next to it, in `BrickBudgetArt`). The render is heavy work: on the
orchestrator's machine, run it through `aao run --heavy`.

```text
blender.exe -b --factory-startup --python docs/design/logo-minifigs/render_bust.py -- --style B --only ghost --folder T
<blender dir>\4.5\python\bin\python.exe -I docs/design/logo-minifigs/make_icons.py
<blender dir>\4.5\python\bin\python.exe -I docs/design/logo-minifigs/glim_darker.py
```

The second step needs only `renders/T/ghost.png` (the committed render), so a colour-free change
(the tile's corner radius, the size of the bust) does not need Blender at all. The PNGs it writes
are committed; no build step makes them.

## What is where

- Chrome app: `public/icons/icon-192.png`, `icon-512.png` (the rounded tile), `icon-maskable-512.png`
  (full bleed, the bust inside the 80% safe circle), `apple-touch-icon.png` (180 px, opaque),
  `favicon-32.png`; named by `pwa.config.ts` and `index.html`.
- Desktop app: `desktop/icons/<16|32|48|64|128|256>.png`; `desktop/build.mjs` copies `64.png` to
  `dist/icon.png` (window and tray) and wraps all of them into `dist/icon.ico` (the installer and exe).

## The darker shade

"A bit darker shade" is one step down from the pick page's Glim. Hood `#c4f0d2` became `#9ad9b0`,
head `#d6f6e0` became `#b4e3c4`, torso and arms `#b9ebc9` became `#8fd1a8`, the sheet folds `#86c99c`
became `#5fa87a` (the old values are in a comment in `minifigs.py`). The toon outlines stay, and the
face stays readable at 48 px (see `glim-darker.html`).

The figure's parts are standard LDraw minifigure parts (LDraw.org Parts Library, CC BY 2.0 / CC BY 4.0).
