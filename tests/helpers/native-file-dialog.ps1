param(
  [Parameter(Mandatory=$true)][int]$OwnerProcessId,
  [Parameter(Mandatory=$true)][string]$TargetPath,
  [ValidateSet('Open','Save')][string]$Mode = 'Open'
)
$ErrorActionPreference = 'Stop'
$absoluteTarget = [IO.Path]::GetFullPath($TargetPath)
if (-not [IO.Path]::IsPathRooted($TargetPath)) { throw 'An absolute test file path is required.' }
if ($Mode -eq 'Open' -and -not (Test-Path -LiteralPath $absoluteTarget -PathType Leaf)) { throw 'Test input does not exist.' }
if ($Mode -eq 'Save' -and (Test-Path -LiteralPath $absoluteTarget)) { throw 'Refusing to overwrite an existing test output.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$scope = [System.Windows.Automation.TreeScope]
$element = [System.Windows.Automation.AutomationElement]
$ownerCondition = New-Object System.Windows.Automation.PropertyCondition($element::ProcessIdProperty, $OwnerProcessId)
$dialog = $null
for ($attempt=0; $attempt -lt 50; $attempt++) {
  $windows = $element::RootElement.FindAll($scope::Children, $ownerCondition)
  foreach ($window in $windows) { if ($window.Current.ClassName -eq '#32770') { $dialog=$window; break } }
  if ($dialog) { break }
  Start-Sleep -Milliseconds 200
}
if (-not $dialog) { throw 'The test-owned native file dialog did not appear.' }
$fileComboCondition = New-Object System.Windows.Automation.PropertyCondition($element::AutomationIdProperty, '1148')
$combo = $dialog.FindFirst($scope::Descendants, $fileComboCondition)
$editCondition = New-Object System.Windows.Automation.PropertyCondition($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$fileEdit = if ($combo) { $combo.FindFirst($scope::Descendants, $editCondition) } else { $null }
if (-not $fileEdit) {
  foreach ($candidate in $dialog.FindAll($scope::Descendants, $editCondition)) {
    if ($candidate.Current.AutomationId -eq '1001' -or $candidate.Current.Name -match 'File name|파일 이름') { $fileEdit=$candidate; break }
  }
}
if (-not $fileEdit) { throw 'The native file-name edit control is unavailable.' }
$value = $fileEdit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$value.SetValue($absoluteTarget)
$acceptCondition = New-Object System.Windows.Automation.PropertyCondition($element::AutomationIdProperty, '1')
$accept = $dialog.FindFirst($scope::Descendants, $acceptCondition)
if (-not $accept) { throw 'The native file dialog accept control is unavailable.' }
$accept.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
@{ handled=$true; mode=$Mode; ownerProcessId=$OwnerProcessId; path=$absoluteTarget } | ConvertTo-Json -Compress
