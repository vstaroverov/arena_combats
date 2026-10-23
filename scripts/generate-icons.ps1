$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$distPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../dist'))
$assetsPath = Join-Path $distPath 'assets'
function Write-BrandIcon([int]$Size,[string]$Destination) {
  $bitmap = [System.Drawing.Bitmap]::new($Size,$Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#101211'))
  $foreground = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#ceff4b'))
  $round = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $letter = [System.Drawing.Drawing2D.GraphicsPath]::new()
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($Size/64.0,$Size/64.0)
    $round.AddArc(0,0,28,28,180,90); $round.AddArc(36,0,28,28,270,90)
    $round.AddArc(36,36,28,28,0,90); $round.AddArc(0,36,28,28,90,90); $round.CloseFigure()
    $graphics.FillPath($background,$round)
    $letter.AddLine(49,11,30,11); $letter.AddBezier(30,11,19,11,14,17,14,27)
    $letter.AddBezier(14,27,14,34,18,39,25,41)
    $letter.AddLine(25,41,13,54); $letter.AddLine(13,54,26,54); $letter.AddLine(26,54,37,41)
    $letter.AddLine(37,41,38,41); $letter.AddLine(38,41,38,54); $letter.AddLine(38,54,49,54); $letter.AddLine(49,54,49,11); $letter.CloseFigure()
    $letter.StartFigure(); $letter.AddLine(38,21,38,31); $letter.AddLine(38,31,30,31)
    $letter.AddBezier(30,31,26,31,24,29,24,26); $letter.AddBezier(24,26,24,23,26,21,30,21)
    $letter.AddLine(30,21,38,21); $letter.CloseFigure()
    $graphics.FillPath($foreground,$letter)
    $bitmap.Save($Destination,[System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $letter.Dispose(); $round.Dispose(); $background.Dispose(); $foreground.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}
foreach ($size in @(32,192,512)) { Write-BrandIcon $size (Join-Path $assetsPath "icon-$size.png") }
Write-BrandIcon 180 (Join-Path $assetsPath 'apple-touch-icon.png')
$png = [System.IO.File]::ReadAllBytes((Join-Path $assetsPath 'icon-32.png'))
$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
  $writer.Write([byte]32); $writer.Write([byte]32); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
  $writer.Flush(); [System.IO.File]::WriteAllBytes((Join-Path $distPath 'favicon.ico'),$stream.ToArray())
} finally { $writer.Dispose(); $stream.Dispose() }
Write-Output 'Created SVG-compatible brand icons: ICO, PNG 32/180/192/512.'
