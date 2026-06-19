# Grocery Finder

Type an address, get the nearest grocery stores. React frontend + Python
(FastAPI) backend. Uses **free OpenStreetMap** services — no API key needed.

```
grocery-finder/
├── backend/      FastAPI + httpx (Nominatim geocoding, Overpass search)
└── frontend/     React + Vite
```

## Prerequisites
- Python 3.9+
- Node.js 18+

## 1. Run the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload          # serves http://localhost:8000
```

Quick test: open http://localhost:8000/nearest-grocery?address=Times+Square+New+York

## 2. Run the frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev                        # serves http://localhost:5173
```

Open http://localhost:5173 and search. Vite proxies `/api/*` to the backend,
so no CORS or hardcoded URLs in the frontend.

## How it works
1. **Geocode** — Nominatim turns the typed address into lat/lon.
2. **Search** — Overpass finds `shop=supermarket|grocery|convenience` within
   the chosen radius.
3. **Rank** — results are sorted by straight-line (haversine) distance.

## Notes & limits
- OpenStreetMap endpoints are free but rate-limited; fine for development.
  For production, run your own Nominatim/Overpass instance or switch to Google.
- The `User-Agent` header in `backend/main.py` is required by Nominatim's
  usage policy — set it to your real contact before any heavy use.

## Switching to Google Maps later
Replace `geocode()` (Geocoding API) and `find_groceries()` (Places Nearby
Search, `type=grocery_or_supermarket`) in `backend/main.py`. Keep the API key
on the backend only — never in the React code.
