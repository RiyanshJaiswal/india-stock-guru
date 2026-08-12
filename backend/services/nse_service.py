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


def first_text(*values):
    """Return the first non-empty textual value."""
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


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
    # receives only the stable DTO below. NSE has changed nesting/casing of
    # some fields across payload versions, so read all known locations.
    metadata = quote.get("metaData", {}) or quote.get("metadata", {}) or {}
    info = quote.get("info", {}) or {}
    trade_info = quote.get("tradeInfo", {}) or {}
    order_book = quote.get("orderBook", {}) or {}
    price_info = quote.get("priceInfo", {}) or {}
    intra_day = price_info.get("intraDayHighLow", {}) or {}
    week_high_low = price_info.get("weekHighLow", {}) or {}
    security_wise_dp = quote.get("securityWiseDP", {}) or {}

    company_name = first_text(
        metadata.get("companyName"),
        info.get("companyName"),
        quote.get("companyName"),
        symbol,
    )

    # IMPORTANT: for the current payload lastPrice is normally under
    # tradeInfo/orderBook. Older jugaad-data documentation also exposes it
    # under priceInfo, so keep that only as a fallback for compatibility.
    last_price = first_number(
        trade_info.get("lastPrice"),
        order_book.get("lastPrice"),
        price_info.get("lastPrice"),
        quote.get("lastPrice"),
    )
    if last_price is None or last_price <= 0:
        raise ValueError("NSE response is missing a valid lastPrice")

    # Current NSELive payloads have been observed with daily fields in both
    # metaData and priceInfo. Also accept top-level values so a provider
    # response variation cannot silently turn valid live data into UI dashes.
    previous_close = first_number(
        metadata.get("previousClose"),
        price_info.get("previousClose"),
        price_info.get("basePrice"),
        quote.get("previousClose"),
    )
    change = first_number(
        metadata.get("change"),
        price_info.get("change"),
        quote.get("change"),
    )
    p_change = first_number(
        metadata.get("pChange"),
        price_info.get("pChange"),
        quote.get("pChange"),
    )
    open_price = first_number(
        metadata.get("open"),
        price_info.get("open"),
        quote.get("open"),
    )
    day_high = first_number(
        metadata.get("dayHigh"),
        price_info.get("dayHigh"),
        intra_day.get("max"),
        quote.get("dayHigh"),
    )
    day_low = first_number(
        metadata.get("dayLow"),
        price_info.get("dayLow"),
        intra_day.get("min"),
        quote.get("dayLow"),
    )

    # If NSE gives price + previous close but omits explicit change fields,
    # derive them from the same live quote. This prevents the frontend from
    # ever substituting a chart-period return for the daily NSE change.
    if change is None and previous_close is not None:
        change = last_price - previous_close
    if p_change is None and previous_close not in (None, 0) and change is not None:
        p_change = (change / previous_close) * 100

    timestamp = first_text(
        quote.get("lastUpdateTime"),
        quote.get("lastUpdateTIme"),
        metadata.get("lastUpdateTime"),
        metadata.get("lastUpdateTIme"),
        price_info.get("lastUpdateTime"),
    )

    year_high = first_number(
        price_info.get("yearHigh"),
        quote.get("yearHigh"),
        week_high_low.get("max"),
    )
    year_low = first_number(
        price_info.get("yearLow"),
        quote.get("yearLow"),
        week_high_low.get("min"),
    )

    volume = first_number(
        trade_info.get("quantitytraded"),
        trade_info.get("totalTradedVolume"),
        security_wise_dp.get("quantityTraded"),
        quote.get("volume"),
    )
    market_cap = first_number(
        trade_info.get("totalMarketCap"),
        quote.get("totalMarketCap"),
    )

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
        "volume": volume,
        "marketCap": market_cap,
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
