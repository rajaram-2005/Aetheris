"""Knowledge graph and multi-hop Graph RAG.

Aetheris already has BM25 retrieval and signature embeddings. This module is
the next layer: a typed entity-relation graph you can ingest text into,
traverse, and query. It is dependency-free and deterministic.

What it actually does
---------------------
* Extract entities (proper nouns, quoted phrases, known aliases, typed cues).
* Extract relation triples from surface patterns (``X is a Y``, ``X uses Y``, …).
* Store a directed multigraph with typed, weighted edges.
* Multi-hop BFS / shortest path / neighbourhood retrieval for grounding.
* Transitive inference over ``IS_A`` and ``PART_OF``.
* Seed itself with the live Aetheris architecture so the graph is useful
  on a cold start, not an empty store.

This is **not** a trained NER model. Extraction is heuristic. The graph is
honest about that — every edge carries a confidence and a source span.
"""

from __future__ import annotations

import re
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Iterable, Literal

from pydantic import BaseModel, Field

RelationKind = Literal[
    "IS_A",
    "PART_OF",
    "USES",
    "CREATED_BY",
    "DEPENDS_ON",
    "RELATED_TO",
    "IMPLEMENTS",
    "CONTRASTS",
    "LOCATED_IN",
    "HAS",
]

EntityKind = Literal[
    "PERSON",
    "ORG",
    "CONCEPT",
    "TECH",
    "PLACE",
    "ARTIFACT",
    "EVENT",
    "UNKNOWN",
]

_STOP = frozenset(
    """a an the of to is are and or in on for with this that it be by as at from
    these those was were have has had i you your we our their its can will would
    should could do does did not but if then than so just about into over under
    what when where who how why which also into onto among between""".split()
)

_PROPER = re.compile(r"\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,4})\b")
_QUOTED = re.compile(r"[\"“]([^\"”]{2,80})[\"”]")
_CODEISH = re.compile(r"\b([a-z][a-z0-9]+(?:[_-][a-z0-9]+)+)\b")

# ``subject <verb phrase> object`` — object is a proper-noun-ish span.
_REL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("IS_A", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:is|are|was|were)\s+(?:an?\s+|the\s+)?([A-Z][\w .-]{1,48})", re.I)),
    ("PART_OF", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:is|are)\s+(?:part of|a component of|inside)\s+([A-Z][\w .-]{1,48})", re.I)),
    ("USES", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:uses|used|utili[sz]es|powered by|runs on)\s+([A-Z][\w .-]{1,48})", re.I)),
    ("CREATED_BY", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:created by|built by|developed by|authored by)\s+([A-Z][\w .-]{1,48})", re.I)),
    ("DEPENDS_ON", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:depends on|requires|needs|relies on)\s+([A-Z][\w .-]{1,48})", re.I)),
    ("IMPLEMENTS", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:implements|realises|realizes|provides)\s+([A-Z][\w .-]{1,48})", re.I)),
    ("CONTRASTS", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:vs\.?|versus|contrasts with|unlike)\s+([A-Z][\w .-]{1,48})", re.I)),
    ("HAS", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:has|contains|includes|ships)\s+([A-Z][\w .-]{1,48})", re.I)),
    ("LOCATED_IN", re.compile(r"\b([A-Z][\w .-]{1,48}?)\s+(?:in|at|inside)\s+([A-Z][\w .-]{1,48})", re.I)),
)

_TECH_CUES = frozenset(
    "python fastapi hermes nova transformer rag bm25 moe lora kv cache sandbox "
    "api json wasm graphql redis kafka grpc llm gpt agent".split()
)
_ORG_CUES = frozenset("inc ltd llc corp company laboratory labs foundation institute university".split())


# --- Schemas ------------------------------------------------------------------

class EntityIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    kind: EntityKind = "UNKNOWN"
    aliases: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TripleIn(BaseModel):
    subject: str = Field(..., min_length=1, max_length=200)
    relation: RelationKind
    object: str = Field(..., min_length=1, max_length=200)
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)
    source: str = Field(default="")
    evidence: str = Field(default="", max_length=500)


class IngestRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)
    source: str = Field(default="ingest")
    title: str = Field(default="")


class GraphQuery(BaseModel):
    query: str = Field(..., min_length=1, max_length=8_000)
    hops: int = Field(default=2, ge=1, le=6)
    limit: int = Field(default=12, ge=1, le=50)


class PathQuery(BaseModel):
    source: str = Field(..., min_length=1)
    target: str = Field(..., min_length=1)
    max_hops: int = Field(default=5, ge=1, le=8)


# --- Internals ----------------------------------------------------------------

def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())


def _key(name: str) -> str:
    return _norm(name).lower()


def _guess_kind(name: str) -> EntityKind:
    lowered = name.lower()
    tokens = set(re.findall(r"[a-z0-9]+", lowered))
    if tokens & _ORG_CUES:
        return "ORG"
    if tokens & _TECH_CUES or "_" in name or "-" in name:
        return "TECH"
    if name.istitle() and " " in name:
        return "PERSON"
    if name[:1].isupper():
        return "CONCEPT"
    return "UNKNOWN"


def _clean_span(span: str) -> str:
    span = _norm(span)
    span = re.sub(r"^(?:an?|the)\s+", "", span, flags=re.I)
    span = span.strip(" .,;:!?")
    return span


def extract_entities(text: str) -> list[tuple[str, EntityKind, int, int]]:
    """Return ``(name, kind, start, end)`` spans, de-duplicated by key."""
    found: list[tuple[str, EntityKind, int, int]] = []
    seen: set[str] = set()

    def add(name: str, kind: EntityKind, start: int, end: int) -> None:
        cleaned = _clean_span(name)
        if len(cleaned) < 2 or _key(cleaned) in _STOP:
            return
        if cleaned.lower() in _STOP:
            return
        k = _key(cleaned)
        if k in seen:
            return
        seen.add(k)
        found.append((cleaned, kind if kind != "UNKNOWN" else _guess_kind(cleaned), start, end))

    for match in _QUOTED.finditer(text):
        add(match.group(1), "CONCEPT", match.start(1), match.end(1))
    for match in _PROPER.finditer(text):
        name = match.group(1)
        # Skip sentence-initial single words that are just capitalised English.
        if " " not in name and match.start() == 0:
            continue
        add(name, _guess_kind(name), match.start(1), match.end(1))
    for match in _CODEISH.finditer(text):
        add(match.group(1), "TECH", match.start(1), match.end(1))
    return found


def extract_triples(text: str) -> list[tuple[str, RelationKind, str, float, str]]:
    """Return ``(subject, relation, object, confidence, evidence)`` triples."""
    triples: list[tuple[str, RelationKind, str, float, str]] = []
    for relation, pattern in _REL_PATTERNS:
        for match in pattern.finditer(text):
            subj = _clean_span(match.group(1))
            obj = _clean_span(match.group(2))
            if not subj or not obj or _key(subj) == _key(obj):
                continue
            if len(subj) < 2 or len(obj) < 2:
                continue
            evidence = match.group(0).strip()
            # Pattern matches are reasonably precise; LOCATED_IN is noisier.
            confidence = 0.55 if relation == "LOCATED_IN" else 0.78
            triples.append((subj, relation, obj, confidence, evidence[:240]))
    return triples


@dataclass
class _Node:
    id: str
    name: str
    kind: str
    aliases: set[str] = field(default_factory=set)
    metadata: dict[str, Any] = field(default_factory=dict)
    mentions: int = 0
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "aliases": sorted(self.aliases),
            "mentions": self.mentions,
            "metadata": dict(self.metadata),
            "created_at": self.created_at,
        }


@dataclass
class _Edge:
    id: str
    source: str
    target: str
    relation: str
    confidence: float
    source_ref: str
    evidence: str
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "relation": self.relation,
            "confidence": round(self.confidence, 4),
            "source_ref": self.source_ref,
            "evidence": self.evidence,
            "created_at": self.created_at,
        }


# --- Manager ------------------------------------------------------------------

class KnowledgeGraph:
    """Thread-safe typed knowledge graph with multi-hop retrieval."""

    def __init__(self, max_nodes: int = 20_000, max_edges: int = 80_000) -> None:
        self._lock = Lock()
        self._nodes: dict[str, _Node] = {}
        self._by_key: dict[str, str] = {}
        self._edges: dict[str, _Edge] = {}
        self._out: dict[str, list[str]] = defaultdict(list)
        self._in: dict[str, list[str]] = defaultdict(list)
        self._max_nodes = max_nodes
        self._max_edges = max_edges
        self._ingests = 0

    # -- identity -------------------------------------------------------------

    def _resolve_locked(self, name: str) -> str | None:
        return self._by_key.get(_key(name))

    def resolve(self, name: str) -> _Node | None:
        with self._lock:
            nid = self._resolve_locked(name)
            return self._nodes.get(nid) if nid else None

    def _ensure_locked(self, name: str, kind: str = "UNKNOWN", metadata: dict[str, Any] | None = None) -> _Node:
        nid = self._resolve_locked(name)
        if nid:
            node = self._nodes[nid]
            node.mentions += 1
            if kind != "UNKNOWN" and node.kind == "UNKNOWN":
                node.kind = kind
            if metadata:
                node.metadata.update(metadata)
            return node
        if len(self._nodes) >= self._max_nodes:
            oldest = min(self._nodes.values(), key=lambda n: n.created_at)
            self._delete_node_locked(oldest.id)
        node = _Node(
            id=f"ent_{uuid.uuid4().hex[:10]}",
            name=_norm(name),
            kind=kind,
            metadata=dict(metadata or {}),
            mentions=1,
        )
        self._nodes[node.id] = node
        self._by_key[_key(node.name)] = node.id
        return node

    def _delete_node_locked(self, nid: str) -> None:
        node = self._nodes.pop(nid, None)
        if node is None:
            return
        self._by_key.pop(_key(node.name), None)
        for alias in node.aliases:
            self._by_key.pop(_key(alias), None)
        for eid in list(self._out.get(nid, [])) + list(self._in.get(nid, [])):
            self._delete_edge_locked(eid)

    def _delete_edge_locked(self, eid: str) -> None:
        edge = self._edges.pop(eid, None)
        if edge is None:
            return
        if eid in self._out.get(edge.source, []):
            self._out[edge.source].remove(eid)
        if eid in self._in.get(edge.target, []):
            self._in[edge.target].remove(eid)

    # -- mutation -------------------------------------------------------------

    def upsert_entity(self, body: EntityIn) -> _Node:
        with self._lock:
            node = self._ensure_locked(body.name, body.kind, body.metadata)
            for alias in body.aliases:
                cleaned = _clean_span(alias)
                if cleaned:
                    node.aliases.add(cleaned)
                    self._by_key[_key(cleaned)] = node.id
            return node

    def add_triple(self, body: TripleIn) -> _Edge:
        with self._lock:
            src = self._ensure_locked(body.subject)
            dst = self._ensure_locked(body.object)
            # Dedup identical (src, rel, dst).
            for eid in self._out.get(src.id, []):
                existing = self._edges[eid]
                if existing.target == dst.id and existing.relation == body.relation:
                    existing.confidence = max(existing.confidence, body.confidence)
                    if body.evidence and len(body.evidence) > len(existing.evidence):
                        existing.evidence = body.evidence
                    return existing
            if len(self._edges) >= self._max_edges:
                oldest = min(self._edges.values(), key=lambda e: e.created_at)
                self._delete_edge_locked(oldest.id)
            edge = _Edge(
                id=f"rel_{uuid.uuid4().hex[:10]}",
                source=src.id,
                target=dst.id,
                relation=body.relation,
                confidence=body.confidence,
                source_ref=body.source,
                evidence=body.evidence,
            )
            self._edges[edge.id] = edge
            self._out[src.id].append(edge.id)
            self._in[dst.id].append(edge.id)
            return edge

    def ingest(self, text: str, *, source: str = "ingest", title: str = "") -> dict[str, Any]:
        """Extract entities + triples from free text and merge them into the graph."""
        entities = extract_entities(text)
        triples = extract_triples(text)
        added_nodes = 0
        added_edges = 0
        with self._lock:
            self._ingests += 1
            known_before = set(self._nodes)
            for name, kind, _s, _e in entities:
                self._ensure_locked(name, kind, {"source": source, "title": title} if title else {"source": source})
            added_nodes = len(self._nodes) - len(known_before)
        for subj, rel, obj, conf, evidence in triples:
            self.add_triple(
                TripleIn(
                    subject=subj,
                    relation=rel,
                    object=obj,
                    confidence=conf,
                    source=source,
                    evidence=evidence,
                )
            )
            added_edges += 1
        return {
            "source": source,
            "title": title,
            "entities_seen": len(entities),
            "triples_seen": len(triples),
            "nodes_created": added_nodes,
            "edges_created": added_edges,
        }

    # -- traversal ------------------------------------------------------------

    def neighbors(self, name: str, *, hops: int = 1, limit: int = 24) -> list[dict[str, Any]]:
        with self._lock:
            nid = self._resolve_locked(name)
            if not nid:
                return []
            return self._neighborhood_locked(nid, hops=hops, limit=limit)

    def _neighborhood_locked(self, start: str, hops: int, limit: int) -> list[dict[str, Any]]:
        seen: set[str] = {start}
        frontier = deque([(start, 0)])
        out: list[dict[str, Any]] = []
        while frontier and len(out) < limit:
            nid, depth = frontier.popleft()
            if depth >= hops:
                continue
            for eid in self._out.get(nid, []) + self._in.get(nid, []):
                edge = self._edges[eid]
                other = edge.target if edge.source == nid else edge.source
                if other in seen:
                    continue
                seen.add(other)
                node = self._nodes[other]
                direction = "out" if edge.source == nid else "in"
                out.append(
                    {
                        "node": node.to_dict(),
                        "via": edge.to_dict(),
                        "direction": direction,
                        "hops": depth + 1,
                    }
                )
                frontier.append((other, depth + 1))
        return out

    def shortest_path(self, source: str, target: str, *, max_hops: int = 5) -> list[dict[str, Any]] | None:
        with self._lock:
            src = self._resolve_locked(source)
            dst = self._resolve_locked(target)
            if not src or not dst:
                return None
            if src == dst:
                return [{"node": self._nodes[src].to_dict(), "edge": None}]
            prev: dict[str, tuple[str, str]] = {}
            q = deque([src])
            seen = {src}
            found = False
            while q:
                nid = q.popleft()
                node_hops = 0
                walk = nid
                while walk in prev:
                    walk = prev[walk][0]
                    node_hops += 1
                if node_hops >= max_hops:
                    continue
                for eid in self._out.get(nid, []) + self._in.get(nid, []):
                    edge = self._edges[eid]
                    other = edge.target if edge.source == nid else edge.source
                    if other in seen:
                        continue
                    seen.add(other)
                    prev[other] = (nid, eid)
                    if other == dst:
                        found = True
                        q.clear()
                        break
                    q.append(other)
            if not found:
                return None
            chain: list[str] = [dst]
            while chain[-1] != src:
                chain.append(prev[chain[-1]][0])
            chain.reverse()
            path: list[dict[str, Any]] = [{"node": self._nodes[chain[0]].to_dict(), "edge": None}]
            for i in range(1, len(chain)):
                _parent, eid = prev[chain[i]]
                path.append({"node": self._nodes[chain[i]].to_dict(), "edge": self._edges[eid].to_dict()})
            return path

    def infer(self, name: str, *, relation: RelationKind = "IS_A", max_hops: int = 4) -> list[dict[str, Any]]:
        """Follow a relation transitively (``IS_A`` / ``PART_OF`` ancestry)."""
        with self._lock:
            nid = self._resolve_locked(name)
            if not nid:
                return []
            out: list[dict[str, Any]] = []
            seen = {nid}
            frontier = [(nid, 0)]
            while frontier:
                current, depth = frontier.pop()
                if depth >= max_hops:
                    continue
                for eid in self._out.get(current, []):
                    edge = self._edges[eid]
                    if edge.relation != relation or edge.target in seen:
                        continue
                    seen.add(edge.target)
                    out.append({"hops": depth + 1, "via": edge.to_dict(), "node": self._nodes[edge.target].to_dict()})
                    frontier.append((edge.target, depth + 1))
            return out

    def query(self, q: GraphQuery) -> dict[str, Any]:
        """Link entities in the query, then return a scored subgraph + paths."""
        mentions = extract_entities(q.query)
        # Also try raw tokens against aliases.
        tokens = [t for t in re.findall(r"[A-Za-z][A-Za-z0-9_-]+", q.query) if t.lower() not in _STOP]
        linked: list[_Node] = []
        seen_ids: set[str] = set()
        with self._lock:
            for name, _kind, _s, _e in mentions:
                nid = self._resolve_locked(name)
                if nid and nid not in seen_ids:
                    linked.append(self._nodes[nid])
                    seen_ids.add(nid)
            for token in tokens:
                nid = self._resolve_locked(token)
                if nid and nid not in seen_ids:
                    linked.append(self._nodes[nid])
                    seen_ids.add(nid)

            neighbourhood: list[dict[str, Any]] = []
            for node in linked[:8]:
                neighbourhood.extend(self._neighborhood_locked(node.id, hops=q.hops, limit=q.limit))

        paths: list[dict[str, Any]] = []
        if len(linked) >= 2:
            path = self.shortest_path(linked[0].name, linked[1].name, max_hops=q.hops + 1)
            if path:
                paths.append({"from": linked[0].name, "to": linked[1].name, "steps": path})

        # Dedup neighbourhood by node id, keep closest hop.
        best: dict[str, dict[str, Any]] = {}
        for item in neighbourhood:
            nid = item["node"]["id"]
            if nid not in best or item["hops"] < best[nid]["hops"]:
                best[nid] = item

        return {
            "query": q.query,
            "linked": [n.to_dict() for n in linked],
            "neighborhood": list(best.values())[: q.limit],
            "paths": paths,
            "grounding": self._render_grounding(linked, list(best.values())[: q.limit], paths),
        }

    @staticmethod
    def _render_grounding(
        linked: list[_Node], neighborhood: list[dict[str, Any]], paths: list[dict[str, Any]]
    ) -> str:
        if not linked and not neighborhood:
            return ""
        lines: list[str] = []
        if linked:
            lines.append("Linked entities: " + ", ".join(f"{n.name} ({n.kind})" for n in linked[:6]))
        for item in neighborhood[:8]:
            node = item["node"]
            via = item["via"]
            arrow = "→" if item["direction"] == "out" else "←"
            lines.append(f"- {via['relation']} {arrow} {node['name']} ({node['kind']}, hops={item['hops']})")
        for path in paths[:2]:
            names = [step["node"]["name"] for step in path["steps"]]
            lines.append("Path: " + " → ".join(names))
        return "\n".join(lines)

    # -- introspection --------------------------------------------------------

    def get_node(self, node_id: str) -> _Node | None:
        with self._lock:
            return self._nodes.get(node_id) or (
                self._nodes[nid] if (nid := self._resolve_locked(node_id)) else None
            )

    def list_nodes(self, *, kind: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            nodes = list(self._nodes.values())
        if kind:
            nodes = [n for n in nodes if n.kind == kind]
        nodes.sort(key=lambda n: (-n.mentions, n.name.lower()))
        return [n.to_dict() for n in nodes[:limit]]

    def list_edges(self, *, relation: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            edges = list(self._edges.values())
        if relation:
            edges = [e for e in edges if e.relation == relation]
        edges.sort(key=lambda e: -e.confidence)
        return [e.to_dict() for e in edges[:limit]]

    def delete_node(self, name_or_id: str) -> bool:
        with self._lock:
            nid = name_or_id if name_or_id in self._nodes else self._resolve_locked(name_or_id)
            if not nid:
                return False
            self._delete_node_locked(nid)
            return True

    def clear(self) -> dict[str, int]:
        with self._lock:
            n, e = len(self._nodes), len(self._edges)
            self._nodes.clear()
            self._by_key.clear()
            self._edges.clear()
            self._out.clear()
            self._in.clear()
            self._ingests = 0
            return {"nodes": n, "edges": e}

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_kind: dict[str, int] = {}
            by_rel: dict[str, int] = {}
            for n in self._nodes.values():
                by_kind[n.kind] = by_kind.get(n.kind, 0) + 1
            for e in self._edges.values():
                by_rel[e.relation] = by_rel.get(e.relation, 0) + 1
            return {
                "nodes": len(self._nodes),
                "edges": len(self._edges),
                "ingests": self._ingests,
                "by_kind": by_kind,
                "by_relation": by_rel,
            }

    def seed_aetheris(self) -> int:
        """Load a compact map of the running Aetheris architecture."""
        facts: list[tuple[str, RelationKind, str]] = [
            ("Aetheris", "IS_A", "Sovereign AI platform"),
            ("Aetheris", "HAS", "Hermes"),
            ("Aetheris", "HAS", "NOVA"),
            ("Aetheris", "HAS", "Aurion"),
            ("Hermes", "IS_A", "Offline agent"),
            ("Hermes", "USES", "Meta-Learning"),
            ("Hermes", "USES", "Toolbelt"),
            ("Hermes", "USES", "Knowledge corpus"),
            ("Hermes", "IMPLEMENTS", "Plan-act-observe loop"),
            ("Meta-Learning", "IS_A", "Online learner"),
            ("Meta-Learning", "HAS", "Intent priors"),
            ("Meta-Learning", "HAS", "Tool priors"),
            ("Meta-Learning", "HAS", "Few-shot exemplars"),
            ("NOVA", "IS_A", "Architecture layer"),
            ("NOVA", "HAS", "Mixture of Experts"),
            ("NOVA", "HAS", "Hierarchical memory"),
            ("NOVA", "HAS", "Canvas"),
            ("NOVA", "HAS", "Deep research"),
            ("Mixture of Experts", "USES", "Sparse routing"),
            ("Toolbelt", "HAS", "Code sandbox"),
            ("Toolbelt", "HAS", "Document search"),
            ("Toolbelt", "HAS", "Calculator"),
            ("Document search", "IMPLEMENTS", "BM25"),
            ("Code sandbox", "DEPENDS_ON", "Isolated subprocess"),
            ("Aurion", "IS_A", "Web interface"),
            ("Aurion", "USES", "Hermes"),
            ("Knowledge graph", "PART_OF", "Aetheris"),
            ("Knowledge graph", "IMPLEMENTS", "Multi-hop retrieval"),
            ("Constitution", "PART_OF", "Aetheris"),
            ("Constitution", "IMPLEMENTS", "Critique and revise"),
            ("Eval harness", "PART_OF", "Aetheris"),
            ("Semantic cache", "PART_OF", "Aetheris"),
            ("Circuit breaker", "PART_OF", "Aetheris"),
        ]
        before = self.stats()["edges"]
        for subj, rel, obj in facts:
            self.add_triple(TripleIn(subject=subj, relation=rel, object=obj, confidence=0.95, source="seed"))
            # Tag kinds for the well-known nodes.
            self.upsert_entity(EntityIn(name=subj, kind="TECH"))
            self.upsert_entity(EntityIn(name=obj, kind="CONCEPT"))
        return self.stats()["edges"] - before


_graph: KnowledgeGraph | None = None


def get_knowledge_graph() -> KnowledgeGraph:
    global _graph
    if _graph is None:
        _graph = KnowledgeGraph()
        _graph.seed_aetheris()
    return _graph


__all__ = [
    "KnowledgeGraph",
    "EntityIn",
    "TripleIn",
    "IngestRequest",
    "GraphQuery",
    "PathQuery",
    "extract_entities",
    "extract_triples",
    "get_knowledge_graph",
]
