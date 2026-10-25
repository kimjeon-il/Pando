param(
  [Parameter(Mandatory=$true)][int]$OwnerProcessId,
  [Parameter(Mandatory=$true)][string]$TargetPath,
  [ValidateSet('Open','Save')][string]$Mode = 'Open',
  [ValidateRange(1,120)][int]$WaitSeconds = 10
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
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetFocus();
  [StructLayout(LayoutKind.Sequential)] private struct Keyboard { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size=32)] private struct InputData { [FieldOffset(0)] public Keyboard keyboard; }
  [StructLayout(LayoutKind.Sequential)] private struct Input { public uint type; public InputData data; }
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr SetText(IntPtr window, uint message, IntPtr wParam, string text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr ReadText(IntPtr window, uint message, IntPtr wParam, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)]
  private static extern IntPtr Click(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  private static string Class(IntPtr window) { var name=new StringBuilder(256);GetClassName(window,name,name.Capacity);return name.ToString(); }
  private static bool Owned(IntPtr window, int processId) { uint owner;GetWindowThreadProcessId(window,out owner);return owner==(uint)processId; }
  public static IntPtr Find(int processId) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((window,state)=>{if(Owned(window,processId)&&Class(window)=="#32770"){found=window;return false;}return true;},IntPtr.Zero);
    return found;
  }
  private static bool Controls(IntPtr dialog, int processId, int filenameId, out IntPtr edit, out IntPtr accept) {
    IntPtr filename=IntPtr.Zero,button=IntPtr.Zero;
    EnumChildWindows(dialog,(window,state)=>{
      if(Owned(window,processId)) {
        if(GetDlgCtrlID(window)==filenameId&&Class(window)=="Edit")filename=window;
        if(GetDlgCtrlID(window)==1&&Class(window)=="Button")button=window;
      }
      return true;
    },IntPtr.Zero);
    edit=filename;accept=button;
    return edit!=IntPtr.Zero&&accept!=IntPtr.Zero&&IsChild(dialog,edit)&&IsChild(dialog,accept);
  }
  public static bool Ready(IntPtr dialog, int processId, int filenameId) { IntPtr edit,accept;return Controls(dialog,processId,filenameId,out edit,out accept); }
  public static IntPtr Editor(IntPtr dialog, int processId, int filenameId) {
    IntPtr edit,accept;if(!Controls(dialog,processId,filenameId,out edit,out accept))throw new Exception("Owned filename control unavailable");return edit;
  }
  public static string Describe(IntPtr dialog) {
    var controls=new StringBuilder();
    EnumChildWindows(dialog,(window,state)=>{string name=Class(window);if(name=="Edit"||name=="Button"||name.StartsWith("ComboBox"))controls.Append(GetDlgCtrlID(window)).Append(":").Append(name).Append(";");return true;},IntPtr.Zero);
    return controls.ToString();
  }
  private static Input Key(ushort key, ushort scan, uint flags) { return new Input { type=1, data=new InputData { keyboard=new Keyboard { key=key,scan=scan,flags=flags } } }; }
  private static void TypeFilename(IntPtr dialog, IntPtr edit, int processId, string path) {
    if(GetForegroundWindow()!=dialog)SetForegroundWindow(dialog);
    if(GetForegroundWindow()!=dialog)throw new Exception("Test-owned dialog could not be activated; expected="+dialog+", foreground="+GetForegroundWindow());
    uint owner;uint targetThread=GetWindowThreadProcessId(edit,out owner),thread=GetCurrentThreadId();
    if(owner!=(uint)processId||!AttachThreadInput(thread,targetThread,true))throw new Exception("Test-owned filename focus unavailable");
    try {
      SetFocus(edit);
      if(GetFocus()!=edit||GetForegroundWindow()!=dialog)throw new Exception("Test-owned filename lost focus");
      var inputs=new System.Collections.Generic.List<Input>();
      inputs.Add(Key(0x11,0,0));inputs.Add(Key(0x41,0,0));inputs.Add(Key(0x41,0,2));inputs.Add(Key(0x11,0,2));
      foreach(char value in path){inputs.Add(Key(0,(ushort)value,4));inputs.Add(Key(0,(ushort)value,6));}
      var array=inputs.ToArray();
      if(SendInput((uint)array.Length,array,Marshal.SizeOf(typeof(Input)))!=array.Length)throw new Exception("Test filename keyboard input failed");
    } finally { AttachThreadInput(thread,targetThread,false); }
  }
  public static void Choose(IntPtr dialog, int processId, int filenameId, string path, bool keyboardInput) {
    if(!Owned(dialog,processId)||Class(dialog)!="#32770")throw new Exception("Dialog owner changed");
    IntPtr edit,accept;
    if(!Controls(dialog,processId,filenameId,out edit,out accept))throw new Exception("Expected owned filename/accept controls unavailable: "+Describe(dialog));
    UIntPtr result;
    if(keyboardInput) {
      TypeFilename(dialog,edit,processId,path);
      bool entered=false;
      for(int attempt=0;attempt<100;attempt++) {
        var value=new StringBuilder(32768);
        if(ReadText(edit,0x000D,(IntPtr)value.Capacity,value,2,1000,out result)==IntPtr.Zero)throw new Exception("Reading test filename failed");
        if(value.ToString()==path){entered=true;break;}
        System.Threading.Thread.Sleep(100);
      }
      if(!entered)throw new Exception("Native save filename did not finish receiving input");
    } else if(SetText(edit,0x000C,IntPtr.Zero,path,2,10000,out result)==IntPtr.Zero||result==UIntPtr.Zero)throw new Exception("Setting test filename failed");
    if(!Owned(dialog,processId)||Click(accept,0x00F5,IntPtr.Zero,IntPtr.Zero,2,10000,out result)==IntPtr.Zero)throw new Exception("Accepting test filename failed");
  }
}
'@
$dialog = [IntPtr]::Zero
for ($attempt=0; $attempt -lt $WaitSeconds*5; $attempt++) {
  $dialog = [PandoNativeFileDialog]::Find($OwnerProcessId)
  if ($dialog -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 200
}
if ($dialog -eq [IntPtr]::Zero) { throw 'The test-owned native file dialog did not appear.' }
$filenameId = if ($Mode -eq 'Save') { 1001 } else { 1148 }
for ($attempt=0; $attempt -lt 25 -and -not [PandoNativeFileDialog]::Ready($dialog,$OwnerProcessId,$filenameId); $attempt++) { Start-Sleep -Milliseconds 200 }
[PandoNativeFileDialog]::Choose($dialog, $OwnerProcessId, $filenameId, $absoluteTarget, ($Mode -eq 'Save'))
@{ handled=$true; mode=$Mode; ownerProcessId=$OwnerProcessId; path=$absoluteTarget } | ConvertTo-Json -Compress
