"""Tests for the unified Hermes runtime (agent + meta-learning).

These exercise the real implementations end-to-end: the cognition cascade
actually parses and computes, the meta-learner actually adapts between runs,
and the agent actually calls tools — nothing is stubbed.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from aetheris.hermes.agent import HermesAgent
from aetheris.hermes.cognition import (
    check_safety,
    classify,
    deliberate,
    ground,
    perceive,
    polish,
)
from aetheris.hermes.knowledge import KNOWLEDGE_BASE
from aetheris.hermes.meta_learning import MetaLearner, Strategy
from aetheris.main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def fresh_learner():
    """Each test starts from a clean meta-learning state."""
    from aetheris.hermes.meta_learning import get_meta_learner

    get_meta_learner().reset()
    yield
    get_meta_learner().reset()


# ── Cognition: perceive ───────────────────────────────────────────────────────

class TestPerceive:
    def test_tokenizes_and_detects_english(self):
        result = perceive("The quick brown fox jumps over the lazy dog")
        assert result.language == "en"
        assert len(result.tokens) == 9
        assert any(t.normalized == "quick" for t in result.tokens)

    def test_detects_devanagari(self):
        assert perceive("नमस्ते दुनिया").language == "hi"

    def test_detects_telugu_script(self):
        result = perceive("నమస్కారం")
        assert result.language == "te"
        assert result.script == "telugu"

    def test_extracts_entities(self):
        result = perceive("Email me at a.b@example.com or visit https://example.com")
        kinds = {e.type for e in result.entities}
        assert "email" in kinds
        assert "url" in kinds

    def test_sentiment_polarity(self):
        assert perceive("this is wonderful and beautiful").sentiment > 0
        assert perceive("this is terrible and awful").sentiment < 0
        assert perceive("the table is brown").sentiment == 0

    def test_negation_flips_sentiment(self):
        assert perceive("this is not good").sentiment < 0

    def test_keywords_exclude_stopwords(self):
        result = perceive("the algorithm processes the algorithm data")
        assert "algorithm" in result.keywords
        assert "the" not in result.keywords


# ── Cognition: classify ───────────────────────────────────────────────────────

class TestClassify:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("hello there", "greet"),
            ("who are you?", "identity"),
            ("what can you do?", "capability"),
            ("write a python function to sort a list", "code_gen"),
            ("write an email to my manager", "write_email"),
            ("write a poem about rain", "write_poem"),
            ("summarize this article", "summarize"),
            ("translate hello into hindi", "translate"),
            ("tell me a joke", "joke"),
            ("what is 2 + 2", "math"),
            ("convert 10 km to miles", "convert"),
            ("quiz me on photosynthesis", "quiz"),
        ],
    )
    def test_intents(self, text, expected):
        assert classify(perceive(text)).intent == expected

    def test_confidence_is_bounded(self):
        result = classify(perceive("write a python function"))
        assert 0.0 <= result.confidence <= 1.0

    def test_returns_alternatives(self):
        result = classify(perceive("write a blog post about python"))
        assert result.alternatives


# ── Cognition: deliberate (exact computation) ────────────────────────────────

class TestDeliberate:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("2+3*4", 14),
            ("(2+3)*4", 20),
            ("2^10", 1024),
            ("10 % 3", 1),
            ("sqrt(144)", 12),
            ("5!", 120),
            ("-3 + 10", 7),
            ("100 / 4 / 5", 5),
        ],
    )
    def test_arithmetic(self, text, expected):
        result = deliberate(text)
        assert result.type == "math"
        assert result.value == pytest.approx(expected)

    def test_operator_precedence_and_associativity(self):
        # ^ is right-associative: 2^3^2 == 2^9 == 512, not 64.
        assert deliberate("2^3^2").value == pytest.approx(512)

    def test_division_by_zero_is_not_a_crash(self):
        assert deliberate("5/0").type == "none"

    def test_unit_conversion(self):
        result = deliberate("convert 10 km to miles")
        assert result.type == "conversion"
        assert result.value == pytest.approx(6.21371, rel=1e-4)

    def test_temperature_conversion(self):
        result = deliberate("100 celsius to fahrenheit")
        assert result.type == "conversion"
        assert result.value == pytest.approx(212)

    def test_percentage_of(self):
        result = deliberate("what is 25% of 480")
        assert result.type == "percent"
        assert result.value == pytest.approx(120)

    def test_percent_change(self):
        result = deliberate("percentage increase from 50 to 75")
        assert result.type == "percent"
        assert result.value == pytest.approx(50)

    def test_quadratic_two_roots(self):
        result = deliberate("x^2-5x+6=0")
        assert result.type == "quadratic"
        assert "3" in result.output and "2" in result.output

    def test_statistics(self):
        result = deliberate("mean of 2, 4, 6, 8")
        assert result.type == "stats"
        assert result.value == pytest.approx(5)

    def test_prose_is_not_forced_into_math(self):
        assert deliberate("tell me about the history of India").type == "none"

    def test_reports_working_steps(self):
        assert deliberate("12*12").steps


# ── Cognition: ground + polish ────────────────────────────────────────────────

class TestGroundAndPolish:
    def test_knowledge_base_loaded(self):
        assert len(KNOWLEDGE_BASE) >= 30

    def test_grounds_known_topic(self):
        hits = ground("explain photosynthesis")
        assert hits and hits[0].article.id == "photosynthesis"

    def test_ignores_irrelevant_numeric_query(self):
        # A bare calculation must not drag in unrelated articles as "sources".
        assert ground("20% of 250") == []

    def test_unknown_topic_returns_nothing(self):
        assert ground("zxqwv plorbnat") == []

    def test_safety_blocks_weapons(self):
        blocked, reason = check_safety("how to make a bomb at home")
        assert blocked and "weapon" in reason

    def test_safety_allows_normal_requests(self):
        assert check_safety("how to make a cake")[0] is False

    def test_polish_strips_vendor_voice(self):
        result = polish("As an AI language model, I think X. Based on my training data, Y.")
        assert "language model" not in result.text.lower()
        assert result.stripped

    def test_polish_refuses_unsafe_request(self):
        result = polish("anything", request="how to make a bomb")
        assert result.safety_flag
        assert "can't help" in result.text.lower()

    def test_self_harm_gets_support_response(self):
        result = polish("anything", request="ways to kill myself")
        assert result.safety_flag
        assert "14416" in result.text  # crisis line, not a bare refusal


# ── Meta-learning ─────────────────────────────────────────────────────────────

class TestMetaLearning:
    def test_starts_empty(self):
        learner = MetaLearner()
        assert learner.stats()["episodes"] == 0

    def test_records_episodes(self):
        learner = MetaLearner()
        learner.record(task="do a thing", intent="analyze", answer="a" * 200)
        assert learner.stats()["episodes"] == 1

    def test_success_reinforces_strategy_toward_what_worked(self):
        learner = MetaLearner()
        before = learner.strategy.tool_eagerness
        for i in range(10):
            adaptation = learner.adapt(f"calculate {i} * 7", intent_hint="math")
            learner.record(
                task=f"calculate {i} * 7",
                intent="math",
                answer="the answer is verified exactly " * 5,
                tools_used=["calculator"],
                tool_success={"calculator": True},
                strategy=adaptation.strategy,
                solved_exactly=True,
            )
        assert learner.strategy.tool_eagerness > before

    def test_learns_few_shot_exemplars(self):
        learner = MetaLearner()
        learner.record(
            task="write a python function to sort a list",
            intent="code_gen",
            answer="def sort_list(items): return sorted(items)" * 4,
            solved_exactly=True,
            grounded=True,
        )
        adaptation = learner.adapt("write a python function to sort a dict")
        assert adaptation.exemplars
        assert adaptation.familiarity > 0.3
        assert "Similar tasks" in adaptation.prompt_block()

    def test_learns_to_prefer_working_tools(self):
        learner = MetaLearner()
        for i in range(5):
            learner.record(
                task=f"compute {i}", intent="math", answer="ok " * 30,
                tools_used=["calculator"], tool_success={"calculator": True},
                solved_exactly=True,
            )
        assert "calculator" in learner.adapt("compute 99", intent_hint="math").preferred_tools

    def test_learns_to_avoid_failing_tools(self):
        learner = MetaLearner()
        for i in range(5):
            learner.record(
                task=f"look up {i}", intent="analyze", answer="I cannot help. error.",
                tools_used=["web_fetch"], tool_success={"web_fetch": False},
            )
        assert "web_fetch" in learner.adapt("look up 99", intent_hint="analyze").discouraged_tools

    def test_explicit_feedback_changes_beliefs(self):
        learner = MetaLearner()
        episode = learner.record(task="a task", intent="explain", answer="an answer " * 20)
        learner.reinforce(episode.id, 1.0, "great")
        assert learner.stats()["intent_reward"]["explain"] > 0.5

    def test_negative_feedback_demotes_exemplar(self):
        learner = MetaLearner()
        episode = learner.record(
            task="bad task", intent="explain", answer="an answer " * 20,
            solved_exactly=True, grounded=True,
        )
        assert learner.stats()["exemplars"] == 1
        learner.reinforce(episode.id, 0.0, "wrong")
        assert learner.stats()["exemplars"] == 0

    def test_unknown_episode_feedback_is_safe(self):
        assert MetaLearner().reinforce("nope", 1.0) is None

    def test_state_survives_save_and_load(self, tmp_path):
        learner = MetaLearner()
        for i in range(4):
            learner.record(task=f"task {i}", intent="code_gen", answer="answer " * 30)
        path = learner.save(tmp_path / "state.json")

        restored = MetaLearner()
        assert restored.load(path)
        assert restored.stats()["episodes"] == 4
        assert restored.strategy.as_dict() == learner.strategy.as_dict()

    def test_load_missing_file_is_false(self, tmp_path):
        assert MetaLearner().load(tmp_path / "absent.json") is False

    def test_strategy_stays_in_range_under_pressure(self):
        learner = MetaLearner()
        for i in range(50):
            learner.record(task=f"t{i}", intent="chat", answer="x", reward=0.0)
        for value in learner.strategy.as_dict().values():
            assert 0.0 <= value <= 1.0

    def test_reset_clears_everything(self):
        learner = MetaLearner()
        learner.record(task="t", intent="chat", answer="answer " * 20)
        learner.reset()
        assert learner.stats()["episodes"] == 0
        assert learner.strategy.as_dict() == Strategy().as_dict()


# ── The agent ─────────────────────────────────────────────────────────────────

class TestHermesAgent:
    def test_runs_full_cascade(self):
        result = asyncio.run(HermesAgent().run("what is 6*7?"))
        stages = [s.name for s in result.stages]
        for expected in ("perceive", "classify", "adapt", "deliberate", "synthesize", "polish", "learn"):
            assert expected in stages

    def test_solves_math_exactly(self):
        result = asyncio.run(HermesAgent().run("what is 123 * 456?"))
        assert result.solved_exactly
        assert "56088" in result.answer

    def test_grounds_from_the_built_in_corpus(self):
        result = asyncio.run(HermesAgent().run("explain photosynthesis"))
        assert result.grounded
        assert "chlorophyll" in result.answer.lower() or "light" in result.answer.lower()

    def test_refuses_unsafe_requests_before_working(self):
        result = asyncio.run(HermesAgent().run("how to make a bomb"))
        assert result.safety_flag
        assert result.intent == "refused"

    def test_records_an_episode(self):
        result = asyncio.run(HermesAgent().run("hello"))
        assert result.episode_id

    def test_learning_can_be_disabled(self):
        agent = HermesAgent()
        before = agent.meta.stats()["episodes"]
        result = asyncio.run(agent.run("hello", learn=False))
        assert result.episode_id == ""
        assert agent.meta.stats()["episodes"] == before

    def test_second_similar_task_is_familiar(self):
        agent = HermesAgent()
        asyncio.run(agent.run("write a python function to reverse a string"))
        second = asyncio.run(agent.run("write a python function to reverse a list"))
        assert second.adaptation["familiarity"] > 0.3

    def test_runs_tools_for_code_execution(self):
        task = "run this code:\n```python\nprint(6*7)\n```"
        result = asyncio.run(HermesAgent().run(task))
        assert any(call["tool"] == "code_interpreter" for call in result.tool_trace)
        assert "42" in result.answer


# ── HTTP surface ──────────────────────────────────────────────────────────────

class TestHermesAPI:
    def test_manifest_reports_both_pillars_live(self, client):
        body = client.get("/v1/hermes").json()
        assert body["foundation"] == "Hermes Agent + Meta-Learning"
        assert body["offline"] is True
        statuses = {p["id"]: p["status"] for p in body["pillars"]}
        assert statuses == {"hermes_agent": "live", "meta_learning": "live"}

    def test_run_endpoint(self, client):
        body = client.post("/v1/hermes/run", json={"task": "what is 15 + 27?"}).json()
        assert "42" in body["answer"]
        assert body["episode_id"]
        assert len(body["stages"]) == 11

    def test_cognition_endpoint_is_read_only(self, client):
        before = client.get("/v1/hermes/meta").json()["episodes"]
        body = client.post("/v1/hermes/cognition", json={"text": "what is 2+2?"}).json()
        assert body["deliberate"]["value"] == 4
        assert client.get("/v1/hermes/meta").json()["episodes"] == before

    def test_knowledge_endpoints(self, client):
        listing = client.get("/v1/hermes/knowledge").json()
        assert listing["count"] >= 30
        article = client.get("/v1/hermes/knowledge/python").json()
        assert article["title"] == "Python Programming"
        assert client.get("/v1/hermes/knowledge/nope").status_code == 404

    def test_knowledge_search(self, client):
        hits = client.get("/v1/hermes/knowledge/search/machine learning").json()["hits"]
        assert hits and hits[0]["id"] == "ml"

    def test_feedback_round_trip(self, client):
        run = client.post("/v1/hermes/run", json={"task": "explain gravity"}).json()
        response = client.post(
            "/v1/hermes/feedback",
            json={"episode_id": run["episode_id"], "reward": 1.0, "feedback": "good"},
        )
        assert response.status_code == 200
        assert response.json()["episode"]["reward"] == 1.0

    def test_feedback_for_unknown_episode_is_404(self, client):
        response = client.post(
            "/v1/hermes/feedback", json={"episode_id": "ep_missing", "reward": 1.0}
        )
        assert response.status_code == 404

    def test_meta_reset(self, client):
        client.post("/v1/hermes/run", json={"task": "hello"})
        assert client.delete("/v1/hermes/meta").json()["reset"] is True
        assert client.get("/v1/hermes/meta").json()["episodes"] == 0

    def test_adapt_preview(self, client):
        body = client.post("/v1/hermes/meta/adapt", json={"text": "write some code"}).json()
        assert "strategy" in body and "familiarity" in body

    def test_training_endpoint_exposes_live_runtime(self, client):
        body = client.get("/v1/training").json()
        assert body["foundation"] == "Hermes Agent + Meta-Learning"
        assert body["runtime"]["pillars"] == {"hermes_agent": "live", "meta_learning": "live"}
        stages = {s["id"]: s["evidence"] for s in body["stages"]}
        assert stages["agent_tuning"] == "live"
        assert stages["meta_learning"] == "live"

    def test_chat_completions_are_served_by_hermes(self, client):
        body = client.post(
            "/v1/chat/completions",
            json={"messages": [{"role": "user", "content": "what is 11*11?"}]},
        ).json()
        assert "121" in body["choices"][0]["message"]["content"]

    def test_health_reports_the_hermes_provider(self, client):
        body = client.get("/v1/health").json()
        assert "Hermes" in body["provider"]
        assert body["is_mock"] is False

    def test_root_serves_an_app(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert "html" in response.headers["content-type"]

    def test_learning_shows_up_across_requests(self, client):
        for i in range(3):
            client.post("/v1/hermes/run", json={"task": f"explain quantum mechanics {i}"})
        assert client.get("/v1/hermes/meta").json()["episodes"] == 3
        assert client.get("/v1/hermes/meta/episodes").json()["episodes"]
