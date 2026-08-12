import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from jugaad_data.nse import NSELive

IST = ZoneInfo("Asia/Kolkata")


def market_state(timestamp: str) -> str:
    try:
        parsed = datetime.strptime(timestamp, "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
        now = datetime.now(IST)
        if parsed.date() == now.date() and now.weekday() < 5 and 9 <= now.hour < 16:
            return "REGULAR"
    except Exception:
        pass
    return "CLOSED"


def normalize(symbol: str, quote: dict) -> dict:
    # Current NSE payload is normalized here so the frontend never knows
    # whether the provider uses metaData/tradeInfo/orderBook internally.
    metadata = quote.get("metaData", {}) or quote.get("metadata", {}) or {}
    trade_info = quote.get("tradeInfo", {}) or {}
    order_book = quote.get("orderBook", {}) or {}
    price_info = quote.get("priceInfo", {}) or {}

    company_name = metadata.get("companyName") or symbol
    last_price = trade_info.get("lastPrice")
    if last_price is None:
        last_price = order_book.get("lastPrice")
    if last_price is None:
        raise ValueError("NSE response is missing lastPrice")

    timestamp = quote.get("lastUpdateTime", "") or quote.get("lastUpdateTIme", "")

    year_high = price_info.get("yearHigh")
    year_low = price_info.get("yearLow")
    if year_high is None or year_low is None:
        week = price_info.get("weekHighLow") or {}
        year_high = year_high if year_high is not None else week.get("max")
        year_low = year_low if year_low is not None else week.get("min")

    return {
        "symbol": symbol,
        "companyName": company_name,
        "lastPrice": float(last_price),
        "change": metadata.get("change"),
        "pChange": metadata.get("pChange"),
        "timestamp": timestamp,
        "previousClose": metadata.get("previousClose"),
        "open": metadata.get("open"),
        "dayHigh": metadata.get("dayHigh"),
        "dayLow": metadata.get("dayLow"),
        "fiftyTwoWeekHigh": year_high,
        "fiftyTwoWeekLow": year_low,
        "volume": trade_info.get("quantitytraded") or trade_info.get("totalTradedVolume"),
        "marketCap": trade_info.get("totalMarketCap"),
        "marketState": market_state(timestamp),
    }


def main() -> int:
    try:
        symbols = json.load(sys.stdin)
        if not isinstance(symbols, list):
            raise ValueError("Input must be a JSON array of NSE symbols")

        nse = NSELive()
        quotes = []
        errors = []

        for raw_symbol in symbols:
            symbol = str(raw_symbol).strip().upper()
            if not symbol:
                continue
            try:
                # IMPORTANT: NSELive receives plain NSE symbols, never .NS/.BO.
                quote = nse.stock_quote(symbol)
                if not isinstance(quote, dict) or not quote:
                    raise ValueError("Empty NSE response")
                quotes.append(normalize(symbol, quote))
            except Exception as exc:
                errors.append({"symbol": symbol, "error": str(exc) or "NSE request failed"})

        print(json.dumps({"quotes": quotes, "errors": errors}, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(json.dumps({"quotes": [], "errors": [{"error": str(exc) or "NSE service failed"}]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
