# .claude: how Claude Code works in this repo

Everyone who opens this repo with Claude Code gets the same setup from this folder. It makes Claude
follow the project structure in `docs/PROJECT_STRUCTURE.md` and `AGENTS.md`.

```
.claude/
├── settings.json              shared settings: the Expo plugin and the structure hook
├── hooks/check-structure.mjs  the structure check (Node, no packages)
├── rules/                     instructions Claude loads automatically
│   ├── structure.md           always: the repo map, where code goes, the "done" checklist
│   ├── frontend.md            when working in frontend/
│   ├── design-system.md       when working on app UI (frontend/src, Figma exports)
│   ├── backend.md             when working in backend/ or shared/
│   └── gateway.md             when working in gateway/
└── skills/                    step-by-step recipes Claude uses when the task matches
    ├── add-screen/SKILL.md    a new screen in the app
    └── add-feature/SKILL.md   a feature across contract, backend and app
```

## The three layers

1. **Rules** tell Claude where code goes. They load by themselves; nobody has to paste them.
2. **Skills** give the exact steps for the common jobs (new screen, new feature). Claude picks them
   when a request matches; you can also type `/add-screen` or `/add-feature`.
3. **The hook** checks every file Claude writes or edits, before the change happens, and blocks it
   when it breaks the structure: a `fetch` in a screen, a raw colour, SQL outside `repositories/`,
   a file in the wrong folder, `npm install <pkg>` instead of `npx expo install`, and so on.
   Claude sees the reason and fixes its change.

The hook only blocks **new** problems. The few old exceptions in the code keep working when edited.

## Run the check yourself

From the repo root (needs Node, which the app needs anyway):

```bash
node .claude/hooks/check-structure.mjs --changed          # everything changed since the last commit
node .claude/hooks/check-structure.mjs --changed Master   # everything on this branch
```

## Exceptions

If a rule really does not fit, agree on it in review and mark the line with a comment:
`// structure-ok: <why>`. Claude is told never to add this marker unless the user asks for it.

## Changing the rules

The structure lives in four places that must agree: `docs/PROJECT_STRUCTURE.md`, `AGENTS.md`,
`.claude/rules/` and `.claude/hooks/check-structure.mjs`. Change them together, in one commit.
Personal settings go in `.claude/settings.local.json`, which is not committed.
