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


def first_number(*values):
    """Return the first value that can be normalized to a finite number."""
    for value in values:
        number = as_number(value)
        if number is not None:
            return number
    return None


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
    intra_day = price_info.get("intraDayHighLow", {}) or {}

    company_name = str(metadata.get("companyName") or symbol)

    # IMPORTANT: current NSELive response exposes lastPrice under tradeInfo,
    # with orderBook as the fallback. Do not use priceInfo.lastPrice here.
    last_price = first_number(trade_info.get("lastPrice"), order_book.get("lastPrice"))
    if last_price is None or last_price <= 0:
        raise ValueError("NSE response is missing a valid lastPrice")

    # NSELive versions/responses have exposed some daily fields under
    # metaData and others under priceInfo. Prefer the current metaData fields,
    # but fall back to priceInfo so a harmless NSE payload variation does not
    # turn valid live values into UI dashes.
    change = first_number(metadata.get("change"), price_info.get("change"))
    p_change = first_number(metadata.get("pChange"), price_info.get("pChange"))
    previous_close = first_number(metadata.get("previousClose"), price_info.get("previousClose"))
    open_price = first_number(metadata.get("open"), price_info.get("open"))
    day_high = first_number(metadata.get("dayHigh"), price_info.get("dayHigh"), intra_day.get("max"))
    day_low = first_number(metadata.get("dayLow"), price_info.get("dayLow"), intra_day.get("min"))

    # If NSE gives price + previous close but omits the explicit change fields,
    # derive them from the same live quote rather than showing a misleading
    # chart-period return.
    if change is None and previous_close is not None:
        change = last_price - previous_close
    if p_change is None and previous_close not in (None, 0) and change is not None:
        p_change = (change / previous_close) * 100

    timestamp = str(
        quote.get("lastUpdateTime", "")
        or quote.get("lastUpdateTIme", "")
        or metadata.get("lastUpdateTime", "")
        or metadata.get("lastUpdateTIme", "")
    )

    year_high = first_number(price_info.get("yearHigh"))
    year_low = first_number(price_info.get("yearLow"))
    if year_high is None or year_low is None:
        week = price_info.get("weekHighLow") or {}
        if year_high is None:
            year_high = first_number(week.get("max"))
        if year_low is None:
            year_low = first_number(week.get("min"))

    return {
        "symbol": symbol,
        "companyName": company_name,
        "lastPrice": last_price,
        "change": change,
        "pChange": p_change,
        "timestamp": timestamp,
        "previousClose": previous_close,
        "open": open_price,
        "dayHigh": day_high,
        "dayLow": day_low,
        "fiftyTwoWeekHigh": year_high,
        "fiftyTwoWeekLow": year_low,
        "volume": first_number(trade_info.get("quantitytraded"), trade_info.get("totalTradedVolume")),
        "marketCap": first_number(trade_info.get("totalMarketCap")),
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
