"""reviews / pending_reviews 테이블 마이그레이션.

실행:
    python -m db.migrate
"""

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def migrate(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(schema_sql)
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    from app.config import DB_PATH

    migrate(DB_PATH)
    print(f"[migrate] reviews / pending_reviews 테이블 생성 완료 -> {DB_PATH}")


if __name__ == "__main__":
    main()
