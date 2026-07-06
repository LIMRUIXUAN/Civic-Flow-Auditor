import { spawnSync } from "node:child_process";

function findPython() {
  for (const command of ["python", "py"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", shell: true });
    if (result.status === 0) return command;
  }
  return null;
}

const mode = process.argv[2] || "dev";
const python = findPython();

if (!python) {
  console.error("Python is not installed or not available on PATH.");
  console.error("");
  console.error("Install Python 3.11+ first, then run:");
  console.error("  python -m pip install -r requirements.txt");
  console.error("  npm run dev:api");
  process.exit(1);
}

const commands = {
  dev: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8787"],
  worker: ["-m", "celery", "-A", "app.worker.celery_app", "worker", "--loglevel=info"],
  test: ["-m", "pytest"],
};

const args = commands[mode];
if (!args) {
  console.error(`Unknown backend command: ${mode}`);
  process.exit(1);
}

const result = spawnSync(python, args, { stdio: "inherit", shell: true });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);