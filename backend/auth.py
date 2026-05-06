import bcrypt as _bcrypt
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

ALGORITHM = "HS256"
_TOKEN_EXPIRE_HOURS = 8

_DATA_DIR = Path(__file__).parent.parent / "data"
_SECRET_FILE = _DATA_DIR / ".secret_key"
DB_PATH = _DATA_DIR / "users.db"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _hash(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def _verify(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def _load_secret() -> str:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_text().strip()
    key = secrets.token_hex(32)
    _SECRET_FILE.write_text(key)
    return key


SECRET_KEY = _load_secret()


def init_db() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            hashed_password TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        conn.execute(
            "INSERT INTO users (username, hashed_password, created_at) VALUES (?, ?, ?)",
            ("admin", _hash("admin123"), datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        print("[auth] default account created — username: admin  password: admin123")
    conn.close()


def create_user(username: str, password: str) -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT INTO users (username, hashed_password, created_at) VALUES (?, ?, ?)",
            (username, _hash(password), datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise ValueError("Username already taken")
    finally:
        conn.close()


def authenticate(username: str, password: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    if row and _verify(password, row["hashed_password"]):
        return dict(row)
    return None


def make_token(username: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=_TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    err = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub", "")
        if not username:
            raise err
    except JWTError:
        raise err
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    if not row:
        raise err
    return dict(row)
