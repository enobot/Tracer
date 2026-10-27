# Starts a packaged Tracer.exe with a throwaway profile, captures its window,
# and fails if the page area is blank. A blank window is what users see when
# the packaged renderer can't load, which unit tests and dev runs don't catch.
# Usage: pwsh scripts/verify-packaged-window.ps1 -Exe out/Tracer-win32-x64/Tracer.exe [-Png window.png]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Png = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TracerWindowCheck {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
}
"@

$exePath = (Resolve-Path $Exe).Path
$profileDir = Join-Path ([IO.Path]::GetTempPath()) "tracer-window-check-$PID"
$process = Start-Process -FilePath $exePath -ArgumentList "--user-data-dir=$profileDir" -PassThru
try {
  $window = $null
  for ($i = 0; $i -lt 60 -and -not $window; $i++) {
    Start-Sleep -Milliseconds 500
    $window = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exePath)) -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  }
  if (-not $window) { throw 'Tracer did not open a window within 30 seconds.' }
  # Give the page time to load and paint.
  Start-Sleep -Seconds 4

  $rect = New-Object TracerWindowCheck+RECT
  [TracerWindowCheck]::GetWindowRect($window.MainWindowHandle, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $dc = $graphics.GetHdc()
  # 2 = PW_RENDERFULLCONTENT, needed for Chromium windows.
  [TracerWindowCheck]::PrintWindow($window.MainWindowHandle, $dc, 2) | Out-Null
  $graphics.ReleaseHdc($dc)
  $graphics.Dispose()
  if ($Png) { $bitmap.Save($Png, [System.Drawing.Imaging.ImageFormat]::Png) }

  # Sample the page area below the title bar and menu; count non-white pixels.
  $samples = 0
  $marked = 0
  for ($y = 80; $y -lt $height - 10; $y += 6) {
    for ($x = 10; $x -lt $width - 10; $x += 6) {
      $pixel = $bitmap.GetPixel($x, $y)
      $samples++
      if ($pixel.R -lt 235 -or $pixel.G -lt 235 -or $pixel.B -lt 235) { $marked++ }
    }
  }
  $bitmap.Dispose()
  $share = [math]::Round(100 * $marked / [math]::Max($samples, 1), 1)
  Write-Output "Window $width x $height; $share% of the page area is not white."
  if ($share -lt 3) { throw 'The Tracer window is blank: the page did not render.' }
  Write-Output 'Packaged window renders.'
}
finally {
  Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exePath)) -ErrorAction SilentlyContinue | Stop-Process -Force
}
