# Build a multi-size Windows .ico from build/icon.png (no external deps).
# Writes BMP/BGRA entries (universally accepted by NSIS and Explorer).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = 'D:\12345\Asteria\build\icon.png'
$out = 'D:\12345\Asteria\build\icon.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)

$source = [System.Drawing.Image]::FromFile($src)

$images = @()
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($source, 0, 0, $size, $size)
  $g.Dispose()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $raw = New-Object byte[] ($stride * $size)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
  $bmp.UnlockBits($data)
  $bmp.Dispose()

  # BMP entries store rows bottom-up with a 32bpp BGRA layout; PNG data is top-down BGRA.
  $pixels = New-Object byte[] ($size * $size * 4)
  for ($y = 0; $y -lt $size; $y++) {
    $srcRow = ($size - 1 - $y) * $stride
    [Array]::Copy($raw, $srcRow, $pixels, $y * $size * 4, $size * 4)
  }

  $maskRow = [int][math]::Ceiling($size / 32.0) * 4
  $mask = New-Object byte[] ($maskRow * $size)   # all zero = fully opaque

  $images += [pscustomobject]@{ Size = $size; Pixels = $pixels; Mask = $mask; MaskRow = $maskRow }
}
$source.Dispose()

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)

# ICONDIR
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$images.Count)

$offset = 6 + 16 * $images.Count
$entries = @()
foreach ($img in $images) {
  $headerSize = 40 + $img.Pixels.Length + $img.Mask.Length
  $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
  $entries += [pscustomobject]@{ Img = $img; Dim = $dim; Size = $headerSize; Offset = $offset }
  $offset += $headerSize
}

foreach ($entry in $entries) {
  $writer.Write([byte]$entry.Dim)
  $writer.Write([byte]$entry.Dim)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$entry.Size)
  $writer.Write([uint32]$entry.Offset)
}

foreach ($entry in $entries) {
  $img = $entry.Img
  $writer.Write([uint32]40)
  $writer.Write([int32]$img.Size)
  $writer.Write([int32]($img.Size * 2))
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]0)
  $writer.Write([uint32]($img.Pixels.Length + $img.Mask.Length))
  $writer.Write([int32]0)
  $writer.Write([int32]0)
  $writer.Write([uint32]0)
  $writer.Write([uint32]0)
  $writer.Write($img.Pixels)
  $writer.Write($img.Mask)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($out, $stream.ToArray())
$writer.Dispose()
$stream.Dispose()

$info = Get-Item $out
Write-Output ("icon.ico written: {0} bytes, sizes {1}" -f $info.Length, ($sizes -join '/'))
