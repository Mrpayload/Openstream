param(
  [Parameter(Mandatory = $true)]
  [string]$Uri
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Net.Http

$raw = $Uri.Trim().Trim('"')
if ($raw.StartsWith("vlc://", [StringComparison]::OrdinalIgnoreCase)) {
  $raw = $raw.Substring(6)
} elseif ($raw.StartsWith("vlc:", [StringComparison]::OrdinalIgnoreCase)) {
  $raw = $raw.Substring(4).TrimStart("/")
}
$raw = $raw.Trim().TrimEnd("/")

$raw = [Uri]::UnescapeDataString($raw).Replace("-", "+").Replace("_", "/")
$padding = (4 - ($raw.Length % 4)) % 4
if ($padding -gt 0) {
  $raw = $raw + ("=" * $padding)
}

$streamUrl = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($raw))
$streamUrl = [regex]::Replace($streamUrl, "[\x00-\x1F\x7F]+$", "").Trim()
if (-not $streamUrl.StartsWith("http://", [StringComparison]::OrdinalIgnoreCase) -and
    -not $streamUrl.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsupported VLC stream URL: $streamUrl"
}

function Resolve-RedirectUrl {
  param([string]$Url)

  $currentUrl = $Url
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(30)
  $client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")

  try {
    for ($i = 0; $i -lt 5; $i++) {
      try {
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $currentUrl)
        $response = $client.Send($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead)
        try {
          if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400 -and $response.Headers.Location) {
            $nextUrl = $response.Headers.Location.ToString()
            if ([Uri]::IsWellFormedUriString($nextUrl, [UriKind]::Relative)) {
              $nextUrl = [Uri]::new([Uri]$currentUrl, $nextUrl).AbsoluteUri
            }
            $currentUrl = $nextUrl
            continue
          }
          return $currentUrl
        } finally {
          if ($response) { $response.Dispose() }
        }
      } catch {
        return $currentUrl
      }
    }
    return $currentUrl
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

$streamUrl = Resolve-RedirectUrl -Url $streamUrl

$vlcCandidates = @("C:\Program Files\VideoLAN\VLC\vlc.exe", "C:\Program Files (x86)\VideoLAN\VLC\vlc.exe")
$vlcPath = $vlcCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $vlcPath) {
  throw "VLC executable not found. Install VLC or update this handler script."
}

Start-Process -FilePath $vlcPath -ArgumentList @($streamUrl)
