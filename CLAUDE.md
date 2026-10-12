# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and GitHub Copilot CLI when working in this repository.

Hide Me is a VS Code extension that hides files and folders from the Explorer without touching them on disk, and lists them in a "Hidden Items" view where they can be opened, revealed, copied or unhidden. It is published on the Marketplace as `maxs-lab-of-things.hide-me`. The repository is public.

## Commands

```bash
npm run compile               # tsc -p ./ -> out/
npm run lint                  # eslint src --ext ts
node validate-extension.js    # checksums a project before and after, proving nothing on disk changed
npx vsce package              # read the printed file list before publishing
```

Run the extension with F5 from VS Code. `validate-extension.js` checks this repository unless `TEST_PROJECT_PATH` points at a scratch project. `npm test` points at `out/test/runTest.js`, which does not exist, so it fails after compiling and linting.

## How hiding works

Hiding is two writes per workspace folder. `src/fileHider.ts` adds a pattern to the workspace `files.exclude` setting (that is what removes the item from the Explorer), and `src/storage.ts` records the item in `.hidden-items.json` at the workspace folder root (that is what feeds the "Hidden Items" view in `src/hiddenItemsProvider.ts`). The two must stay in step: unhiding removes both, and `hideMe.unhideAll` clears both. Patterns the user added to `files.exclude` by hand must survive every update, so only remove entries this extension wrote. `src/fileDecorationProvider.ts` exists but its registration in `extension.ts` is commented out.

## Releasing

`.vscodeignore` is the only control over what ships in the `.vsix`; `.gitignore` is ignored by `vsce`. The managed block in it is rewritten by a standardizing script, so add project-specific exclusions outside that block. The README states the Marketplace version, so bump it with `package.json` and `CHANGELOG.md`. The publishing procedure is in `../README.md`.
