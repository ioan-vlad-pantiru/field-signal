from fastapi.testclient import TestClient

from api.contracts import ImportOrigins
from api.main import app

client = TestClient(app)


def test_origins_served_from_the_build() -> None:
    r = client.get("/v1/sourcing/origins")
    assert r.status_code == 200
    body = ImportOrigins.model_validate(r.json())
    assert body.mock is False
    assert body.crop == "soybean"
    assert {o.id for o in body.origins} == {"ar-core", "br-south", "br-centre", "ua"}


def test_track_records_add_up() -> None:
    body = ImportOrigins.model_validate(client.get("/v1/sourcing/origins").json())
    for o in body.origins:
        judged = [s for s in o.seasons if s.outcome is not None]
        assert o.track.seasons == len(judged)
        assert o.track.caught == sum(s.outcome == "caught" for s in judged)
        assert o.track.false_alarms == sum(s.outcome == "false_alarm" for s in judged)
        assert o.track.bad_seasons == sum(s.outcome in ("caught", "missed") for s in judged)
        # A reading only once the season's deciding weeks have started.
        assert (o.current is None) == (o.stage == "before_window")


def test_argentina_2023_replay_flags_before_the_official_cuts() -> None:
    body = ImportOrigins.model_validate(client.get("/v1/sourcing/origins").json())
    replay = body.replay
    assert replay is not None and replay.origin_id == "ar-core"
    first_high = next(c for c in replay.ours if c.level == "high")
    first_cut = next(e.date for e in replay.official if e.date is not None)
    assert first_high.as_of < first_cut
