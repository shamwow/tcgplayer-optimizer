import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const isWin = process.platform === "win32";
const venvDir = join(repoRoot, ".venv");
const venvPython = isWin
  ? join(venvDir, "Scripts", "python.exe")
  : join(venvDir, "bin", "python");
const cliScript = join(repoRoot, "scripts", "optimal-cart-cli.py");

const bootstrapPython = process.env.PYTHON ?? (isWin ? "py" : "python3");
const bootstrapArgs = isWin ? ["-3"] : [];
const forwardedArgs = process.argv.slice(2);
const envArgs = buildEnvArgs();
const cliArgs = normalizeCliArgs(forwardedArgs, envArgs);

ensureVenv();
ensureHighspy();
runCli();

function ensureVenv() {
  if (existsSync(venvPython)) return;

  console.log("[optimal-cart] Creating local virtual environment in .venv");
  runCommand(bootstrapPython, [...bootstrapArgs, "-m", "venv", ".venv"], {
    cwd: repoRoot,
  });
}

function ensureHighspy() {
  const probe = spawnSync(
    venvPython,
    ["-c", "import highspy"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  if (probe.status === 0) return;

  console.log("[optimal-cart] Installing Python dependency: highspy");
  runCommand(venvPython, ["-m", "pip", "install", "highspy"], {
    cwd: repoRoot,
  });
}

function runCli() {
  const result = spawnSync(
    venvPython,
    [cliScript, ...cliArgs],
    {
      cwd: repoRoot,
      stdio: "inherit",
    }
  );

  process.exit(result.status ?? 1);
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildEnvArgs() {
  const args = [];

  if (process.env.npm_config_input) {
    args.push("--input", process.env.npm_config_input);
  }
  if (process.env.npm_config_output) {
    args.push("--output", process.env.npm_config_output);
  }
  if (process.env.npm_config_pretty === "true") {
    args.push("--pretty");
  }
  if (process.env.npm_config_help === "true") {
    args.push("--help");
  }

  return args;
}

function normalizeCliArgs(forwarded, fallback) {
  if (forwarded.length === 0) {
    return fallback;
  }

  const hasFlags = forwarded.some((arg) => arg.startsWith("-"));
  if (hasFlags) {
    return forwarded;
  }

  const args = [];
  const [input, output, ...rest] = forwarded;

  if (input) {
    args.push("--input", input);
  }
  if (output) {
    args.push("--output", output);
  }

  if (rest.length > 0) {
    args.push(...rest);
  }

  return args;
}
