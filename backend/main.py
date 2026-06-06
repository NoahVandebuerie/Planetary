import hashlib
import hmac
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATABASE_URL = os.getenv("DATABASE_URL", "")
USE_POSTGRES = bool(DATABASE_URL)
DATABASE_PATH = Path(os.getenv("PLANETARY_DB_PATH", DATA_DIR / "planetary.db"))
SESSION_COOKIE_NAME = "p2p_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
DEFAULT_ROLE = "member"
DEFAULT_EXPERIENCE_KEY = "explorer"
APP_ENV = os.getenv("PLANETARY_ENV", "development").strip().lower()

if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras
    DbIntegrityError = psycopg2.IntegrityError
else:
    DbIntegrityError = sqlite3.IntegrityError


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


SESSION_COOKIE_SECURE = env_flag("PLANETARY_COOKIE_SECURE", APP_ENV == "production")
SESSION_COOKIE_SAMESITE = os.getenv("PLANETARY_COOKIE_SAMESITE", "lax").strip().lower() or "lax"
if SESSION_COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    SESSION_COOKIE_SAMESITE = "lax"


class RegisterPayload(BaseModel):
    username: str
    email: EmailStr
    password: str


class LoginPayload(BaseModel):
    identifier: str
    password: str


class EventLogPayload(BaseModel):
    type: str
    message: str
    detail: str = ""


def _pg_placeholder(sql: str) -> str:
    return sql.replace("?", "%s")


class _CursorWrapper:
    """Wraps a psycopg2 cursor to match sqlite3's connection.execute() return style."""

    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, sql: str, params=None):
        self._cursor.execute(_pg_placeholder(sql), params or ())
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class _PgConnectionWrapper:
    """Wraps a psycopg2 connection to provide the same interface as sqlite3.Connection."""

    def __init__(self, conn):
        self._conn = conn
        self._cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def execute(self, sql: str, params=None):
        wrapper = _CursorWrapper(self._cursor)
        return wrapper.execute(sql, params)

    def commit(self):
        self._conn.commit()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self._conn.commit()
        else:
            self._conn.rollback()
        self._cursor.close()
        self._conn.close()
        return False


def get_db_connection():
    if USE_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL)
        return _PgConnectionWrapper(conn)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_database() -> None:
    if USE_POSTGRES:
        _init_database_pg()
    else:
        _init_database_sqlite()


def _init_database_sqlite() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with get_db_connection() as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                experience_key TEXT NOT NULL DEFAULT 'explorer'
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        connection.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS event_logs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL,
                message TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_event_logs_user_created_at
            ON event_logs(user_id, created_at DESC)
        """)
        connection.commit()


def _init_database_pg() -> None:
    with get_db_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                experience_key TEXT NOT NULL DEFAULT 'explorer'
            )
        """)
        connection.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
            ON users (LOWER(username))
        """)
        connection.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
            ON users (LOWER(email))
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL
            )
        """)
        connection.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS event_logs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                message TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                created_at BIGINT NOT NULL
            )
        """)
        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_event_logs_user_created_at
            ON event_logs(user_id, created_at DESC)
        """)
        connection.commit()


def normalize_username(value: str) -> str:
    return value.strip()


def hash_password(password: str, salt_hex: str) -> str:
    derived = hashlib.scrypt(
        password=password.encode("utf-8"),
        salt=bytes.fromhex(salt_hex),
        n=2**14,
        r=8,
        p=1,
        dklen=64,
    )
    return derived.hex()


def verify_password(password: str, salt_hex: str, expected_hash: str) -> bool:
    actual_hash = hash_password(password, salt_hex)
    return hmac.compare_digest(actual_hash, expected_hash)


def create_session(connection, user_id: str) -> str:
    now = int(time.time())
    token = secrets.token_urlsafe(32)
    connection.execute(
        """
        INSERT INTO sessions (token, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (token, user_id, now, now + SESSION_TTL_SECONDS),
    )
    connection.commit()
    return token


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,
        path="/",
    )


def serialize_user(row) -> dict:
    return {
        "id": row["id"],
        "userId": resolve_public_user_id(row["username"]),
        "username": row["username"],
        "email": row["email"],
        "role": row["role"],
        "experienceKey": row["experience_key"],
    }


def fetch_user_by_id(connection, user_id: str):
    return connection.execute(
        """
        SELECT id, username, email, role, experience_key
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()


def get_user_by_session(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None

    now = int(time.time())
    with get_db_connection() as connection:
        session_row = connection.execute(
            """
            SELECT user_id, expires_at
            FROM sessions
            WHERE token = ?
            """,
            (token,),
        ).fetchone()

        if not session_row:
            return None

        if session_row["expires_at"] <= now:
            connection.execute("DELETE FROM sessions WHERE token = ?", (token,))
            connection.commit()
            return None

        user_row = fetch_user_by_id(connection, session_row["user_id"])

    return serialize_user(user_row) if user_row else None


def make_contact(user_id: str, username: str, online: bool, unread_messages: int, role: str = "member") -> dict:
    return {
        "userId": user_id,
        "username": username,
        "role": role,
        "online": online,
        "unreadMessages": unread_messages,
    }


def make_planet(
    room_id: str,
    room_name: str,
    *,
    is_private: bool = False,
    users: int = 0,
    max_users: int = 4,
    accent_color: str = "#3aa9ff",
    description: str = "",
    status: str = "offline",
    transfer_mode: str = "all",
    allow_chat: bool = True,
    nuke_timer: int | None = None,
) -> dict:
    return {
        "planetId": room_id,
        "roomId": room_id,
        "roomName": room_name,
        "isPrivate": is_private,
        "users": users,
        "maxUsers": max_users,
        "accentColor": accent_color,
        "nukeTimer": nuke_timer,
        "description": description,
        "status": status,
        "transferMode": transfer_mode,
        "allowChat": allow_chat,
    }


def make_saved_planet(room_id: str, room_name: str, *, users: int = 0, max_users: int = 4, status: str = "offline") -> dict:
    return {
        "planetId": room_id,
        "roomId": room_id,
        "roomName": room_name,
        "users": users,
        "maxUsers": max_users,
        "status": status,
    }


def make_message(sender_user_id: str, sender_username: str, text: str) -> dict:
    return {
        "senderUserId": sender_user_id,
        "senderUsername": sender_username,
        "text": text,
        "timestamp": int(time.time() * 1000),
    }


def make_notification(notification_id: int, type_name: str, message: str) -> dict:
    return {
        "id": notification_id,
        "type": type_name,
        "message": message,
    }


def serialize_event_log_row(row) -> dict:
    return {
        "id": row["id"],
        "type": row["type"],
        "message": row["message"],
        "detail": row["detail"],
        "createdAt": row["created_at"],
    }


def insert_event_log(
    connection,
    *,
    user_id: str,
    type_name: str,
    message: str,
    detail: str = "",
    created_at: int | None = None,
) -> dict:
    event_id = str(uuid.uuid4())
    created_at_value = created_at or int(time.time() * 1000)
    normalized_type = (type_name or "UNIVERSE").strip().upper()[:32] or "UNIVERSE"
    normalized_message = (message or "").strip()
    normalized_detail = (detail or "").strip()

    connection.execute(
        """
        INSERT INTO event_logs (id, user_id, type, message, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (event_id, user_id, normalized_type, normalized_message, normalized_detail, created_at_value),
    )
    return {
        "id": event_id,
        "type": normalized_type,
        "message": normalized_message,
        "detail": normalized_detail,
        "createdAt": created_at_value,
    }


def make_directory_user(user_id: str, username: str, role: str, note: str, online: bool) -> dict:
    return {
        "userId": user_id,
        "username": username,
        "role": role,
        "note": note,
        "online": online,
    }


DISCOVER_USERS = [
    make_directory_user("usr_admin", "admin", "admin", "System owner with full control over restricted planets.", True),
    make_directory_user("usr_noah", "noah", "builder", "Product builder focused on creation, testing, and iteration.", True),
    make_directory_user("usr_demo", "demo", "member", "Guided demo account for simple happy-path walkthroughs.", True),
    make_directory_user("usr_ops_bot", "ops-bot", "automation", "Operational notifier for releases and incidents.", False),
    make_directory_user("usr_qa_luna", "qa-luna", "qa", "Quality lead for regression passes and verification sweeps.", False),
    make_directory_user("usr_support_beacon", "support-beacon", "support", "Support contact for new user onboarding and help.", False),
]

DISCOVER_USER_IDS_BY_USERNAME = {
    entry["username"].strip().lower(): entry["userId"]
    for entry in DISCOVER_USERS
}


def resolve_public_user_id(username: str) -> str:
    normalized = username.strip().lower().replace("-", "_")
    return DISCOVER_USER_IDS_BY_USERNAME.get(username.strip().lower(), f"usr_{normalized}")


def build_admin_dashboard() -> dict:
    return {
        "friends": [
            make_contact("usr_noah", "noah", True, 3, "builder"),
            make_contact("usr_demo", "demo", True, 1, "member"),
            make_contact("usr_ops_bot", "ops-bot", False, 0, "automation"),
        ],
        "savedPlanets": [
            make_saved_planet("command-nexus", "Command Nexus"),
            make_saved_planet("security-ring", "Security Ring"),
            make_saved_planet("archive-vault", "Archive Vault"),
        ],
        "allPlanets": [
            make_planet("command-nexus", "Command Nexus", is_private=True, accent_color="#ff7a59", description="Admin control planet for system-wide coordination.", transfer_mode="owner"),
            make_planet("security-ring", "Security Ring", is_private=True, accent_color="#ffb224", description="Restricted operations room for access reviews and incident response.", transfer_mode="owner", allow_chat=False),
            make_planet("archive-vault", "Archive Vault", is_private=True, accent_color="#22d3a6", description="Long-term review planet for historical transfers and audit snapshots."),
            make_planet("incident-bridge", "Incident Bridge", accent_color="#ef4444", description="Fast-response room for outages, hotfix coordination, and rollback plans.", transfer_mode="owner"),
            make_planet("release-yard", "Release Yard", accent_color="#8b5cf6", description="Release staging planet for launch windows and deployment dry runs."),
            make_planet("vendor-dock", "Vendor Dock", accent_color="#06b6d4", description="External collaboration space for partner uploads and procurement handoffs."),
            make_planet("onboarding-bay", "Onboarding Bay", accent_color="#3aa9ff", description="New member entry planet with guided flows and starter documentation."),
            make_planet("quiet-orbit", "Quiet Orbit", accent_color="#64748b", description="Low-traffic planet for focused review sessions and solo verification."),
        ],
        "messages": {
            "usr_noah": [
                make_message("usr_admin", "admin", "Locking Security Ring to owner-only transfers for tonight."),
                make_message("usr_noah", "noah", "Understood. I will keep Builder Hangar public for file rehearsal."),
            ],
            "usr_demo": [
                make_message("usr_demo", "demo", "Can I use the onboarding route for the presentation run?"),
                make_message("usr_admin", "admin", "Yes. Stay on Welcome Orbit and Feedback Bay."),
            ],
        },
        "notifications": [
            make_notification(1, "security", "Security Ring editor list changed. Review before sharing invites."),
            make_notification(2, "planet", "Incident Bridge is queued for tonight's release rehearsal."),
            make_notification(3, "friend", "noah is online and active in Builder Hangar."),
        ],
    }


def build_noah_dashboard() -> dict:
    return {
        "friends": [
            make_contact("usr_admin", "admin", True, 1, "admin"),
            make_contact("usr_demo", "demo", True, 2, "member"),
            make_contact("usr_qa_luna", "qa-luna", False, 0, "qa"),
        ],
        "savedPlanets": [
            make_saved_planet("builder-hangar", "Builder Hangar"),
            make_saved_planet("sprint-lab", "Sprint Lab"),
            make_saved_planet("playtest-orbit", "Playtest Orbit"),
        ],
        "allPlanets": [
            make_planet("builder-hangar", "Builder Hangar", accent_color="#3aa9ff", description="Primary maker planet for prototyping new room flows and upload changes."),
            make_planet("sprint-lab", "Sprint Lab", accent_color="#22d3a6", description="Fast iteration planet for branch demos and daily review checkpoints."),
            make_planet("playtest-orbit", "Playtest Orbit", accent_color="#f97316", description="Safe place to host rough builds and validate transfer behavior with test accounts."),
            make_planet("asset-vault", "Asset Vault", is_private=True, accent_color="#eab308", description="Private planet for design assets, large files, and approval-ready exports."),
            make_planet("community-lounge", "Community Lounge", accent_color="#a855f7", description="Open collaboration planet for light chat and ad hoc demos."),
            make_planet("qa-runway", "QA Runway", accent_color="#14b8a6", description="Pre-release verification planet for edge-case transfers and settings checks."),
            make_planet("shared-lab", "Shared Lab", accent_color="#38bdf8", description="Team planet where admin and noah can co-host larger review sessions."),
            make_planet("midnight-lab", "Midnight Lab", is_private=True, accent_color="#475569", description="After-hours sandbox for risky experiments and cleanup scripts."),
        ],
        "messages": {
            "usr_admin": [
                make_message("usr_admin", "admin", "Use Sprint Lab for today's walkthrough."),
                make_message("usr_noah", "noah", "Will do. I also queued Playtest Orbit for the demo account."),
            ],
            "usr_demo": [
                make_message("usr_demo", "demo", "Which planet should I use for a basic file-share run?"),
                make_message("usr_noah", "noah", "Start with Welcome Orbit, then try Public Sandbox."),
            ],
        },
        "notifications": [
            make_notification(1, "build", "Sprint Lab notes are ready for review."),
            make_notification(2, "planet", "Playtest Orbit is prepared for a fresh walkthrough."),
            make_notification(3, "friend", "demo asked for a beginner-friendly route."),
        ],
    }


def build_demo_dashboard() -> dict:
    return {
        "friends": [
            make_contact("usr_admin", "admin", True, 0, "admin"),
            make_contact("usr_noah", "noah", True, 2, "builder"),
            make_contact("usr_support_beacon", "support-beacon", False, 0, "support"),
        ],
        "savedPlanets": [
            make_saved_planet("welcome-orbit", "Welcome Orbit"),
            make_saved_planet("public-sandbox", "Public Sandbox"),
        ],
        "allPlanets": [
            make_planet("welcome-orbit", "Welcome Orbit", accent_color="#60a5fa", description="Guided first-stop planet for basic room entry, chat, and upload testing."),
            make_planet("public-sandbox", "Public Sandbox", accent_color="#34d399", description="Safe open planet for trying joins, host changes, and multi-user flows."),
            make_planet("guided-tour", "Guided Tour", accent_color="#f59e0b", description="Scenario-driven planet for learning the main controls in order."),
            make_planet("feedback-bay", "Feedback Bay", accent_color="#fb7185", description="Simple room for collecting notes, reactions, and small proof-of-concept transfers."),
            make_planet("file-drop-prime", "File Drop Prime", accent_color="#a78bfa", description="Starter upload planet for validating size limits and transfer prompts."),
            make_planet("team-lounge", "Team Lounge", accent_color="#22c55e", description="Relaxed space to test messages and presence indicators."),
            make_planet("archive-gallery", "Archive Gallery", is_private=True, accent_color="#94a3b8", description="Read-mostly planet showing how private access feels to a non-admin."),
            make_planet("quiet-room", "Quiet Room", accent_color="#64748b", description="Minimal low-noise planet for smoke testing without distractions.", allow_chat=False),
        ],
        "messages": {
            "usr_noah": [
                make_message("usr_noah", "noah", "Use Public Sandbox first, then try creating your own planet."),
                make_message("usr_demo", "demo", "Perfect. I want the simplest happy-path route."),
            ],
            "usr_admin": [
                make_message("usr_admin", "admin", "Welcome Orbit is the cleanest way to test the basics."),
            ],
        },
        "notifications": [
            make_notification(1, "welcome", "Welcome Orbit is configured for first-run testing."),
            make_notification(2, "friend", "noah left notes for your guided route."),
        ],
    }


def build_discover_users(current_user: dict) -> list[dict]:
    current_username = current_user["username"].strip().lower()
    return [
        entry for entry in DISCOVER_USERS
        if entry["username"].strip().lower() != current_username
    ]


def build_discover_planets(dashboard: dict) -> list[dict]:
    seen = set()
    results = []

    for planet in dashboard["allPlanets"]:
        room_id = planet["roomId"]
        if room_id in seen:
            continue
        seen.add(room_id)
        results.append(planet)

    return results


def build_dashboard_payload(user: dict) -> dict:
    username = user["username"].strip().lower()
    role = user.get("role", DEFAULT_ROLE)

    if role == "admin" or username == "admin":
        return build_admin_dashboard()
    if username == "noah":
        return build_noah_dashboard()
    return build_demo_dashboard()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_database()
    yield


app = FastAPI(title="Planetary Auth Backend", lifespan=lifespan)


@app.get("/health")
def healthcheck() -> dict:
    return {
        "ok": True,
        "service": "auth-backend",
        "environment": APP_ENV,
        "database": "postgresql" if USE_POSTGRES else "sqlite",
        "cookie": {
            "name": SESSION_COOKIE_NAME,
            "secure": SESSION_COOKIE_SECURE,
            "sameSite": SESSION_COOKIE_SAMESITE,
        },
    }


@app.post("/api/register")
def register(payload: RegisterPayload, response: Response) -> dict:
    username = normalize_username(payload.username)
    email = payload.email.strip().lower()
    password = payload.password

    if not username or not email or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vul alle velden in.")

    if len(password) < 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Wachtwoord moet minstens 4 tekens hebben.")

    now = int(time.time())
    user_id = str(uuid.uuid4())
    salt_hex = secrets.token_hex(16)
    password_hash = hash_password(password, salt_hex)

    try:
        with get_db_connection() as connection:
            connection.execute(
                """
                INSERT INTO users (
                    id,
                    username,
                    email,
                    password_hash,
                    password_salt,
                    created_at,
                    role,
                    experience_key
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    username,
                    email,
                    password_hash,
                    salt_hex,
                    now,
                    DEFAULT_ROLE,
                    DEFAULT_EXPERIENCE_KEY,
                ),
            )
            token = create_session(connection, user_id)
            user_row = fetch_user_by_id(connection, user_id)
    except DbIntegrityError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Gebruiker bestaat al.") from error

    set_session_cookie(response, token)
    return {"user": serialize_user(user_row)}


@app.post("/api/login")
def login(payload: LoginPayload, response: Response) -> dict:
    identifier = payload.identifier.strip().lower()
    password = payload.password

    if not identifier or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vul alle velden in.")

    with get_db_connection() as connection:
        user_row = connection.execute(
            """
            SELECT id, username, email, password_hash, password_salt, role, experience_key
            FROM users
            WHERE lower(email) = ? OR lower(username) = ?
            LIMIT 1
            """,
            (identifier, identifier),
        ).fetchone()

        if not user_row or not verify_password(password, user_row["password_salt"], user_row["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Onjuiste login.")

        token = create_session(connection, user_row["id"])

    set_session_cookie(response, token)
    return {"user": serialize_user(user_row)}


@app.post("/api/logout")
def logout(request: Request, response: Response) -> dict:
    token = request.cookies.get(SESSION_COOKIE_NAME)

    if token:
        with get_db_connection() as connection:
            connection.execute("DELETE FROM sessions WHERE token = ?", (token,))
            connection.commit()

    clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request) -> dict:
    user = get_user_by_session(request)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Niet ingelogd.")
    return {"user": user}


@app.get("/api/demo/bootstrap")
def demo_bootstrap(request: Request) -> dict:
    user = get_user_by_session(request)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Niet ingelogd.")

    dashboard = build_dashboard_payload(user)
    return {
        "user": user,
        "collections": {
            "contacts": dashboard["friends"],
            "savedPlanets": dashboard["savedPlanets"],
            "planets": dashboard["allPlanets"],
            "conversations": dashboard["messages"],
            "notifications": dashboard["notifications"],
        },
        "directories": {
            "users": build_discover_users(user),
            "planets": build_discover_planets(dashboard),
        },
    }


@app.get("/api/event-log")
def get_event_log(request: Request, limit: int = 40) -> dict:
    user = get_user_by_session(request)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Niet ingelogd.")

    normalized_limit = max(1, min(limit, 100))
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, type, message, detail, created_at
            FROM event_logs
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user["id"], normalized_limit),
        ).fetchall()

    return {"events": [serialize_event_log_row(row) for row in rows]}


@app.post("/api/event-log")
def create_event_log(payload: EventLogPayload, request: Request) -> dict:
    user = get_user_by_session(request)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Niet ingelogd.")

    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bericht is verplicht.")

    with get_db_connection() as connection:
        event = insert_event_log(
            connection,
            user_id=user["id"],
            type_name=payload.type,
            message=message,
            detail=payload.detail,
        )
        connection.commit()

    return {"event": event}
