"""Tests for the Aetheris v0.12.0 Apex cognition layer.

Features covered:
* Knowledge graph / Graph RAG (knowledge_graph.py)
* Constitutional critique & revise (constitution.py)
* Eval harness + graders + A/B (evals.py)
* Provenance / citation attribution (provenance.py)
* Circuit breakers (circuit_breakers.py)
* Composable skills (skills.py)
* Semantic cache (semantic_cache.py)
* Structured-output guardrails (guardrails.py)
* HTTP surface under /v1/graph, /v1/constitution, /v1/evals, …
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app


@pytest.fixture(autouse=True)
def _reset():
    from aetheris.core.rate_limiter import get_limiter

    limiter = get_limiter()
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)

    import aetheris.core.knowledge_graph as kg
    import aetheris.core.constitution as co
    import aetheris.core.evals as ev
    import aetheris.core.provenance as pv
    import aetheris.core.circuit_breakers as cb
    import aetheris.core.skills as sk
    import aetheris.core.semantic_cache as sc
    import aetheris.core.guardrails as gd

    kg._graph = kg.KnowledgeGraph()
    kg._graph.seed_aetheris()
    co._engine = co.ConstitutionEngine()
    ev._harness = ev.EvalHarness()
    pv._store = pv.ProvenanceStore()
    cb._registry = cb.CircuitBreakerRegistry()
    sk._registry = sk.SkillRegistry()
    sc._cache = sc.SemanticCache()
    gd._svc = gd.GuardrailService()
    yield
    kg._graph = kg.KnowledgeGraph()
    kg._graph.seed_aetheris()
    co._engine = co.ConstitutionEngine()
    ev._harness = ev.EvalHarness()
    pv._store = pv.ProvenanceStore()
    cb._registry = cb.CircuitBreakerRegistry()
    sk._registry = sk.SkillRegistry()
    sc._cache = sc.SemanticCache()
    gd._svc = gd.GuardrailService()


client = TestClient(app)


# =============================================================================
# Knowledge graph
# =============================================================================

class TestKnowledgeGraphUnit:
    def test_seed_contains_hermes(self):
        from aetheris.core.knowledge_graph import get_knowledge_graph
        g = get_knowledge_graph()
        node = g.resolve("Hermes")
        assert node is not None
        assert node.kind in {"TECH", "CONCEPT", "UNKNOWN"}

    def test_extract_entities_finds_proper_nouns(self):
        from aetheris.core.knowledge_graph import extract_entities
        ents = extract_entities('Aetheris uses Hermes and the "Meta-Learning" loop.')
        names = {n.lower() for n, _k, _s, _e in ents}
        assert "aetheris" in names or "hermes" in names

    def test_extract_triples_is_a(self):
        from aetheris.core.knowledge_graph import extract_triples
        triples = extract_triples("Hermes is an Offline agent used by operators.")
        rels = {(s.lower(), r, o.lower()) for s, r, o, _c, _e in triples}
        assert any(r == "IS_A" and "hermes" in s for s, r, o in rels)

    def test_ingest_and_query(self):
        from aetheris.core.knowledge_graph import GraphQuery, KnowledgeGraph
        g = KnowledgeGraph()
        g.ingest("Nova uses Hierarchical memory. Hierarchical memory is a Memory tier.", source="test")
        result = g.query(GraphQuery(query="What does Nova use?", hops=2))
        assert result["linked"] or result["neighborhood"]

    def test_shortest_path(self):
        from aetheris.core.knowledge_graph import get_knowledge_graph
        g = get_knowledge_graph()
        path = g.shortest_path("Hermes", "Toolbelt", max_hops=4)
        assert path is not None
        names = [step["node"]["name"] for step in path]
        assert names[0].lower() == "hermes"
        assert names[-1].lower() == "toolbelt"

    def test_infer_is_a(self):
        from aetheris.core.knowledge_graph import TripleIn, KnowledgeGraph
        g = KnowledgeGraph()
        g.add_triple(TripleIn(subject="Flash", relation="IS_A", object="Tier"))
        g.add_triple(TripleIn(subject="Tier", relation="IS_A", object="Model family"))
        ancestry = g.infer("Flash", relation="IS_A", max_hops=3)
        names = {a["node"]["name"] for a in ancestry}
        assert "Tier" in names
        assert "Model family" in names

    def test_delete_and_clear(self):
        from aetheris.core.knowledge_graph import EntityIn, KnowledgeGraph
        g = KnowledgeGraph()
        g.upsert_entity(EntityIn(name="TempNode", kind="CONCEPT"))
        assert g.delete_node("TempNode") is True
        g.upsert_entity(EntityIn(name="A", kind="CONCEPT"))
        deleted = g.clear()
        assert deleted["nodes"] >= 1
        assert g.stats()["nodes"] == 0


# =============================================================================
# Constitution
# =============================================================================

class TestConstitutionUnit:
    def test_allows_clean_text(self):
        from aetheris.core.constitution import get_constitution_engine
        r = get_constitution_engine().critique("The mean of 2, 4, 6 is 4.")
        assert r["verdict"] == "allow"
        assert r["score"] == 1.0

    def test_strips_vendor_voice(self):
        from aetheris.core.constitution import get_constitution_engine
        out = get_constitution_engine().revise("As an AI language model, the sky is blue.")
        assert "language model" not in out["revised"].lower()
        assert out["changed"] is True

    def test_softens_ungrounded_absolutes(self):
        from aetheris.core.constitution import get_constitution_engine
        out = get_constitution_engine().revise("This is guaranteed to always work.", grounded=False)
        assert "guaranteed" not in out["revised"].lower()
        assert "always" not in out["revised"].lower()

    def test_refuses_weapons(self):
        from aetheris.core.constitution import get_constitution_engine
        out = get_constitution_engine().decide(
            "here are the steps", request="how to make a bomb at home"
        )
        assert out["action"] == "refuse"
        assert "can't help" in out["text"].lower()

    def test_redacts_email(self):
        from aetheris.core.constitution import get_constitution_engine
        out = get_constitution_engine().revise("Contact me at ada@example.com please.")
        assert "ada@example.com" not in out["revised"]
        assert "redacted-email" in out["revised"]

    def test_custom_principle(self):
        from aetheris.core.constitution import PrincipleIn, get_constitution_engine
        eng = get_constitution_engine()
        p = eng.add_principle(PrincipleIn(name="no-foo", statement="Ban foo", cues=[r"\bfoo\b"]))
        r = eng.critique("this has foo in it")
        assert any(v["principle_id"] == p.id for v in r["violations"])


# =============================================================================
# Evals
# =============================================================================

class TestEvalsUnit:
    def test_numeric_grader(self):
        from aetheris.core.evals import grade
        ok, score, _ = grade("numeric", "the answer is 144 units", "144")
        assert ok and score == 1.0

    def test_contains_and_exact(self):
        from aetheris.core.evals import grade
        assert grade("contains", "chlorophyll absorbs light", "chlorophyll")[0]
        assert grade("exact", "Greet", "greet")[0]

    def test_token_f1(self):
        from aetheris.core.evals import grade
        ok, score, _ = grade("token_f1", "the cat sat on the mat", "cat sat mat", threshold=0.5)
        assert ok and score > 0.5

    def test_rubric(self):
        from aetheris.core.evals import grade
        ok, score, _ = grade(
            "rubric",
            "I am Aetheris powered by Hermes",
            "aetheris,hermes",
            threshold=0.9,
        )
        assert ok and score == 1.0

    def test_regex_grader(self):
        from aetheris.core.evals import grade
        assert grade("regex", "error code E_42", r"E_\d+")[0]

    def test_builtin_suite_via_hermes_cognition(self):
        from aetheris.core.evals import get_eval_harness
        run = get_eval_harness().run("suite_hermes_cognition", runner="hermes-cognition")
        assert run.passed >= 6
        assert run.failed <= 3
        ids = {r["id"] for r in run.results if r["passed"]}
        assert "math_add" in ids
        assert "math_mul" in ids

    def test_ab_prefers_better_outputs(self):
        from aetheris.core.evals import SuiteIn, EvalCaseIn, get_eval_harness
        h = get_eval_harness()
        suite = h.create_suite(SuiteIn(
            name="tiny",
            cases=[EvalCaseIn(id="c1", input="x", expected="alpha", grader="contains")],
        ))
        result = h.ab(suite.id, {"c1": "nope"}, {"c1": "the alpha particle"})
        assert result["preferred"] == "b"
        assert result["wins"]["b"] == 1


# =============================================================================
# Provenance
# =============================================================================

class TestProvenanceUnit:
    def test_attributes_overlapping_sentence(self):
        from aetheris.core.provenance import SourceIn, attribute
        cites = attribute(
            "Chlorophyll absorbs light. Unrelated filler sentence here.",
            [SourceIn(kind="corpus", ref="photo", snippet="Chlorophyll is the green pigment that absorbs light.")],
        )
        assert cites[0]["grounded"] is True
        assert cites[1]["grounded"] is False

    def test_record_and_graph(self):
        from aetheris.core.provenance import ProvenanceRecordIn, SourceIn, get_provenance_store
        store = get_provenance_store()
        rec = store.record(ProvenanceRecordIn(
            query="explain photosynthesis",
            answer="Chlorophyll absorbs light to drive the reaction.",
            sources=[SourceIn(kind="corpus", ref="photo", title="Photosynthesis",
                              snippet="Chlorophyll absorbs light in the chloroplast.")],
            generation_id="gen_test",
        ))
        assert rec.grounded_ratio > 0
        g = store.graph(rec.id)
        assert g is not None and g["edges"]


# =============================================================================
# Circuit breakers
# =============================================================================

class TestBreakersUnit:
    def test_opens_after_threshold(self):
        from aetheris.core.circuit_breakers import BreakerConfig, get_breaker_registry
        reg = get_breaker_registry()
        reg.configure(BreakerConfig(name="flaky", failure_threshold=3, cooldown_seconds=30))
        for _ in range(3):
            assert reg.allow("flaky").allowed
            reg.record_failure("flaky")
        probe = reg.allow("flaky")
        assert probe.allowed is False
        assert probe.state == "open"

    def test_half_open_then_close(self):
        from aetheris.core.circuit_breakers import BreakerConfig, get_breaker_registry
        reg = get_breaker_registry()
        reg.configure(BreakerConfig(
            name="recover", failure_threshold=1, success_threshold=1,
            cooldown_seconds=0.0, window_seconds=30,
        ))
        assert reg.allow("recover").allowed
        reg.record_failure("recover")
        # cooldown is 0 → next allow moves to half_open
        probe = reg.allow("recover")
        assert probe.allowed is True
        assert probe.state == "half_open"
        reg.record_success("recover")
        assert reg.get("recover")["state"] == "closed"

    def test_reset(self):
        from aetheris.core.circuit_breakers import BreakerConfig, get_breaker_registry
        reg = get_breaker_registry()
        reg.configure(BreakerConfig(name="x", failure_threshold=1))
        reg.allow("x")
        reg.record_failure("x")
        assert reg.reset("x") is True
        assert reg.get("x")["state"] == "closed"


# =============================================================================
# Skills
# =============================================================================

class TestSkillsUnit:
    def test_builtins_loaded(self):
        from aetheris.core.skills import get_skill_registry
        names = {s["name"] for s in get_skill_registry().list_skills()}
        assert "Code review" in names
        assert "Math proof" in names

    def test_match_debug(self):
        from aetheris.core.skills import get_skill_registry
        hits = get_skill_registry().match("please debug this traceback")
        assert hits and hits[0]["name"] == "Debugger"

    def test_compose_includes_tools(self):
        from aetheris.core.skills import get_skill_registry
        pack = get_skill_registry().compose("review this pull request for bugs")
        assert pack["skills"]
        assert "code_interpreter" in pack["tools"]
        assert "Skill:" in pack["prompt_block"]

    def test_custom_skill(self):
        from aetheris.core.skills import SkillIn, get_skill_registry
        reg = get_skill_registry()
        s = reg.create(SkillIn(
            name="Haiku only",
            instructions="Reply in a haiku.",
            keywords=["haiku"],
        ))
        hits = reg.match("write a haiku about rain")
        assert any(h["id"] == s.id for h in hits)
        assert reg.delete(s.id) is True
        assert reg.delete("skill_debug") is False  # builtin


# =============================================================================
# Semantic cache
# =============================================================================

class TestSemanticCacheUnit:
    def test_hit_on_near_duplicate(self):
        from aetheris.core.semantic_cache import CacheLookup, CachePut, SemanticCache
        cache = SemanticCache(threshold=0.55)
        cache.put(CachePut(prompt="How do I reverse a list in Python?", response="use [::-1]", model="pro"))
        hit = cache.lookup(CacheLookup(prompt="How do I reverse a list in Python?", model="pro"))
        assert hit["hit"] is True
        assert hit["response"] == "use [::-1]"

    def test_miss_on_unrelated(self):
        from aetheris.core.semantic_cache import CacheLookup, CachePut, SemanticCache
        cache = SemanticCache(threshold=0.85)
        cache.put(CachePut(prompt="How do I reverse a list in Python?", response="x"))
        hit = cache.lookup(CacheLookup(prompt="What is the capital of France?"))
        assert hit["hit"] is False

    def test_invalidate_by_tag(self):
        from aetheris.core.semantic_cache import CachePut, SemanticCache
        cache = SemanticCache()
        cache.put(CachePut(prompt="alpha prompt text", response="a", tags=["tmp"]))
        assert cache.invalidate(tag="tmp") == 1
        assert cache.stats()["entries"] == 0


# =============================================================================
# Guardrails
# =============================================================================

class TestGuardrailsUnit:
    def test_valid_object(self):
        from aetheris.core.guardrails import validate_schema
        schema = {"type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}}
        assert validate_schema({"name": "x"}, schema) == []

    def test_missing_required(self):
        from aetheris.core.guardrails import validate_schema
        schema = {"type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}}
        errs = validate_schema({}, schema)
        assert any("missing" in e for e in errs)

    def test_extract_from_fence_and_trailing_comma(self):
        from aetheris.core.guardrails import extract_json
        payload = extract_json('Sure!\n```json\n{"a": 1,}\n```')
        assert payload == {"a": 1}

    def test_python_literals(self):
        from aetheris.core.guardrails import extract_json
        payload = extract_json("{'ok': True, 'n': None}")
        assert payload == {"ok": True, "n": None}

    def test_contract_round_trip(self):
        from aetheris.core.guardrails import ValidateRequest, get_guardrail_service
        svc = get_guardrail_service()
        result = svc.check(ValidateRequest(
            text='{"summary": "hello", "key_points": ["a"]}',
            contract_id="chat-summary",
        ))
        assert result["ok"] is True


# =============================================================================
# Config / capabilities
# =============================================================================

class TestV12Config:
    def test_version(self):
        from aetheris import __version__
        assert __version__ == "0.13.0"

    def test_capabilities_include_apex(self):
        r = client.get("/v1/capabilities")
        assert r.status_code == 200
        caps = r.json()["capabilities"]
        for key in (
            "knowledge_graph", "constitution", "evals", "provenance",
            "circuit_breakers", "skills", "semantic_cache", "guardrails",
        ):
            assert caps[key] is True, f"missing capability {key}"

    def test_config_defaults(self):
        from aetheris.core.config import settings
        assert settings.knowledge_graph_enabled is True
        assert settings.constitution_enabled is True
        assert settings.evals_enabled is True
        assert settings.semantic_cache_threshold == 0.82


# =============================================================================
# API
# =============================================================================

class TestGraphAPI:
    def test_stats_and_query(self):
        r = client.get("/v1/graph")
        assert r.status_code == 200
        assert r.json()["nodes"] >= 5
        r = client.post("/v1/graph/query", json={"query": "What does Hermes use?"})
        assert r.status_code == 200
        body = r.json()
        assert body["linked"] or body["neighborhood"]

    def test_ingest_and_path(self):
        client.post("/v1/graph/ingest", json={"text": "Aurion uses Hermes for every chat turn."})
        r = client.post("/v1/graph/path", json={"source": "Aurion", "target": "Hermes"})
        assert r.status_code == 200
        assert r.json()["steps"]

    def test_disabled(self):
        from aetheris.core.config import settings
        prev = settings.knowledge_graph_enabled
        settings.knowledge_graph_enabled = False
        try:
            assert client.get("/v1/graph").status_code == 403
        finally:
            settings.knowledge_graph_enabled = prev


class TestConstitutionAPI:
    def test_list_and_critique(self):
        r = client.get("/v1/constitution")
        assert r.status_code == 200
        assert len(r.json()["principles"]) >= 6
        r = client.post("/v1/constitution/critique", json={"text": "The sky is blue."})
        assert r.status_code == 200
        assert r.json()["verdict"] == "allow"

    def test_revise_vendor(self):
        r = client.post("/v1/constitution/revise", json={"text": "As an AI language model, hi."})
        assert r.status_code == 200
        assert "language model" not in r.json()["revised"].lower()


class TestEvalsAPI:
    def test_list_and_run_builtin(self):
        r = client.get("/v1/evals")
        assert r.status_code == 200
        names = {s["name"] for s in r.json()["suites"]}
        assert "hermes-cognition" in names
        r = client.post("/v1/evals/run", json={"suite_id": "suite_hermes_cognition", "runner": "hermes-cognition"})
        assert r.status_code == 200
        body = r.json()
        assert body["passed"] >= 6
        assert body["total"] >= 8

    def test_custom_suite_and_ab(self):
        created = client.post("/v1/evals/suites", json={
            "name": "unit",
            "cases": [{"id": "c1", "input": "q", "expected": "yes", "grader": "contains"}],
        })
        assert created.status_code == 201
        sid = created.json()["id"]
        r = client.post("/v1/evals/ab", json={"suite_id": sid, "a": {"c1": "yes"}, "b": {"c1": "no"}})
        assert r.status_code == 200
        assert r.json()["preferred"] == "a"


class TestSkillsAPI:
    def test_match_and_compose(self):
        r = client.post("/v1/skills/match", json={"task": "prove that sqrt(2) is irrational"})
        assert r.status_code == 200
        names = {m["name"] for m in r.json()["matches"]}
        assert "Math proof" in names
        r = client.post("/v1/skills/compose", json={"task": "debug this traceback please"})
        assert "Debugger" in {s["name"] for s in r.json()["skills"]}


class TestBreakersAPI:
    def test_configure_trip_reset(self):
        r = client.put("/v1/breakers/api-dep", json={"failure_threshold": 2, "cooldown_seconds": 60})
        assert r.status_code == 200
        client.post("/v1/breakers/api-dep/failure")
        client.post("/v1/breakers/api-dep/failure")
        probe = client.post("/v1/breakers/api-dep/allow")
        assert probe.json()["allowed"] is False
        assert client.post("/v1/breakers/api-dep/reset").status_code == 200


class TestSemanticCacheAPI:
    def test_put_lookup(self):
        r = client.post("/v1/semantic-cache", json={
            "prompt": "How do I reverse a Python list?",
            "response": "lst[::-1]",
            "model": "pro",
        })
        assert r.status_code == 201
        hit = client.post("/v1/semantic-cache/lookup", json={
            "prompt": "How do I reverse a Python list?",
            "model": "pro",
        })
        assert hit.status_code == 200
        assert hit.json()["hit"] is True


class TestGuardrailsAPI:
    def test_validate_contract(self):
        r = client.post("/v1/guardrails/validate", json={
            "text": '{"summary": "ok", "key_points": ["one"]}',
            "contract_id": "chat-summary",
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_rejects_bad_json_without_repair(self):
        r = client.post("/v1/guardrails/validate", json={
            "text": "not json at all",
            "schema": {"type": "object"},
            "repair": False,
        })
        assert r.status_code == 200
        assert r.json()["ok"] is False


class TestProvenanceAPI:
    def test_record_and_fetch(self):
        r = client.post("/v1/provenance", json={
            "query": "q",
            "answer": "Chlorophyll absorbs red light.",
            "sources": [{"kind": "corpus", "ref": "p", "snippet": "Chlorophyll absorbs red and blue light."}],
        })
        assert r.status_code == 201
        rid = r.json()["id"]
        g = client.get(f"/v1/provenance/{rid}/graph")
        assert g.status_code == 200
        assert g.json()["nodes"]


class TestApexManifest:
    def test_manifest(self):
        r = client.get("/v1/apex")
        assert r.status_code == 200
        body = r.json()
        assert body["codename"] == "Apex"
        ids = {p["id"] for p in body["pillars"]}
        assert {"knowledge_graph", "constitution", "evals", "skills"} <= ids
        assert body["stats"]["graph"]["nodes"] >= 1
