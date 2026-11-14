from __future__ import annotations

from api import field_model
from api.contracts import FieldAnalysis, FieldRequest


def run_field_analysis(request: FieldRequest) -> FieldAnalysis:
    """The trained world model's analysis of one field (`api.field_model`); the mock
    (mock=true) when the model's inputs are not deployed or the field is outside the grid."""
    return field_model.run(request)
