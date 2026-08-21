import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { StockAnalysisResponse } from './stock-analysis.types'

const input = z.object({
  symbol: z.string().trim().min(1).max(24),
})

export const analyzeStockFn = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }): Promise<StockAnalysisResponse> => {
    const { analyzeStock } = await import('./stock-analysis.server')
    return analyzeStock(data.symbol)
  })
