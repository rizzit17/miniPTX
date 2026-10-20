"""Isolated POSIX resource setup; avoids preexec_fn in a threaded web server."""
import os
import sys

if __name__ == "__main__":
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    if sys.platform != "darwin" and hasattr(resource, "RLIMIT_AS"):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    os.execv(sys.argv[1], sys.argv[1:])
