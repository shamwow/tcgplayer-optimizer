#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

try:
    import highspy
except ImportError as exc:  # pragma: no cover - exercised manually
    raise SystemExit(
        "This CLI requires the Python package 'highspy'. "
        "Install it with `python3 -m pip install highspy`."
    ) from exc


CLI_INPUT_FORMAT = "tcgplayer-optimizer-cli-input"
CLI_OUTPUT_FORMAT = "tcgplayer-optimizer-cli-output"
CLI_FORMAT_VERSION = 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Compute the exact optimal TCGPlayer cart assignment from a JSON export "
            "produced by the Chrome extension."
        )
    )
    parser.add_argument(
        "-i",
        "--input",
        default="-",
        help="Path to the CLI input JSON file. Use '-' or omit for stdin.",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="-",
        help="Path to write the CLI output JSON file. Use '-' or omit for stdout.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print the output JSON.",
    )
    return parser.parse_args()


def read_json(path: str) -> dict:
    if path == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(path).read_text()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Input is not valid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError("Input JSON must be an object.")
    return data


def write_json(path: str, data: dict, pretty: bool) -> None:
    text = json.dumps(data, indent=2 if pretty else None)
    if pretty:
        text += "\n"

    if path == "-":
        sys.stdout.write(text)
    else:
        Path(path).write_text(text)


def validate_input(data: dict) -> tuple[list[dict], dict[int, list[dict]], dict[str, dict]]:
    if data.get("format") != CLI_INPUT_FORMAT:
        raise ValueError(f'Input format must be "{CLI_INPUT_FORMAT}".')
    if data.get("version") != CLI_FORMAT_VERSION:
        raise ValueError(f"Input version must be {CLI_FORMAT_VERSION}.")

    desired_items = data.get("desiredItems")
    sellers = data.get("sellers")
    listings = data.get("listings")
    if not isinstance(desired_items, list) or not desired_items:
        raise ValueError("Input must include a non-empty desiredItems array.")
    if not isinstance(sellers, list):
        raise ValueError("Input must include a sellers array.")
    if not isinstance(listings, list) or not listings:
        raise ValueError("Input must include a non-empty listings array.")

    listings_by_sku: dict[int, list[dict]] = {}
    for idx, listing in enumerate(listings):
        if not isinstance(listing, dict):
            raise ValueError(f"Listing {idx + 1} must be an object.")
        sku = require_positive_int(listing.get("sku"), f"Listing {idx + 1} sku")
        seller_key = require_non_empty_str(listing.get("sellerKey"), f"Listing {idx + 1} sellerKey")
        require_non_empty_str(listing.get("listingId"), f"Listing {idx + 1} listingId")
        require_non_negative_int(listing.get("sellerId"), f"Listing {idx + 1} sellerId")
        require_non_negative_int(listing.get("priceCents"), f"Listing {idx + 1} priceCents")
        require_non_negative_int(listing.get("shippingCents"), f"Listing {idx + 1} shippingCents")
        listings_by_sku.setdefault(sku, []).append(
            {
                **listing,
                "sku": sku,
                "sellerKey": seller_key,
            }
        )

    sellers_by_key: dict[str, dict] = {}
    for idx, seller in enumerate(sellers):
        if not isinstance(seller, dict):
            raise ValueError(f"Seller {idx + 1} must be an object.")
        seller_key = require_non_empty_str(seller.get("sellerKey"), f"Seller {idx + 1} sellerKey")
        sellers_by_key[seller_key] = {
          **seller,
          "sellerId": require_non_negative_int(seller.get("sellerId"), f"Seller {idx + 1} sellerId"),
          "sellerKey": seller_key,
          "shippingUnderCents": require_non_negative_int(seller.get("shippingUnderCents"), f"Seller {idx + 1} shippingUnderCents"),
          "shippingOverCents": require_non_negative_int(seller.get("shippingOverCents"), f"Seller {idx + 1} shippingOverCents"),
          "thresholdCents": require_non_negative_int(seller.get("thresholdCents"), f"Seller {idx + 1} thresholdCents"),
        }

    normalized_items: list[dict] = []
    for idx, item in enumerate(desired_items):
        if not isinstance(item, dict):
            raise ValueError(f"Desired item {idx + 1} must be an object.")
        sku = require_positive_int(item.get("sku"), f"Desired item {idx + 1} sku")
        if sku not in listings_by_sku:
            raise ValueError(f"Desired item {idx + 1} sku {sku} has no listings.")
        normalized_items.append(
            {
                **item,
                "cartIndex": require_non_negative_int(item.get("cartIndex"), f"Desired item {idx + 1} cartIndex"),
                "sku": sku,
            }
        )

    # Make sure every seller referenced by a listing has a shipping record.
    for sku_listings in listings_by_sku.values():
        for listing in sku_listings:
            seller_key = listing["sellerKey"]
            if seller_key not in sellers_by_key:
                sellers_by_key[seller_key] = {
                    "sellerId": int(listing["sellerId"]),
                    "sellerKey": seller_key,
                    "shippingUnderCents": int(listing["shippingCents"]),
                    "shippingOverCents": int(listing["shippingCents"]),
                    "thresholdCents": 0,
                }

    return normalized_items, listings_by_sku, sellers_by_key


def require_positive_int(value: object, label: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise ValueError(f"{label} must be a positive integer.")
    return value


def require_non_negative_int(value: object, label: str) -> int:
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer.")
    return value


def require_non_empty_str(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string.")
    return value


def sanitize_var_name(raw: str) -> str:
    return "s_" + "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in raw)


def build_lp_model(
    desired_items: list[dict],
    listings_by_sku: dict[int, list[dict]],
    sellers_by_key: dict[str, dict],
) -> tuple[str, dict[str, tuple[int, dict]], set[str]]:
    lines = ["Minimize"]
    objective_terms: list[str] = []
    x_var_lookup: dict[str, tuple[int, dict]] = {}
    sellers_used: set[str] = set()
    seller_terms: dict[str, list[str]] = {}

    for item_idx, item in enumerate(desired_items):
        sku_listings = listings_by_sku[item["sku"]]
        for listing_idx, listing in enumerate(sku_listings):
            var_name = f"x_{item_idx}_{listing_idx}"
            x_var_lookup[var_name] = (item_idx, listing)
            objective_terms.append(f'{int(listing["priceCents"])} {var_name}')
            sellers_used.add(listing["sellerKey"])
            seller_terms.setdefault(listing["sellerKey"], []).append(
                f'{int(listing["priceCents"])} {var_name}'
            )

    for seller_key in sorted(sellers_used):
        safe_key = sanitize_var_name(seller_key)
        seller = sellers_by_key[seller_key]
        objective_terms.append(f'{int(seller["shippingUnderCents"])} y_{safe_key}')
        delta = int(seller["shippingOverCents"]) - int(seller["shippingUnderCents"])
        if delta != 0:
            objective_terms.append(f"{delta} z_{safe_key}")

    lines.append(" obj: " + " + ".join(objective_terms))
    lines.append("Subject To")

    for item_idx, item in enumerate(desired_items):
        sku_listings = listings_by_sku[item["sku"]]
        terms = [f"x_{item_idx}_{listing_idx}" for listing_idx in range(len(sku_listings))]
        lines.append(f" item_{item_idx}: " + " + ".join(terms) + " = 1")

    for item_idx, item in enumerate(desired_items):
        sku_listings = listings_by_sku[item["sku"]]
        for listing_idx, listing in enumerate(sku_listings):
            safe_key = sanitize_var_name(listing["sellerKey"])
            lines.append(f" link_{item_idx}_{listing_idx}: x_{item_idx}_{listing_idx} - y_{safe_key} <= 0")

    for seller_key in sorted(sellers_used):
        seller = sellers_by_key[seller_key]
        delta = int(seller["shippingOverCents"]) - int(seller["shippingUnderCents"])
        if delta == 0:
            continue
        safe_key = sanitize_var_name(seller_key)
        subtotal_terms = seller_terms[seller_key]
        lines.append(
            f' thresh_{safe_key}: ' +
            " + ".join(subtotal_terms) +
            f' - {int(seller["thresholdCents"])} z_{safe_key} >= 0'
        )
        lines.append(f" zlink_{safe_key}: z_{safe_key} - y_{safe_key} <= 0")

    lines.append("Binary")
    for item_idx, item in enumerate(desired_items):
        sku_listings = listings_by_sku[item["sku"]]
        for listing_idx in range(len(sku_listings)):
            lines.append(f" x_{item_idx}_{listing_idx}")
    for seller_key in sorted(sellers_used):
        safe_key = sanitize_var_name(seller_key)
        lines.append(f" y_{safe_key}")
        seller = sellers_by_key[seller_key]
        delta = int(seller["shippingOverCents"]) - int(seller["shippingUnderCents"])
        if delta != 0:
            lines.append(f" z_{safe_key}")
    lines.append("End")

    return "\n".join(lines), x_var_lookup, sellers_used


def solve_exact(
    desired_items: list[dict],
    listings_by_sku: dict[int, list[dict]],
    sellers_by_key: dict[str, dict],
) -> dict:
    lp_text, x_var_lookup, sellers_used = build_lp_model(desired_items, listings_by_sku, sellers_by_key)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".lp", delete=False) as temp_file:
        temp_file.write(lp_text)
        temp_path = Path(temp_file.name)

    highs = highspy.Highs()
    highs.setOptionValue("output_flag", False)
    highs.setOptionValue("mip_rel_gap", 0.0)
    highs.setOptionValue("mip_abs_gap", 0.0)
    highs.setOptionValue("time_limit", 600.0)

    try:
        status = highs.readModel(str(temp_path))
        if status != highspy.HighsStatus.kOk:
            raise RuntimeError(f"HiGHS failed to read the model: {status}")

        started = time.time()
        status = highs.run()
        solve_time_ms = int(round((time.time() - started) * 1000))
        if status != highspy.HighsStatus.kOk:
            raise RuntimeError(f"HiGHS failed to solve the model: {status}")

        model_status = highs.modelStatusToString(highs.getModelStatus())
        if model_status != "Optimal":
            raise RuntimeError(f"HiGHS did not find an optimal solution: {model_status}")

        values_by_name = dict(zip(highs.allVariableNames(), highs.allVariableValues()))
        chosen_by_item_idx: dict[int, dict] = {}
        for var_name, (item_idx, listing) in x_var_lookup.items():
            if values_by_name.get(var_name, 0.0) > 0.5:
                chosen_by_item_idx[item_idx] = listing

        if len(chosen_by_item_idx) != len(desired_items):
            raise RuntimeError("HiGHS returned an incomplete assignment.")

        item_cost_cents = 0
        seller_totals: dict[str, dict[str, int]] = {}
        assignments: list[dict] = []
        for item_idx, item in enumerate(desired_items):
            listing = chosen_by_item_idx[item_idx]
            item_cost_cents += int(listing["priceCents"])
            seller_info = seller_totals.setdefault(
                listing["sellerKey"],
                {"subtotalCents": 0, "count": 0},
            )
            seller_info["subtotalCents"] += int(listing["priceCents"])
            seller_info["count"] += 1
            assignments.append(
                {
                    "cartIndex": int(item["cartIndex"]),
                    "sku": int(item["sku"]),
                    "sellerId": int(listing["sellerId"]),
                    "sellerKey": listing["sellerKey"],
                    "sellerName": listing.get("sellerName"),
                    "listingId": listing["listingId"],
                    "channelId": int(listing.get("channelId", 0)),
                    "priceCents": int(listing["priceCents"]),
                }
            )

        shipping_cents = 0
        for seller_key in sellers_used:
            if seller_key not in seller_totals:
                continue
            seller = sellers_by_key[seller_key]
            subtotal_cents = seller_totals[seller_key]["subtotalCents"]
            if subtotal_cents >= int(seller["thresholdCents"]):
                shipping_cents += int(seller["shippingOverCents"])
            else:
                shipping_cents += int(seller["shippingUnderCents"])

        objective_cents = int(round(highs.getObjectiveValue()))
        computed_total = item_cost_cents + shipping_cents
        if objective_cents != computed_total:
            objective_cents = computed_total

        assignments.sort(key=lambda assignment: assignment.get("cartIndex", 0))
        return {
            "format": CLI_OUTPUT_FORMAT,
            "version": CLI_FORMAT_VERSION,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "objectiveCents": objective_cents,
            "itemCostCents": item_cost_cents,
            "shippingCents": shipping_cents,
            "sellerCount": len(seller_totals),
            "solveTimeMs": solve_time_ms,
            "assignments": assignments,
        }
    finally:
        temp_path.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()

    try:
        raw_input = read_json(args.input)
        desired_items, listings_by_sku, sellers_by_key = validate_input(raw_input)
        result = solve_exact(desired_items, listings_by_sku, sellers_by_key)
        write_json(args.output, result, args.pretty)
        return 0
    except Exception as exc:
        sys.stderr.write(f"{exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
