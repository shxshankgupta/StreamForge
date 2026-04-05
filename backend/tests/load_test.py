import argparse
import asyncio
import time
from collections.abc import Iterable

import aiohttp


def build_batches(total_events: int, batch_size: int) -> Iterable[list[dict]]:
    for start in range(0, total_events, batch_size):
        batch: list[dict] = []
        for index in range(start, min(start + batch_size, total_events)):
            batch.append(
                {
                    "event_id": f"load-{index}",
                    "category": ["orders", "payments", "alerts", "shipments"][index % 4],
                    "payload": {"value": index, "source": "load-test"},
                }
            )
        yield batch


async def send_batch(session: aiohttp.ClientSession, url: str, batch: list[dict]) -> int:
    async with session.post(url, json={"events": batch}) as response:
        response.raise_for_status()
        body = await response.json()
        return body["accepted"]


async def run_load_test(base_url: str, total_events: int, batch_size: int, concurrency: int) -> None:
    url = f"{base_url.rstrip('/')}/events"
    connector = aiohttp.TCPConnector(limit=concurrency)

    start = time.perf_counter()
    accepted = 0

    async with aiohttp.ClientSession(connector=connector) as session:
        semaphore = asyncio.Semaphore(concurrency)

        async def limited_send(batch: list[dict]) -> int:
            async with semaphore:
                return await send_batch(session, url, batch)

        tasks = [asyncio.create_task(limited_send(batch)) for batch in build_batches(total_events, batch_size)]
        for result in await asyncio.gather(*tasks):
            accepted += result

    duration = time.perf_counter() - start
    rate = accepted / duration if duration else 0
    print(f"Accepted {accepted} events in {duration:.2f}s ({rate:.2f} events/sec)")


def main() -> None:
    parser = argparse.ArgumentParser(description="StreamForge load test")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    parser.add_argument("--total-events", type=int, default=10000, help="Total events to send")
    parser.add_argument("--batch-size", type=int, default=100, help="Events per request")
    parser.add_argument("--concurrency", type=int, default=20, help="Concurrent requests")
    args = parser.parse_args()

    asyncio.run(run_load_test(args.base_url, args.total_events, args.batch_size, args.concurrency))


if __name__ == "__main__":
    main()
