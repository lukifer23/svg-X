"""Train and run the experimental grayscale ink restoration model."""

import argparse
import hashlib
import json
from pathlib import Path
import random
import sys
import time

import numpy as np
from PIL import Image
import torch
from torch import nn
from torch.nn import functional as F


class InkModel(nn.Module):
    """Estimate ink coverage using grayscale and two local paper estimates."""

    halo = 32

    def __init__(self):
        super().__init__()
        layers = [nn.Conv2d(3, 12, 3, padding=1, padding_mode="replicate"), nn.SiLU()]
        for dilation in (2, 4, 8):
            layers.extend(
                [
                    nn.Conv2d(
                        12,
                        12,
                        3,
                        padding=dilation,
                        dilation=dilation,
                        padding_mode="replicate",
                    ),
                    nn.SiLU(),
                ]
            )
        self.predict = nn.Sequential(*layers, nn.Conv2d(12, 1, 1))

    def forward(self, gray):
        features = [gray]
        for size in (9, 33):
            radius = size // 2
            horizontal = F.avg_pool2d(
                F.pad(gray, (radius, radius, 0, 0), "replicate"), (1, size), stride=1
            )
            paper = F.avg_pool2d(
                F.pad(horizontal, (0, 0, radius, radius), "replicate"),
                (size, 1),
                stride=1,
            )
            features.append(paper - gray)
        return self.predict(torch.cat(features, dim=1))


def raster(path):
    with Image.open(path) as image:
        return np.array(image.convert("L"))


def load_pairs(directory):
    prefix = directory / "manifest.jsonl"
    contents = prefix.read_bytes()
    splits = {"train": [], "validation": []}
    targets = {}
    for line in contents.splitlines():
        row = json.loads(line)
        if row["schemaVersion"] != 2:
            raise ValueError("Audit and rebuild the dataset as manifest version 2")
        if row["split"] not in splits:
            continue
        name = row["target"]
        if name not in targets:
            targets[name] = raster(directory / name)
        source, target = raster(directory / row["input"]), targets[name]
        if source.shape != target.shape:
            raise ValueError(f"Raster dimensions disagree for {row['id']}")
        splits[row["split"]].append((source, target))
    if not all(splits.values()):
        raise ValueError("Training and validation splits must both be nonempty")
    return splits, hashlib.sha256(contents).hexdigest()


def patch(pair, size, rng=None):
    source, target = pair
    height, width = target.shape
    if width < size or height < size:
        padding = ((0, max(0, size - height)), (0, max(0, size - width)))
        source = np.pad(source, padding, mode="edge")
        target = np.pad(target, padding, mode="edge")
    if rng is None:
        y, x = (target.shape[0] - size) // 2, (target.shape[1] - size) // 2
    else:
        y, x = (rng.integers(0, dimension - size + 1) for dimension in target.shape)
    gray = source[y : y + size, x : x + size].astype(np.float32) / 255
    ink = 1 - target[y : y + size, x : x + size].astype(np.float32) / 255
    if rng is not None and rng.random() < 0.55:
        grid = np.linspace(-1, 1, size, dtype=np.float32)
        xx, yy = grid[None, :], grid[:, None]
        shadow = np.clip(
            rng.uniform(0.64, 1)
            + rng.uniform(-0.18, 0.18) * xx
            + rng.uniform(-0.18, 0.18) * yy,
            0.48,
            1,
        )
        extent = rng.uniform(0.1, 0.65)
        fade = 1 - rng.uniform(0.2, 0.8) * np.exp(
            -((xx - rng.uniform(-1, 1)) ** 2 + (yy - rng.uniform(-1, 1)) ** 2) / extent
        )
        gray = shadow * (1 - ink * rng.uniform(0.18, 0.94) * fade)
        gray += rng.normal(0, rng.uniform(0.004, 0.019), gray.shape)
        gray -= (rng.random(gray.shape) < 0.009) * rng.uniform(0.025, 0.13)
        np.clip(gray, 0, 1, out=gray)
    return np.stack((gray, ink))


def loss_for(prediction, target):
    weight = 1 + 5 * target
    return (
        F.binary_cross_entropy_with_logits(prediction, target, reduction="none")
        * weight
    ).mean()


def load_reviewed_scans(manifest):
    contents = manifest.read_bytes()
    config = json.loads(contents)
    if config["version"] != 1:
        raise ValueError("Unsupported reviewed-scan manifest")
    splits = {"train": [], "validation": []}
    documents = {}
    seen = set()
    for row in config["scans"]:
        name, split, document = row["image"], row["split"], row["document"]
        if Path(name).name != name or name in seen:
            raise ValueError(f"Invalid or repeated crop: {name}")
        seen.add(name)
        if documents.setdefault(document, split) != split:
            raise ValueError(f"Document appears across splits: {document}")
        file = manifest.parent / name
        if hashlib.sha256(file.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError(f"Reviewed crop has changed: {name}")
        gray = raster(file).astype(np.float32) / 255
        height, width = gray.shape
        labels = np.full(gray.shape, -1, dtype=np.float32)
        for key, value in (("inkRegions", 1), ("paperRegions", 0)):
            for x0, y0, x1, y1 in row[key]:
                if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
                    raise ValueError(f"Annotation outside crop: {name}")
                zone = labels[y0:y1, x0:x1]
                valid = (
                    gray[y0:y1, x0:x1] < 180 / 255
                    if value
                    else np.ones(zone.shape, dtype=bool)
                )
                if np.any((zone[valid] != -1) & (zone[valid] != value)):
                    raise ValueError(f"Conflicting reviewed labels: {name}")
                zone[valid] = value
        ink = np.argwhere(labels == 1)
        if not len(ink) or not np.any(labels == 0):
            raise ValueError(f"Reviewed crop needs both ink and paper: {name}")
        splits[split].append((gray, labels, ink))
    if not all(splits.values()):
        raise ValueError("Reviewed train and validation documents are required")
    return splits, hashlib.sha256(contents).hexdigest()


def reviewed_patch(sample, size, rng):
    gray, labels, ink = sample
    height, width = gray.shape
    if width < size or height < size:
        pad = ((0, max(0, size - height)), (0, max(0, size - width)))
        gray = np.pad(gray, pad, mode="edge")
        labels = np.pad(labels, pad, constant_values=-1)
    y, x = map(int, ink[rng.integers(len(ink))])
    y = np.clip(
        y - rng.integers(size // 4, max(size // 4 + 1, 3 * size // 4)),
        0,
        gray.shape[0] - size,
    )
    x = np.clip(
        x - rng.integers(size // 4, max(size // 4 + 1, 3 * size // 4)),
        0,
        gray.shape[1] - size,
    )
    region = gray[y : y + size, x : x + size]
    scale = rng.uniform(0.23, 1.0)
    shadow = np.linspace(
        rng.uniform(0.72, 1), rng.uniform(0.72, 1), size, dtype=np.float32
    )
    transformed = shadow * (1 - (1 - region) * scale)
    return np.stack((transformed, labels[y : y + size, x : x + size]))


def reviewed_loss(logits, labels):
    ink = labels == 1
    paper = labels == 0
    return (
        (F.softplus(-logits) * ink).sum() / ink.sum().clamp_min(1)
        + (F.softplus(logits) * paper).sum() / paper.sum().clamp_min(1)
    ) / 2


@torch.inference_mode()
def reviewed_metrics(model, samples, device):
    loss = 0
    ink_hit = ink_total = paper_hit = paper_total = 0
    for gray, labels, _ in samples:
        data = torch.from_numpy(gray)[None, None].to(device)
        target = torch.from_numpy(labels)[None, None].to(device)
        scores = model(data)
        loss += reviewed_loss(scores, target).item()
        ink_hit += ((scores >= 0) & (target == 1)).sum().item()
        ink_total += (target == 1).sum().item()
        paper_hit += ((scores >= 0) & (target == 0)).sum().item()
        paper_total += (target == 0).sum().item()
    return {
        "loss": loss / len(samples),
        "inkRecall": ink_hit / ink_total,
        "paperFalsePositiveRate": paper_hit / paper_total,
        "inkPixels": ink_total,
        "paperPixels": paper_total,
    }


def train(args):
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    selection = random.Random(args.seed)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is unavailable")
    device = torch.device(args.device)
    if device.type == "cuda":
        torch.backends.cudnn.deterministic = True
    data, manifest_hash = load_pairs(args.dataset)
    reviewed, reviewed_hash = (
        load_reviewed_scans(args.reviewed) if args.reviewed else (None, None)
    )
    model = (load_model(args.initialize)[0] if args.initialize else InkModel()).to(
        device
    )
    model.train()
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=0.0003 if args.initialize else 0.002
    )
    args.run.mkdir(parents=True, exist_ok=False)
    validation = torch.from_numpy(
        np.stack([patch(pair, args.patch) for pair in data["validation"]])
    )
    history = []
    best = float("inf")
    reviewed_baseline = (
        reviewed_metrics(model, reviewed["validation"], device) if reviewed else None
    )
    start = time.perf_counter()
    for step in range(1, args.steps + 1):
        batch = selection.choices(data["train"], k=args.batch)
        tensor = torch.from_numpy(
            np.stack([patch(pair, args.patch, rng) for pair in batch])
        ).to(device)
        optimizer.zero_grad(set_to_none=True)
        loss = loss_for(model(tensor[:, :1]), tensor[:, 1:])
        if reviewed:
            real_batch = selection.choices(reviewed["train"], k=max(1, args.batch // 4))
            real = torch.from_numpy(
                np.stack(
                    [reviewed_patch(sample, args.patch, rng) for sample in real_batch]
                )
            ).to(device)
            loss = 0.75 * loss + 0.25 * reviewed_loss(model(real[:, :1]), real[:, 1:])
        loss.backward()
        optimizer.step()
        if step % args.validate_every != 0 and step != args.steps:
            continue
        model.eval()
        with torch.inference_mode():
            total = 0.0
            for chunk in validation.split(args.batch):
                scores = chunk.to(device)
                total += loss_for(model(scores[:, :1]), scores[:, 1:]).item() * len(
                    chunk
                )
        score = total / len(validation)
        real_score = (
            reviewed_metrics(model, reviewed["validation"], device)
            if reviewed
            else None
        )
        model.train()
        record = {"step": step, "trainLoss": loss.item(), "validationLoss": score}
        if real_score:
            record["reviewedValidation"] = real_score
        history.append(record)
        print(json.dumps(history[-1]), flush=True)
        selection_loss = real_score["loss"] if real_score else score
        if selection_loss < best:
            best = selection_loss
            weights = {
                name: tensor.detach().cpu().numpy()
                for name, tensor in model.state_dict().items()
            }
            temporary = args.run / "ink-model.tmp.npz"
            np.savez(temporary, version=1, step=step, **weights)
            temporary.replace(args.run / "ink-model.npz")
    report = {
        "manifestSha256": manifest_hash,
        "reviewedManifestSha256": reviewed_hash,
        "reviewedBaseline": reviewed_baseline,
        "initializedFrom": hashlib.sha256(args.initialize.read_bytes()).hexdigest()
        if args.initialize
        else None,
        "seed": args.seed,
        "steps": args.steps,
        "batch": args.batch,
        "patch": args.patch,
        "trainPairs": len(data["train"]),
        "validationPairs": len(data["validation"]),
        "torch": torch.__version__,
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "device": torch.cuda.get_device_name() if device.type == "cuda" else "CPU",
        "deviceBytes": torch.cuda.get_device_properties(0).total_memory
        if device.type == "cuda"
        else None,
        "peakAllocatedBytes": torch.cuda.max_memory_allocated()
        if device.type == "cuda"
        else None,
        "peakReservedBytes": torch.cuda.max_memory_reserved()
        if device.type == "cuda"
        else None,
        "seconds": time.perf_counter() - start,
        "parameters": sum(p.numel() for p in model.parameters()),
        "history": history,
    }
    (args.run / "training.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )


@torch.inference_mode()
def predict(model, data, tile):
    height, width = data.shape
    image = torch.from_numpy(data.astype(np.float32) / 255)[None, None]
    result = np.empty((height, width), dtype=np.uint8)
    halo = model.halo
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            bottom, right = min(height, y + tile), min(width, x + tile)
            top_pad, left_pad = max(y - halo, 0), max(x - halo, 0)
            region = image[
                :,
                :,
                top_pad : min(bottom + halo, height),
                left_pad : min(right + halo, width),
            ]
            output = model(region).sigmoid()[0, 0]
            middle = output[
                y - top_pad : bottom - top_pad, x - left_pad : right - left_pad
            ]
            result[y:bottom, x:right] = (
                (255 * (1 - middle)).round().to(torch.uint8).numpy()
            )
    return result


def load_model(path):
    model = InkModel().eval()
    with np.load(path, allow_pickle=False) as checkpoint:
        if int(checkpoint["version"]) != 1:
            raise ValueError("Unsupported ink checkpoint version")
        model.load_state_dict(
            {name: torch.from_numpy(checkpoint[name]) for name in model.state_dict()}
        )
        return model, int(checkpoint["step"])


def restore(args):
    model, step = load_model(args.checkpoint)
    args.output.mkdir(exist_ok=False)
    timings = {}
    for file in sorted(args.input.glob("*.png")):
        data = raster(file)
        samples = []
        for _ in range(args.samples + 1):
            start = time.perf_counter()
            restored = predict(model, data, args.tile)
            samples.append((time.perf_counter() - start) * 1000)
        Image.fromarray(restored).save(args.output / file.name)
        timings[file.stem] = samples[1:]
    if not timings:
        raise ValueError("Input directory must contain PNGs")
    (args.output / "inference.json").write_text(
        json.dumps(
            {
                "checkpointStep": step,
                "threads": args.threads,
                "tile": args.tile,
                "inferenceMs": timings,
                "checkpointSha256": hashlib.sha256(
                    args.checkpoint.read_bytes()
                ).hexdigest(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def evaluate_pairs(args):
    model, step = load_model(args.checkpoint)
    counts = {"raw": [0, 0, 0], "learned": [0, 0, 0]}
    groups = set()
    pairs = 0
    manifest = (args.dataset / "manifest.jsonl").read_bytes()
    for line in manifest.splitlines():
        row = json.loads(line)
        if row["schemaVersion"] != 2:
            raise ValueError("Expected manifest version 2")
        if row["split"] != "test":
            continue
        source = raster(args.dataset / row["input"])
        target = raster(args.dataset / row["target"]) < 128
        for name, result in (
            ("raw", source),
            ("learned", predict(model, source, args.tile)),
        ):
            ink = result < 128
            counts[name][0] += np.count_nonzero(ink & target)
            counts[name][1] += np.count_nonzero(ink & ~target)
            counts[name][2] += np.count_nonzero(~ink & target)
        groups.add(row["group"])
        pairs += 1
    if not pairs:
        raise ValueError("The dataset has no held-out test pairs")
    metrics = {}
    for name, (positive, false_positive, false_negative) in counts.items():
        denominator = 2 * positive + false_positive + false_negative
        metrics[name] = {
            "inkF1": 2 * positive / denominator if denominator else 0,
            "truePositive": positive,
            "falsePositive": false_positive,
            "falseNegative": false_negative,
        }
    report = {
        "manifestSha256": hashlib.sha256(manifest).hexdigest(),
        "checkpointStep": step,
        "pairs": pairs,
        "groups": sorted(groups),
        "metrics": metrics,
    }
    with args.report.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps(report))


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("Must be positive")
    return number


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(required=True)
    training = commands.add_parser("train")
    training.add_argument("dataset", type=Path)
    training.add_argument("run", type=Path)
    training.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    training.add_argument("--steps", type=positive, default=600)
    training.add_argument("--validate-every", type=positive, default=100)
    training.add_argument("--seed", type=int, default=173)
    training.add_argument("--batch", type=positive, default=12)
    training.add_argument("--patch", type=positive, default=96)
    training.add_argument("--threads", type=positive, default=4)
    training.add_argument("--reviewed", type=Path)
    training.add_argument("--initialize", type=Path)
    training.set_defaults(run_command=train)
    inference = commands.add_parser("restore")
    inference.add_argument("checkpoint", type=Path)
    inference.add_argument("input", type=Path)
    inference.add_argument("output", type=Path)
    inference.add_argument("--threads", type=positive, default=4)
    inference.add_argument("--tile", type=positive, default=256)
    inference.add_argument("--samples", type=positive, default=3)
    inference.set_defaults(run_command=restore)
    evaluation = commands.add_parser("evaluate-pairs")
    evaluation.add_argument("checkpoint", type=Path)
    evaluation.add_argument("dataset", type=Path)
    evaluation.add_argument("report", type=Path)
    evaluation.add_argument("--threads", type=positive, default=4)
    evaluation.add_argument("--tile", type=positive, default=256)
    evaluation.set_defaults(run_command=evaluate_pairs)
    args = cli.parse_args()
    torch.set_num_threads(args.threads)
    args.run_command(args)
