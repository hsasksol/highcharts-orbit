# Minimal static file server for the Orbit demos.
# Why: code.highcharts.com returns 403 when no Referer header is sent, which is
# exactly what happens when a page is opened from file://. Served from
# http://localhost the browser sends a Referer and everything loads.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8123
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Start-Process "http://localhost:$port/index.html"
Write-Host "Serving $root at http://localhost:$port/ - close this window to stop."
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript"
  ".css"  = "text/css"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".json" = "application/json"
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($path)) { $path = "index.html" }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    if ((Test-Path $file -PathType Leaf) -and $file.StartsWith($root)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    $ctx.Response.StatusCode = 500
  }
  $ctx.Response.Close()
}
