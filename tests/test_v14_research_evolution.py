"""Tests for Aetheris v0.14.0 Research AI Evolution Engine (50 Research Features 1950-2026).

Covers all 50 milestone research paradigms across 6 major evolutionary eras:
1. Symbolic & Foundational AI (1950–1980s)
2. Statistical Learning & Probabilistic Models (1990s–2000s)
3. Deep Representation Learning Revolution (2010–2017)
4. Transformers, Pre-training & Scaling Frontiers (2018–2022)
5. Direct Alignment, Efficiency & Latent Architecture (2023–2024)
6. Frontier Reasoning, Test-Time Compute & Emergence (2024–2026)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app
from aetheris.core.config import settings
from aetheris.core.research_hub import RESEARCH_REGISTRY, ERAS_METADATA, get_research_hub


@pytest.fixture(autouse=True)
def _reset_limiter():
    from aetheris.core.rate_limiter import get_limiter

    limiter = get_limiter()
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)


client = TestClient(app)


class TestResearchCatalogAndEras:
    """Catalog, filtering, metadata, and configuration tests."""

    def test_total_50_features_registered(self):
        assert len(RESEARCH_REGISTRY) == 50
        assert len(ERAS_METADATA) == 6

    def test_get_catalog_endpoint(self):
        res = client.get("/v1/research/catalog")
        assert res.status_code == 200
        data = res.json()
        assert data["total_features"] == 50
        assert len(data["features"]) == 50
        assert len(data["eras"]) == 6

    def test_filter_by_era(self):
        res = client.get("/v1/research/catalog?era=symbolic_foundations_1950_1980")
        assert res.status_code == 200
        data = res.json()
        assert data["total_features"] == 8
        for f in data["features"]:
            assert f["era"] == "symbolic_foundations_1950_1980"

    def test_filter_by_year_range(self):
        res = client.get("/v1/research/catalog?min_year=2024&max_year=2026")
        assert res.status_code == 200
        data = res.json()
        assert data["total_features"] >= 6
        for f in data["features"]:
            assert 2024 <= f["year"] <= 2026

    def test_get_feature_detail_valid(self):
        res = client.get("/v1/research/features/transformer_mha_2017")
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == "transformer_mha_2017"
        assert "Vaswani" in data["authors"]
        assert "Attention Is All You Need" in data["citation"]
        assert "softmax" in data["mathematical_formula"]
        assert len(data["key_innovations"]) >= 3

    def test_get_feature_detail_not_found(self):
        res = client.get("/v1/research/features/non_existent_feature_123")
        assert res.status_code == 404

    def test_get_eras_breakdown(self):
        res = client.get("/v1/research/eras")
        assert res.status_code == 200
        data = res.json()
        assert len(data["eras"]) == 6
        total_counted = sum(e["feature_count"] for e in data["eras"])
        assert total_counted == 50

    def test_get_timeline_endpoint(self):
        res = client.get("/v1/research/timeline")
        assert res.status_code == 200
        data = res.json()
        assert data["total_events"] == 50
        timeline = data["timeline"]
        assert timeline[0]["year"] == 1950
        assert timeline[0]["feature_id"] == "turing_test_1950"
        assert timeline[-1]["year"] >= 2024

    def test_capabilities_includes_research_evolution(self):
        res = client.get("/v1/capabilities")
        assert res.status_code == 200
        caps = res.json()["capabilities"]
        assert caps["research_evolution"] is True
        assert caps["research_features_count"] == 50

    def test_disabled_feature_flag_returns_403(self):
        prev = settings.research_evolution_enabled
        try:
            settings.research_evolution_enabled = False
            res = client.get("/v1/research/catalog")
            assert res.status_code == 403
        finally:
            settings.research_evolution_enabled = prev

    def test_research_stats(self):
        res = client.get("/v1/research/stats")
        assert res.status_code == 200
        data = res.json()
        assert data["total_features_registered"] == 50
        assert data["total_eras"] == 6


class TestEvolutionSynthesisAndBenchmarks:
    """Multi-paradigm synthesis and comparative benchmark tests."""

    def test_benchmark_representative_set(self):
        res = client.post("/v1/research/benchmark", json={"task": "symbolic_reasoning_bench"})
        assert res.status_code == 200
        data = res.json()
        assert data["tested_count"] >= 8
        assert len(data["rankings"]) >= 8
        assert len(data["paradigm_comparison"]) > 0
        assert data["rankings"][0]["score"] >= data["rankings"][-1]["score"]

    def test_benchmark_custom_features(self):
        custom_ids = ["perceptron_rosenblatt_1958", "transformer_mha_2017", "grpo_deepseek_r1_2025"]
        res = client.post("/v1/research/benchmark", json={"feature_ids": custom_ids, "task": "efficiency"})
        assert res.status_code == 200
        data = res.json()
        assert data["tested_count"] == 3

    def test_evolution_synthesis_all_eras(self):
        prompt = "How can modern language models achieve robust mathematical reasoning with formal correctness?"
        res = client.post("/v1/research/evolution/synthesize", json={"prompt": prompt})
        assert res.status_code == 200
        data = res.json()
        assert len(data["eras_utilized"]) == 6
        assert len(data["contributions"]) == 6
        assert len(data["provenance_chain"]) == 6
        assert data["confidence"] > 0.9
        assert prompt in data["integrated_synthesis"]

    def test_evolution_synthesis_selected_eras(self):
        selected = ["symbolic_foundations_1950_1980", "frontier_reasoning_compute_2024_2026"]
        res = client.post("/v1/research/evolution/synthesize", json={"prompt": "Logic & RL", "selected_eras": selected})
        assert res.status_code == 200
        data = res.json()
        assert len(data["eras_utilized"]) == 2
        assert len(data["contributions"]) == 2


class TestEra1SymbolicFoundations:
    """Era 1: 1950–1980s Research Features."""

    def test_01_turing_test_1950(self):
        res = client.post("/v1/research/features/turing_test_1950/run", json={"parameters": {"turns": 6, "human_likeness": 0.90}})
        assert res.status_code == 200
        d = res.json()
        assert d["status"] == "success"
        assert d["metrics"]["turns_evaluated"] == 6
        assert d["metrics"]["turing_pass"] is True
        assert len(d["artifacts"]["interrogator_log"]) == 6

    def test_02_perceptron_rosenblatt_1958(self):
        res = client.post("/v1/research/features/perceptron_rosenblatt_1958/run", json={"parameters": {"epochs": 15, "learning_rate": 0.2}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["converged"] is True
        assert len(d["metrics"]["final_weights"]) == 3

    def test_03_resolution_refutation_1965(self):
        res = client.post("/v1/research/features/resolution_refutation_1965/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["refutation_succeeded"] is True
        assert d["metrics"]["is_valid_theorem"] is True
        assert len(d["artifacts"]["proof_trace"]) >= 2

    def test_04_eliza_rogerian_1966(self):
        res = client.post("/v1/research/features/eliza_rogerian_1966/run", json={"parameters": {"input": "I am curious about synthetic minds"}})
        assert res.status_code == 200
        d = res.json()
        assert "generated_reflection" in d["artifacts"]
        assert d["metrics"]["rogerian_depth"] > 0.5

    def test_05_mycin_certainty_factors_1976(self):
        res = client.post("/v1/research/features/mycin_certainty_factors_1976/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert 0.0 <= d["metrics"]["combined_certainty_factor"] <= 1.0
        assert d["metrics"]["rule_chains_fired"] == 3

    def test_06_hopfield_associative_memory_1982(self):
        res = client.post("/v1/research/features/hopfield_associative_memory_1982/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert "initial_energy" in d["metrics"]
        assert "converged_energy" in d["metrics"]
        assert len(d["artifacts"]["recalled_pattern"]) == 4

    def test_07_backprop_mlp_1986(self):
        res = client.post("/v1/research/features/backprop_mlp_1986/run", json={"parameters": {"learning_rate": 0.8}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["final_loss"] < d["metrics"]["initial_loss"]
        assert "w1" in d["artifacts"]["updated_weights"]

    def test_08_q_learning_td_1989(self):
        res = client.post("/v1/research/features/q_learning_td_1989/run", json={"parameters": {"episodes": 25}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["optimal_q_val_s0_right"] > 0.0
        assert "S0" in d["artifacts"]["q_table"]


class TestEra2StatisticalLearning:
    """Era 2: 1990s–2000s Research Features."""

    def test_09_svm_kernel_trick_1995(self):
        res = client.post("/v1/research/features/svm_kernel_trick_1995/run", json={"parameters": {"kernel": "rbf", "gamma": 0.8}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["kernel_type"] == "rbf"
        assert d["metrics"]["margin_width"] > 0

    def test_10_lstm_cell_1997(self):
        res = client.post("/v1/research/features/lstm_cell_1997/run", json={"parameters": {"c_prev": 0.6, "x_t": 0.9}})
        assert res.status_code == 200
        d = res.json()
        assert 0.0 <= d["metrics"]["forget_gate_activation"] <= 1.0
        assert "cell_state_c_t" in d["metrics"]

    def test_11_hmm_viterbi_1989(self):
        res = client.post("/v1/research/features/hmm_viterbi_1989/run", json={"parameters": {"observations": ["dry", "rain", "dry"]}})
        assert res.status_code == 200
        d = res.json()
        assert len(d["metrics"]["decoded_hidden_states"]) == 3

    def test_12_lda_topic_model_2003(self):
        res = client.post("/v1/research/features/lda_topic_model_2003/run", json={"parameters": {"num_topics": 4}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["num_topics"] == 4
        assert "Doc_0" in d["artifacts"]["document_topic_matrix"]

    def test_13_random_forest_oob_2001(self):
        res = client.post("/v1/research/features/random_forest_oob_2001/run", json={"parameters": {"n_estimators": 15}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["n_trees"] == 15
        assert len(d["artifacts"]["feature_importance_gini"]) == 8

    def test_14_rbm_contrastive_divergence_2002(self):
        res = client.post("/v1/research/features/rbm_contrastive_divergence_2002/run", json={"parameters": {"k_steps": 2}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["cd_steps"] == 2
        assert "free_energy_difference" in d["metrics"]

    def test_15_gaussian_process_bo_2006(self):
        res = client.post("/v1/research/features/gaussian_process_bo_2006/run", json={"parameters": {"x_query": 0.45}})
        assert res.status_code == 200
        d = res.json()
        assert "posterior_mean_mu" in d["metrics"]
        assert "ucb_acquisition_value" in d["metrics"]

    def test_16_mcts_uct_2006(self):
        res = client.post("/v1/research/features/mcts_uct_2006/run", json={"parameters": {"simulations": 40}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["total_simulations"] == 40
        assert d["metrics"]["best_branch"] in (0, 1, 2)


class TestEra3DeepLearningRevolution:
    """Era 3: 2010–2017 Research Features."""

    def test_17_alexnet_cnn_2012(self):
        res = client.post("/v1/research/features/alexnet_cnn_2012/run", json={"parameters": {"input_size": 224}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["conv1_feature_map_size"] == 55
        assert d["metrics"]["maxpool1_size"] == 27

    def test_18_word2vec_skipgram_2013(self):
        res = client.post("/v1/research/features/word2vec_skipgram_2013/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["target_word_ranked_1"] == "queen"
        assert d["metrics"]["analogy_cosine_similarity"] > 0.8

    def test_19_gan_minimax_2014(self):
        res = client.post("/v1/research/features/gan_minimax_2014/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["nash_equilibrium_reached"] is True
        assert d["metrics"]["discriminator_accuracy"] == 0.5

    def test_20_bahdanau_attention_2014(self):
        res = client.post("/v1/research/features/bahdanau_attention_2014/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["focused_token"] == "syntax"
        assert len(d["artifacts"]["attention_distribution"]) == 5

    def test_21_dqn_experience_replay_2015(self):
        res = client.post("/v1/research/features/dqn_experience_replay_2015/run", json={"parameters": {"buffer_size": 5000}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["replay_buffer_capacity"] == 5000
        assert "bellman_mse_loss" in d["metrics"]

    def test_22_resnet_skip_connection_2015(self):
        res = client.post("/v1/research/features/resnet_skip_connection_2015/run", json={"parameters": {"depth": 101}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["network_depth"] == 101
        assert d["metrics"]["degradation_prevented"] is True

    def test_23_alphago_policy_value_2016(self):
        res = client.post("/v1/research/features/alphago_policy_value_2016/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["combined_node_evaluation"] > 0.7
        assert "decision" in d["artifacts"]

    def test_24_transformer_mha_2017(self):
        res = client.post("/v1/research/features/transformer_mha_2017/run", json={"parameters": {"d_model": 768, "n_heads": 12}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["d_model"] == 768
        assert d["metrics"]["heads_count"] == 12
        assert d["metrics"]["head_dimension_d_k"] == 64


class TestEra4TransformersAndScaling:
    """Era 4: 2018–2022 Research Features."""

    def test_25_bert_masked_lm_2018(self):
        res = client.post("/v1/research/features/bert_masked_lm_2018/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["top_prediction"] == "cat"
        assert d["metrics"]["cross_entropy_mlm_loss"] > 0

    def test_26_gpt_causal_decoder_2018(self):
        res = client.post("/v1/research/features/gpt_causal_decoder_2018/run", json={"parameters": {"temperature": 0.8}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["causal_mask_applied"] is True
        assert "revolutionize" in d["artifacts"]["token_probabilities"]

    def test_27_scaling_laws_chinchilla_2022(self):
        res = client.post("/v1/research/features/scaling_laws_chinchilla_2022/run", json={"parameters": {"parameters_billions": 70, "tokens_billions": 1400}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["chinchilla_optimal"] is True
        assert d["metrics"]["token_to_param_ratio"] == 20.0

    def test_28_clip_dual_encoder_2021(self):
        res = client.post("/v1/research/features/clip_dual_encoder_2021/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert "cat" in d["metrics"]["zero_shot_top_label"]
        assert d["metrics"]["zero_shot_confidence"] > 0.5

    def test_29_ddpm_diffusion_2020(self):
        res = client.post("/v1/research/features/ddpm_diffusion_2020/run", json={"parameters": {"t_sample": 250}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["sample_step_t"] == 250
        assert "signal_to_noise_ratio" in d["metrics"]

    def test_30_rag_hybrid_fusion_2020(self):
        res = client.post("/v1/research/features/rag_hybrid_fusion_2020/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["top_retrieved_passage"] == "doc_mla"
        assert d["metrics"]["grounding_confidence"] > 0.9

    def test_31_rlhf_bradley_terry_2022(self):
        res = client.post("/v1/research/features/rlhf_bradley_terry_2022/run", json={"parameters": {"reward_chosen": 3.0, "reward_rejected": -1.0}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["bradley_terry_p_chosen"] > 0.95
        assert "ppo_net_reward" in d["metrics"]

    def test_32_lora_peft_2021(self):
        res = client.post("/v1/research/features/lora_peft_2021/run", json={"parameters": {"rank": 8}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["parameter_reduction_percent"] > 99.0

    def test_33_flash_attention_tiling_2022(self):
        res = client.post("/v1/research/features/flash_attention_tiling_2022/run", json={"parameters": {"seq_len": 8192}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["io_speedup_factor"] > 10.0
        assert d["metrics"]["exact_numerics"] is True

    def test_34_cot_self_consistency_2022(self):
        res = client.post("/v1/research/features/cot_self_consistency_2022/run", json={"parameters": {"sample_paths": 5}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["majority_consensus_answer"] == "42"
        assert d["metrics"]["consensus_confidence"] == 0.8

    def test_35_react_agent_loop_2022(self):
        res = client.post("/v1/research/features/react_agent_loop_2022/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["autonomous_goal_reached"] is True
        assert len(d["artifacts"]["react_trajectory"]) == 2

    def test_36_moe_sparse_gating_2024(self):
        res = client.post("/v1/research/features/moe_sparse_gating_2024/run", json={"parameters": {"num_experts": 16, "top_k": 2}})
        assert res.status_code == 200
        d = res.json()
        assert len(d["metrics"]["active_routed_experts"]) == 2
        assert len(d["metrics"]["routing_weights"]) == 2


class TestEra5DirectAlignmentAndEfficiency:
    """Era 5: 2023–2024 Research Features."""

    def test_37_dpo_direct_preference_2023(self):
        res = client.post("/v1/research/features/dpo_direct_preference_2023/run", json={"parameters": {"beta": 0.2}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["implicit_margin"] > 0
        assert "dpo_closed_form_loss" in d["metrics"]

    def test_38_speculative_decoding_2023(self):
        res = client.post("/v1/research/features/speculative_decoding_2023/run", json={"parameters": {"k_draft_tokens": 4}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["wall_clock_speedup_ratio"] > 1.5
        assert d["metrics"]["exact_target_distribution_preserved"] is True

    def test_39_mla_latent_attention_2024(self):
        res = client.post("/v1/research/features/mla_latent_attention_2024/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["kv_cache_compression_percent"] > 90.0
        assert d["metrics"]["decoupled_rope_dimension"] == 64

    def test_40_mtp_multi_token_prediction_2024(self):
        res = client.post("/v1/research/features/mtp_multi_token_prediction_2024/run", json={"parameters": {"mtp_heads": 2}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["mtp_heads_count"] == 2
        assert "auxiliary_future_loss" in d["metrics"]

    def test_41_rope_yarn_context_2023(self):
        res = client.post("/v1/research/features/rope_yarn_context_2023/run", json={"parameters": {"target_context": 131072}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["scale_factor_s"] == 32.0
        assert d["metrics"]["yarn_temperature_multiplier"] > 1.0

    def test_42_mamba_selective_ssm_2023(self):
        res = client.post("/v1/research/features/mamba_selective_ssm_2023/run", json={"parameters": {"seq_len": 4096}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["throughput_advantage_factor"] > 10.0

    def test_43_prm_process_supervision_2023(self):
        res = client.post("/v1/research/features/prm_process_supervision_2023/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["steps_scored"] == 3
        assert d["metrics"]["cumulative_path_correctness"] > 0.95

    def test_44_sae_sparse_autoencoder_2023(self):
        res = client.post("/v1/research/features/sae_sparse_autoencoder_2023/run", json={"parameters": {"d_model": 512, "expansion_factor": 16}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["dictionary_features_count"] == 8192
        assert d["metrics"]["sparsity_ratio"] > 0.99

    def test_45_activation_steering_vectors_2023(self):
        res = client.post("/v1/research/features/activation_steering_vectors_2023/run", json={"parameters": {"multiplier": 2.0}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["target_attribute_expression"] == 1.0
        assert d["metrics"]["weight_updates_required"] == 0

    def test_46_rome_knowledge_editing_2022(self):
        res = client.post("/v1/research/features/rome_knowledge_editing_2022/run", json={"parameters": {"subject": "Eiffel Tower", "new_target": "Rome"}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["edit_efficacy"] > 0.95
        assert d["metrics"]["edit_locality_preservation"] > 0.95


class TestEra6FrontierReasoningAndCompute:
    """Era 6: 2024–2026 Research Features."""

    def test_47_grpo_deepseek_r1_2025(self):
        res = client.post("/v1/research/features/grpo_deepseek_r1_2025/run", json={"parameters": {"group_size": 8}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["group_size_G"] == 8
        assert len(d["metrics"]["normalized_advantages"]) == 8
        assert d["metrics"]["emergent_reasoning_length"] > 1000

    def test_48_test_time_compute_scaling_2024(self):
        res = client.post("/v1/research/features/test_time_compute_scaling_2024/run", json={"parameters": {"parallel_samples": 4, "sequential_revisions": 4}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["predicted_task_accuracy"] > 0.95
        assert d["metrics"]["effective_compute_multiplier"] > 10.0

    def test_49_kan_kolmogorov_arnold_2024(self):
        res = client.post("/v1/research/features/kan_kolmogorov_arnold_2024/run", json={"parameters": {"grid_size": 8, "x": 0.5}})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["grid_intervals"] == 8
        assert "symbolic_formula_recovered" in d["metrics"]

    def test_50_pinn_physics_informed_nn_2019(self):
        res = client.post("/v1/research/features/pinn_physics_informed_nn_2019/run", json={})
        assert res.status_code == 200
        d = res.json()
        assert d["metrics"]["pde_target"] == "1D Viscous Burgers' Equation"
        assert d["metrics"]["physics_conservation_satisfied"] is True
        assert "differential_operators" in d["artifacts"]
