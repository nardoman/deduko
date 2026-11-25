# Changelog

All notable changes to Deduko are listed here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-11-25

### Added

- Auto-exclude toggle (Auto, in the top bar): placing a dot puts an X on every
  empty cell in the rest of its row and column inside the same block. One Undo
  removes the dot and its automatic X's together. The setting is remembered.
- Error mode, chosen on the case intro screen (Free play or Max 5 errors). In
  error mode a wrong mark (an X where the answer is yes, a dot where it is no)
  is not placed; the status corner shows "Wrong" and the counter ("Errors:
  2/5"). Undo does not lower the counter, and the 5th error restarts the case
  from an empty grid. The mode is fixed once the case has progress.
- Case codes for generated cases, digits only (for example `113-482177`),
  shown during the game and on the solved screen. The Code button on the home
  screen opens an in-app numeric keypad; a code recreates the same grid in
  every language and resumes the saved case when it is the same one. Invalid
  codes and codes from an unknown generator version show an error message.
- Pack authors: settings accept an optional `code` (1-9), and Italian lexicon
  entries an optional `lead` field used by the either/or clues about suspects.
- Manual install zip `deduko_1.1.0_manuale.zip`, built by `tools/build.py
  base` next to the KPM package. Extract it into the Kindle root and open
  "Deduko" from the library; each launch writes `deduko/debug.log`.
- KPM repository in `kpm/`: with Wi-Fi on, `;kpm add-repo
  https://raw.githubusercontent.com/nardoman/deduko/main/kpm/manifest.json`
  then `;kpm install deduko`. `tools/build.py repo` adds a new version to it.

### Changed

- Tapping a cell that already holds a mark erases it, whatever tool is
  selected. The help line in the status corner says so.
- More natural Italian clues: "o" instead of "oppure", shared words said once
  ("Elena aveva la corda o il veleno."), "In giardino c'era Anna o Carla.",
  and plural forms for pairs ("Chi voleva l'eredità e chi agiva per vendetta
  sono arrivati uno alle 23:00 e l'altro alle 20:00."). English either/or and
  pair clues were reworded the same way ("Elena had either the rope or the
  poison.").
- Italian pair clues about two suspects now name the people first ("Anna e
  Dario erano uno in giardino e l'altro nello studio.") instead of "Tra chi
  era in giardino e chi era nello studio, uno era Anna e l'altro Dario.", and
  use "ed" before a vowel e ("Anna ed Elena").
- New generated cases use 6-digit seeds, so their codes are 10 digits long.
  This also restores the variety of categories in 3- and 4-ball cases, which
  almost always included arrival times with shorter seeds.
- `config.xml` sets `internetRequired` to `no`: the game makes no network
  request. The effect on the device is not confirmed yet.
- Saves from 1.0.0 (`deduko.v2.*` keys) still load, as free-play games with
  their marks, struck clues and undo history.
- New library cover: a 600x800 grey-scale book cover with the title, a grid
  and a magnifier, instead of the 64x64 black-and-white icon.

### Removed

- The eraser tool. Only the X and dot tools remain.

## [1.0.0] - 2026-11-24

### Added

- First release: a detective logic-grid puzzle game for jailbroken Kindles,
  a Mesquite web app installed as a KPM package.
- 5 bundled cases at difficulty 1 to 5 (from 3 categories of 4 items to 5
  categories of 5 items), each with exactly one solution.
- Randomly generated cases from the Villa Corvi setting, one saved case per
  difficulty.
- Italian and English, with clue sentences built by each language.
- Staircase grid with one block for every pair of categories.
- X, dot and eraser tools, clue striking, Undo of the last 50 actions kept
  across restarts of the app, and two-tap Restart.
- Extra case packs from a USB folder (`/mnt/us/deduko/packs/`) or from KPM
  pack packages.
