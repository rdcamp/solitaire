import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { db, type GameRecord, type MoveRecord } from './db'
import { isSupabaseConfigured, supabase } from './supabase'
import './App.css'

type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
type Card = { suit: Suit; rank: number; faceUp: boolean }
type Location =
  | { kind: 'waste' }
  | { kind: 'foundation'; pile: Suit }
  | { kind: 'tableau'; pile: number; index: number }
type Selection = { from: Location; cards: Card[] }

const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const suitSymbol: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
const rankLabel = (rank: number) => (rank === 1 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : String(rank))
const cardLabel = (card: Card) => `${rankLabel(card.rank)}${suitSymbol[card.suit]}`
const cardColor = (card: Card) => (card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black')
const clone = <T,>(value: T): T => structuredClone(value)

function shuffledDeck(): Card[] {
  const deck = suits.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1, faceUp: false })))
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

function newGame(userId: string): GameRecord {
  const deck = shuffledDeck()
  const tableau = Array.from({ length: 7 }, (_, pile) =>
    Array.from({ length: pile + 1 }, (_, index) => ({ ...deck.pop()!, faceUp: index === pile })),
  )
  return {
    id: crypto.randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    moves: 0,
    score: 0,
    stock: deck,
    waste: [],
    foundations: { hearts: [], diamonds: [], clubs: [], spades: [] },
    tableau,
  }
}

function canBuildOnTableau(cards: Card[], target?: Card): boolean {
  const moving = cards[0]
  if (!target) return moving.rank === 13
  return target.faceUp && target.rank === moving.rank + 1 && cardColor(target) !== cardColor(moving)
}

function canBuildFoundation(card: Card, pile: Card[]): boolean {
  return card.rank === pile.length + 1 && card.suit === (pile.length === 0 ? card.suit : pile[0].suit)
}

function describeMove(from: Location, to: Location, cards: Card[]) {
  const source = from.kind === 'tableau' ? `tableau ${from.pile + 1}` : from.kind
  const target = to.kind === 'tableau' ? `tableau ${to.pile + 1}` : to.kind === 'foundation' ? `${to.pile} foundation` : to.kind
  return `${cards.map(cardLabel).join(', ')}: ${source} → ${target}`
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [game, setGame] = useState<GameRecord | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [history, setHistory] = useState<MoveRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getUser().then(({ data: { user: activeUser } }) => {
      setUser(activeUser)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    void (async () => {
      const savedGames = await db.games.where('userId').equals(user.id).sortBy('updatedAt')
      const current = savedGames.at(-1)
      const loaded = current ?? newGame(user.id)
      if (!current) await db.games.put(loaded)
      setGame(loaded)
      setHistory(await db.history.where('gameId').equals(loaded.id).reverse().limit(12).toArray())
    })()
  }, [user])

  const progress = useMemo(
    () => (game ? suits.reduce((total, suit) => total + game.foundations[suit].length, 0) : 0),
    [game],
  )

  async function persist(next: GameRecord, detail?: string) {
    next.updatedAt = new Date().toISOString()
    next.moves = game?.moves ?? next.moves
    if (detail) {
      next.moves += 1
      await db.history.add({ id: crypto.randomUUID(), gameId: next.id, createdAt: next.updatedAt, detail, score: next.score })
      setHistory(await db.history.where('gameId').equals(next.id).reverse().limit(12).toArray())
    }
    await db.games.put(next)
    setGame(next)
  }

  function select(location: Location, cards: Card[]) {
    setSelection({ from: location, cards })
  }

  function selectWaste() {
    if (!game?.waste.length) return
    select({ kind: 'waste' }, [game.waste.at(-1)!])
  }

  function selectFoundation(suit: Suit) {
    const card = game?.foundations[suit].at(-1)
    if (card) select({ kind: 'foundation', pile: suit }, [card])
  }

  async function clickStock() {
    if (!game) return
    const next = clone(game)
    if (next.stock.length) {
      next.waste.push({ ...next.stock.pop()!, faceUp: true })
      await persist(next, 'Drew a card from stock')
    } else if (next.waste.length) {
      next.stock = next.waste.reverse().map((card) => ({ ...card, faceUp: false }))
      next.waste = []
      await persist(next, 'Recycled the stock')
    }
    setSelection(null)
  }

  async function clickTableau(pile: number, index: number) {
    if (!game) return
    const card = game.tableau[pile][index]
    const isTop = index === game.tableau[pile].length - 1
    if (!card.faceUp && isTop && !selection) {
      const next = clone(game)
      next.tableau[pile][index].faceUp = true
      next.score += 5
      await persist(next, `Turned over ${cardLabel(card)}`)
      return
    }
    if (!card.faceUp) return

    if (selection) {
      await moveTo({ kind: 'tableau', pile, index })
      return
    }
    select({ kind: 'tableau', pile, index }, game.tableau[pile].slice(index))
  }

  async function clickFoundation(suit: Suit) {
    if (!game) return
    if (!selection) {
      selectFoundation(suit)
      return
    }
    await moveTo({ kind: 'foundation', pile: suit })
  }

  async function clickEmptyTableau(pile: number) {
    if (!selection) return
    await moveTo({ kind: 'tableau', pile, index: -1 })
  }

  async function moveTo(to: Location) {
    if (!game || !selection) return
    const { from, cards } = selection
    if (from.kind === to.kind && from.kind !== 'tableau') {
      setSelection(null)
      return
    }
    const next = clone(game)
    let valid = false
    if (to.kind === 'foundation' && cards.length === 1 && canBuildFoundation(cards[0], next.foundations[to.pile])) {
      next.foundations[to.pile].push(cards[0])
      next.score += 10
      valid = true
    }
    if (to.kind === 'tableau') {
      const target = next.tableau[to.pile].at(-1)
      valid = canBuildOnTableau(cards, target)
      if (valid) next.tableau[to.pile].push(...cards)
    }
    if (!valid || (from.kind === 'tableau' && to.kind === 'tableau' && from.pile === to.pile)) {
      setSelection(null)
      return
    }

    if (from.kind === 'waste') next.waste.pop()
    if (from.kind === 'foundation') next.foundations[from.pile].pop()
    if (from.kind === 'tableau') next.tableau[from.pile].splice(from.index)
    if (next.foundations.hearts.length + next.foundations.diamonds.length + next.foundations.clubs.length + next.foundations.spades.length === 52) {
      next.status = 'won'
    }
    await persist(next, describeMove(from, to, cards))
    setSelection(null)
  }

  async function startNewGame() {
    if (!user) return
    const next = newGame(user.id)
    await db.games.put(next)
    setGame(next)
    setHistory([])
    setSelection(null)
  }

  if (!isSupabaseConfigured) return <SetupScreen />
  if (!authReady) return <main className="loading">Loading account…</main>
  if (!user) return <AuthScreen />
  if (!game) return <main className="loading">Loading saved game…</main>

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">KLONDIKE SOLITAIRE</p>
          <h1>Quiet Cards</h1>
        </div>
        <div className="header-actions">
          <div className="score"><span>Score</span><strong>{game.score}</strong></div>
          <div className="score"><span>Moves</span><strong>{game.moves}</strong></div>
          <button className="button secondary" type="button" onClick={() => setShowHistory((open) => !open)}>History</button>
          <button className="button secondary" type="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
          <button className="button" type="button" onClick={() => void startNewGame()}>New game</button>
        </div>
      </header>

      {game.status === 'won' && <div className="win-banner">You won this game in {game.moves} moves.</div>}
      <section className="game-board" aria-label="Solitaire board">
        <div className="top-row">
          <div className="stock-area">
            <button className={`card ${game.stock.length ? 'card-back' : 'empty-card'}`} type="button" onClick={() => void clickStock()} aria-label="Stock pile">
              {!game.stock.length && '↻'}
            </button>
            <button className={`card ${selection?.from.kind === 'waste' ? 'selected' : ''} ${game.waste.length ? '' : 'empty-card'}`} type="button" onClick={selectWaste} aria-label="Waste pile">
              {game.waste.length ? <CardFace card={game.waste.at(-1)!} /> : ' '}
            </button>
          </div>
          <div className="foundations">
            {suits.map((suit) => {
              const card = game.foundations[suit].at(-1)
              return <button key={suit} className={`card foundation ${selection?.from.kind === 'foundation' && selection.from.pile === suit ? 'selected' : ''}`} type="button" onClick={() => void clickFoundation(suit)} aria-label={`${suit} foundation`}>
                {card ? <CardFace card={card} /> : <span className={`suit-placeholder ${suit}`}>{suitSymbol[suit]}</span>}
              </button>
            })}
          </div>
        </div>

        <div className="tableau" aria-label="Tableau">
          {game.tableau.map((pile, pileIndex) => (
            <div className="tableau-pile" key={pileIndex}>
              {pile.length === 0 && <button className="empty-tableau" type="button" onClick={() => void clickEmptyTableau(pileIndex)} aria-label={`Empty tableau ${pileIndex + 1}`}>K</button>}
              {pile.map((card, cardIndex) => (
                <button
                  className={`card tableau-card ${!card.faceUp ? 'card-back' : ''} ${selection?.from.kind === 'tableau' && selection.from.pile === pileIndex && selection.from.index === cardIndex ? 'selected' : ''}`}
                  key={`${card.suit}-${card.rank}`}
                  type="button"
                  style={{ top: cardIndex * 31 }}
                  onClick={() => void clickTableau(pileIndex, cardIndex)}
                  aria-label={card.faceUp ? cardLabel(card) : 'Face down card'}
                >
                  {card.faceUp && <CardFace card={card} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <footer>
        <span>{progress} / 52 cards home</span>
        <span>Click a card, then its destination. Draw one card at a time.</span>
      </footer>

      {showHistory && <aside className="history-panel">
        <div className="history-heading"><h2>Game history</h2><button type="button" onClick={() => setShowHistory(false)}>×</button></div>
        {history.length ? <ol>{history.map((item) => <li key={item.id}><span>{item.detail}</span><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></li>)}</ol> : <p>No moves yet. Your completed move history is saved here.</p>}
      </aside>}
    </main>
  )
}

function SetupScreen() {
  return <main className="auth-page">
    <section className="auth-card">
      <p className="eyebrow">ACCOUNT SETUP</p>
      <h1>Connect Supabase</h1>
      <p>Add your Supabase URL and publishable key to a local <code>.env</code> file, using <code>.env.example</code> as the template. Restart the dev server, then create an account here.</p>
    </section>
  </main>
}

function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setMessage('')
    const response = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setSubmitting(false)
    if (response.error) {
      setMessage(response.error.message)
    } else if (mode === 'sign-up' && !response.data.session) {
      setMessage('Check your email to confirm your account, then sign in.')
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <p className="eyebrow">QUIET CARDS</p>
      <h1>{mode === 'sign-in' ? 'Welcome back' : 'Create account'}</h1>
      <p>Sign in to keep this browser’s saved games separate for your account.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input required minLength={6} type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="button" disabled={submitting} type="submit">{submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="text-button" type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage('') }}>
        {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </button>
    </section>
  </main>
}

function CardFace({ card }: { card: Card }) {
  return <span className={`card-face ${cardColor(card)}`}><span>{rankLabel(card.rank)}</span><span>{suitSymbol[card.suit]}</span></span>
}

export default App
