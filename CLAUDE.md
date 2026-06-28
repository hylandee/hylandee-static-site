# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal static site (`hylandee`) — vanilla HTML/CSS/JS, no build step, no framework. Each top-level directory is a self-contained page (`/japan`, `/quiz`, `/necrouomicon`, etc.). The `auth/` directory is the exception: it contains a multi-page auth flow backed by a Rust API.

## Commands

```bash
# Run the dev server (serves static files + proxies /api to the Rust backend)
node server.js
# → http://localhost:3002

# Run Playwright tests (requires the dev server to be running)
npm test
npm run test:headed   # with browser visible
npm run test:ui       # Playwright UI mode
```

The Rust backend must be running separately for auth features to work:
```bash
cd /Users/dylan/dev/printedin3d-rs && cargo run
# → http://127.0.0.1:3000
```

## Architecture

**Static pages** (`index.html`, `japan/`, `quiz/`, `necrouomicon/`, `printedin3d/`): each page is entirely self-contained — inline `<style>` and `<script>` in the HTML file. No shared CSS or JS between pages.

**Auth flow** (`auth/`): the one multi-file section. `auth.js` is shared by both `index.html` (signup/login) and `profile.html` (profile management). All API calls go through `/api` which `server.js` proxies to the Rust server. Auth state is managed via HTTP-only cookies; `auth.js` calls `GET /api/me` on load to check session status.

**Dev server** (`server.js`): Express app that proxies `/api/*` to `http://127.0.0.1:3000/api` and serves everything else as static files. Only needed in development — production presumably serves files directly.

## Adding a new page

Create a new directory with an `index.html` (self-contained, inline styles). Add a link to it in the root `index.html`'s `<ol>`. No build step required.
