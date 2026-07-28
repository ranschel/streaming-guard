import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "dist");
const serverRoot = path.join(outputRoot, "server");
const publishedRoots = [
  "index.html",
  "README.md",
  "assets",
  "css",
  "data",
  "evals",
  "instructions",
  "js",
  "policies",
  "prd"
];

function filesUnder(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath];
  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .flatMap(entry => filesUnder(path.join(relativePath, entry.name)));
}

const files = publishedRoots.flatMap(filesUnder);
const encodedFiles = Object.fromEntries(files.map(relativePath => [
  `/${relativePath.split(path.sep).join("/")}`,
  fs.readFileSync(path.join(projectRoot, relativePath)).toString("base64")
]));

const worker = `const files = ${JSON.stringify(encodedFiles)};
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png"
};
const revalidateExtensions = new Set([".css", ".csv", ".html", ".js", ".json", ".md"]);

function bytes(base64) {
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (pathname === "/") pathname = "/index.html";
    const content = files[pathname];
    if (!content) return new Response("Not found", { status: 404 });
    const extension = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
    return new Response(bytes(content), {
      headers: {
        "Content-Type": contentTypes[extension] || "application/octet-stream",
        "Cache-Control": revalidateExtensions.has(extension)
          ? "no-cache, must-revalidate"
          : "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      }
    });
  }
};
`;

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(serverRoot, { recursive: true });
fs.writeFileSync(path.join(serverRoot, "index.js"), worker);
console.log(`Prepared ${files.length} published files.`);
