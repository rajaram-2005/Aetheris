# Phase 4 — Agent behavior / failure tests
from aetheris.hermes.self_reflection import SelfReflection
def test_reflect():
    r = SelfReflection()
    assert r.reflect("t","s","e")["step_failed"] == "execution"
