// ================================================================
// BookList – App.jsx
// Stack: React + Vite + Supabase + Vercel  (single-file)
// Dark cinematic theme · Poster grid · Horizontal scroll rows
// ================================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase client ─────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
const GOOGLE_BOOKS_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY || ''

// ─── Design tokens ───────────────────────────────────────────────
const DARK_THEME = {
  bg:         '#0f1117',
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
  nav:        '#0a0c18',
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

// ─── Google Books API ─────────────────────────────────────────────
async function searchGoogleBooks(query, maxResults = 20) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.searchParams.set('q', query)
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('printType', 'books')
  if (GOOGLE_BOOKS_KEY) url.searchParams.set('key', GOOGLE_BOOKS_KEY)
  const res = await fetch(url.toString())
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Google Books error ${res.status}`)
  }
  const data = await res.json()
  return (data.items || []).map(parseVolume)
}

// ─── Open Library fallback ────────────────────────────────────────
async function searchOpenLibrary(query, maxResults = 20) {
  const url = new URL('https://openlibrary.org/search.json')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(maxResults))
  url.searchParams.set('fields', 'key,title,author_name,cover_i,subject,first_publish_year,number_of_pages_median,isbn')
  const res = await fetch(url.toString())
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
  }))
}

// Try Google Books first, fall back to Open Library on failure
async function searchBooks(query, maxResults = 20) {
  try {
    const results = await searchGoogleBooks(query, maxResults)
    if (results.length > 0) return { results, source: 'google' }
    // Google returned empty — try Open Library
    const olResults = await searchOpenLibrary(query, maxResults)
    return { results: olResults, source: 'openlibrary' }
  } catch (googleErr) {
    console.warn('Google Books failed, trying Open Library:', googleErr.message)
    try {
      const olResults = await searchOpenLibrary(query, maxResults)
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
  }
}

async function upsertBook(book) {
  const { error } = await supabase.from('books').upsert({
    id: book.id, title: book.title, authors: book.authors,
    description: book.description, cover_url: book.cover_url,
    categories: book.categories, published_date: book.published_date,
    page_count: book.page_count, isbn: book.isbn,
  }, { onConflict: 'id' })
  if (error) console.error('upsertBook:', error)
}

async function addToLibrary(userId, book, status) {
  await upsertBook(book)
  const { error } = await supabase.from('user_books').upsert({
    user_id: userId, book_id: book.id, status, position: 0,
  }, { onConflict: 'user_id,book_id' })
  if (error) throw error
}

// ─── Constants ────────────────────────────────────────────────────
const STATUS_LABELS = { reading: 'Reading', read: 'Read', want_to_read: 'Want to Read' }
const STATUS_ICONS  = { reading: '📖', read: '✅', want_to_read: '🔖' }
const STATUS_COLORS = {
  reading:      { bg: '#1a3a2a', color: '#34d399' },
  read:         { bg: '#2a1f3d', color: '#a78bfa' },
  want_to_read: { bg: '#2a1a0a', color: '#f0b429' },
}

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
function PosterCard({ book, userBook, onClick, width = 120, height = 180 }) {
  const [hovered, setHovered] = useState(false)
  const touchStartRef = useRef(null)
  const cover = book?.cover_url || userBook?.books?.cover_url || null
  const title = book?.title || userBook?.books?.title || ''
  const authors = book?.authors || userBook?.books?.authors || []
  const rating = userBook?.rating
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
      role="button"
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

      {/* Rating badge */}
      {rating && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          background: 'rgba(0,0,0,0.8)', borderRadius: 5,
          padding: '2px 6px', fontSize: 11, fontFamily: f.sans,
          fontWeight: 700, color: C.accent, display: 'flex', alignItems: 'center', gap: 2,
        }}>★ {rating}</div>
      )}

      {/* Status corner dot */}
      {status && (
        <div style={{
          position: 'absolute', top: 6, left: 6, width: 8, height: 8, borderRadius: '50%',
          background: STATUS_COLORS[status]?.color || C.muted,
          boxShadow: '0 0 4px rgba(0,0,0,0.6)',
        }} />
      )}

      {/* Title overlay */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '0 0 8px 8px',
        background: 'linear-gradient(transparent, rgba(10,8,24,0.95))',
        padding: '28px 8px 8px',
        opacity: hovered ? 1 : 0.85,
        transition: 'opacity 0.18s',
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
    </div>
  )
}

// ================================================================
// SearchResultCard – poster + quick-add buttons for search
// ================================================================
function SearchResultCard({ book, userId, myBookIds, onAdded, onOpenModal }) {
  const [adding,  setAdding]  = useState(null)
  const [added,   setAdded]   = useState(null)
  const [showRatingPopup, setShowRatingPopup] = useState(false)
  const isInLibrary = myBookIds?.has(book.id)

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {showRatingPopup && (
        <RatingPopup title={book.title} onRate={handleRated} onSkip={() => setShowRatingPopup(false)} />
      )}
      <PosterCard book={book} onClick={onOpenModal} />
      {isInLibrary || added ? (
        <div style={{
          background: STATUS_COLORS[added || 'read']?.bg || C.surface2,
          borderRadius: 6, padding: '5px 4px', textAlign: 'center',
          fontSize: 10, fontFamily: f.sans, fontWeight: 700,
          color: STATUS_COLORS[added || 'read']?.color || C.success,
        }}>
          {STATUS_ICONS[added]} {STATUS_LABELS[added] || 'In Library'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
            <button key={key} onClick={() => handleAdd(key)} disabled={!!adding}
              style={{
                padding: '5px 4px', borderRadius: 5, border: 'none',
                cursor: adding ? 'not-allowed' : 'pointer',
                fontFamily: f.sans, fontSize: 11, fontWeight: 700,
                background: key === 'want_to_read' ? C.accent
                  : key === 'reading' ? C.primary : C.success,
                color: key === 'want_to_read' ? '#0f1117' : C.white,
                opacity: adding && adding !== key ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}>
              {adding === key ? '…' : `${STATUS_ICONS[key]} ${lbl}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ================================================================
// HorizontalRow – scrollable shelf row
// ================================================================
function HorizontalRow({ title, items, renderItem, emptyMsg, loading, seeAllAction }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0, color: C.text, fontSize: 18, fontWeight: 700, fontFamily: f.sans }}>
          {title}
        </h2>
        {seeAllAction && items.length > 0 && (
          <button onClick={seeAllAction} style={{ ...btn('ghost', 'sm'), fontSize: 12 }}>
            See All →
          </button>
        )}
      </div>
      {loading ? <Spinner /> : items.length === 0
        ? <p style={{ color: C.muted, fontFamily: f.sans, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
            {emptyMsg}
          </p>
        : (
          <div style={{
            display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8,
            scrollbarWidth: 'none', msOverflowStyle: 'none',
          }}>
            {items.map(renderItem)}
          </div>
        )
      }
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

// ================================================================
// BookDetailModal – full info overlay
// ================================================================
function BookDetailModal({ item, userId, onClose, onUpdate }) {
  const isMobile = useIsMobile()
  const isLibraryBook = !!item?.user_id
  const book = isLibraryBook ? (item.books || {}) : item
  const userBook = isLibraryBook ? item : null

  const [status,       setStatus]       = useState(userBook?.status || '')
  const [rating,       setRating]       = useState(userBook?.rating || null)
  const [notes,        setNotes]        = useState(userBook?.notes || '')
  const [top10,        setTop10]        = useState(userBook?.top_10 || false)
  const [adding,       setAdding]       = useState(null)
  const [saved,        setSaved]        = useState(false)   // flash checkmark
  const [showRating,   setShowRating]   = useState(false)
  const [following,    setFollowing]    = useState(false)
  const [isFollowed,   setIsFollowed]   = useState(false)
  const [showTop10Picker, setShowTop10Picker] = useState(false)
  const [existingTop10,   setExistingTop10]   = useState([])
  const [msg,             setMsg]             = useState(null)

  function flashSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  const authors = book?.authors || []

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Check if already following first author
  useEffect(() => {
    if (!authors[0] || !userId) return
    supabase.from('author_follows')
      .select('id').eq('user_id', userId).eq('author', authors[0]).maybeSingle()
      .then(({ data }) => setIsFollowed(!!data))
  }, [authors[0], userId])

  async function handleAddToLibrary(st) {
    setAdding(st)
    try {
      await addToLibrary(userId, book, st)
      if (st === 'read') {
        setShowRating(true)
      } else {
        setMsg({ type: 'success', text: `Added to ${STATUS_LABELS[st]}!` })
        onUpdate?.()
        setTimeout(onClose, 900)
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    }
    setAdding(null)
  }

  async function handleStatusChange(newStatus) {
    if (!userBook) return
    const wasNotRead = userBook.status !== 'read' && newStatus === 'read'
    setStatus(newStatus)
    await supabase.from('user_books').update({ status: newStatus }).eq('id', userBook.id)
    onUpdate?.()
    if (wasNotRead && !rating) {
      setShowRating(true)
    } else {
      flashSaved()
    }
  }

  async function handleRatingChange(stars) {
    if (!userBook) return
    setRating(stars)
    await supabase.from('user_books').update({ rating: stars }).eq('id', userBook.id)
    onUpdate?.()
    flashSaved()
  }

  async function handleNotesSave() {
    if (!userBook) return
    await supabase.from('user_books').update({ notes }).eq('id', userBook.id)
    onUpdate?.()
    flashSaved()
  }

  async function handleToggleTop10() {
    if (!userBook) return
    if (top10) {
      // Removing from Top 10
      setTop10(false)
      await supabase.from('user_books')
        .update({ top_10: false }).eq('id', userBook.id)
      onUpdate?.()
      setMsg({ type: 'success', text: 'Removed from Top 10' })
      setTimeout(() => setMsg(null), 2000)
      return
    }
    // Check current Top 10 count
    const { data: currentTop10 } = await supabase.from('user_books')
      .select('id, books(title, cover_url)')
      .eq('user_id', userId).eq('top_10', true)
    if ((currentTop10 || []).length >= 10) {
      setExistingTop10(currentTop10 || [])
      setShowTop10Picker(true)
    } else {
      setTop10(true)
      await supabase.from('user_books')
        .update({ top_10: true }).eq('id', userBook.id)
      onUpdate?.()
      setMsg({ type: 'success', text: '⭐ Added to Top 10!' })
      setTimeout(() => setMsg(null), 2000)
    }
  }

  async function handleTop10Replace(removeId) {
    // Remove one, add current
    await supabase.from('user_books').update({ top_10: false }).eq('id', removeId)
    await supabase.from('user_books')
      .update({ top_10: true }).eq('id', userBook.id)
    setTop10(true)
    setShowTop10Picker(false)
    onUpdate?.()
    setMsg({ type: 'success', text: '⭐ Updated your Top 10!' })
    setTimeout(() => setMsg(null), 2000)
  }

  async function handleRated(stars) {
    const target = userBook
      ? supabase.from('user_books').update({ rating: stars }).eq('id', userBook.id)
      : supabase.from('user_books').update({ rating: stars })
          .eq('user_id', userId).eq('book_id', book.id)
    await target
    setRating(stars)
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
    if (!userBook) return
    if (!confirm('Remove from your library?')) return
    await supabase.from('user_books').delete().eq('id', userBook.id)
    onUpdate?.()
    onClose()
  }

  return (
    <>
    {showRating && (
      <RatingPopup
        title={book?.title}
        onRate={handleRated}
        onSkip={() => { setShowRating(false); onUpdate?.(); onClose() }}
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
                <span style={{ color: C.text, fontFamily: f.sans, fontSize: 14, fontWeight: 600 }}>
                  {ub.books?.title}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: C.danger, fontFamily: f.sans, flexShrink: 0 }}>
                  Remove ×
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
            <h2 style={{ margin: '0 0 6px', color: C.text, fontSize: 20, fontFamily: f.serif,
              fontWeight: 700, lineHeight: 1.2 }}>
              {book.title}
            </h2>
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
            {book.categories?.length > 0 && (
              <p style={{ margin: '0 0 10px', fontSize: 12, color: C.primary, fontFamily: f.sans }}>
                {book.categories.slice(0,3).join(' · ')}
              </p>
            )}
            {book.page_count && (
              <p style={{ margin: '0 0 10px', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
                {book.page_count} pages
              </p>
            )}
            {book.description && (
              <p style={{
                margin: 0, fontSize: 13, color: C.muted, fontFamily: f.sans, lineHeight: 1.5,
                display: '-webkit-box', WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>{book.description}</p>
            )}
          </div>
        </div>

        {/* In library: status / rating / notes */}
        {isLibraryBook && (
          <>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18, marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Status</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
                  <button key={key} onClick={() => handleStatusChange(key)}
                    style={{ ...pill(status === key), fontSize: 12 }}>
                    {STATUS_ICONS[key]} {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: 11, color: C.muted, fontFamily: f.sans,
                  textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>My Rating</p>
                {saved && <span style={{ fontSize: 11, color: C.success, fontFamily: f.sans }}>✓ Saved</span>}
              </div>
              <StarRating value={rating} onChange={handleRatingChange} size={24} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, fontFamily: f.sans,
                textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Notes</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                onBlur={handleNotesSave}
                placeholder="Your thoughts, quotes, reflections…"
                style={{ ...inputStyle, height: 80, resize: 'vertical', fontSize: 13 }} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={handleToggleTop10}
                style={{
                  ...btn(top10 ? 'accent' : 'ghost', 'sm'),
                  borderColor: top10 ? C.accent : C.border,
                }}>
                {top10 ? '⭐ In Top 10' : '☆ Add to Top 10'}
              </button>
              <button onClick={handleRemove} style={btn('danger', 'sm')}>
                Remove
              </button>
            </div>
          </>
        )}

        {/* Not in library: add buttons */}
        {!isLibraryBook && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
            {msg
              ? <p style={{ margin: 0, fontSize: 14, fontFamily: f.sans, color: C.success }}>{msg.text}</p>
              : (
                <div>
                  <p style={{ margin: '0 0 10px', fontSize: 13, color: C.muted, fontFamily: f.sans }}>
                    Add to your library:
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
                      <button key={key} onClick={() => handleAddToLibrary(key)}
                        disabled={!!adding}
                        style={btn(key === 'want_to_read' ? 'accent' : 'primary', 'sm')}>
                        {adding === key ? 'Adding…' : `${STATUS_ICONS[key]} ${lbl}`}
                      </button>
                    ))}
                  </div>
                </div>
              )
            }
          </div>
        )}
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

function AuthPage({ inviteFrom }) {
  const [mode, setMode] = useState(inviteFrom ? 'signup' : 'signin')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [username, setUsername]     = useState('')
  const [displayName, setDisplayName] = useState('')
  const [avatar, setAvatar]         = useState('')   // '' = auto-assign at submit
  const [loading, setLoading]       = useState(false)
  const [msg, setMsg]               = useState(null)

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
            {inviteFrom ? "You've been invited! Create an account to connect." : 'Your literary life, organized'}
          </p>
        </div>

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
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4, fontFamily: f.sans, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Password</label>
              <input style={inputStyle} type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" minLength={mode === 'signup' ? 8 : undefined} required />
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
function RecoCard({ book, userId, myBookIds, onAdded, onDismiss, onOpenModal }) {
  const [hovered,  setHovered]  = useState(false)
  const [adding,   setAdding]   = useState(null)
  const [added,    setAdded]    = useState(null)
  const [showRating, setShowRating] = useState(false)
  const inLibrary = myBookIds?.has(book.id) || !!added

  async function handleAdd(status) {
    setAdding(status)
    try {
      await addToLibrary(userId, book, status)
      setAdded(status)
      if (status === 'read') {
        setShowRating(true)
        // Don't call onAdded yet — wait until after rating so card stays mounted
      } else {
        onAdded?.(book.id)
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
    onAdded?.(book.id)  // reload after rating is saved
  }

  return (
    <div style={{ flexShrink: 0, position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      {showRating && (
        <RatingPopup title={book.title} onRate={handleRated}
          onSkip={() => { setShowRating(false); onAdded?.(book.id) }} />
      )}
      <PosterCard book={book} onClick={onOpenModal} />

      {/* Hover overlay — clicks on background open modal, buttons stop propagation */}
      {hovered && (
        <div onClick={onOpenModal} style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          background: 'rgba(10,8,24,0.72)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'flex-end',
          paddingBottom: 14,
        }}>
          {inLibrary ? (
            <div style={{
              background: 'rgba(52,211,153,0.15)', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, color: C.success,
              fontFamily: f.sans, fontWeight: 700,
            }}>
              {STATUS_ICONS[added]} {STATUS_LABELS[added] || 'In library'}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { st: 'want_to_read', icon: '🔖', bg: C.accent,   fg: '#0f1117', label: 'Want to Read',  dismiss: false },
                { st: 'read',         icon: '✅', bg: C.success,  fg: C.white,   label: 'Read',          dismiss: false },
                { st: 'not_for_me',   icon: '✕',  bg: '#3d1f1f',  fg: '#ff7070', label: 'Not for Me',    dismiss: true  },
              ].map(({ st, icon, bg, fg, label, dismiss }) => (
                <button key={st}
                  onClick={(e) => { e.stopPropagation(); dismiss ? handleDismiss() : handleAdd(st) }}
                  title={label}
                  disabled={!!adding}
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: bg, border: 'none', cursor: adding ? 'not-allowed' : 'pointer',
                    fontSize: dismiss ? 12 : 14,
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
// Home page – rows + inline search
// ================================================================
function HomePage({ userId, setView }) {
  const [searchQ,      setSearchQ]      = useState('')
  const [searchRes,    setSearchRes]    = useState([])
  const [searching,    setSearching]    = useState(false)
  const [searchErr,    setSearchErr]    = useState(null)
  const [searchSource, setSearchSource] = useState(null)

  const [myBooks,      setMyBooks]      = useState([])
  const [friendBooks,  setFriendBooks]  = useState([])
  const [friendProfiles, setFriendProfiles] = useState({})
  const [genreRecs,    setGenreRecs]    = useState([])
  const [authorRecs,   setAuthorRecs]   = useState([])
  const [recentlyRead, setRecentlyRead] = useState([])
  const [loadingData,  setLoadingData]  = useState(true)
  const [myBookIds,    setMyBookIds]    = useState(new Set())
  const [dismissedRecs, setDismissedRecs] = useState(new Set())

  const [modal,        setModal]        = useState(null)
  const debounceRef = useRef(null)

  const loadHomeData = useCallback(async () => {
    setLoadingData(true)

    // My library
    const { data: myLib } = await supabase
      .from('user_books').select('*, books(*)').eq('user_id', userId)
      .order('updated_at', { ascending: false })
    const lib = myLib || []
    setMyBooks(lib)
    const ids = new Set(lib.map(u => u.book_id))
    setMyBookIds(ids)

    // Friends' books
    const { data: fships } = await supabase.from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted')

    if (fships?.length > 0) {
      const friendIds = fships.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
      const [{ data: fBooks }, { data: fProfs }] = await Promise.all([
        supabase.from('user_books').select('*, books(*)').in('user_id', friendIds)
          .order('updated_at', { ascending: false }).limit(40),
        supabase.from('profiles').select('id, display_name, username').in('id', friendIds),
      ])
      setFriendBooks(fBooks || [])
      setFriendProfiles(Object.fromEntries((fProfs || []).map(p => [p.id, p])))
    }

    // Genre recs — show regardless of friends or ratings
    try {
      const topRated  = lib.filter(u => (u.rating || 0) >= 4)
      const booksPool = topRated.length > 0 ? topRated : lib  // fall back to whole library
      const cats      = [...new Set(booksPool.flatMap(u => u.books?.categories || []))]
      // If library empty, use popular literary genres as seeds
      const fallback  = ['literary fiction', 'biography', 'history', 'mystery', 'science']
      const pool      = cats.length > 0 ? cats : fallback
      const cat       = pool[Math.floor(Math.random() * pool.length)]
      const { results } = await searchBooks(`subject:"${cat}"`, 12)
      setGenreRecs(results.filter(b => !ids.has(b.id)).slice(0, 10).map(b => ({ ...b, reason: cat })))
    } catch (_) { /* optional */ }

    // Recently read
    setRecentlyRead(lib.filter(u => u.status === 'read').slice(0, 12))

    // Author follows
    try {
      const { data: follows } = await supabase.from('author_follows')
        .select('author').eq('user_id', userId)
      if (follows?.length > 0) {
        const author = follows[Math.floor(Math.random() * follows.length)].author
        const { results } = await searchBooks(`inauthor:"${author}"`, 10)
        setAuthorRecs(results.filter(b => !ids.has(b.id)).slice(0, 8)
          .map(b => ({ ...b, reason: `More by ${author}` })))
      }
    } catch (_) { /* optional */ }

    setLoadingData(false)
  }, [userId])

  useEffect(() => { loadHomeData() }, [loadHomeData])

  // Debounced search
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

  const reading     = myBooks.filter(u => u.status === 'reading')
  const wantToRead  = myBooks.filter(u => u.status === 'want_to_read')
  const friendReading = friendBooks.filter(u => u.status === 'reading')
  const friendWant    = friendBooks.filter(u => u.status === 'want_to_read')
  const friendFaves   = friendBooks.filter(u => u.status === 'read' && (u.rating || 0) >= 4)

  const isSearching = searchQ.trim().length > 0

  return (
    <div>
      {/* Search bar */}
      <div style={{ marginBottom: 32, position: 'relative' }}>
        <input
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

      {/* Search results */}
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
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 16,
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
        <>
          <HorizontalRow
            title="📖 Currently Reading"
            items={reading}
            renderItem={ub => (
              <PosterCard key={ub.id} userBook={ub}
                onClick={() => setModal({ type: 'library', userBook: ub })} />
            )}
            emptyMsg="Nothing in progress — find your next read below"
            loading={loadingData}
            seeAllAction={() => setView('mylist')}
          />

          <HorizontalRow
            title="🔖 Want to Read"
            items={wantToRead}
            renderItem={ub => (
              <PosterCard key={ub.id} userBook={ub}
                onClick={() => setModal({ type: 'library', userBook: ub })} />
            )}
            emptyMsg="Your reading queue is empty"
            loading={loadingData}
            seeAllAction={() => setView('mylist')}
          />

          <HorizontalRow
            title="👥 Friends Are Reading"
            items={friendReading}
            renderItem={ub => (
              <div key={ub.id} style={{ flexShrink: 0 }}>
                <PosterCard userBook={ub}
                  onClick={() => setModal({ type: 'friendbook', book: ub.books, userBook: ub })} />
                <p style={{ margin: '4px 0 0', fontSize: 10, color: C.muted, fontFamily: f.sans,
                  width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {friendProfiles[ub.user_id]?.display_name || ''}
                </p>
              </div>
            )}
            emptyMsg="Add friends to see what they're reading"
            loading={loadingData}
          />

          <HorizontalRow
            title="📚 Friends Want to Read"
            items={friendWant.slice(0, 12)}
            renderItem={ub => (
              <div key={ub.id} style={{ flexShrink: 0 }}>
                <PosterCard userBook={ub}
                  onClick={() => setModal({ type: 'friendbook', book: ub.books, userBook: ub })} />
                <p style={{ margin: '4px 0 0', fontSize: 10, color: C.muted, fontFamily: f.sans,
                  width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {friendProfiles[ub.user_id]?.display_name || ''}
                </p>
              </div>
            )}
            emptyMsg="No friends on the app yet"
            loading={loadingData}
          />

          <HorizontalRow
            title="⭐ Friends' Favorites"
            items={friendFaves.slice(0, 12)}
            renderItem={ub => (
              <div key={ub.id} style={{ flexShrink: 0 }}>
                <PosterCard userBook={ub}
                  onClick={() => setModal({ type: 'friendbook', book: ub.books, userBook: ub })} />
                <p style={{ margin: '4px 0 0', fontSize: 10, color: C.muted, fontFamily: f.sans,
                  width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {friendProfiles[ub.user_id]?.display_name || ''}
                </p>
              </div>
            )}
            emptyMsg="Your friends haven't rated books yet"
            loading={loadingData}
          />

          {authorRecs.filter(b => !dismissedRecs.has(b.id)).length > 0 && (
            <HorizontalRow
              title="✍️ From Authors You Follow"
              items={authorRecs.filter(b => !dismissedRecs.has(b.id))}
              renderItem={book => (
                <RecoCard key={book.id} book={book} userId={userId}
                  myBookIds={myBookIds}
                  onAdded={id => { setMyBookIds(prev => new Set([...prev, id])); loadHomeData() }}
                  onDismiss={id => setDismissedRecs(prev => new Set([...prev, id]))}
                  onOpenModal={() => setModal({ type: 'search', book })} />
              )}
              emptyMsg=""
              loading={false}
            />
          )}

          <HorizontalRow
            title="✨ Suggested for You"
            items={genreRecs.filter(b => !dismissedRecs.has(b.id))}
            renderItem={book => (
              <RecoCard key={book.id} book={book} userId={userId}
                myBookIds={myBookIds}
                onAdded={id => { setMyBookIds(prev => new Set([...prev, id])); loadHomeData() }}
                onDismiss={id => setDismissedRecs(prev => new Set([...prev, id]))}
                onOpenModal={() => setModal({ type: 'search', book })} />
            )}
            emptyMsg="Loading recommendations…"
            loading={loadingData}
          />

          {recentlyRead.length > 0 && (
            <HorizontalRow
              title="✅ Read"
              items={recentlyRead}
              renderItem={ub => (
                <PosterCard key={ub.id} userBook={ub}
                  onClick={() => setModal({ type: 'library', userBook: ub })} />
              )}
              emptyMsg=""
              loading={false}
              seeAllAction={() => setView('mylist')}
            />
          )}
        </>
      )}

      {/* Detail modal */}
      {modal && (
        <BookDetailModal
          item={modal.type === 'library' ? modal.userBook : (modal.book || modal.userBook?.books)}
          userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => { setModal(null); loadHomeData() }}
        />
      )}
    </div>
  )
}

// ================================================================
// My List page – poster grid with filter pills
// ================================================================
function MyListPage({ userId }) {
  const [filter,    setFilter]    = useState('all')
  const [searchQ,   setSearchQ]   = useState('')
  const [userBooks, setUserBooks] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [dragIdx,   setDragIdx]   = useState(null)
  const [overIdx,   setOverIdx]   = useState(null)

  const fetchBooks = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('user_books').select('*, books(*)')
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
    setUserBooks(data || [])
    setLoading(false)
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
  }

  const baseFiltered = filter === 'all' ? userBooks : userBooks.filter(u => u.status === filter)
  const q = searchQ.toLowerCase().trim()
  const matched = q
    ? baseFiltered.filter(u => {
        const title   = (u.books?.title || '').toLowerCase()
        const authors = (u.books?.authors || []).join(' ').toLowerCase()
        return title.includes(q) || authors.includes(q)
      })
    : baseFiltered
  const isQueue = filter === 'want_to_read' && !q
  // Sort: Top 10 first, then by rating desc — except in drag-reorder queue mode
  const visible = isQueue ? matched : [...matched].sort((a, b) => {
    if (!!b.top_10 !== !!a.top_10) return b.top_10 ? 1 : -1
    return (b.rating || 0) - (a.rating || 0)
  })

  // Drag for want_to_read queue
  function onDragStart(e, idx) { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }
  function onDragOver(e, idx)  { e.preventDefault(); if (idx !== overIdx) setOverIdx(idx) }
  function onDrop(e, idx) {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const wtr = visible.slice()
    const [moved] = wtr.splice(dragIdx, 1)
    wtr.splice(idx, 0, moved)
    setDragIdx(null); setOverIdx(null)
    handleReorder(wtr)
  }

  return (
    <div>
      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="🔍  Search your library…"
          style={{
            ...inputStyle, fontSize: 14, padding: '10px 40px 10px 14px',
            borderRadius: 8, border: `1px solid ${searchQ ? C.primary : C.border}`,
          }}
        />
        {searchQ && (
          <button onClick={() => setSearchQ('')}
            style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18,
            }}>×</button>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          ['all', 'All', counts.all],
          ['reading', '📖 Reading', counts.reading],
          ['read', '✅ Read', counts.read],
          ['want_to_read', '🔖 Want to Read', counts.want_to_read],
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

      {isQueue && visible.length > 1 && (
        <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
          ⠿ Drag covers to reorder your queue
        </p>
      )}

      {loading ? <Spinner /> : visible.length === 0
        ? <EmptyState message="Nothing here yet" sub='Search for books to add them to your library' />
        : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 16,
          }}>
            {visible.map((ub, idx) => (
              <div key={ub.id}
                draggable={isQueue}
                onDragStart={isQueue ? e => onDragStart(e, idx) : undefined}
                onDragOver={isQueue ? e => onDragOver(e, idx) : undefined}
                onDrop={isQueue ? e => onDrop(e, idx) : undefined}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                style={{
                  opacity: isQueue && dragIdx === idx ? 0.4 : 1,
                  outline: isQueue && overIdx === idx && dragIdx !== idx
                    ? `2px solid ${C.primary}`
                    : ub.top_10
                      ? `3px solid ${C.accent}`
                      : '2px solid transparent',
                  borderRadius: 10, transition: 'opacity 0.15s',
                  boxShadow: ub.top_10 ? `0 0 12px rgba(240,180,41,0.35)` : 'none',
                }}
              >
                <PosterCard
                  userBook={ub}
                  onClick={() => setModal(ub)}
                />
                {ub.top_10 && (
                  <div style={{
                    textAlign: 'center', fontSize: 10, fontFamily: f.sans, fontWeight: 700,
                    color: C.accent, marginTop: 3,
                  }}>⭐ Top 10</div>
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
          onUpdate={() => { setModal(null); fetchBooks() }}
        />
      )}
    </div>
  )
}

// ================================================================
// FriendListView – full-page view of a single friend's library
// ================================================================
function FriendListView({ friendProfile, userId, myBookIds, setMyBookIds, onBack }) {
  const friendId = friendProfile.id
  const [books,       setBooks]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [filter,      setFilter]      = useState('all')
  const [searchQ,     setSearchQ]     = useState('')
  const [addingBook,  setAddingBook]  = useState(null)
  const [modal,       setModal]       = useState(null)
  const [hoveredId,   setHoveredId]   = useState(null)

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
    } catch (e) { alert(e.message) }
    setAddingBook(null)
  }

  const counts = {
    all:          books.length,
    reading:      books.filter(u => u.status === 'reading').length,
    read:         books.filter(u => u.status === 'read').length,
    want_to_read: books.filter(u => u.status === 'want_to_read').length,
  }
  const q = searchQ.toLowerCase()
  const baseFiltered = filter === 'all' ? books : books.filter(u => u.status === filter)
  const matched = q
    ? baseFiltered.filter(u => (u.books?.title||'').toLowerCase().includes(q) || (u.books?.authors||[]).join(' ').toLowerCase().includes(q))
    : baseFiltered
  // Sort: Top 10 first, then by rating desc
  const visible = [...matched].sort((a, b) => {
    if (!!b.top_10 !== !!a.top_10) return b.top_10 ? 1 : -1
    return (b.rating || 0) - (a.rating || 0)
  })

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
              {friendProfile.display_name || friendProfile.username}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans }}>
              @{friendProfile.username} · {counts.all} books
            </p>
          </div>
        </div>
      </div>

      {/* Search their list */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="🔍  Search their list…"
          style={{ ...inputStyle, padding: '10px 38px 10px 14px', borderRadius: 8,
            border: `1px solid ${searchQ ? C.primary : C.border}` }} />
        {searchQ && (
          <button onClick={() => setSearchQ('')} style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18,
          }}>×</button>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {[
          ['all',          'All',              counts.all],
          ['reading',      '📖 Reading',       counts.reading],
          ['read',         '✅ Read',          counts.read],
          ['want_to_read', '🔖 Want to Read',  counts.want_to_read],
        ].map(([key, lbl, count]) => (
          <button key={key} onClick={() => setFilter(key)} style={pill(filter === key)}>
            {lbl}
            <span style={{
              marginLeft: 6, fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
              background: filter === key ? 'rgba(255,255,255,0.2)' : C.border,
              color: filter === key ? C.white : C.muted,
            }}>{count}</span>
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : visible.length === 0
        ? <EmptyState message="Nothing here" sub="No books match this filter" />
        : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 16,
          }}>
            {visible.map(ub => {
              const book      = ub.books || {}
              const inLibrary = myBookIds.has(ub.book_id)
              const isHovered = hoveredId === ub.id
              return (
                <div key={ub.id}
                  onMouseEnter={() => setHoveredId(ub.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ position: 'relative' }}
                >
                  {/* Top 10 gold border if friend has it */}
                  <div style={{
                    borderRadius: 10,
                    outline: ub.top_10 ? `3px solid ${C.accent}` : 'none',
                  }}>
                    <PosterCard userBook={ub} onClick={() => setModal(book)} />
                  </div>

                  {/* Hover overlay with quick-add buttons */}
                  {isHovered && !inLibrary && (
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: 8,
                      background: 'rgba(10,8,24,0.82)',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: 10,
                    }}>
                      <p style={{ margin: 0, fontSize: 10, color: C.muted, fontFamily: f.sans, textAlign: 'center' }}>
                        Add to your library:
                      </p>
                      {[
                        ['want_to_read', '🔖', 'Want'],
                        ['reading',      '📖', 'Reading'],
                        ['read',         '✅', 'Read'],
                      ].map(([st, icon, lbl]) => (
                        <button key={st} onClick={() => quickAdd(book, st)}
                          disabled={!!addingBook}
                          style={{
                            width: '100%', padding: '6px 4px', borderRadius: 6,
                            border: 'none', cursor: addingBook ? 'not-allowed' : 'pointer',
                            fontFamily: f.sans, fontSize: 11, fontWeight: 700,
                            background: st === 'want_to_read' ? C.accent
                              : st === 'reading' ? C.primary : C.success,
                            color: st === 'want_to_read' ? '#0f1117' : C.white,
                            opacity: addingBook && addingBook !== book.id + st ? 0.6 : 1,
                          }}>
                          {addingBook === book.id + st ? '…' : `${icon} ${lbl}`}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Already in library badge on hover */}
                  {isHovered && inLibrary && (
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: 8,
                      background: 'rgba(10,8,24,0.7)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontSize: 12, color: C.success, fontFamily: f.sans, fontWeight: 700 }}>
                        ✓ In library
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }

      {modal && (
        <BookDetailModal item={modal} userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => setModal(null)} />
      )}
    </div>
  )
}

// ================================================================
// Friends page
// ================================================================
function FriendsPage({ userId }) {
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
  const [modal,        setModal]        = useState(null)

  function copyInviteLink() {
    const link = `${window.location.origin}${window.location.pathname}?invite=${userId}`
    navigator.clipboard.writeText(link).then(() => {
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2500)
    })
  }

  const loadFriendships = useCallback(async () => {
    setLoading(true)
    // Load my library IDs for quick-add comparison
    const { data: myLib } = await supabase.from('user_books').select('book_id').eq('user_id', userId)
    setMyBookIds(new Set((myLib || []).map(r => r.book_id)))

    const { data: fships } = await supabase.from('friendships').select('*')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    if (!fships) { setLoading(false); return }

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

  const sectionHdr = (text) => (
    <h3 style={{ margin: '0 0 14px', color: C.text, fontSize: 15, fontFamily: f.sans, fontWeight: 700 }}>{text}</h3>
  )

  const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, marginBottom: 16 }

  // If viewing a friend's full list, render that component
  if (friendView) {
    return (
      <FriendListView
        friendProfile={friendView}
        userId={userId}
        myBookIds={myBookIds}
        setMyBookIds={setMyBookIds}
        onBack={() => setFriendView(null)}
      />
    )
  }

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Invite link */}
      <div style={{
        ...card,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div>
          <p style={{ margin: '0 0 3px', fontWeight: 700, color: C.text, fontFamily: f.sans, fontSize: 14 }}>
            📨 Invite a Friend
          </p>
          <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans }}>
            Share your personal invite link — they'll be auto-connected when they sign up.
          </p>
        </div>
        <button onClick={copyInviteLink}
          style={{ ...btn(inviteCopied ? 'subtle' : 'accent', 'sm'), flexShrink: 0 }}>
          {inviteCopied ? '✓ Copied!' : '🔗 Copy Link'}
        </button>
      </div>

      {/* Find readers */}
      <div style={{ ...card }}>
        {sectionHdr('🔍 Find Readers')}
        <form onSubmit={searchUsers} style={{ display: 'flex', gap: 8 }}>
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
      </div>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div style={card}>
          {sectionHdr(`📬 Friend Requests (${incoming.length})`)}
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

      {/* Outgoing */}
      {outgoing.length > 0 && (
        <div style={card}>
          {sectionHdr('Sent Requests')}
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

      {/* Friends list — WatchList style */}
      {sectionHdr(`Your Friends (${friends.length})`)}
      {loading ? <Spinner /> : friends.length === 0
        ? <EmptyState icon="👥" message="No friends yet" sub="Search above to find other readers" />
        : friends.map(f => (
            <div key={f.id} style={{
              ...card,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', cursor: 'default',
            }}>
              {/* Avatar + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${C.primaryDim}, ${C.surface2})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, border: `2px solid ${C.border}`, flexShrink: 0,
                }}>
                  {f.friendProfile?.avatar_url || '👤'}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: C.text, fontFamily: f.sans }}>
                    {f.friendProfile?.display_name || f.friendProfile?.username || 'Unknown'}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: C.muted, fontFamily: f.sans }}>
                    @{f.friendProfile?.username}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setFriendView(f.friendProfile)}
                  style={{ ...btn('ghost', 'sm'), fontSize: 13 }}>
                  View List →
                </button>
                <button onClick={() => remove(f.id)} style={btn('subtle', 'sm')}>Unfriend</button>
              </div>
            </div>
          ))
      }
    </div>
  )
}

// ================================================================
// Activity page – timeline feed
// ================================================================
function ActivityPage({ userId }) {
  const [feed,       setFeed]       = useState([])
  const [profileMap, setProfileMap] = useState({})
  const [received,   setReceived]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(null)
  const [myBookIds,  setMyBookIds]  = useState(new Set())

  useEffect(() => { loadActivity() }, [userId])

  async function loadActivity() {
    setLoading(true)

    // My book IDs
    const { data: myLib } = await supabase.from('user_books').select('book_id').eq('user_id', userId)
    setMyBookIds(new Set((myLib || []).map(r => r.book_id)))

    // Friends
    const { data: fships } = await supabase.from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted')

    if (!fships?.length) { setLoading(false); return }

    const friendIds = fships.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
    const [{ data: acts }, { data: profs }, { data: recs }] = await Promise.all([
      supabase.from('user_books').select('*, books(*)').in('user_id', friendIds)
        .order('updated_at', { ascending: false }).limit(60),
      supabase.from('profiles').select('id, display_name, username').in('id', friendIds),
      supabase.from('book_recommendations').select('*, books(*)')
        .eq('to_user_id', userId).order('created_at', { ascending: false }).limit(10),
    ])

    setFeed(acts || [])
    setProfileMap(Object.fromEntries((profs || []).map(p => [p.id, p])))

    // Enrich received recs with sender profiles
    if (recs?.length) {
      const fromIds = [...new Set(recs.map(r => r.from_user_id))]
      const { data: fromProfs } = await supabase.from('profiles').select('id, display_name, username').in('id', fromIds)
      const pm2 = Object.fromEntries((fromProfs || []).map(p => [p.id, p]))
      setReceived(recs.map(r => ({ ...r, fromProfile: pm2[r.from_user_id] })))
    }

    setLoading(false)
  }

  async function addRecBook(book, status) {
    await addToLibrary(userId, book, status)
    setMyBookIds(prev => new Set([...prev, book.id]))
  }

  if (loading) return <Spinner text="Loading activity…" />

  if (!feed.length && !received.length) {
    return <EmptyState icon="📡" message="No activity yet"
      sub="Add friends to see what they're reading and rating" />
  }

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Received recommendations */}
      {received.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, marginBottom: 28 }}>
          <h3 style={{ margin: '0 0 16px', color: C.text, fontSize: 15, fontFamily: f.sans, fontWeight: 700 }}>
            📬 Recommended to You ({received.length})
          </h3>
          {received.map(rec => (
            <div key={rec.id} style={{
              display: 'flex', gap: 14, paddingBottom: 14, marginBottom: 14,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ flexShrink: 0, cursor: 'pointer' }}
                onClick={() => setModal({ type: 'search', book: rec.books })}>
                {rec.books?.cover_url
                  ? <img src={rec.books.cover_url} alt={rec.books.title}
                      style={{ width: 48, height: 72, objectFit: 'cover', borderRadius: 5 }} />
                  : <NoCover title={rec.books?.title} width={48} height={72} />
                }
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 14, color: C.text, fontFamily: f.sans }}>
                  {rec.books?.title}
                </p>
                <p style={{ margin: '0 0 4px', fontSize: 12, color: C.muted, fontFamily: f.sans }}>
                  From {rec.fromProfile?.display_name || rec.fromProfile?.username || 'a friend'}
                  {' · '}{timeAgo(rec.created_at)}
                </p>
                {rec.message && (
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: C.text, fontStyle: 'italic', fontFamily: f.sans }}>
                    "{rec.message}"
                  </p>
                )}
                {!myBookIds.has(rec.book_id) && (
                  <button onClick={() => addRecBook(rec.books, 'want_to_read')}
                    style={btn('accent', 'sm')}>+ Add to Queue</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity feed */}
      <h3 style={{ margin: '0 0 16px', color: C.text, fontSize: 15, fontFamily: f.sans, fontWeight: 700 }}>
        🕐 Recent Activity
      </h3>

      {feed.map(ub => {
        const profile = profileMap[ub.user_id]
        const book = ub.books || {}
        return (
          <div key={ub.id} style={{
            display: 'flex', gap: 14, paddingBottom: 16, marginBottom: 16,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ flexShrink: 0, cursor: 'pointer' }}
              onClick={() => setModal({ type: 'friendbook', book, userBook: ub })}>
              {book.cover_url
                ? <img src={book.cover_url} alt={book.title}
                    style={{ width: 48, height: 72, objectFit: 'cover', borderRadius: 5 }} />
                : <NoCover title={book.title} width={48} height={72} />
              }
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 4px', fontSize: 14, color: C.text, fontFamily: f.sans }}>
                <span style={{ fontWeight: 700 }}>{profile?.display_name || profile?.username || 'Someone'}</span>
                {' '}
                <span style={{ color: C.muted }}>
                  {ub.status === 'reading' ? 'is reading' : ub.status === 'read' ? 'finished' : 'added to queue'}
                </span>
              </p>
              <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 13, color: C.text, fontFamily: f.sans }}>
                {book.title}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={ub.status} />
                {ub.rating && <StarRating value={ub.rating} readonly size={13} />}
                <span style={{ fontSize: 11, color: C.muted, fontFamily: f.sans }}>
                  {timeAgo(ub.updated_at)}
                </span>
              </div>
            </div>
          </div>
        )
      })}

      {modal && (
        <BookDetailModal
          item={modal.type === 'friendbook' ? modal.book : modal.book}
          userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => { setModal(null); loadActivity() }}
        />
      )}
    </div>
  )
}

// ================================================================
// Profile page – avatar, stats, username, top 10
// ================================================================
function ProfilePage({ userId, profile, onProfileUpdate, onSignOut }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [username,    setUsername]    = useState(profile?.username || '')
  const [avatar,      setAvatar]      = useState(profile?.avatar_url || '')
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState(null)
  const [stats,       setStats]       = useState(null)
  const [topBooks,    setTopBooks]    = useState([])
  const [follows,     setFollows]     = useState([])
  const [modal,       setModal]       = useState(null)
  const [showImport,  setShowImport]  = useState(false)

  useEffect(() => {
    // Load stats
    supabase.from('user_books').select('status, rating, books(*)').eq('user_id', userId)
      .then(({ data }) => {
        if (!data) return
        setStats({
          total:       data.length,
          read:        data.filter(u => u.status === 'read').length,
          reading:     data.filter(u => u.status === 'reading').length,
          wantToRead:  data.filter(u => u.status === 'want_to_read').length,
        })
        const top = data.filter(u => (u.rating || 0) >= 4 && u.status === 'read')
          .sort((a, b) => (b.rating - a.rating))
          .slice(0, 10)
        setTopBooks(top)
      })
    // Load author follows
    supabase.from('author_follows').select('author').eq('user_id', userId)
      .then(({ data }) => setFollows(data || []))
  }, [userId])

  async function saveProfile() {
    if (!username.trim()) { setMsg({ type: 'error', text: 'Username is required.' }); return }
    setSaving(true)
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      display_name: displayName.trim(),
      username: username.toLowerCase().trim(),
      avatar_url: avatar || profile?.avatar_url || autoAvatar(''),
    }, { onConflict: 'id' })
    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: `Save failed: ${error.message}` })
    } else {
      setMsg({ type: 'success', text: 'Profile saved! ✓' })
      onProfileUpdate?.()
      setTimeout(() => setMsg(null), 2500)
    }
  }

  async function unfollowAuthor(author) {
    await supabase.from('author_follows').delete().eq('user_id', userId).eq('author', author)
    setFollows(prev => prev.filter(f => f.author !== author))
  }

  const sectionLabel = (text) => (
    <p style={{ margin: '0 0 10px', fontSize: 11, color: C.muted, fontFamily: f.sans,
      textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{text}</p>
  )
  const cardStyle = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 20 }

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Avatar + account */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            {sectionLabel('Account')}
            <p style={{ margin: 0, color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
              Signed in with your email
            </p>
          </div>
          <button onClick={onSignOut} style={{
            ...btn('danger', 'sm'), flexShrink: 0,
          }}>
            Sign Out
          </button>
        </div>

        {sectionLabel('Profile Avatar')}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
          background: C.surface2, borderRadius: 8, marginBottom: 12,
        }}>
          <span style={{ fontSize: 40 }}>{avatar || '📚'}</span>
          <span style={{ color: C.muted, fontFamily: f.sans, fontSize: 13 }}>
            Tap an icon below to change · tap again to clear
          </span>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 6, marginBottom: 20,
        }}>
          {LITERARY_EMOJIS.map(e => (
            <button key={e} onClick={() => setAvatar(avatar === e ? '' : e)}
              style={{
                fontSize: 22, padding: '6px 4px', border: 'none', cursor: 'pointer',
                borderRadius: 8, background: avatar === e ? C.primary : C.surface2,
                transition: 'background 0.15s', WebkitTapHighlightColor: 'transparent',
              }}>{e}</button>
          ))}
        </div>

        {sectionLabel('Display Name')}
        <input style={{ ...inputStyle, marginBottom: 12 }}
          value={displayName} onChange={e => setDisplayName(e.target.value)}
          placeholder="Your Name" />

        {sectionLabel('Username')}
        <input style={{ ...inputStyle, marginBottom: 20 }}
          value={username} onChange={e => setUsername(e.target.value.replace(/\s/g, '').toLowerCase())}
          placeholder="your_username" />

        {msg && (
          <p style={{ margin: '0 0 12px', fontSize: 13, fontFamily: f.sans,
            color: msg.type === 'success' ? C.success : C.danger }}>
            {msg.text}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={saveProfile} disabled={saving} style={btn('primary')}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
          <button onClick={() => setShowImport(true)} style={btn('ghost')}>
            📥 Import Library
          </button>
        </div>
      </div>

      {/* Reading stats */}
      {stats && (
        <div style={cardStyle}>
          {sectionLabel('Reading Stats')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              ['📚', 'Total', stats.total],
              ['✅', 'Read', stats.read],
              ['📖', 'Reading', stats.reading],
              ['🔖', 'Want', stats.wantToRead],
            ].map(([icon, lbl, n]) => (
              <div key={lbl} style={{
                background: C.surface2, borderRadius: 8, padding: '12px 8px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.text, fontFamily: f.sans }}>{n}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: f.sans }}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top 10 favorites */}
      {topBooks.length > 0 && (
        <div style={cardStyle}>
          {sectionLabel(`⭐ My Top ${topBooks.length} Books`)}
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
        <div style={cardStyle}>
          {sectionLabel('Authors You Follow')}
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

      {modal && (
        <BookDetailModal item={modal} userId={userId}
          onClose={() => setModal(null)}
          onUpdate={() => setModal(null)} />
      )}
      {showImport && (
        <ImportModal
          userId={userId}
          existingBookIds={new Set(topBooks.map(ub => ub.book_id))}
          onClose={() => setShowImport(false)}
          onDone={() => { onProfileUpdate?.(); setShowImport(false) }}
        />
      )}
    </div>
  )
}

// ================================================================
// CSV Import Modal – Goodreads · Amazon · Audible
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
  if (h.has('asin/isbn') || (h.has('order id') && h.has('title'))) return 'amazon'
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
  if (fmt === 'amazon') {
    const cat = (row['Category'] || '').toLowerCase()
    if (!cat.includes('book') && !cat.includes('kindle') && !cat.includes('digital')) return null
    return {
      title:  row['Title'] || '',
      author: '',
      isbn:   (row['ASIN/ISBN'] || '').replace(/[="]/g, '') || null,
      status: defaultStatus,
      rating: null,
      notes:  '',
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

// Fetch Google Books metadata (ISBN first, then title search)
async function fetchBookMeta(item) {
  const query = item.isbn ? `isbn:${item.isbn}` : `intitle:"${item.title}"${item.author ? `+inauthor:"${item.author}"` : ''}`
  try {
    const results = await searchGoogleBooks(query, 1)
    if (results.length > 0) return results[0]
  } catch (_) {}
  // Fallback: construct minimal book object with a synthetic ID
  return {
    id:             `import_${btoa(item.title + item.author).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`,
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
        if (!fmt) { setErr('Could not detect format. Supported: Goodreads, Amazon orders, Audible library.'); return }
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
    // Re-apply defaultStatus for formats where it's user-chosen
    const finalRows = format === 'goodreads'
      ? rows
      : rows.map(r => ({ ...r, status: defaultStatus }))
    setStep('importing')
    setProgress([0, finalRows.length])
    let imported = 0, skipped = 0, failed = 0

    await pLimit(finalRows, async (item) => {
      try {
        const book = await fetchBookMeta(item)
        if (!book?.id) { failed++; return }
        await upsertBook(book)
        const { error } = await supabase.from('user_books').upsert({
          user_id: userId, book_id: book.id,
          status:  item.status, rating: item.rating || null,
          notes:   item.notes  || null,
          position: 0,
        }, { onConflict: 'user_id,book_id' })
        if (error) { failed++; return }
        imported++
      } catch (_) { failed++ }
    }, 4, (done, total) => setProgress([done, finalRows.length]))

    setSummary({ imported, skipped, failed })
    setStep('done')
  }

  const FORMAT_LABELS = { goodreads: 'Goodreads', amazon: 'Amazon', audible: 'Audible' }
  const FORMAT_ICONS  = { goodreads: '📗', amazon: '📦', audible: '🎧' }
  const STATUS_MAP_LABEL = { read: '✅ Read', reading: '📖 Reading', want_to_read: '🔖 Want to Read' }

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
          Supports Goodreads export, Amazon order history, and Audible library CSVs.
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
                Goodreads · Amazon orders · Audible library
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv"
              onChange={handleFile} style={{ display: 'none' }} />
            {err && <p style={{ marginTop: 12, color: C.danger, fontFamily: f.sans, fontSize: 13 }}>{err}</p>}

            <div style={{ marginTop: 20, padding: 14, background: C.surface2, borderRadius: 8 }}>
              <p style={{ margin: '0 0 8px', color: C.text, fontFamily: f.sans, fontSize: 12, fontWeight: 700 }}>How to export:</p>
              <p style={{ margin: '0 0 4px', color: C.muted, fontFamily: f.sans, fontSize: 12 }}>
                <strong style={{ color: C.text }}>Goodreads:</strong> My Books → Import/Export → Export Library
              </p>
              <p style={{ margin: '0 0 4px', color: C.muted, fontFamily: f.sans, fontSize: 12 }}>
                <strong style={{ color: C.text }}>Amazon:</strong> Account → Order History → Request Report
              </p>
              <p style={{ margin: 0, color: C.muted, fontFamily: f.sans, fontSize: 12 }}>
                <strong style={{ color: C.text }}>Audible:</strong> Use the "Audible Library Exporter" browser extension
              </p>
            </div>
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

            <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 20 }}>
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
                        <StatusBadge status={r.status} />
                      </td>
                      <td style={{ padding: '7px 8px', color: C.star, whiteSpace: 'nowrap' }}>
                        {r.rating ? '★'.repeat(r.rating) : <span style={{ color: C.border }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && (
                <p style={{ textAlign: 'center', color: C.muted, fontFamily: f.sans,
                  fontSize: 12, margin: '10px 0 0' }}>
                  …and {rows.length - 100} more
                </p>
              )}
            </div>

            {format !== 'goodreads' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
                padding: '12px 14px', background: C.surface2, borderRadius: 8,
              }}>
                <span style={{ color: C.text, fontFamily: f.sans, fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                  Import all as:
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {Object.entries(STATUS_LABELS).map(([key, lbl]) => (
                    <button key={key} onClick={() => setDefaultStatus(key)}
                      style={{ ...pill(defaultStatus === key), fontSize: 12 }}>
                      {STATUS_ICONS[key]} {lbl}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, margin: '16px 0 24px' }}>
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
            <button onClick={() => { onDone?.(); onClose() }} style={btn('primary', 'lg')}>
              View My Library
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================
// Nav
// ================================================================
function Nav({ view, setView, profile, theme, toggleTheme }) {
  const isMobile = useIsMobile()
  const tabs = [
    ['home',    '🏠', 'Home'],
    ['mylist',  '📚', 'My List'],
    ['friends', '👥', 'Friends'],
    ['activity','📡', 'Activity'],
  ]
  const avatarEmoji = profile?.avatar_url || '👤'
  return (
    <nav style={{
      background: C.nav, borderBottom: `1px solid ${C.border}`,
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div style={{
        maxWidth: 960, margin: '0 auto', padding: isMobile ? '0 10px' : '0 20px',
        display: 'flex', alignItems: 'center', height: 52,
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: f.serif, fontWeight: 700, fontSize: isMobile ? 16 : 18,
          color: C.text, marginRight: isMobile ? 8 : 28, letterSpacing: '-0.01em', flexShrink: 0,
        }}>
          {isMobile ? '📚' : '📚 BookList'}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', flex: 1, gap: isMobile ? 0 : 2 }}>
          {tabs.map(([key, icon, lbl]) => (
            <button key={key} onClick={() => setView(key)} style={{
              padding: isMobile ? '8px 10px' : '8px 14px',
              border: 'none', cursor: 'pointer',
              background: 'none', fontFamily: f.sans, fontSize: 13, fontWeight: 600,
              color: view === key ? C.primary : C.muted,
              borderBottom: view === key ? `2px solid ${C.primary}` : '2px solid transparent',
              transition: 'color 0.15s', display: 'flex', alignItems: 'center', gap: 4,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{ fontSize: isMobile ? 18 : 14 }}>{icon}</span>
              {!isMobile && lbl}
            </button>
          ))}
        </div>

        {/* Theme toggle */}
        <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode'}
          style={{
            background: C.surface2, border: `1px solid ${C.border}`,
            borderRadius: 20, cursor: 'pointer', fontSize: 16,
            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginRight: isMobile ? 6 : 12, transition: 'background 0.2s',
            WebkitTapHighlightColor: 'transparent',
          }}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* Profile chip */}
        <button onClick={() => setView('profile')} style={{
          display: 'flex', alignItems: 'center', gap: 9,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 6px', borderRadius: 24, flexShrink: 0,
          outline: view === 'profile' ? `2px solid ${C.primary}` : 'none',
          transition: 'outline 0.15s', WebkitTapHighlightColor: 'transparent',
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: `linear-gradient(135deg, ${C.primaryDim}, ${C.surface2})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, flexShrink: 0,
            border: `2px solid ${view === 'profile' ? C.primary : C.border}`,
          }}>
            {avatarEmoji}
          </div>
          {profile && !isMobile && (
            <span style={{
              fontSize: 14, fontFamily: f.sans, fontWeight: 600,
              color: view === 'profile' ? C.text : C.muted,
              maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {profile.display_name || profile.username}
            </span>
          )}
        </button>
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
  const [theme,   setTheme]   = useState(() => localStorage.getItem('bl-theme') || 'dark')

  // Apply theme before render — all components read module-level C
  C = theme === 'light' ? LIGHT_THEME : DARK_THEME

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('bl-theme', next)
    setTheme(next)
  }

  // Capture invite param on load
  const inviteFromRef = useRef(new URLSearchParams(window.location.search).get('invite'))

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
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

  if (!session) return <AuthPage inviteFrom={inviteFromRef.current} />

  const userId = session.user.id

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <Nav view={view} setView={setView} profile={profile} theme={theme} toggleTheme={toggleTheme} />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? '20px 12px 60px' : '32px 20px 80px' }}>
        {view === 'home'     && <HomePage     userId={userId} setView={setView} />}
        {view === 'mylist'   && <MyListPage   userId={userId} />}
        {view === 'friends'  && <FriendsPage  userId={userId} />}
        {view === 'activity' && <ActivityPage userId={userId} />}
        {view === 'profile'  && <ProfilePage  userId={userId} profile={profile}
          onSignOut={() => supabase.auth.signOut()}
          onProfileUpdate={() => supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
            .then(({ data }) => { if (data) setProfile(data) })} />}
      </main>
    </div>
  )
}
