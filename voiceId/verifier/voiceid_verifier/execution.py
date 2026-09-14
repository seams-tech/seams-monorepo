from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class TimedStageResult:
    completed_at: float
    value: Any


class BoundedStageExecutor:
    def __init__(self, maximum_active_stages: int) -> None:
        if maximum_active_stages <= 0:
            raise ValueError("maximum_active_stages must be positive")
        self.maximum_active_stages = maximum_active_stages
        self._slots = threading.BoundedSemaphore(maximum_active_stages)
        self._executor = ThreadPoolExecutor(
            max_workers=maximum_active_stages,
            thread_name_prefix="voiceid-stage",
        )

    def submit(
        self,
        function: Callable[..., TimedStageResult],
        *args: Any,
    ) -> Future[TimedStageResult] | None:
        if not self._slots.acquire(blocking=False):
            return None
        try:
            future = self._executor.submit(function, *args)
        except Exception:
            self._slots.release()
            raise
        future.add_done_callback(self._release_slot)
        return future

    def _release_slot(self, _: Future[TimedStageResult]) -> None:
        self._slots.release()

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)
