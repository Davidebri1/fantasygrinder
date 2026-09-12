"""MMA URLs (admin + REST stub)."""
from django.urls import path

from . import views

app_name = "mma"

urlpatterns = [path("mma/health/", views.health, name="health")]
