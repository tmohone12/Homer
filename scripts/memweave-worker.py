"""Reviewed-source integration draft. Never invoked by the preview; the host coordinator is disabled by default.
Execution requires a separately reviewed, pinned dependency image with OS network denial,
no credentials, readonly actor-scoped /workspace/campaign and tmpfs /index. No real library
has been installed or executed in this task. JSON-line protocol is owned by MythEngine.
"""
import os
import sys
import json
import asyncio
from pathlib import Path

SOURCE_COMMIT = "2ff82df7148274ee7d465273e2c401be18625238"

class NoNetworkEmbeddingProvider:
    async def embed_query(self, text):
        return []
    async def embed_batch(self, texts):
        return [[] for _ in texts]

async def main():
    if os.environ.get("MYTHENGINE_REVIEWED_MEMWEAVE_WORKER") != SOURCE_COMMIT:
        raise RuntimeError("MemWeave execution is disabled pending a pinned runtime review")
    # Import only after the execution gate. The network boundary must be enforced by OS,
    # not by the flag or keyword strategy. No provider configuration/environment admitted.
    from memweave import MemWeave
    from memweave.config import MemoryConfig, VectorConfig, QueryConfig, FlushConfig
    workspace = Path("/workspace/campaign").resolve(strict=True)
    for line in sys.stdin:
        if len(line.encode()) > 9 * 1024 * 1024:
            raise RuntimeError("Worker request exceeds snapshot budget")
        request = json.loads(line)
        if request.get("operation") != "search":
            raise RuntimeError("Only bounded retrieval is supported")
        if not isinstance(request.get('query'), str) or not 1 <= len(request['query'].strip()) <= 300:
            raise RuntimeError('Invalid bounded query')
        maximum = request.get('max_results', 12)
        if type(maximum) is not int or not 1 <= maximum <= 12:
            raise RuntimeError('Invalid result budget')
        expected = request['snapshot']
        if len(expected['records']) > 500:
            raise RuntimeError('Too many scope records')
        # Host coordinator materializes only the sealed scope. No source path supplied
        # by the caller can expand filesystem access or enable model/memory flush.
        for record in expected["records"]:
            relative = record["path"]
            if not relative.startswith("records/") or ".." in relative or "\\" in relative:
                raise RuntimeError("Invalid scope path")
            target = workspace / relative
            if target.is_symlink() or not target.resolve(strict=True).is_relative_to(workspace):
                raise RuntimeError("Scope link/path escape")
            if target.read_bytes().decode("utf-8") != record["text"]:
                raise RuntimeError("Snapshot mismatch")
        cfg = MemoryConfig(workspace_dir=str(workspace), db_path="/index/index.sqlite",
            vector=VectorConfig(enabled=False), query=QueryConfig(strategy="keyword", min_score=0.0),
            flush=FlushConfig(enabled=False), progress=False, bootstrap_files=[],
            extra_paths=[str(workspace / "records")])
        async with MemWeave(cfg, embedding_provider=NoNetworkEmbeddingProvider()) as mem:
            await mem.index(force=True)
            results = await mem.search(request["query"], strategy="keyword", min_score=0.0,
                max_results=maximum)
        from dataclasses import asdict
        print(json.dumps({"snapshotHash": expected["snapshotHash"], "sourceCommit": SOURCE_COMMIT,
            "policy": {"network": "none", "credentials": "absent", "flush": False, "canonicalWrites": False},
            "results": [asdict(result) for result in results]}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())