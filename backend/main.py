import io
import pandas as pd
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from preprocessing import clean_dataframe
from rfm import compute_rfm
from clustering import add_clusters
from recommender import build_item_matrix, get_recommendations
from auth import init_db, create_user, authenticate, make_token, get_current_user

DATA_FILE = Path(__file__).parent.parent / "data" / "Online Retail.xlsx"

_df = None
_rfm = None
_matrix = None


def _load():
    global _df, _rfm, _matrix
    if not DATA_FILE.exists():
        print(f"[warn] data file not found: {DATA_FILE}")
        return
    print("[info] loading Excel data…")
    df = pd.read_excel(DATA_FILE)
    df = clean_dataframe(df)
    _rfm = add_clusters(compute_rfm(df))
    _matrix = build_item_matrix(df)
    _df = df
    print(f"[info] loaded {len(_df):,} rows")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _load()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def pipeline():
    return _df, _rfm, _matrix


# ── Auth ───────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = authenticate(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    return {"access_token": make_token(req.username), "token_type": "bearer"}


@app.post("/api/auth/register")
def register(req: RegisterRequest):
    if len(req.username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        create_user(req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"message": "Account created"}


@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"]}


# ── Data API ───────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def stats(_auth: dict = Depends(get_current_user)):
    df, _, _ = pipeline()
    if df is None:
        return {"revenue": 0, "customers": 0, "transactions": 0}
    return {
        "revenue":      round(float(df["TotalPrice"].sum()), 2),
        "customers":    int(df["CustomerID"].nunique()),
        "transactions": int(df["InvoiceNo"].nunique()),
    }


@app.get("/api/revenue/monthly")
def monthly_revenue(_auth: dict = Depends(get_current_user)):
    df, _, _ = pipeline()
    if df is None:
        return []
    monthly = (
        df.groupby(df["InvoiceDate"].dt.to_period("M"))["TotalPrice"]
        .sum()
        .reset_index()
    )
    monthly["InvoiceDate"] = monthly["InvoiceDate"].astype(str)
    monthly.columns = ["month", "revenue"]
    monthly["revenue"] = monthly["revenue"].round(2)
    return monthly.to_dict(orient="records")


@app.get("/api/segments")
def segments(_auth: dict = Depends(get_current_user)):
    _, rfm, _ = pipeline()
    if rfm is None:
        return {"averages": [], "counts": []}
    averages = (
        rfm.groupby("Cluster")[["Recency", "Frequency", "Monetary"]]
        .mean()
        .round(2)
        .reset_index()
        .rename(columns={"Cluster": "cluster", "Recency": "recency",
                         "Frequency": "frequency", "Monetary": "monetary"})
    )
    averages["cluster"] = averages["cluster"].astype(str)
    counts = rfm["Cluster"].value_counts().reset_index()
    counts.columns = ["cluster", "customers"]
    counts["cluster"] = counts["cluster"].astype(str)
    return {
        "averages": averages.to_dict(orient="records"),
        "counts":   counts.to_dict(orient="records"),
    }


@app.get("/api/customers/top")
def top_customers(_auth: dict = Depends(get_current_user)):
    _, rfm, _ = pipeline()
    if rfm is None:
        return []
    top = (
        rfm.nlargest(5, "Monetary")[["CustomerID", "Recency", "Frequency", "Monetary"]]
        .reset_index(drop=True)
        .rename(columns={"CustomerID": "customer_id", "Recency": "recency",
                         "Frequency": "frequency", "Monetary": "monetary"})
    )
    top["customer_id"] = top["customer_id"].astype(str)
    return top.to_dict(orient="records")


@app.get("/api/products/top")
def top_products(_auth: dict = Depends(get_current_user)):
    df, _, _ = pipeline()
    if df is None:
        return []
    top = df.groupby("Description")["Quantity"].sum().nlargest(5).reset_index()
    top.columns = ["product", "quantity_sold"]
    return top.to_dict(orient="records")


@app.get("/api/products")
def products(_auth: dict = Depends(get_current_user)):
    df, _, _ = pipeline()
    if df is None:
        return []
    prods = (
        df.drop_duplicates("StockCode")[["StockCode", "Description"]]
        .sort_values("Description")
        .rename(columns={"StockCode": "stock_code", "Description": "description"})
    )
    return prods.to_dict(orient="records")


class RecommendRequest(BaseModel):
    stock_code: str
    top_n: int = 5


@app.post("/api/recommend")
def recommend(req: RecommendRequest, _auth: dict = Depends(get_current_user)):
    df, _, matrix = pipeline()
    if matrix is None:
        return []
    product_map = df.drop_duplicates("StockCode").set_index("StockCode")["Description"].to_dict()
    recs = get_recommendations(matrix, req.stock_code, top_n=req.top_n)
    return [
        {"stock_code": code, "description": product_map.get(code, "Unknown"), "similarity": sim}
        for code, sim in recs
    ]


@app.post("/api/upload")
async def upload_data(file: UploadFile = File(...), _auth: dict = Depends(get_current_user)):
    name = file.filename or ""
    if not (name.endswith(".xlsx") or name.endswith(".xls") or name.endswith(".csv")):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are accepted.")

    content = await file.read()
    try:
        if name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")

    try:
        clean_dataframe(df)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "wb") as f:
        f.write(content)

    _load()
    return {"rows": len(df)}


@app.get("/api/datafile")
def datafile_info(_auth: dict = Depends(get_current_user)):
    if not DATA_FILE.exists():
        return {"exists": False}
    stat = DATA_FILE.stat()
    return {
        "exists": True,
        "name": DATA_FILE.name,
        "size_mb": round(stat.st_size / 1_048_576, 2),
    }


FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
