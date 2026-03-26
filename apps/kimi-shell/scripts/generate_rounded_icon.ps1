param(
  [string]$SourcePath = "",
  [string]$OutputPath = "",
  [int]$CanvasSize = 1024,
  [double]$ContentScale = 0.92,
  [double]$CornerRadiusScale = 0.2
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )

  $diameter = [Math]::Min($Radius * 2.0, [Math]::Min($Rectangle.Width, $Rectangle.Height))
  $arc = New-Object System.Drawing.RectangleF($Rectangle.X, $Rectangle.Y, $diameter, $diameter)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath

  $path.AddArc($arc, 180, 90)
  $arc.X = $Rectangle.Right - $diameter
  $path.AddArc($arc, 270, 90)
  $arc.Y = $Rectangle.Bottom - $diameter
  $path.AddArc($arc, 0, 90)
  $arc.X = $Rectangle.X
  $path.AddArc($arc, 90, 90)
  $path.CloseFigure()

  return $path
}

$scriptRoot = $PSScriptRoot
$shellRoot = Split-Path -Parent $scriptRoot
$iconsRoot = Join-Path $shellRoot "src-tauri\icons"

if ([string]::IsNullOrWhiteSpace($SourcePath)) {
  $SourcePath = Join-Path $iconsRoot "moonki.png"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $iconsRoot "moonki-rounded-master.png"
}

if (-not (Test-Path $SourcePath)) {
  throw "Source icon not found: $SourcePath"
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path $outputDirectory)) {
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($SourcePath)
$masterBitmap = New-Object System.Drawing.Bitmap($CanvasSize, $CanvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($masterBitmap)

try {
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $contentSize = [int][Math]::Round($CanvasSize * $ContentScale)
  $offset = [int][Math]::Round(($CanvasSize - $contentSize) / 2.0)
  $destinationRect = New-Object System.Drawing.Rectangle($offset, $offset, $contentSize, $contentSize)
  $cornerRadius = [float]($CanvasSize * $CornerRadiusScale)
  $clipPath = New-RoundedRectanglePath -Rectangle ([System.Drawing.RectangleF]$destinationRect) -Radius $cornerRadius

  try {
    $graphics.SetClip($clipPath)
    $graphics.DrawImage($sourceBitmap, $destinationRect)
  }
  finally {
    $graphics.ResetClip()
    $clipPath.Dispose()
  }

  $masterBitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $graphics.Dispose()
  $masterBitmap.Dispose()
  $sourceBitmap.Dispose()
}

Write-Host "rounded icon master written to $OutputPath"
