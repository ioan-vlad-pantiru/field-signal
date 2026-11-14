"""Farmer accounts: email + password sign-in and the fields each farmer keeps.

Storage is Postgres when `DATABASE_URL` is set (production: Azure Database for PostgreSQL), else a
local SQLite file at `DATABASE_PATH` (development and tests). The SQL is written once, with `?`
placeholders, and runs on both.

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
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Protocol

import psycopg
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from api.contracts import (
    Account,
    AccountDeletion,
    AccountUpdate,
    PasswordChange,
    SavedField,
    SavedFieldInput,
    SignIn,
    SignUp,
)
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

Row = Mapping[str, Any]
UNIQUE_VIOLATION = (sqlite3.IntegrityError, psycopg.errors.UniqueViolation)

_lock = threading.Lock()
_ready: set[str] = set()
_pools: dict[str, ConnectionPool] = {}


class Result(Protocol):
    rowcount: int

    def fetchone(self) -> Any: ...
    def fetchall(self) -> Any: ...


class Db:
    """The few calls the routes need, the same on SQLite and Postgres."""

    def __init__(self, conn: sqlite3.Connection | psycopg.Connection[Any]) -> None:
        self._conn = conn
        self._postgres = isinstance(conn, psycopg.Connection)

    def execute(self, sql: str, params: Sequence[object] = ()) -> Result:
        if self._postgres:
            sql = sql.replace("?", "%s")
        return self._conn.execute(sql, params)  # type: ignore[return-value]

    def one(self, sql: str, params: Sequence[object] = ()) -> Row | None:
        row: Row | None = self.execute(sql, params).fetchone()
        return row

    def all(self, sql: str, params: Sequence[object] = ()) -> list[Row]:
        return list(self.execute(sql, params).fetchall())


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _statements() -> list[str]:
    return [part.strip() for part in SCHEMA.split(";") if part.strip()]


@contextmanager
def _postgres(url: str) -> Iterator[Db]:
    with _lock:
        pool = _pools.get(url)
        if pool is None:
            pool = ConnectionPool(
                url, min_size=1, max_size=4, kwargs={"row_factory": dict_row}, open=True
            )
            with pool.connection() as setup:
                for statement in _statements():
                    setup.execute(statement)
            _pools[url] = pool
    # Commits on success, rolls back on an exception.
    with pool.connection() as conn:
        yield Db(conn)


@contextmanager
def connect() -> Iterator[Db]:
    """A transaction per block: pooled Postgres, or a short-lived SQLite connection."""
    settings = get_settings()
    if settings.database_url is not None:
        with _postgres(settings.database_url.get_secret_value()) as db:
            yield db
        return
    path = settings.database_path
    # SQLite has one writer; a process lock keeps requests from tripping over each other.
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
                yield Db(conn)
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


def _account(row: Row) -> Account:
    return Account(id=row["id"], email=row["email"], name=row["name"], created_at=row["created_at"])


def _start_session(response: Response, account_id: str) -> None:
    token = secrets.token_urlsafe(32)
    expires = _now() + timedelta(days=SESSION_DAYS)
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(_now()),))
        db.execute(
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
    with connect() as db:
        row = db.execute(
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
        with connect() as db:
            db.execute(
                """INSERT INTO accounts (id, email, name, password_hash, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (account.id, email, name, hash_password(body.password), account.created_at),
            )
    except UNIQUE_VIOLATION as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken") from exc
    _start_session(response, account.id)
    return account


@router.post("/auth/login")
def sign_in(body: SignIn, response: Response) -> Account:
    email = body.email.strip().lower()
    with connect() as db:
        row = db.execute("SELECT * FROM accounts WHERE email = ?", (email,)).fetchone()
    ok = verify_password(body.password, row["password_hash"] if row else _DUMMY_HASH)
    if row is None or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong_credentials")
    _start_session(response, row["id"])
    return _account(row)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(response: Response, fs_session: Annotated[str | None, Cookie()] = None) -> None:
    if fs_session:
        with connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(fs_session),))
    response.delete_cookie(COOKIE, path="/")


@router.get("/auth/me")
def me(account: CurrentAccount) -> Account:
    return account


@router.patch("/auth/me")
def update_me(body: AccountUpdate, account: CurrentAccount) -> Account:
    name = (body.name or "").strip() or None
    with connect() as db:
        db.execute("UPDATE accounts SET name = ? WHERE id = ?", (name, account.id))
    return account.model_copy(update={"name": name})


def _check_password(account_id: str, password: str) -> None:
    with connect() as db:
        row = db.one("SELECT password_hash FROM accounts WHERE id = ?", (account_id,))
    if row is None or not verify_password(password, row["password_hash"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "wrong_password")


@router.post("/auth/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordChange,
    account: CurrentAccount,
    fs_session: Annotated[str | None, Cookie()] = None,
) -> None:
    """Sets a new password and signs out every other device."""
    _check_password(account.id, body.current_password)
    with connect() as db:
        db.execute(
            "UPDATE accounts SET password_hash = ? WHERE id = ?",
            (hash_password(body.new_password), account.id),
        )
        db.execute(
            "DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?",
            (account.id, _token_hash(fs_session or "")),
        )


@router.delete("/auth/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(body: AccountDeletion, account: CurrentAccount, response: Response) -> None:
    """Deletes the account, its fields and its sessions."""
    _check_password(account.id, body.password)
    with connect() as db:
        db.execute("DELETE FROM fields WHERE account_id = ?", (account.id,))
        db.execute("DELETE FROM sessions WHERE account_id = ?", (account.id,))
        db.execute("DELETE FROM accounts WHERE id = ?", (account.id,))
    response.delete_cookie(COOKIE, path="/")


# --------------------------------------------------------------------------- saved fields


def _field(row: Row) -> SavedField:
    body = json.loads(row["body"])
    return SavedField(
        id=row["id"], created_at=row["created_at"], updated_at=row["updated_at"], **body
    )


@router.get("/me/fields")
def list_fields(account: CurrentAccount) -> list[SavedField]:
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM fields WHERE account_id = ? ORDER BY updated_at DESC, created_at DESC",
            (account.id,),
        ).fetchall()
    return [_field(row) for row in rows]


@router.post("/me/fields", status_code=status.HTTP_201_CREATED)
def create_field(body: SavedFieldInput, account: CurrentAccount) -> SavedField:
    now = _iso(_now())
    field_id = uuid.uuid4().hex
    with connect() as db:
        row = db.one("SELECT COUNT(*) AS n FROM fields WHERE account_id = ?", (account.id,))
        if row is not None and row["n"] >= MAX_FIELDS:
            raise HTTPException(status.HTTP_409_CONFLICT, "too_many_fields")
        db.execute(
            """INSERT INTO fields (id, account_id, body, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (field_id, account.id, body.model_dump_json(), now, now),
        )
    return SavedField(id=field_id, created_at=now, updated_at=now, **body.model_dump())


@router.get("/me/fields/{field_id}")
def get_field(field_id: str, account: CurrentAccount) -> SavedField:
    with connect() as db:
        row = db.execute(
            "SELECT * FROM fields WHERE id = ? AND account_id = ?", (field_id, account.id)
        ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field_not_found")
    return _field(row)


@router.put("/me/fields/{field_id}")
def update_field(field_id: str, body: SavedFieldInput, account: CurrentAccount) -> SavedField:
    now = _iso(_now())
    with connect() as db:
        updated = db.execute(
            "UPDATE fields SET body = ?, updated_at = ? WHERE id = ? AND account_id = ?",
            (body.model_dump_json(), now, field_id, account.id),
        )
        if updated.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "field_not_found")
        row = db.execute("SELECT * FROM fields WHERE id = ?", (field_id,)).fetchone()
    return _field(row)


@router.delete("/me/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(field_id: str, account: CurrentAccount) -> None:
    with connect() as db:
        deleted = db.execute(
            "DELETE FROM fields WHERE id = ? AND account_id = ?", (field_id, account.id)
        )
    if deleted.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field_not_found")
