from backend.app import (
    DATABASE_PATH,
    DEFAULT_EXPERIENCE_KEY,
    get_db_connection,
    hash_password,
    init_database,
    insert_event_log,
)
import secrets
import time
import uuid


SEEDED_USERS = [
    {
        "username": "admin",
        "email": "admin@hotmail.com",
        "password": "root",
        "role": "admin",
        "experience_key": "control",
    },
    {
        "username": "noah",
        "email": "noah@hotmail.com",
        "password": "root",
        "role": "builder",
        "experience_key": "builder",
    },
    {
        "username": "demo",
        "email": "demo@planetary.com",
        "password": "root",
        "role": "member",
        "experience_key": DEFAULT_EXPERIENCE_KEY,
    },
]


def reset_database() -> None:
    if DATABASE_PATH.exists():
        DATABASE_PATH.unlink()
    init_database()


def insert_seed_users() -> None:
    now = int(time.time())
    with get_db_connection() as connection:
        for user in SEEDED_USERS:
            user_id = str(uuid.uuid4())
            salt_hex = secrets.token_hex(16)
            password_hash = hash_password(user["password"], salt_hex)
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
                    user["username"],
                    user["email"],
                    password_hash,
                    salt_hex,
                    now,
                    user["role"],
                    user["experience_key"],
                ),
            )
            insert_event_log(
                connection,
                user_id=user_id,
                type_name="CONNECTED",
                message="User connected to universe",
                detail=f"{user['username']} session ready",
                created_at=now * 1000,
            )
            insert_event_log(
                connection,
                user_id=user_id,
                type_name="UNIVERSE",
                message="Universe console bootstrapped",
                detail="Seeded demo session",
                created_at=(now * 1000) + 1,
            )
        connection.execute("DELETE FROM sessions")
        connection.commit()


def main() -> None:
    reset_database()
    insert_seed_users()
    print("Demo data reset complete.")
    for user in SEEDED_USERS:
        print(f"- {user['username']} | {user['email']} | password: {user['password']} | role: {user['role']}")


if __name__ == "__main__":
    main()
