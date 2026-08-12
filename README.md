# IndiStock AI Dashboard

Build a modern AI-powered Indian Stock Market Dashboard for personal use.

## Market-data architecture

The existing TanStack Start application remains the frontend + server layer. Current/live NSE equity quotes now use `jugaad-data` / `NSELive` through a small Python service bridge:

```text
React UI
  ↓
TanStack Start server function (`getQuotes`)
  ↓
`src/lib/market-data.server.ts`
  ↓
`src/lib/providers/nse-live.server.ts`
  ↓
`backend/services/nse_service.py`
  ↓
jugaad-data / NSELive
  ↓
NSE
```

Historical OHLC/chart data is intentionally still handled by the existing Yahoo chart provider (with the existing Twelve Data fallback), because `NSELive.stock_quote()` is a current-quote API and should not be blindly substituted for historical candles.

BSE/index quote paths also remain on their existing provider path. This keeps the migration scoped to current NSE equity quotes and avoids breaking unrelated features.

## Development

Install Node dependencies as before:

```sh
npm i
```

Install Python 3.9+ and the NSE live-data dependency:

```sh
python -m pip install -r requirements.txt
```

On systems where `python` points to Python 2, use:

```sh
python3 -m pip install -r requirements.txt
```

If the Python executable is not named `python` on your machine, set:

```text
NSE_PYTHON_BIN=/path/to/python
```

Then start the existing TanStack Start/Vite development server:

```sh
npm run dev
```

There is no separate FastAPI server in this repository; the existing TanStack Start server functions are the backend API layer.

## Current NSE quote fields

`backend/services/nse_service.py` normalizes the NSE response into a stable DTO. `lastPrice` is read from `tradeInfo.lastPrice` first and `orderBook.lastPrice` second; it does **not** use `priceInfo.lastPrice`.

The frontend continues consuming the existing `Quote` contract, with `timestamp` added as a non-breaking field.

## Build and lint

```sh
npm run lint
npm run build
```

## Original project notes

- Dark theme
- Mobile responsive
- Dashboard
- Search stock
- Watchlist
- Portfolio section
- AI Assistant panel
- Latest market news section
- TradingView chart placeholder
- Clean React + TypeScript architecture
- Tailwind CSS
- Ready for FastAPI backend and Supabase

This project was built with [Lovable](https://lovable.dev).
