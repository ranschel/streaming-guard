#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = "127.0.0.1";
const port = Number.parseInt(process.env.STREAMING_GUARD_PORT || "8000", 10);
const defaultAgentModel = "gpt-5.6-terra";
const defaultJudgeModel = "gpt-5.6-luna";
const expectedEvalIds = Object.freeze([
  "EVAL-01",
  "EVAL-02",
  "EVAL-03",
  "EVAL-04",
  "EVAL-05",
  "EVAL-06",
  "EVAL-07",
  "EVAL-08",
  "EVAL-09",
  "EVAL-10"
]);
const blockedTopLevel = new Set([
  ".git",
  ".agents",
  ".codex",
  ".openai",
  "deploy-companion",
  "mockups",
  "sources",
  "todo"
]);
const mimeTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
});
let publishing = false;

function json(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  return origin === `http://${host}:${port}` || origin === `http://localhost:${port}`;
}

function safeStaticPath(urlValue) {
  const pathname = decodeURIComponent(new URL(urlValue, `http://${host}:${port}`).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const segments = relative.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some(segment => segment === ".." || segment.startsWith(".")) ||
    blockedTopLevel.has(segments[0])
  ) {
    return null;
  }
  const target = resolve(root, ...segments);
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  return target;
}

async function readJsonBody(request, maxBytes = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("The evaluation evidence was too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validatePublishPayload(payload) {
  if (!payload || typeof payload !== "object") throw new TypeError("Missing evaluation evidence.");
  if (payload.agentModel !== defaultAgentModel || payload.judgeModel !== defaultJudgeModel) {
    throw new Error(`Publishing requires ${defaultAgentModel} for the agent and ${defaultJudgeModel} for the judge.`);
  }
  if (!/^[a-f0-9]{8}$/i.test(payload.promptHash || "")) {
    throw new Error("The evaluation prompt hash is missing or invalid.");
  }
  const counts = payload.counts || {};
  if (counts.pass !== 10 || counts.fail !== 0 || counts.error !== 0 || counts.not_run !== 0) {
    throw new Error("Publishing requires ten passes with zero failures, errors, or unrun cases.");
  }
  if (!Array.isArray(payload.cases) || payload.cases.length !== expectedEvalIds.length) {
    throw new Error("The evaluation evidence does not contain exactly ten cases.");
  }
  const byId = new Map(payload.cases.map(item => [item.evalId, item]));
  expectedEvalIds.forEach(evalId => {
    const item = byId.get(evalId);
    if (!item || item.verdict !== "pass" || item.promptHash !== payload.promptHash) {
      throw new Error(`${evalId} is missing, failed, or belongs to a different prompt.`);
    }
    if (!item.completedAt || Number.isNaN(Date.parse(item.completedAt))) {
      throw new Error(`${evalId} is missing a completion timestamp.`);
    }
    if (evalId === "EVAL-07") {
      if (item.model !== "deterministic-workflow" || item.judgeModel !== null) {
        throw new Error("EVAL-07 must remain the local no-model workflow case.");
      }
    } else if (item.model !== defaultAgentModel || item.judgeModel !== defaultJudgeModel) {
      throw new Error(`${evalId} did not use both default model roles.`);
    }
    if (!Number.isInteger(item.criteriaCount) || item.criteriaCount < 1 || item.criteriaPassed !== item.criteriaCount) {
      throw new Error(`${evalId} does not show that every deterministic and judge criterion passed.`);
    }
  });
  const completedTimes = payload.cases.map(item => Date.parse(item.completedAt));
  const newest = Math.max(...completedTimes);
  if (Date.now() - newest > 30 * 60 * 1000 || newest - Date.now() > 5 * 60 * 1000) {
    throw new Error("The evaluation evidence is not from the current run.");
  }
  if (typeof payload.exportText !== "string" || payload.exportText.length < 1_000) {
    throw new Error("The complete evaluation export is missing.");
  }
  expectedEvalIds.forEach(evalId => {
    if (!payload.exportText.includes(`## ${evalId}`) || !payload.exportText.includes("Verdict: PASS")) {
      throw new Error(`The complete export is missing passing evidence for ${evalId}.`);
    }
  });
  if (!payload.exportText.includes(`Current prompt hash: ${payload.promptHash}`)) {
    throw new Error("The exported prompt hash does not match the run summary.");
  }
  return payload;
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

async function assertProtectedPrdUnchanged() {
  try {
    await run("git", ["diff", "--quiet", "--", "prd/streaming_guard_prd.md"]);
    await run("git", ["diff", "--cached", "--quiet", "--", "prd/streaming_guard_prd.md"]);
  } catch (_) {
    throw new Error("The protected PRD has uncommitted changes. Publishing stopped.");
  }
}

async function assertNoSecrets() {
  const output = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const files = output.split("\0").filter(Boolean);
  const secretPatterns = [
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    /\bAIza[A-Za-z0-9_-]{30,}\b/,
    /\bgh[opsu]_[A-Za-z0-9]{30,}\b/
  ];
  for (const relative of files) {
    const path = resolve(root, relative);
    if (!existsSync(path) || statSync(path).isDirectory() || statSync(path).size > 5_000_000) continue;
    const content = readFileSync(path, "utf8");
    if (secretPatterns.some(pattern => pattern.test(content))) {
      throw new Error(`A credential-like value was found in ${relative}. Publishing stopped.`);
    }
  }
}

async function publish(payload) {
  await assertProtectedPrdUnchanged();
  await run("git", ["fetch", "origin", "main"]);
  const behind = Number.parseInt(await run("git", ["rev-list", "--count", "HEAD..origin/main"]), 10);
  if (behind > 0) {
    throw new Error("The local branch is behind origin/main. Synchronize it before publishing.");
  }

  await run(process.execPath, ["scripts/build-knowledge.mjs"]);
  await run(process.execPath, ["scripts/verify-keep-only.mjs"]);
  await run(process.execPath, ["scripts/context-search-benchmark.mjs", "--require=95"]);
  await run("git", ["diff", "--check"]);
  await assertNoSecrets();

  writeFileSync(
    resolve(root, "evals/final_evaluation_results.md"),
    `${payload.exportText.trim()}\n`,
    "utf8"
  );
  await run("git", ["diff", "--check"]);
  await assertNoSecrets();
  await run("git", ["add", "-A", "--", "."]);

  let committed = false;
  try {
    await run("git", ["diff", "--cached", "--quiet"]);
  } catch (_) {
    await run("git", [
      "commit",
      "-m",
      `Publish verified 10/10 evaluation (${payload.promptHash})`
    ]);
    committed = true;
  }
  await run("git", ["push", "origin", "main"]);
  const commit = await run("git", ["rev-parse", "--short=8", "HEAD"]);
  return {
    committed,
    commit,
    liveUrl: "https://ranschel.github.io/streaming-guard/",
    message: committed
      ? `Published commit ${commit} after all ten evaluations passed.`
      : `All ten evaluations passed; ${commit} was already published.`
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/__streaming_guard/operator") {
    return json(response, 200, {
      available: true,
      publishing,
      agentModel: defaultAgentModel,
      judgeModel: defaultJudgeModel
    });
  }
  if (request.method === "POST" && url.pathname === "/__streaming_guard/publish") {
    if (!allowedOrigin(request) || request.headers["content-type"] !== "application/json") {
      return json(response, 403, { ok: false, error: "The publish request was not authorized." });
    }
    if (publishing) return json(response, 409, { ok: false, error: "A publish is already in progress." });
    publishing = true;
    try {
      const payload = validatePublishPayload(await readJsonBody(request));
      const result = await publish(payload);
      return json(response, 200, { ok: true, ...result });
    } catch (error) {
      return json(response, 400, { ok: false, error: error.message });
    } finally {
      publishing = false;
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD, POST" });
    return response.end();
  }
  const path = safeStaticPath(request.url);
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  response.writeHead(200, {
    "Cache-Control": "no-cache, must-revalidate",
    "Content-Type": mimeTypes[extname(path).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff"
  });
  if (request.method === "HEAD") return response.end();
  return createReadStream(path).pipe(response);
}

function selfTest() {
  const now = new Date().toISOString();
  const cases = expectedEvalIds.map(evalId => ({
    evalId,
    verdict: "pass",
    promptHash: "1234abcd",
    completedAt: now,
    model: evalId === "EVAL-07" ? "deterministic-workflow" : defaultAgentModel,
    judgeModel: evalId === "EVAL-07" ? null : defaultJudgeModel,
    criteriaCount: 7,
    criteriaPassed: 7
  }));
  const exportText = [
    "# Streaming Guard Evaluation Results",
    "",
    "Current prompt hash: 1234abcd",
    "",
    ...expectedEvalIds.flatMap(evalId => [`## ${evalId}`, "", "Verdict: PASS", "x".repeat(120)])
  ].join("\n");
  const valid = validatePublishPayload({
    agentModel: defaultAgentModel,
    judgeModel: defaultJudgeModel,
    promptHash: "1234abcd",
    counts: { pass: 10, fail: 0, error: 0, not_run: 0 },
    cases,
    exportText
  });
  assert.equal(valid.cases.length, 10);
  assert.throws(
    () => validatePublishPayload({ ...valid, counts: { pass: 9, fail: 1, error: 0, not_run: 0 } }),
    /ten passes/
  );
  assert.equal(safeStaticPath("/index.html"), resolve(root, "index.html"));
  assert.equal(safeStaticPath("/todo/project_time_log.md"), null);
  assert.equal(safeStaticPath("/.git/config"), null);
  console.log("Local eval-and-publish operator self-test passed.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const server = createServer((request, response) => {
    handleRequest(request, response).catch(error => {
      json(response, 500, { ok: false, error: error.message });
    });
  });
  server.listen(port, host, () => {
    console.log(`Streaming Guard local operator: http://${host}:${port}/`);
    console.log("Open Evals and use “Run defaults & publish” or press Command/Ctrl+Shift+E.");
  });
  server.on("error", error => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the existing localhost server and run this shortcut again.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}
