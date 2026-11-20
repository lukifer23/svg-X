# Export compatibility with independent consumers

The examples are real traced artwork, using the fitted Color bicycle and
the Centerline Velocipede. Ghostscript renders each exported EPS and
librsvg independently renders its SVG at the same dimensions. Python
loads the JSON and ezdxf imports the DXF, then checks entity counts,
closure flags, finite coordinates, and all original command endpoints
in sequence. DXF remains a polyline approximation.

At 72 DPI, foreground differences greater than 32 on any 8-bit channel
affected 10.28% of pixels on the old Centerline EPS. Its strokes used
PostScript's default butt caps and miter joins. Round caps and joins now
match the SVG stroke geometry, bringing that rate to 4.26%. Residual
differences include the rasterizers' antialiasing.

| Export | 72 DPI | 144 DPI | 288 DPI |
| --- | ---: | ---: | ---: |
| Color fitted fills | 1.78% | 0.86% | 0.26% |
| Centerline strokes after repair | 4.26% | 2.46% | 0.38% |

Run `npm run test:export-consumers` on Linux with Ghostscript and ezdxf
installed. The comparison also runs in Linux CI.
