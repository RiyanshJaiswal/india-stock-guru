import type { FundamentalAnalysis } from './fundamental-types'
import type { Quote } from './market-types'
import type { TechnicalAnalysis } from './technical-types'

export type StockAnalysisDecision =
  | 'STRONG_BULLISH'
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'STRONG_BEARISH'

export type StockAnalysisScores = {
  overall: number
  technical: number | null
  fundamental: number | null
  dataQuality: number
}

export type StockAnalysisResult = {
  symbol: string
  generatedAt: number
  horizon: 'short_term'
  decision: StockAnalysisDecision
  confidence: number
  scores: StockAnalysisScores
  quote: Quote | null
  technical: TechnicalAnalysis | null
  fundamentals: FundamentalAnalysis | null
  strengths: string[]
  risks: string[]
  notes: string[]
}

export type StockAnalysisResponse =
  | { ok: true; data: StockAnalysisResult }
  | { ok: false; error: { code: 'INVALID_SYMBOL' | 'ANALYSIS_FAILED'; symbol: string; message: string } }
