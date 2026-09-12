"""MMA app config."""
from django.apps import AppConfig


class MmaConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.mma"
    label = "mma"
