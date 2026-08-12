import json
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from jugaad_data.nse import NSELive

IST = ZoneInfo("Asia/Kolkata")


def as_number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


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
    # Keep provider-specific NSE response parsing inside this service. The UI
    # receives only the stable DTO below.
    metadata = quote.get("metaData", {}) or quote.get("metadata", {}) or {}
    trade_info = quote.get("tradeInfo", {}) or {}
    order_book = quote.get("orderBook", {}) or {}
    price_info = quote.get("priceInfo", {}) or {}

    company_name = str(metadata.get("companyName") or symbol)

    # IMPORTANT: current NSELive response exposes lastPrice under tradeInfo,
    # with orderBook as the fallback. Do not use priceInfo.lastPrice here.
    last_price = as_number(trade_info.get("lastPrice"))
    if last_price is None:
        last_price = as_number(order_book.get("lastPrice"))
    if last_price is None or last_price <= 0:
        raise ValueError("NSE response is missing a valid lastPrice")

    timestamp = str(quote.get("lastUpdateTime", "") or quote.get("lastUpdateTIme", ""))

    year_high = as_number(price_info.get("yearHigh"))
    year_low = as_number(price_info.get("yearLow"))
    if year_high is None or year_low is None:
        week = price_info.get("weekHighLow") or {}
        if year_high is None:
            year_high = as_number(week.get("max"))
        if year_low is None:
            year_low = as_number(week.get("min"))

    return {
        "symbol": symbol,
        "companyName": company_name,
        "lastPrice": last_price,
        "change": as_number(metadata.get("change")),
        "pChange": as_number(metadata.get("pChange")),
        "timestamp": timestamp,
        "previousClose": as_number(metadata.get("previousClose")),
        "open": as_number(metadata.get("open")),
        "dayHigh": as_number(metadata.get("dayHigh")),
        "dayLow": as_number(metadata.get("dayLow")),
        "fiftyTwoWeekHigh": year_high,
        "fiftyTwoWeekLow": year_low,
        "volume": as_number(trade_info.get("quantitytraded") or trade_info.get("totalTradedVolume")),
        "marketCap": as_number(trade_info.get("totalMarketCap")),
        "marketState": market_state(timestamp),
    }


def fetch_with_retry(nse: NSELive, symbol: str, attempts: int = 2) -> dict:
    last_error = None
    for attempt in range(attempts):
        try:
            quote = nse.stock_quote(symbol)
            if not isinstance(quote, dict) or not quote:
                raise ValueError("Empty NSE response")
            return quote
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.5)
    raise last_error or RuntimeError("NSE request failed")


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
                quote = fetch_with_retry(nse, symbol)
                quotes.append(normalize(symbol, quote))
            except Exception as exc:
                errors.append({"symbol": symbol, "error": str(exc) or "NSE request failed"})

        # A process that exits successfully with zero quotes makes the TS
        # provider silently render an empty dashboard. Return failure instead
        # so the server can activate its explicit recovery path.
        if not quotes:
            message = errors[0].get("error") if errors else "NSE returned no quotes"
            print(json.dumps({"quotes": [], "errors": errors or [{"error": message}]}, separators=(",", ":")))
            return 1

        print(json.dumps({"quotes": quotes, "errors": errors}, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(json.dumps({"quotes": [], "errors": [{"error": str(exc) or "NSE service failed"}]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
