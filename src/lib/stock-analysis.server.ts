import { providerHistory, providerQuotes } from './market-data.server'
import { runFundamentalAnalysis } from './fundamental-service.server'
import { analyzeCandles } from './technical-analysis'
import type { FundamentalAnalysis } from './fundamental-types'
import type { Quote } from './market-types'
import type { TechnicalAnalysis } from './technical-types'
import type {
  StockAnalysisDecision,
  StockAnalysisResponse,
  StockAnalysisResult,
} from './stock-analysis.types'

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))

function technicalScore(technical: TechnicalAnalysis): number {
  const { indicators } = technical
  let score = 50
  const trend = indicators.trend

  if (trend.bias === 'bullish') score += 20
  if (trend.bias === 'bearish') score -= 20
  score += trend.strength * (trend.bias === 'neutral' ? 0 : 0.15)

  const ema20 = indicators.movingAverages.ema[20] ?? null
  const ema50 = indicators.movingAverages.ema[50] ?? null
  const ema200 = indicators.movingAverages.ema[200] ?? null
  if (ema20 !== null) score += technical.lastClose > ema20 ? 5 : -5
  if (ema50 !== null) score += technical.lastClose > ema50 ? 5 : -5
  if (ema200 !== null) score += technical.lastClose > ema200 ? 5 : -5

  if (indicators.macd.histogram !== null) score += indicators.macd.histogram > 0 ? 5 : -5
  if (indicators.adx.adx !== null && indicators.adx.adx >= 20) score += 5

  // Avoid rewarding an overextended RSI as if it were automatically bullish.
  if (indicators.rsi !== null) {
    if (indicators.rsi >= 45 && indicators.rsi <= 70) score += 5
    if (indicators.rsi > 80) score -= 8
    if (indicators.rsi < 25) score -= 5
  }

  return Math.round(clamp(score))
}

function fundamentalScore(fundamentals: FundamentalAnalysis): number {
  let score = 50
  const p = fundamentals.profitability
  const g = fundamentals.growth
  const l = fundamentals.leverage
  const c = fundamentals.cashFlow
  const v = fundamentals.valuation

  if (p.roe !== null) score += p.roe >= 15 ? 8 : p.roe >= 10 ? 3 : p.roe < 5 ? -7 : 0
  if (p.roce !== null) score += p.roce >= 15 ? 8 : p.roce >= 10 ? 3 : p.roce < 5 ? -7 : 0
  if (g.revenueGrowthYoY !== null) score += g.revenueGrowthYoY >= 15 ? 7 : g.revenueGrowthYoY >= 5 ? 3 : g.revenueGrowthYoY < 0 ? -6 : 0
  if (g.epsGrowthYoY !== null) score += g.epsGrowthYoY >= 15 ? 7 : g.epsGrowthYoY >= 5 ? 3 : g.epsGrowthYoY < 0 ? -6 : 0
  if (l.debtToEquity !== null) score += l.debtToEquity <= 0.5 ? 7 : l.debtToEquity <= 1 ? 2 : l.debtToEquity > 2 ? -8 : -2
  if (l.interestCoverage !== null) score += l.interestCoverage >= 5 ? 5 : l.interestCoverage < 2 ? -7 : 0
  if (c.fcfMargin !== null) score += c.fcfMargin >= 10 ? 6 : c.fcfMargin < 0 ? -6 : 0
  if (v.peRatioTTM !== null) score += v.peRatioTTM > 60 ? -5 : v.peRatioTTM > 40 ? -2 : 3

  return Math.round(clamp(score))
}

function decisionFor(score: number): StockAnalysisDecision {
  if (score >= 80) return 'STRONG_BULLISH'
  if (score >= 65) return 'BULLISH'
  if (score >= 45) return 'NEUTRAL'
  if (score >= 25) return 'BEARISH'
  return 'STRONG_BEARISH'
}

function buildNarrative(
  quote: Quote | null,
  technical: TechnicalAnalysis | null,
  fundamentals: FundamentalAnalysis | null,
): { strengths: string[]; risks: string[]; notes: string[] } {
  const strengths: string[] = []
  const risks: string[] = []
  const notes: string[] = []

  if (technical) {
    if (technical.indicators.trend.bias === 'bullish') strengths.push(`Technical trend is bullish with ${technical.indicators.trend.strength}/100 signal strength.`)
    if (technical.indicators.trend.bias === 'bearish') risks.push(`Technical trend is bearish with ${technical.indicators.trend.strength}/100 signal strength.`)
    if (technical.lastClose > (technical.indicators.movingAverages.ema[200] ?? Number.POSITIVE_INFINITY)) strengths.push('Price is above the 200 EMA.')
    if (technical.indicators.rsi !== null && technical.indicators.rsi > 80) risks.push('RSI is above 80; the setup may be overextended.')
    if (technical.indicators.rsi !== null && technical.indicators.rsi < 25) risks.push('RSI is below 25; momentum is weak and volatile.')
  }

  if (fundamentals) {
    if (fundamentals.profitability.roe !== null && fundamentals.profitability.roe >= 15) strengths.push(`ROE is ${fundamentals.profitability.roe.toFixed(1)}%.`)
    if (fundamentals.growth.revenueGrowthYoY !== null && fundamentals.growth.revenueGrowthYoY >= 10) strengths.push(`Revenue growth is ${fundamentals.growth.revenueGrowthYoY.toFixed(1)}% YoY.`)
    if (fundamentals.leverage.debtToEquity !== null && fundamentals.leverage.debtToEquity > 2) risks.push(`Debt-to-equity is elevated at ${fundamentals.leverage.debtToEquity.toFixed(2)}.`)
    if (fundamentals.cashFlow.freeCashFlow !== null && fundamentals.cashFlow.freeCashFlow < 0) risks.push('Free cash flow is negative in the latest available snapshot.')
  }

  if (!quote) notes.push('Live quote was unavailable; scores are based on available historical/fundamental data only.')
  if (!technical) notes.push('Technical score is unavailable because sufficient historical candles could not be loaded.')
  if (!fundamentals) notes.push('Fundamental score is unavailable because the fundamentals provider did not return a usable snapshot.')
  notes.push('This is a rules-based research signal, not a guaranteed-return prediction.')

  return { strengths, risks, notes }
}

export async function analyzeStock(symbolInput: string): Promise<StockAnalysisResponse> {
  const symbol = symbolInput.trim().toUpperCase()
  if (!symbol || symbol.length > 24) {
    return { ok: false, error: { code: 'INVALID_SYMBOL', symbol: symbolInput, message: 'A valid stock symbol is required.' } }
  }

  try {
    const [quoteResult, historyResult, fundamentalResult] = await Promise.allSettled([
      providerQuotes([symbol]),
      providerHistory(symbol, '1d', '1y'),
      runFundamentalAnalysis(symbol, 12, 5),
    ])

    const quote: Quote | null = quoteResult.status === 'fulfilled' ? quoteResult.value[0] ?? null : null
    const candles = historyResult.status === 'fulfilled' ? historyResult.value : []
    const technicalResult = candles.length > 0 ? analyzeCandles(symbol, candles, '1d', '1y') : null
    const technical: TechnicalAnalysis | null = technicalResult?.ok ? technicalResult.data : null
    const fundamentals: FundamentalAnalysis | null = fundamentalResult.status === 'fulfilled' && fundamentalResult.value.ok
      ? fundamentalResult.value.data
      : null

    const technicalValue = technical ? technicalScore(technical) : null
    const fundamentalValue = fundamentals ? fundamentalScore(fundamentals) : null
    const dataQuality = Math.round((quote ? 100 : 0) * 0.3 + (technical ? 100 : 0) * 0.4 + (fundamentals ? 100 : 0) * 0.3)

    const weightedBase = technicalValue !== null && fundamentalValue !== null
      ? technicalValue * 0.6 + fundamentalValue * 0.4
      : technicalValue ?? fundamentalValue ?? 50
    const overall = Math.round(clamp(weightedBase))
    const confidence = Math.round(clamp(40 + dataQuality * 0.6))
    const narrative = buildNarrative(quote, technical, fundamentals)

    const data: StockAnalysisResult = {
      symbol,
      generatedAt: Date.now(),
      horizon: 'short_term',
      decision: decisionFor(overall),
      confidence,
      scores: { overall, technical: technicalValue, fundamental: fundamentalValue, dataQuality },
      quote,
      technical,
      fundamentals,
      ...narrative,
    }

    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'ANALYSIS_FAILED',
        symbol,
        message: error instanceof Error ? error.message.slice(0, 220) : 'Stock analysis failed.',
      },
    }
  }
}
