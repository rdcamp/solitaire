import Dexie, { type EntityTable } from 'dexie'

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type Card = { suit: Suit; rank: number; faceUp: boolean }
export type GameStatus = 'active' | 'won'

export interface GameRecord {
  id: string
  userId: string
  createdAt: string
  updatedAt: string
  status: GameStatus
  moves: number
  score: number
  stock: Card[]
  waste: Card[]
  foundations: Record<Suit, Card[]>
  tableau: Card[][]
}

export interface MoveRecord {
  id: string
  gameId: string
  createdAt: string
  detail: string
  score: number
}

export const db = new Dexie('quiet-cards') as Dexie & {
  games: EntityTable<GameRecord, 'id'>
  history: EntityTable<MoveRecord, 'id'>
}

db.version(1).stores({
  games: 'id, status, updatedAt, createdAt',
  history: 'id, gameId, createdAt',
})

db.version(2).stores({
  games: 'id, userId, [userId+updatedAt], status, updatedAt, createdAt',
  history: 'id, gameId, createdAt',
})
