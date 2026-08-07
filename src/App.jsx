// ================================================================
// BookList – App.jsx
// Stack: React + Vite + Supabase + Vercel  (single-file)
// Dark cinematic theme · Poster grid · Horizontal scroll rows
// ================================================================
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase client ─────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
const GOOGLE_BOOKS_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY || ''

// ─── Design tokens ───────────────────────────────────────────────
const DARK_THEME = {
  bg:         '#101b29',
  surface:    '#1a1d2e',
  surface2:   '#242840',
  border:     '#2d3158',
  text:       '#f1f0ff',
  muted:      '#8b87b0',
  primary:    '#7c6ff7',
  primaryDim: '#4f47c4',
  accent:     '#f0b429',
  success:    '#34d399',
  star:       '#f0b429',
  danger:     '#f87171',
  nav:        '#0a121c',
  overlay:    'rgba(0,0,0,0.85)',
  white:      '#ffffff',
}

const LIGHT_THEME = {
  bg:         '#F9F6F0',
  surface:    '#EFEBE2',
  surface2:   '#E5E0D5',
  border:     '#CCC8BB',
  text:       '#1c1830',
  muted:      '#7a7060',
  primary:    '#5b54d6',
  primaryDim: '#4038b0',
  accent:     '#c8860a',
  success:    '#1a9e6e',
  star:       '#c8860a',
  danger:     '#c0392b',
  nav:        '#EDE9E0',
  overlay:    'rgba(0,0,0,0.55)',
  white:      '#ffffff',
}

// Mutable — reassigned by App before each render based on theme state
let C = DARK_THEME

const f = {
  serif: 'Georgia, "Times New Roman", serif',
  sans:  '"Helvetica Neue", Arial, sans-serif',
}

const btn = (variant = 'primary', size = 'md') => {
  const sizes = { sm: { fontSize: 12, padding: '5px 12px' }, md: { fontSize: 14, padding: '8px 16px' }, lg: { fontSize: 16, padding: '12px 22px' } }
  const variants = {
    primary: { background: C.primary,   color: C.white,  border: 'none' },
    ghost:   { background: 'transparent', color: C.primary, border: `1px solid ${C.primary}` },
    subtle:  { background: C.surface2,  color: C.text,   border: `1px solid ${C.border}` },
    danger:  { background: 'transparent', color: C.danger, border: `1px solid ${C.danger}` },
    accent:  { background: C.accent,    color: '#0f1117', border: 'none' },
  }
  return {
    cursor: 'pointer', fontFamily: f.sans, borderRadius: 6, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 4, transition: 'opacity 0.15s',
    ...sizes[size], ...variants[variant],
  }
}

const pill = (active) => ({
  cursor: 'pointer', fontFamily: f.sans, fontSize: 13, fontWeight: 600,
  padding: '6px 14px', borderRadius: 20, border: 'none', transition: 'all 0.15s',
  background: active ? C.primary : C.surface2,
  color: active ? C.white : C.muted,
})

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 8,
  border: `1px solid ${C.border}`, background: C.surface2,
  color: C.text, fontFamily: f.sans, fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
}

// Fetch with a hard timeout so a slow/rate-limited API can't hang the UI —
// aborts and throws instead of leaving the caller waiting indefinitely.
async function fetchWithTimeout(url, ms = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ─── Google Books API ─────────────────────────────────────────────
async function fetchGoogleVolumes(q, maxResults) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.searchParams.set('q', q)
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('printType', 'books')
  if (GOOGLE_BOOKS_KEY) url.searchParams.set('key', GOOGLE_BOOKS_KEY)
  const res = await fetchWithTimeout(url.toString())
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Google Books error ${res.status}`)
  }
  const data = await res.json()
  return (data.items || []).map(parseVolume)
}

// Google's plain relevance search ranks across title/description/subject all at
// once, so a short/generic title ("Country People", "A Pair of Aces") can get
// buried under unrelated books that just mention those words — the exact match
// never makes it into the first `maxResults`. Adding author narrows it enough to
// surface it, which is the workaround users have been forced into. Fix it at the
// source: for real (multi-result) searches with a plain-text query, also run an
// intitle:-scoped search in parallel and merge, favoring the title-scoped hits.
// Skipped for callers that already pass a scoped operator (isbn:/intitle:/etc.)
// or that only want a single exact-match result, to avoid doubling API quota use.
async function searchGoogleBooks(query, maxResults = 20) {
  const isScoped = /\b(intitle|inauthor|inpublisher|subject|isbn):/i.test(query)
  if (isScoped || maxResults <= 1) return fetchGoogleVolumes(query, maxResults)

  const [broad, titled] = await Promise.all([
    fetchGoogleVolumes(query, maxResults),
    fetchGoogleVolumes(`intitle:${query}`, maxResults).catch(() => []),
  ])
  const seen = new Set()
  const merged = []
  for (const b of [...titled, ...broad]) {
    if (!seen.has(b.id)) { seen.add(b.id); merged.push(b) }
  }
  return merged.slice(0, maxResults)
}

// ─── Open Library fallback ────────────────────────────────────────
async function searchOpenLibrary(query, maxResults = 20) {
  const url = new URL('https://openlibrary.org/search.json')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(maxResults))
  url.searchParams.set('fields', 'key,title,author_name,cover_i,subject,first_publish_year,number_of_pages_median,isbn,publisher')
  const res = await fetchWithTimeout(url.toString())
  if (!res.ok) throw new Error(`Open Library error ${res.status}`)
  const data = await res.json()
  return (data.docs || []).map(doc => ({
    id:             `ol_${doc.key?.replace('/works/', '') || Math.random()}`,
    title:          doc.title || 'Unknown Title',
    authors:        doc.author_name || [],
    description:    '',
    cover_url:      doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : null,
    categories:     (doc.subject || []).slice(0, 3),
    published_date: doc.first_publish_year ? String(doc.first_publish_year) : '',
    page_count:     doc.number_of_pages_median || null,
    isbn:           doc.isbn?.[0] || null,
    publisher:      doc.publisher?.[0] || null,
    subtitle:       null,
    average_rating: null,
    ratings_count:  null,
  }))
}

// Fire both providers at once (rather than only starting Open Library after
// Google fails/times out) so a slow or rate-limited Google Books call doesn't
// double the total wait before Open Library gets its own fair shot.
async function searchBooks(query, maxResults = 20) {
  const googlePromise = searchGoogleBooks(query, maxResults)
  const openLibPromise = searchOpenLibrary(query, maxResults)
  openLibPromise.catch(() => {}) // avoid "unhandled rejection" if Google succeeds and we never touch this
  try {
    const results = await googlePromise
    if (results.length > 0) return { results, source: 'google' }
    // Google returned empty — use whatever Open Library comes back with
    const olResults = await openLibPromise
    return { results: olResults, source: 'openlibrary' }
  } catch (googleErr) {
    console.warn('Google Books failed, trying Open Library:', googleErr.message)
    try {
      const olResults = await openLibPromise
      return { results: olResults, source: 'openlibrary' }
    } catch (olErr) {
      throw new Error('Both search providers failed. Check your connection.')
    }
  }
}

function parseVolume(item) {
  const v = item.volumeInfo || {}
  const cover = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null
  return {
    id:             item.id,
    title:          v.title || 'Unknown Title',
    authors:        v.authors || [],
    description:    v.description || '',
    cover_url:      cover ? cover.replace(/^http:/, 'https:') : null,
    categories:     v.categories || [],
    published_date: v.publishedDate || '',
    page_count:     v.pageCount || null,
    isbn:           v.industryIdentifiers?.find(i => i.type === 'ISBN_13')?.identifier || null,
    publisher:      v.publisher || null,
    subtitle:       v.subtitle || null,
    average_rating: v.averageRating || null,
    ratings_count:  v.ratingsCount || null,
  }
}

// The same real-world book can end up as multiple `books` rows with different
// IDs — a Google Books volume ID, an Open Library `ol_...` ID, or a hash ID
// generated during CSV import — depending on how it was added. ID-only
// matching then misses "this is already on my shelf" whenever a friend's copy
// (or a Discover result) was added via a different source than yours.
//
// A plain title+author string match isn't reliable enough either: providers
// disagree on whether a subtitle lives in `title` ("Barbarian Days: A Surfing
// Life") or gets dropped/moved to `subtitle`, and author strings vary in
// formatting. So normalization strips subtitles/punctuation, and matching
// falls back to "one normalized title starts with/contains the other" plus a
// same-last-name author check, rather than requiring an exact string match.
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .split(':')[0]                 // drop ": A Subtitle Like This"
    .replace(/[^a-z0-9 ]/g, ' ')    // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

function authorLastName(author) {
  const parts = (author || '').trim().split(/\s+/).filter(Boolean)
  return (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '')
}

function bookKey(book) {
  const title = normalizeTitle(book?.title)
  if (!title) return null
  return `${title}|${authorLastName(book?.authors?.[0])}`
}

function titlesAreClose(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length < 4) return false // too short to safely fuzzy-match
  return longer.startsWith(shorter) || longer.includes(` ${shorter}`) || shorter.includes(longer)
}

// `myBooks` (optional) is the user's own book list, used only as a fuzzy
// fallback when the exact normalized key doesn't match — e.g. one source has
// the subtitle folded into the title and the other doesn't.
function isInMyLibrary(book, myBookIds, myBookKeys, myBooks) {
  if (!book) return false
  if (myBookIds?.has(book.id)) return true
  const key = bookKey(book)
  if (key && myBookKeys?.has(key)) return true
  if (myBooks?.length) {
    const title = normalizeTitle(book.title)
    const author = authorLastName(book.authors?.[0])
    if (title) {
      for (const mb of myBooks) {
        if (authorLastName(mb?.authors?.[0]) !== author) continue
        if (titlesAreClose(title, normalizeTitle(mb?.title))) return true
      }
    }
  }
  return false
}

async function upsertBook(book) {
  const { error } = await supabase.from('books').upsert({
    id: book.id, title: book.title, authors: book.authors,
    description: book.description, cover_url: book.cover_url,
    categories: book.categories, published_date: book.published_date,
    page_count: book.page_count, isbn: book.isbn,
    publisher: book.publisher || null, subtitle: book.subtitle || null,
    average_rating: book.average_rating || null, ratings_count: book.ratings_count || null,
  }, { onConflict: 'id' })
  // This used to only console.error and swallow the failure, which let
  // callers march on to insert into user_books anyway — and THAT insert
  // would then fail with a confusing foreign-key-violation instead of the
  // real underlying reason the book row itself couldn't be saved.
  if (error) { console.error('upsertBook:', error); throw error }
}

// Want to Read is a user-ordered queue (drag-to-reorder sorts by `position`
// ascending). New entries need to land at the END of that order, not jump to
// the front — so look up the current highest position and add one.
async function nextWantToReadPosition(userId) {
  const { data } = await supabase.from('user_books').select('position')
    .eq('user_id', userId).eq('status', 'want_to_read')
    .order('position', { ascending: false }).limit(1).maybeSingle()
  return (data?.position ?? -1) + 1
}

async function addToLibrary(userId, book, status) {
  await upsertBook(book)
  const position = status === 'want_to_read' ? await nextWantToReadPosition(userId) : 0
  const { data, error } = await supabase.from('user_books').upsert({
    user_id: userId, book_id: book.id, status, position,
  }, { onConflict: 'user_id,book_id' }).select().single()
  if (error) throw error
  return data
}

// ─── Constants ────────────────────────────────────────────────────
const STATUS_LABELS = { reading: 'Reading', read: 'Read', want_to_read: 'Want to Read' }
const STATUS_ICONS  = { reading: '▶', read: '✅', want_to_read: '👀' }
const STATUS_COLORS = {
  reading:      { bg: '#1a2a3d', color: '#60a5fa' },   // blue
  read:         { bg: '#1a3a2a', color: '#34d399' },   // green
  want_to_read: { bg: '#2a1a0a', color: '#f0b429' },   // orange
}

// Curated stand-ins for NYT-style "Picks" lists — no API key required.
// Swap these for real NYT Books API lists later if a key is added.
const PICKS_LISTS = [
  { key: 'best_of_year',  label: 'Best of the Year',   query: 'best books of the year award winning' },
  { key: 'summer_reads',  label: 'Summer Reads',       query: 'best summer beach reads fiction' },
  { key: 'award_winners', label: 'Award Winners',      query: 'pulitzer prize national book award winner' },
  { key: 'staff_picks',   label: 'Staff Picks',        query: 'must read contemporary fiction acclaimed' },
]

// Top N most common categories across a set of books (for dynamic genre filter pills)
// Google Books / Open Library categories are messy BISAC/folksonomy strings
// ("Business & Economics / Marketing", "health", "juvenile fiction"…). Normalize
// them down to a small set of high-level genres for filter pills. Ordered from
// most to least specific — first match wins.
const GENRE_RULES = [
  ['true crime',            'True Crime'],
  ['biography',             'Biography & Memoir'],
  ['memoir',                'Biography & Memoir'],
  ['business',              'Business'],
  ['marketing',             'Business'],
  ['econom',                'Business'],
  ['management',            'Business'],
  ['finance',               'Business'],
  ['investing',             'Business'],
  ['health',                'Health & Wellness'],
  ['fitness',               'Health & Wellness'],
  ['diet',                  'Health & Wellness'],
  ['nutrition',             'Health & Wellness'],
  ['self-help',             'Self-Help'],
  ['self help',             'Self-Help'],
  ['personal growth',       'Self-Help'],
  ['history',               'History'],
  ['mystery',                'Mystery & Thriller'],
  ['thriller',              'Mystery & Thriller'],
  ['crime',                 'Mystery & Thriller'],
  ['detective',             'Mystery & Thriller'],
  ['romance',               'Romance'],
  ['fantasy',               'Fantasy & Sci-Fi'],
  ['science fiction',       'Fantasy & Sci-Fi'],
  ['sci-fi',                'Fantasy & Sci-Fi'],
  ['dystopia',              'Fantasy & Sci-Fi'],
  ['young adult',           'Young Adult'],
  ['juvenile',              'Young Adult'],
  ['children',              "Children's"],
  ['picture book',          "Children's"],
  ['poetry',                'Poetry'],
  ['religio',               'Religion & Spirituality'],
  ['spiritual',             'Religion & Spirituality'],
  ['christian',             'Religion & Spirituality'],
  ['faith',                 'Religion & Spirituality'],
  ['cook',                  'Cooking & Food'],
  ['culinary',              'Cooking & Food'],
  ['travel',                'Travel'],
  ['art',                   'Art & Design'],
  ['design',                'Art & Design'],
  ['photograph',            'Art & Design'],
  ['comic',                 'Comics & Graphic Novels'],
  ['graphic novel',         'Comics & Graphic Novels'],
  ['manga',                 'Comics & Graphic Novels'],
  ['politic',               'Politics & Current Affairs'],
  ['current affairs',       'Politics & Current Affairs'],
  ['government',            'Politics & Current Affairs'],
  ['science',               'Science & Nature'],
  ['nature',                'Science & Nature'],
  ['technology',            'Science & Nature'],
  ['sport',                 'Sports'],
  ['humor',                 'Humor'],
  ['comedy',                'Humor'],
  ['philosoph',             'Philosophy'],
  ['literary',              'Literary Fiction'],
  ['classics',              'Literary Fiction'],
  ['fiction',               'Fiction'], // generic catch-all — keep last among fiction rules
]

// Genre labels (from GENRE_RULES above) that count as non-fiction for the
// Fiction vs Non-Fiction stat breakdown on the Profile tab.
const NONFICTION_GENRES = new Set([
  'True Crime', 'Biography & Memoir', 'Business', 'Health & Wellness', 'Self-Help',
  'History', 'Religion & Spirituality', 'Travel', 'Art & Design',
  'Politics & Current Affairs', 'Science & Nature', 'Sports', 'Philosophy',
  'Cooking & Food',
])

function normalizeGenre(raw) {
  const s = (raw || '').toLowerCase()
  for (const [key, label] of GENRE_RULES) {
    if (s.includes(key)) return label
  }
  return null // deliberately unmapped — too niche/unrecognized to show as a filter pill
}

function bookGenres(book) {
  const out = new Set()
  ;(book?.categories || []).forEach(c => {
    const g = normalizeGenre(c)
    if (g) out.add(g)
  })
  return [...out]
}

function topCategories(books, n = 8) {
  const counts = {}
  books.forEach(b => bookGenres(b).forEach(g => { counts[g] = (counts[g] || 0) + 1 }))
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([g]) => g)
}

// Taste-match % between two readers — genre-overlap (cosine similarity) weighted
// heaviest, plus a small bonus for books they've both actually shelved.
function computeTasteMatch(myBooks, friendBooks) {
  if (!myBooks?.length || !friendBooks?.length) return 0
  const genreCounts = (list) => {
    const counts = {}
    list.forEach(ub => bookGenres(ub.books).forEach(g => { counts[g] = (counts[g] || 0) + 1 }))
    return counts
  }
  const mine   = genreCounts(myBooks)
  const theirs = genreCounts(friendBooks)
  const genres = new Set([...Object.keys(mine), ...Object.keys(theirs)])

  let sim = 0
  if (genres.size > 0) {
    let dot = 0, magA = 0, magB = 0
    genres.forEach(g => {
      const a = mine[g] || 0, b = theirs[g] || 0
      dot += a * b; magA += a * a; magB += b * b
    })
    if (magA > 0 && magB > 0) sim = dot / (Math.sqrt(magA) * Math.sqrt(magB))
  }

  const myIds  = new Set(myBooks.map(u => u.book_id))
  const shared = friendBooks.filter(u => myIds.has(u.book_id)).length
  const bonus  = Math.min(shared * 3, 20)

  const pct = Math.round(sim * 100 * 0.8 + bonus)
  return Math.max(0, Math.min(100, pct))
}

// Discover page filter-tier definitions
const FRIENDS_FILTERS = [
  ['all', 'All'],
  ['reading', `${STATUS_ICONS.reading} Reading`],
  ['want_to_read', `${STATUS_ICONS.want_to_read} Want to Read`],
  ['highly_rated', '⭐ Highly Rated'],
  ['recent', '🕐 Recent'],
]
const RECOMMENDED_FILTERS = [
  ['all', 'All'],
  ['from_friend', '💌 From a Friend'],
  ['highly_rated', '⭐ Highly Rated by Friends'],
]
const PICKS_FILTERS = [['all', 'All'], ...PICKS_LISTS.map(l => [l.key, l.label])]

const LITERARY_EMOJIS = [
  // Literary / book themed
  '📚','📖','🔖','✒️','🖋️','✏️','📝','📜','🗺️','🧭',
  '🏛️','🦉','🔍','💌','🕯️','☕','👑','🏰','🐉','🧙',
  '🌙','🌿','⭐','🔭','🎭','🧝','🦁','🌺','🍎','⚔️',
  '🎩','🕵️','🦸','🧚','🌊','🏔️','🌲','🌹','🎪','🌟',
  '🔮','🐺','🦅','🌴','⚗️','🗡️','🏺','🧪','🎠','🌻',
  '🦋','🐦','🌈','🎶','🌸','🍊','🍏',
  // Fun / pop culture
  '⚖️','🪭','🇺🇸','🔪','💵','💰','🎞️','📼','💿',
  '🤡','🧉','👏','🤣','😍','😯','😘','👍',
]

// Responsive breakpoint hook
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return isMobile
}

// Drag-to-reorder — two independent mechanisms sharing one visual state:
//   1. Native HTML5 drag-and-drop on the whole tile — mouse/desktop, exactly
//      like the original working version. Touch devices never fire these
//      events at all, so this path is completely inert on phones.
//   2. A small grip handle using Pointer Events — touch/mobile. Isolating
//      touch-action:none to just the handle (rather than the whole tile)
//      matters because touch-action is decided by the browser at the START
//      of a touch gesture and can't change mid-gesture, so a scrollable tile
//      would otherwise win the gesture the instant a finger moves.
// Commit logic reads from refs (not state) so it's never working off a stale
// closure regardless of which path fired last.
function useDragReorder(items, onReorder) {
  const [dragIdx, setDragIdxState] = useState(null)
  const [overIdx, setOverIdxState] = useState(null)
  const dragIdxRef = useRef(null)
  const overIdxRef = useRef(null)
  const activePointerId = useRef(null)

  function setDragIdx(v) { dragIdxRef.current = v; setDragIdxState(v) }
  function setOverIdx(v) { overIdxRef.current = v; setOverIdxState(v) }

  function reorderTo(fromIdx, toIdx) {
    if (fromIdx == null || toIdx == null || fromIdx === toIdx) return
    const arr = items.slice()
    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, moved)
    onReorder(arr)
  }

  // ---- Desktop: native HTML5 drag-and-drop on the whole tile ----
  function onDragStart(e, idx) { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }
  function onDragOver(e, idx)  { e.preventDefault(); if (idx !== overIdxRef.current) setOverIdx(idx) }
  function onDrop(e, idx) {
    e.preventDefault()
    reorderTo(dragIdxRef.current, idx)
    setDragIdx(null); setOverIdx(null)
  }
  function onDragEnd() { setDragIdx(null); setOverIdx(null) }

  function nativeDragProps(idx) {
    return {
      draggable: true,
      onDragStart: (e) => onDragStart(e, idx),
      onDragOver: (e) => onDragOver(e, idx),
      onDrop: (e) => onDrop(e, idx),
      onDragEnd,
    }
  }

  // ---- Mobile: press the grip handle and drag with a finger ----
  function onHandlePointerDown(e, idx) {
    if (e.pointerType === 'mouse') return // desktop already has native DnD on the tile
    e.preventDefault()
    activePointerId.current = e.pointerId
    setDragIdx(idx); setOverIdx(idx)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
  function onHandlePointerMove(e) {
    if (activePointerId.current !== e.pointerId) return
    e.preventDefault()
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const target = el?.closest?.('[data-drag-idx]')
    if (target) {
      const ti = parseInt(target.getAttribute('data-drag-idx'), 10)
      if (!Number.isNaN(ti)) setOverIdx(ti)
    }
  }
  function finishHandle(e) {
    if (activePointerId.current !== e.pointerId) return
    activePointerId.current = null
    reorderTo(dragIdxRef.current, overIdxRef.current)
    setDragIdx(null); setOverIdx(null)
  }

  function handleBind(idx) {
    return {
      onPointerDown: (e) => onHandlePointerDown(e, idx),
      onPointerMove: onHandlePointerMove,
      onPointerUp: finishHandle,
      onPointerCancel: finishHandle,
      style: { touchAction: 'none' },
    }
  }
  // Spread onto the outer tile wrapper so hit-testing can resolve which
  // tile the pointer is currently over while dragging.
  function tileProps(idx) {
    return { 'data-drag-idx': idx }
  }

  return { dragIdx, overIdx, nativeDragProps, handleBind, tileProps }
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`
  return new Date(dateStr).toLocaleDateString()
}

// ================================================================
// Small shared components
// ================================================================

function StatusBadge({ status, size = 'sm' }) {
  const sc = STATUS_COLORS[status] || {}
  return (
    <span style={{
      fontSize: size === 'sm' ? 10 : 12, padding: size === 'sm' ? '2px 7px' : '3px 10px',
      borderRadius: 20, fontFamily: f.sans, fontWeight: 700, letterSpacing: '0.03em', ...sc,
    }}>
      {STATUS_ICONS[status]} {STATUS_LABELS[status] || status}
    </span>
  )
}

function StarRating({ value, onChange, readonly = false, size = 16 }) {
  const [hover, setHover] = useState(0)
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1,2,3,4,5].map(n => (
        <span key={n}
          onClick={() => !readonly && onChange?.(n === value ? null : n)}
          onMouseEnter={() => !readonly && setHover(n)}
          onMouseLeave={() => !readonly && setHover(0)}
          style={{
            fontSize: size, lineHeight: 1, userSelect: 'none',
            cursor: readonly ? 'default' : 'pointer',
            color: n <= (hover || value || 0) ? C.star : C.border,
            transition: 'color 0.1s',
          }}>★</span>
      ))}
    </span>
  )
}

function NoCover({ title, width = 120, height = 180 }) {
  return (
    <div style={{
      width, height, borderRadius: 8, flexShrink: 0,
      background: `linear-gradient(135deg, ${C.surface2} 0%, ${C.primaryDim} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(height * 0.25), color: C.muted, userSelect: 'none',
    }}>📖</div>
  )
}

function Spinner({ text = 'Loading…' }) {
  return (
    <p style={{ color: C.muted, fontFamily: f.sans, textAlign: 'center', padding: '32px 0', fontSize: 14 }}>
      {text}
    </p>
  )
}

function EmptyState({ icon = '📚', message, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 24px', color: C.muted }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>{icon}</div>
      <p style={{ margin: '0 0 6px', fontSize: 16, fontFamily: f.serif, color: C.text }}>{message}</p>
      {sub && <p style={{ margin: 0, fontSize: 13, fontFamily: f.sans }}>{sub}</p>}
    </div>
  )
}

// ================================================================
// PosterCard – book cover tile used everywhere
// ================================================================
function PosterCard({ book, userBook, onClick, width, height, quickActions }) {
  const [hovered, setHovered] = useState(false)
  const touchStartRef = useRef(null)
  const isMobile = useIsMobile()
  if (width == null)  width  = isMobile ? 106 : 120
  if (height == null) height = isMobile ? 159 : 180
  const cover = book?.cover_url || userBook?.books?.cover_url || null
  const title = book?.title || userBook?.books?.title || ''
  const authors = book?.authors || userBook?.books?.authors || []
  const status = userBook?.status

  // iOS Safari: track touch position to distinguish tap vs scroll
  function onTouchStart(e) {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  function onTouchEnd(e) {
    if (!touchStartRef.current) return
    const dx = Math.abs(e.changedTouches[0].clientX - touchStartRef.current.x)
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y)
    if (dx < 10 && dy < 10) { e.preventDefault(); onClick?.() }
    touchStartRef.current = null
  }

  return (
    <div
      className="poster-card"
      tabIndex={0}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={e => e.key === 'Enter' && onClick?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width, flexShrink: 0, position: 'relative', cursor: 'pointer', borderRadius: 8,
        transform: hovered ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform 0.18s ease',
        boxShadow: hovered ? '0 8px 32px rgba(0,0,0,0.5)' : '0 2px 10px rgba(0,0,0,0.3)',
        WebkitTapHighlightColor: 'transparent',
        userSelect: 'none',
      }}
    >
      {cover
        ? <img src={cover} alt={title}
            style={{ width, height, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
        : <NoCover title={title} width={width} height={height} />
      }

      {/* Quick-action icons — pinned on the tile, replaces title text for shelf tiles */}
      {quickActions?.length > 0 ? (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '0 0 8px 8px',
          background: 'linear-gradient(transparent, rgba(10,8,24,0.85))',
          padding: '20px 6px 8px',
          display: 'flex', justifyContent: 'center', gap: 8,
        }}>
          {quickActions.map((a, i) => (
            <button key={i} title={a.title}
              onClick={(e) => { e.stopPropagation(); a.onClick() }}
              style={{
                width: 30, height: 30, borderRadius: '50%', border: 'none',
                background: a.bg, color: a.fg || '#0f1117', cursor: 'pointer',
                fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)', flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
              }}>
              {a.icon}
            </button>
          ))}
        </div>
      ) : (
        /* Title overlay — hidden until hover when there's cover art; always shown on no-cover (purple) tiles */
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '0 0 8px 8px',
          background: 'linear-gradient(transparent, rgba(10,8,24,0.95))',
          padding: '28px 8px 8px',
          opacity: (hovered || !cover) ? 1 : 0,
          transition: 'opacity 0.18s',
          pointerEvents: 'none',
        }}>
          <p style={{
            margin: '0 0 2px', fontSize: 11, fontWeight: 700, color: C.white,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: f.sans,
          }}>{title}</p>
          <p style={{
            margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: f.sans,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{authors.slice(0,1).join(', ')}</p>
        </div>
      )}
    </div>
  )
}

// ================================================================
// SearchResultCard – poster + quick-add buttons for search
// ================================================================
function SearchResultCard({ book, userId, myBookIds, onAdded, onOpenModal }) {
  const isMobile = useIsMobile()
  const [hovered, setHovered] = useState(false)
  const [adding,  setAdding]  = useState(null)
  const [added,   setAdded]   = useState(null)
  const [showRatingPopup, setShowRatingPopup] = useState(false)
  const hideTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])
  const isInLibrary = myBookIds?.has(book.id) || !!added

  async function handleAdd(status) {
    setAdding(status)
    try {
      await addToLibrary(userId, book, status)
      setAdded(status)
      onAdded?.(book.id)
      if (status === 'read') setShowRatingPopup(true)
    } catch (e) {
      alert('Could not add book: ' + e.message)
    }
    setAdding(null)
  }

  async function handleRated(stars) {
    await supabase.from('user_books')
      .update({ rating: stars })
      .eq('user_id', userId).eq('book_id', book.id)
    setShowRatingPopup(false)
  }

  // Mobile has no hover — tap reveals the action icons for a couple seconds,
  // then they auto-hide (matches WatchList). Tapping again while revealed opens the modal.
  function handleTileTap() {
    if (isMobile && !isInLibrary && !hovered) {
      setHovered(true)
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => setHovered(false), 2500)
      return
    }
    onOpenModal?.()
  }

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      {showRatingPopup && (
        <RatingPopup title={book.title} onRate={handleRated} onSkip={() => setShowRatingPopup(false)} />
      )}
      <PosterCard book={book} onClick={handleTileTap} />

      {/* Hover overlay — icons only for books not already on any shelf */}
      {hovered && (
        <div onClick={onOpenModal} style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          background: 'rgba(10,8,24,0.72)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'flex-end',
          paddingBottom: 14,
        }}>
          {isInLibrary ? (
            <div onClick={onOpenModal} style={{
              background: STATUS_COLORS[added]?.bg || 'rgba(52,211,153,0.15)', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, color: STATUS_COLORS[added]?.color || C.success,
              fontFamily: f.sans, fontWeight: 700, cursor: 'pointer',
            }}>
              {STATUS_ICONS[added]} {STATUS_LABELS[added] || 'In library'}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }} onClick={e => e.stopPropagation()}>
              {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
                <button key={key} title={lbl} disabled={!!adding}
                  onClick={() => handleAdd(key)}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: 'none',
                    background: STATUS_COLORS[key]?.color || C.primary,
                    color: '#0f1117',
                    cursor: adding ? 'not-allowed' : 'pointer', fontSize: 14,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    opacity: adding && adding !== key ? 0.5 : 1,
                    transition: 'transform 0.1s, opacity 0.1s',
                    transform: adding === key ? 'scale(0.9)' : 'scale(1)',
                  }}>
                  {adding === key ? '…' : STATUS_ICONS[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ================================================================
// AddTile / SectionBadge / CountPill – WatchList-style row chrome
// ================================================================
function AddTile({ onClick, label = 'Add', width, height }) {
  const isMobile = useIsMobile()
  if (width == null)  width  = isMobile ? 106 : 120
  if (height == null) height = isMobile ? 159 : 180
  return (
    <button onClick={onClick} style={{
      width, height, flexShrink: 0, borderRadius: 8,
      border: `2px dashed ${C.border}`, background: 'transparent',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 6, cursor: 'pointer', color: C.muted, fontFamily: f.sans,
      WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ fontSize: 26, lineHeight: 1 }}>+</span>
      <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', padding: '0 6px' }}>{label}</span>
    </button>
  )
}

function SectionBadge({ icon, bg, title }) {
  const [show, setShow] = useState(false)
  const hideTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])
  return (
    <span
      onMouseEnter={() => title && setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => {
        if (!title) return
        e.stopPropagation()
        e.preventDefault()
        setShow(true)
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = setTimeout(() => setShow(false), 3000)
      }}
      style={{
        position: 'relative',
        width: 26, height: 26, borderRadius: '50%', background: bg || C.primary,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, flexShrink: 0, color: C.white, cursor: title ? 'help' : 'default',
      }}>
      {icon}
      {show && title && (
        <span style={{
          position: 'absolute', top: '130%', left: '50%', transform: 'translateX(-50%)',
          background: C.surface, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 500,
          fontFamily: f.sans, whiteSpace: 'normal', width: 220, textAlign: 'left',
          lineHeight: 1.4, zIndex: 60, boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}>{title}</span>
      )}
    </span>
  )
}

// Taste-match ring — circular progress ring around a friend's avatar, filled
// by reading-taste similarity %, with the % shown in a pill beneath.
function TasteMatchRing({ pct, avatar, size = 52 }) {
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100)
  const color = pct >= 60 ? C.success : pct >= 35 ? C.accent : C.muted
  return (
    <div style={{ position: 'relative', width: size, height: size + 10, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s' }} />
      </svg>
      <div style={{
        position: 'absolute', top: stroke + 2, left: stroke + 2, right: stroke + 2, bottom: stroke + 12,
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${C.primaryDim}, ${C.surface2})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.42, border: `2px solid ${C.border}`,
      }}>{avatar || '👤'}</div>
      <div style={{
        position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        background: color, color: '#0f1117', fontSize: 10, fontWeight: 800,
        padding: '1px 6px', borderRadius: 10, fontFamily: f.sans, whiteSpace: 'nowrap',
      }}>{pct}%</div>
    </div>
  )
}

function CountPill({ n }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, color: C.muted, background: C.surface2,
      borderRadius: 20, padding: '2px 9px', fontFamily: f.sans,
    }}>{n}</span>
  )
}

// Collapsible accordion row — WatchList-style Friends page sections
function Accordion({ icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{
      background: C.surface, borderRadius: 10,
      marginBottom: 10, overflow: 'hidden',
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'none', border: 'none', cursor: 'pointer', padding: '16px 18px',
        fontFamily: f.sans,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 14, color: C.text }}>
          {icon} {title}
        </span>
        <span style={{
          color: C.muted, fontSize: 12, transition: 'transform 0.15s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 18px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ================================================================
// HorizontalRow – scrollable shelf row
// ================================================================
function HorizontalRow({ title, icon, iconBg, tooltip, items, renderItem, emptyMsg, loading, seeAllAction, onAdd, addLabel = 'Add', rightAction, belowHeader }) {
  const isMobile = useIsMobile()
  const Header = seeAllAction ? 'button' : 'div'
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <Header onClick={seeAllAction} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'none', border: 'none', padding: 0, margin: 0,
          cursor: seeAllAction ? 'pointer' : 'default', fontFamily: f.sans,
        }}>
          {icon && <SectionBadge icon={icon} bg={iconBg} title={tooltip} />}
          <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>
            {title}
          </h2>
          <CountPill n={items.length} />
          {seeAllAction && <span style={{ color: C.muted, fontSize: 15 }}>›</span>}
        </Header>
        {rightAction}
      </div>
      {belowHeader}
      {loading ? <Spinner /> : (
        <div style={{
          display: 'flex', gap: isMobile ? 9 : 12, overflowX: 'auto', paddingBottom: 8,
          paddingRight: 20,
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}>
          {onAdd && <AddTile onClick={onAdd} label={addLabel} />}
          {items.length === 0
            ? (!onAdd && (
                <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
                  {emptyMsg}
                </p>
              ))
            : items.map(renderItem)}
        </div>
      )}
    </div>
  )
}

// ================================================================
// RatingPopup – appears after marking a book as Read
// ================================================================
function RatingPopup({ title, onRate, onSkip }) {
  const [hovered, setHovered] = useState(0)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onSkip() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  return (
    <div onClick={(e) => e.target === e.currentTarget && onSkip()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(5,4,15,0.88)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
      <div style={{
        background: C.surface, borderRadius: 14, padding: 32, maxWidth: 360, width: '100%',
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <h3 style={{ margin: '0 0 6px', color: C.text, fontFamily: f.serif, fontSize: 20 }}>
          Finished it!
        </h3>
        <p style={{ margin: '0 0 20px', color: C.muted, fontFamily: f.sans, fontSize: 14 }}>
          How would you rate <em style={{ color: C.text }}>{title}</em>?
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
          {[1,2,3,4,5].map(n => (
            <span key={n}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setSelected(n)}
              style={{
                fontSize: 36, cursor: 'pointer', userSelect: 'none',
                color: n <= (hovered || selected) ? C.star : C.border,
                transition: 'color 0.1s, transform 0.1s',
                transform: n <= (hovered || selected) ? 'scale(1.15)' : 'scale(1)',
                display: 'inline-block',
              }}>★</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => selected ? onRate(selected) : onSkip()}
            style={{ ...btn(selected ? 'accent' : 'subtle'), minWidth: 100 }}>
            {selected ? `Save ${selected}★` : 'Skip'}
          </button>
          {selected > 0 && (
            <button onClick={onSkip} style={btn('subtle', 'sm')}>Skip</button>
          )}
        </div>
      </div>
    </div>
  )
}

// "You finished it!" wizard — WatchList-style: one step at a time
// (Rate → Notes → Fave → Recommend), each step saving immediately and
// auto-advancing, instead of asking for just a rating and stopping.
function FinishedReadingPopup({ title, initialRating, shareFriends, sentTo, linkCopied, onSaveRating, onSaveNotes, onSaveFave, onShareFriend, onShareLink, onFinish }) {
  const [step,      setStep]     = useState(0) // 0 rate · 1 notes · 2 fave · 3 recommend
  const [hovered,   setHovered]  = useState(0)
  const [selected,  setSelected] = useState(initialRating || 0)
  const [savedFlash, setSavedFlash] = useState(false)
  const [notes,     setNotes]    = useState('')
  const [faveOn,    setFaveOn]   = useState(false)
  const [busy,      setBusy]     = useState(false)
  const [recommendMode, setRecommendMode] = useState(null) // null · 'friends' · 'link' · 'both'

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onFinish() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFinish])

  function next() { setStep(s => s + 1) }

  async function pickStar(n) {
    setSelected(n)
    setBusy(true)
    await onSaveRating(n)
    setBusy(false)
    setSavedFlash(true)
    setTimeout(() => { setSavedFlash(false); next() }, 700)
  }

  async function saveNotesAndContinue() {
    setBusy(true)
    if (notes.trim()) await onSaveNotes(notes.trim())
    setBusy(false)
    next()
  }

  async function addFaveAndContinue() {
    setBusy(true)
    await onSaveFave()
    setFaveOn(true)
    setBusy(false)
    setTimeout(next, 500)
  }

  const pillBtn = (variant = 'primary') => ({
    display: 'block', width: '100%', textAlign: 'center',
    padding: '16px 20px', borderRadius: 14, cursor: 'pointer', border: 'none',
    fontFamily: f.sans, fontSize: 15, fontWeight: 700, marginBottom: 12,
    background: variant === 'primary' ? C.primary : C.surface2,
    color: variant === 'primary' ? C.white : C.text,
  })

  return (
    <div onClick={(e) => e.target === e.currentTarget && onFinish()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(5,4,15,0.88)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
      <div style={{
        background: C.surface, borderRadius: 18, padding: '36px 28px', maxWidth: 380, width: '100%',
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        textAlign: 'center', maxHeight: '90vh', overflowY: 'auto',
      }}>
        {step === 0 && (
          <>
            <p style={{ margin: '0 0 4px', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>You finished</p>
            <h3 style={{ margin: '0 0 22px', color: C.text, fontFamily: f.serif, fontSize: 20 }}>
              <em>{title}</em>
            </h3>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(0)}
                  onClick={() => !busy && pickStar(n)}
                  style={{
                    fontSize: 38, cursor: busy ? 'default' : 'pointer', userSelect: 'none',
                    color: n <= (hovered || selected) ? C.star : C.border,
                    transition: 'color 0.1s, transform 0.1s',
                    transform: n <= (hovered || selected) ? 'scale(1.12)' : 'scale(1)',
                    display: 'inline-block',
                  }}>★</span>
              ))}
            </div>
            <p style={{ margin: 0, height: 20, color: C.success, fontFamily: f.sans, fontSize: 14, fontWeight: 700 }}>
              {savedFlash ? `${selected}/5 saved!` : ' '}
            </p>
            <button onClick={next} style={{ ...btn('subtle', 'sm'), marginTop: 14 }}>Skip</button>
          </>
        )}

        {step === 1 && (
          <>
            <h3 style={{ margin: '0 0 4px', color: C.text, fontFamily: f.serif, fontSize: 20 }}>Add a note?</h3>
            <p style={{ margin: '0 0 18px', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
              Jot down your thoughts on <em style={{ color: C.text }}>{title}</em>
            </p>
            <textarea
              autoFocus
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="What did you think?"
              rows={3}
              style={{ ...inputStyle, marginBottom: 16, resize: 'vertical', fontFamily: f.sans, fontSize: 13, textAlign: 'left' }}
            />
            <button onClick={saveNotesAndContinue} disabled={busy} style={pillBtn('primary')}>
              {notes.trim() ? 'Save & Continue' : 'Continue'}
            </button>
            <button onClick={next} style={btn('subtle', 'sm')}>Skip</button>
          </>
        )}

        {step === 2 && (
          <>
            <h3 style={{ margin: '0 0 4px', color: C.text, fontFamily: f.serif, fontSize: 20 }}>Add to your Top 10?</h3>
            <p style={{ margin: '0 0 18px', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
              Mark <em style={{ color: C.text }}>{title}</em> as one of your favorites
            </p>
            <button onClick={addFaveAndContinue} disabled={busy || faveOn} style={pillBtn('primary')}>
              {faveOn ? '🏆 Added!' : '⭐ Add to Top 10'}
            </button>
            <button onClick={next} style={btn('subtle', 'sm')}>Skip</button>
          </>
        )}

        {step === 3 && (
          <>
            <h3 style={{ margin: '0 0 4px', color: C.text, fontFamily: f.serif, fontSize: 20 }}>Recommend it?</h3>
            <p style={{ margin: '0 0 18px', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
              Share <em style={{ color: C.text }}>{title}</em> with friends
            </p>

            {recommendMode === null && (
              <>
                <button onClick={() => setRecommendMode('friends')} style={pillBtn('primary')}>
                  👥 Send to friends in BookList
                </button>
                <button onClick={() => { onShareLink(); setRecommendMode('link') }} style={pillBtn('subtle')}>
                  🔗 Share a link (anyone can click)
                </button>
                <button onClick={() => { onShareLink(); setRecommendMode('both') }} style={pillBtn('subtle')}>
                  ✨ Both
                </button>
              </>
            )}

            {(recommendMode === 'link') && (
              <p style={{ fontSize: 13, color: C.success, fontFamily: f.sans, fontWeight: 700, marginBottom: 16 }}>
                {linkCopied ? '🔗 Link copied — paste it anywhere!' : 'Opening your share sheet…'}
              </p>
            )}

            {(recommendMode === 'friends' || recommendMode === 'both') && (
              <>
                {recommendMode === 'both' && linkCopied && (
                  <p style={{ fontSize: 13, color: C.success, fontFamily: f.sans, fontWeight: 700, marginBottom: 12 }}>
                    🔗 Link copied — paste it anywhere!
                  </p>
                )}
                {shareFriends === null ? (
                  <p style={{ fontSize: 13, color: C.muted, fontFamily: f.sans, fontStyle: 'italic', marginBottom: 16 }}>
                    Loading friends…
                  </p>
                ) : shareFriends.length === 0 ? (
                  <p style={{ fontSize: 13, color: C.muted, fontFamily: f.sans, fontStyle: 'italic', marginBottom: 16 }}>
                    No friends yet
                  </p>
                ) : (
                  <div style={{ marginBottom: 4 }}>
                    {shareFriends.map(fr => {
                      const already = sentTo?.has(fr.id)
                      return (
                        <button key={fr.id} disabled={already}
                          onClick={() => onShareFriend(fr.id)}
                          style={{
                            ...pillBtn(already ? 'subtle' : 'primary'),
                            cursor: already ? 'default' : 'pointer',
                            opacity: already ? 0.6 : 1,
                          }}>
                          {already ? `✓ Sent to ${fr.display_name || fr.username}` : `👤 Send to ${fr.display_name || fr.username}`}
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            <button onClick={onFinish} style={{ ...btn('subtle', 'sm'), marginTop: 8 }}>
              {recommendMode === null ? 'Skip' : 'Done'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ================================================================
// BookDetailModal – full info overlay
// ================================================================
// WatchList-style action box: icon + label, optional badge, used in BookDetailModal
function ActionBox({ icon, label, badge, sub, active, activeColor, danger, onClick }) {
  const accentColor = activeColor || C.primary
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: '10px 4px', borderRadius: 10, cursor: 'pointer', position: 'relative',
      background: active ? `${accentColor}22` : C.surface2,
      border: `1px solid ${danger ? C.danger : active ? accentColor : C.border}`,
      color: danger ? C.danger : active ? accentColor : C.text,
      fontFamily: f.sans, WebkitTapHighlightColor: 'transparent',
    }}>
      {badge != null && (
        <span style={{
          position: 'absolute', top: -7, right: -6, background: C.accent, color: '#0f1117',
          fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 18, height: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
        }}>{badge}</span>
      )}
      <span style={{ fontSize: 17 }}>{icon}</span>
      <span style={{
        fontSize: 10, fontWeight: active ? 800 : 700, textTransform: 'uppercase', letterSpacing: '0.04em',
        color: active ? accentColor : undefined,
      }}>{label}</span>
      {sub && <span style={{ display: 'flex', alignItems: 'center', gap: 3, lineHeight: 1 }}>{sub}</span>}
    </button>
  )
}

function BookDetailModal({ item, userId, onClose, onUpdate }) {
  const isMobile = useIsMobile()
  const isLibraryBook = !!item?.user_id
  const book = isLibraryBook ? (item.books || {}) : item
  const userBook = isLibraryBook ? item : null

  const [status,       setStatus]       = useState(userBook?.status || '')
  const [rating,       setRating]       = useState(userBook?.rating || null)
  const [notes,        setNotes]        = useState(userBook?.notes || '')
  const [top10,        setTop10]        = useState(userBook?.top_10 || false)
  const [userBookId,   setUserBookId]   = useState(userBook?.id || null)
  const [saved,        setSaved]        = useState(false)   // flash checkmark
  const [showRating,   setShowRating]   = useState(false)
  const [following,    setFollowing]    = useState(false)
  const [isFollowed,   setIsFollowed]   = useState(false)
  const [showTop10Picker, setShowTop10Picker] = useState(false)
  const [existingTop10,   setExistingTop10]   = useState([])
  const [msg,             setMsg]             = useState(null)
  const [showRatePanel,  setShowRatePanel]  = useState(false)
  const [showNotesPanel, setShowNotesPanel] = useState(false)
  const [showSharePanel, setShowSharePanel] = useState(false)
  const [shareFriends,   setShareFriends]   = useState(null) // null = not loaded yet
  const [sentTo,         setSentTo]         = useState(new Set())
  const [friendsWithBook, setFriendsWithBook] = useState([])
  const [friendsLoaded,   setFriendsLoaded]   = useState(false)
  const [olDescription,  setOlDescription]  = useState(null)
  const [authorBio,      setAuthorBio]      = useState(null)
  const [myName,         setMyName]         = useState('')
  const [linkCopied,     setLinkCopied]     = useState(false)

  function flashSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  const authors = book?.authors || []

  // Open Library search results never include a description — fetch it lazily on open
  useEffect(() => {
    setOlDescription(null)
    if (book?.description || !book?.id?.startsWith('ol_')) return
    const workId = book.id.replace(/^ol_/, '')
    fetch(`https://openlibrary.org/works/${workId}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const desc = typeof data?.description === 'string' ? data.description : data?.description?.value
        if (desc) setOlDescription(desc)
      })
      .catch(() => {})
  }, [book?.id])

  // Short author bio via Wikipedia's public summary API — no key required
  useEffect(() => {
    setAuthorBio(null)
    if (!authors[0]) return
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(authors[0])}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.extract && data.type !== 'disambiguation') {
          setAuthorBio({ extract: data.extract, thumbnail: data.thumbnail?.source })
        }
      })
      .catch(() => {})
  }, [authors[0]])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Own display name, for the "X would like to share this book" link text
  useEffect(() => {
    if (!userId) return
    supabase.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
      .then(({ data }) => setMyName(data?.display_name || data?.username || ''))
  }, [userId])

  // Builds a shareable link to this book and hands it to the OS share sheet
  // (Messages/Mail/etc. on mobile) or falls back to copying it to the clipboard.
  async function shareBookLink() {
    const url = `${window.location.origin}/?share=${encodeURIComponent(book.id)}&by=${encodeURIComponent(userId)}`
    const text = `${myName || 'A friend'} would like to share "${book?.title}" from their BookList`
    if (navigator.share) {
      try { await navigator.share({ title: book?.title, text, url }) } catch (_) { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(`${text}\n${url}`)
        setLinkCopied(true)
        setTimeout(() => setLinkCopied(false), 2500)
      } catch (_) {
        flashError(new Error('Could not copy the link — please try again.'))
      }
    }
  }

  // Check if already following first author
  useEffect(() => {
    if (!authors[0] || !userId) return
    supabase.from('author_follows')
      .select('id').eq('user_id', userId).eq('author', authors[0]).maybeSingle()
      .then(({ data }) => setIsFollowed(!!data))
  }, [authors[0], userId])

  // Friends who have this book on their list
  useEffect(() => {
    setFriendsLoaded(false)
    if (!book?.id || !userId) return
    supabase.from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted')
      .then(async ({ data: fships }) => {
        if (!fships?.length) { setFriendsWithBook([]); setFriendsLoaded(true); return }
        const friendIds = fships.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
        // user_books.user_id references auth.users, not profiles — no FK for PostgREST
        // to auto-embed, so fetch profiles separately and merge in JS.
        const [{ data: rows }, { data: profs }] = await Promise.all([
          supabase.from('user_books').select('status, rating, top_10, user_id')
            .eq('book_id', book.id).in('user_id', friendIds),
          supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', friendIds),
        ])
        const profileMap = Object.fromEntries((profs || []).map(p => [p.id, p]))
        setFriendsWithBook((rows || []).map(r => ({ ...r, profiles: profileMap[r.user_id] })))
        setFriendsLoaded(true)
      })
  }, [book?.id, userId])

  // Lazy-load friends list the first time the Share panel — or the
  // finished-reading popup, which also offers sharing — opens
  useEffect(() => {
    if (!(showSharePanel || showRating) || shareFriends !== null) return
    supabase.from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted')
      .then(async ({ data: fships }) => {
        if (!fships?.length) { setShareFriends([]); return }
        const friendIds = fships.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', friendIds)
        setShareFriends(profiles || [])
      })
  }, [showSharePanel, showRating, shareFriends, userId])

  async function sendToFriend(friendId) {
    await supabase.from('book_recommendations').insert({
      from_user_id: userId, to_user_id: friendId, book_id: book.id,
    })
    setSentTo(prev => new Set([...prev, friendId]))
  }

  const friendsSection = (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18, marginBottom: 16 }}>
      <p style={{ margin: '0 0 12px', fontSize: 11, color: C.muted, fontFamily: f.sans,
        textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Friends</p>
      {!friendsLoaded ? (
        <p style={{ margin: 0, fontSize: 13, color: C.muted, fontFamily: f.sans, fontStyle: 'italic' }}>
          Checking your friends' lists…
        </p>
      ) : friendsWithBook.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: C.muted, fontFamily: f.sans, fontStyle: 'italic' }}>
          None of your friends have this one yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {friendsWithBook.map(fb => (
            <div key={fb.user_id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{
                  fontSize: 20, width: 34, height: 34, borderRadius: '50%',
                  background: C.surface2, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0,
                }}>{fb.profiles?.avatar_url || '📖'}</span>
                <span style={{
                  color: C.text, fontFamily: f.sans, fontSize: 14, fontWeight: 600,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{fb.profiles?.display_name || fb.profiles?.username}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {fb.top_10 && <span title="Top 10 favorite" style={{ fontSize: 14 }}>🏆</span>}
                <StatusBadge status={fb.status} />
                {fb.rating > 0 && <StarRating value={fb.rating} readonly size={13} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  function flashError(err) {
    console.error(err)
    setMsg({ type: 'error', text: err?.message || 'Something went wrong — please try again.' })
    setTimeout(() => setMsg(null), 4000)
  }

  // Creates the user_books row on demand (e.g. rating/noting a book you haven't shelved yet)
  async function ensureEntry(defaultStatus = 'want_to_read') {
    if (userBookId) return userBookId
    const row = await addToLibrary(userId, book, defaultStatus)
    setUserBookId(row.id)
    setStatus(defaultStatus)
    onUpdate?.()
    return row.id
  }

  async function handleStatusChange(newStatus) {
    const prevStatus = status
    setStatus(newStatus)
    try {
      if (userBookId) {
        // Moving (back) into Want to Read should append to the end of the
        // queue, not leave whatever stale/zero position it had before.
        const patch = { status: newStatus }
        if (newStatus === 'want_to_read') patch.position = await nextWantToReadPosition(userId)
        const { error } = await supabase.from('user_books').update(patch).eq('id', userBookId)
        if (error) throw error
      } else {
        const row = await addToLibrary(userId, book, newStatus)
        setUserBookId(row.id)
      }
      onUpdate?.()
      if (newStatus === 'read') {
        setShowRating(true)
      } else {
        flashSaved()
      }
    } catch (err) {
      setStatus(prevStatus)
      flashError(err)
    }
  }

  async function handleRatingChange(stars) {
    const prevRating = rating
    setRating(stars)
    try {
      const id = await ensureEntry()
      const { error } = await supabase.from('user_books').update({ rating: stars }).eq('id', id)
      if (error) throw error
      onUpdate?.()
      flashSaved()
    } catch (err) {
      setRating(prevRating)
      flashError(err)
    }
  }

  async function handleNotesSave() {
    if (!userBookId && !notes.trim()) return // nothing to save for an unshelved book
    try {
      const id = await ensureEntry()
      const { error } = await supabase.from('user_books').update({ notes }).eq('id', id)
      if (error) throw error
      onUpdate?.()
      flashSaved()
    } catch (err) {
      flashError(err)
    }
  }

  async function handleToggleTop10() {
    const id = await ensureEntry()
    if (top10) {
      // Removing from Top 10
      setTop10(false)
      await supabase.from('user_books')
        .update({ top_10: false }).eq('id', id)
      onUpdate?.()
      setMsg({ type: 'success', text: 'Removed from Top 10' })
      setTimeout(() => setMsg(null), 2000)
      return
    }
    // Check current Top 10 count
    const { data: currentTop10 } = await supabase.from('user_books')
      .select('id, rating, books(title, cover_url)')
      .eq('user_id', userId).eq('top_10', true)
    if ((currentTop10 || []).length >= 10) {
      setExistingTop10(currentTop10 || [])
      setShowTop10Picker(true)
    } else {
      setTop10(true)
      await supabase.from('user_books')
        .update({ top_10: true }).eq('id', id)
      onUpdate?.()
      setMsg({ type: 'success', text: '⭐ Added to Top 10!' })
      setTimeout(() => setMsg(null), 2000)
    }
  }

  async function handleTop10Replace(removeId) {
    // Remove one, add current
    await supabase.from('user_books').update({ top_10: false }).eq('id', removeId)
    await supabase.from('user_books')
      .update({ top_10: true }).eq('id', userBookId)
    setTop10(true)
    setShowTop10Picker(false)
    onUpdate?.()
    setMsg({ type: 'success', text: '⭐ Updated your Top 10!' })
    setTimeout(() => setMsg(null), 2000)
  }

  // The "Finished it!" wizard (Rate → Notes → Fave → Recommend) saves each
  // step immediately as the reader moves through it, instead of asking for
  // just a rating and stopping there.
  async function handleWizardRating(stars) {
    try {
      const id = await ensureEntry('read')
      const { error } = await supabase.from('user_books').update({ rating: stars }).eq('id', id)
      if (error) throw error
      setRating(stars)
      onUpdate?.()
    } catch (err) {
      flashError(err)
    }
  }

  async function handleWizardNotes(notesText) {
    try {
      const id = await ensureEntry('read')
      const { error } = await supabase.from('user_books').update({ notes: notesText }).eq('id', id)
      if (error) throw error
      setNotes(notesText)
      onUpdate?.()
    } catch (err) {
      flashError(err)
    }
  }

  async function handleWizardFave() {
    try {
      const id = await ensureEntry('read')
      const { data: currentTop10 } = await supabase.from('user_books')
        .select('id').eq('user_id', userId).eq('top_10', true)
      if ((currentTop10 || []).length >= 10) {
        setMsg({ type: 'error', text: 'Your Top 10 is already full — remove one first.' })
        setTimeout(() => setMsg(null), 4000)
        return
      }
      const { error } = await supabase.from('user_books').update({ top_10: true }).eq('id', id)
      if (error) throw error
      setTop10(true)
      onUpdate?.()
    } catch (err) {
      flashError(err)
    }
  }

  async function handleWizardFinish() {
    setShowRating(false)
    onUpdate?.()
    onClose()
  }

  async function toggleFollow() {
    if (!authors[0]) return
    setFollowing(true)
    if (isFollowed) {
      await supabase.from('author_follows').delete().eq('user_id', userId).eq('author', authors[0])
      setIsFollowed(false)
    } else {
      await supabase.from('author_follows').insert({ user_id: userId, author: authors[0] })
      setIsFollowed(true)
    }
    setFollowing(false)
  }

  async function handleRemove() {
    if (!userBookId) { onClose(); return }
    await supabase.from('user_books').delete().eq('id', userBookId)
    setUserBookId(null)
    setStatus('')
    setTop10(false)
    onUpdate?.()
    onClose()
  }

  return (
    <>
    {showRating && (
      <FinishedReadingPopup
        title={book?.title}
        initialRating={rating}
        shareFriends={shareFriends}
        sentTo={sentTo}
        linkCopied={linkCopied}
        onSaveRating={handleWizardRating}
        onSaveNotes={handleWizardNotes}
        onSaveFave={handleWizardFave}
        onShareFriend={sendToFriend}
        onShareLink={shareBookLink}
        onFinish={handleWizardFinish}
      />
    )}

    {/* Top 10 Picker – choose which book to remove */}
    {showTop10Picker && (
      <div onClick={(e) => e.target === e.currentTarget && setShowTop10Picker(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1200,
          background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
        <div style={{
          background: C.surface, borderRadius: 14, padding: 28,
          maxWidth: 480, width: '100%', border: `1px solid ${C.border}`,
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}>
          <h3 style={{ margin: '0 0 6px', color: C.text, fontFamily: f.serif, fontSize: 20 }}>
            Your Top 10 is full
          </h3>
          <p style={{ margin: '0 0 18px', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
            Remove one to make room for <em style={{ color: C.text }}>{book?.title}</em>:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {existingTop10.map(ub => (
              <button key={ub.id} onClick={() => handleTop10Replace(ub.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: C.surface2, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                  transition: 'border-color 0.15s', textAlign: 'left',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.danger}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
              >
                {ub.books?.cover_url
                  ? <img src={ub.books.cover_url} alt="" style={{ width: 36, height: 54, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  : <div style={{ width: 36, height: 54, background: C.border, borderRadius: 4, flexShrink: 0 }} />
                }
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: '0 0 3px', color: C.text, fontFamily: f.sans, fontSize: 14, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ub.books?.title}
                  </p>
                  {ub.rating > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <StarRating value={ub.rating} readonly size={11} />
                      <span style={{ fontSize: 11, color: C.muted, fontFamily: f.sans, fontWeight: 700 }}>{ub.rating}/5</span>
                    </span>
                  )}
                </div>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: C.danger, fontFamily: f.sans, flexShrink: 0 }}>
                  Replace
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowTop10Picker(false)}
            style={{ ...btn('subtle', 'sm'), marginTop: 14 }}>Cancel</button>
        </div>
      </div>
    )}
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div style={{
        background: C.surface,
        borderRadius: isMobile ? '16px 16px 0 0' : 14,
        padding: isMobile ? '20px 16px 32px' : 28,
        maxWidth: isMobile ? '100%' : 640,
        width: '100%',
        maxHeight: isMobile ? '90vh' : '88vh',
        overflowY: 'auto',
        border: `1px solid ${C.border}`,
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        position: 'relative',
      }}>
        {/* Close button */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 14, right: 14,
          background: C.surface2, border: 'none', color: C.muted,
          borderRadius: '50%', width: 30, height: 30, cursor: 'pointer',
          fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>

        {/* Status — pinned to top, in line with close button */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18, paddingRight: 40 }}>
          {Object.entries(STATUS_LABELS).map(([key, lbl]) => {
            const active = status === key
            const sc = STATUS_COLORS[key]
            return (
              <button key={key} onClick={() => handleStatusChange(key)}
                style={{
                  cursor: 'pointer', fontFamily: f.sans, fontSize: 12, fontWeight: 700,
                  padding: '6px 12px', borderRadius: 20, transition: 'all 0.15s',
                  border: `1px solid ${active ? sc.color : C.border}`,
                  background: active ? sc.color : C.surface2,
                  color: active ? '#0f1117' : C.muted,
                }}>
                {STATUS_ICONS[key]} {lbl}
              </button>
            )
          })}
        </div>

        <div style={{
          display: 'flex', flexDirection: isMobile ? 'row' : 'row',
          gap: isMobile ? 14 : 20, marginBottom: 22,
        }}>
          {/* Cover */}
          <div style={{ flexShrink: 0 }}>
            {book.cover_url
              ? <img src={book.cover_url} alt={book.title}
                  style={{
                    width: isMobile ? 80 : 110,
                    height: isMobile ? 120 : 165,
                    objectFit: 'cover', borderRadius: 8,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                  }} />
              : <NoCover title={book.title} width={isMobile ? 80 : 110} height={isMobile ? 120 : 165} />
            }
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 4px', color: C.text, fontSize: 20, fontFamily: f.serif,
              fontWeight: 700, lineHeight: 1.2 }}>
              {book.title}
            </h2>
            {book.subtitle && (
              <p style={{ margin: '0 0 6px', color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic' }}>
                {book.subtitle}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, color: C.muted, fontFamily: f.sans, fontSize: 14 }}>
                {book.authors?.join(', ')}
                {book.published_date && ` · ${book.published_date.slice(0,4)}`}
              </p>
              {authors[0] && (
                <button onClick={toggleFollow} disabled={following}
                  style={{ ...btn(isFollowed ? 'subtle' : 'ghost', 'sm'), fontSize: 11, padding: '3px 9px' }}>
                  {following ? '…' : isFollowed ? '✓ Following' : '+ Follow Author'}
                </button>
              )}
            </div>
            {book.average_rating > 0 && (
              <p style={{ margin: '0 0 6px', fontSize: 12, color: C.accent, fontFamily: f.sans, fontWeight: 700 }}>
                ★ {book.average_rating.toFixed?.(1) ?? book.average_rating}
                {book.ratings_count > 0 && (
                  <span style={{ color: C.muted, fontWeight: 400 }}> · {book.ratings_count.toLocaleString()} ratings</span>
                )}
              </p>
            )}
            {book.categories?.length > 0 && (
              <p style={{ margin: '0 0 6px', fontSize: 12, color: C.primary, fontFamily: f.sans }}>
                {book.categories.slice(0,3).join(' · ')}
              </p>
            )}
            {(book.page_count || book.publisher || book.isbn) && (
              <p style={{ margin: '0 0 10px', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
                {[book.publisher, book.page_count ? `${book.page_count} pages` : null, book.isbn ? `ISBN ${book.isbn}` : null]
                  .filter(Boolean).join(' · ')}
              </p>
            )}
            {(book.description || olDescription) && (
              <p style={{
                margin: 0, fontSize: 13, color: C.muted, fontFamily: f.sans, lineHeight: 1.5,
                display: '-webkit-box', WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>{book.description || olDescription}</p>
            )}
          </div>
        </div>

        {authorBio && (
          <div style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${C.border}`,
          }}>
            {authorBio.thumbnail && (
              <img src={authorBio.thumbnail} alt={authors[0]}
                style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
                About {authors[0]}
              </p>
              <p style={{
                margin: 0, fontSize: 13, color: C.muted, fontFamily: f.sans, lineHeight: 1.5,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>{authorBio.extract}</p>
            </div>
          </div>
        )}

        {/* Action row — WatchList style */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
          <ActionBox icon="⭐" label="Rate"
            sub={rating
              ? <><StarRating value={rating} readonly size={9} /><span style={{ fontSize: 9, fontWeight: 700, color: C.muted }}>{rating}/5</span></>
              : <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.03em', color: C.muted }}>NOT RATED</span>
            }
            active={showRatePanel} onClick={() => setShowRatePanel(o => !o)} />
          <ActionBox icon="📝" label="Notes"
            active={showNotesPanel} onClick={() => setShowNotesPanel(o => !o)} />
          <ActionBox icon="↗" label="Share"
            active={showSharePanel} onClick={() => setShowSharePanel(o => !o)} />
          <ActionBox icon={top10 ? '🏆' : '⭐'} label={top10 ? 'Faved' : 'Fave'}
            active={top10} activeColor={C.accent} onClick={handleToggleTop10} />
          <ActionBox icon="🗑" label="Remove" danger onClick={handleRemove} />
        </div>

        {msg && (
          <p style={{ margin: '-6px 0 14px', fontSize: 13, fontFamily: f.sans,
            color: msg.type === 'error' ? C.danger : C.success }}>{msg.text}</p>
        )}

        {showRatePanel && (
          <div style={{ marginBottom: 16, padding: '12px 14px', background: C.surface2, borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <p style={{ margin: 0, fontSize: 11, color: C.muted, fontFamily: f.sans,
                textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>My Rating</p>
              {saved && <span style={{ fontSize: 11, color: C.success, fontFamily: f.sans }}>✓ Saved</span>}
            </div>
            <StarRating value={rating} onChange={handleRatingChange} size={24} />
          </div>
        )}

        {showNotesPanel && (
          <div style={{ marginBottom: 16 }}>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              onBlur={handleNotesSave}
              placeholder="Your thoughts, quotes, reflections…"
              style={{ ...inputStyle, height: 80, resize: 'vertical', fontSize: 13 }} />
          </div>
        )}

        {showSharePanel && (
          <div style={{ marginBottom: 16, padding: '12px 14px', background: C.surface2, borderRadius: 10 }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, color: C.muted, fontFamily: f.sans,
              textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Send to a friend</p>
            {shareFriends === null ? <Spinner /> : shareFriends.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontFamily: f.sans, fontStyle: 'italic' }}>
                Add friends to share books with them.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {shareFriends.map(p => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 0',
                  }}>
                    <span style={{ color: C.text, fontFamily: f.sans, fontSize: 13, fontWeight: 600 }}>
                      {p.avatar_url} {p.display_name || p.username}
                    </span>
                    {sentTo.has(p.id)
                      ? <span style={{ fontSize: 12, color: C.success, fontFamily: f.sans, fontWeight: 700 }}>✓ Sent</span>
                      : <button onClick={() => sendToFriend(p.id)} style={btn('ghost', 'sm')}>Send</button>
                    }
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {friendsSection}
      </div>
    </div>
    </>
  )
}

// ================================================================
// Auth page
// ================================================================
// Deterministic auto-avatar: consistent per email, never changes on re-signup
function autoAvatar(email) {
  const sum = [...(email || 'book')].reduce((a, c) => a + c.charCodeAt(0), 0)
  return LITERARY_EMOJIS[sum % LITERARY_EMOJIS.length]
}

// ================================================================
// ResetPasswordPage – shown after clicking the "reset password" email link
// ================================================================
function ResetPasswordPage({ onDone }) {
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg,    setMsg]    = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (newPassword.length < 8) { setMsg({ type: 'error', text: 'Password must be at least 8 characters.' }); return }
    if (newPassword !== confirmPassword) { setMsg({ type: 'error', text: 'Passwords do not match.' }); return }
    setSaving(true); setMsg(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setMsg({ type: 'success', text: 'Password updated! Taking you in…' })
      setTimeout(() => onDone(), 1200)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '100%', maxWidth: 380, background: C.surface, borderRadius: 14,
        padding: 'clamp(20px, 5vw, 36px)', border: `1px solid ${C.border}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)', margin: '0 12px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🔑</div>
          <h1 style={{ margin: '0 0 4px', color: C.text, fontSize: 22, fontFamily: f.serif, fontWeight: 700 }}>
            Set a New Password
          </h1>
          <p style={{ margin: 0, color: C.muted, fontSize: 13, fontFamily: f.sans }}>
            Choose a new password for your account.
          </p>
        </div>
        <form onSubmit={handleSubmit}>
          <input style={{ ...inputStyle, marginBottom: 10 }} type="password" value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="New password (min. 8 characters)" required />
          <input style={{ ...inputStyle, marginBottom: 18 }} type="password" value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password" required />
          {msg && (
            <p style={{ margin: '0 0 14px', fontSize: 13, fontFamily: f.sans,
              color: msg.type === 'success' ? C.success : C.danger,
              background: msg.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
              padding: '8px 12px', borderRadius: 6,
            }}>{msg.text}</p>
          )}
          <button type="submit" disabled={saving}
            style={{ ...btn('primary', 'lg'), width: '100%', justifyContent: 'center' }}>
            {saving ? 'Saving…' : 'Save New Password'}
          </button>
        </form>
      </div>
    </div>
  )
}

function AuthPage({ inviteFrom, sharedBookId, sharedBy }) {
  const [mode, setMode] = useState((inviteFrom || sharedBookId) ? 'signup' : 'signin')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [username, setUsername]     = useState('')
  const [displayName, setDisplayName] = useState('')
  const [avatar, setAvatar]         = useState('')   // '' = auto-assign at submit
  const [loading, setLoading]       = useState(false)
  const [msg, setMsg]               = useState(null)
  const [sharedBook,       setSharedBook]       = useState(null)
  const [sharedByProfile,  setSharedByProfile]  = useState(null)
  const [resetLoading,     setResetLoading]     = useState(false)

  // Someone sent a "share a link" invite for a specific book — preview it
  // (books + profiles are both publicly readable, so this works pre-login)
  useEffect(() => {
    if (!sharedBookId) return
    supabase.from('books').select('*').eq('id', sharedBookId).maybeSingle()
      .then(({ data }) => setSharedBook(data))
    if (sharedBy) {
      supabase.from('profiles').select('display_name, username').eq('id', sharedBy).maybeSingle()
        .then(({ data }) => setSharedByProfile(data))
    }
  }, [sharedBookId, sharedBy])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({ email })
        if (error) throw error
        setMsg({ type: 'success', text: 'Check your email for a magic link! ✉️' })
      } else if (mode === 'signup') {
        if (!username.trim()) throw new Error('Please choose a username.')
        const chosenAvatar = avatar || autoAvatar(email)
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: displayName || username } },
        })
        if (error) throw error
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            username: username.toLowerCase().trim(),
            display_name: (displayName || username).trim(),
            avatar_url: chosenAvatar,
          }, { onConflict: 'id' })
        }
        setMsg({ type: 'success', text: 'Account created! Check your email to confirm, then sign in.' })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
    setLoading(false)
  }

  async function handleForgotPassword() {
    if (!email.trim()) { setMsg({ type: 'error', text: 'Enter your email above first.' }); return }
    setResetLoading(true); setMsg(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      })
      if (error) throw error
      setMsg({ type: 'success', text: 'Check your email for a link to reset your password. ✉️' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
    setResetLoading(false)
  }

  const tabBtn = (m, lbl) => (
    <button onClick={() => setMode(m)} style={{
      flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
      background: 'none', fontFamily: f.sans, fontSize: 13, fontWeight: 600,
      color: mode === m ? C.primary : C.muted,
      borderBottom: mode === m ? `2px solid ${C.primary}` : '2px solid transparent',
    }}>{lbl}</button>
  )

  return (
    <div style={{
      minHeight: '100vh', background: C.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: C.surface, borderRadius: 14,
        padding: 'clamp(20px, 5vw, 36px)', border: `1px solid ${C.border}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        margin: '0 12px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📚</div>
          <h1 style={{ margin: '0 0 4px', color: C.text, fontSize: 26, fontFamily: f.serif, fontWeight: 700 }}>
            BookList
          </h1>
          <p style={{ margin: 0, color: C.muted, fontSize: 13, fontFamily: f.sans }}>
            {sharedBookId
              ? `${sharedByProfile?.display_name || sharedByProfile?.username || 'A friend'} would like to share this book from their BookList`
              : inviteFrom ? "You've been invited! Create an account to connect."
              : 'Your literary life, organized'}
          </p>
        </div>

        {sharedBookId && sharedBook && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
            padding: 12, borderRadius: 10, background: C.surface2, border: `1px solid ${C.border}`,
          }}>
            {sharedBook.cover_url
              ? <img src={sharedBook.cover_url} alt="" style={{ width: 44, height: 66, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
              : <NoCover title={sharedBook.title} width={44} height={66} />
            }
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 14, color: C.text, fontFamily: f.sans,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sharedBook.title}</p>
              <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(sharedBook.authors || []).join(', ')}</p>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
          {tabBtn('signin', 'Sign In')}
          {tabBtn('signup', 'Sign Up')}
          {tabBtn('magic', 'Magic Link')}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4, fontFamily: f.sans, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Display Name</label>
              <input style={inputStyle} value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your Name" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4, fontFamily: f.sans, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Username</label>
              <input style={inputStyle} value={username}
                onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                placeholder="your_username" required />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 6, fontFamily: f.sans, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Pick an Avatar <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional — one will be auto-assigned)</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 4, marginBottom: 6 }}>
                {LITERARY_EMOJIS.map(e => (
                  <button key={e} type="button" onClick={() => setAvatar(avatar === e ? '' : e)}
                    style={{
                      fontSize: 18, padding: '5px 3px', border: 'none', cursor: 'pointer',
                      borderRadius: 6, background: avatar === e ? C.primary : C.surface2,
                      transition: 'background 0.1s', WebkitTapHighlightColor: 'transparent',
                    }}>{e}</button>
                ))}
              </div>
              {avatar && (
                <p style={{ margin: 0, fontSize: 11, color: C.muted, fontFamily: f.sans }}>
                  Selected: {avatar} · <button type="button" onClick={() => setAvatar('')}
                    style={{ background: 'none', border: 'none', color: C.primary, cursor: 'pointer', fontSize: 11, padding: 0 }}>
                    Clear
                  </button>
                </p>
              )}
            </div>
          </>}

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4, fontFamily: f.sans, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Email</label>
            <input style={inputStyle} type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required />
          </div>

          {mode !== 'magic' && (
            <div style={{ marginBottom: mode === 'signin' ? 8 : 24 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4, fontFamily: f.sans, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Password</label>
              <input style={inputStyle} type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" minLength={mode === 'signup' ? 8 : undefined} required />
            </div>
          )}

          {mode === 'signin' && (
            <div style={{ textAlign: 'right', marginBottom: 20 }}>
              <button type="button" onClick={handleForgotPassword} disabled={resetLoading} style={{
                background: 'none', border: 'none', color: C.primary, cursor: 'pointer',
                fontFamily: f.sans, fontSize: 12, padding: 0,
              }}>
                {resetLoading ? 'Sending…' : 'Forgot password?'}
              </button>
            </div>
          )}
          {mode === 'magic' && <div style={{ marginBottom: 24 }} />}

          {msg && (
            <p style={{ margin: '0 0 14px', fontSize: 13, fontFamily: f.sans,
              color: msg.type === 'success' ? C.success : C.danger,
              background: msg.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
              padding: '8px 12px', borderRadius: 6,
            }}>{msg.text}</p>
          )}

          <button type="submit" disabled={loading}
            style={{ ...btn('primary', 'lg'), width: '100%', justifyContent: 'center' }}>
            {loading ? 'Please wait…'
              : mode === 'signin'  ? 'Sign In'
              : mode === 'signup'  ? 'Create Account'
              : 'Send Magic Link'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ================================================================
// RecoCard – poster with WatchList-style hover quick-add circles
// ================================================================
function RecoCard({ book, userId, myBookIds, myBookKeys, myBooks, onAdded, onDismiss, onOpenModal, caption }) {
  const isMobile = useIsMobile()
  const [hovered,  setHovered]  = useState(false)
  const [adding,   setAdding]   = useState(null)
  const [added,    setAdded]    = useState(null)
  const [showRating, setShowRating] = useState(false)
  const hideTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])
  const inLibrary = isInMyLibrary(book, myBookIds, myBookKeys, myBooks) || !!added

  async function handleAdd(status) {
    setAdding(status)
    try {
      await addToLibrary(userId, book, status)
      setAdded(status)
      if (status === 'read') {
        setShowRating(true)
        // Don't call onAdded yet — wait until after rating so card stays mounted
      } else {
        onAdded?.(book.id, book)
      }
    } catch (e) { alert(e.message) }
    setAdding(null)
  }

  function handleDismiss() {
    setAdded('not_for_me')
    onDismiss?.(book.id)
  }

  async function handleRated(stars) {
    await supabase.from('user_books')
      .update({ rating: stars }).eq('user_id', userId).eq('book_id', book.id)
    setShowRating(false)
    onAdded?.(book.id, book)  // reload after rating is saved
  }

  // Mobile has no hover — tap reveals the action icons for a couple seconds,
  // then they auto-hide (matches WatchList), instead of staying pinned on the
  // tile. Tapping again while revealed opens the modal directly.
  function handleTileTap() {
    if (isMobile && !inLibrary && !hovered) {
      setHovered(true)
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => setHovered(false), 2500)
      return
    }
    onOpenModal?.()
  }

  return (
    <div style={{ flexShrink: 0, position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      {showRating && (
        <RatingPopup title={book.title} onRate={handleRated}
          onSkip={() => { setShowRating(false); onAdded?.(book.id, book) }} />
      )}
      <PosterCard book={book} onClick={handleTileTap} />

      {/* Hover overlay — clicks on background open modal, buttons stop propagation */}
      {hovered && (
        <div onClick={onOpenModal} style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          background: 'rgba(10,8,24,0.72)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'flex-end',
          gap: 8, padding: '10px 8px 14px',
        }}>
          {caption && (
            <p style={{
              margin: 0, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
              fontFamily: f.sans, textAlign: 'center', lineHeight: 1.3,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', textShadow: '0 1px 3px rgba(0,0,0,0.6)',
            }}>{caption}</p>
          )}
          {inLibrary ? (
            <div style={{
              background: STATUS_COLORS[added]?.bg || 'rgba(52,211,153,0.15)', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, color: STATUS_COLORS[added]?.color || C.success,
              fontFamily: f.sans, fontWeight: 700,
            }}>
              {STATUS_ICONS[added]} {STATUS_LABELS[added] || 'In library'}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { st: 'reading',      icon: STATUS_ICONS.reading,      bg: STATUS_COLORS.reading.color,      fg: '#0f1117', label: 'Reading',      dismiss: false },
                { st: 'want_to_read', icon: STATUS_ICONS.want_to_read, bg: STATUS_COLORS.want_to_read.color, fg: '#0f1117', label: 'Want to Read', dismiss: false },
                { st: 'read',         icon: STATUS_ICONS.read,         bg: STATUS_COLORS.read.color,         fg: '#0f1117', label: 'Read',         dismiss: false },
              ].map(({ st, icon, bg, fg, label, dismiss }) => (
                <button key={st}
                  onClick={(e) => { e.stopPropagation(); dismiss ? handleDismiss() : handleAdd(st) }}
                  title={label}
                  disabled={!!adding}
                  style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: bg, border: 'none', cursor: adding ? 'not-allowed' : 'pointer',
                    fontSize: dismiss ? 12 : 13,
                    fontWeight: dismiss ? 700 : 'normal',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    opacity: adding && adding !== st ? 0.5 : 1,
                    transition: 'transform 0.1s, opacity 0.1s',
                    transform: adding === st ? 'scale(0.9)' : 'scale(1)',
                    color: fg,
                  }}>
                  {adding === st ? '…' : icon}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ================================================================
// FriendBookCard – a book on a friend's shelf, with quick-add if you don't have it
// ================================================================
function FriendBookCard({ ub, profile, userId, myBookIds, myBookKeys, myBooks, onAdded, onOpenModal }) {
  const isMobile = useIsMobile()
  const [hovered, setHovered] = useState(false)
  const [adding,  setAdding]  = useState(null)
  const [added,   setAdded]   = useState(null)
  const hideTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])
  const book = ub.books || {}
  const inLibrary = isInMyLibrary(book, myBookIds, myBookKeys, myBooks) || !!added

  async function handleAdd(status) {
    setAdding(status)
    try {
      await addToLibrary(userId, book, status)
      setAdded(status)
      onAdded?.(book.id, book)
    } catch (e) { alert(e.message) }
    setAdding(null)
  }

  // Mobile has no hover — tap reveals the action icons for a couple seconds,
  // then they auto-hide (matches WatchList). Tapping again while revealed opens the modal.
  function handleTileTap() {
    if (isMobile && !inLibrary && !hovered) {
      setHovered(true)
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => setHovered(false), 2500)
      return
    }
    onOpenModal?.()
  }

  return (
    <div style={{ flexShrink: 0, width: 120 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <div style={{ position: 'relative' }}>
        <PosterCard userBook={ub} onClick={handleTileTap} />
        {hovered && !inLibrary && (
          <div onClick={onOpenModal} style={{
            position: 'absolute', inset: 0, borderRadius: 8,
            background: 'rgba(10,8,24,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            flexDirection: 'column', paddingBottom: 14,
          }}>
            <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
              {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
                <button key={key} title={lbl} disabled={!!adding}
                  onClick={() => handleAdd(key)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', border: 'none',
                    background: STATUS_COLORS[key]?.color, color: '#0f1117',
                    cursor: adding ? 'not-allowed' : 'pointer', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: adding && adding !== key ? 0.5 : 1,
                  }}>
                  {adding === key ? '…' : STATUS_ICONS[key]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================
// AddBookModal – quick-add: list rows with reading/want-to-read icons
// ================================================================
function AddBookModal({ userId, defaultStatus = null, onClose, onAdded, onOpenModal }) {
  const isMobile = useIsMobile()
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState([])
  const [searching,  setSearching]  = useState(false)
  const [err,        setErr]        = useState(null)
  const [addingKey,  setAddingKey]  = useState(null) // `${bookId}:${status}`
  const [myBookStatus, setMyBookStatus] = useState(new Map())
  const debounceRef = useRef(null)

  useEffect(() => {
    supabase.from('user_books').select('book_id, status').eq('user_id', userId)
      .then(({ data }) => setMyBookStatus(new Map((data || []).map(r => [r.book_id, r.status]))))
  }, [userId])

  useEffect(() => {
    if (!query.trim()) { setResults([]); setErr(null); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setErr(null)
      try {
        const { results } = await searchBooks(query, 20)
        setResults(results)
      } catch (e) {
        setErr(e.message)
        setResults([])
      }
      setSearching(false)
    }, 380)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  async function handleAdd(book, status) {
    const key = `${book.id}:${status}`
    setAddingKey(key)
    try {
      await addToLibrary(userId, book, status)
      setMyBookStatus(prev => new Map(prev).set(book.id, status))
      onAdded?.()
    } catch (e) { alert(e.message) }
    setAddingKey(null)
  }

  async function openDetail(book) {
    const currentStatus = myBookStatus.get(book.id)
    if (currentStatus) {
      const { data } = await supabase.from('user_books').select('*, books(*)')
        .eq('user_id', userId).eq('book_id', book.id).maybeSingle()
      if (data) onOpenModal?.({ type: 'library', userBook: data })
    } else {
      onOpenModal?.({ type: 'search', book })
    }
  }

  const single = !!defaultStatus
  const actionIcon = single ? STATUS_ICONS[defaultStatus] : null
  const actionBg   = single ? STATUS_COLORS[defaultStatus]?.color : null
  const actionFg   = single ? '#0f1117' : null
  const actionLabel = single ? STATUS_LABELS[defaultStatus] : null

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center', padding: isMobile ? 0 : 20,
      }}>
      <div style={{
        background: C.surface, width: '100%',
        maxWidth: isMobile ? '100%' : 480,
        maxHeight: isMobile ? '85vh' : '80vh',
        borderRadius: isMobile ? '16px 16px 0 0' : 14,
        padding: isMobile ? '18px 14px 24px' : 24,
        overflowY: 'auto', border: `1px solid ${C.border}`,
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)', position: 'relative',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 19 }}>
            {single ? <>{actionIcon} Add to {actionLabel}</> : <>📚 Add a Book</>}
          </h2>
          <button onClick={onClose} style={{
            background: C.surface2, border: 'none', color: C.muted,
            borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
            fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>×</button>
        </div>

        <div style={{ position: 'relative', marginBottom: 14, flexShrink: 0 }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="🔍  Search by title, author, or ISBN…"
            style={{ ...inputStyle, paddingRight: query ? 34 : undefined }}
          />
          {query && (
            <button onClick={() => setQuery('')} title="Clear search" style={{
              position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)',
              width: 22, height: 22, borderRadius: '50%', border: 'none',
              background: C.surface2, color: C.muted, cursor: 'pointer',
              fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
            }}>×</button>
          )}
        </div>

        <div style={{ overflowY: 'auto' }}>
          {searching ? <Spinner /> : err ? (
            <p style={{ color: C.danger, fontFamily: f.sans, fontSize: 13 }}>{err}</p>
          ) : results.length === 0 ? (
            <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
              {query.trim() ? 'No results found' : 'Start typing to search'}
            </p>
          ) : results.map(book => {
            const currentStatus = myBookStatus.get(book.id)
            const alreadyOnTarget = single && currentStatus === defaultStatus
            return (
              <div key={book.id} onClick={() => openDetail(book)} style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                padding: '10px 0', borderBottom: `1px solid ${C.border}`,
              }}>
                {book.cover_url
                  ? <img src={book.cover_url} alt="" style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  : <NoCover title={book.title} width={40} height={60} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: '0 0 2px', fontWeight: 700, fontSize: 13, color: C.text, fontFamily: f.sans,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{book.title}</p>
                  <p style={{
                    margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{book.authors?.join(', ')}</p>
                  {currentStatus && !alreadyOnTarget && (
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: C.muted, fontFamily: f.sans }}>
                      {STATUS_ICONS[currentStatus]} Currently {STATUS_LABELS[currentStatus]}
                    </p>
                  )}
                </div>
                {single ? (
                  alreadyOnTarget ? (
                    <span style={{ fontSize: 11, color: C.success, fontFamily: f.sans, fontWeight: 700, flexShrink: 0 }}>
                      ✓ In library
                    </span>
                  ) : (
                    <button title={currentStatus ? `Move to ${actionLabel}` : actionLabel}
                      onClick={e => { e.stopPropagation(); handleAdd(book, defaultStatus) }}
                      disabled={!!addingKey}
                      style={{
                        width: 32, height: 32, borderRadius: '50%', border: 'none', flexShrink: 0,
                        background: actionBg, color: actionFg, cursor: 'pointer', fontSize: 14,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: addingKey && addingKey !== `${book.id}:${defaultStatus}` ? 0.5 : 1,
                      }}>
                      {addingKey === `${book.id}:${defaultStatus}` ? '…' : actionIcon}
                    </button>
                  )
                ) : (
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {Object.entries(STATUS_LABELS).map(([key, lbl]) => {
                      const on = currentStatus === key
                      const key2 = `${book.id}:${key}`
                      return (
                        <button key={key} title={on ? `${lbl} (current)` : `Move to ${lbl}`}
                          onClick={() => handleAdd(book, key)}
                          disabled={!!addingKey}
                          style={{
                            width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
                            background: on ? C.success : STATUS_COLORS[key]?.bg || C.surface2,
                            color: on ? C.white : STATUS_COLORS[key]?.color || C.text,
                            fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: addingKey && addingKey !== key2 ? 0.5 : 1,
                          }}>
                          {addingKey === key2 ? '…' : on ? '✓' : STATUS_ICONS[key]}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ================================================================
// Home page – WatchList-style: just your own shelves
// ================================================================
const READ_SORTS = [
  ['default',   'Default'],
  ['top_rated', 'Top Rated'],
  ['recent',    'Recent'],
]

function HomePage({ userId, onOpenList }) {
  const isMobile = useIsMobile()
  const [myBooks,      setMyBooks]      = useState([])
  const [loadingData,  setLoadingData]  = useState(true)
  const [modal,        setModal]        = useState(null)
  const [showAdd,      setShowAdd]      = useState(null) // null | 'reading' | 'want_to_read' | 'read'
  const [showReadFilter, setShowReadFilter] = useState(false)
  const [readSort,     setReadSort]     = useState('default')
  const [readGenre,    setReadGenre]    = useState('all')

  const loadHomeData = useCallback(async () => {
    setLoadingData(true)
    const { data: myLib } = await supabase
      .from('user_books').select('*, books(*)').eq('user_id', userId)
      .order('updated_at', { ascending: false })
    setMyBooks(myLib || [])
    setLoadingData(false)
  }, [userId])

  useEffect(() => { loadHomeData() }, [loadHomeData])

  const reading = myBooks.filter(u => u.status === 'reading')
  const wantToRead = myBooks.filter(u => u.status === 'want_to_read')
    .sort((a, b) => (a.position || 0) - (b.position || 0))
  const readAll = myBooks.filter(u => u.status === 'read')
  const readGenres = useMemo(() => topCategories(readAll.map(u => u.books || {})), [myBooks])
  const read = (() => {
    const list = readGenre === 'all' ? readAll : readAll.filter(u => bookGenres(u.books).includes(readGenre))
    if (readSort === 'recent') return list // already fetched in updated_at desc order
    if (readSort === 'top_rated') return [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    // 'default' — Top 10 picks first, then by rating descending
    return [...list].sort((a, b) => {
      if (!!b.top_10 !== !!a.top_10) return b.top_10 ? 1 : -1
      return (b.rating || 0) - (a.rating || 0)
    })
  })()

  const goToList = (filter, locked = false) => () => onOpenList(filter, locked)

  // Drag-to-reorder — Want to Read row, left-to-right priority.
  // Press-and-hold (mouse OR touch) via useDragReorder, since native HTML5
  // drag-and-drop never fires on touch devices.
  async function persistOrder(reordered) {
    setMyBooks(prev => {
      const others = prev.filter(u => u.status !== 'want_to_read')
      return [...others, ...reordered]
    })
    await Promise.all(
      reordered.map((ub, idx) => supabase.from('user_books').update({ position: idx }).eq('id', ub.id))
    )
  }
  const { dragIdx, overIdx, nativeDragProps, handleBind, tileProps } = useDragReorder(wantToRead, persistOrder)

  return (
    <div>
      <HorizontalRow
        title="Currently Reading"
        icon="▶"
        iconBg={STATUS_COLORS.reading.color}
        items={reading}
        renderItem={ub => (
          <PosterCard key={ub.id} userBook={ub}
            onClick={() => setModal({ type: 'library', userBook: ub })} />
        )}
        loading={loadingData}
        onAdd={() => setShowAdd('reading')}
        addLabel="Add Book"
        seeAllAction={goToList('reading', true)}
      />

      <HorizontalRow
        title="Want to Read"
        icon="👀"
        iconBg={C.accent}
        tooltip="⠿ Drag the grip in the corner of a cover to set your priority order"
        items={wantToRead}
        renderItem={(ub, idx) => (
          <div key={ub.id}
            {...tileProps(idx)}
            {...nativeDragProps(idx)}
            style={{
              position: 'relative',
              opacity: dragIdx === idx ? 0.4 : 1,
              outline: overIdx === idx && dragIdx !== idx ? `2px solid ${C.primary}` : 'none',
              borderRadius: 10, cursor: 'grab',
            }}
          >
            <PosterCard userBook={ub}
              onClick={() => setModal({ type: 'library', userBook: ub })} />
            <div {...handleBind(idx)} style={{
              ...handleBind(idx).style,
              position: 'absolute', bottom: 4, right: 4, width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(10,8,24,0.75)', color: '#fff', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'grab', zIndex: 2, WebkitTapHighlightColor: 'transparent',
            }}>⠿</div>
          </div>
        )}
        loading={loadingData}
        onAdd={() => setShowAdd('want_to_read')}
        addLabel="Add Book"
        seeAllAction={goToList('want_to_read', true)}
      />
      {/* Read — expands as a full grid, not a single scrolling row */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
          <button onClick={goToList('read', true)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', padding: 0, margin: 0,
            cursor: 'pointer', fontFamily: f.sans,
          }}>
            <SectionBadge icon="✅" bg={C.success} />
            <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>Read</h2>
            <CountPill n={read.length} />
            <span style={{ color: C.muted, fontSize: 15 }}>›</span>
          </button>
          <button onClick={() => setShowReadFilter(o => !o)} style={{ ...pill(showReadFilter), fontSize: 12 }}>
            Filter ▾
          </button>
        </div>

        {showReadFilter && (
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: 14, marginBottom: 16,
          }}>
            <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
              textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Sort</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: readGenres.length > 0 ? 14 : 0 }}>
              {READ_SORTS.map(([key, lbl]) => (
                <button key={key} onClick={() => setReadSort(key)} style={pill(readSort === key)}>
                  {lbl}
                </button>
              ))}
            </div>
            {readGenres.length > 0 && (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                  textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Genre</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => setReadGenre('all')} style={{ ...pill(readGenre === 'all'), fontSize: 12 }}>
                    All
                  </button>
                  {readGenres.map(g => (
                    <button key={g} onClick={() => setReadGenre(g)} style={{ ...pill(readGenre === g), fontSize: 12 }}>
                      {g}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {loadingData ? <Spinner /> : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
            gap: isMobile ? 9 : 16,
          }}>
            <AddTile onClick={() => setShowAdd('read')} label="Add Book" />
            {read.map(ub => (
              <PosterCard key={ub.id} userBook={ub}
                onClick={() => setModal({ type: 'library', userBook: ub })} />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {modal && (
        <BookDetailModal
          item={modal.type === 'library' ? modal.userBook : (modal.book || modal.userBook?.books)}
          userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => loadHomeData()}
        />
      )}

      {showAdd && (
        <AddBookModal
          userId={userId}
          defaultStatus={showAdd}
          onClose={() => setShowAdd(null)}
          onAdded={loadHomeData}
          onOpenModal={(item) => { setShowAdd(null); setModal(item) }}
        />
      )}
    </div>
  )
}

// ================================================================
// Search page – dedicated search tab
// ================================================================
function SearchPage({ userId }) {
  const isMobile = useIsMobile()
  const [searchQ,      setSearchQ]      = useState('')
  const [searchRes,    setSearchRes]    = useState([])
  const [searching,    setSearching]    = useState(false)
  const [searchErr,    setSearchErr]    = useState(null)
  const [searchSource, setSearchSource] = useState(null)
  const [myBookIds,    setMyBookIds]    = useState(new Set())
  const [modal,        setModal]        = useState(null)
  const debounceRef = useRef(null)

  const loadMyBookIds = useCallback(async () => {
    const { data } = await supabase.from('user_books').select('book_id').eq('user_id', userId)
    setMyBookIds(new Set((data || []).map(r => r.book_id)))
  }, [userId])

  useEffect(() => { loadMyBookIds() }, [loadMyBookIds])

  useEffect(() => {
    if (!searchQ.trim()) { setSearchRes([]); setSearchErr(null); setSearchSource(null); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchErr(null)
      try {
        const { results, source } = await searchBooks(searchQ, 20)
        setSearchRes(results)
        setSearchSource(source)
      } catch (err) {
        setSearchErr(err.message)
        setSearchRes([])
      }
      setSearching(false)
    }, 420)
    return () => clearTimeout(debounceRef.current)
  }, [searchQ])

  const isSearching = searchQ.trim().length > 0

  return (
    <div>
      <div style={{ marginBottom: 24, position: 'relative' }}>
        <input
          autoFocus
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="🔍  Search books by title, author, or ISBN…"
          style={{
            ...inputStyle,
            fontSize: 15, padding: '13px 18px',
            borderRadius: 10, border: `1px solid ${isSearching ? C.primary : C.border}`,
          }}
        />
        {searchQ && (
          <button onClick={() => setSearchQ('')}
            style={{
              position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18,
            }}>×</button>
        )}
      </div>

      {isSearching ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
            <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontFamily: f.sans }}>
              {searching ? 'Searching…' : `Results for "${searchQ}"`}
            </h2>
            {!searching && searchSource === 'openlibrary' && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: f.sans }}>via Open Library</span>
            )}
          </div>
          {searching ? <Spinner /> : searchErr ? (
            <div style={{
              background: 'rgba(248,113,113,0.1)', border: `1px solid ${C.danger}`,
              borderRadius: 8, padding: '14px 18px',
            }}>
              <p style={{ margin: '0 0 4px', color: C.danger, fontFamily: f.sans, fontSize: 14, fontWeight: 700 }}>
                Search failed
              </p>
              <p style={{ margin: 0, color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
                {searchErr}
              </p>
              <p style={{ margin: '8px 0 0', color: C.muted, fontFamily: f.sans, fontSize: 12 }}>
                Tip: add a free Google Books API key to <code style={{ color: C.primary }}>.env.local</code> as{' '}
                <code style={{ color: C.primary }}>VITE_GOOGLE_BOOKS_API_KEY</code> to avoid rate limits.
              </p>
            </div>
          ) : searchRes.length === 0
            ? <EmptyState icon="🔍" message="No results found" sub="Try a different title or author name" />
            : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
                gap: isMobile ? 9 : 16,
              }}>
                {searchRes.map(book => (
                  <SearchResultCard key={book.id} book={book} userId={userId}
                    myBookIds={myBookIds}
                    onAdded={(id) => setMyBookIds(prev => new Set([...prev, id]))}
                    onOpenModal={() => setModal({ type: 'search', book })} />
                ))}
              </div>
            )
          }
        </div>
      ) : (
        <EmptyState icon="🔍" message="Search for a book" sub="Title, author, or ISBN" />
      )}

      {modal && (
        <BookDetailModal
          item={modal.book}
          userId={userId}
          onClose={() => setModal(null)}
          onUpdate={loadMyBookIds}
        />
      )}
    </div>
  )
}

// ================================================================
// Discover page helpers – shared header/body/filter-panel chrome
// ================================================================
function DiscoverSectionHeader({ icon, iconBg, title, count, onTitleClick, filterOpen, onFilterToggle, tooltip }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
      <button onClick={onTitleClick} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'none', border: 'none', padding: 0, margin: 0,
        cursor: 'pointer', fontFamily: f.sans,
      }}>
        <SectionBadge icon={icon} bg={iconBg} title={tooltip} />
        <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>{title}</h2>
        <CountPill n={count} />
        <span style={{ color: C.muted, fontSize: 15 }}>›</span>
      </button>
      <button onClick={onFilterToggle} style={{ ...pill(filterOpen), fontSize: 12 }}>Filter ▾</button>
    </div>
  )
}

function DiscoverFilterPanel({ primaryLabel, primaryOptions, primaryValue, onPrimaryChange, genreOptions, genreValue, onGenreChange }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: 14, marginBottom: 16,
    }}>
      {primaryOptions && (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{primaryLabel}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: genreOptions?.length ? 14 : 0 }}>
            {primaryOptions.map(([key, lbl]) => (
              <button key={key} onClick={() => onPrimaryChange(key)} style={{ ...pill(primaryValue === key), fontSize: 12 }}>
                {lbl}
              </button>
            ))}
          </div>
        </>
      )}
      {genreOptions?.length > 0 && (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Genre</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => onGenreChange('all')} style={{ ...pill(genreValue === 'all'), fontSize: 12 }}>All</button>
            {genreOptions.map(g => (
              <button key={g} onClick={() => onGenreChange(g)} style={{ ...pill(genreValue === g), fontSize: 12 }}>{g}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DiscoverSectionBody({ expanded, loading, items, renderItem, emptyMsg }) {
  const isMobile = useIsMobile()
  if (loading && !expanded) return <Spinner />
  if (items.length === 0) {
    return expanded
      ? <EmptyState message={emptyMsg} />
      : <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', margin: 0 }}>{emptyMsg}</p>
  }
  return expanded ? (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
      gap: isMobile ? 9 : 16,
    }}>
      {items.map(renderItem)}
    </div>
  ) : (
    <div style={{
      display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, paddingRight: 20,
      scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch',
    }}>
      {items.map(renderItem)}
    </div>
  )
}

// ================================================================
// Discover page – Friends / Recommended / Trending / Picks
// ================================================================
function DiscoverPage({ userId }) {
  const [loading,      setLoading]      = useState(true)
  const [myBookIds,    setMyBookIds]    = useState(new Set())
  const [myBookKeys,   setMyBookKeys]   = useState(new Set()) // normalized title|author fallback match
  const [myBooks,      setMyBooks]      = useState([]) // fuzzy-title fallback match, for subtitle/formatting mismatches
  const [dismissedRecs, setDismissedRecs] = useState(new Set())
  const [modal,        setModal]        = useState(null)
  const [expanded,     setExpanded]     = useState(null) // null | 'friends' | 'recommended' | 'trending' | 'picks'

  const [friendsFeed, setFriendsFeed] = useState([])
  const [profileMap,  setProfileMap]  = useState({})
  const [friendsFilter, setFriendsFilter] = useState('all')
  const [friendsGenre,  setFriendsGenre]  = useState('all')
  const [showFriendsFilter, setShowFriendsFilter] = useState(false)

  const [recommended, setRecommended] = useState([])
  const [recFilter, setRecFilter] = useState('all')
  const [recGenre,  setRecGenre]  = useState('all')
  const [showRecFilter, setShowRecFilter] = useState(false)

  const [trending, setTrending] = useState([])
  const [trendGenre, setTrendGenre] = useState('all')
  const [showTrendFilter, setShowTrendFilter] = useState(false)

  const [picks, setPicks] = useState([])
  const [picksFilter, setPicksFilter] = useState('all')
  const [picksGenre,  setPicksGenre]  = useState('all')
  const [showPicksFilter, setShowPicksFilter] = useState(false)

  // ── Recommended: explicit shares + friends' 5-star reads + a genre-based filler ──
  // The four sources below are independent of each other, so they're fetched
  // concurrently and merged (in priority order) once all have resolved,
  // instead of awaiting one after another.
  async function buildRecommended(lib, ids, keys, myBooksList, friendIds, localProfileMap) {
    const [fromFriendPool, highlyRatedPool, authorPool, genrePool] = await Promise.all([
      (async () => {
        const { data: recs } = await supabase.from('book_recommendations').select('*, books(*)')
          .eq('to_user_id', userId).order('created_at', { ascending: false }).limit(15)
        if (!recs?.length) return []
        const fromIds = [...new Set(recs.map(r => r.from_user_id))]
        const { data: fromProfs } = await supabase.from('profiles').select('id, display_name, username').in('id', fromIds)
        const pm = Object.fromEntries((fromProfs || []).map(p => [p.id, p]))
        return recs.filter(r => r.books).map(r => ({
          ...r.books,
          reason: `Recommended by ${pm[r.from_user_id]?.display_name || pm[r.from_user_id]?.username || 'a friend'}`,
          source: 'from_friend',
        }))
      })(),
      (async () => {
        if (friendIds.length === 0) return []
        const { data: topFriendReads } = await supabase.from('user_books').select('*, books(*)')
          .in('user_id', friendIds).eq('rating', 5).limit(20)
        return (topFriendReads || []).filter(ub => ub.books).map(ub => {
          const p = localProfileMap[ub.user_id]
          return { ...ub.books, reason: `${p?.display_name || p?.username || 'A friend'} rated it ★★★★★`, source: 'highly_rated' }
        })
      })(),
      (async () => {
        try {
          const { data: follows } = await supabase.from('author_follows').select('author').eq('user_id', userId)
          if (!follows?.length) return []
          const author = follows[Math.floor(Math.random() * follows.length)].author
          const { results } = await searchBooks(`inauthor:"${author}"`, 10)
          return results.map(b => ({ ...b, reason: `More by ${author}`, source: 'genre' }))
        } catch (_) { return [] }
      })(),
      (async () => {
        try {
          const topRated  = lib.filter(u => (u.rating || 0) >= 4)
          const booksPool = topRated.length > 0 ? topRated : lib
          const cats      = [...new Set(booksPool.flatMap(u => u.books?.categories || []))]
          const fallback  = ['literary fiction', 'biography', 'history', 'mystery', 'science', 'fantasy']
          const pool      = cats.length > 0 ? cats : fallback
          const shuffled  = [...pool].sort(() => Math.random() - 0.5).slice(0, 2)
          // Two category searches also run in parallel with each other
          const perCat = await Promise.all(shuffled.map(cat =>
            searchBooks(`subject:"${cat}"`, 12).then(({ results }) =>
              results.map(b => ({ ...b, reason: `Because you liked ${cat}`, source: 'genre' })))
          ))
          return perCat.flat()
        } catch (_) { return [] }
      })(),
    ])

    const recPool = []
    const seen = new Set()
    for (const b of [...fromFriendPool, ...highlyRatedPool, ...authorPool, ...genrePool]) {
      if (!b?.id || seen.has(b.id) || isInMyLibrary(b, ids, keys, myBooksList)) continue
      seen.add(b.id)
      recPool.push(b)
    }
    setRecommended(recPool)
  }

  // ── Trending: privacy-safe aggregate across all users (see schema_trending.sql) ──
  async function buildTrending(ids, keys, myBooksList) {
    try {
      const { data: trend, error } = await supabase.rpc('get_trending_books', { days_back: 180, limit_count: 40 })
      if (!error && trend?.length) {
        const bookIds = trend.map(t => t.book_id)
        const { data: trendBooks } = await supabase.from('books').select('*').in('id', bookIds)
        const bookMap = Object.fromEntries((trendBooks || []).map(b => [b.id, b]))
        const merged = trend.map(t => ({ ...bookMap[t.book_id], adds: t.adds }))
          .filter(b => b.id && !isInMyLibrary(b, ids, keys, myBooksList))
        if (merged.length > 0) {
          setTrending(merged)
          return
        }
        throw new Error('no trending data yet')
      }
      throw new Error('trending RPC unavailable')
    } catch (_) {
      // Fallback (e.g. schema_trending.sql not run yet, or too little usage data so far):
      // surface currently-popular new releases instead of leaving the section empty.
      try {
        const { results } = await searchBooks('new york times bestseller 2026', 20)
        setTrending(results.filter(b => !isInMyLibrary(b, ids, keys, myBooksList)).map(b => ({ ...b, reason: 'Popular right now' })))
      } catch (_) { setTrending([]) }
    }
  }

  // ── Picks: curated stand-in lists (no NYT key needed — see PICKS_LISTS) ──
  async function buildPicks(ids, keys, myBooksList) {
    try {
      const shuffledLists = [...PICKS_LISTS].sort(() => Math.random() - 0.5).slice(0, 2)
      // Both list searches run in parallel with each other
      const perList = await Promise.all(shuffledLists.map(list =>
        searchBooks(list.query, 12).then(({ results }) =>
          results.map(b => ({ ...b, reason: list.label, listKey: list.key })))
      ))
      const picksPool = []
      const seen = new Set()
      for (const b of perList.flat()) {
        if (!b?.id || seen.has(b.id) || isInMyLibrary(b, ids, keys, myBooksList)) continue
        seen.add(b.id)
        picksPool.push(b)
      }
      setPicks(picksPool)
    } catch (_) { setPicks([]) }
  }

  const loadDiscoverData = useCallback(async () => {
    setLoading(true)

    const { data: myLib } = await supabase.from('user_books').select('*, books(*)').eq('user_id', userId)
    const lib = myLib || []
    const ids = new Set(lib.map(u => u.book_id))
    const keys = new Set(lib.map(u => bookKey(u.books)).filter(Boolean))
    const booksList = lib.map(u => u.books).filter(Boolean)
    setMyBookIds(ids)
    setMyBookKeys(keys)
    setMyBooks(booksList)

    // ── Friends' activity ──
    const { data: fships } = await supabase.from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted')

    let friendIds = []
    let localProfileMap = {}
    if (fships?.length > 0) {
      friendIds = fships.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
      const [{ data: acts }, { data: profs }] = await Promise.all([
        supabase.from('user_books').select('*, books(*)').in('user_id', friendIds)
          .order('updated_at', { ascending: false }).limit(60),
        supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', friendIds),
      ])
      localProfileMap = Object.fromEntries((profs || []).map(p => [p.id, p]))
      setFriendsFeed(acts || [])
      setProfileMap(localProfileMap)
    } else {
      setFriendsFeed([])
      setProfileMap({})
    }

    // The three sections below are independent of each other — load them
    // concurrently instead of chaining one after another. This is what used
    // to make Discover slow: up to ~6 sequential Google Books calls in a row.
    await Promise.all([
      buildRecommended(lib, ids, keys, booksList, friendIds, localProfileMap),
      buildTrending(ids, keys, booksList),
      buildPicks(ids, keys, booksList),
    ])

    setLoading(false)
  }, [userId])

  useEffect(() => { loadDiscoverData() }, [loadDiscoverData])

  function markAdded(id, book) {
    setMyBookIds(prev => new Set([...prev, id]))
    const key = bookKey(book)
    if (key) setMyBookKeys(prev => new Set([...prev, key]))
  }

  // ── Derived, filtered views ──
  const friendsGenres = topCategories(friendsFeed.map(ub => ub.books || {}))
  const friendsVisible = friendsFeed.filter(ub => {
    if (friendsFilter === 'reading' && ub.status !== 'reading') return false
    if (friendsFilter === 'want_to_read' && ub.status !== 'want_to_read') return false
    if (friendsFilter === 'highly_rated' && !((ub.rating || 0) >= 4)) return false
    if (friendsFilter === 'recent' && (Date.now() - new Date(ub.updated_at)) / 86400000 > 14) return false
    if (friendsGenre !== 'all' && !bookGenres(ub.books).includes(friendsGenre)) return false
    return true
  }).sort((a, b) => {
    // Books already on your own shelf are pushed to the very end, so the row
    // leads with things you haven't seen yet — then highly-rated first, then
    // most recently updated.
    const aOwned = isInMyLibrary(a.books, myBookIds, myBookKeys, myBooks)
    const bOwned = isInMyLibrary(b.books, myBookIds, myBookKeys, myBooks)
    if (aOwned !== bOwned) return aOwned ? 1 : -1
    const aRating = a.rating || 0, bRating = b.rating || 0
    if (aRating !== bRating) return bRating - aRating
    return new Date(b.updated_at) - new Date(a.updated_at)
  })

  const recGenres = topCategories(recommended)
  const recVisible = recommended.filter(b => {
    if (dismissedRecs.has(b.id)) return false
    if (recFilter === 'from_friend' && b.source !== 'from_friend') return false
    if (recFilter === 'highly_rated' && b.source !== 'highly_rated') return false
    if (recGenre !== 'all' && !bookGenres(b).includes(recGenre)) return false
    return true
  })

  const trendGenres = topCategories(trending)
  const trendVisible = trending.filter(b => {
    if (dismissedRecs.has(b.id)) return false
    if (trendGenre !== 'all' && !bookGenres(b).includes(trendGenre)) return false
    return true
  })

  const picksGenres = topCategories(picks)
  const picksVisible = picks.filter(b => {
    if (dismissedRecs.has(b.id)) return false
    if (picksFilter !== 'all' && b.listKey !== picksFilter) return false
    if (picksGenre !== 'all' && !bookGenres(b).includes(picksGenre)) return false
    return true
  })

  return (
    <div>
      {expanded && (
        <button onClick={() => setExpanded(null)} style={{
          background: C.surface2, border: `1px solid ${C.border}`, color: C.muted,
          borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
          fontFamily: f.sans, fontSize: 13, fontWeight: 600, marginBottom: 16,
        }}>← Back to Discover</button>
      )}

      {(!expanded || expanded === 'friends') && (
        <div style={{ marginBottom: 22 }}>
          <DiscoverSectionHeader icon="🍿" iconBg={C.primary} title="Friends" count={friendsVisible.length}
            onTitleClick={() => setExpanded(expanded === 'friends' ? null : 'friends')}
            filterOpen={showFriendsFilter} onFilterToggle={() => setShowFriendsFilter(o => !o)}
            tooltip="Books your friends are reading, want to read, highly rated, and finished recently" />
          {showFriendsFilter && (
            <DiscoverFilterPanel primaryLabel="Activity" primaryOptions={FRIENDS_FILTERS}
              primaryValue={friendsFilter} onPrimaryChange={setFriendsFilter}
              genreOptions={friendsGenres} genreValue={friendsGenre} onGenreChange={setFriendsGenre} />
          )}
          <DiscoverSectionBody expanded={expanded === 'friends'} loading={loading}
            items={friendsVisible} emptyMsg="Add friends to see what they're reading"
            renderItem={ub => (
              <FriendBookCard key={ub.id} ub={ub} profile={profileMap[ub.user_id]} userId={userId}
                myBookIds={myBookIds} myBookKeys={myBookKeys} myBooks={myBooks} onAdded={markAdded}
                onOpenModal={() => setModal({ book: ub.books })} />
            )} />
        </div>
      )}

      {(!expanded || expanded === 'recommended') && (
        <div style={{ marginBottom: 22 }}>
          <DiscoverSectionHeader icon="✨" iconBg={C.accent} title="Recommended" count={recVisible.length}
            onTitleClick={() => setExpanded(expanded === 'recommended' ? null : 'recommended')}
            filterOpen={showRecFilter} onFilterToggle={() => setShowRecFilter(o => !o)}
            tooltip="Recommended by friends, or books they've read and rated 5 stars" />
          {showRecFilter && (
            <DiscoverFilterPanel primaryLabel="Source" primaryOptions={RECOMMENDED_FILTERS}
              primaryValue={recFilter} onPrimaryChange={setRecFilter}
              genreOptions={recGenres} genreValue={recGenre} onGenreChange={setRecGenre} />
          )}
          <DiscoverSectionBody expanded={expanded === 'recommended'} loading={loading}
            items={recVisible} emptyMsg="Recommendations will show up here as you use the app"
            renderItem={book => (
              <RecoCard key={book.id} book={book} userId={userId} myBookIds={myBookIds} myBookKeys={myBookKeys} myBooks={myBooks}
                onAdded={(id, b) => { markAdded(id, b); loadDiscoverData() }}
                onDismiss={id => setDismissedRecs(prev => new Set([...prev, id]))}
                onOpenModal={() => setModal({ book })} caption={book.reason} />
            )} />
        </div>
      )}

      {(!expanded || expanded === 'trending') && (
        <div style={{ marginBottom: 22 }}>
          <DiscoverSectionHeader icon="🔥" iconBg={C.danger} title="Trending" count={trendVisible.length}
            onTitleClick={() => setExpanded(expanded === 'trending' ? null : 'trending')}
            filterOpen={showTrendFilter} onFilterToggle={() => setShowTrendFilter(o => !o)}
            tooltip="Books being added by the most BookList readers recently" />
          {showTrendFilter && (
            <DiscoverFilterPanel genreOptions={trendGenres} genreValue={trendGenre} onGenreChange={setTrendGenre} />
          )}
          <DiscoverSectionBody expanded={expanded === 'trending'} loading={loading}
            items={trendVisible} emptyMsg="Nothing trending right now."
            renderItem={book => (
              <RecoCard key={book.id} book={book} userId={userId} myBookIds={myBookIds} myBookKeys={myBookKeys} myBooks={myBooks}
                onAdded={(id, b) => { markAdded(id, b); loadDiscoverData() }}
                onDismiss={id => setDismissedRecs(prev => new Set([...prev, id]))}
                onOpenModal={() => setModal({ book })}
                caption={book.adds ? `${book.adds} readers added this` : book.reason} />
            )} />
        </div>
      )}

      {(!expanded || expanded === 'picks') && (
        <div style={{ marginBottom: 22 }}>
          <DiscoverSectionHeader icon="⭐" iconBg={C.accent} title="Picks" count={picksVisible.length}
            onTitleClick={() => setExpanded(expanded === 'picks' ? null : 'picks')}
            filterOpen={showPicksFilter} onFilterToggle={() => setShowPicksFilter(o => !o)}
            tooltip="Curated reading lists — best of the year, summer reads, award winners, and staff picks" />
          {showPicksFilter && (
            <DiscoverFilterPanel primaryLabel="List" primaryOptions={PICKS_FILTERS}
              primaryValue={picksFilter} onPrimaryChange={setPicksFilter}
              genreOptions={picksGenres} genreValue={picksGenre} onGenreChange={setPicksGenre} />
          )}
          <DiscoverSectionBody expanded={expanded === 'picks'} loading={loading}
            items={picksVisible} emptyMsg="Loading picks…"
            renderItem={book => (
              <RecoCard key={book.id} book={book} userId={userId} myBookIds={myBookIds} myBookKeys={myBookKeys} myBooks={myBooks}
                onAdded={(id, b) => { markAdded(id, b); loadDiscoverData() }}
                onDismiss={id => setDismissedRecs(prev => new Set([...prev, id]))}
                onOpenModal={() => setModal({ book })} caption={book.reason} />
            )} />
        </div>
      )}

      {modal && (
        <BookDetailModal
          item={modal.book}
          userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => loadDiscoverData()}
        />
      )}
    </div>
  )
}

// ================================================================
// My List page – poster grid with filter pills
// ================================================================
function MyListPage({ userId, initialFilter = 'all', lockedFilter = null, onBack }) {
  const isMobile = useIsMobile()
  const [filter,    setFilter]    = useState(initialFilter)
  const [userBooks, setUserBooks] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [showFilter, setShowFilter] = useState(false)
  const [readSort,  setReadSort]  = useState('default')
  const [readGenre, setReadGenre] = useState('all')

  const fetchBooks = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('user_books').select('*, books(*)')
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
    setUserBooks(data || [])
    setLoading(false)
    // Silently dedup then backfill missing covers, refresh if anything changed
    deduplicateLibrary(userId).then(removed => {
      const hasMissing = (data || []).some(u => !u.books?.cover_url)
      if (removed > 0) { fetchBooks(); return }
      if (hasMissing) fetchMissingCovers(userId).then(fixed => { if (fixed > 0) fetchBooks() })
    })
  }, [userId])

  useEffect(() => { fetchBooks() }, [fetchBooks])

  async function handleReorder(reordered) {
    setUserBooks(prev => {
      const nonWtr = prev.filter(u => u.status !== 'want_to_read')
      return [...nonWtr, ...reordered]
    })
    await Promise.all(
      reordered.map((ub, idx) =>
        supabase.from('user_books').update({ position: idx }).eq('id', ub.id)
      )
    )
  }

  const counts = {
    all:          userBooks.length,
    reading:      userBooks.filter(u => u.status === 'reading').length,
    read:         userBooks.filter(u => u.status === 'read').length,
    want_to_read: userBooks.filter(u => u.status === 'want_to_read').length,
    rated:        userBooks.filter(u => (u.rating || 0) > 0).length,
    favorites:    userBooks.filter(u => u.top_10).length,
  }

  const baseFiltered = filter === 'all' ? userBooks
    : filter === 'rated' ? userBooks.filter(u => (u.rating || 0) > 0)
    : filter === 'favorites' ? userBooks.filter(u => u.top_10)
    : userBooks.filter(u => u.status === filter)
  const matched = baseFiltered
  const isQueue = filter === 'want_to_read'
  const readGenres = useMemo(() => {
    if (filter !== 'read') return []
    return topCategories(matched.map(u => u.books || {}))
  }, [matched, filter])
  const genreFiltered = (filter === 'read' && readGenre !== 'all')
    ? matched.filter(u => bookGenres(u.books).includes(readGenre))
    : matched
  function sortDefault(list) {
    return [...list].sort((a, b) => {
      if (!!b.top_10 !== !!a.top_10) return b.top_10 ? 1 : -1
      return (b.rating || 0) - (a.rating || 0)
    })
  }
  // Sort: Top 10 first, then by rating desc — except in drag-reorder queue mode
  const visible = isQueue
    ? genreFiltered
    : filter === 'read' && readSort === 'recent'
    ? genreFiltered
    : filter === 'read' && readSort === 'top_rated'
    ? [...genreFiltered].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    : sortDefault(genreFiltered)

  // Drag for want_to_read queue — native drag on desktop, grip handle on touch
  const { dragIdx, overIdx, nativeDragProps, handleBind, tileProps } = useDragReorder(visible, handleReorder)

  return (
    <div>
      {onBack && (
        <button onClick={onBack} style={{
          background: C.surface2, border: `1px solid ${C.border}`, color: C.muted,
          borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
          fontFamily: f.sans, fontSize: 13, fontWeight: 600, marginBottom: 16,
        }}>← Back to Home</button>
      )}
      {(!lockedFilter || lockedFilter === 'read') && (
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setShowFilter(o => !o)} style={{ ...pill(showFilter), fontSize: 12 }}>
            Filter ▾
          </button>
          {showFilter && (
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: 14, marginTop: 10,
            }}>
              {!lockedFilter && (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                    textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Status</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: filter === 'read' ? 14 : 0 }}>
                    {[
                      ['all', 'All', counts.all],
                      ['reading', '▶ Reading', counts.reading],
                      ['read', '✅ Read', counts.read],
                      ['want_to_read', '👀 Want to Read', counts.want_to_read],
                      ['favorites', '🏆 Favorites', counts.favorites],
                    ].map(([key, lbl, count]) => (
                      <button key={key} onClick={() => setFilter(key)} style={pill(filter === key)}>
                        {lbl}
                        <span style={{
                          marginLeft: 6, fontSize: 11, fontFamily: f.sans, fontWeight: 700,
                          padding: '1px 6px', borderRadius: 10,
                          background: filter === key ? 'rgba(255,255,255,0.2)' : C.border,
                          color: filter === key ? C.white : C.muted,
                        }}>{count}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {filter === 'read' && (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                    textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Sort</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: readGenres.length > 0 ? 14 : 0 }}>
                    {READ_SORTS.map(([key, lbl]) => (
                      <button key={key} onClick={() => setReadSort(key)} style={pill(readSort === key)}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {readGenres.length > 0 && (
                    <>
                      <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                        textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Genre</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => setReadGenre('all')} style={{ ...pill(readGenre === 'all'), fontSize: 12 }}>
                          All
                        </button>
                        {readGenres.map(g => (
                          <button key={g} onClick={() => setReadGenre(g)} style={{ ...pill(readGenre === g), fontSize: 12 }}>
                            {g}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isQueue && visible.length > 1 && (
        <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
          ⠿ Press and hold a cover to drag and reorder your queue
        </p>
      )}

      {loading ? <Spinner /> : visible.length === 0
        ? <EmptyState message="Nothing here yet" sub='Search for books to add them to your library' />
        : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
            gap: isMobile ? 9 : 16,
          }}>
            {visible.map((ub, idx) => (
              <div key={ub.id}
                {...(isQueue ? tileProps(idx) : {})}
                {...(isQueue ? nativeDragProps(idx) : {})}
                style={{
                  position: 'relative',
                  opacity: isQueue && dragIdx === idx ? 0.4 : 1,
                  outline: isQueue && overIdx === idx && dragIdx !== idx ? `2px solid ${C.primary}` : 'none',
                  borderRadius: 10, transition: 'opacity 0.15s',
                  cursor: isQueue ? 'grab' : undefined,
                }}
              >
                <PosterCard
                  userBook={ub}
                  onClick={() => setModal(ub)}
                />
                {isQueue && (
                  <div {...handleBind(idx)} style={{
                    ...handleBind(idx).style,
                    position: 'absolute', bottom: 4, right: 4, width: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(10,8,24,0.75)', color: '#fff', fontSize: 14,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'grab', zIndex: 2, WebkitTapHighlightColor: 'transparent',
                  }}>⠿</div>
                )}
              </div>
            ))}
          </div>
        )
      }

      {modal && (
        <BookDetailModal
          item={modal}
          userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => fetchBooks()}
        />
      )}
    </div>
  )
}

// ================================================================
// FriendListView – full-page view of a single friend's library
// ================================================================
function FriendListView({ friendProfile, userId, myBookIds, setMyBookIds, myBookKeys, setMyBookKeys, myBooks, setMyBooks, onBack }) {
  const isMobile = useIsMobile()
  const friendId = friendProfile.id
  const [books,       setBooks]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [addingBook,  setAddingBook]  = useState(null)
  const [modal,       setModal]       = useState(null)
  const [hoveredId,   setHoveredId]   = useState(null)
  const [showReadFilter, setShowReadFilter] = useState(false)
  const [readSort,     setReadSort]     = useState('default')
  const [readGenre,    setReadGenre]    = useState('all')
  const [readFavOnly,  setReadFavOnly]  = useState(false)
  const [expandReading,     setExpandReading]     = useState(false)
  const [expandWantToRead,  setExpandWantToRead]  = useState(false)
  const [expandRead,        setExpandRead]        = useState(true) // Read defaults open; count is still clickable to collapse
  const hideTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  useEffect(() => {
    supabase.from('user_books').select('*, books(*)')
      .eq('user_id', friendId).order('updated_at', { ascending: false })
      .then(({ data }) => { setBooks(data || []); setLoading(false) })
  }, [friendId])

  async function quickAdd(book, status) {
    setAddingBook(book.id + status)
    try {
      await addToLibrary(userId, book, status)
      setMyBookIds(prev => new Set([...prev, book.id]))
      const key = bookKey(book)
      if (key) setMyBookKeys(prev => new Set([...prev, key]))
      setMyBooks(prev => [...prev, book])
    } catch (e) { alert(e.message) }
    setAddingBook(null)
  }

  // Refreshes which books are on MY shelf (used for the "in library" state on
  // this friend's tiles) after the detail modal changes my own status for a book.
  // Fetches full book data (not just IDs) so the fuzzy title|author fallback
  // in isInMyLibrary() can catch the same book saved under a different edition's ID.
  async function refreshMyBooks() {
    const { data } = await supabase.from('user_books').select('*, books(*)').eq('user_id', userId)
    const lib = data || []
    setMyBookIds(new Set(lib.map(r => r.book_id)))
    setMyBookKeys(new Set(lib.map(r => bookKey(r.books)).filter(Boolean)))
    setMyBooks(lib.map(r => r.books).filter(Boolean))
  }

  const reading    = books.filter(u => u.status === 'reading')
  const wantToRead = books.filter(u => u.status === 'want_to_read')
  const readAll    = books.filter(u => u.status === 'read')
  const readGenres = useMemo(() => topCategories(readAll.map(u => u.books || {})), [books])
  const read = (() => {
    let list = readGenre === 'all' ? readAll : readAll.filter(u => bookGenres(u.books).includes(readGenre))
    if (readFavOnly) list = list.filter(u => u.top_10)
    if (readSort === 'recent') return list
    if (readSort === 'top_rated') return [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    return [...list].sort((a, b) => {
      if (!!b.top_10 !== !!a.top_10) return b.top_10 ? 1 : -1
      return (b.rating || 0) - (a.rating || 0)
    })
  })()

  function renderTile(ub) {
    const book      = ub.books || {}
    const inLibrary = isInMyLibrary(book, myBookIds, myBookKeys, myBooks)
    const isHovered = hoveredId === ub.id

    // Mobile has no hover — tap reveals the action icons for a couple seconds,
    // then they auto-hide (matches WatchList). Tapping again while revealed opens the modal.
    function handleTap() {
      if (isMobile && !inLibrary && !isHovered) {
        setHoveredId(ub.id)
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = setTimeout(() => setHoveredId(null), 2500)
        return
      }
      setModal(book)
    }

    return (
      <div key={ub.id}
        onMouseEnter={() => setHoveredId(ub.id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{ position: 'relative' }}
      >
        <PosterCard userBook={ub} onClick={handleTap} />

        {/* Hover overlay — icons only, matching Discover's style. Only rendered
            when NOT already in your library, so there's nothing sitting on top
            of the tile to block the click-to-open-modal for books you already have. */}
        {isHovered && !inLibrary && (
          <div onClick={() => setModal(book)} style={{
            position: 'absolute', inset: 0, borderRadius: 8,
            background: 'rgba(10,8,24,0.72)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-end',
            paddingBottom: 14,
          }}>
            <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
              {[
                ['reading',      STATUS_ICONS.reading],
                ['want_to_read', STATUS_ICONS.want_to_read],
                ['read',         STATUS_ICONS.read],
              ].map(([st, icon]) => (
                <button key={st} title={STATUS_LABELS[st]} disabled={!!addingBook}
                  onClick={() => quickAdd(book, st)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', border: 'none',
                    background: STATUS_COLORS[st].color, color: '#0f1117',
                    cursor: addingBook ? 'not-allowed' : 'pointer', fontSize: 13,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    opacity: addingBook && addingBook !== book.id + st ? 0.5 : 1,
                    transition: 'transform 0.1s, opacity 0.1s',
                    transform: addingBook === book.id + st ? 'scale(0.9)' : 'scale(1)',
                  }}>
                  {addingBook === book.id + st ? '…' : icon}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <button onClick={onBack} style={{
          background: C.surface2, border: `1px solid ${C.border}`, color: C.muted,
          borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
          fontFamily: f.sans, fontSize: 13, fontWeight: 600,
        }}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: `linear-gradient(135deg, ${C.primaryDim}, ${C.surface2})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, border: `2px solid ${C.border}`,
          }}>
            {friendProfile.avatar_url || '👤'}
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 17, color: C.text, fontFamily: f.sans }}>
              {friendProfile.display_name || friendProfile.username}'s List
            </p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans }}>
              {books.length} titles total
            </p>
          </div>
        </div>
      </div>

      {!expandReading ? (
        <HorizontalRow
          title="Reading"
          icon="▶"
          iconBg={STATUS_COLORS.reading.color}
          items={reading}
          renderItem={renderTile}
          loading={loading}
          emptyMsg="Not reading anything right now"
          seeAllAction={() => setExpandReading(true)}
        />
      ) : (
        <div style={{ marginBottom: 22 }}>
          <button onClick={() => setExpandReading(false)} style={{
            display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
            padding: 0, margin: '0 0 14px', cursor: 'pointer', fontFamily: f.sans,
          }}>
            <SectionBadge icon="▶" bg={STATUS_COLORS.reading.color} />
            <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>Reading</h2>
            <CountPill n={reading.length} />
            <span style={{ color: C.muted, fontSize: 13 }}>‹ collapse</span>
          </button>
          {loading ? <Spinner /> : reading.length === 0
            ? <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
                Not reading anything right now
              </p>
            : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
                gap: isMobile ? 9 : 16,
              }}>
                {reading.map(renderTile)}
              </div>
            )
          }
        </div>
      )}

      {!expandWantToRead ? (
        <HorizontalRow
          title="Want to Read"
          icon="👀"
          iconBg={C.accent}
          items={wantToRead}
          renderItem={renderTile}
          loading={loading}
          emptyMsg="Nothing on the want-to-read list"
          seeAllAction={() => setExpandWantToRead(true)}
        />
      ) : (
        <div style={{ marginBottom: 22 }}>
          <button onClick={() => setExpandWantToRead(false)} style={{
            display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
            padding: 0, margin: '0 0 14px', cursor: 'pointer', fontFamily: f.sans,
          }}>
            <SectionBadge icon="👀" bg={C.accent} />
            <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>Want to Read</h2>
            <CountPill n={wantToRead.length} />
            <span style={{ color: C.muted, fontSize: 13 }}>‹ collapse</span>
          </button>
          {loading ? <Spinner /> : wantToRead.length === 0
            ? <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
                Nothing on the want-to-read list
              </p>
            : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
                gap: isMobile ? 9 : 16,
              }}>
                {wantToRead.map(renderTile)}
              </div>
            )
          }
        </div>
      )}

      {/* Read — count is clickable to collapse/expand, same as Reading/Want to Read above */}
      {!expandRead ? (
        <HorizontalRow
          title="Read"
          icon="✅"
          iconBg={C.success}
          items={read}
          renderItem={renderTile}
          loading={loading}
          emptyMsg="Nothing marked as read yet"
          seeAllAction={() => setExpandRead(true)}
        />
      ) : (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setExpandRead(false)} style={{
              display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
              padding: 0, margin: 0, cursor: 'pointer', fontFamily: f.sans,
            }}>
              <SectionBadge icon="✅" bg={C.success} />
              <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>Read</h2>
              <CountPill n={read.length} />
              <span style={{ color: C.muted, fontSize: 13 }}>‹ collapse</span>
            </button>
            <button onClick={() => setShowReadFilter(o => !o)} style={{ ...pill(showReadFilter), fontSize: 12 }}>
              Filter ▾
            </button>
          </div>

          {showReadFilter && (
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: 14, marginBottom: 16,
            }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Sort</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: readGenres.length > 0 ? 14 : 0 }}>
                {READ_SORTS.map(([key, lbl]) => (
                  <button key={key} onClick={() => setReadSort(key)} style={pill(readSort === key)}>
                    {lbl}
                  </button>
                ))}
                <button onClick={() => setReadFavOnly(o => !o)} style={{ ...pill(readFavOnly), fontSize: 12 }}>
                  🏆 Favorites
                </button>
              </div>
              {readGenres.length > 0 && (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                    textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Genre</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => setReadGenre('all')} style={{ ...pill(readGenre === 'all'), fontSize: 12 }}>
                      All
                    </button>
                    {readGenres.map(g => (
                      <button key={g} onClick={() => setReadGenre(g)} style={{ ...pill(readGenre === g), fontSize: 12 }}>
                        {g}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {loading ? <Spinner /> : read.length === 0
            ? <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
                {readFavOnly ? "No favorites yet" : "Nothing marked as read yet"}
              </p>
            : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
                gap: isMobile ? 9 : 16,
              }}>
                {read.map(renderTile)}
              </div>
            )
          }
        </div>
      )}

      {modal && (
        <BookDetailModal item={modal} userId={userId}
          onClose={() => setModal(null)}
          onUpdate={refreshMyBooks} />
      )}
    </div>
  )
}

// ================================================================
// RecommendPopover – send a book from your library to a friend
// ================================================================
function RecommendPopover({ userId, friend, onClose }) {
  const [books,  setBooks]  = useState(null)
  const [q,      setQ]      = useState('')
  const [sentId, setSentId] = useState(null)

  useEffect(() => {
    supabase.from('user_books').select('*, books(*)').eq('user_id', userId)
      .order('rating', { ascending: false })
      .then(({ data }) => setBooks(data || []))
  }, [userId])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function send(book) {
    setSentId(book.id)
    await supabase.from('book_recommendations').insert({
      from_user_id: userId, to_user_id: friend.id, book_id: book.id,
    })
    setTimeout(onClose, 900)
  }

  const ql = q.toLowerCase()
  const visible = (books || []).filter(ub =>
    !ql || (ub.books?.title || '').toLowerCase().includes(ql)
        || (ub.books?.authors || []).join(' ').toLowerCase().includes(ql))

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(5,4,15,0.88)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: C.surface, borderRadius: 14, padding: 24, maxWidth: 400, width: '100%',
        maxHeight: '78vh', display: 'flex', flexDirection: 'column',
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 18 }}>
            Send a book to {friend?.display_name || friend?.username}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search your library…"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {books === null ? <Spinner /> : visible.length === 0
            ? <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
                No books match.
              </p>
            : visible.map(ub => (
              <div key={ub.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '8px 0', borderBottom: `1px solid ${C.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{
                    fontSize: 13, color: C.text, fontFamily: f.sans, fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{ub.books?.title}</span>
                  {ub.rating > 0 && (
                    <span style={{ fontSize: 11, color: C.star, flexShrink: 0 }}>{'★'.repeat(ub.rating)}</span>
                  )}
                </div>
                {sentId === ub.books?.id
                  ? <span style={{ fontSize: 12, color: C.success, fontWeight: 700, fontFamily: f.sans, flexShrink: 0 }}>✓ Sent</span>
                  : <button onClick={() => send(ub.books)} style={{ ...btn('ghost', 'sm'), flexShrink: 0 }}>Send</button>}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ================================================================
// Friends page
// ================================================================
const FRIEND_STATUS_FILTERS = [
  ['all',          'All'],
  ['reading',      '▶ Reading'],
  ['want_to_read', '👀 Want to Read'],
  ['highly_rated', '⭐ Highly Rated'],
  ['favorites',    '🏆 Favorites'],
  ['recent',       '🕐 Recent'],
]

function FriendsPage({ userId }) {
  const isMobile = useIsMobile()
  const [searchQ,      setSearchQ]      = useState('')
  const [searchRes,    setSearchRes]    = useState([])
  const [searching,    setSearching]    = useState(false)
  const [friends,      setFriends]      = useState([])
  const [incoming,     setIncoming]     = useState([])
  const [outgoing,     setOutgoing]     = useState([])
  const [profileMap,   setProfileMap]   = useState({})
  const [loading,      setLoading]      = useState(true)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [friendView,   setFriendView]   = useState(null) // friendProfile being viewed
  const [myBookIds,    setMyBookIds]    = useState(new Set())
  const [myBookKeys,   setMyBookKeys]   = useState(new Set()) // normalized title|author fallback match
  const [myBooks,      setMyBooks]      = useState([]) // fuzzy-title fallback match, for cross-edition duplicates
  const [modal,        setModal]        = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showShelfFilter, setShowShelfFilter] = useState(false)
  const [friendBooks,  setFriendBooks]  = useState([])
  const [shelfLoading, setShelfLoading] = useState(true)
  const [tasteMap,     setTasteMap]     = useState({}) // friendId -> match %
  const [recommendTo,  setRecommendTo]  = useState(null) // friendProfile being sent a book
  const [hoveredShelfId, setHoveredShelfId] = useState(null) // aggregated shelf grid — tile being hovered
  const [shelfAdding,    setShelfAdding]    = useState(null) // aggregated shelf grid — `${bookId}${status}` in flight
  const shelfHideTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(shelfHideTimerRef.current), [])

  // Shared lists (book-club style) — owned by me, or shared with me by a friend
  const [lists,        setLists]        = useState([])
  const [listsLoading,  setListsLoading]  = useState(true)
  const [listView,     setListView]     = useState(null) // list being viewed in detail
  const [showNewList,  setShowNewList]  = useState(false)
  const [manageList,   setManageList]   = useState(null) // list being managed (rename/members/add/delete)

  const loadLists = useCallback(async () => {
    setListsLoading(true)
    const [{ data: owned }, { data: sharedRows }] = await Promise.all([
      supabase.from('book_lists').select('*').eq('owner_id', userId).order('created_at', { ascending: false }),
      supabase.from('book_list_shares').select('book_lists(*)').eq('user_id', userId),
    ])
    const shared = (sharedRows || []).map(r => r.book_lists).filter(Boolean)
    const merged = [
      ...(owned || []).map(l => ({ ...l, isOwner: true })),
      ...shared.map(l => ({ ...l, isOwner: false })),
    ]
    // Item counts, fetched in one shot for all lists at once
    if (merged.length > 0) {
      const { data: counts } = await supabase.from('book_list_items')
        .select('list_id').in('list_id', merged.map(l => l.id))
      const countMap = {}
      ;(counts || []).forEach(r => { countMap[r.list_id] = (countMap[r.list_id] || 0) + 1 })
      merged.forEach(l => { l.itemCount = countMap[l.id] || 0 })
    }
    setLists(merged)
    setListsLoading(false)
  }, [userId])

  useEffect(() => { loadLists() }, [loadLists])

  async function quickAddToShelf(book, status) {
    setShelfAdding(book.id + status)
    try {
      await addToLibrary(userId, book, status)
      setMyBookIds(prev => new Set([...prev, book.id]))
      const key = bookKey(book)
      if (key) setMyBookKeys(prev => new Set([...prev, key]))
      setMyBooks(prev => [...prev, book])
    } catch (e) { alert(e.message) }
    setShelfAdding(null)
  }

  function copyInviteLink() {
    const link = `${window.location.origin}${window.location.pathname}?invite=${userId}`
    navigator.clipboard.writeText(link).then(() => {
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2500)
    })
  }

  const loadFriendships = useCallback(async () => {
    setLoading(true)
    // Load my full library (with genres) for quick-add comparison + taste-match calc
    const { data: myLibFull } = await supabase.from('user_books').select('*, books(*)').eq('user_id', userId)
    setMyBookIds(new Set((myLibFull || []).map(r => r.book_id)))
    // Fuzzy fallback (title|author, and close-title matching) for the same
    // real-world book saved under a different edition's ID than a friend's
    // copy — see isInMyLibrary(). Without this, "already in my library"
    // checks below can miss books you already have under a different ID.
    setMyBookKeys(new Set((myLibFull || []).map(r => bookKey(r.books)).filter(Boolean)))
    setMyBooks((myLibFull || []).map(r => r.books).filter(Boolean))

    const { data: fships } = await supabase.from('friendships').select('*')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    if (!fships) { setLoading(false); setShelfLoading(false); return }

    const allIds = [...new Set(fships.flatMap(f => [f.requester_id, f.addressee_id]))]
    const { data: profiles } = await supabase.from('profiles').select('*').in('id', allIds)
    const pm = Object.fromEntries((profiles || []).map(p => [p.id, p]))
    setProfileMap(pm)

    const accepted = fships.filter(f => f.status === 'accepted')
    const pend     = fships.filter(f => f.status === 'pending')
    setFriends(accepted.map(f => ({
      ...f,
      friendId:      f.requester_id === userId ? f.addressee_id : f.requester_id,
      friendProfile: pm[f.requester_id === userId ? f.addressee_id : f.requester_id],
    })))
    setIncoming(pend.filter(f => f.addressee_id === userId).map(f => ({ ...f, requesterProfile: pm[f.requester_id] })))
    setOutgoing(pend.filter(f => f.requester_id === userId).map(f => ({ ...f, addresseeProfile: pm[f.addressee_id] })))
    setLoading(false)

    // Friends' shelf — aggregated books across all accepted friends.
    // Was capped at .limit(100) across ALL friends combined, so a single friend
    // with a large library (e.g. 248 Read alone) could silently crowd out most
    // of everyone else's books — the "100" was just the query cap, not a real
    // total. Paginate in batches of 1000 (Supabase's per-request row cap) until
    // everything is fetched, so the count here actually reflects every book.
    if (accepted.length > 0) {
      const friendIds = accepted.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
      let fBooks = []
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data: page } = await supabase.from('user_books').select('*, books(*)')
          .in('user_id', friendIds).order('updated_at', { ascending: false })
          .range(from, from + PAGE - 1)
        fBooks = fBooks.concat(page || [])
        if (!page || page.length < PAGE) break
        from += PAGE
      }
      setFriendBooks(fBooks)

      // Taste-match % — pull each friend's full shelf (lightweight, genres only) and
      // compare against mine via genre-overlap + shared-books.
      const { data: fGenreRows } = await supabase.from('user_books')
        .select('user_id, book_id, books(categories)').in('user_id', friendIds)
      const tm = {}
      friendIds.forEach(fid => {
        const theirs = (fGenreRows || []).filter(u => u.user_id === fid)
        tm[fid] = computeTasteMatch(myLibFull || [], theirs)
      })
      setTasteMap(tm)
    } else {
      setFriendBooks([])
      setTasteMap({})
    }
    setShelfLoading(false)
  }, [userId])

  useEffect(() => { loadFriendships() }, [loadFriendships])

  async function searchUsers(e) {
    e?.preventDefault()
    if (!searchQ.trim()) return
    setSearching(true)
    const { data } = await supabase.from('profiles').select('*')
      .or(`username.ilike.%${searchQ}%,display_name.ilike.%${searchQ}%`)
      .neq('id', userId).limit(8)
    setSearchRes(data || [])
    setSearching(false)
  }

  async function sendRequest(addresseeId) {
    const { error } = await supabase.from('friendships').insert({ requester_id: userId, addressee_id: addresseeId })
    if (error) { alert(error.message); return }
    setSearchRes([]); setSearchQ(''); loadFriendships()
  }

  async function respond(id, status) {
    await supabase.from('friendships').update({ status }).eq('id', id)
    loadFriendships()
  }

  async function remove(id) {
    await supabase.from('friendships').delete().eq('id', id)
    loadFriendships()
  }

  const connected = new Set([
    ...friends.map(f => f.friendId),
    ...incoming.map(f => f.requester_id),
    ...outgoing.map(f => f.addressee_id),
  ])

  const shelfVisible = friendBooks.filter(ub => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'highly_rated') return (ub.rating || 0) >= 4
    if (statusFilter === 'favorites') return !!ub.top_10
    if (statusFilter === 'recent') return true // already sorted by updated_at desc
    return ub.status === statusFilter
  }).sort((a, b) => {
    // Default order: Top 10 picks first, then highest rated, then most recent.
    if (!!b.top_10 !== !!a.top_10) return b.top_10 ? 1 : -1
    const aRating = a.rating || 0, bRating = b.rating || 0
    if (aRating !== bRating) return bRating - aRating
    return new Date(b.updated_at) - new Date(a.updated_at)
  })

  // If viewing a friend's full list, render that component
  if (friendView) {
    return (
      <FriendListView
        friendProfile={friendView}
        userId={userId}
        myBookIds={myBookIds}
        setMyBookIds={setMyBookIds}
        myBookKeys={myBookKeys}
        setMyBookKeys={setMyBookKeys}
        myBooks={myBooks}
        setMyBooks={setMyBooks}
        onBack={() => setFriendView(null)}
      />
    )
  }

  // If viewing a shared list's full detail, render that component
  if (listView) {
    return (
      <ListDetailView
        list={listView}
        userId={userId}
        friends={friends}
        myBookIds={myBookIds}
        onBack={() => setListView(null)}
        onListChanged={loadLists}
      />
    )
  }

  return (
    <div>
      <Accordion icon="✉️" title="Invite a Friend">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans, flex: 1, minWidth: 180 }}>
            Share your personal invite link — they'll be auto-connected when they sign up.
          </p>
          <button onClick={copyInviteLink}
            style={{ ...btn(inviteCopied ? 'subtle' : 'accent', 'sm'), flexShrink: 0 }}>
            {inviteCopied ? '✓ Copied!' : '🔗 Copy Link'}
          </button>
        </div>
      </Accordion>

      <Accordion icon="🔭" title="Find a Friend">
        <form onSubmit={searchUsers} style={{ display: 'flex', gap: 8, marginBottom: searchRes.length ? 10 : 0 }}>
          <input style={{ ...inputStyle, flex: 1 }} value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search by username or name…" />
          <button type="submit" style={btn('primary', 'sm')} disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </form>
        {searchRes.map(p => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 0', borderBottom: `1px solid ${C.border}`,
          }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: C.text, fontFamily: f.sans, fontSize: 14 }}>
                {p.display_name || p.username}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans }}>@{p.username}</p>
            </div>
            {connected.has(p.id)
              ? <span style={{ fontSize: 12, color: C.muted, fontFamily: f.sans }}>Already connected</span>
              : <button onClick={() => sendRequest(p.id)} style={btn('primary', 'sm')}>Add Friend</button>
            }
          </div>
        ))}

        {incoming.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.muted, fontFamily: f.sans,
              textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              📬 Requests ({incoming.length})
            </p>
            {incoming.map(f => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: `1px solid ${C.border}`,
              }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, color: C.text, fontFamily: f.sans }}>
                    {f.requesterProfile?.display_name || f.requesterProfile?.username || 'Unknown'}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans }}>
                    @{f.requesterProfile?.username}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => respond(f.id, 'accepted')} style={btn('primary', 'sm')}>Accept</button>
                  <button onClick={() => respond(f.id, 'declined')} style={btn('danger', 'sm')}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {outgoing.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.muted, fontFamily: f.sans,
              textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sent Requests</p>
            {outgoing.map(f => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: `1px solid ${C.border}`,
              }}>
                <div>
                  <p style={{ margin: 0, color: C.text, fontFamily: f.sans }}>
                    {f.addresseeProfile?.display_name || f.addresseeProfile?.username || 'Unknown'}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans }}>Pending…</p>
                </div>
                <button onClick={() => remove(f.id)} style={btn('subtle', 'sm')}>Cancel</button>
              </div>
            ))}
          </div>
        )}
      </Accordion>

      <Accordion icon="📋" title={`Lists (${lists.length})`}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans, flex: 1, minWidth: 180 }}>
            Curate a shared reading list — for a book club, a trip, or anything else — and share it with friends.
          </p>
          <button onClick={() => setShowNewList(true)} style={{ ...btn('accent', 'sm'), flexShrink: 0 }}>
            + New List
          </button>
        </div>

        {listsLoading ? <Spinner /> : lists.length === 0
          ? <EmptyState icon="📋" message="No lists yet" sub="Create one to start planning a shared shelf" />
          : lists.map(list => (
              <div key={list.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0', borderBottom: `1px solid ${C.border}`, gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <button onClick={() => setListView(list)} title="View List" style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    lineHeight: 0, borderRadius: '50%', flexShrink: 0,
                  }}>
                    <SectionBadge icon="📋" bg={C.accent} />
                  </button>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: C.text, fontFamily: f.sans }}>
                      {list.name}
                      {list.isOwner && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: C.muted, background: C.surface2,
                          borderRadius: 6, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>Owner</span>
                      )}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
                      {list.itemCount} book{list.itemCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {list.isOwner && (
                    <button onClick={() => setManageList(list)} style={{ ...btn('subtle', 'sm'), fontSize: 13 }}>
                      ⚙️ Manage
                    </button>
                  )}
                  <button onClick={() => setListView(list)} style={{ ...btn('ghost', 'sm'), fontSize: 13 }}>
                    View →
                  </button>
                </div>
              </div>
            ))
        }
      </Accordion>

      {showNewList && (
        <CreateListModal userId={userId} onClose={() => setShowNewList(false)}
          onCreated={(list) => { setShowNewList(false); loadLists(); setListView({ ...list, isOwner: true, itemCount: 0 }) }} />
      )}

      {manageList && (
        <ManageListModal list={manageList} userId={userId} friends={friends}
          onClose={() => setManageList(null)}
          onRenamed={(updated) => { setManageList(updated); loadLists() }}
          onDeleted={() => { setManageList(null); loadLists() }} />
      )}

      <Accordion icon="🍿" title={`Your Friends (${friends.length})`} defaultOpen>
        {loading ? <Spinner /> : friends.length === 0
          ? <EmptyState icon="👥" message="No friends yet" sub="Search above to find other readers" />
          : [...friends].sort((a, b) => (tasteMap[b.friendId] || 0) - (tasteMap[a.friendId] || 0)).map(f => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0', borderBottom: `1px solid ${C.border}`, gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button onClick={() => setFriendView(f.friendProfile)}
                    title="View List" style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      lineHeight: 0, borderRadius: '50%',
                    }}>
                    <TasteMatchRing pct={tasteMap[f.friendId] || 0} avatar={f.friendProfile?.avatar_url} />
                  </button>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: C.text, fontFamily: f.sans }}>
                      {f.friendProfile?.display_name || f.friendProfile?.username || 'Unknown'}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  <button onClick={() => setFriendView(f.friendProfile)}
                    style={{ ...btn('ghost', 'sm'), fontSize: 13 }}>
                    View List →
                  </button>
                  <button onClick={() => setRecommendTo(f.friendProfile)}
                    title="Send a book"
                    style={{
                      width: 32, height: 32, borderRadius: '50%', border: `1px solid ${C.border}`,
                      background: C.surface2, color: C.primary, cursor: 'pointer', fontSize: 14,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>✈️</button>
                  <button onClick={() => remove(f.id)}
                    title="Unfriend"
                    style={{
                      width: 24, height: 24, border: 'none', background: 'none',
                      color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0,
                    }}>⋯</button>
                </div>
              </div>
            ))
        }
      </Accordion>

      {recommendTo && (
        <RecommendPopover userId={userId} friend={recommendTo} onClose={() => setRecommendTo(null)} />
      )}

      {/* Aggregated friends' shelf */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '28px 0 14px', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SectionBadge icon="👥" bg={C.primary} />
          <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>Friends</h2>
          <button onClick={() => setShowShelfFilter(o => !o)} style={{
            background: 'none', border: 'none', color: C.primary, fontFamily: f.sans,
            fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline',
          }}>
            {shelfVisible.length}
          </button>
        </div>
        <button onClick={() => setShowShelfFilter(o => !o)} style={{ ...pill(showShelfFilter), fontSize: 12 }}>
          Filter ▾
        </button>
      </div>

      {showShelfFilter && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: 14, marginBottom: 20,
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Filter</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {FRIEND_STATUS_FILTERS.map(([key, lbl]) => (
              <button key={key} onClick={() => setStatusFilter(key)} style={pill(statusFilter === key)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {shelfLoading ? <Spinner /> : shelfVisible.length === 0
        ? <EmptyState icon="📚" message="Nothing here yet" sub="Add friends to see what they're reading" />
        : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
            gap: isMobile ? 9 : 16,
          }}>
            {shelfVisible.map(ub => {
              const book = ub.books || {}
              const inLibrary = isInMyLibrary(book, myBookIds, myBookKeys, myBooks)
              const isHovered = hoveredShelfId === ub.id

              // Mobile has no hover — tap reveals the action icons for a couple
              // seconds, then they auto-hide (matches WatchList). Tapping again
              // while revealed opens the modal.
              function handleTap() {
                if (isMobile && !inLibrary && !isHovered) {
                  setHoveredShelfId(ub.id)
                  clearTimeout(shelfHideTimerRef.current)
                  shelfHideTimerRef.current = setTimeout(() => setHoveredShelfId(null), 2500)
                  return
                }
                setModal({ book: ub.books, userBook: ub })
              }

              return (
                <div key={ub.id}
                  onMouseEnter={() => setHoveredShelfId(ub.id)}
                  onMouseLeave={() => setHoveredShelfId(null)}
                  style={{ position: 'relative' }}
                >
                  <PosterCard userBook={ub} onClick={handleTap} />

                  {/* Hover icons — only shown if not already on your shelf, so
                      there's nothing blocking the click-to-open-modal otherwise. */}
                  {isHovered && !inLibrary && (
                    <div onClick={() => setModal({ book: ub.books, userBook: ub })} style={{
                      position: 'absolute', inset: 0, borderRadius: 8,
                      background: 'rgba(10,8,24,0.72)',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'flex-end',
                      paddingBottom: 14,
                    }}>
                      <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                        {[
                          ['reading',      STATUS_ICONS.reading],
                          ['want_to_read', STATUS_ICONS.want_to_read],
                          ['read',         STATUS_ICONS.read],
                        ].map(([st, icon]) => (
                          <button key={st} title={STATUS_LABELS[st]} disabled={!!shelfAdding}
                            onClick={() => quickAddToShelf(book, st)}
                            style={{
                              width: 30, height: 30, borderRadius: '50%', border: 'none',
                              background: STATUS_COLORS[st].color, color: '#0f1117',
                              cursor: shelfAdding ? 'not-allowed' : 'pointer', fontSize: 13,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                              opacity: shelfAdding && shelfAdding !== book.id + st ? 0.5 : 1,
                              transition: 'transform 0.1s, opacity 0.1s',
                              transform: shelfAdding === book.id + st ? 'scale(0.9)' : 'scale(1)',
                            }}>
                            {shelfAdding === book.id + st ? '…' : icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }

      {modal && (
        <BookDetailModal item={modal.book} userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => loadFriendships()} />
      )}
    </div>
  )
}

// ================================================================
// CreateListModal – name + description, creates a new shared list
// ================================================================
function CreateListModal({ userId, onClose, onCreated }) {
  const isMobile = useIsMobile()
  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [saving,       setSaving]      = useState(false)
  const [err,          setErr]         = useState(null)

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    setErr(null)
    try {
      const { data, error } = await supabase.rpc('create_book_list', {
        p_name: name.trim(),
        p_description: description.trim() || null,
      })
      if (error) throw error
      onCreated?.(data)
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center', padding: isMobile ? 0 : 20,
      }}>
      <div style={{
        background: C.surface, width: '100%', maxWidth: isMobile ? '100%' : 440,
        borderRadius: isMobile ? '16px 16px 0 0' : 14,
        padding: isMobile ? '20px 16px 28px' : 24,
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <h3 style={{ margin: '0 0 16px', color: C.text, fontFamily: f.serif, fontSize: 20 }}>📋 New List</h3>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="List name — e.g. Book Club Picks"
          style={{ ...inputStyle, marginBottom: 10 }} />
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3} style={{ ...inputStyle, resize: 'vertical', marginBottom: 14 }} />
        {err && <p style={{ margin: '0 0 10px', color: C.danger, fontSize: 12, fontFamily: f.sans }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('subtle', 'sm')}>Cancel</button>
          <button onClick={handleCreate} disabled={saving || !name.trim()} style={btn('accent', 'sm')}>
            {saving ? 'Creating…' : 'Create List'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ================================================================
// ShareListModal – owner picks which friends can see/edit a list
// ================================================================
function ShareListModal({ list, userId, friends, onClose }) {
  const isMobile = useIsMobile()
  const [sharedIds, setSharedIds] = useState(new Set())
  const [loading,   setLoading]   = useState(true)
  const [busyId,    setBusyId]    = useState(null)

  useEffect(() => {
    supabase.from('book_list_shares').select('user_id').eq('list_id', list.id)
      .then(({ data }) => {
        setSharedIds(new Set((data || []).map(r => r.user_id)))
        setLoading(false)
      })
  }, [list.id])

  async function toggle(friendId) {
    setBusyId(friendId)
    try {
      if (sharedIds.has(friendId)) {
        const { error } = await supabase.rpc('unshare_list', { p_list_id: list.id, p_user_id: friendId })
        if (error) throw error
        setSharedIds(prev => { const n = new Set(prev); n.delete(friendId); return n })
      } else {
        const { error } = await supabase.rpc('share_list_with', { p_list_id: list.id, p_user_id: friendId })
        if (error) throw error
        setSharedIds(prev => new Set([...prev, friendId]))
      }
    } catch (e) { alert(e.message) }
    setBusyId(null)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center', padding: isMobile ? 0 : 20,
      }}>
      <div style={{
        background: C.surface, width: '100%', maxWidth: isMobile ? '100%' : 440,
        maxHeight: isMobile ? '80vh' : '75vh', overflowY: 'auto',
        borderRadius: isMobile ? '16px 16px 0 0' : 14,
        padding: isMobile ? '20px 16px 28px' : 24,
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 20 }}>Share "{list.name}"</h3>
          <button onClick={onClose} style={{
            background: C.surface2, border: 'none', color: C.muted, borderRadius: '50%',
            width: 28, height: 28, cursor: 'pointer', fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>×</button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
          Anyone checked below can view this list and add books to it.
        </p>
        {loading ? <Spinner /> : friends.length === 0 ? (
          <EmptyState icon="👥" message="No friends yet" sub="Add friends to share lists with them" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {friends.map(f => {
              const on = sharedIds.has(f.friendId)
              return (
                <button key={f.friendId} onClick={() => toggle(f.friendId)} disabled={busyId === f.friendId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0',
                    borderBottom: `1px solid ${C.border}`, fontFamily: f.sans,
                    opacity: busyId === f.friendId ? 0.6 : 1,
                  }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    border: `2px solid ${on ? C.primary : C.border}`,
                    background: on ? C.primary : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: C.white, fontSize: 13, fontWeight: 700,
                  }}>{on ? '✓' : ''}</span>
                  <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>
                    {f.friendProfile?.display_name || f.friendProfile?.username || 'Unknown'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================
// AddToListModal – search + add books directly onto a shared list
// ================================================================
function AddToListModal({ list, userId, existingBookIds, initialStatus = 'want_to_read', onClose, onAdded }) {
  const isMobile = useIsMobile()
  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [err,       setErr]       = useState(null)
  const [addingId,  setAddingId]  = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); setErr(null); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setErr(null)
      try {
        const { results } = await searchBooks(query, 20)
        setResults(results)
      } catch (e) {
        setErr(e.message)
        setResults([])
      }
      setSearching(false)
    }, 380)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  async function handleAdd(book) {
    setAddingId(book.id)
    try {
      await upsertBook(book)
      const { error } = await supabase.rpc('add_book_to_list', {
        p_list_id: list.id, p_book_id: book.id, p_status: initialStatus,
      })
      if (error) throw error
      onAdded?.(book.id)
    } catch (e) { alert(e.message) }
    setAddingId(null)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center', padding: isMobile ? 0 : 20,
      }}>
      <div style={{
        background: C.surface, width: '100%', maxWidth: isMobile ? '100%' : 480,
        maxHeight: isMobile ? '85vh' : '80vh',
        borderRadius: isMobile ? '16px 16px 0 0' : 14,
        padding: isMobile ? '18px 14px 24px' : 24,
        overflowY: 'auto', border: `1px solid ${C.border}`,
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 19 }}>📚 Add to "{list.name}"</h2>
          <button onClick={onClose} style={{
            background: C.surface2, border: 'none', color: C.muted, borderRadius: '50%',
            width: 28, height: 28, cursor: 'pointer', fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>×</button>
        </div>

        <div style={{ position: 'relative', marginBottom: 14, flexShrink: 0 }}>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="🔍  Search by title, author, or ISBN…"
            style={{ ...inputStyle, paddingRight: query ? 34 : undefined }} />
          {query && (
            <button onClick={() => setQuery('')} title="Clear search" style={{
              position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)',
              width: 22, height: 22, borderRadius: '50%', border: 'none',
              background: C.surface2, color: C.muted, cursor: 'pointer', fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
            }}>×</button>
          )}
        </div>

        <div style={{ overflowY: 'auto' }}>
          {searching ? <Spinner /> : err ? (
            <p style={{ color: C.danger, fontFamily: f.sans, fontSize: 13 }}>{err}</p>
          ) : results.length === 0 ? (
            <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
              {query.trim() ? 'No results found' : 'Start typing to search'}
            </p>
          ) : results.map(book => {
            const already = existingBookIds.has(book.id)
            return (
              <div key={book.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: `1px solid ${C.border}`,
              }}>
                {book.cover_url
                  ? <img src={book.cover_url} alt="" style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  : <NoCover title={book.title} width={40} height={60} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: '0 0 2px', fontWeight: 700, fontSize: 13, color: C.text, fontFamily: f.sans,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{book.title}</p>
                  <p style={{
                    margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{book.authors?.join(', ')}</p>
                </div>
                {already ? (
                  <span style={{ fontSize: 11, color: C.success, fontFamily: f.sans, fontWeight: 700, flexShrink: 0 }}>
                    ✓ On list
                  </span>
                ) : (
                  <button onClick={() => handleAdd(book)} disabled={!!addingId}
                    style={{ ...btn('accent', 'sm'), fontSize: 12, flexShrink: 0, opacity: addingId && addingId !== book.id ? 0.5 : 1 }}>
                    {addingId === book.id ? '…' : '+ Add'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ================================================================
// ManageListModal – owner hub: rename, add books, manage members, delete
// ================================================================
function ManageListModal({ list, userId, friends, onClose, onRenamed, onDeleted }) {
  const isMobile = useIsMobile()
  const [name,        setName]        = useState(list.name)
  const [description, setDescription] = useState(list.description || '')
  const [saving,       setSaving]      = useState(false)
  const [deleting,     setDeleting]    = useState(false)
  const [err,          setErr]         = useState(null)
  const [showAdd,      setShowAdd]     = useState(false)
  const [showShare,    setShowShare]   = useState(false)
  const [existingIds,  setExistingIds] = useState(new Set())

  useEffect(() => {
    supabase.from('book_list_items').select('book_id').eq('list_id', list.id)
      .then(({ data }) => setExistingIds(new Set((data || []).map(r => r.book_id))))
  }, [list.id])

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setErr(null)
    try {
      const { data, error } = await supabase.rpc('update_book_list', {
        p_list_id: list.id, p_name: name.trim(), p_description: description.trim() || null,
      })
      if (error) throw error
      onRenamed?.({ ...list, ...data })
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${list.name}"? This removes it for everyone it's shared with — this can't be undone.`)) return
    setDeleting(true)
    try {
      const { error } = await supabase.rpc('delete_book_list', { p_list_id: list.id })
      if (error) throw error
      onDeleted?.()
    } catch (e) {
      setErr(e.message)
      setDeleting(false)
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center', padding: isMobile ? 0 : 20,
      }}>
      <div style={{
        background: C.surface, width: '100%', maxWidth: isMobile ? '100%' : 460,
        maxHeight: isMobile ? '85vh' : '80vh', overflowY: 'auto',
        borderRadius: isMobile ? '20px 20px 0 0' : 18,
        padding: isMobile ? '24px 18px 32px' : 28,
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <h3 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 20 }}>⚙️ Manage List</h3>
          <button onClick={onClose} style={{
            background: C.surface2, border: 'none', color: C.muted, borderRadius: '50%',
            width: 28, height: 28, cursor: 'pointer', fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>×</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Name</p>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Description</p>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        {err && <p style={{ margin: '0 0 14px', color: C.danger, fontSize: 12, fontFamily: f.sans }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 26 }}>
          <button onClick={handleSave} disabled={saving || !name.trim()} style={btn('accent', 'sm')}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
          <button onClick={() => setShowAdd(true)} style={{ ...btn('subtle', 'sm'), justifyContent: 'flex-start' }}>
            + Add Books
          </button>
          <button onClick={() => setShowShare(true)} style={{ ...btn('subtle', 'sm'), justifyContent: 'flex-start' }}>
            👥 Manage Members
          </button>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'center', marginTop: 24,
          paddingTop: 20, borderTop: `1px solid ${C.border}`,
        }}>
          <button onClick={handleDelete} disabled={deleting} style={btn('danger', 'sm')}>
            {deleting ? 'Deleting…' : '🗑 Delete List'}
          </button>
        </div>
      </div>

      {showAdd && (
        <AddToListModal list={list} userId={userId} existingBookIds={existingIds}
          onClose={() => setShowAdd(false)}
          onAdded={(bookId) => setExistingIds(prev => new Set([...prev, bookId]))} />
      )}
      {showShare && (
        <ShareListModal list={list} userId={userId} friends={friends} onClose={() => setShowShare(false)} />
      )}
    </div>
  )
}

// ================================================================
// ListDetailView – full-page view of a shared list: Reading/Want to
// Read/Read sections, add-book search, and (owner-only) share picker.
// Any member (owner or shared-with) can add books and move them
// between statuses — only the owner can rename/delete or manage shares.
// ================================================================
function ListDetailView({ list, userId, friends, myBookIds, onBack, onListChanged }) {
  const isMobile = useIsMobile()
  const [items,        setItems]        = useState([])
  const [loading,       setLoading]      = useState(true)
  const [modal,         setModal]        = useState(null)
  const [hoveredId,     setHoveredId]    = useState(null)
  const [showAdd,       setShowAdd]      = useState(null) // null | 'reading' | 'want_to_read'
  const [showShare,     setShowShare]    = useState(false)
  const [showMembers,   setShowMembers]  = useState(false)
  const [members,       setMembers]      = useState([])
  const [ownerProfile,  setOwnerProfile] = useState(null)
  const [focusedStatus, setFocusedStatus] = useState(null) // null | 'reading' | 'want_to_read' | 'read'
  const hideTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  const isOwner = list.owner_id === userId

  const loadItems = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('book_list_items').select('*, books(*)')
      .eq('list_id', list.id).order('position', { ascending: true }).order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }, [list.id])

  useEffect(() => { loadItems() }, [loadItems])

  useEffect(() => {
    // book_list_shares.user_id references auth.users, not profiles — no FK for
    // PostgREST to auto-embed, so fetch profiles separately and merge in JS.
    supabase.from('book_list_shares').select('user_id').eq('list_id', list.id)
      .then(async ({ data: shares }) => {
        const shareIds = (shares || []).map(s => s.user_id)
        const allIds = [...new Set([list.owner_id, ...shareIds])]
        const { data: profs } = await supabase.from('profiles')
          .select('id, display_name, username, avatar_url').in('id', allIds)
        const profileMap = Object.fromEntries((profs || []).map(p => [p.id, p]))
        setOwnerProfile(profileMap[list.owner_id] || null)
        setMembers(shareIds.map(id => ({ user_id: id, profiles: profileMap[id] })))
      })
  }, [list.id, list.owner_id])

  async function handleStatusChange(item, status) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status } : i))
    await supabase.rpc('update_list_item_status', { p_item_id: item.id, p_status: status })
  }

  async function handleRemove(item) {
    setItems(prev => prev.filter(i => i.id !== item.id))
    await supabase.rpc('remove_list_item', { p_item_id: item.id })
  }

  const reading     = items.filter(i => i.status === 'reading')
  const wantToRead  = items.filter(i => i.status === 'want_to_read')
  const read        = items.filter(i => i.status === 'read')

  // Drag-to-reorder — Want to Read section, same press-and-hold pattern
  // (native HTML5 DnD on desktop, grip-handle pointer drag on mobile) used
  // for the personal library's Want to Read row on Home.
  async function persistOrder(reordered) {
    setItems(prev => {
      const others = prev.filter(i => i.status !== 'want_to_read')
      return [...others, ...reordered]
    })
    await Promise.all(
      reordered.map((item, idx) => supabase.rpc('update_list_item_position', { p_item_id: item.id, p_position: idx }))
    )
  }
  const { dragIdx, overIdx, nativeDragProps, handleBind, tileProps } = useDragReorder(wantToRead, persistOrder)

  function renderSection(statusKey, title, icon, iconBg, list_, draggable = false, onAdd = null) {
    if (list_.length === 0 && !onAdd) return null
    const focused = focusedStatus === statusKey
    if (focusedStatus && !focused) return null
    return (
      <div style={{ marginBottom: 22 }}>
        <button onClick={() => setFocusedStatus(focused ? null : statusKey)} style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: draggable ? 4 : 14,
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: f.sans,
        }}>
          {focused && <span style={{ color: C.muted, fontSize: 15 }}>‹</span>}
          <SectionBadge icon={icon} bg={iconBg} />
          <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>{title}</h2>
          <CountPill n={list_.length} />
          {!focused && <span style={{ color: C.muted, fontSize: 15 }}>›</span>}
        </button>
        {draggable && list_.length > 0 && (
          <p style={{ margin: '0 0 10px', fontSize: 11, color: C.muted, fontFamily: f.sans, fontStyle: 'italic' }}>
            ⠿ Drag a cover to reorder
          </p>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
          gap: isMobile ? 9 : 16,
        }}>
          {onAdd && <AddTile onClick={onAdd} label="Add Book" />}
          {list_.map((item, idx) => renderTile(item, idx, draggable))}
        </div>
      </div>
    )
  }

  function renderTile(item, idx, draggable = false) {
    const book = item.books || {}
    const isHovered = hoveredId === item.id

    // Which quick status-change icons make sense from here — Read is a dead
    // end (no further action needed), Reading only ever moves forward to
    // Read, and Want to Read can jump to either Reading or Read.
    const moveOptions =
      item.status === 'read'    ? [] :
      item.status === 'reading' ? [['read', STATUS_ICONS.read, STATUS_COLORS.read.color]] :
      [
        ['reading', STATUS_ICONS.reading, STATUS_COLORS.reading.color],
        ['read',    STATUS_ICONS.read,    STATUS_COLORS.read.color],
      ]

    function handleTap() {
      if (isMobile && !isHovered && moveOptions.length > 0) {
        setHoveredId(item.id)
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = setTimeout(() => setHoveredId(null), 2500)
        return
      }
      setModal(book)
    }

    return (
      <div key={item.id}
        {...(draggable ? tileProps(idx) : {})}
        {...(draggable ? nativeDragProps(idx) : {})}
        onMouseEnter={() => setHoveredId(item.id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{
          position: 'relative',
          opacity: draggable && dragIdx === idx ? 0.4 : 1,
          outline: draggable && overIdx === idx && dragIdx !== idx ? `2px solid ${C.primary}` : 'none',
          borderRadius: draggable ? 10 : undefined,
          cursor: draggable ? 'grab' : undefined,
        }}
      >
        <PosterCard book={book} onClick={handleTap} />
        {draggable && !isHovered && (
          <div {...handleBind(idx)} style={{
            ...handleBind(idx).style,
            position: 'absolute', bottom: 4, right: 4, width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(10,8,24,0.75)', color: '#fff', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'grab', zIndex: 2, WebkitTapHighlightColor: 'transparent',
          }}>⠿</div>
        )}
        {isHovered && moveOptions.length > 0 && (
          <div onClick={() => setModal(book)} style={{
            position: 'absolute', inset: 0, borderRadius: 8,
            background: 'rgba(10,8,24,0.72)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-end',
            gap: 8, padding: '10px 8px 14px',
          }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.85)', fontFamily: f.sans }}>
              Move to:
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              {moveOptions.map(([st, icon, bg]) => (
                <button key={st} title={STATUS_LABELS[st]}
                  onClick={(e) => { e.stopPropagation(); handleStatusChange(item, st) }}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', border: 'none',
                    background: bg, color: '#0f1117',
                    cursor: 'pointer', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{icon}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: C.muted, fontFamily: f.sans,
        fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16,
      }}>‹ Back to Friends</button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 26 }}>📋 {list.name}</h1>
          {list.description && (
            <p style={{ margin: '4px 0 0', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>{list.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => setShowMembers(o => !o)} style={{ ...pill(showMembers), fontSize: 13 }}>
            👥 {members.length + 1} Member{members.length === 0 ? '' : 's'}
          </button>
          {isOwner && (
            <button onClick={() => setShowShare(true)} style={btn('subtle', 'sm')}>+ Share</button>
          )}
          <button onClick={() => setShowAdd('want_to_read')} style={btn('accent', 'sm')}>+ Add Book</button>
        </div>
      </div>

      {showMembers && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: 14, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 18, width: 30, height: 30, borderRadius: '50%',
              background: C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>{ownerProfile?.avatar_url || '📖'}</span>
            <span style={{ color: C.text, fontFamily: f.sans, fontSize: 14, fontWeight: 600 }}>
              {isOwner ? 'You' : (ownerProfile?.display_name || ownerProfile?.username || 'Unknown')}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: C.muted, background: C.surface2,
              borderRadius: 6, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>Owner</span>
          </div>
          {members.map(m => (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 18, width: 30, height: 30, borderRadius: '50%',
                background: C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{m.profiles?.avatar_url || '📖'}</span>
              <span style={{ color: C.text, fontFamily: f.sans, fontSize: 14, fontWeight: 600 }}>
                {m.user_id === userId ? 'You' : (m.profiles?.display_name || m.profiles?.username || 'a friend')}
              </span>
            </div>
          ))}
          {members.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans, fontStyle: 'italic' }}>
              Not shared with anyone yet{isOwner ? ' — use Share to add friends' : ''}.
            </p>
          )}
        </div>
      )}

      {loading ? <Spinner /> : (
        <>
          {focusedStatus && (
            <button onClick={() => setFocusedStatus(null)} style={{
              background: 'none', border: 'none', color: C.muted, fontFamily: f.sans,
              fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>‹ Back to all</button>
          )}
          {renderSection('reading', 'Reading', '▶', STATUS_COLORS.reading.color, reading, false, () => setShowAdd('reading'))}
          {renderSection('want_to_read', 'Want to Read', '👀', C.accent, wantToRead, true, () => setShowAdd('want_to_read'))}
          {renderSection('read', 'Read', '✅', C.success, read)}
        </>
      )}

      {showAdd && (
        <AddToListModal list={list} userId={userId}
          existingBookIds={new Set(items.map(i => i.book_id))}
          initialStatus={showAdd}
          onClose={() => setShowAdd(null)}
          onAdded={() => { loadItems(); onListChanged?.() }} />
      )}

      {showShare && (
        <ShareListModal list={list} userId={userId} friends={friends} onClose={() => setShowShare(false)} />
      )}

      {modal && (
        <BookDetailModal item={modal} userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => {}} />
      )}
    </div>
  )
}

// ================================================================
// Profile page – avatar, stats, username, top 10
// ================================================================
function Switch({ checked, onChange }) {
  return (
    <button onClick={onChange} style={{
      width: 46, height: 26, borderRadius: 20, border: 'none', cursor: 'pointer',
      background: checked ? C.primary : C.surface2, position: 'relative', flexShrink: 0,
      transition: 'background 0.15s', WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3, width: 20, height: 20, borderRadius: '50%',
        background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }} />
    </button>
  )
}

function StatBar({ label, icon, value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <span style={{
        width: 130, flexShrink: 0, fontSize: 13, color: C.text, fontFamily: f.sans, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {icon} {label}
      </span>
      <div style={{ flex: 1, height: 10, borderRadius: 6, background: C.surface2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: 34, textAlign: 'right', fontSize: 15, fontWeight: 700, color: C.text, fontFamily: f.sans, flexShrink: 0 }}>
        {value}
      </span>
    </div>
  )
}

function StatsModal({ fictionCount, nonfictionCount, genreBreakdown, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ftMax    = Math.max(fictionCount, nonfictionCount, 1)
  const genreMax = Math.max(1, ...genreBreakdown.map(([, n]) => n))

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(5,4,15,0.88)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: C.surface, borderRadius: 14, padding: 28, maxWidth: 440, width: '100%',
        maxHeight: '82vh', overflowY: 'auto',
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 22, fontWeight: 700 }}>Your Stats</h2>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%', border: `1px solid ${C.border}`, background: 'none',
            color: C.text, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 11, color: C.muted, fontFamily: f.sans,
          textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Fiction vs Non-Fiction</p>
        <StatBar label="Fiction" icon="📖" value={fictionCount} max={ftMax} color={C.primary} />
        <StatBar label="Non-Fiction" icon="📘" value={nonfictionCount} max={ftMax} color={C.accent} />

        {genreBreakdown.length > 0 && (
          <>
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '10px 0 20px' }} />
            <p style={{ margin: '0 0 14px', fontSize: 11, color: C.muted, fontFamily: f.sans,
              textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Top Genres</p>
            {genreBreakdown.map(([g, n]) => (
              <StatBar key={g} label={g} value={n} max={genreMax} color={C.primaryDim} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// Settings-panel row — label left, control right, hairline divider below.
function SettingsRow({ label, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
      padding: '14px 0', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: f.sans, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>{children}</div>
    </div>
  )
}
function ProfilePage({ userId, email, profile, onProfileUpdate, onSignOut, theme, toggleTheme, onOpenList, onGoFriends }) {
  const isMobile = useIsMobile()
  const booksRef = useRef(null)
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [username,    setUsername]    = useState(profile?.username || '')
  const [avatar,      setAvatar]      = useState(profile?.avatar_url || '')
  const [initials,    setInitials]    = useState(profile?.initials || '')
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState(null)
  const [allBooks,    setAllBooks]    = useState([])
  const [loadingBooks,setLoadingBooks]= useState(true)
  const [friendCount, setFriendCount] = useState(0)
  const [follows,     setFollows]     = useState([])
  const [modal,       setModal]       = useState(null)
  const [showImport,  setShowImport]  = useState(false)
  const [showSettings,     setShowSettings]     = useState(false)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [showStats,        setShowStats]        = useState(false)
  const [showBookFilter,   setShowBookFilter]   = useState(false)
  const [bookSort,   setBookSort]   = useState('default')
  const [bookStatus, setBookStatus] = useState('all')
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg,    setPwMsg]    = useState(null)

  async function changePassword() {
    if (newPassword.length < 8) { setPwMsg({ type: 'error', text: 'Password must be at least 8 characters.' }); return }
    if (newPassword !== confirmPassword) { setPwMsg({ type: 'error', text: 'Passwords do not match.' }); return }
    setPwSaving(true); setPwMsg(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwMsg({ type: 'success', text: 'Password updated!' })
      setNewPassword(''); setConfirmPassword('')
      setTimeout(() => { setShowPasswordChange(false); setPwMsg(null) }, 1800)
    } catch (err) {
      setPwMsg({ type: 'error', text: err.message })
    }
    setPwSaving(false)
  }

  // Keep local fields in sync if profile prop refreshes from elsewhere
  useEffect(() => {
    setDisplayName(profile?.display_name || '')
    setUsername(profile?.username || '')
    setAvatar(profile?.avatar_url || '')
    setInitials(profile?.initials || '')
  }, [profile])

  const loadProfileData = useCallback(async () => {
    setLoadingBooks(true)
    const { data } = await supabase.from('user_books').select('*, books(*)').eq('user_id', userId)
      .order('updated_at', { ascending: false })
    setAllBooks(data || [])
    setLoadingBooks(false)

    const { count } = await supabase.from('friendships')
      .select('id', { count: 'exact', head: true }).eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    setFriendCount(count || 0)

    supabase.from('author_follows').select('author').eq('user_id', userId)
      .then(({ data }) => setFollows(data || []))
  }, [userId])

  useEffect(() => { loadProfileData() }, [loadProfileData])

  async function saveProfile(overrides = {}) {
    const nextAvatar = overrides.avatar_url ?? avatar
    if (!username.trim()) { setMsg({ type: 'error', text: 'Username is required.' }); return }
    setSaving(true)
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      display_name: (overrides.display_name ?? displayName).trim(),
      username: username.toLowerCase().trim(),
      avatar_url: nextAvatar || profile?.avatar_url || autoAvatar(''),
      initials: (overrides.initials ?? initials).trim().toUpperCase().slice(0, 2) || null,
    }, { onConflict: 'id' })
    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: `Save failed: ${error.message}` })
    } else {
      setMsg({ type: 'success', text: 'Saved ✓' })
      onProfileUpdate?.()
      setTimeout(() => setMsg(null), 2000)
    }
  }

  function pickAvatar(e) {
    const next = avatar === e ? '' : e
    setAvatar(next)
    saveProfile({ avatar_url: next })
  }

  async function unfollowAuthor(author) {
    await supabase.from('author_follows').delete().eq('user_id', userId).eq('author', author)
    setFollows(prev => prev.filter(f => f.author !== author))
  }

  const stats = {
    read:       allBooks.filter(u => u.status === 'read').length,
    reading:    allBooks.filter(u => u.status === 'reading').length,
    wantToRead: allBooks.filter(u => u.status === 'want_to_read').length,
    rated:      allBooks.filter(u => (u.rating || 0) > 0).length,
  }
  const topBooks = allBooks.filter(u => (u.rating || 0) >= 4 && u.status === 'read')
    .sort((a, b) => (b.rating - a.rating)).slice(0, 10)

  const fictionCount    = allBooks.filter(u => !bookGenres(u.books).some(g => NONFICTION_GENRES.has(g))).length
  const nonfictionCount = allBooks.length - fictionCount
  const genreBreakdown  = useMemo(() => {
    const list = topCategories(allBooks.map(u => u.books || {}), 8)
    return list.map(g => [g, allBooks.filter(u => bookGenres(u.books).includes(g)).length])
  }, [allBooks])

  const visibleBooks = (() => {
    let list = bookStatus === 'all' ? allBooks
      : bookStatus === 'rated' ? allBooks.filter(u => (u.rating || 0) > 0)
      : bookStatus === 'favorites' ? allBooks.filter(u => u.top_10)
      : allBooks.filter(u => u.status === bookStatus)
    if (bookSort === 'top_rated') return [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    if (bookSort === 'recent') return list // already fetched updated_at desc
    return [...list].sort((a, b) => {
      if (!!b.top_10 !== !!a.top_10) return b.top_10 ? 1 : -1
      return (b.rating || 0) - (a.rating || 0)
    })
  })()

  return (
    <div>
      {/* Header — avatar + welcome + date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: `linear-gradient(135deg, ${C.primaryDim}, ${C.surface2})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            border: `2px solid ${C.border}`, flexShrink: 0,
          }}>{profile?.avatar_url || '📚'}</div>
          <h1 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 21, fontWeight: 700 }}>
            Welcome, {profile?.display_name || profile?.username || 'Reader'} 👋
          </h1>
        </div>
        <span style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, flexShrink: 0 }}>
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
          {[
            ['Read', stats.read, () => onOpenList?.('read', true)],
            ['Friends', friendCount, () => onGoFriends?.()],
            ['Rated', stats.rated, () => onOpenList?.('rated', true)],
          ].map(([lbl, n, onClick]) => (
            <button key={lbl} onClick={onClick} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
            }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.primary, fontFamily: f.sans, lineHeight: 1.2 }}>{n}</div>
              <div style={{ fontSize: 12, color: C.muted, fontFamily: f.sans, textDecoration: 'underline' }}>{lbl}</div>
            </button>
          ))}
        </div>
        <button onClick={() => setShowStats(true)} style={btn('ghost', 'sm')}>Stats</button>
      </div>

      {/* Settings accordion */}
      <button onClick={() => setShowSettings(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: '13px 16px', marginBottom: showSettings ? 4 : 28, cursor: 'pointer',
        fontFamily: f.sans, fontSize: 14, fontWeight: 700, color: C.text,
      }}>
        {showSettings ? '▲ Close Settings' : 'Edit Profile · Settings'}
      </button>

      {showSettings && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '4px 18px', marginBottom: 28,
        }}>
          <SettingsRow label="🌙 Night mode">
            <Switch checked={theme === 'dark'} onChange={toggleTheme} />
          </SettingsRow>

          <SettingsRow label="Display initials">
            <div style={{
              width: 32, height: 32, borderRadius: 8, background: C.surface2,
              border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14, fontWeight: 700, color: C.muted, fontFamily: f.sans,
              flexShrink: 0,
            }}>
              {initials || (displayName || username || 'R')[0].toUpperCase()}
            </div>
            <input value={initials}
              onChange={e => setInitials(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2))}
              placeholder="e.g. GS"
              maxLength={2}
              style={{ ...inputStyle, width: 60, padding: '7px 10px', fontSize: 13, textAlign: 'center' }} />
            <button onClick={() => saveProfile()} disabled={saving} style={btn('primary', 'sm')}>
              Save
            </button>
          </SettingsRow>

          <SettingsRow label="Account">
            <span style={{ color: C.muted, fontFamily: f.sans, fontSize: 13 }}>{email}</span>
          </SettingsRow>

          <SettingsRow label="Password">
            <button onClick={() => { setShowPasswordChange(o => !o); setPwMsg(null) }} style={btn('ghost', 'sm')}>
              {showPasswordChange ? 'Cancel' : 'Change'}
            </button>
          </SettingsRow>
          {showPasswordChange && (
            <div style={{ padding: '0 0 16px' }}>
              <input type="password" value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="New password (min. 8 characters)"
                style={{ ...inputStyle, marginBottom: 8 }} />
              <input type="password" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                style={{ ...inputStyle, marginBottom: 10 }} />
              {pwMsg && (
                <p style={{ margin: '0 0 10px', fontSize: 12, fontFamily: f.sans,
                  color: pwMsg.type === 'success' ? C.success : C.danger }}>{pwMsg.text}</p>
              )}
              <button onClick={changePassword} disabled={pwSaving} style={btn('primary', 'sm')}>
                {pwSaving ? 'Saving…' : 'Save New Password'}
              </button>
            </div>
          )}

          <SettingsRow label="Avatar">
            <span style={{ fontSize: 22 }}>{avatar || '📚'}</span>
            <button onClick={() => setShowAvatarPicker(o => !o)} style={{
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 2,
            }}>
              {showAvatarPicker ? '▴' : '▾'}
            </button>
          </SettingsRow>
          {showAvatarPicker && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))', gap: 6,
              padding: '12px 0 16px',
            }}>
              {LITERARY_EMOJIS.map(e => (
                <button key={e} onClick={() => pickAvatar(e)}
                  style={{
                    fontSize: 20, padding: '6px 4px', border: 'none', cursor: 'pointer',
                    borderRadius: 8, background: avatar === e ? C.primary : C.surface2,
                    transition: 'background 0.15s', WebkitTapHighlightColor: 'transparent',
                  }}>{e}</button>
              ))}
            </div>
          )}

          <SettingsRow label="Username">
            <input value={username}
              onChange={e => setUsername(e.target.value.replace(/\s/g, '').toLowerCase())}
              placeholder="your_username"
              style={{ ...inputStyle, width: 140, padding: '7px 10px', fontSize: 13 }} />
            <button onClick={() => saveProfile()} disabled={saving} style={btn('primary', 'sm')}>
              {saving ? '…' : 'Save'}
            </button>
          </SettingsRow>

          <SettingsRow label="Import">
            <button onClick={() => setShowImport(true)} style={btn('ghost', 'sm')}>📥 Import</button>
          </SettingsRow>

          <div style={{ padding: '14px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text, fontFamily: f.sans }}>Account</span>
              <button onClick={onSignOut} style={btn('danger', 'sm')}>Sign Out</button>
            </div>
          </div>

          {msg && (
            <p style={{ margin: '0 0 12px', fontSize: 13, fontFamily: f.sans,
              color: msg.type === 'success' ? C.success : C.danger }}>{msg.text}</p>
          )}
        </div>
      )}

      {/* My Books */}
      <div ref={booksRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>My Books</h2>
          <button onClick={() => onOpenList?.('all', false)} style={{
            background: 'none', border: 'none', color: C.primary, fontFamily: f.sans,
            fontSize: 13, fontWeight: 600, cursor: onOpenList ? 'pointer' : 'default', padding: 0,
            textDecoration: onOpenList ? 'underline' : 'none',
          }}>
            {allBooks.length} titles
          </button>
        </div>
        <button onClick={() => setShowBookFilter(o => !o)} style={{ ...pill(showBookFilter), fontSize: 12 }}>
          Filter ▾
        </button>
      </div>

      {showBookFilter && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: 14, marginBottom: 16,
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Sort</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {READ_SORTS.map(([key, lbl]) => (
              <button key={key} onClick={() => setBookSort(key)} style={pill(bookSort === key)}>{lbl}</button>
            ))}
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Status</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              ['all', 'All'], ['reading', `${STATUS_ICONS.reading} Reading`],
              ['want_to_read', `${STATUS_ICONS.want_to_read} Want to Read`], ['read', `${STATUS_ICONS.read} Read`],
              ['rated', '⭐ Rated'], ['favorites', '🏆 Favorites'],
            ].map(([key, lbl]) => (
              <button key={key} onClick={() => setBookStatus(key)} style={{ ...pill(bookStatus === key), fontSize: 12 }}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {loadingBooks ? <Spinner /> : visibleBooks.length === 0
        ? <EmptyState icon="📚" message="No books match this filter" />
        : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 106 : 120}px, 1fr))`,
            gap: isMobile ? 9 : 16, marginBottom: 22,
          }}>
            {visibleBooks.map(ub => (
              <PosterCard key={ub.id} userBook={ub} onClick={() => setModal(ub)} />
            ))}
          </div>
        )
      }

      {/* Top 10 favorites */}
      {topBooks.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <p style={{ margin: '0 0 14px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>⭐ My Top {topBooks.length} Books</p>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
            {topBooks.map(ub => (
              <div key={ub.id} style={{ flexShrink: 0 }}>
                <PosterCard userBook={ub} onClick={() => setModal(ub)} width={90} height={135} />
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
                  <StarRating value={ub.rating} readonly size={11} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Author follows */}
      {follows.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <p style={{ margin: '0 0 14px', fontSize: 11, color: C.muted, fontFamily: f.sans,
            textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Authors You Follow</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {follows.map(f => (
              <div key={f.author} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: C.surface2, borderRadius: 20, padding: '5px 12px',
              }}>
                <span style={{ color: C.text, fontFamily: f.sans, fontSize: 13 }}>{f.author}</span>
                <button onClick={() => unfollowAuthor(f.author)} style={{
                  background: 'none', border: 'none', color: C.muted,
                  cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
                }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showStats && (
        <StatsModal fictionCount={fictionCount} nonfictionCount={nonfictionCount}
          genreBreakdown={genreBreakdown} onClose={() => setShowStats(false)} />
      )}

      {modal && (
        <BookDetailModal item={modal} userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => loadProfileData()} />
      )}
      {showImport && (
        <ImportModal
          userId={userId}
          existingBookIds={new Set(allBooks.map(ub => ub.book_id))}
          onClose={() => setShowImport(false)}
          onDone={() => { loadProfileData(); setShowImport(false) }}
        />
      )}
    </div>
  )
}

// ================================================================
// CSV Import Modal – Goodreads · Audible
// ================================================================

// ── CSV parser (handles quoted fields, escaped quotes) ───────────
function parseCSVLine(line) {
  const result = []; let cur = ''; let inQ = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (line[i] === ',' && !inQ) { result.push(cur); cur = '' }
    else cur += line[i]
  }
  result.push(cur); return result
}
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const headers = parseCSVLine(lines[0]).map(h => h.trim())
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const vals = parseCSVLine(l)
    const row = {}
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim() })
    return row
  })
}

function detectCSVFormat(headers) {
  const h = new Set(headers.map(x => x.toLowerCase()))
  if (h.has('exclusive shelf') || h.has('bookshelves')) return 'goodreads'
  if (h.has('narrators') || h.has('narrator') || h.has('purchase date') || (h.has('asin') && h.has('authors'))) return 'audible'
  return null
}

// Strip Excel-style =HYPERLINK("url"; "Display Text") formulas
function stripHyperlink(val) {
  if (!val || !val.startsWith('=')) return val
  const m = val.match(/=HYPERLINK\s*\([^;,]*[;,]\s*"([^"]+)"\s*\)/i)
  return m ? m[1] : val.replace(/=HYPERLINK[^)]+\)/i, '').trim()
}

const GR_SHELF = { 'read': 'read', 'currently-reading': 'reading', 'to-read': 'want_to_read' }

function mapImportRow(row, fmt, defaultStatus = 'read') {
  if (fmt === 'goodreads') {
    const isbn = (row['ISBN13'] || row['ISBN'] || '').replace(/[="]/g, '')
    const rating = parseInt(row['My Rating']) || null
    return {
      title:  row['Title'] || '',
      author: row['Author'] || row['Author l-f'] || '',
      isbn:   isbn || null,
      status: GR_SHELF[row['Exclusive Shelf']] || 'want_to_read',
      rating: (rating && rating > 0) ? rating : null,
      notes:  row['My Review'] || '',
    }
  }
  if (fmt === 'audible') {
    const title = stripHyperlink(row['Title'] || row['Title Short'] || '')
    const rating = parseInt(row['My Rating']) || null
    return {
      title,
      author: row['Authors'] || row['Author'] || '',
      isbn:   null,
      status: defaultStatus,
      rating: (rating && rating > 0) ? rating : null,
      notes:  '',
    }
  }
  return null
}

// Fetch book metadata — Google Books first, Open Library as fallback
async function fetchBookMeta(item) {
  const query = item.isbn
    ? `isbn:${item.isbn}`
    : `${item.title}${item.author ? ' ' + item.author : ''}`
  try {
    const { results } = await searchBooks(query, 1)
    if (results.length > 0) return results[0]
  } catch (_) {}
  // Last resort: minimal record with a stable hash-based ID
  const hash = [...(item.title + item.author)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0)
  return {
    id:             `import_${hash}`,
    title:          item.title,
    authors:        item.author ? [item.author] : [],
    description:    '',
    cover_url:      null,
    categories:     [],
    published_date: '',
    page_count:     null,
    isbn:           item.isbn,
  }
}

// Deduplicate user's library — keeps best copy, merges rating/notes, deletes the rest
function normTitle(t) { return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '') }
function normAuthor(a) { return ((Array.isArray(a) ? a[0] : a) || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) }

function isSameBook(a, b) {
  const ta = normTitle(a.books?.title), tb = normTitle(b.books?.title)
  if (!ta || !tb) return false
  // One title must start with the other (handles subtitle variants) + same author prefix
  const titleMatch = ta.startsWith(tb.slice(0, 12)) || tb.startsWith(ta.slice(0, 12))
  const authorMatch = normAuthor(a.books?.authors) === normAuthor(b.books?.authors)
  return titleMatch && authorMatch
}

async function deduplicateLibrary(userId) {
  const { data } = await supabase
    .from('user_books').select('*, books(*)')
    .eq('user_id', userId)
  if (!data?.length) return 0

  const used = new Set()
  const groups = []
  for (let i = 0; i < data.length; i++) {
    if (used.has(i)) continue
    const group = [data[i]]
    for (let j = i + 1; j < data.length; j++) {
      if (!used.has(j) && isSameBook(data[i], data[j])) {
        group.push(data[j]); used.add(j)
      }
    }
    used.add(i)
    if (group.length > 1) groups.push(group)
  }

  let removed = 0
  for (const group of groups) {
    const scored = group.map(ub => ({
      ub,
      score: (ub.books?.cover_url ? 4 : 0)
           + (!ub.book_id.startsWith('import_') ? 2 : 0)
           + (ub.rating ? 1 : 0),
    })).sort((a, b) => b.score - a.score)

    const keeper = scored[0].ub
    const dupes  = scored.slice(1).map(s => s.ub)

    // Merge best rating + notes into keeper
    const bestRating = Math.max(...group.map(u => u.rating || 0)) || null
    const bestNotes  = group.map(u => u.notes).find(n => n) || null
    if ((bestRating && !keeper.rating) || (bestNotes && !keeper.notes)) {
      await supabase.from('user_books').update({
        rating: bestRating || keeper.rating,
        notes:  bestNotes  || keeper.notes,
      }).eq('id', keeper.id)
    }

    await supabase.from('user_books').delete().in('id', dupes.map(d => d.id))
    removed += dupes.length
  }
  return removed
}

// Fetch covers for books already in DB that are missing cover_url
async function fetchMissingCovers(userId, onProgress) {
  const { data: missing } = await supabase
    .from('user_books').select('book_id, books(id, title, authors, cover_url)')
    .eq('user_id', userId)
    .is('books.cover_url', null)
  if (!missing?.length) return 0
  let fixed = 0
  await pLimit(missing, async (ub) => {
    const b = ub.books
    if (!b || b.cover_url) return
    try {
      const { results } = await searchBooks(`${b.title} ${(b.authors||[]).join(' ')}`, 1)
      if (results[0]?.cover_url) {
        await supabase.from('books').update({ cover_url: results[0].cover_url }).eq('id', b.id)
        fixed++
      }
    } catch (_) {}
    onProgress?.(fixed, missing.length)
  }, 3)
  return fixed
}

// Run promises with limited concurrency
async function pLimit(items, fn, concurrency = 5, onProgress) {
  const results = []
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i], i)
      onProgress?.(results.filter(Boolean).length, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

function CoverFetchButton({ userId, onDone }) {
  const [state, setState] = useState('idle') // idle | running | done
  const [prog, setProg]   = useState([0, 0])

  async function run() {
    setState('running')
    const fixed = await fetchMissingCovers(userId, (done, total) => setProg([done, total]))
    setState('done')
    setProg([fixed, fixed])
    onDone?.()
  }

  if (state === 'done') return (
    <p style={{ color: C.success, fontFamily: f.sans, fontSize: 13, margin: '0 0 8px' }}>
      ✓ Fetched covers for {prog[0]} books
    </p>
  )
  if (state === 'running') return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, margin: '0 0 6px' }}>
        Fetching covers… {prog[0]} of {prog[1]}
      </p>
      <div style={{ background: C.surface2, borderRadius: 10, height: 6, overflow: 'hidden', maxWidth: 240, margin: '0 auto' }}>
        <div style={{ height: '100%', borderRadius: 10, background: C.primary, transition: 'width 0.3s',
          width: prog[1] ? `${Math.round(prog[0]/prog[1]*100)}%` : '4%' }} />
      </div>
    </div>
  )
  return (
    <button onClick={run} style={{ ...btn('ghost', 'sm'), marginBottom: 12 }}>
      🖼️ Fetch Missing Covers
    </button>
  )
}

function ImportModal({ userId, existingBookIds, onClose, onDone }) {
  const isMobile = useIsMobile()
  const [step,          setStep]          = useState('upload')
  const [format,        setFormat]        = useState(null)
  const [rows,          setRows]          = useState([])
  const [defaultStatus, setDefaultStatus] = useState('read')
  const [progress,      setProgress]      = useState([0, 0])
  const [summary,       setSummary]       = useState(null)
  const [err,           setErr]           = useState(null)
  const fileRef = useRef()

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setErr(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target.result)
        if (!parsed.length) { setErr('File appears empty.'); return }
        const fmt = detectCSVFormat(Object.keys(parsed[0]))
        if (!fmt) { setErr('Could not detect format. Supported: Goodreads and Audible library CSVs.'); return }
        // For Goodreads, status comes from the file; for others default to 'read'
        const initDefault = fmt === 'goodreads' ? null : 'read'
        if (initDefault) setDefaultStatus(initDefault)
        const mapped = parsed.map(r => mapImportRow(r, fmt, initDefault || 'read')).filter(Boolean).filter(r => r.title)
        if (!mapped.length) { setErr('No importable books found in this file.'); return }
        setFormat(fmt)
        setRows(mapped)
        setStep('preview')
      } catch (e2) { setErr('Failed to parse CSV: ' + e2.message) }
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    // Status/rating are edited directly on `rows` in the preview table now
    // (per-row dropdowns/stars, or the "Set all as" bulk buttons), so no
    // override is needed here — just import what's on screen.
    const finalRows = rows
    setStep('importing')
    setProgress([0, finalRows.length])
    let imported = 0, skipped = 0, failed = 0

    // Imported Want to Read rows should queue up after whatever's already
    // there, in CSV order — not all pile onto position 0 ahead of it.
    const wantToReadBase = await nextWantToReadPosition(userId)

    await pLimit(finalRows, async (item, i) => {
      try {
        const book = await fetchBookMeta(item)
        if (!book?.id) { failed++; return }
        await upsertBook(book)
        const { error } = await supabase.from('user_books').upsert({
          user_id: userId, book_id: book.id,
          status:  item.status, rating: item.rating || null,
          notes:   item.notes  || null,
          position: item.status === 'want_to_read' ? wantToReadBase + i : 0,
        }, { onConflict: 'user_id,book_id' })
        if (error) { failed++; return }
        imported++
      } catch (_) { failed++ }
    }, 3, (done, total) => setProgress([done, finalRows.length]))

    setSummary({ imported, skipped, failed })
    setStep('done')
  }

  const FORMAT_LABELS = { goodreads: 'Goodreads', audible: 'Audible' }
  const FORMAT_ICONS  = { goodreads: '📗', audible: '🎧' }
  const STATUS_MAP_LABEL = { read: '✅ Read', reading: '▶ Reading', want_to_read: '👀 Want to Read' }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5,4,15,0.92)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center', padding: isMobile ? 0 : 20,
      }}>
      <div style={{
        background: C.surface, width: '100%',
        maxWidth: isMobile ? '100%' : 660,
        maxHeight: isMobile ? '90vh' : '88vh',
        borderRadius: isMobile ? '16px 16px 0 0' : 14,
        padding: isMobile ? '20px 16px 32px' : 28,
        overflowY: 'auto', border: `1px solid ${C.border}`,
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)', position: 'relative',
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 14, right: 14, background: C.surface2,
          border: 'none', color: C.muted, borderRadius: '50%', width: 30, height: 30,
          cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>

        <h2 style={{ margin: '0 0 4px', color: C.text, fontFamily: f.serif, fontSize: 22 }}>
          📥 Import Library
        </h2>
        <p style={{ margin: '0 0 20px', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
          Supports Goodreads and Audible library CSVs.
        </p>

        {/* UPLOAD */}
        {step === 'upload' && (
          <div>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.primary }}
              onDragEnter={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.primary }}
              onDragLeave={e => e.currentTarget.style.borderColor = C.border}
              onDrop={e => {
                e.preventDefault()
                e.currentTarget.style.borderColor = C.border
                const file = e.dataTransfer.files?.[0]
                if (file) handleFile({ target: { files: [file] } })
              }}
              style={{
                border: `2px dashed ${C.border}`, borderRadius: 12, padding: '40px 20px',
                textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.primary}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
              <p style={{ margin: '0 0 6px', color: C.text, fontFamily: f.sans, fontWeight: 600, fontSize: 15 }}>
                Click or drag a CSV file here
              </p>
              <p style={{ margin: 0, color: C.muted, fontFamily: f.sans, fontSize: 12 }}>
                Goodreads · Audible library
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv"
              onChange={handleFile} style={{ display: 'none' }} />
            {err && <p style={{ marginTop: 12, color: C.danger, fontFamily: f.sans, fontSize: 13 }}>{err}</p>}

            <div style={{ marginTop: 20, padding: 16, background: C.surface2, borderRadius: 8 }}>
              <p style={{ margin: '0 0 12px', color: C.text, fontFamily: f.sans, fontSize: 12, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em' }}>How to export</p>

              <div style={{ marginBottom: 14 }}>
                <p style={{ margin: '0 0 4px', color: C.text, fontFamily: f.sans, fontSize: 13, fontWeight: 700 }}>
                  📗 Goodreads
                </p>
                <p style={{ margin: '0 0 4px', color: C.muted, fontFamily: f.sans, fontSize: 12, lineHeight: 1.5 }}>
                  Go to your <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer"
                    style={{ color: C.primary }}>Import/Export page</a>, then click "Export Library." Goodreads emails
                  you a link to the CSV — it can take a minute or two to generate.
                </p>
              </div>

              <div>
                <p style={{ margin: '0 0 4px', color: C.text, fontFamily: f.sans, fontSize: 13, fontWeight: 700 }}>
                  🎧 Audible
                </p>
                <p style={{ margin: '0 0 4px', color: C.muted, fontFamily: f.sans, fontSize: 12, lineHeight: 1.5 }}>
                  Audible doesn't offer a built-in export, but the free{' '}
                  <a href="https://chromewebstore.google.com/detail/audible-library-extractor/deifcolkciolkllaikijldnjeloeaall"
                    target="_blank" rel="noopener noreferrer" style={{ color: C.primary }}>Audible Library Extractor</a>{' '}
                  extension works well. Install it, open your Audible library, then use its "Extension tools" menu to
                  export a CSV.
                </p>
                <p style={{ margin: 0, color: C.muted, fontFamily: f.sans, fontSize: 12, lineHeight: 1.5, fontStyle: 'italic' }}>
                  Tip: when exporting, pick the <strong style={{ color: C.text }}>"Goodreads"</strong> compatibility
                  option instead of "Raw data" — it carries over your finished/currently-listening/wishlist status
                  automatically, so you won't have to set it manually for every title.
                </p>
              </div>
            </div>

            <p style={{ margin: '14px 0 0', color: C.muted, fontFamily: f.sans, fontSize: 11, fontStyle: 'italic' }}>
              Previously exported your Amazon order history? That built-in export was discontinued by Amazon in
              2023, so it's no longer offered here — Goodreads or Audible cover most libraries just as well.
            </p>
          </div>
        )}

        {/* PREVIEW */}
        {step === 'preview' && (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
              padding: '10px 14px', background: C.surface2, borderRadius: 8,
            }}>
              <span style={{ fontSize: 22 }}>{FORMAT_ICONS[format]}</span>
              <div>
                <p style={{ margin: 0, color: C.text, fontFamily: f.sans, fontWeight: 700, fontSize: 14 }}>
                  {FORMAT_LABELS[format]} export detected
                </p>
                <p style={{ margin: 0, color: C.muted, fontFamily: f.sans, fontSize: 12 }}>
                  {rows.length} books found
                </p>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap',
              padding: '12px 14px', background: C.surface2, borderRadius: 8,
            }}>
              <span style={{ color: C.text, fontFamily: f.sans, fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                Set all as:
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
                  <button key={key}
                    onClick={() => { setDefaultStatus(key); setRows(prev => prev.map(r => ({ ...r, status: key }))) }}
                    style={{ ...pill(defaultStatus === key), fontSize: 12 }}>
                    {STATUS_ICONS[key]} {lbl}
                  </button>
                ))}
              </div>
            </div>
            <p style={{ margin: '0 0 12px', color: C.muted, fontFamily: f.sans, fontSize: 12, fontStyle: 'italic' }}>
              Detected status and rating per book below — adjust any row before importing.
            </p>

            <div style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: f.sans, fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Title', 'Author', 'Status', 'Rating'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', color: C.muted, fontWeight: 700,
                        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}20` }}>
                      <td style={{ padding: '7px 8px', color: C.text, maxWidth: 200,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.title}
                      </td>
                      <td style={{ padding: '7px 8px', color: C.muted, maxWidth: 140,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.author}
                      </td>
                      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                        <select value={r.status}
                          onChange={e => setRows(prev => prev.map((row, idx) => idx === i ? { ...row, status: e.target.value } : row))}
                          style={{
                            background: C.surface2, color: C.text, border: `1px solid ${C.border}`,
                            borderRadius: 6, padding: '4px 6px', fontFamily: f.sans, fontSize: 12, cursor: 'pointer',
                          }}>
                          {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
                            <option key={key} value={key}>{STATUS_ICONS[key]} {lbl}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                        <StarRating size={13} value={r.rating}
                          onChange={val => setRows(prev => prev.map((row, idx) => idx === i ? { ...row, rating: val } : row))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && (
                <p style={{ textAlign: 'center', color: C.muted, fontFamily: f.sans,
                  fontSize: 12, margin: '10px 0 0' }}>
                  …and {rows.length - 100} more (these will still import — only the first 100 are shown/editable here)
                </p>
              )}
            </div>

            <p style={{ margin: '0 0 16px', color: C.muted, fontFamily: f.sans, fontSize: 12 }}>
              BookList will fetch cover art and metadata from Google Books. This may take a moment for large libraries.
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleImport} style={btn('primary')}>
                Import {rows.length} Books
              </button>
              <button onClick={() => { setStep('upload'); setRows([]); setFormat(null) }} style={btn('subtle')}>
                Choose Different File
              </button>
            </div>
          </div>
        )}

        {/* IMPORTING */}
        {step === 'importing' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📚</div>
            <p style={{ margin: '0 0 8px', color: C.text, fontFamily: f.sans, fontWeight: 700, fontSize: 16 }}>
              Importing your library…
            </p>
            <p style={{ margin: '0 0 20px', color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
              {progress[0]} of {progress[1]} books
            </p>
            <div style={{ background: C.surface2, borderRadius: 10, height: 8, overflow: 'hidden', maxWidth: 320, margin: '0 auto' }}>
              <div style={{
                height: '100%', borderRadius: 10, background: C.primary, transition: 'width 0.3s',
                width: progress[1] ? `${Math.round(progress[0] / progress[1] * 100)}%` : '0%',
              }} />
            </div>
          </div>
        )}

        {/* DONE */}
        {step === 'done' && summary && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <h3 style={{ margin: '0 0 6px', color: C.text, fontFamily: f.serif, fontSize: 22 }}>Import complete!</h3>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, margin: '16px 0 20px' }}>
              {[
                [summary.imported, 'Imported', C.success],
                [summary.skipped,  'Skipped',  C.muted],
                [summary.failed,   'Failed',   summary.failed > 0 ? C.danger : C.muted],
              ].map(([n, lbl, color]) => (
                <div key={lbl} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: f.sans }}>{n}</div>
                  <div style={{ fontSize: 12, color: C.muted, fontFamily: f.sans }}>{lbl}</div>
                </div>
              ))}
            </div>
            {summary.failed > 0 && (
              <CoverFetchButton userId={userId} />
            )}
            <button onClick={() => { onDone?.(); onClose() }} style={{ ...btn('primary', 'lg'), marginTop: 12 }}>
              View My Library
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================
// Activity Feed – bell icon, friends' latest reading actions
// ================================================================
function relativeTime(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Just the action clause — the book title itself is always rendered as its
// own bold, clickable line below (see ActivityFeedModal), so this shouldn't
// repeat it.
function activityAction(row) {
  if (row.kind === 'recommendation') return 'recommended this to you'
  const status = row.status, rating = row.rating
  if (status === 'read') return rating ? `just read this and rated it ${'★'.repeat(rating)}` : 'just finished reading this'
  if (status === 'reading')      return 'started reading this'
  if (status === 'want_to_read') return 'wants to read this'
  return 'updated this'
}

function ActivityFeedModal({ userId, onClose }) {
  const [rows,  setRows]  = useState(null)
  const [modal, setModal] = useState(null) // book clicked from the feed

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: fships } = await supabase.from('friendships').select('*')
        .eq('status', 'accepted').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      const friendIds = (fships || []).map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
      if (friendIds.length === 0) { if (!cancelled) setRows([]); return }
      const [{ data: activity }, { data: recs }] = await Promise.all([
        supabase.from('user_books').select('*, books(*)').in('user_id', friendIds)
          .order('updated_at', { ascending: false }).limit(30),
        // Recommendations sent to you — shown in the same feed as WatchList
        // does, complete with the personal note if one was attached.
        supabase.from('book_recommendations').select('*, books(*)').eq('to_user_id', userId)
          .order('created_at', { ascending: false }).limit(30),
      ])
      const profileIds = [...new Set([...friendIds, ...(recs || []).map(r => r.from_user_id)])]
      const { data: profiles } = profileIds.length
        ? await supabase.from('profiles').select('*').in('id', profileIds) : { data: [] }
      const pm = Object.fromEntries((profiles || []).map(p => [p.id, p]))

      const shelfRows = (activity || []).map(r => ({
        kind: 'shelf', id: `shelf_${r.id}`, at: r.updated_at,
        profile: pm[r.user_id], books: r.books, status: r.status, rating: r.rating,
      }))
      const recRows = (recs || []).filter(r => r.books).map(r => ({
        kind: 'recommendation', id: `rec_${r.id}`, at: r.created_at,
        profile: pm[r.from_user_id], books: r.books, message: r.message,
      }))
      const merged = [...shelfRows, ...recRows].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40)
      if (!cancelled) setRows(merged)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(5,4,15,0.88)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: C.surface, borderRadius: 14, padding: 24, maxWidth: 440, width: '100%',
        maxHeight: '78vh', display: 'flex', flexDirection: 'column',
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 18 }}>🔔 Activity</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rows === null ? <Spinner /> : rows.length === 0
            ? <EmptyState icon="🔔" message="No recent activity" sub="Add friends to see what they're reading" />
            : rows.map(r => {
              const book = r.books || {}
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 0', borderBottom: `1px solid ${C.border}`,
                }}>
                  <div onClick={() => setModal(book)} style={{ cursor: 'pointer', flexShrink: 0 }}>
                    {book.cover_url
                      ? <img src={book.cover_url} alt="" style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4 }} />
                      : <NoCover title={book.title} width={40} height={60} />
                    }
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, color: C.text, fontFamily: f.sans, lineHeight: 1.4 }}>
                      <span style={{ fontWeight: 700 }}>{r.profile?.display_name || r.profile?.username || 'A friend'}</span>
                      {' '}<span style={{ color: C.muted }}>{activityAction(r)}</span>
                    </p>
                    <p onClick={() => setModal(book)} style={{
                      margin: '2px 0 0', fontSize: 14, fontWeight: 700, color: C.text, fontFamily: f.sans,
                      cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent',
                    }}
                      onMouseEnter={e => e.currentTarget.style.textDecorationColor = C.muted}
                      onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'transparent'}>
                      {book.title || 'a book'}
                    </p>
                    {r.kind === 'recommendation' && r.message && (
                      <p style={{ margin: '2px 0 0', fontSize: 12.5, color: C.muted, fontFamily: f.sans, fontStyle: 'italic' }}>
                        "{r.message}"
                      </p>
                    )}
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted, fontFamily: f.sans }}>
                      {relativeTime(r.at)}
                    </p>
                  </div>
                </div>
              )
            })
          }
        </div>
      </div>

      {modal && (
        <BookDetailModal item={modal} userId={userId}
          onClose={() => setModal(null)} onUpdate={() => {}} />
      )}
    </div>
  )
}

// ================================================================
// Messages – paper-plane icon, inbox of book recommendations sent/received
// ================================================================
function MessagesModal({ userId, onClose }) {
  const [tab,      setTab]      = useState('received')
  const [received, setReceived] = useState(null)
  const [sent,     setSent]     = useState(null)
  const [addingId, setAddingId] = useState(null)
  const [addedIds, setAddedIds] = useState(new Set())

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: rec }, { data: snt }] = await Promise.all([
        supabase.from('book_recommendations').select('*, books(*)').eq('to_user_id', userId).order('created_at', { ascending: false }),
        supabase.from('book_recommendations').select('*, books(*)').eq('from_user_id', userId).order('created_at', { ascending: false }),
      ])
      const ids = [...new Set([...(rec || []).map(r => r.from_user_id), ...(snt || []).map(r => r.to_user_id)])]
      const { data: profiles } = ids.length ? await supabase.from('profiles').select('*').in('id', ids) : { data: [] }
      const pm = Object.fromEntries((profiles || []).map(p => [p.id, p]))
      if (cancelled) return
      setReceived((rec || []).map(r => ({ ...r, profile: pm[r.from_user_id] })))
      setSent((snt || []).map(r => ({ ...r, profile: pm[r.to_user_id] })))
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function addToLibraryFromRec(rec) {
    setAddingId(rec.id)
    try {
      await addToLibrary(userId, rec.books, 'want_to_read')
      setAddedIds(prev => new Set([...prev, rec.id]))
    } catch (e) { alert(e.message) }
    setAddingId(null)
  }

  const list = tab === 'received' ? received : sent

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(5,4,15,0.88)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: C.surface, borderRadius: 14, padding: 24, maxWidth: 440, width: '100%',
        maxHeight: '78vh', display: 'flex', flexDirection: 'column',
        border: `1px solid ${C.border}`, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: C.text, fontFamily: f.serif, fontSize: 18 }}>✈️ Messages</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setTab('received')} style={pill(tab === 'received')}>Received</button>
          <button onClick={() => setTab('sent')} style={pill(tab === 'sent')}>Sent</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {list === null ? <Spinner /> : list.length === 0
            ? <EmptyState icon="✈️" message={tab === 'received' ? 'No books sent to you yet' : "You haven't sent any books yet"}
                sub="Send a book to a friend from the Friends tab" />
            : list.map(rec => (
              <div key={rec.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '10px 0', borderBottom: `1px solid ${C.border}`,
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, color: C.text, fontFamily: f.sans, fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rec.books?.title}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
                    {tab === 'received' ? 'from ' : 'to '}
                    {rec.profile?.display_name || rec.profile?.username || 'Unknown'} · {relativeTime(rec.created_at)}
                  </p>
                </div>
                {tab === 'received' && (
                  addedIds.has(rec.id)
                    ? <span style={{ fontSize: 12, color: C.success, fontWeight: 700, fontFamily: f.sans, flexShrink: 0 }}>✓ Added</span>
                    : <button onClick={() => addToLibraryFromRec(rec)} disabled={addingId === rec.id}
                        style={{ ...btn('ghost', 'sm'), flexShrink: 0 }}>
                        {addingId === rec.id ? '…' : '+ Add'}
                      </button>
                )}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ================================================================
// Nav
// ================================================================
const NAV_TABS = [
  ['home',     '🏠', 'Home'],
  ['discover', '✨', 'Discover'],
  ['search',   '🔍', 'Search'],
  ['friends',  '👥', 'Friends'],
  ['profile',  '👤', 'Profile'],
]

function Nav({ view, setView, userId, onAddClick, onActivityClick, onMessagesClick }) {
  const isMobile = useIsMobile()

  const iconBtn = {
    background: 'none', border: 'none', cursor: 'pointer', color: C.text,
    fontSize: 18, width: 32, height: 32, display: 'flex', alignItems: 'center',
    justifyContent: 'center', borderRadius: 8, flexShrink: 0,
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    <nav style={{
      background: C.nav, borderBottom: `1px solid ${C.border}`,
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      {/* Brand row */}
      <div style={{
        maxWidth: 960, margin: '0 auto', padding: isMobile ? '10px 28px' : '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          fontFamily: f.serif, fontWeight: 700, fontSize: isMobile ? 17 : 19,
          color: C.text, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          📚 BookList
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={onAddClick} title="Add a book" style={iconBtn}>+</button>
          <button onClick={onActivityClick} title="Activity" style={iconBtn}>🔔</button>
          <button onClick={onMessagesClick} title="Messages" style={{ ...iconBtn, fontSize: 16 }}>✈️</button>
        </div>
      </div>

      {/* Tab row — desktop only; mobile uses the fixed bottom bar instead */}
      {!isMobile && (
        <div style={{
          maxWidth: 960, margin: '0 auto', padding: '0 16px 12px',
          display: 'flex', gap: 4,
        }}>
          {NAV_TABS.map(([key, icon, lbl]) => (
            <button key={key} onClick={() => setView(key)} style={{
              flex: 'initial',
              padding: '8px 16px',
              border: 'none', cursor: 'pointer', borderRadius: 20,
              background: view === key ? `${C.primary}26` : 'transparent',
              fontFamily: f.sans, fontSize: 13, fontWeight: 600,
              color: view === key ? C.primary : C.muted,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'background 0.15s, color 0.15s',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              {lbl}
            </button>
          ))}
        </div>
      )}
    </nav>
  )
}

// Fixed bottom tab bar — mobile only, WatchList-style icon-over-label
function BottomTabBar({ view, setView }) {
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: C.nav, borderTop: `1px solid ${C.border}`,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div style={{ display: 'flex' }}>
        {NAV_TABS.map(([key, icon, lbl]) => (
          <button key={key} onClick={() => setView(key)} style={{
            flex: 1, background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 4px 6px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 3,
            fontFamily: f.sans, fontSize: 10, fontWeight: 600,
            color: view === key ? C.primary : C.muted,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <span style={{
              fontSize: 18, width: 34, height: 26, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: view === key ? `${C.primary}26` : 'transparent',
              transition: 'background 0.15s',
            }}>{icon}</span>
            {lbl}
          </button>
        ))}
      </div>
    </nav>
  )
}

// ================================================================
// Root App
// ================================================================
export default function App() {
  const isMobile = useIsMobile()
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [view,    setView]    = useState('home')
  const [drillIn, setDrillIn] = useState(null) // { filter } — full My List view, opened from Home
  const [theme,   setTheme]   = useState(() => localStorage.getItem('bl-theme') || 'dark')
  const [globalAdd,   setGlobalAdd]   = useState(false) // header + button — general add-a-book modal
  const [globalModal, setGlobalModal] = useState(null)  // BookDetailModal opened from that modal
  // Bumped whenever a status/shelf change happens from this global modal, so the
  // currently-visible page (which owns its own data-fetch effect) remounts and
  // re-fetches instead of showing stale data until a hard refresh.
  const [refreshKey, setRefreshKey] = useState(0)
  const [showActivity, setShowActivity] = useState(false) // header bell — activity feed
  const [showMessages, setShowMessages] = useState(false) // header plane — messages inbox
  const [passwordRecovery, setPasswordRecovery] = useState(false) // clicked a "reset password" email link

  // Apply theme before render — all components read module-level C
  C = theme === 'light' ? LIGHT_THEME : DARK_THEME

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('bl-theme', next)
    setTheme(next)
  }

  // Capture invite / shared-book params on load
  const inviteFromRef   = useRef(new URLSearchParams(window.location.search).get('invite'))
  const sharedBookIdRef = useRef(new URLSearchParams(window.location.search).get('share'))
  const sharedByRef     = useRef(new URLSearchParams(window.location.search).get('by'))
  const [sharedNotice, setSharedNotice] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s)
      // Fired when the user lands here via a "reset password" email link —
      // Supabase signs them into a temporary recovery session automatically.
      if (e === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(async ({ data }) => {
        const av = autoAvatar(session.user.email)
        if (!data || !data.avatar_url) {
          // Upsert ensures row exists and gets an avatar
          const { data: upserted } = await supabase.from('profiles').upsert({
            id: session.user.id,
            avatar_url: data?.avatar_url || av,
            display_name: data?.display_name || '',
            username: data?.username || '',
          }, { onConflict: 'id' }).select().maybeSingle()
          setProfile(upserted || { ...data, avatar_url: av, id: session.user.id })
        } else {
          setProfile(data)
        }
      })

    // Handle invite link — auto-send friend request once
    const inviteFrom = inviteFromRef.current
    if (inviteFrom && inviteFrom !== session.user.id) {
      inviteFromRef.current = null // only once
      // Clean URL without reloading
      window.history.replaceState({}, '', window.location.pathname)
      // Auto-accept friendship so both sides see each other's books immediately
      supabase.from('friendships')
        .select('id, status').or(
          `and(requester_id.eq.${session.user.id},addressee_id.eq.${inviteFrom}),` +
          `and(requester_id.eq.${inviteFrom},addressee_id.eq.${session.user.id})`
        ).maybeSingle()
        .then(({ data: existing }) => {
          if (!existing) {
            // No relationship yet — create as accepted straight away
            supabase.from('friendships').insert({
              requester_id: session.user.id,
              addressee_id: inviteFrom,
              status: 'accepted',
            }).then(() => setView('home'))
          } else if (existing.status === 'pending') {
            // Inviter already sent a request — just accept it
            supabase.from('friendships')
              .update({ status: 'accepted' }).eq('id', existing.id)
              .then(() => setView('home'))
          }
        })
    }

    // Handle a shared-book link — auto-add it to Want to Read once
    const sharedBookId = sharedBookIdRef.current
    if (sharedBookId) {
      sharedBookIdRef.current = null // only once
      window.history.replaceState({}, '', window.location.pathname)
      supabase.from('books').select('*').eq('id', sharedBookId).maybeSingle()
        .then(async ({ data: bookRow }) => {
          if (!bookRow) return
          try {
            await addToLibrary(session.user.id, bookRow, 'want_to_read')
            setSharedNotice(`✨ Added "${bookRow.title}" to your Want to Read list`)
            setTimeout(() => setSharedNotice(null), 6000)
          } catch (_) { /* they may already have it — not worth surfacing */ }
        })
    }
  }, [session])

  if (session === undefined) {
    return (
      <div style={{
        minHeight: '100vh', background: C.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ color: C.muted, fontFamily: f.sans, fontStyle: 'italic' }}>
          Opening your library…
        </p>
      </div>
    )
  }

  // Clicked a "reset password" email link — Supabase has them in a temporary
  // recovery session; make them set a new password before entering the app.
  if (passwordRecovery) {
    return <ResetPasswordPage onDone={() => setPasswordRecovery(false)} />
  }

  if (!session) return (
    <AuthPage inviteFrom={inviteFromRef.current}
      sharedBookId={sharedBookIdRef.current} sharedBy={sharedByRef.current} />
  )

  const userId = session.user.id

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {sharedNotice && (
        <div style={{
          position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 2000,
          background: C.success, color: '#0f1117', fontFamily: f.sans, fontSize: 13, fontWeight: 700,
          padding: '10px 18px', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>{sharedNotice}</div>
      )}
      <Nav view={view} setView={(v) => { setDrillIn(null); setView(v) }} userId={userId}
        onAddClick={() => setGlobalAdd(true)}
        onActivityClick={() => setShowActivity(true)}
        onMessagesClick={() => setShowMessages(true)} />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? '20px 28px 84px' : '32px 20px 80px' }}>
        {drillIn ? (
          <MyListPage key={refreshKey} userId={userId} initialFilter={drillIn.filter}
            lockedFilter={drillIn.locked ? drillIn.filter : null}
            onBack={() => setDrillIn(null)} />
        ) : (
          <>
            {view === 'home'     && <HomePage     key={refreshKey} userId={userId}
              onOpenList={(filter, locked) => setDrillIn({ filter, locked })} />}
            {view === 'discover' && <DiscoverPage userId={userId} />}
            {view === 'search'   && <SearchPage   userId={userId} />}
            {view === 'friends'  && <FriendsPage  userId={userId} />}
            {view === 'profile'  && <ProfilePage  userId={userId} email={session.user.email} profile={profile}
              theme={theme} toggleTheme={toggleTheme}
              onSignOut={() => supabase.auth.signOut()}
              onOpenList={(filter, locked) => setDrillIn({ filter, locked })}
              onGoFriends={() => setView('friends')}
              onProfileUpdate={() => supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
                .then(({ data }) => { if (data) setProfile(data) })} />}
          </>
        )}
      </main>

      {isMobile && (
        <BottomTabBar view={view} setView={(v) => { setDrillIn(null); setView(v) }} />
      )}

      {globalAdd && (
        <AddBookModal
          userId={userId}
          onClose={() => setGlobalAdd(false)}
          onOpenModal={(item) => { setGlobalAdd(false); setGlobalModal(item) }}
        />
      )}

      {globalModal && (
        <BookDetailModal
          item={globalModal.type === 'library' ? globalModal.userBook : (globalModal.book || globalModal.userBook?.books)}
          userId={userId}
          onClose={() => setGlobalModal(null)}
          onUpdate={() => setRefreshKey(k => k + 1)}
        />
      )}

      {showActivity && (
        <ActivityFeedModal userId={userId} onClose={() => setShowActivity(false)} />
      )}
      {showMessages && (
        <MessagesModal userId={userId} onClose={() => setShowMessages(false)} />
      )}
    </div>
  )
}
