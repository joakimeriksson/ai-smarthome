import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from zencore import Schema  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"


def corpus_files():
    """Every real .svz we test against. Add new captures here."""
    return sorted(DATA.glob("*.svz"))


@pytest.fixture(scope="session")
def schema():
    return Schema.load(ROOT / "zcformat.json")


@pytest.fixture(params=corpus_files(), ids=lambda p: p.name)
def svz_path(request):
    return request.param


def pytest_collection_modifyitems(config, items):
    if not corpus_files():
        pytest.exit(
            "tests/data/ has no .svz files - the corpus is what makes these "
            "tests meaningful. See CLAUDE.md.",
            returncode=1,
        )
