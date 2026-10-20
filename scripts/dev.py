"""Start the local backend and frontend; Ctrl+C stops both process trees."""
import argparse
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def stop(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, check=False)
    else:
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            process.kill()
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--production", action="store_true", help="Serve a previously built Next.js production build")
    args = parser.parse_args()
    node = shutil.which("node")
    if not node or not (ROOT / "frontend/node_modules/next/dist/bin/next").exists():
        sys.exit("Install Node.js and run npm install in frontend/ first.")
    for port in (8000, 3000):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                sys.exit(f"Port {port} is already in use. Stop its server before launching MiniPTX.")
    subprocess.run([node, "scripts/copy-monaco.mjs"], cwd=ROOT / "frontend", check=True)
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
    processes = []
    try:
        processes.append(subprocess.Popen([
            sys.executable, "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000"
        ], cwd=ROOT, **options))
        processes.append(subprocess.Popen([
            node, "node_modules/next/dist/bin/next", "start" if args.production else "dev", "--hostname", "127.0.0.1", "--port", "3000"
        ], cwd=ROOT / "frontend", **options))
        print("\nMiniPTX: http://127.0.0.1:3000\nAPI docs: http://127.0.0.1:8000/docs\nCtrl+C stops both servers.\n", flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
        return next((p.returncode for p in processes if p.returncode), 1)
    except KeyboardInterrupt:
        return 0
    finally:
        for process in reversed(processes):
            stop(process)


if __name__ == "__main__":
    sys.exit(main())
