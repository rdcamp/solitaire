# Quiet Cards

A browser-based Klondike Solitaire game built with React, TypeScript, and Vite.

## Features

- Standard draw-one Klondike gameplay with scoring, move tracking, and win detection.
- Local game and move-history persistence in IndexedDB through Dexie.
- Optional Supabase email/password authentication. Browser-local games are scoped to the signed-in account.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

To enable sign-in, replace the two placeholder values in `.env` with the public URL and publishable/anon key from **Supabase Dashboard → Project Settings → API Keys**. Email authentication must also be enabled in Supabase.

```bash
npm run build
npm run lint
```
A React Klondike Solitaire game
