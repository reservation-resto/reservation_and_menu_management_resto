
param(
    [Parameter(Mandatory = $true)]
    [string]$PrinterName
)

$ErrorActionPreference = "Stop"

# Node.js sends the ESC/POS payload as Base64 through stdin.
$base64 = [Console]::In.ReadToEnd().Trim()

if ([string]::IsNullOrWhiteSpace($base64)) {
    throw "No print data received."
}

$data = [Convert]::FromBase64String($base64)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WinspoolRaw
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOC_INFO_1
    {
        public string pDocName;
        public string pOutputFile;
        public string pDatatype;
    }

    [DllImport("winspool.drv", SetLastError = true,
        CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(
        string printerName,
        out IntPtr printerHandle,
        IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true,
        CharSet = CharSet.Unicode)]
    public static extern int StartDocPrinter(
        IntPtr printerHandle,
        int level,
        [In] DOC_INFO_1 documentInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(
        IntPtr printerHandle,
        byte[] buffer,
        int bufferLength,
        out int bytesWritten);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr printerHandle);
}
'@

$handle = [IntPtr]::Zero
$documentStarted = $false
$pageStarted = $false

try {
    if (-not [WinspoolRaw]::OpenPrinter(
        $PrinterName, [ref]$handle, [IntPtr]::Zero
    )) {
        throw "OpenPrinter failed. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    $doc = New-Object WinspoolRaw+DOC_INFO_1
    $doc.pDocName = "Sumatra Restaurant Receipt"
    $doc.pOutputFile = $null
    $doc.pDatatype = "RAW"

    $jobId = [WinspoolRaw]::StartDocPrinter($handle, 1, $doc)

    if ($jobId -eq 0) {
        throw "StartDocPrinter failed. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    $documentStarted = $true

    if (-not [WinspoolRaw]::StartPagePrinter($handle)) {
        throw "StartPagePrinter failed."
    }

    $pageStarted = $true

    $written = 0
    if (-not [WinspoolRaw]::WritePrinter(
        $handle, $data, $data.Length, [ref]$written
    )) {
        throw "WritePrinter failed. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    if ($written -ne $data.Length) {
        throw "Incomplete print job: wrote $written of $($data.Length) bytes."
    }

    [void][WinspoolRaw]::EndPagePrinter($handle)
    $pageStarted = $false

    [void][WinspoolRaw]::EndDocPrinter($handle)
    $documentStarted = $false

    Write-Output "RAW print job submitted. Job ID: $jobId"
}
finally {
    if ($handle -ne [IntPtr]::Zero) {
        if ($pageStarted) {
            [void][WinspoolRaw]::EndPagePrinter($handle)
        }
        if ($documentStarted) {
            [void][WinspoolRaw]::EndDocPrinter($handle)
        }
        [void][WinspoolRaw]::ClosePrinter($handle)
    }
}
