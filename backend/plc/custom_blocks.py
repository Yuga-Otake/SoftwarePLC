"""Storage and registry for user/AI-authored custom code blocks (Python)."""

import json
from pathlib import Path

from .models import CustomBlockDefinition

LIBRARY_DIR = Path(__file__).resolve().parent.parent / "custom_blocks"

CUSTOM_BLOCKS: dict[str, CustomBlockDefinition] = {}


def load_custom_blocks():
    CUSTOM_BLOCKS.clear()
    if not LIBRARY_DIR.exists():
        return
    for path in sorted(LIBRARY_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            definition = CustomBlockDefinition(**data)
            CUSTOM_BLOCKS[definition.id] = definition
        except Exception:
            continue


def save_custom_block(definition: CustomBlockDefinition):
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    path = LIBRARY_DIR / f"{definition.id}.json"
    path.write_text(json.dumps(definition.model_dump(), ensure_ascii=False, indent=2))
    CUSTOM_BLOCKS[definition.id] = definition


def delete_custom_block(block_id: str):
    CUSTOM_BLOCKS.pop(block_id, None)
    path = LIBRARY_DIR / f"{block_id}.json"
    if path.exists():
        path.unlink()


def get_custom_block(block_id: str) -> CustomBlockDefinition | None:
    return CUSTOM_BLOCKS.get(block_id)


def custom_block_catalog() -> dict[str, dict]:
    """Catalog entries shaped like NODE_CATALOG so the frontend/AI can treat
    custom blocks the same way as built-in blocks."""
    return {
        b.id: {
            "type": b.id,
            "label": b.name,
            "description": b.description,
            "input_ports": [p.model_dump() for p in b.input_ports],
            "output_ports": [p.model_dump() for p in b.output_ports],
            "params_schema": b.params_schema,
            "icon_color": b.icon_color,
            "is_custom": True,
            "created_by": b.created_by,
        }
        for b in CUSTOM_BLOCKS.values()
    }
