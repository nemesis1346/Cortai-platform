# COrtai Frontend

Next.js 14 App Router shell for the V1 pilot.

## Setup

```bash
cd apps/cortai-frontend
cp .env.example .env
npm install
npm run dev
```

## Structure

- `src/design/tokens.ts` contains tokens extracted from the approved HTML mockup.
- `tailwind.config.ts` maps tokens into Tailwind.
- `src/components/ui/` contains base design-system components.
- `src/app/[locale]/login` is the login flow.
- `src/app/[locale]/dashboard` is the protected operations shell.
- `src/app/[locale]/dashboard/admin/users` is the first module.
- `messages/en.json` and `messages/fr.json` hold all user-facing strings.

## Commands

```bash
npm run lint
npm run build
npm run test:e2e
```

The UI intentionally re-implements the visual direction from the mockup as typed,
composable React components rather than copying the mockup HTML or CSS.
