$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class EremiteCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public uint Flags, Type;
    public IntPtr TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist, AttributeCount;
    public IntPtr Attributes, TargetAlias, UserName;
  }
  [DllImport("Advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredWrite(ref Credential credential, uint flags);
  [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("Advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("Advapi32.dll", EntryPoint="CredFree")]
  static extern void CredFree(IntPtr credential);

  public static void Write(string target, string secret) {
    byte[] bytes = Encoding.UTF8.GetBytes(secret);
    if (bytes.Length == 0 || bytes.Length > 2560) throw new Exception("credential_invalid");
    var credential = new Credential { Type=1, Persist=2, CredentialBlobSize=(uint)bytes.Length };
    credential.TargetName = Marshal.StringToHGlobalUni(target);
    credential.UserName = Marshal.StringToHGlobalUni("Eremite");
    credential.CredentialBlob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, credential.CredentialBlob, bytes.Length);
      if (!CredWrite(ref credential, 0)) throw new Exception("credential_write_failed");
    } finally {
      Array.Clear(bytes, 0, bytes.Length);
      for (int i = 0; i < (int)credential.CredentialBlobSize; i++) Marshal.WriteByte(credential.CredentialBlob, i, 0);
      Marshal.FreeHGlobal(credential.CredentialBlob);
      Marshal.FreeHGlobal(credential.TargetName);
      Marshal.FreeHGlobal(credential.UserName);
    }
  }
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      if (Marshal.GetLastWin32Error() == 1168) return null;
      throw new Exception("credential_read_failed");
    }
    try {
      var credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      if (credential.CredentialBlobSize == 0 || credential.CredentialBlobSize > 2560) throw new Exception("credential_invalid");
      byte[] bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      try { return new UTF8Encoding(false, true).GetString(bytes); }
      finally { Array.Clear(bytes, 0, bytes.Length); }
    } finally { CredFree(pointer); }
  }
  public static void Delete(string target) {
    if (!CredDelete(target, 1, 0) && Marshal.GetLastWin32Error() != 1168) throw new Exception("credential_delete_failed");
  }
}
'@

try {
  $inputValue = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($inputValue.target -notmatch '^Eremite/(AI|QA)/[a-f0-9-]+$') { throw 'credential_target_invalid' }
  switch ($inputValue.operation) {
    'read' {
      $value = [EremiteCredential]::Read($inputValue.target)
      if ($null -eq $value) { [Console]::Out.Write('missing') }
      else { [Console]::Out.Write('found:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value))) }
    }
    'write' { [EremiteCredential]::Write($inputValue.target, $inputValue.secret); [Console]::Out.Write('ok') }
    'delete' { [EremiteCredential]::Delete($inputValue.target); [Console]::Out.Write('ok') }
    default { throw 'credential_operation_invalid' }
  }
} catch {
  [Console]::Error.Write('credential_store_failed')
  exit 1
}
