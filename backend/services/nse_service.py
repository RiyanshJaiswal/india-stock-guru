import json
import math
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from jugaad_data.nse import NSELive

IST = ZoneInfo("Asia/Kolkata")

# Some display symbols (as used by the rest of the app) map to a different
# name in NSE's own all_indices() response.
INDEX_NAME_MAP = {
    "^NSEI": "NIFTY 50",
    "^NSEBANK": "NIFTY BANK",
    "^INDIAVIX": "INDIA VIX",
}


def as_number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, str):
        # NSE/provider payloads can occasionally serialize numeric values as
        # strings such as "5.10", "0.39%", or "10,400,260,115.84".
        cleaned = value.strip().replace(",", "").replace("%", "")
        if not cleaned or cleaned in {"-", "—", "NA", "N/A", "null", "None"}:
            return None
        try:
            number = float(cleaned)
            return number if math.isfinite(number) else None
        except (TypeError, ValueError):
            return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


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


def dict_value(data: object, *keys: str):
    """Case-insensitive lookup in one provider object."""
    if not isinstance(data, dict):
        return None
    lowered = {str(key).lower(): value for key, value in data.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value is not None:
            return value
    return None


def deep_values(data: object, wanted: set[str], max_depth: int = 5):
    """Yield values for wanted keys anywhere in a small NSE JSON payload."""
    if max_depth < 0:
        return
    if isinstance(data, dict):
        for key, value in data.items():
            if str(key).lower() in {item.lower() for item in wanted}:
                yield value
            if isinstance(value, (dict, list)):
                yield from deep_values(value, wanted, max_depth - 1)
    elif isinstance(data, list):
        for value in data:
            if isinstance(value, (dict, list)):
                yield from deep_values(value, wanted, max_depth - 1)


def deep_number(data: object, *keys: str):
    return first_number(*deep_values(data, set(keys)))


def deep_text(data: object, *keys: str):
    return first_text(*deep_values(data, set(keys)))


def market_state(timestamp: str) -> str:
    try:
        parsed = datetime.strptime(timestamp, "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
        now = datetime.now(IST)
        if parsed.date() == now.date() and now.weekday() < 5 and 9 <= now.hour < 16:
            return "REGULAR"
    except Exception:
        pass
    return "CLOSED"


def market_state_now() -> str:
    now = datetime.now(IST)
    if now.weekday() < 5 and 9 <= now.hour < 16:
        return "REGULAR"
    return "CLOSED"


def normalize(symbol: str, quote: dict) -> dict:
    # Keep provider-specific NSE response parsing inside this service. The UI
    # receives only the stable DTO below. Use both documented locations and
    # case-insensitive deep fallbacks because NSE payload nesting has varied
    # between jugaad-data/NSE response versions.
    metadata = quote.get("metaData", {}) or quote.get("metadata", {}) or {}
    info = quote.get("info", {}) or {}
    trade_info = quote.get("tradeInfo", {}) or {}
    order_book = quote.get("orderBook", {}) or {}
    price_info = quote.get("priceInfo", {}) or {}
    intra_day = price_info.get("intraDayHighLow", {}) or {}
    week_high_low = price_info.get("weekHighLow", {}) or {}
    security_wise_dp = quote.get("securityWiseDP", {}) or {}

    company_name = first_text(
        dict_value(metadata, "companyName"),
        dict_value(info, "companyName"),
        quote.get("companyName"),
        deep_text(quote, "companyName"),
        symbol,
    )

    last_price = first_number(
        dict_value(trade_info, "lastPrice"),
        dict_value(order_book, "lastPrice"),
        dict_value(price_info, "lastPrice"),
        quote.get("lastPrice"),
        deep_number(quote, "lastPrice"),
    )
    if last_price is None or last_price <= 0:
        raise ValueError("NSE response is missing a valid lastPrice")

    previous_close = first_number(
        dict_value(metadata, "previousClose"),
        dict_value(price_info, "previousClose"),
        dict_value(price_info, "basePrice"),
        quote.get("previousClose"),
        deep_number(quote, "previousClose", "basePrice"),
    )
    change = first_number(
        dict_value(metadata, "change"),
        dict_value(price_info, "change"),
        quote.get("change"),
        deep_number(quote, "change"),
    )
    p_change = first_number(
        dict_value(metadata, "pChange"),
        dict_value(price_info, "pChange"),
        quote.get("pChange"),
        deep_number(quote, "pChange", "changePercent", "percentChange"),
    )
    open_price = first_number(
        dict_value(metadata, "open"),
        dict_value(price_info, "open"),
        quote.get("open"),
        deep_number(quote, "open"),
    )
    day_high = first_number(
        dict_value(metadata, "dayHigh"),
        dict_value(price_info, "dayHigh"),
        dict_value(intra_day, "max"),
        quote.get("dayHigh"),
        deep_number(quote, "dayHigh", "high"),
    )
    day_low = first_number(
        dict_value(metadata, "dayLow"),
        dict_value(price_info, "dayLow"),
        dict_value(intra_day, "min"),
        quote.get("dayLow"),
        deep_number(quote, "dayLow", "low"),
    )

    # If NSE gives price + previous close but omits explicit change fields,
    # derive them from the same live quote. Never use chart-period returns.
    if change is None and previous_close is not None:
        change = last_price - previous_close
    if p_change is None and previous_close not in (None, 0) and change is not None:
        p_change = (change / previous_close) * 100

    timestamp = first_text(
        quote.get("lastUpdateTime"),
        quote.get("lastUpdateTIme"),
        dict_value(metadata, "lastUpdateTime"),
        dict_value(metadata, "lastUpdateTIme"),
        dict_value(price_info, "lastUpdateTime"),
        deep_text(quote, "lastUpdateTime", "lastUpdateTIme"),
    )

    year_high = first_number(
        dict_value(price_info, "yearHigh"),
        quote.get("yearHigh"),
        dict_value(week_high_low, "max"),
        deep_number(quote, "yearHigh", "52WeekHigh", "fiftyTwoWeekHigh"),
    )
    year_low = first_number(
        dict_value(price_info, "yearLow"),
        quote.get("yearLow"),
        dict_value(week_high_low, "min"),
        deep_number(quote, "yearLow", "52WeekLow", "fiftyTwoWeekLow"),
    )

    volume = first_number(
        dict_value(trade_info, "quantitytraded"),
        dict_value(trade_info, "totalTradedVolume"),
        dict_value(security_wise_dp, "quantityTraded"),
        quote.get("volume"),
        deep_number(quote, "quantityTraded", "totalTradedVolume", "volume"),
    )
    market_cap = first_number(
        dict_value(trade_info, "totalMarketCap"),
        quote.get("totalMarketCap"),
        deep_number(quote, "totalMarketCap", "marketCap"),
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


def normalize_index(requested_symbol: str, row: dict) -> dict:
    last = as_number(row.get("last"))
    if last is None or last <= 0:
        raise ValueError("NSE index response is missing a valid last value")

    previous_close = as_number(row.get("previousClose"))
    change = as_number(row.get("variation"))
    p_change = as_number(row.get("percentChange"))
    if change is None and previous_close is not None:
        change = last - previous_close
    if p_change is None and previous_close not in (None, 0) and change is not None:
        p_change = (change / previous_close) * 100

    return {
        "symbol": requested_symbol,
        "companyName": first_text(row.get("index"), requested_symbol),
        "lastPrice": last,
        "change": change,
        "pChange": p_change,
        "timestamp": datetime.now(IST).strftime("%d-%b-%Y %H:%M:%S"),
        "previousClose": previous_close,
        "open": as_number(row.get("open")),
        "dayHigh": as_number(row.get("high")),
        "dayLow": as_number(row.get("low")),
        "fiftyTwoWeekHigh": as_number(row.get("yearHigh")),
        "fiftyTwoWeekLow": as_number(row.get("yearLow")),
        "volume": None,
        "marketCap": None,
        "marketState": market_state_now(),
    }


def fetch_indices(nse: NSELive, requested_symbols: list[str]) -> tuple[list[dict], list[dict]]:
    quotes: list[dict] = []
    errors: list[dict] = []

    try:
        payload = nse.all_indices()
        rows = payload.get("data", []) if isinstance(payload, dict) else []
    except Exception as exc:
        message = str(exc) or "NSE index request failed"
        return [], [{"symbol": symbol, "error": message} for symbol in requested_symbols]

    by_name = {}
    for row in rows:
        name = str(row.get("index", "")).strip().upper()
        if name:
            by_name[name] = row

    for requested in requested_symbols:
        target_name = INDEX_NAME_MAP.get(requested, requested).upper()
        row = by_name.get(target_name)
        if not row:
            errors.append({"symbol": requested, "error": f"Index '{target_name}' not found in NSE response"})
            continue
        try:
            quotes.append(normalize_index(requested, row))
        except Exception as exc:
            errors.append({"symbol": requested, "error": str(exc) or "NSE index normalize failed"})

    return quotes, errors


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
        payload = json.load(sys.stdin)

        # Backward compatible input: a plain JSON array of equity symbols.
        # New input: {"mode": "indices", "symbols": [...]} for index quotes.
        mode = "equity"
        symbols = payload
        if isinstance(payload, dict):
            mode = str(payload.get("mode") or "equity")
            symbols = payload.get("symbols")

        if not isinstance(symbols, list):
            raise ValueError("Input must be a JSON array of symbols (or {mode, symbols})")

        nse = NSELive()
        quotes: list[dict] = []
        errors: list[dict] = []

        if mode == "indices":
            requested = [str(s).strip() for s in symbols if str(s).strip()]
            quotes, errors = fetch_indices(nse, requested)
        else:
            for raw_symbol in symbols:
                symbol = str(raw_symbol).strip().upper()
                if not symbol:
                    continue
                try:
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