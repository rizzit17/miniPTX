import asyncio
import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from .models import CompileRequest, CompileResponse
from . import service


class BodyLimitMiddleware:
    """Bound the raw request body, including chunked requests, before JSON parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > 262144:
                return await JSONResponse({"detail": "Request body exceeds 256 KiB"}, status_code=413)(scope, receive, send)
            if not message.get("more_body"):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


from fastapi.exceptions import RequestValidationError


app = FastAPI(title="MiniPTX", version="1.0.0")
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=[
    "http://localhost:3000", "http://127.0.0.1:3000"
], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
compile_slots = asyncio.Semaphore(4)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    for error in exc.errors():
        if error.get("type") == "string_unicode":
            return JSONResponse(
                status_code=422,
                content={"detail": "Source contains invalid Unicode surrogate code points"},
            )
    try:
        from fastapi.encoders import jsonable_encoder
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})
    except Exception:
        return JSONResponse(
            status_code=422,
            content={"detail": "Source contains invalid Unicode surrogate code points"},
        )


@app.get("/api/health")
def health():
    return {
        "status": "ready" if service.COMPILER_PATH.is_file() else "unavailable",
        "compiler": service.COMPILER_PATH.is_file(),
        "ptxas": service.assembler_path() is not None,
        "target": "sm_75",
        "ptx_version": "7.0",
        "resource_limits": "CPU / memory / file limits + wall timeout" if os.name == "posix" else "Wall timeout; OS sandbox required for public use",
    }


@app.get("/api/examples")
def examples():
    manifest = service.ROOT / "examples" / "manifest.json"
    return json.loads(manifest.read_text(encoding="utf-8"))


@app.post("/api/compile", response_model=CompileResponse)
async def compile_program(request: CompileRequest):
    try:
        byte_length = len(request.source.encode("utf-8"))
    except UnicodeEncodeError:
        # JSON can contain escaped lone UTF-16 surrogates, which are not UTF-8.
        # Do not echo the unencodable value into the error response.
        raise HTTPException(422, "Source contains invalid Unicode surrogate code points")
    if byte_length > 32768:
        raise HTTPException(413, "Source exceeds 32768 bytes")
    try:
        await asyncio.wait_for(compile_slots.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(429, "Compiler is busy; retry shortly")
    # Shield the worker and retain its slot even if the client disconnects.
    task = asyncio.create_task(asyncio.to_thread(service.compile_source, request))
    task.add_done_callback(lambda _: compile_slots.release())
    return await asyncio.shield(task)
