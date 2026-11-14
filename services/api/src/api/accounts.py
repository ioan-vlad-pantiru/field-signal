"""Farmer accounts: email + password sign-in and the fields each farmer keeps.

Storage is a single SQLite file (`DATABASE_PATH`). In production it lives on an Azure Files volume
so it survives redeploys; the API runs as one replica, so SQLite's single writer is enough.

Sessions are random tokens in an httpOnly cookie. Only a SHA-256 of the token is stored, so a
leaked database cannot be replayed as sessions. Passwords are hashed with scrypt (stdlib).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status

from api.contracts import Account, SavedField, SavedFieldInput, SignIn, SignUp
from api.settings import get_settings

COOKIE = "fs_session"
SESSION_DAYS = 60
MAX_FIELDS = 200

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fields_by_account ON fields(account_id, updated_at);
"""

_lock = threading.Lock()
_ready: set[str] = set()


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """One short-lived connection per request; writes are serialised by a process lock."""
    path = get_settings().database_path
    with _lock:
        if str(path) not in _ready:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(path) as setup:
                setup.executescript(SCHEMA)
            _ready.add(str(path))
        conn = sqlite3.connect(path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()


# --------------------------------------------------------------------------- passwords, tokens


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32
    )
    return hmac.compare_digest(digest.hex(), digest_hex)


# A real hash to compare against when the email is unknown, so timing does not reveal accounts.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _normalise_email(email: str) -> str:
    email = email.strip().lower()
    local, _, domain = email.partition("@")
    if not local or "." not in domain or " " in email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_email")
    return email


def _account(row: sqlite3.Row) -> Account:
    return Account(id=row["id"], email=row["email"], name=row["name"], created_at=row["created_at"])


def _start_session(response: Response, account_id: str) -> None:
    token = secrets.token_urlsafe(32)
    expires = _now() + timedelta(days=SESSION_DAYS)
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(_now()),))
        conn.execute(
            "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
            (_token_hash(token), account_id, _iso(expires)),
        )
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        secure=get_settings().environment != "development",
        samesite="lax",
        path="/",
    )


def current_account(fs_session: Annotated[str | None, Cookie()] = None) -> Account:
    if not fs_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "signed_out")
    with connect() as conn:
        row = conn.execute(
            """SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
               WHERE s.token_hash = ? AND s.expires_at > ?""",
            (_token_hash(fs_session), _iso(_now())),
        ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "signed_out")
    return _account(row)


CurrentAccount = Annotated[Account, Depends(current_account)]

router = APIRouter(prefix="/v1", tags=["account"])


# --------------------------------------------------------------------------- auth


@router.post("/auth/signup", status_code=status.HTTP_201_CREATED)
def sign_up(body: SignUp, response: Response) -> Account:
    email = _normalise_email(body.email)
    name = (body.name or "").strip() or None
    account = Account(id=uuid.uuid4().hex, email=email, name=name, created_at=_iso(_now()))
    try:
        with connect() as conn:
            conn.execute(
                """INSERT INTO accounts (id, email, name, password_hash, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (account.id, email, name, hash_password(body.password), account.created_at),
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken") from exc
    _start_session(response, account.id)
    return account


@router.post("/auth/login")
def sign_in(body: SignIn, response: Response) -> Account:
    email = body.email.strip().lower()
    with connect() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE email = ?", (email,)).fetchone()
    ok = verify_password(body.password, row["password_hash"] if row else _DUMMY_HASH)
    if row is None or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong_credentials")
    _start_session(response, row["id"])
    return _account(row)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(response: Response, fs_session: Annotated[str | None, Cookie()] = None) -> None:
    if fs_session:
        with connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(fs_session),))
    response.delete_cookie(COOKIE, path="/")


@router.get("/auth/me")
def me(account: CurrentAccount) -> Account:
    return account


# --------------------------------------------------------------------------- saved fields


def _field(row: sqlite3.Row) -> SavedField:
    body = json.loads(row["body"])
    return SavedField(
        id=row["id"], created_at=row["created_at"], updated_at=row["updated_at"], **body
    )


@router.get("/me/fields")
def list_fields(account: CurrentAccount) -> list[SavedField]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM fields WHERE account_id = ? ORDER BY updated_at DESC, created_at DESC",
            (account.id,),
        ).fetchall()
    return [_field(row) for row in rows]


@router.post("/me/fields", status_code=status.HTTP_201_CREATED)
def create_field(body: SavedFieldInput, account: CurrentAccount) -> SavedField:
    now = _iso(_now())
    field_id = uuid.uuid4().hex
    with connect() as conn:
        (count,) = conn.execute(
            "SELECT COUNT(*) FROM fields WHERE account_id = ?", (account.id,)
        ).fetchone()
        if count >= MAX_FIELDS:
            raise HTTPException(status.HTTP_409_CONFLICT, "too_many_fields")
        conn.execute(
            """INSERT INTO fields (id, account_id, body, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (field_id, account.id, body.model_dump_json(), now, now),
        )
    return SavedField(id=field_id, created_at=now, updated_at=now, **body.model_dump())


@router.get("/me/fields/{field_id}")
def get_field(field_id: str, account: CurrentAccount) -> SavedField:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM fields WHERE id = ? AND account_id = ?", (field_id, account.id)
        ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field_not_found")
    return _field(row)


@router.put("/me/fields/{field_id}")
def update_field(field_id: str, body: SavedFieldInput, account: CurrentAccount) -> SavedField:
    now = _iso(_now())
    with connect() as conn:
        updated = conn.execute(
            "UPDATE fields SET body = ?, updated_at = ? WHERE id = ? AND account_id = ?",
            (body.model_dump_json(), now, field_id, account.id),
        )
        if updated.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "field_not_found")
        row = conn.execute("SELECT * FROM fields WHERE id = ?", (field_id,)).fetchone()
    return _field(row)


@router.delete("/me/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(field_id: str, account: CurrentAccount) -> None:
    with connect() as conn:
        deleted = conn.execute(
            "DELETE FROM fields WHERE id = ? AND account_id = ?", (field_id, account.id)
        )
    if deleted.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field_not_found")
