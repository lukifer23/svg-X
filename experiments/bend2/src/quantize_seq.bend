# Bend 2 color-quantization kernel (sequential reference).
# Reads raw RGBA bytes and writes one label byte per pixel, mirroring SVG-X
# precomputePixelLabs + labelPixels with a fixed palette baked in params.bend.
# F32 only: Bend has no F64. K = 4 is unrolled for the constant palette.
import Base
import ../fixtures/active/params.bend as P

type Pal is Data:
  Pal{l: F32, a: F32, b: F32}

def wsel(c: Bool, x: U32, y: U32) -> U32:
  match c:
    case True{}:
      x
    case False{}:
      y

def fsel(c: Bool, x: F32, y: F32) -> F32:
  match c:
    case True{}:
      x
    case False{}:
      y

def lin(c: U32) -> F32:
  +v = F32.div(U32.to_f32(c), 255.0)
  +z = F32.is_le(v, 0.04045)
  fsel(z, F32.div(v, 12.92),
    F32.pow(F32.div(F32.add(v, 0.055), 1.055), 2.4))

def cbrt(x: F32) -> F32:
  F32.pow(x, 0.3333333432674408)

def rgb_lab(r: U32, g: U32, b: U32) -> Pal:
  +lr = lin(r)
  +lg = lin(g)
  +lb = lin(b)
  +cl = F32.add(F32.add(F32.mul(0.4122214708, lr), F32.mul(0.5363325363, lg)),
    F32.mul(0.0514459929, lb))
  +cm = F32.add(F32.add(F32.mul(0.2119034982, lr), F32.mul(0.6806995451, lg)),
    F32.mul(0.1073969566, lb))
  +cs = F32.add(F32.add(F32.mul(0.0883024619, lr), F32.mul(0.2817188376, lg)),
    F32.mul(0.6299787005, lb))
  +l3 = cbrt(cl)
  +m3 = cbrt(cm)
  +s3 = cbrt(cs)
  Pal{
    F32.add(F32.sub(F32.mul(0.2104542553, l3), F32.mul(0.0040720468, s3)),
      F32.mul(0.793617785, m3)),
    F32.add(F32.sub(F32.mul(1.9779984951, l3), F32.mul(2.428592205, m3)),
      F32.mul(0.4505937099, s3)),
    F32.add(F32.sub(F32.mul(0.0259040371, l3), F32.mul(0.808675766, s3)),
      F32.mul(0.7827717662, m3))
  }

def d2c(l: F32, a: F32, b: F32, pl: F32, pa: F32, pb: F32) -> F32:
  +dl = F32.sub(l, pl)
  +da = F32.sub(a, pa)
  +db = F32.sub(b, pb)
  F32.add(F32.add(F32.mul(dl, dl), F32.mul(da, da)), F32.mul(db, db))

def near(lab: Pal) -> U32:
  match lab:
    case Pal{+l, +a, +b}:
      +d0 = d2c(l, a, b, P.PL0(), P.PA0(), P.PB0())
      +d1 = d2c(l, a, b, P.PL1(), P.PA1(), P.PB1())
      +d2 = d2c(l, a, b, P.PL2(), P.PA2(), P.PB2())
      +d3 = d2c(l, a, b, P.PL3(), P.PA3(), P.PB3())
      +z01 = F32.is_lt(d1, d0)
      +b01 = wsel(z01, 1, 0)
      +m01 = fsel(z01, d1, d0)
      +z23 = F32.is_lt(d3, d2)
      +b23 = wsel(z23, 3, 2)
      +m23 = fsel(z23, d3, d2)
      wsel(F32.is_lt(m23, m01), b23, b01)

def pix.go(px: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match px:
    case Nil{}:
      acc
    case Con{r, t0}:
      match t0:
        case Nil{}:
          acc
        case Con{g, t1}:
          match t1:
            case Nil{}:
              acc
            case Con{b, t2}:
              match t2:
                case Nil{}:
                  acc
                case Con{_, t3}:
                  pix.go(t3, Con{near(rgb_lab(r, g, b)), acc})

def quantize(bytes: List<&2, U32>) -> List<&2, U32>:
  List.reverse(&2, U32, pix.go(bytes, Nil{}))

def read_all(m: File & Result<&1, &1, U32 & String, List<&2, U32>>) -> IO(File & List<&2, U32>):
  (f, r) = m
  do IO<File & List<&2, U32>>:
    data : List<&2, U32> <- IO.pass(List<&2, U32>, r)
    return (f, data)

def compute(m: File & List<&2, U32>) -> IO(List<&2, U32>):
  (f, bytes) = m
  do IO<List<&2, U32>>:
    File.close(f)
    t0 : Nat <- IO.now()
    labels : List<&2, U32> = quantize(bytes)
    t1 : Nat <- IO.now()
    IO.print_err("quantize_ms=" ++ Nat.show(Nat.sub(t1, t0)))
    return labels

def write_all(m: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (g, r) = m
  do IO<Unit>:
    _ : Unit <- IO.pass(Unit, r)
    File.close(g)

def main() -> IO(Unit):
  do IO<Unit>:
    f : File <- IO.try(File, File.open("/root/bendexp/rgba.bin", "r"))
    m : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_bytes(f, 100000000)
    rf : File & List<&2, U32> <- read_all(m)
    labels : List<&2, U32> <- compute(rf)
    g : File <- IO.try(File, File.open("/root/bendexp/labels.bin", "w"))
    w : File & Result<&1, &1, U32 & String, Unit> <- File.write_bytes(g, labels)
    write_all(w)
