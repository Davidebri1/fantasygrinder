#!/usr/bin/env python
"""Django management entrypoint."""
import os
import sys
from pathlib import Path


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore[import-not-found]
        env = Path(__file__).resolve().parent / ".env"
        if env.exists():
            load_dotenv(env)
    except ImportError:
        pass


def main() -> None:
    _load_dotenv()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Did you `pip install -r requirements.txt` "
            "and activate your virtualenv?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
