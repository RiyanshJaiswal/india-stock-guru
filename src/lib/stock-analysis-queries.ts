import { queryOptions } from '@tanstack/react-query'
import { analyzeStockFn } from './stock-analysis.functions'

export const stockAnalysisQuery = (symbol: string) =>
  queryOptions({
    queryKey: ['stock-analysis', symbol.trim().toUpperCase()],
    queryFn: () => analyzeStockFn({ data: { symbol } }),
    enabled: symbol.trim().length > 0,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
  })
