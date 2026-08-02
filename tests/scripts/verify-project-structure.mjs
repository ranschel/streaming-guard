import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const checks = [];

function record(name, passed, detail) {
  checks.push({ name, passed, detail });
}

function runBuild(relativePath) {
  return spawnSync(process.execPath, [relativePath], {
    cwd: projectRoot,
    encoding: "utf8"
  });
}

function localTarget(value) {
  if (!value || value.startsWith("#") || /^(?:[a-z]+:|\/\/)/i.test(value)) return null;
  const withoutFragment = value.split("#", 1)[0].split("?", 1)[0];
  return withoutFragment ? decodeURIComponent(withoutFragment) : null;
}

const requiredPaths = [
  "index.html",
  "README.md",
  "assets",
  "build",
  "css",
  "data",
  "deployment",
  "instructions",
  "js",
  "policies",
  "prd",
  "tests"
];
const missingRequired = requiredPaths.filter(relativePath =>
  !fs.existsSync(path.join(projectRoot, relativePath))
);
record(
  "required project structure exists",
  missingRequired.length === 0,
  missingRequired.length ? `Missing: ${missingRequired.join(", ")}` : `${requiredPaths.length} required paths found.`
);

const gitignore = fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8")
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith("#"));
const requiredIgnoreRules = [
  ".env",
  ".env.*",
  "secrets/",
  "credentials*.json",
  "todo/",
  "**/*roadmap*",
  "**/*fast_follow*",
  "**/*fast-follow*",
  "deployment/dist/",
  "tests/reports/*.json",
  "exports/",
  "node_modules/"
];
const missingIgnoreRules = requiredIgnoreRules.filter(rule => !gitignore.includes(rule));
record(
  "private planning, secrets, and generated artifacts are ignored",
  missingIgnoreRules.length === 0,
  missingIgnoreRules.length
    ? `Missing rules: ${missingIgnoreRules.join(", ")}`
    : `${requiredIgnoreRules.length} required ignore boundaries found.`
);

const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const indexReferences = [...indexHtml.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map(match => localTarget(match[1]))
  .filter(Boolean);
const missingIndexReferences = [...new Set(indexReferences)].filter(relativePath =>
  !fs.existsSync(path.join(projectRoot, relativePath))
);
record(
  "browser resource references resolve",
  missingIndexReferences.length === 0,
  missingIndexReferences.length
    ? `Missing: ${missingIndexReferences.join(", ")}`
    : `${new Set(indexReferences).size} local browser resources resolved.`
);

const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
const readmeLinks = [...readme.matchAll(/\]\(([^)]+)\)/g)]
  .map(match => localTarget(match[1].replace(/^<|>$/g, "")))
  .filter(Boolean);
const missingReadmeLinks = [...new Set(readmeLinks)].filter(relativePath =>
  !fs.existsSync(path.join(projectRoot, relativePath))
);
record(
  "README file links resolve",
  missingReadmeLinks.length === 0,
  missingReadmeLinks.length
    ? `Missing: ${missingReadmeLinks.join(", ")}`
    : `${new Set(readmeLinks).size} local documentation links resolved.`
);

const knowledgePath = path.join(projectRoot, "js", "knowledge-base.js");
const knowledgeBefore = fs.readFileSync(knowledgePath);
const knowledgeBuild = runBuild("build/build-knowledge.mjs");
const knowledgeAfter = fs.readFileSync(knowledgePath);
record(
  "generated knowledge matches editable sources",
  knowledgeBuild.status === 0 && knowledgeBefore.equals(knowledgeAfter),
  knowledgeBuild.status !== 0
    ? String(knowledgeBuild.stderr || knowledgeBuild.stdout || "Knowledge build failed.").trim()
    : knowledgeBefore.equals(knowledgeAfter)
      ? "The checked-in browser knowledge bundle is current."
      : "The knowledge build changed js/knowledge-base.js; commit the regenerated artifact."
);

const staticBuild = runBuild("build/build-sites-static.mjs");
const deployBundlePath = path.join(projectRoot, "deployment", "dist", "server", "index.js");
const deployBundle = fs.existsSync(deployBundlePath)
  ? fs.readFileSync(deployBundlePath, "utf8")
  : "";
const forbiddenBundleMarkers = [
  '"/build/',
  '"/deployment/',
  '"/sources/',
  '"/tests/reports/',
  '"/tests/scripts/',
  '"/todo/',
  "/Users/"
];
const leakedMarkers = forbiddenBundleMarkers.filter(marker => deployBundle.includes(marker));
record(
  "public deploy bundle excludes internal files and local paths",
  staticBuild.status === 0 && leakedMarkers.length === 0,
  staticBuild.status !== 0
    ? String(staticBuild.stderr || staticBuild.stdout || "Static build failed.").trim()
    : leakedMarkers.length
      ? `Found forbidden markers: ${leakedMarkers.join(", ")}`
      : "Internal QA, deployment, synchronization, private planning, and machine-local paths are absent."
);

const temporaryNames = new Set([".DS_Store"]);
const temporarySuffixes = [".bak", ".swp", ".tmp", "~"];
const temporaryFiles = [];
function visit(relativeDirectory) {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (relativePath === "sources") continue;
    if (entry.isDirectory()) visit(relativePath);
    else if (temporaryNames.has(entry.name) || temporarySuffixes.some(suffix => entry.name.endsWith(suffix))) {
      temporaryFiles.push(relativePath);
    }
  }
}
visit("");
record(
  "no stray temporary files exist",
  temporaryFiles.length === 0,
  temporaryFiles.length ? `Found: ${temporaryFiles.join(", ")}` : "No temporary or OS metadata files found."
);

const passed = checks.filter(check => check.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  testType: "project_structure_and_publication_boundaries",
  passed,
  total: checks.length,
  successRate: Number(((passed / checks.length) * 100).toFixed(1)),
  checks
};
fs.writeFileSync(
  path.join(projectRoot, "tests", "reports", "project_structure_results.json"),
  `${JSON.stringify(report, null, 2)}\n`
);

checks.forEach(check => console.log(`${check.passed ? "PASS" : "FAIL"} · ${check.name} · ${check.detail}`));
console.log(`Project structure: ${passed}/${checks.length} checks passed.`);
if (passed !== checks.length) process.exitCode = 1;
