import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from zoneinfo import ZoneInfo

from jugaad_data.nse import NSELive

IST = ZoneInfo("Asia/Kolkata")
INDEX_NAME_MAP = {"^NSEI": "NIFTY 50", "^NSEBANK": "NIFTY BANK", "^INDIAVIX": "INDIA VIX"}


def as_number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, str):
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
    for value in values:
        number = as_number(value)
        if number is not None:
            return number
    return None


def first_text(*values):
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def dict_value(data: object, *keys: str):
    if not isinstance(data, dict):
        return None
    lowered = {str(key).lower(): value for key, value in data.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value is not None:
            return value
    return None


def deep_values(data: object, wanted: set[str], max_depth: int = 5):
    if max_depth < 0:
        return
    wanted_lower = {item.lower() for item in wanted}
    if isinstance(data, dict):
        for key, value in data.items():
            if str(key).lower() in wanted_lower:
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
    return "REGULAR" if now.weekday() < 5 and 9 <= now.hour < 16 else "CLOSED"


def normalize(symbol: str, quote: dict) -> dict:
    metadata = quote.get("metaData", {}) or quote.get("metadata", {}) or {}
    info = quote.get("info", {}) or {}
    trade_info = quote.get("tradeInfo", {}) or {}
    order_book = quote.get("orderBook", {}) or {}
    price_info = quote.get("priceInfo", {}) or {}
    intra_day = price_info.get("intraDayHighLow", {}) or {}
    week_high_low = price_info.get("weekHighLow", {}) or {}
    security_wise_dp = quote.get("securityWiseDP", {}) or {}

    company_name = first_text(dict_value(metadata, "companyName"), dict_value(info, "companyName"), quote.get("companyName"), deep_text(quote, "companyName"), symbol)
    last_price = first_number(dict_value(trade_info, "lastPrice"), dict_value(order_book, "lastPrice"), dict_value(price_info, "lastPrice"), quote.get("lastPrice"), deep_number(quote, "lastPrice"))
    if last_price is None or last_price <= 0:
        raise ValueError("NSE response is missing a valid lastPrice")

    previous_close = first_number(dict_value(metadata, "previousClose"), dict_value(price_info, "previousClose"), dict_value(price_info, "basePrice"), quote.get("previousClose"), deep_number(quote, "previousClose", "basePrice"))
    change = first_number(dict_value(metadata, "change"), dict_value(price_info, "change"), quote.get("change"), deep_number(quote, "change"))
    p_change = first_number(dict_value(metadata, "pChange"), dict_value(price_info, "pChange"), quote.get("pChange"), deep_number(quote, "pChange", "changePercent", "percentChange"))
    if change is None and previous_close is not None:
        change = last_price - previous_close
    if p_change is None and previous_close not in (None, 0) and change is not None:
        p_change = (change / previous_close) * 100

    timestamp = first_text(quote.get("lastUpdateTime"), quote.get("lastUpdateTIme"), dict_value(metadata, "lastUpdateTime"), dict_value(metadata, "lastUpdateTIme"), dict_value(price_info, "lastUpdateTime"), deep_text(quote, "lastUpdateTime", "lastUpdateTIme"))
    year_high = first_number(dict_value(price_info, "yearHigh"), quote.get("yearHigh"), dict_value(week_high_low, "max"), deep_number(quote, "yearHigh", "52WeekHigh", "fiftyTwoWeekHigh"))
    year_low = first_number(dict_value(price_info, "yearLow"), quote.get("yearLow"), dict_value(week_high_low, "min"), deep_number(quote, "yearLow", "52WeekLow", "fiftyTwoWeekLow"))
    volume = first_number(dict_value(trade_info, "quantitytraded"), dict_value(trade_info, "totalTradedVolume"), dict_value(security_wise_dp, "quantityTraded"), quote.get("volume"), deep_number(quote, "quantityTraded", "totalTradedVolume", "volume"))
    market_cap = first_number(dict_value(trade_info, "totalMarketCap"), quote.get("totalMarketCap"), deep_number(quote, "totalMarketCap", "marketCap"))

    # NSE/jugaad-data normally exposes priceInfo.open. New/alternate NSE
    # payloads may expose the same value under openPrice/open_price/openingPrice.
    # Keep these fallbacks here so the UI does not lose a valid opening price.
    opening_price = first_number(
        dict_value(metadata, "open", "openPrice", "open_price", "openingPrice"),
        dict_value(price_info, "open", "openPrice", "open_price", "openingPrice"),
        dict_value(trade_info, "open", "openPrice", "open_price", "openingPrice"),
        quote.get("open"), quote.get("openPrice"), quote.get("open_price"), quote.get("openingPrice"),
        deep_number(quote, "open", "openPrice", "open_price", "openingPrice"),
    )

    return {
        "symbol": symbol, "companyName": company_name, "lastPrice": last_price,
        "change": change, "pChange": p_change, "timestamp": timestamp,
        "previousClose": previous_close,
        "open": opening_price,
        "dayHigh": first_number(dict_value(metadata, "dayHigh"), dict_value(price_info, "dayHigh"), dict_value(intra_day, "max"), quote.get("dayHigh"), deep_number(quote, "dayHigh", "high")),
        "dayLow": first_number(dict_value(metadata, "dayLow"), dict_value(price_info, "dayLow"), dict_value(intra_day, "min"), quote.get("dayLow"), deep_number(quote, "dayLow", "low")),
        "fiftyTwoWeekHigh": year_high, "fiftyTwoWeekLow": year_low,
        "volume": volume, "marketCap": market_cap, "marketState": market_state(timestamp),
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
        "symbol": requested_symbol, "companyName": first_text(row.get("index"), requested_symbol),
        "lastPrice": last, "change": change, "pChange": p_change,
        "timestamp": datetime.now(IST).strftime("%d-%b-%Y %H:%M:%S"), "previousClose": previous_close,
        "open": as_number(row.get("open")), "dayHigh": as_number(row.get("high")), "dayLow": as_number(row.get("low")),
        "fiftyTwoWeekHigh": as_number(row.get("yearHigh")), "fiftyTwoWeekLow": as_number(row.get("yearLow")),
        "volume": None, "marketCap": None, "marketState": market_state_now(),
    }


def fetch_indices(nse: NSELive, requested_symbols: list[str]) -> tuple[list[dict], list[dict]]:
    try:
        payload = nse.all_indices()
        rows = payload.get("data", []) if isinstance(payload, dict) else []
    except Exception as exc:
        message = str(exc) or "NSE index request failed"
        return [], [{"symbol": symbol, "error": message} for symbol in requested_symbols]
    by_name = {str(row.get("index", "")).strip().upper(): row for row in rows if str(row.get("index", "")).strip()}
    quotes, errors = [], []
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
                time.sleep(0.25)
    raise last_error or RuntimeError("NSE request failed")


def fetch_one_equity(symbol: str) -> tuple[dict | None, dict | None]:
    try:
        # Each worker gets its own NSELive instance to avoid sharing a mutable
        # HTTP session between threads while allowing independent requests.
        quote = fetch_with_retry(NSELive(), symbol)
        return normalize(symbol, quote), None
    except Exception as exc:
        return None, {"symbol": symbol, "error": str(exc) or "NSE request failed"}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
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
            requested = [str(s).strip().upper() for s in symbols if str(s).strip()]
            if requested:
                # The old implementation fetched every stock sequentially.
                # Parallel requests reduce dashboard latency while keeping a
                # conservative worker limit to avoid hammering NSE.
                worker_count = min(4, len(requested))
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    futures = [executor.submit(fetch_one_equity, symbol) for symbol in requested]
                    for future in as_completed(futures):
                        quote, error = future.result()
                        if quote is not None:
                            quotes.append(quote)
                        if error is not None:
                            errors.append(error)
                order = {symbol: index for index, symbol in enumerate(requested)}
                quotes.sort(key=lambda item: order.get(item.get("symbol", ""), len(order)))

        if not quotes:
            message = errors[0].get("error") if errors else "NSE returned no quotes"
            print(json.dumps({"quotes": [], "errors": errors or [{"error": message}], "timing": {"mode": mode}}, separators=(",", ":")))
            return 1

        print(json.dumps({"quotes": quotes, "errors": errors, "timing": {"mode": mode, "parallel": mode != "indices"}}, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(json.dumps({"quotes": [], "errors": [{"error": str(exc) or "NSE service failed"}]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())