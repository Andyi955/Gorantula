param([Parameter(Mandatory=$true)][string]$InputPDF, [int]$FirstPage=1, [int]$LastPage=1, [int]$Rotation=0)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($Operation, [Type]$ResultType) {
 $task=$asTask.MakeGenericMethod($ResultType).Invoke($null,@($Operation)); $task.GetAwaiter().GetResult()
}
try {
 if ($FirstPage -lt 1 -or $LastPage -lt $FirstPage -or ($LastPage-$FirstPage) -gt 2 -or $Rotation -notin @(0,90,180,270)) {throw 'Invalid page range or rotation'}
 $file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($InputPDF)) ([Windows.Storage.StorageFile])
 $document=Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
 if ($LastPage -gt $document.PageCount) {throw 'Requested page exceeds PDF page count'}
 $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
 if ($null -eq $engine) {throw 'No Windows OCR language is installed. Install a Windows language OCR feature.'}
 $pages=@()
 for ($number=$FirstPage; $number -le $LastPage; $number++) {
  $page=$document.GetPage([uint32]($number-1)); $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  try {
   $options=New-Object Windows.Data.Pdf.PdfPageRenderOptions
   $scale=[Math]::Min(2400,[Windows.Media.Ocr.OcrEngine]::MaxImageDimension)/[Math]::Max($page.Size.Width,$page.Size.Height)
   $options.DestinationWidth=[uint32]([Math]::Max(1,$page.Size.Width*$scale)); $options.DestinationHeight=[uint32]([Math]::Max(1,$page.Size.Height*$scale))
   $action=$asAction.Invoke($null,@($page.RenderToStreamAsync($stream,$options))); $null=$action.GetAwaiter().GetResult()
   $stream.Seek(0)
   $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
   $transform=New-Object Windows.Graphics.Imaging.BitmapTransform
   $transform.Rotation=[Windows.Graphics.Imaging.BitmapRotation]([int]($Rotation/90))
   $bitmap=Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,$transform,[Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,[Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
   try {
    $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $words=@();foreach($line in $result.Lines){foreach($word in $line.Words){$r=$word.BoundingRect;$words+=@{text=$word.Text;x=100*$r.X/$bitmap.PixelWidth;y=100*$r.Y/$bitmap.PixelHeight;width=100*$r.Width/$bitmap.PixelWidth;height=100*$r.Height/$bitmap.PixelHeight}}}
    if ($words.Count -gt 4000) {throw 'OCR page exceeds 4000 words'}
    $pages+=@{page=$number;words=$words;language=$engine.RecognizerLanguage.LanguageTag;rotation=$Rotation}
   } finally {if($null -ne $bitmap){$bitmap.Dispose()}}
  } finally {$page.Dispose();$stream.Dispose()}
 }
 @{pages=$pages;engine='Windows.Media.Ocr';version=[Environment]::OSVersion.Version.ToString()} | ConvertTo-Json -Depth 8 -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
