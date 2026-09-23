import Base

def read_all(m: File & Result<&1, &1, U32 & String, List<&2, U32>>) -> IO(List<&2, U32>):
  (f, r) = m
  do IO<List<&2, U32>>:
    data : List<&2, U32> <- IO.pass(List<&2, U32>, r)
    File.close(f)
    return data

def write_all(m: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (g, r) = m
  do IO<Unit>:
    _ : Unit <- IO.pass(Unit, r)
    File.close(g)

def main() -> IO(Unit):
  do IO<Unit>:
    f : File <- IO.try(File, File.open("/root/bendexp/in.bin", "r"))
    m : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_bytes(f, 1000000)
    data : List<&2, U32> <- read_all(m)
    g : File <- IO.try(File, File.open("/root/bendexp/out.bin", "w"))
    w : File & Result<&1, &1, U32 & String, Unit> <- File.write_bytes(g, data)
    write_all(w)
