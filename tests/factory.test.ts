import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// --- unit: crypto -------------------------------------------------------------------
test("seal/unseal round-trips and rejects tampering", async () => {
  const { seal, unseal } = await import("../src/lib/crypto");
  const t = seal('{"token":"ghp_x"}');
  assert.equal(unseal(t), '{"token":"ghp_x"}');
  assert.equal(unseal(t.slice(0, -2) + "zz"), null);
});

// --- unit: workflow -----------------------------------------------------------------
test("workflow yaml targets run/** branches and the run dir", async () => {
  const { workflowYaml } = await import("../src/lib/factory/workflow");
  const y = workflowYaml("python", "python -m pytest -q", "runs/abc-demo");
  assert.match(y, /branches: \["run\/\*\*"\]/);
  assert.match(y, /working-directory: runs\/abc-demo/);
  assert.match(y, /setup-python/);
  assert.match(y, /run: "python -m pytest -q"/);
  assert.match(workflowYaml("java", "mvn -q -B test", "x"), /setup-java/);
  assert.match(workflowYaml("node", "node --test", "x"), /setup-node/);
});

// --- integration: pipeline against a mock GitHub + mock provider -------------------
let server: http.Server;
const calls: string[] = [];

before(async () => {
  let pollCount = 0;
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = req.url ?? "";
    calls.push(`${req.method} ${url}`);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // mock LLM (OpenAI-compatible)
    if (url === "/llm/chat/completions") {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const isSummary = body.messages[0].content.includes("reporting the result");
      const content = isSummary
        ? "All **3 tests passed**."
        : JSON.stringify({
            name: "Demo Adder",
            language: "python",
            summary: "adds numbers",
            testCommand: "python -m pytest -q",
            files: [
              { path: "adder.py", content: "def add(a,b):\n    return a+b\n" },
              { path: "test_adder.py", content: "from adder import add\ndef test_add():\n    assert add(1,2)==3\n" },
            ],
          });
      return json(200, { choices: [{ message: { content } }] });
    }

    // mock GitHub
    if (url === "/gh/repos/octo/aetheris-factory" && req.method === "GET") return json(404, { message: "Not Found" });
    if (url === "/gh/user/repos" && req.method === "POST") return json(201, { default_branch: "main", html_url: "https://github.com/octo/aetheris-factory" });
    if (url === "/gh/repos/octo/aetheris-factory/git/ref/heads/main") return json(200, { object: { sha: "base" } });
    if (url === "/gh/repos/octo/aetheris-factory/git/commits/base") return json(200, { tree: { sha: "tree0" } });
    if (url === "/gh/repos/octo/aetheris-factory/git/blobs") return json(201, { sha: "blob" + calls.length });
    if (url === "/gh/repos/octo/aetheris-factory/git/trees") return json(201, { sha: "tree1" });
    if (url === "/gh/repos/octo/aetheris-factory/git/commits" && req.method === "POST") return json(201, { sha: "c0ffee1234", html_url: "https://github.com/octo/aetheris-factory/commit/c0ffee" });
    if (url === "/gh/repos/octo/aetheris-factory/git/refs" && req.method === "POST") return json(201, {});
    if (url.startsWith("/gh/repos/octo/aetheris-factory/actions/runs?")) {
      pollCount++;
      if (pollCount === 1) return json(200, { workflow_runs: [] });
      return json(200, { workflow_runs: [{ id: 42, status: pollCount < 3 ? "in_progress" : "completed", conclusion: pollCount < 3 ? null : "success", html_url: "https://github.com/octo/aetheris-factory/actions/runs/42", head_sha: "c0ffee1234" }] });
    }
    if (url === "/gh/repos/octo/aetheris-factory/actions/runs/42/jobs") return json(200, { jobs: [{ id: 7, name: "test", conclusion: "success" }] });
    if (url === "/gh/repos/octo/aetheris-factory/actions/jobs/7/logs") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("2024-01-01T00:00:00.000Z 3 passed in 0.01s\n");
    }
    json(500, { message: `unmocked ${req.method} ${url}` });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const { PROVIDERS } = await import("../src/lib/router/providers");
  for (const p of PROVIDERS) delete process.env[p.envKey];
  const groq = PROVIDERS.find((p) => p.id === "groq")!;
  groq.baseUrl = `http://127.0.0.1:${port}/llm`;
  process.env.GROQ_API_KEY = "k";

  const api = await import("../src/lib/github/api");
  api.__setApiBase(`http://127.0.0.1:${port}/gh`);
});
after(() => server.close());

test("factory pipeline: generate → commit → wait for CI → logs → report", async () => {
  // speed up polling
  process.env.AETHERIS_CI_POLL_MS = "10";
  const { runFactory } = await import("../src/lib/factory/pipeline");
  const events: unknown[] = [];
  await runFactory({ token: "t", login: "octo" }, "add two numbers", (e) => events.push(e));

  const result = events.find((e) => (e as { type: string }).type === "result") as {
    ok: boolean; report: string; branch: string; files: string[];
  };
  assert.ok(result, "should emit a result");
  assert.equal(result.ok, true);
  assert.match(result.report, /passed/);
  assert.match(result.branch, /^run\//);
  assert.ok(result.files.some((f) => f.endsWith("/adder.py")));

  // exactly one commit + one ref, blobs for 2 files + workflow + AETHERIS.md
  assert.equal(calls.filter((c) => c === "POST /gh/repos/octo/aetheris-factory/git/commits").length, 1);
  assert.equal(calls.filter((c) => c === "POST /gh/repos/octo/aetheris-factory/git/refs").length, 1);
  assert.equal(calls.filter((c) => c === "POST /gh/repos/octo/aetheris-factory/git/blobs").length, 4);
});
