# Held-out centerline qualification

These three Bell-era drawings were selected and annotated from original
Library of Congress scans without changing the production tracer. The
checked-in JPEGs preserve the paper condition and visible ink. Their
longest sides are capped at 2,000 pixels without enlargement. The
[reference file](../tests/fixtures/qualification/references.json) uses
coordinates on a 650-pixel-wide view. Each source dates from 1875–1880.
[Photophone](https://www.loc.gov/item/magbell.25200104/) ·
[Telephone](https://www.loc.gov/item/magbell.27300105/) ·
[Multiple telegraph](https://www.loc.gov/item/magbell.28500103/)

The frozen tracer is `2581262`. A loop matches at 0.55 or higher
intersection over union between a marked interior and a traced
enclosure. Open-gap probes use local rectangles so a page border
cannot turn a physically open contact into a closed one. Ink
checkpoints and blank paper boxes provide separate coverage and
overtracing signals. The annotations sample the images.

| Scan               | Working limit | Loop matches | Open probes | Median / p95 trace |
| ------------------ | ------------: | -----------: | ----------: | -----------------: |
| Photophone         |         1,000 |          0/1 |         1/1 |     50.0 / 70.7 ms |
| Photophone         |         2,000 |          0/1 |         1/1 |     49.4 / 55.6 ms |
| Telephone          |         1,000 |          1/1 |         0/1 |     82.1 / 93.2 ms |
| Telephone          |         2,000 |          0/1 |         1/1 |   365.6 / 382.6 ms |
| Multiple telegraph |         1,000 |          2/2 |         1/1 |    97.6 / 104.8 ms |
| Multiple telegraph |         2,000 |          0/2 |         1/1 |   415.1 / 425.7 ms |

Each timing uses 20 traces after five warm-ups on Windows with
Node 24.19.0. Decode, rasterizing the trace, and application overhead
are excluded. The Photophone source is 1,024 pixels wide, so the second
run uses 1,024 pixels. The other two scans lose all three matched loops
at the larger working size. They also gain traced pixels in their paper
boxes. At the smaller size, the telephone's annotated open horn gap
fails its probe. These findings are baseline gaps, not acceptance goals.

The Linux CI check preserves baseline matches, open probes, and each
hit ink checkpoint. It also limits paper pixels to the baseline and
allows up to 0.02 IoU variation per marked region. Timing is reported
separately to avoid gating on shared runner load.
[Raw baseline](archival-qualification-2581262.json)

The [full-resolution follow-up](ARCHIVAL-SCALE.md) locates the loss in
ink screening and checks the repair on two further archival drawings.
