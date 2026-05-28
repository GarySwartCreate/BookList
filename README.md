# 📚 BookList

Track what you're reading, discover new books, share with friends.

**Stack:** React + Vite · Supabase · Vercel · Google Books API

---

## Getting Started

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project (must be created **after May 30, 2026** to use this schema's explicit GRANT syntax)
2. In your project dashboard, go to **SQL Editor**
3. Paste and run the entire contents of `schema.sql`
4. Verify the tables were created under **Table Editor**

### 2. Enable Email Auth

In Supabase → **Authentication → Providers**, make sure **Email** is enabled.

For magic links to work, set your **Site URL** under **Authentication → URL Configuration** to your Vercel URL (e.g. `https://booklist.vercel.app`).

### 3. Set Up Environment Variables

Copy the example env file:

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_GOOGLE_BOOKS_API_KEY=your-google-books-api-key   # optional
```

- **Supabase keys:** Dashboard → Project Settings → API
- **Google Books key:** [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Enable "Books API" → Create credentials → API key. Then restrict it to the Books API.

### 4. Run Locally

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`

### 5. Deploy to Vercel

1. Push this folder to a GitHub repo
2. In [Vercel](https://vercel.com), click **New Project** → import the repo
3. Set the **Root Directory** to this folder (if it's not the repo root)
4. Add the same environment variables from `.env.local` in Vercel → Project Settings → Environment Variables
5. Deploy — Vercel auto-detects Vite

---

## Features

| Feature | Description |
|---|---|
| **Library** | Track books as Reading / Read / Want to Read |
| **Ratings** | 1–5 star ratings per book |
| **Notes** | Private notes and reflections per book |
| **Search** | Google Books search with instant add |
| **Queue** | Drag-to-reorder Want to Read list |
| **Friends** | Find readers by username, send friend requests |
| **Activity** | See what friends are reading and their ratings |
| **Recommendations** | Genre-based, author-based, and friends' picks |
| **Send Recs** | Recommend a specific book to a friend with a note |

---

## Architecture

```
src/
  App.jsx     ← All components (single-file architecture)
  main.jsx    ← React entry point
  index.css   ← Global reset + scrollbar styles

schema.sql    ← Run once in Supabase SQL Editor
vercel.json   ← SPA rewrite rule for Vercel
vite.config.js
package.json
.env.example  ← Copy to .env.local and fill in
```

### Database Tables

| Table | Purpose |
|---|---|
| `profiles` | Usernames and display names |
| `books` | Cached Google Books metadata |
| `user_books` | User's library (status, rating, notes, position) |
| `friendships` | Friend requests and accepted connections |
| `book_recommendations` | Books recommended between friends |

All tables have Row Level Security (RLS) enabled. The explicit `GRANT` statements are required for Supabase projects created after May 2026.

---

## Recommendation Engine

Recommendations are generated from three signals:

- **Taste match** — searches Google Books for subjects matching your top-rated books' categories
- **Author affinity** — finds more books by authors you've rated 4+ stars
- **Friends' picks** — surfaces books that friends have finished and rated 4+ that you haven't added yet

Hit **↻ Refresh** to rotate to different categories and authors.
