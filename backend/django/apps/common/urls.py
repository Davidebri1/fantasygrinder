"""Common URLs (placeholder, plus OpenAPI mount if needed)."""
from django.urls import path

from . import views

app_name = "common"

urlpatterns = [
    path("health/", views.health, name="health"),
    path("version/", views.version, name="version"),
]
