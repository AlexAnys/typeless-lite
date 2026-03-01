import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const sourceDist = path.join(root, "dist");
const sourceElectron = path.join(root, "electron");
const outDir = path.join(root, ".app-dist");

async function copyDir(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true, force: true });
}

async function assertContains(filePath, needles, hint) {
  const content = await fs.readFile(filePath, "utf8");
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    throw new Error(
      [
        `prepare-app: verification failed for ${filePath}`,
        `Missing markers: ${missing.map((value) => JSON.stringify(value)).join(", ")}`,
        hint
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function run() {
  const rootPackageRaw = await fs.readFile(path.join(root, "package.json"), "utf8");
  const rootPackage = JSON.parse(rootPackageRaw);

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  await copyDir(sourceDist, path.join(outDir, "dist"));
  await copyDir(sourceElectron, path.join(outDir, "electron"));

  const appPackage = {
    name: rootPackage.name,
    version: rootPackage.version,
    description: rootPackage.description,
    productName: "Typeless Lite",
    main: "electron/main.cjs"
  };

  await fs.writeFile(
    path.join(outDir, "package.json"),
    JSON.stringify(appPackage, null, 2),
    "utf8"
  );

  // Guardrail: prevent publishing a ZIP build that accidentally ships without Agent API.
  // (We hit this once: GitHub release ZIP was built from an older main.cjs.)
  await assertContains(
    path.join(outDir, "electron", "main.cjs"),
    ["AGENT_API_DEFAULT_PORT", "startAgentApiServer", "/v1/health"],
    "Hint: ensure you are building from the commit that includes Agent API, then re-run `npm run dist:prepare` / `npm run dist:mac`."
  );

  console.log(`Prepared app bundle at: ${outDir}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
