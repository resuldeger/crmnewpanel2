"""Parse a phpMyAdmin MySQL dump into JSON, without a MySQL server.

Only the tables we need, and nothing is printed: the dump carries live
Twilio tokens and SMTP passwords.
"""
import json, re, sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])

text = SRC.read_text(encoding="utf8", errors="replace")


def columns_of(table: str):
    m = re.search(rf"INSERT INTO `{table}` \(([^)]*)\) VALUES", text)
    if not m:
        return None
    return [c.strip().strip("`") for c in m.group(1).split(",")]


def split_values(blob: str):
    """Split a VALUES blob into rows, respecting quotes and backslash escapes."""
    rows, cur, depth = [], [], 0
    in_str = False
    esc = False
    buf = []
    for ch in blob:
        if in_str:
            buf.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == "'":
                in_str = False
            continue
        if ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == "(":
            depth += 1
            if depth == 1:
                buf = []
            else:
                buf.append(ch)
        elif ch == ")":
            depth -= 1
            if depth == 0:
                rows.append("".join(buf))
            else:
                buf.append(ch)
        elif depth > 0:
            buf.append(ch)
    return rows


def split_fields(row: str):
    out, buf, in_str, esc = [], [], False, False
    for ch in row:
        if in_str:
            if esc:
                buf.append({"n": "\n", "t": "\t", "r": "\r", "0": "\0"}.get(ch, ch))
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == "'":
                in_str = False
            else:
                buf.append(ch)
            continue
        if ch == "'":
            in_str = True
        elif ch == ",":
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    out.append("".join(buf).strip())
    return out


def rows_of(table: str):
    cols = columns_of(table)
    if not cols:
        return []
    blobs = re.findall(rf"INSERT INTO `{table}` \([^)]*\) VALUES(.*?);\s*\n", text, re.S)
    result = []
    for blob in blobs:
        for raw in split_values(blob):
            vals = split_fields(raw)
            if len(vals) != len(cols):
                continue
            rec = {}
            for k, v in zip(cols, vals):
                rec[k] = None if v == "NULL" else v
            result.append(rec)
    return result


data = {t: rows_of(t) for t in [
    "branches", "branch_integrations", "timely_locations",
    "timely_staffs", "timely_location_staff", "location_user",
]}

OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf8")
for t, rows in data.items():
    print(f"{t}: {len(rows)} satir")
