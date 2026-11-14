import os

# The planner tests pin the mock world model; tests/test_world_model.py covers the trained one.
os.environ.setdefault("PLANNER_WORLD_MODEL", "mock")
