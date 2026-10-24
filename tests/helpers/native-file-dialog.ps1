param(
  [Parameter(Mandatory=$true)][int]$OwnerProcessId,
  [Parameter(Mandatory=$true)][string]$TargetPath,
  [ValidateSet('Open','Save')][string]$Mode = 'Open'
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$absoluteTarget = [IO.Path]::GetFullPath($TargetPath)
if (-not [IO.Path]::IsPathRooted($TargetPath)) { throw 'An absolute test file path is required.' }
if ($Mode -eq 'Open' -and -not (Test-Path -LiteralPath $absoluteTarget -PathType Leaf)) { throw 'Test input does not exist.' }
if ($Mode -eq 'Save' -and (Test-Path -LiteralPath $absoluteTarget)) { throw 'Refusing to overwrite an existing test output.' }
# Actual Win32 controls expose UIA Pane elements without Value/Invoke patterns.
# Target only the observed filename edit and accept button in the supplied PID.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PandoNativeFileDialog {
  private delegate bool Callback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr state);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr SetText(IntPtr window, uint message, IntPtr wParam, string text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)]
  private static extern IntPtr Click(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  private static string Class(IntPtr window) { var name=new StringBuilder(256);GetClassName(window,name,name.Capacity);return name.ToString(); }
  private static bool Owned(IntPtr window, int processId) { uint owner;GetWindowThreadProcessId(window,out owner);return owner==(uint)processId; }
  public static IntPtr Find(int processId) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((window,state)=>{if(Owned(window,processId)&&Class(window)=="#32770"){found=window;return false;}return true;},IntPtr.Zero);
    return found;
  }
  public static void Choose(IntPtr dialog, int processId, string path) {
    if(!Owned(dialog,processId)||Class(dialog)!="#32770")throw new Exception("Dialog owner changed");
    IntPtr edit=IntPtr.Zero,accept=IntPtr.Zero;
    EnumChildWindows(dialog,(window,state)=>{
      if(Owned(window,processId)) {
        if(GetDlgCtrlID(window)==1148&&Class(window)=="Edit")edit=window;
        if(GetDlgCtrlID(window)==1&&Class(window)=="Button")accept=window;
      }
      return true;
    },IntPtr.Zero);
    if(edit==IntPtr.Zero||accept==IntPtr.Zero||!IsChild(dialog,edit)||!IsChild(dialog,accept))throw new Exception("Expected owned filename/accept controls unavailable");
    UIntPtr result;
    if(SetText(edit,0x000C,IntPtr.Zero,path,2,10000,out result)==IntPtr.Zero||result==UIntPtr.Zero)throw new Exception("Setting test filename failed");
    if(!Owned(dialog,processId)||Click(accept,0x00F5,IntPtr.Zero,IntPtr.Zero,2,10000,out result)==IntPtr.Zero)throw new Exception("Accepting test filename failed");
  }
}
'@
$dialog = [IntPtr]::Zero
for ($attempt=0; $attempt -lt 50; $attempt++) {
  $dialog = [PandoNativeFileDialog]::Find($OwnerProcessId)
  if ($dialog -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 200
}
if ($dialog -eq [IntPtr]::Zero) { throw 'The test-owned native file dialog did not appear.' }
[PandoNativeFileDialog]::Choose($dialog, $OwnerProcessId, $absoluteTarget)
@{ handled=$true; mode=$Mode; ownerProcessId=$OwnerProcessId; path=$absoluteTarget } | ConvertTo-Json -Compress
