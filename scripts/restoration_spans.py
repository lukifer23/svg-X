"""Reviewed span supervision independent of the pixel-label manifest."""

import hashlib
import json

import numpy as np
from PIL import Image
import torch
from torch.nn import functional as F


def sections(path, shape, is_gap):
    points = np.asarray(path["points"])
    radius = path["radius"]
    height, width = shape
    if (
        points.ndim != 2
        or points.shape[1] != 2
        or len(points) < 2
        or not np.issubdtype(points.dtype, np.integer)
        or not isinstance(radius, int)
        or not 1 <= radius <= 4
        or np.any(points < radius)
        or np.any(points >= [width - radius, height - radius])
        or (is_gap and len(points) != 2)
    ):
        raise ValueError(f"Invalid geometry for span {path['id']}")
    offsets = np.arange(-radius, radius + 1)
    grids = []
    for start, end in zip(points[:-1], points[1:]):
        direction = end - start
        length = np.linalg.norm(direction)
        if length < 2:
            raise ValueError(f"Repeated or adjacent span anchors: {path['id']}")
        # Sample the ink corridor across its local normal. Supervise only
        # the middle of a gap so the two genuine ink ends stay positive.
        t = (
            np.linspace(0.30, 0.70, max(1, int(length / 4)))
            if is_gap
            else np.linspace(0, 1, max(2, int(length / 2) + 1))
        )
        if is_gap and len(t) == 1:
            t[0] = 0.5
        centers = start + t[:, None] * direction
        normal = np.array([-direction[1], direction[0]]) / length
        grid = np.rint(centers[:, None] + offsets[None, :, None] * normal).astype(
            np.int64
        )
        grids.append(grid[..., 1] * width + grid[..., 0])
    return np.concatenate(grids)


def load_spans(manifest):
    contents = manifest.read_bytes()
    config = json.loads(contents)
    if config["version"] != 1:
        raise ValueError("Unsupported reviewed-span manifest")
    splits = {key: [] for key in ("train", "validation", "test")}
    documents, sources, ids = {}, {}, set()
    for row in config["scans"]:
        name, split = row["image"], row["split"]
        if manifest.parent.joinpath(name).name != name or name in ids:
            raise ValueError(f"Invalid or repeated span crop: {name}")
        ids.add(name)
        if (
            documents.setdefault(row["document"], split) != split
            or sources.setdefault(row["sourceSha256"], split) != split
        ):
            raise ValueError(f"Span source crosses splits: {name}")
        file = manifest.parent / name
        if hashlib.sha256(file.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError(f"Span crop has changed: {name}")
        with Image.open(file) as image:
            gray = np.array(image.convert("L"), dtype=np.float32) / 255
        if max(gray.shape) > 320:
            raise ValueError(f"Span crops are limited to 320 pixels per side: {name}")
        if not row["strokes"] or not row["gaps"]:
            raise ValueError(f"Crop needs reviewed ink spans and gaps: {name}")
        grids = [
            [torch.from_numpy(sections(path, gray.shape, is_gap)) for path in row[key]]
            for key, is_gap in (("strokes", False), ("gaps", True))
        ]
        splits[split].append((torch.from_numpy(gray)[None, None], *grids))
    if not all(splits.values()):
        raise ValueError("Span corpus needs train, validation, and test documents")
    return splits, hashlib.sha256(contents).hexdigest()


def span_loss(model, sample, device, fade=1.0):
    gray, strokes, gaps = sample
    logits = model((1 - fade * (1 - gray)).to(device)).flatten()

    def hardest(paths, positive):
        losses = []
        for path in paths:
            confidence = logits[path.to(device)].amax(dim=1)
            errors = F.softplus(-confidence if positive else confidence)
            losses.append(errors.topk(max(1, len(errors) // 4)).values.mean())
        return torch.stack(losses).mean()

    return (hardest(strokes, True) + hardest(gaps, False)) / 2
