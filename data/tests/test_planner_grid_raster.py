"""The planner's grid constants (`api.planner.grid`, no raster in the API image) match the
SoilGrids rasters they were read from. Skipped when no raster is in `data/raw/soilgrids/`."""

from pathlib import Path

import pytest

from api.planner import grid

RASTERS = sorted((Path(__file__).resolve().parents[1] / "raw" / "soilgrids").glob("*.tif"))


@pytest.mark.skipif(not RASTERS, reason="no SoilGrids raster in data/raw/soilgrids/")
def test_grid_matches_soilgrids_raster() -> None:
    rasterio = pytest.importorskip("rasterio")
    with rasterio.open(RASTERS[0]) as src:
        assert src.crs.to_epsg() == 4326
        assert (src.width, src.height) == (grid.COLS, grid.ROWS)
        t = src.transform
        assert (t.a, t.e, t.b, t.d) == pytest.approx((grid.STEP, -grid.STEP, 0, 0))
        assert (t.c, t.f) == pytest.approx((grid.WEST, grid.NORTH))
        for lat, lon in [(46.3011, 23.7513), (45.7512, 21.2304), (47.9003, 27.5021)]:
            x, y = src.xy(*src.index(lon, lat))  # centre of the raster cell holding the point
            assert grid.grid_point(lat, lon) == f"{y:.5f}_{x:.5f}"
