# Ember & Aether — DOS2-inspired tabletop workspace v0.7

## Folder layout

```text
ember-aether/
├── html/
│   ├── index.html        (battleboard — start here)
│   ├── party.html        (party stats and spells)
│   ├── quest-log.html    (quest journal)
│   └── notes.html        (notes and NPCs)
├── css/
│   └── styles.css        (shared styles)
├── js/
│   ├── engine.js         (combat calculations and rules)
│   ├── data.js           (skills, enemies, items, surfaces)
│   ├── world.js          (game world, gear, quests, XP)
│   ├── app.js            (battleboard interface)
│   ├── party.js          (party interface)
│   └── journal.js        (quests and notes interface)
└── README.md
```

## Run locally

1. Extract the ZIP, keeping the `html`, `css`, and `js` folders together.
2. Open the extracted folder in VS Code.
3. With the Live Server extension, right-click **html/index.html** and select **Open with Live Server**.
4. Navigate using the website tabs.

HTML pages reference CSS via `../css/styles.css` and JavaScript via `../js/<filename>.js`. Do not move individual files out of their folders without updating those paths.

## Shared data and player view

All pages use the same browser `localStorage` key (`dos2-battleboard-autosave-v2`). The site is not live multiplayer: separate devices do not synchronize without a backend. The party page shows player characters and their learned skills; the notes page is not password protected. Anyone with access to the same browser profile can open DM notes. Refresh the battleboard after editing notes/quests in another tab.

## Mechanics status

Combat formulas and skill data include provisional values and tabletop adaptations, not all verified DOS2 Definitive Edition mechanics.
