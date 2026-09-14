import sqlite3
from pathlib import Path

import pytest

from db.migrate import migrate


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "reviews.db"
    migrate(path)
    return path


@pytest.fixture()
def conn(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()
