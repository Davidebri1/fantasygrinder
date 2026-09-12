"""NBA URLs — injury + news feeds are mandatory, not optional."""
from django.urls import path

from . import views

app_name = "nba"

urlpatterns = [
    path("nba/health/", views.health, name="health"),
    path("nba/injuries/", views.injuries, name="injuries"),
    path("nba/news/", views.news, name="news"),
]
