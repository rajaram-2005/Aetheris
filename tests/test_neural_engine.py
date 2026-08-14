"""Tests for the Aetheris Custom Neural Model Engine, Benchmarks, LoRA, and Interop."""

import pytest
from fastapi.testclient import TestClient

from aetheris.core.benchmarks import get_benchmark_comparison
from aetheris.core.neural_engine import (
    AETHERIS_FLASH_V2,
    AETHERIS_OMNI_REASONER,
    AETHERIS_PRIME_V4,
    AETHERIS_VISION_V3,
    HERMES_COGNITION_V4,
    AetherisNeuralModelEngine,
    export_huggingface_config,
    export_ollama_modelfile,
    get_neural_engine,
    get_neural_model,
    list_adapters,
    list_custom_models,
    toggle_adapter,
)
from aetheris.core.tiers import get_tier
from aetheris.main import app


def test_custom_models_registry():
    models = list_custom_models()
    assert len(models) >= 5
    ids = [m.id for m in models]
    assert "aetheris-prime-v4" in ids
    assert "aetheris-omni-reasoner" in ids
    assert "aetheris-flash-v2" in ids
    assert "aetheris-vision-v3" in ids
    assert "hermes-cognition-v4" in ids

    # Test alias resolution
    assert get_neural_model("prime-v4").id == "aetheris-prime-v4"
    assert get_neural_model("omni").id == "aetheris-omni-reasoner"
    assert get_neural_model("flash").id == "aetheris-flash-v2"
    assert get_neural_model("vision").id == "aetheris-vision-v3"
    assert get_neural_model("hermes").id == "hermes-cognition-v4"


def test_tier_mapping_uses_sovereign_models():
    lite = get_tier("aetheris-lite")
    pro = get_tier("aetheris-pro")
    ultra = get_tier("aetheris-ultra")

    assert lite.upstream_model == "aetheris-flash-v2"
    assert pro.upstream_model == "aetheris-prime-v4"
    assert ultra.upstream_model == "aetheris-omni-reasoner"

    # Ensure no external mini 4.0 in tier upstream models
    for tier in (lite, pro, ultra):
        assert "mini" not in tier.upstream_model.lower() or "flash" in tier.upstream_model.lower()
        assert "gpt" not in tier.upstream_model.lower()


@pytest.mark.asyncio
async def test_neural_engine_synthesize():
    engine = get_neural_engine("aetheris-prime-v4")
    res = await engine.synthesize("What is Aetheris?", model="aetheris-prime-v4")

    assert "text" in res
    assert len(res["text"]) > 0
    assert res["model"] == "aetheris-prime-v4"
    assert "attention" in res
    assert "attention_entropy" in res["attention"]
    assert "kv_cache" in res


@pytest.mark.asyncio
async def test_neural_engine_stream_tokens():
    engine = get_neural_engine("aetheris-flash-v2")
    chunks = []
    async for chunk in engine.stream_tokens("Hello world from sovereign core"):
        chunks.append(chunk)

    assert len(chunks) > 0
    full_text = "".join(chunks)
    assert len(full_text) > 0


def test_lora_adapters_registry():
    adapters = list_adapters()
    assert len(adapters) >= 4
    adapter_ids = [a["id"] for a in adapters]
    assert "coder-specialist-v4" in adapter_ids
    assert "math-olympiad-v4" in adapter_ids

    # Toggle adapter
    toggle_adapter("math-olympiad-v4", True)
    ad_map = {a["id"]: a["active"] for a in list_adapters()}
    assert ad_map["math-olympiad-v4"] is True


def test_open_source_interop_exports():
    ollama_modelfile = export_ollama_modelfile("aetheris-prime-v4")
    assert "FROM ./aetheris-aetheris-prime-v4.gguf" in ollama_modelfile
    assert "PARAMETER num_ctx 131072" in ollama_modelfile

    hf_config = export_huggingface_config("aetheris-prime-v4")
    assert hf_config["architectures"] == ["AetherisForCausalLM"]
    assert hf_config["hidden_size"] == 4096
    assert hf_config["num_hidden_layers"] == 32


def test_benchmark_suite_comparison():
    comp = get_benchmark_comparison()
    assert "all_models" in comp
    assert len(comp["all_models"]) >= 6
    names = [m["model_id"] for m in comp["all_models"]]
    assert "aetheris-omni-reasoner" in names
    assert "deepseek-r1" in names
    assert "llama-3.3-70b-instruct" in names


def test_api_neural_models_endpoint():
    client = TestClient(app)
    resp = client.get("/v1/neural/models")
    assert resp.status_code == 200
    data = resp.json()
    assert data["zero_external_dependency"] is True
    assert data["count"] >= 5
    model_ids = [m["id"] for m in data["models"]]
    assert "aetheris-prime-v4" in model_ids


def test_api_neural_synthesize_endpoint():
    client = TestClient(app)
    resp = client.post(
        "/v1/neural/synthesize",
        json={"prompt": "Explain quantum computing in one sentence", "model": "aetheris-prime-v4"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "text" in data
    assert data["model"] == "aetheris-prime-v4"


def test_api_benchmarks_endpoint():
    client = TestClient(app)
    resp = client.get("/v1/neural/benchmarks")
    assert resp.status_code == 200
    data = resp.json()
    assert "all_models" in data
    assert len(data["all_models"]) >= 5


def test_api_adapters_endpoints():
    client = TestClient(app)
    resp = client.get("/v1/neural/adapters")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 4

    toggle_resp = client.post("/v1/neural/adapters/coder-specialist-v4/toggle?active=true")
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["active"] is True


def test_api_export_endpoints():
    client = TestClient(app)
    resp_ollama = client.get("/v1/neural/export/ollama/aetheris-prime-v4")
    assert resp_ollama.status_code == 200
    assert "modelfile" in resp_ollama.json()

    resp_hf = client.get("/v1/neural/export/huggingface/aetheris-prime-v4")
    assert resp_hf.status_code == 200
    assert "config" in resp_hf.json()


def test_api_telemetry_endpoint():
    client = TestClient(app)
    resp = client.get("/v1/neural/telemetry")
    assert resp.status_code == 200
    data = resp.json()
    assert "paged_attention" in data
    assert "speculative_decoding" in data
    assert data["speculative_decoding"]["effective_speedup"] == "2.42x"


def test_api_gallery_images_endpoint():
    client = TestClient(app)
    resp = client.get("/v1/gallery/images")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 7
    ids = [img["id"] for img in data["images"]]
    assert "hero-neural-core" in ids
    assert "multi-agent-nexus" in ids
    assert "neural-canvas-synthesis" in ids
    assert "studio-nexus" in ids
