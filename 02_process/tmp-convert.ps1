$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = 'G:\01 Media\02 Video\20260423 意、西、葡\【无人机】\20260511-2西岸沿海公路（Praia da Arriba）\Sea01.jpg'
$img = [System.Drawing.Image]::FromFile($src)
$max = 1280
$scale = [Math]::Min(1.0, $max / [Math]::Max($img.Width, $img.Height))
$w = [int][Math]::Max(1, [Math]::Round($img.Width * $scale))
$h = [int][Math]::Max(1, [Math]::Round($img.Height * $scale))
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($img, 0, 0, $w, $h)
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]82)
$out = 'C:\Users\SJL\AppData\Local\Temp\wave-bg.jpg'
$bmp.Save($out, $enc, $ep)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()
$f = Get-Item $out
'{0}x{1} -> {2:N0} KB' -f $w, $h, ($f.Length/1KB)
