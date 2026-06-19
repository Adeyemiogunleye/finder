"""
Grocery Finder backend with Entra ID authentication.

Uses free OpenStreetMap services (no API key required):
  - Nominatim  : geocode a typed address -> lat/lon
  - Overpass   : find nearby supermarkets / grocery stores

Authentication:
  - Entra ID (Azure AD) JWTs validated on every protected route.
"""

import math
import os
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

# Load .env sitting next to this file, regardless of working directory
load_dotenv(Path(__file__).parent / ".env")

TENANT_ID = os.environ["TENANT_ID"]
CLIENT_ID = os.environ["CLIENT_ID"]
print("TENANT_ID loaded:", TENANT_ID)  # temporary debug — remove later

app = FastAPI(title="Grocery Finder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── OpenStreetMap ─────────────────────────────────────────────────────────────
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL  = "https://overpass-api.de/api/interpreter"
HEADERS       = {"User-Agent": "GroceryFinder/1.0 (a.yemiogunleye@gmail.com)"}

# ── Entra ID config ───────────────────────────────────────────────────────────
   # from Azure Portal
   # from Azure Portal

JWKS_URL = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
ISSUER   = f"https://sts.windows.net/{TENANT_ID}/"

bearer_scheme = HTTPBearer()
_jwks_cache: Optional[dict] = None


# ── Auth helpers ──────────────────────────────────────────────────────────────
async def get_jwks() -> dict:
    """Fetch Microsoft's public signing keys (cached after first call)."""
    global _jwks_cache
    if _jwks_cache is None:
        async with httpx.AsyncClient() as client:
            resp = await client.get(JWKS_URL)
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    print(f"Credentials received: {credentials}")
    """Validate the Entra ID JWT. Raises 401 if missing, expired, or invalid."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        jwks = await get_jwks()
        payload = jwt.decode(
            credentials.credentials,
            jwks,
            algorithms=["RS256"],
            audience=f"api://{CLIENT_ID}",
            issuer=ISSUER,
            options={"verify_at_hash": False},
        )
        return payload
    except JWTError as e:
        print(f"JWT validation error: {e}")   # ← add this line
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
        


# ── OSM helpers ───────────────────────────────────────────────────────────────
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return r * 2 * math.asin(math.sqrt(a))


async def geocode(client: httpx.AsyncClient, address: str):
    resp = await client.get(
        NOMINATIM_URL,
        params={"q": address, "format": "json", "limit": 1},
        headers=HEADERS,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data:
        raise HTTPException(status_code=404, detail="Address not found.")
    top = data[0]
    return float(top["lat"]), float(top["lon"]), top.get("display_name", address)


async def find_groceries(
    client: httpx.AsyncClient, lat: float, lon: float, radius_m: int
):
    query = f"""
    [out:json][timeout:25];
    (
      node["shop"="supermarket"](around:{radius_m},{lat},{lon});
      node["shop"="grocery"](around:{radius_m},{lat},{lon});
      node["shop"="convenience"](around:{radius_m},{lat},{lon});
    );
    out body;
    """
    resp = await client.post(OVERPASS_URL, data={"data": query}, headers=HEADERS)
    resp.raise_for_status()
    elements = resp.json().get("elements", [])

    stores = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        s_lat, s_lon = el["lat"], el["lon"]
        parts = [
            tags.get("addr:housenumber"),
            tags.get("addr:street"),
            tags.get("addr:city"),
        ]
        addr = " ".join(p for p in parts if p) or "Address not available"
        stores.append(
            {
                "name": name,
                "type": tags.get("shop"),
                "address": addr,
                "lat": s_lat,
                "lon": s_lon,
                "distance_km": round(haversine_km(lat, lon, s_lat, s_lon), 2),
            }
        )

    stores.sort(key=lambda s: s["distance_km"])
    return stores


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/autocomplete")
async def autocomplete(
    q: str = Query(..., min_length=3),
    token: dict = Depends(verify_token),        # ← protected
):
    """Return address suggestions for a partial query."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={"q": q, "format": "json", "limit": 5, "addressdetails": 1},
                headers=HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Lookup failed: {e}")

    return [
        {"display_name": item["display_name"], "lat": item["lat"], "lon": item["lon"]}
        for item in data
    ]


@app.get("/nearest-grocery")
async def nearest_grocery(
    address: str = Query(..., min_length=3),
    radius_m: int = Query(2000, ge=100, le=20000),
    limit: int = Query(10, ge=1, le=50),
    token: dict = Depends(verify_token),        # ← protected
):
    """Geocode an address, then return the nearest grocery stores."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            lat, lon, display_name = await geocode(client, address)
            stores = await find_groceries(client, lat, lon, radius_m)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"OpenStreetMap returned {e.response.status_code}.",
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach OpenStreetMap: {type(e).__name__}: {e}",
        )

    return {
        "query": display_name,
        "origin": {"lat": lat, "lon": lon},
        "count": len(stores),
        "stores": stores[:limit],
    }


@app.get("/health")
async def health():
    """Public endpoint — no auth required."""
    return {"status": "ok"}