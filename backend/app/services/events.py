from app.schemas.event import EventIngestItem
from app.workers.tasks import process_event


def enqueue_events(events: list[EventIngestItem]) -> list[str]:
    task_ids: list[str] = []
    for event in events:
        task = process_event.delay(event.model_dump(mode="json"))
        task_ids.append(task.id)
    return task_ids
