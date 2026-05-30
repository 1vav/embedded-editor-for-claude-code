// embedded-editor doctor — diagnose version drift across nvm Node installs and
// per-project .claude/launch.json files. Surfaces the kind of stale-binary
// problem that bit us when nvm v20 had v1.2.0 installed while nvm v22 had
// v1.5.2: the project's launch.json pinned the v20 absolute path, so Claude
// kept spawning the old binary on every chat start.
//
// Usage:
//   embedded-editor doctor          → diagnose only
//   embedded-editor doctor --fix    → also re-install latest in any nvm Node
//                                     that's drifted from the bundled version

import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { execSync } from "child_process";

function readVersion(pkgJsonPath) {
  try { return JSON.parse(readFileSync(pkgJsonPath, "utf8")).version; }
  catch { return null; }
}

function bundledVersion() {
  // package.json sits at <pkg-root>/package.json; this file is at <pkg-root>/src/doctor.js
  const p = new URL("../package.json", import.meta.url);
  return readVersion(p);
}

function nvmVersionsDir() {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  return path.join(nvmDir, "versions", "node");
}

function listNvmNodes() {
  const dir = nvmVersionsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(n => /^v\d+\.\d+\.\d+$/.test(n))
    .map(name => ({
      name,
      nodeBin: path.join(dir, name, "bin", "node"),
      npmBin:  path.join(dir, name, "bin", "npm"),
      pkgPath: path.join(dir, name, "lib", "node_modules", "embedded-editor-for-claude-code", "package.json"),
    }))
    .filter(n => existsSync(n.nodeBin) && existsSync(n.npmBin));
}

function reinstallForNode(node, targetVersion) {
  try {
    execSync(`"${node.npmBin}" install -g embedded-editor-for-claude-code@${targetVersion}`, {
      stdio: "pipe",
      // npm-script lookups for child npm need its own dir on PATH
      env: { ...process.env, PATH: `${path.dirname(node.npmBin)}:${process.env.PATH || ""}` },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e?.stderr?.toString() || e?.message || String(e)).split("\n")[0] };
  }
}

function inspectLaunchJson(projectDir) {
  const f = path.join(projectDir, ".claude", "launch.json");
  if (!existsSync(f)) return null;
  let parsed;
  try { parsed = JSON.parse(readFileSync(f, "utf8")); }
  catch { return { path: f, error: "unparseable JSON" }; }
  const entry = parsed.configurations?.find(c => c?.name === "Embedded Editor");
  if (!entry) return { path: f, present: false };
  const cliPath = entry.runtimeArgs?.[0];
  // cliPath = <prefix>/embedded-editor-for-claude-code/bin/cli.js
  // pkg.json lives at  <prefix>/embedded-editor-for-claude-code/package.json
  const pkgPath = cliPath
    ? path.join(path.dirname(path.dirname(cliPath)), "package.json")
    : null;
  return {
    path: f,
    present: true,
    runtimeExecutable: entry.runtimeExecutable,
    cliPath,
    cliExists: cliPath ? existsSync(cliPath) : false,
    targetVersion: pkgPath && existsSync(pkgPath) ? readVersion(pkgPath) : null,
  };
}

export async function runDoctor({ fix = false } = {}) {
  const sep = chalk.gray("─".repeat(56));
  const bundled = bundledVersion();

  console.log("\n" + sep);
  console.log(chalk.green.bold("  embedded-editor doctor"));
  console.log(sep);
  console.log(chalk.gray(`  bundled CLI version (this process): ${chalk.white(bundled)}`));

  // ── 1. nvm Node installations ──────────────────────────────────────────────
  console.log(chalk.bold("\n  nvm Node installations"));
  const nodes = listNvmNodes();
  if (nodes.length === 0) {
    console.log(chalk.gray("    (no nvm detected — skipping)"));
  } else {
    let drift = 0;
    for (const n of nodes) {
      const installed = readVersion(n.pkgPath);
      if (!installed) {
        console.log(chalk.gray(`    ${n.name.padEnd(10)} — embedded-editor not installed`));
      } else if (installed === bundled) {
        console.log(chalk.green(`    ✓ ${n.name.padEnd(10)} — ${installed}`));
      } else {
        drift++;
        console.log(chalk.yellow(`    ⚠ ${n.name.padEnd(10)} — ${installed}`) + chalk.gray(`  (drifted from ${bundled})`));
        if (fix) {
          process.stdout.write(chalk.gray(`      installing ${bundled}…`));
          const r = reinstallForNode(n, bundled);
          process.stdout.write(r.ok ? chalk.green(" ✓\n") : chalk.red(` ✗ ${r.error}\n`));
        }
      }
    }
    if (drift > 0 && !fix) {
      console.log(chalk.gray("\n    run ") + chalk.cyan("embedded-editor doctor --fix") + chalk.gray(" to re-install in drifted Node versions"));
    }
  }

  // ── 2. Current project's launch.json ───────────────────────────────────────
  console.log(chalk.bold("\n  Current project launch.json"));
  const lj = inspectLaunchJson(process.cwd());
  if (!lj) {
    console.log(chalk.gray("    (no .claude/launch.json in cwd)"));
  } else if (lj.error) {
    console.log(chalk.red(`    ✗ ${lj.path} — ${lj.error}`));
  } else if (!lj.present) {
    console.log(chalk.yellow(`    ⚠ ${lj.path} has no "Embedded Editor" entry`));
  } else {
    const pathOK = lj.cliExists;
    const versionMatches = lj.targetVersion && lj.targetVersion === bundled;
    if (pathOK && versionMatches) {
      console.log(chalk.green(`    ✓ launch.json → ${lj.targetVersion}`));
      console.log(chalk.gray(`      ${lj.cliPath}`));
    } else if (!pathOK) {
      console.log(chalk.red(`    ✗ launch.json points to a missing path:`));
      console.log(chalk.gray(`      ${lj.cliPath}`));
      console.log(chalk.gray("      → rerun ") + chalk.cyan("embedded-editor init") + chalk.gray(" to regenerate"));
    } else {
      console.log(chalk.yellow(`    ⚠ launch.json → ${lj.targetVersion}`) + chalk.gray(` (drifted from ${bundled})`));
      console.log(chalk.gray(`      ${lj.cliPath}`));
      console.log(chalk.gray(`      → SessionStart hook will overwrite on next chat start`));
    }
  }

  // ── 3. Suggested next action ───────────────────────────────────────────────
  console.log();
}
