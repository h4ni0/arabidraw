<div align="center">
  <h1>ArabiDraw</h1>
  <p dir="rtl"><strong>نسخة من Excalidraw مدعّمة بخطوط عربية وبميّزات مخصصة.</strong></p>
  <p>
    An Arabic-enabled fork of <a href="https://github.com/excalidraw/excalidraw">Excalidraw</a> —
    the open-source, hand-drawn style virtual whiteboard — with first-class Arabic fonts
    and a few opinionated extras.
  </p>
</div>

<p align="center">
  <a href="https://github.com/excalidraw/excalidraw/blob/master/LICENSE">
    <img alt="Released under the MIT license." src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
</p>

---

## ✨ What this fork adds

Everything Excalidraw already does, plus:

### 🅰️ Arabic fonts — Qomra Arabic

The full **Qomra Arabic** type family is bundled and selectable directly from the font
picker, with proper font metrics for clean Arabic rendering:

| Font | Weight |
| --- | --- |
| Qomra Arabic Light | Light |
| Qomra Arabic | Regular |
| Qomra Arabic Medium | Medium |
| Qomra Arabic Bold | Bold |
| Qomra Arabic Black | Black |

### 🎤 Presenter mode

A dedicated presentation mode that hides the editing UI for a clean, distraction-free
canvas. Enter it with a one-click button in the editor, and leave it with the on-screen
exit button.

---

## 🧬 Relationship to upstream Excalidraw

ArabiDraw is a fork of [`excalidraw/excalidraw`](https://github.com/excalidraw/excalidraw)
and is kept in sync with it. To pull in the latest upstream changes:

```bash
git remote add upstream https://github.com/excalidraw/excalidraw.git   # one-time
git fetch upstream
git rebase upstream/master   # replays the ArabiDraw commits on top of upstream
```

All of upstream's features remain available, including: an infinite hand-drawn style
canvas, dark mode, image & shape-library support, localization (i18n), export to
PNG/SVG/clipboard, the `.excalidraw` open format, arrow binding, undo/redo, and
zoom/panning. See the [Excalidraw docs](https://docs.excalidraw.com) for the full editor
documentation.

## 🛠️ Development

This is a Yarn-workspaces monorepo (`packages/*` for the editor library, `excalidraw-app/`
for the web app). Common commands:

```bash
yarn install         # install dependencies
yarn start           # run the app locally
yarn test:typecheck  # TypeScript type checking
yarn test:update     # run all tests (with snapshot updates)
yarn fix             # auto-fix formatting and linting
```

## 📄 License

MIT — same as upstream Excalidraw. ArabiDraw builds on the work of the
[Excalidraw](https://github.com/excalidraw/excalidraw) team and contributors.
