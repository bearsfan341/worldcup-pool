"""Shared player-name normalization and matching.

Two datasets never spell players the same way. This handles the cases that
actually occur between ESPN and FantasyPros:
  - ligatures from PDF extraction (McCaﬀrey -> McCaffrey)
  - generational suffixes (Jr., Sr., II, III, IV)
  - punctuation and casing (Ja'Marr / JaMarr, A.J. / AJ)
  - defense naming ("49ers D/ST" vs "San Francisco 49ers")
"""
import re
import unicodedata

LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi",
             "ﬄ": "ffl", "’": "'", "‘": "'"}

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# ESPN uses the nickname; FantasyPros the full club name.
DST_CITY = {
    "49ers": "san francisco", "bears": "chicago", "bengals": "cincinnati",
    "bills": "buffalo", "broncos": "denver", "browns": "cleveland",
    "buccaneers": "tampa bay", "cardinals": "arizona", "chargers": "los angeles",
    "chiefs": "kansas city", "colts": "indianapolis", "commanders": "washington",
    "cowboys": "dallas", "dolphins": "miami", "eagles": "philadelphia",
    "falcons": "atlanta", "giants": "new york", "jaguars": "jacksonville",
    "jets": "new york", "lions": "detroit", "packers": "green bay",
    "panthers": "carolina", "patriots": "new england", "raiders": "las vegas",
    "rams": "los angeles", "ravens": "baltimore", "saints": "new orleans",
    "seahawks": "seattle", "steelers": "pittsburgh", "texans": "houston",
    "titans": "tennessee", "vikings": "minnesota",
}


def defix(s):
    for k, v in LIGATURES.items():
        s = s.replace(k, v)
    return unicodedata.normalize("NFKD", s)


def is_dst(name):
    n = name.lower()
    return "d/st" in n or "dst" in n or "defense" in n or any(
        n.endswith(c) or n.startswith(c) for c in DST_CITY)


def norm(name):
    """Collapse a name to a comparable key."""
    s = defix(name).lower().strip()
    s = re.sub(r"\b(d/st|dst|defense|special teams)\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]", "", s)
    toks = [t for t in s.split() if t and t not in SUFFIXES]
    return " ".join(toks)


def dst_key(name):
    """Map any defense spelling to a single canonical key."""
    toks = norm(name).split()
    for t in reversed(toks):
        if t in DST_CITY:
            return "dst " + t
    # already a city form: match on the trailing nickname if present
    joined = " ".join(toks)
    for nick, city in DST_CITY.items():
        if joined.startswith(city) or joined.endswith(nick):
            return "dst " + nick
    return "dst " + joined


def key(name):
    return dst_key(name) if is_dst(name) else norm(name)


def build_index(names):
    """name -> key index, plus a last-name fallback for near-misses."""
    idx, last = {}, {}
    for n in names:
        k = key(n)
        idx[k] = n
        parts = k.split()
        if len(parts) >= 2:
            last.setdefault(parts[0] + "|" + parts[-1], n)
    return idx, last


def match(name, idx, last):
    k = key(name)
    if k in idx:
        return idx[k]
    p = k.split()
    if len(p) >= 2:
        hit = last.get(p[0] + "|" + p[-1])
        if hit:
            return hit
    # prefix containment, e.g. "Marvin Harrison" vs "Marvin Harrison Jr."
    for kk, v in idx.items():
        if kk.startswith(k) or k.startswith(kk):
            return v
    return None
