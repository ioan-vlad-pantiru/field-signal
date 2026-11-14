"""The farmer analysis, shared by the web endpoint and the WhatsApp bot."""

from api import mocks
from api.contracts import FieldAnalysis, FieldRequest


def run_field_analysis(request: FieldRequest) -> FieldAnalysis:
    """Currently returns MOCK data (mock=true) shaped like the real response."""
    return mocks.field_analysis(round(request.location.lat, 2), round(request.location.lon, 2))
