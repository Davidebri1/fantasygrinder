"""Golf URLs (admin + REST stub)."""
from django.urls import path

from . import views

app_name = "golf"

urlpatterns = [path("golf/health/", views.health, name="health")]
